/**
 * gRPC Reflection Client (gRPC 反射客戶端)
 * 
 * 此模組是連結 Debugger 與後端服務的橋樑。其核心職責是透過 gRPC Server Reflection 協定，
 * 動態地從執行中的伺服器端獲取所有的服務定義（Service Definitions），而無需預先擁有 .proto 檔案。
 * 
 * 流程包含：
 * 1. 查詢可用的服務列表 (ListServices)。
 * 2. 根據服務名稱遞迴獲取所有的 FileDescriptorProto (包含依賴項)。
 * 3. 處理 Google Well-Known Types (WKT) 的補完。
 * 4. 對取得的描述符進行「拓撲排序」，以滿足 @bufbuild/protobuf 建立 Registry 的嚴格順序要求。
 * 5. 將結果轉換為 proto-engine 可理解的格式。
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
 * Well-known types (WKT) 映射表
 * 當使用者的服務依賴於 Google 官方提供的通達類型 (如 Timestamp) 時，
 * 若伺服器未回傳對應的 .proto 定義，我們會從此預設庫中補全。
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
 * 支援的反射服務路徑
 * v1 是目前的主流標準，v1alpha 則是較舊的過渡版本。
 */
const REFLECTION_SERVICES = [
  'grpc.reflection.v1.ServerReflection',
  'grpc.reflection.v1alpha.ServerReflection',
];

class ReflectionClient {
  constructor() {
    /** @type {Map<string, object>} 用於快取不同伺服器的反射結果 */
    this.cache = new Map();
  }

  /**
   * 主入口：從指定伺服器抓取所有 Proto 定義
   * 
   * @param {string} serverUrl gRPC 伺服器的基礎 URL (例如 http://localhost:8080)
   * @returns {Promise<{services: object[], messages: object, registry: object} | null>}
   */
  async fetchFromServer(serverUrl) {
    logger.info('正在嘗試連接反射服務於:', serverUrl);

    // 依序嘗試不同的反射版本
    for (const reflectionService of REFLECTION_SERVICES) {
      try {
        // 第一階段：獲取服務清單
        const services = await this.listServices(serverUrl, reflectionService);
        if (!services || services.length === 0) continue;

        logger.info('找到服務:', services);

        // 第二階段：深度探查與收集 FileDescriptor
        const allDescriptorBytes = []; // 儲存所有收集到的原始二進位定義
        const loadedFiles = new Set();  // 防止重複載入相同路徑的檔案

        /**
         * 遞迴載入函數：處理單個描述符及其所有依賴項
         */
        const loadFileDescriptors = async (descriptorBytes) => {
          if (!descriptorBytes) return;

          for (const bytes of descriptorBytes) {
            let descriptor;
            try {
              // 解析二進位流為結構化的描述符物件
              descriptor = fromBinary(FileDescriptorProtoSchema, bytes);
            } catch (e) {
              logger.warn('無法解析 FileDescriptorProto:', e.message);
              continue;
            }

            if (loadedFiles.has(descriptor.name)) continue;
            loadedFiles.add(descriptor.name);
            
            allDescriptorBytes.push(bytes);

            // 處理依賴項 (import "...")
            for (const depName of descriptor.dependency || []) {
              if (loadedFiles.has(depName)) continue;

              try {
                // 向伺服器請求依賴檔案的定義
                const depDescriptorBytes = await this.getFileByFilename(
                  serverUrl,
                  reflectionService,
                  depName
                );
                if (depDescriptorBytes) {
                  await loadFileDescriptors(depDescriptorBytes);
                }
              } catch (e) {
                logger.debug(`無法載入依賴檔: ${depName}`);
                // 注意：如果依賴的是 Google WKT，後面會有補全機制，故此處失敗不一定導致整體失敗
              }
            }
          }
        };

        // 為每個發現的服務抓取完整的符號定義
        for (const serviceName of services) {
          // 跳過反射服務自身
          if (serviceName.includes('grpc.reflection')) continue;

          try {
            const fileDescriptor = await this.getFileContainingSymbol(
              serverUrl,
              reflectionService,
              serviceName
            );
            await loadFileDescriptors(fileDescriptor);
          } catch (e) {
            console.error(`無法獲取符號 ${serviceName} 的定義:`, e);
          }
        }

        if (allDescriptorBytes.length > 0) {
          // 第三階段：建構全域註冊表
          const result = this._buildRegistryFromBytes(allDescriptorBytes);
          return result;
        }
      } catch (e) {
        console.error(`反射版本 ${reflectionService} 執行時發生錯誤:`, e);
      }
    }

    return null;
  }

