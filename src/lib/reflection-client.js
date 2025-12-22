/**
 * gRPC Reflection Client
 * 負責透過 gRPC Server Reflection API 取得服務定義
 * 使用 @bufbuild/protobuf 官方庫解析 FileDescriptorProto
 */

import { sendGrpcWebRequest } from './grpc-web-transport.js';
import {
  parseListServicesResponse,
  parseFileDescriptorResponse,
} from './descriptor-parser.js';
import { createLogger } from './logger.js';
import { fromBinary, createFileRegistry, create } from '@bufbuild/protobuf';
import { 
  FileDescriptorProtoSchema,
  FileDescriptorSetSchema,
  file_google_protobuf_timestamp,
  file_google_protobuf_duration,
  file_google_protobuf_any,
  file_google_protobuf_struct,
  file_google_protobuf_wrappers,
  file_google_protobuf_empty,
  file_google_protobuf_field_mask,
  file_google_protobuf_descriptor,
} from '@bufbuild/protobuf/wkt';

const logger = createLogger('Reflection');

/**
 * Well-known types 的 file descriptors 映射
 * 用於在 createFileRegistry resolver 中提供 Google 預設 types
 */
const WKT_FILES = new Map([
  ['google/protobuf/timestamp.proto', file_google_protobuf_timestamp],
  ['google/protobuf/duration.proto', file_google_protobuf_duration],
  ['google/protobuf/any.proto', file_google_protobuf_any],
  ['google/protobuf/struct.proto', file_google_protobuf_struct],
  ['google/protobuf/wrappers.proto', file_google_protobuf_wrappers],
  ['google/protobuf/empty.proto', file_google_protobuf_empty],
  ['google/protobuf/field_mask.proto', file_google_protobuf_field_mask],
  ['google/protobuf/descriptor.proto', file_google_protobuf_descriptor],
]);

/**
 * 支援的 Reflection 服務版本
 */
const REFLECTION_SERVICES = [
  'grpc.reflection.v1.ServerReflection',
  'grpc.reflection.v1alpha.ServerReflection',
];

class ReflectionClient {
  constructor() {
    /** @type {Map<string, object>} 快取已反射的定義 */
    this.cache = new Map();
  }

  /**
   * 從伺服器取得所有服務定義
   * 返回可直接用於 proto-engine 的結構
   * @param {string} serverUrl - gRPC 伺服器 URL
   * @returns {Promise<{services: object[], messages: object, registry: import('@bufbuild/protobuf').FileRegistry | null} | null>}
   */
  async fetchFromServer(serverUrl) {
    logger.info('Attempting for:', serverUrl);

    for (const reflectionService of REFLECTION_SERVICES) {
      try {
        // Step 1: Get service list
        const services = await this.listServices(serverUrl, reflectionService);
        if (!services || services.length === 0) continue;

        logger.info('Found services:', services);

        // Step 2: 收集所有 FileDescriptorProto 二進位資料
        const allDescriptorBytes = [];
        const loadedFiles = new Set();

        /**
         * 遞迴載入 FileDescriptor 及其依賴
         * @param {Uint8Array[] | null} descriptorBytes
         */
        const loadFileDescriptors = async (descriptorBytes) => {
          if (!descriptorBytes) return;

          for (const bytes of descriptorBytes) {
            // 使用官方 API 解析 FileDescriptorProto
            let descriptor;
            try {
              descriptor = fromBinary(FileDescriptorProtoSchema, bytes);
            } catch (e) {
              logger.warn('Failed to parse FileDescriptorProto:', e.message);
              continue;
            }

            // Skip if already loaded
            if (loadedFiles.has(descriptor.name)) continue;
            loadedFiles.add(descriptor.name);
            
            // 保存原始 bytes
            allDescriptorBytes.push(bytes);

            // Recursively load dependencies
            for (const depName of descriptor.dependency || []) {
              if (loadedFiles.has(depName)) continue;

              try {
                const depDescriptorBytes = await this.getFileByFilename(
                  serverUrl,
                  reflectionService,
                  depName
                );
                if (depDescriptorBytes) {
                  await loadFileDescriptors(depDescriptorBytes);
                }
              } catch (e) {
                logger.debug(`Could not load dependency: ${depName}`);
              }
            }
          }
        };

        for (const serviceName of services) {
          if (serviceName.includes('grpc.reflection')) continue;

          try {
            const fileDescriptor = await this.getFileContainingSymbol(
              serverUrl,
              reflectionService,
              serviceName
            );

            console.log(`[ReflectionClient] Got descriptor for ${serviceName}:`, fileDescriptor ? `${fileDescriptor.length} bytes` : 'null');
            await loadFileDescriptors(fileDescriptor);
          } catch (e) {
            console.error(`[ReflectionClient] Failed to get descriptor for ${serviceName}:`, e);
          }
        }

        console.log(`[ReflectionClient] allDescriptorBytes.length = ${allDescriptorBytes.length}`);
        
        if (allDescriptorBytes.length > 0) {
          // 使用官方 API 從所有 FileDescriptorProto 建立 FileRegistry
          const result = this._buildRegistryFromBytes(allDescriptorBytes);
          
          console.log(`[ReflectionClient] Result: ${result.services.length} services, ${Object.keys(result.messages).length} messages`);
          
          return result;
        } else {
          console.warn(`[ReflectionClient] No descriptors collected!`);
        }
      } catch (e) {
        console.error(`[ReflectionClient] ${reflectionService} failed:`, e);
      }
    }

    return null;
  }

