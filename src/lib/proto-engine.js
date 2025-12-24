/**
 * Proto Engine - 基於 @bufbuild/protobuf 官方庫的動態編解碼引擎
 * 
 * 此核心模組是整個 Debugger 的「大腦」，負責處理：
 * 1. 儲存與組合從 Reflection API 取得的 Protobuf 描述符 (FileRegistry)。
 * 2. 建立方法路徑 (/package.Service/Method) 與具體類型定義之間的對應。
 * 3. 動態地將二進位 Protobuf 資料轉換為易懂的 JavaScript JSON 物件，並處理各類特殊情況。
 */

import { 
  createFileRegistry, 
  fromBinary,
  toBinary,
  create
} from '@bufbuild/protobuf';
import { 
  FileDescriptorSetSchema 
} from '@bufbuild/protobuf/wkt';

/**
 * ProtoEngine 類別：管理全域 Protobuf Schema 定義與訊息轉換邏輯
 */
class ProtoEngine {
  constructor() {
    /** 
     * @type {import('@bufbuild/protobuf').FileRegistry | null} 
     * 官方 Registry 物件，用於查找訊息 (Message) 與服務 (Service) 定義。
     */
    this.registry = null;
    
    /** 
     * 方法對應表
     * Key: "/package.Service/Method"
     * Value: 具備 Service、Method 及 Request/Response 類型名稱的資訊。
     * @type {Map<string, {serviceName: string, methodName: string, requestType: string, responseType: string}>} 
     */
    this.serviceMap = new Map();
    
    /** 
     * 訊息定義映射表 (向後兼容用)
     * 儲存 TypeName 到 DescMessage 的映射，確保即便 Registry 未完全就緒也能進行基本查詢。
     * @type {Map<string, object>} 
     */
    this.schemas = new Map();
  }