  /**
   * 內部核心：從蒐集到的位元組建構 Registry
   * @bufbuild/protobuf 的註冊表非常嚴格，依賴項必須在被依賴項之前註冊。
   */
  _buildRegistryFromBytes(descriptorBytesList) {
    const result = {
      services: [],
      messages: {},
      registry: null,
    };

    const fileDescriptors = [];
    const fileDescriptorMap = new Map(); // 用於拓撲排序的快照映射表
    
    // 解析所有物件並存入地圖
    for (const bytes of descriptorBytesList) {
      try {
        const fd = fromBinary(FileDescriptorProtoSchema, bytes);
        fileDescriptors.push(fd);
        fileDescriptorMap.set(fd.name, fd);
      } catch (e) {
        console.error('FileDescriptorProto 解析損毀:', e);
      }
    }

    if (fileDescriptors.length > 0) {
      // 關鍵步驟 1：加入預設的 Google WKT 定義，補齊伺服器可能漏傳的「公共組件」
      for (const [name, wktFile] of WKT_FILES.entries()) {
        if (!fileDescriptorMap.has(name) && wktFile.proto) {
          fileDescriptorMap.set(name, wktFile.proto);
        }
      }

      // 關鍵步驟 2：拓撲排序 (Topological Sort)
      // 這確保了例如 'common.proto' 一定會排在 'user.proto' (若 user 引用了 common) 之前
      const sortedProtos = this._topologicalSort(fileDescriptorMap);

      let registry = null;
      try {
        // 嘗試建構正式的 FileDescriptorSet
        const descriptorSet = create(FileDescriptorSetSchema, { file: sortedProtos });
        registry = createFileRegistry(descriptorSet);
      } catch (e) {
        console.error('註冊表建構失敗 (傳統模式):', e.message);
        
        // 備援方案：使用 functional resolver，由 SDK 動態按需解析依賴
        try {
          const resolver = (name) => WKT_FILES.get(name)?.proto || fileDescriptorMap.get(name);
          registry = createFileRegistry(fileDescriptors[0], resolver);
        } catch (eFallback) {
          console.error('註冊表所有建構方法均告失敗:', eFallback.message);
        }
      }

      if (registry) {
        result.registry = registry;
        
        // 第四階段：轉換為向後兼容的 Legacy 格式供舊版 UI/Engine 使用
        for (const desc of registry) {
          if (desc.kind === 'message') {
            result.messages[desc.typeName] = this._descMessageToLegacy(desc);
          } else if (desc.kind === 'service') {
            result.services.push(this._descServiceToLegacy(desc));
          }
        }
      }
    }

    return result;
  }

  /**
   * 將現代格式轉換為傳統結構
   * Debugger 的 UI 層有些部分仍依賴舊式的 fullName 與 fields 陣列結構。
   */
  _descMessageToLegacy(desc) {
    return {
      name: desc.name,
      fullName: desc.typeName,
      fields: desc.fields.map(f => ({
        name: f.name,
        number: f.number,
        type: this._fieldKindToType(f),
        label: f.repeated ? 3 : f.proto.label || 1, // 3 代表 REPEATED, 1 代表 OPTIONAL/REQUIRED
        type_name: f.message?.typeName || f.enum?.typeName || '',
      })),
      _desc: desc, // 將原始描述符塞入隠藏欄位，供 Engine 調用官方 decode 邏輯
    };
  }