  /**
   * 從 FileDescriptorProto 二進位資料建立 Registry 和 serviceMap
   * @param {Uint8Array[]} descriptorBytesList
   * @returns {{services: object[], messages: object, registry: import('@bufbuild/protobuf').FileRegistry | null}}
   */
  _buildRegistryFromBytes(descriptorBytesList) {
    const result = {
      services: [],
      messages: {},
      registry: null,
    };

    console.log(`[ReflectionClient] _buildRegistryFromBytes: received ${descriptorBytesList.length} descriptors`);

    // 解析所有 FileDescriptorProto
    const fileDescriptors = [];
    const fileDescriptorMap = new Map(); // name -> FileDescriptorProto
    
    for (const bytes of descriptorBytesList) {
      try {
        const fd = fromBinary(FileDescriptorProtoSchema, bytes);
        fileDescriptors.push(fd);
        fileDescriptorMap.set(fd.name, fd);
        console.log(`[ReflectionClient] Parsed: ${fd.name}, messages: ${fd.messageType?.length || 0}, services: ${fd.service?.length || 0}`);
      } catch (e) {
        console.error('[ReflectionClient] Failed to parse FileDescriptorProto:', e);
      }
    }

    console.log(`[ReflectionClient] Total parsed: ${fileDescriptors.length} file descriptors`);

    // 建立 FileRegistry
    // 關鍵：createFileRegistry 要求檔案按拓撲順序排列（依賴項在前）
    if (fileDescriptors.length > 0) {
      // 將 WKT 加入 fileDescriptorMap（作為依賴解析用）
      for (const [name, wktFile] of WKT_FILES.entries()) {
        if (!fileDescriptorMap.has(name) && wktFile.proto) {
          fileDescriptorMap.set(name, wktFile.proto);
        }
      }

      // 拓撲排序：確保依賴項在被依賴項之前
      const sortedProtos = this._topologicalSort(fileDescriptorMap);
      console.log(`[ReflectionClient] Topologically sorted ${sortedProtos.length} protos`);

      let registry = null;
      try {
        const descriptorSet = create(FileDescriptorSetSchema, { file: sortedProtos });
        registry = createFileRegistry(descriptorSet);
        console.log(`[ReflectionClient] Registry created successfully with ${sortedProtos.length} descriptors`);
      } catch (e) {
        console.error('[ReflectionClient] Failed to create registry:', e.message);
        
        // Fallback: 使用 functional resolver 模式
        try {
          const resolver = (name) => WKT_FILES.get(name)?.proto || fileDescriptorMap.get(name);
          registry = createFileRegistry(fileDescriptors[0], resolver);
          console.log(`[ReflectionClient] Registry created via functional resolver fallback`);
        } catch (eFallback) {
          console.error('[ReflectionClient] All registry creation methods failed:', eFallback.message);
        }
      }

      if (registry) {
        result.registry = registry;
      }
    }

    // 從 registry 提取 services 和 messages（向後兼容格式）
    if (result.registry) {
      for (const desc of result.registry) {
        if (desc.kind === 'message') {
          // 將 DescMessage 轉換為舊格式
          result.messages[desc.typeName] = this._descMessageToLegacy(desc);
        } else if (desc.kind === 'service') {
          result.services.push(this._descServiceToLegacy(desc));
        }
      }
    } else {
      console.warn(`[ReflectionClient] Registry is null!`);
    }

    return result;
  }