  /**
   * 註冊 Schema：從 FileDescriptorSet 二進位資料載入
   * FileDescriptorSet 是一組編譯後的 .proto 檔案定義，Reflection API 會回傳此格式。
   * 
   * @param {Uint8Array} fileDescriptorSetBytes FileDescriptorSet 的原始二進位字節
   */
  registerFromBytes(fileDescriptorSetBytes) {
    try {
      // 1. 使用官方 Schema 定義解析接收到的二進位資料
      const fileDescriptorSet = fromBinary(FileDescriptorSetSchema, fileDescriptorSetBytes);
      
      // 2. 建立官方註冊表物件。此物件允許我們透過名稱動態查詢定義。
      this.registry = createFileRegistry(fileDescriptorSet);
      
      // 3. 掃描所有載入的定義，建立內部的索引以便快速查核
      for (const desc of this.registry) {
        if (desc.kind === 'message') {
          // 儲存訊息類型定義
          this.schemas.set(desc.typeName, desc);
        } else if (desc.kind === 'service') {
          // 遍歷服務中的所有方法，建立路徑索引 (為了匹配 Network 請求中的 URL)
          for (const method of desc.methods) {
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
      
      console.log(`[ProtoEngine] 成功註冊：${this.schemas.size} 個訊息，${this.serviceMap.size} 個方法`);
    } catch (e) {
      console.error('[ProtoEngine] Schema 註冊失敗:', e);
    }
  }

  /**
   * 註冊 Schema (向後兼容模式)
   * 用於銜接舊版實現或外部匯入的結構定義物件。
   * @param {object} data 包含 services 與 messages 的結構化物件
   */
  registerSchema(data) {
    // 關鍵：如果有 registry 則直接儲存，這是從 Reflection 來的官方註冊表
    if (data.registry) {
      this.registry = data.registry;
    }

    // 處理訊息定義
    if (data.messages) {
      for (const [fullName, def] of Object.entries(data.messages)) {
        const key = fullName.replace(/^\.+/, '');
        this.schemas.set(key, def);
      }
    }
    // 處理服務與方法定義
    if (data.services) {
      for (const service of data.services) {
        for (const method of service.methods) {
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
    console.log(`[ProtoEngine] Schema 註冊完成，共計 ${this.schemas.size} 訊息，${this.serviceMap.size} 方法，Registry: ${!!this.registry}`);
  }

  /**
   * 根據 URL 路徑尋找對應的 gRPC 方法資訊
   * 支援「完全精確匹配」與「自動後綴匹配」(處理忽略包名等情況)。
   * 
   * @param {string} path 請求路徑，例如 "/myapp.Greeter/SayHello"
   * @returns {object | null} 包含方法定義的資訊物件
   */
  findMethod(path) {
    if (!path) return null;

    // 1. 完全匹配
    if (this.serviceMap.has(path)) {
      return this.serviceMap.get(path);
    }

    // 2. 寬鬆匹配：當開發者使用了簡寫或是代理軟體截斷了完整包名時極其受用
    const pathLower = path.toLowerCase();
    for (const [registeredPath, info] of this.serviceMap) {
      if (registeredPath.toLowerCase().endsWith(pathLower)) {
        return info;
      }
    }

    return null;
  }

  /**
   * 查找具體的 Message 描述符 (Descriptor)
   * 這是解碼二進位數據的前提。
   * 
   * @param {string} typeName 完整的類型名稱 (例如 "google.protobuf.Any")
   * @returns {object | null} 返回 legacy 格式的物件（包含 fields 陣列）
   */
  findMessage(typeName) {
    if (!typeName) return null;
    
    // 移除開頭的點（這是 Protobuf 名稱系統的標準化步驟）
    const cleanName = typeName.replace(/^\.+/, '');
    
    let desc = null;
    
    // 優先從官方 Registry 中獲取，這是最準確的來源
    if (this.registry) {
      desc = this.registry.getMessage(cleanName);
    }
    
    // 備援方案：從緩存的 schemas Map 中尋找
    if (!desc && this.schemas.has(cleanName)) {
      desc = this.schemas.get(cleanName);
    }
    
    // 後綴匹配備援（處理部分導入類型的命名差異）
    if (!desc) {
      for (const [key, msg] of this.schemas) {
        if (key.endsWith(`.${cleanName}`) || key === cleanName) {
          desc = msg;
          break;
        }
      }
    }
    
    if (!desc) return null;
    
    // 如果是 @bufbuild/protobuf 的 DescMessage，轉換為 legacy 格式
    if (desc.kind === 'message' && Array.isArray(desc.fields)) {
      return this._toLegacyFormat(desc);
    }
    
    // 已經是 legacy 格式或其他格式，直接返回
    return desc;
  }

  /**
   * 將 @bufbuild/protobuf 的 DescMessage 轉換為 UI 使用的 legacy 格式
   * @param {object} desc DescMessage
   * @returns {object} legacy 格式物件
   */
  _toLegacyFormat(desc) {
    const legacyFields = desc.fields.map(f => {
      const typeName = this._extractFieldTypeName(f);
      return {
        name: f.name,
        number: f.number,
        type: this._fieldKindToType(f),
        kind: f.kind,
        repeated: f.repeated,
        label: f.repeated ? 3 : (f.proto?.label || 1),
        type_name: typeName,
        // 保留原始欄位以便深層查詢
        _original: f
      };
    });
    
    return {
      name: desc.name,
      fullName: desc.typeName,
      fields: legacyFields,
      _desc: desc,
    };
  }

  /**
   * 從欄位描述符提取類型名稱
   * @param {object} f 欄位描述符
   * @returns {string} 類型名稱
   */
  _extractFieldTypeName(f) {
    // @bufbuild/protobuf v2: message/enum 欄位
    if (f.message?.typeName) return f.message.typeName;
    if (f.enum?.typeName) return f.enum.typeName;
    
    // Map 類型
    if (f.kind === 'map' && f.mapValue) {
      if (f.mapValue.message?.typeName) return f.mapValue.message.typeName;
      if (f.mapValue.enum?.typeName) return f.mapValue.enum.typeName;
    }
    
    // 從 proto 原始資料中提取
    if (f.proto?.typeName) {
      return f.proto.typeName.replace(/^\./, '');
    }
    
    return '';
  }

  /**
   * 將欄位 kind 轉換為 Protobuf 類型數字
   */
  _fieldKindToType(f) {
    // 優先從 proto 原始資料中提取
    if (f.proto && typeof f.proto.type === 'number') {
      return f.proto.type;
    }
    
    // 根據 kind 推斷
    const kindMap = {
      'message': 11,
      'enum': 14,
      'map': 11,
    };
    
    if (kindMap[f.kind]) return kindMap[f.kind];
    
    // scalar 類型
    if (f.kind === 'scalar' && typeof f.scalar === 'number') {
      return f.scalar;
    }
    
    return 9; // 預設 string
  }

  /**
   * 編碼 JSON 物件為 Protobuf 二進位格式
   * 用於 Playground 發送 RPC 請求
   * 
   * @param {string} typeName 訊息類型名稱
   * @param {object} jsonData JSON 格式的請求資料
   * @returns {Uint8Array | null} 編碼後的二進位資料
   */
  encodeMessage(typeName, jsonData) {
    if (!typeName || !jsonData) return null;

    const schema = this.findMessage(typeName);
    // 優先使用 registry 中的描述符，否則使用 _desc 屬性（從 Reflection 轉換後的 legacy 物件）
    const descMessage = schema?.kind === 'message' ? schema : schema?._desc;

    if (!descMessage) {
      const availableKeys = Array.from(this.schemas.keys()).slice(0, 20);
      console.error(`[ProtoEngine] 找不到編碼用的 Schema: ${typeName}`);
      console.error(`[ProtoEngine] 可用的 Schemas (前20個): ${availableKeys.join(', ')}`);
      console.error(`[ProtoEngine] Registry 存在: ${!!this.registry}`);
      return null;
    }

    try {
      const message = create(descMessage, this._jsonToProto(jsonData, descMessage));
      return toBinary(descMessage, message);
    } catch (e) {
      console.error(`[ProtoEngine] 編碼失敗:`, e);
      return null;
    }
  }

  /**
   * 獲取訊息類型的 JSON 模板 (用於 Playground)
   * 
   * @param {string} typeName 訊息類型名稱
   * @returns {object | null} 訊息的初始 JSON 結構
   */
  getMessageTemplate(typeName) {
    if (!typeName) return null;

    const schema = this.findMessage(typeName);
    const descMessage = schema?.kind === 'message' ? schema : schema?._desc;

    if (!descMessage) {
      console.error(`[ProtoEngine] 找不到 Template 用的 Schema: ${typeName}`);
      return null;
    }

    try {
      // 建立預設訊息物件
      const message = create(descMessage);
      // 轉換為純 JS 物件
      return this._messageToObject(message, descMessage);
    } catch (e) {
      console.error(`[ProtoEngine] 產生模板失敗:`, e);
      return null;
    }
  }

  /**
   * 將 JSON 物件轉換為 Protobuf 相容格式
   * 處理 BigInt 字串等特殊情況
   */
  _jsonToProto(json, desc) {
    if (json === null || json === undefined) return json;
    if (typeof json !== 'object') return json;
    if (Array.isArray(json)) {
      return json.map(item => this._jsonToProto(item, desc));
    }

    const result = {};
    for (const [key, value] of Object.entries(json)) {
      if (key === '$typeName') continue;
      result[key] = this._jsonToProto(value, desc);
    }
    return result;
  }

  /**
   * 動態解碼 Protobuf 訊息
   * 將原始字節流透過指定的 schema 轉換為 JS 物件。
   * 
   * @param {string | null} typeName 訊息類型名稱
   * @param {Uint8Array} buffer 原始二進位數據
   * @returns {object} 解碼後的 JavaScript 物件。發生錯誤時會回傳帶有 _error 標記的物件。
   */
  decodeMessage(typeName, buffer) {
    if (!buffer || buffer.length === 0) {
      return {};
    }

    const schema = this.findMessage(typeName);
    
    // 確定是否能使用官方 API。官方 v2 庫要求使用 DescMessage 物件。
    const descMessage = schema?._desc || (schema?.kind === 'message' ? schema : null);
    
    if (descMessage && descMessage.kind === 'message') {
      try {
        // 使用從 registry 獲得的描述符進行解碼
        const message = fromBinary(descMessage, buffer);
        // 將官方的 Message 物件轉換為純 JS 物件（處理 BigInt 等相容性問題）
        return this._messageToObject(message, descMessage);
      } catch (e) {
        // 錯誤排查：處理 HAR 編碼損壞的問題
        // 許多瀏覽器開發者工具導出的 HAR 檔案會錯誤地將 binary 視為 UTF-8，導致數據損毀
        const isEncodingCorruption = e.message.includes('wire type') || 
                                      e.message.includes('invalid');
        
        if (isEncodingCorruption) {
          const rawText = this._tryExtractReadableText(buffer);
          return {
            _error: '二進位數據損毀 (可能是 HAR 編碼問題)',
            _hint: '請求內容包含無法被 UTF-8 正確讀取的非 ASCII 位元組，這通常發生在抓包存檔時',
            _typeName: typeName,
            _rawText: rawText,
          };
        }
        
        console.error(`[ProtoEngine] 解碼失敗 (${typeName}): ${e.message}`);
        return { _error: `解碼失敗: ${e.message}`, _typeName: typeName };
      }
    }
    
    // 無法找到對應 schema 時的處理
    if (!typeName) {
      return { _error: '未提供類型名稱', _rawLength: buffer.length };
    }
    return { _error: `找不到 Schema 定義: ${typeName}`, _rawLength: buffer.length };
  }

  /**
   * 異常處理：嘗試從損壞的訊息中提取人類可讀的內容
   * 當 Schema 不匹配或編碼錯誤時，儘量讓使用者看到一點有用的東西。
   */
  _tryExtractReadableText(buffer) {
    try {
      const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
      // 偵測 UUID 等常見模式
      const uuids = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi);
      if (uuids && uuids.length > 0) {
        return `偵測到疑似 UUID: ${uuids.slice(0, 3).join(', ')}`;
      }
      // 過濾出僅存的可見字元
      const printable = text.replace(/[^\x20-\x7E]/g, '').trim();
      return printable.length > 10 ? printable.slice(0, 100) + '...' : null;
    } catch {
      return null;
    }
  }

  /**
   * 深層轉換：將官方 Message 物件轉為純 JSON 物件
   * 具體包含以下特殊處理：
   * - 加上 $typeName 隱藏欄位供 UI 識別。
   * - 處理重複欄位 (Repeated)。
   * - 處理對應表 (Map)。
   * - 處理大整數 (BigInt) 轉字串，防止 JSON.stringify 崩潰。
   * 
   * @param {object} message 解碼後的 Message 物件
   * @param {import('@bufbuild/protobuf').DescMessage} schema 對應的定義描述符
   */
  _messageToObject(message, schema) {
    const result = {
      $typeName: schema.typeName, // 元數據：用於 UI 顯示類別標籤
    };
    
    for (const field of schema.fields) {
      // 透過官方定義的 localName 穩定存取 JS 欄位
      const value = message[field.localName];
      
      if (value === undefined || value === null) continue;
      
      switch (field.kind) {
        case 'message': // 處理巢狀訊息
          if (field.repeated) {
            result[field.name] = Array.isArray(value) 
              ? value.map(v => v ? this._messageToObject(v, field.message) : null)
              : [];
          } else if (value) {
            result[field.name] = this._messageToObject(value, field.message);
          }
          break;
          
        case 'map': // 處理映射表
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
          
        case 'enum': // 處理枚舉
          result[field.name] = this._convertValue(value);
          break;
          
        case 'scalar':
        default: // 處理普通純量
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
   * 數值修正：確保大整數可以傳遞給前端
   * JavaScript 中的 number 精度限制為 2^53-1。超過此值的 BigInt 必須轉為字串。
   */
  _convertValue(value) {
    if (typeof value === 'bigint') {
      if (value <= Number.MAX_SAFE_INTEGER && value >= Number.MIN_SAFE_INTEGER) {
        return Number(value); // 安全範圍內轉回 number
      }
      return value.toString(); // 超限轉為字串
    }
    return value;
  }
}

// 匯出單例：保證整個應用共用同一個 Schema 註冊表
export const protoEngine = new ProtoEngine();
export default protoEngine;