  /**
   * 類型映射轉換
   * 將 SDK 的枚舉或描述符類型轉回 Protobuf 標準數值 1-18。
   */
  _fieldKindToType(f) {
    // 優先從原始 proto 資料中提取真實類型
    if (f.proto && typeof f.proto.type === 'number') {
      return f.proto.type;
    }
    // 備援邏輯：根據 kind 推斷
    if (f.kind === 'message' || f.kind === 'map') return 11; // TYPE_MESSAGE
    if (f.kind === 'enum') return 14;                        // TYPE_ENUM
    if (f.kind === 'scalar') {
      return f.scalar || 9; // 預設為 TYPE_STRING
    }
    return 9;
  }

  /**
   * DFS 拓撲排序實現
   * 對於複雜的 .proto 依賴圖，這是確保註冊不報錯的唯一方式。
   */
  _topologicalSort(fileMap) {
    const sorted = [];
    const visited = new Set();
    const visiting = new Set(); // 用於循環依賴偵測

    const visit = (name) => {
      if (visited.has(name)) return;
      if (visiting.has(name)) {
        logger.warn(`偵測到循環依賴: ${name}，已略過以防止無窮遞迴`);
        return;
      }

      const fd = fileMap.get(name);
      if (!fd) return;

      visiting.add(name);
      for (const dep of fd.dependency || []) {
        visit(dep);
      }
      visiting.delete(name);
      
      visited.add(name);
      sorted.push(fd);
    };

    for (const name of fileMap.keys()) {
      visit(name);
    }

    return sorted;
  }

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
   * 實現與 ServerReflectionInfo 的手動通訊 (ListServices)
   * 由於 Reflection 是基於 gRPC Stream 但我們在 Web 端是 Request-Response 模型，
   * 我們必須人工封裝 ReflectionRequest 並解析 Data Frames。
   */
  async listServices(serverUrl, reflectionService) {
    const url = `${serverUrl}/${reflectionService}/ServerReflectionInfo`;
    const host = new URL(serverUrl).host;

    // 手動構建 ReflectionRequest (field 1 is host, field 7 is list_services)
    const hostBytes = new TextEncoder().encode(host);
    const request = new Uint8Array(2 + hostBytes.length + 2);

    let offset = 0;
    request[offset++] = 0x0a; // field 1, wire type 2 (bytes/string)
    request[offset++] = hostBytes.length;
    request.set(hostBytes, offset);
    offset += hostBytes.length;

    request[offset++] = 0x3a; // field 7, wire type 2
    request[offset++] = 0x00; // length 0 (表示空的 list_services 操作)

    const responses = await sendGrpcWebRequest(url, request);
    if (!responses) return null;

    const services = [];
    for (const resp of responses) {
      services.push(...parseListServicesResponse(resp));
    }
    return services;
  }

  /**
   * 手動封裝：透過符號查詢 FileDescriptor (getFileContainingSymbol)
   */
  async getFileContainingSymbol(serverUrl, reflectionService, symbol) {
    const url = `${serverUrl}/${reflectionService}/ServerReflectionInfo`;
    const host = new URL(serverUrl).host;

    const hostBytes = new TextEncoder().encode(host);
    const symbolBytes = new TextEncoder().encode(symbol);

    const request = new Uint8Array(2 + hostBytes.length + 2 + symbolBytes.length);
    let offset = 0;

    request[offset++] = 0x0a; // field 1
    request[offset++] = hostBytes.length;
    request.set(hostBytes, offset);
    offset += hostBytes.length;

    request[offset++] = 0x22; // field 4, wire type 2 (file_containing_symbol)
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
   * 手動封裝：透過檔名查詢 FileDescriptor (getFileByFilename)
   */
  async getFileByFilename(serverUrl, reflectionService, filename) {
    const url = `${serverUrl}/${reflectionService}/ServerReflectionInfo`;
    const host = new URL(serverUrl).host;

    const hostBytes = new TextEncoder().encode(host);
    const filenameBytes = new TextEncoder().encode(filename);

    const request = new Uint8Array(2 + hostBytes.length + 2 + filenameBytes.length);
    let offset = 0;

    request[offset++] = 0x0a; // field 1
    request[offset++] = hostBytes.length;
    request.set(hostBytes, offset);
    offset += hostBytes.length;

    request[offset++] = 0x1a; // field 3, wire type 2 (file_by_filename)
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