  /**
   * 將 DescMessage 轉換為舊格式
   * @param {import('@bufbuild/protobuf').DescMessage} desc
   * @returns {object}
   */
  _descMessageToLegacy(desc) {
    return {
      name: desc.name,
      fullName: desc.typeName,
      fields: desc.fields.map(f => ({
        name: f.name,
        number: f.number,
        type: this._fieldKindToType(f),
        label: f.repeated ? 3 : f.proto.label || 1, // 3 = REPEATED
        type_name: f.message?.typeName || f.enum?.typeName || '',
      })),
      // 保留原始 desc 以便使用官方 API 解碼
      _desc: desc,
    };
  }

  /**
   * 將 Field 種類轉換為 type 數字
   * @param {import('@bufbuild/protobuf').DescField} f
   * @returns {number}
   */
  _fieldKindToType(f) {
    // 優先從原始 proto 定義取得類型 (FieldDescriptorSet)
    // 這是最底層的真實數據，不會因為庫的封裝而讀不到
    if (f.proto && typeof f.proto.type === 'number') {
      return f.proto.type;
    }

    // Fallback: 根據 kind 判定
    if (f.kind === 'message' || f.kind === 'map') return 11;
    if (f.kind === 'enum') return 14;
    if (f.kind === 'scalar') {
      return f.scalar || 9; // 最終預設 string(9)
    }
    return 9;
  }

  /**
   * 拓撲排序 FileDescriptorProto
   * 確保依賴項排在被依賴項之前
   * @param {Map<string, object>} fileMap - name -> FileDescriptorProto
   * @returns {object[]} - 排序後的 FileDescriptorProto 陣列
   */
  _topologicalSort(fileMap) {
    const sorted = [];
    const visited = new Set();
    const visiting = new Set(); // 用於偵測循環依賴

    const visit = (name) => {
      if (visited.has(name)) return;
      if (visiting.has(name)) {
        // 循環依賴，跳過避免無限遞迴
        console.warn(`[ReflectionClient] Circular dependency detected: ${name}`);
        return;
      }

      const fd = fileMap.get(name);
      if (!fd) {
        // 找不到依賴，可能是外部庫，跳過
        return;
      }

      visiting.add(name);

      // 先處理所有依賴
      for (const dep of fd.dependency || []) {
        visit(dep);
      }

      visiting.delete(name);
      visited.add(name);
      sorted.push(fd);
    };

    // 訪問所有檔案
    for (const name of fileMap.keys()) {
      visit(name);
    }

    return sorted;
  }

