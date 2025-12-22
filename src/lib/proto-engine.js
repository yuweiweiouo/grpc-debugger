/**
 * Proto Engine - 使用 @bufbuild/protobuf 官方庫進行動態解碼
 * 
 * 這個模組負責：
 * 1. 儲存從 Reflection API 取得的 FileRegistry
 * 2. 根據 method path 查找對應的 request/response types
 * 3. 使用官方 fromBinary 解碼 protobuf messages
 */

import { 
  createFileRegistry, 
  fromBinary 
} from '@bufbuild/protobuf';
import { 
  FileDescriptorSetSchema 
} from '@bufbuild/protobuf/wkt';

/**
 * ProtoEngine 類別 - 管理 protobuf schema 和解碼
 */
class ProtoEngine {
  constructor() {
    /** @type {import('@bufbuild/protobuf').FileRegistry | null} */
    this.registry = null;
    
    /** @type {Map<string, {serviceName: string, methodName: string, requestType: string, responseType: string}>} */
    this.serviceMap = new Map();
    
    /** @type {Map<string, object>} 向後兼容的 schemas - 儲存 message name 到 DescMessage 的映射 */
    this.schemas = new Map();
  }

  /**
   * 從 FileDescriptorSet 二進位資料註冊 schema
   * @param {Uint8Array} fileDescriptorSetBytes - FileDescriptorSet 二進位資料
   */
  registerFromBytes(fileDescriptorSetBytes) {
    try {
      // 使用官方 API 解析 FileDescriptorSet
      const fileDescriptorSet = fromBinary(FileDescriptorSetSchema, fileDescriptorSetBytes);
      
      // 從 FileDescriptorSet 建立 FileRegistry
      // @bufbuild/protobuf v2 正確用法：直接傳入 FileDescriptorSet message
      this.registry = createFileRegistry(fileDescriptorSet);
      
      // 遍歷 registry 建立 serviceMap 和向後兼容的 schemas
      for (const desc of this.registry) {
        if (desc.kind === 'message') {
          this.schemas.set(desc.typeName, desc);
        } else if (desc.kind === 'service') {
          for (const method of desc.methods) {
            // 標準路徑：/package.Service/Method
            const path = `/${desc.typeName}/${method.name}`;
            this.serviceMap.set(path, {
              serviceName: desc.typeName,
              methodName: method.name,
              requestType: method.input.typeName,
              responseType: method.output.typeName,
            });
          }
        }
      }
      
      console.log(`[ProtoEngine] Registered ${this.schemas.size} messages, ${this.serviceMap.size} methods`);
    } catch (e) {
      console.error('[ProtoEngine] Failed to register schema:', e);
    }
  }

  /**
   * 使用舊格式的 schema data 註冊（向後兼容）
   * 這個方法保留用於與現有 reflection-client.js 的兼容
   * @param {object} data - { services: [], messages: {} }
   */
  registerSchema(data) {
    if (data.messages) {
      for (const [fullName, def] of Object.entries(data.messages)) {
        const key = fullName.replace(/^\.+/, '');
        this.schemas.set(key, def);
      }
    }
    if (data.services) {
      for (const service of data.services) {
        for (const method of service.methods) {
          // 確保 serviceName 一致（移除前導點）
          const serviceName = service.fullName.replace(/^\.+/, '');
          const path = `/${serviceName}/${method.name}`;
          
          this.serviceMap.set(path, {
            serviceName: serviceName,
            methodName: method.name,
            requestType: method.requestType.replace(/^\.+/, ''),
            responseType: method.responseType.replace(/^\.+/, ''),
          });
        }
      }
    }
    console.log(`[ProtoEngine] registerSchema: schemas.size=${this.schemas.size}, serviceMap.size=${this.serviceMap.size}`);
  }

  /**
   * 根據路徑尋找方法資訊（支援模糊/後綴匹配）
   * @param {string} path - 請求路徑，例如 "/admin.AdminService/ListPost"
   * @returns {object | null}
   */
  findMethod(path) {
    if (!path) return null;

    // 1. 精確匹配
    if (this.serviceMap.has(path)) {
      return this.serviceMap.get(path);
    }

    // 2. 寬鬆匹配：嘗試後綴匹配 (對應簡寫路徑)
    // 例如 path="/admin.AdminService/ListPost"
    // 可能對應到 "/pan.general.admin.AdminService/ListPost"
    const pathLower = path.toLowerCase();
    
    for (const [registeredPath, info] of this.serviceMap) {
      // 如果註冊的路徑以請求的路徑結尾（且前驅字元是點或斜線），則認為匹配
      // 這裡簡單化：檢查註冊路徑是否以請求路徑結尾
      if (registeredPath.toLowerCase().endsWith(pathLower)) {
        return info;
      }
    }

    return null;
  }