  /**
   * 將 DescService 轉換為舊格式
   * @param {import('@bufbuild/protobuf').DescService} desc
   * @returns {object}
   */
  _descServiceToLegacy(desc) {
    return {
      name: desc.name,
      fullName: desc.typeName,
      methods: desc.methods.map(m => ({
        name: m.name,
        requestType: m.input.typeName,
        responseType: m.output.typeName,
      })),
    };
  }

  /**
   * 列出伺服器上的所有服務
   * @param {string} serverUrl
   * @param {string} reflectionService
   * @returns {Promise<string[] | null>}
   */
  async listServices(serverUrl, reflectionService) {
    const url = `${serverUrl}/${reflectionService}/ServerReflectionInfo`;
    const host = new URL(serverUrl).host;

    // Encode: host = host (field 1), list_services = "" (field 7)
    const hostBytes = new TextEncoder().encode(host);
    const request = new Uint8Array(2 + hostBytes.length + 2);

    let offset = 0;
    request[offset++] = 0x0a; // field 1, wire type 2
    request[offset++] = hostBytes.length;
    request.set(hostBytes, offset);
    offset += hostBytes.length;

    request[offset++] = 0x3a; // field 7, wire type 2
    request[offset++] = 0x00; // length 0

    const responses = await sendGrpcWebRequest(url, request);
    if (!responses) return null;

    const services = [];
    for (const resp of responses) {
      services.push(...parseListServicesResponse(resp));
    }
    return services;
  }

  /**
   * 取得包含指定 symbol 的 FileDescriptor
   * @param {string} serverUrl
   * @param {string} reflectionService
   * @param {string} symbol - 完整的 service 或 message 名稱
   * @returns {Promise<Uint8Array[] | null>}
   */
  async getFileContainingSymbol(serverUrl, reflectionService, symbol) {
    const url = `${serverUrl}/${reflectionService}/ServerReflectionInfo`;
    const host = new URL(serverUrl).host;

    const hostBytes = new TextEncoder().encode(host);
    const symbolBytes = new TextEncoder().encode(symbol);

    const request = new Uint8Array(2 + hostBytes.length + 2 + symbolBytes.length);
    let offset = 0;

    request[offset++] = 0x0a; // field 1, wire type 2
    request[offset++] = hostBytes.length;
    request.set(hostBytes, offset);
    offset += hostBytes.length;

    request[offset++] = 0x22; // field 4, wire type 2
    request[offset++] = symbolBytes.length;
    request.set(symbolBytes, offset);

    const responses = await sendGrpcWebRequest(url, request);
    if (!responses) return null;

    const descriptors = [];
    for (const resp of responses) {
      descriptors.push(...(parseFileDescriptorResponse(resp) || []));
    }
    return descriptors.length > 0 ? descriptors : null;
  }

  /**
   * 透過檔名取得 FileDescriptor
   * @param {string} serverUrl
   * @param {string} reflectionService
   * @param {string} filename
   * @returns {Promise<Uint8Array[] | null>}
   */
  async getFileByFilename(serverUrl, reflectionService, filename) {
    const url = `${serverUrl}/${reflectionService}/ServerReflectionInfo`;
    const host = new URL(serverUrl).host;

    const hostBytes = new TextEncoder().encode(host);
    const filenameBytes = new TextEncoder().encode(filename);

    const request = new Uint8Array(2 + hostBytes.length + 2 + filenameBytes.length);
    let offset = 0;

    request[offset++] = 0x0a; // field 1, wire type 2
    request[offset++] = hostBytes.length;
    request.set(hostBytes, offset);
    offset += hostBytes.length;

    request[offset++] = 0x1a; // field 3, wire type 2
    request[offset++] = filenameBytes.length;
    request.set(filenameBytes, offset);

    const responses = await sendGrpcWebRequest(url, request);
    if (!responses) return null;

    const descriptors = [];
    for (const resp of responses) {
      descriptors.push(...(parseFileDescriptorResponse(resp) || []));
    }
    return descriptors.length > 0 ? descriptors : null;
  }
}

export default new ReflectionClient();