  /**
   * 尋找 message 定義
   * @param {string} typeName
   * @returns {object | null}
   */
  findMessage(typeName) {
    if (!typeName) return null;
    
    const cleanName = typeName.replace(/^\.+/, '');
    
    // 如果有 registry，優先使用
    if (this.registry) {
      const desc = this.registry.getMessage(cleanName);
      if (desc) return desc;
    }
    
    // 向後兼容：使用舊的 schemas Map
    if (this.schemas.has(cleanName)) {
      return this.schemas.get(cleanName);
    }
    
    // 模糊匹配
    for (const [key, msg] of this.schemas) {
      if (key.endsWith(`.${cleanName}`) || key === cleanName) {
        return msg;
      }
    }
    
    return null;
  }

  /**
   * 解碼 protobuf message
   * @param {string | null} typeName - 完整的 message type name
   * @param {Uint8Array} buffer - protobuf 二進位資料
   * @returns {object} 解碼後的 JavaScript 物件
   */
  decodeMessage(typeName, buffer) {
    if (!buffer || buffer.length === 0) {
      return {};
    }

    const schema = this.findMessage(typeName);
    
    // 優先使用 schema._desc（官方 DescMessage）
    const descMessage = schema?._desc || (schema?.kind === 'message' ? schema : null);
    
    if (descMessage && descMessage.kind === 'message') {
      try {
        const message = fromBinary(descMessage, buffer);
        return this._messageToObject(message, descMessage);
      } catch (e) {
        console.error(`[ProtoEngine] Decode failed for ${typeName}: ${e.message}`);
        return { _error: `Decode failed: ${e.message}`, _typeName: typeName };
      }
    }
    
    // 找不到 schema，返回錯誤訊息
    if (!typeName) {
      return { _error: 'No type name provided', _rawLength: buffer.length };
    }
    return { _error: `Schema not found for: ${typeName}`, _rawLength: buffer.length };
  }

  /**
   * 將 @bufbuild/protobuf Message 轉換為普通 JavaScript 物件
   * @param {object} message - fromBinary 解碼的 Message
   * @param {import('@bufbuild/protobuf').DescMessage} schema - DescMessage
   * @returns {object}
   */
  _messageToObject(message, schema) {
    const result = {
      $typeName: schema.typeName, // 保留類型資訊供 UI 顯示標籤，但不顯示為 key
    };
    
    for (const field of schema.fields) {
      // 使用 localName 存取欄位值
      const value = message[field.localName];
      
      // 跳過 undefined 值
      if (value === undefined || value === null) continue;
      
      // 根據欄位類型處理
      switch (field.kind) {
        case 'message':
          if (field.repeated) {
            result[field.name] = Array.isArray(value) 
              ? value.map(v => v ? this._messageToObject(v, field.message) : null)
              : [];
          } else if (value) {
            result[field.name] = this._messageToObject(value, field.message);
          }
          break;
          
        case 'map':
          result[field.name] = {};
          if (value instanceof Map) {
            for (const [k, v] of value) {
              if (field.mapValue.kind === 'message') {
                result[field.name][k] = this._messageToObject(v, field.mapValue.message);
              } else {
                result[field.name][k] = this._convertValue(v);
              }
            }
          }
          break;
          
        case 'enum':
          // 預設傳回 enum 的數值，或是可以根據 field.enum 轉換為名稱
          result[field.name] = this._convertValue(value);
          break;
          
        case 'scalar':
        default:
          if (field.repeated) {
            result[field.name] = Array.isArray(value)
              ? value.map(v => this._convertValue(v))
              : [];
          } else {
            result[field.name] = this._convertValue(value);
          }
          break;
      }
    }
    
    return result;
  }

  /**
   * 轉換特殊值（如 BigInt）
   */
  _convertValue(value) {
    if (typeof value === 'bigint') {
      // 安全轉換 BigInt 為 number 或 string
      if (value <= Number.MAX_SAFE_INTEGER && value >= Number.MIN_SAFE_INTEGER) {
        return Number(value);
      }
      return value.toString();
    }
    return value;
  }

}

// 導出單例
export const protoEngine = new ProtoEngine();
export default protoEngine;

