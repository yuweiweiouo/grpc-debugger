/**
 * Protobuf Descriptor Parser
 * 負責解析 gRPC Reflection API 回應與 FileDescriptorProto 二進位格式。
 * 由於 Reflection API 回傳的是原始的 Protobuf 二進位資料，我們需要解析這些二進位流以提取服務和訊息定義。
 */

import { createLogger } from './logger.js';

const logger = createLogger('DescParser');

// ============================================================================
// 底層 Protobuf 解析工具 (Low-Level Protobuf Parsing Utilities)
// 這些函式用於手動解析 Protobuf 傳輸格式 (Wire Format)
// ============================================================================

/**
 * 讀取 Tag（包含欄位編號 Field Number 與電傳類型 Wire Type）
 * Protobuf 每個欄位開頭都是一個 Varint 編碼的 Tag。
 * Tag 的低 3 位元是 Wire Type，其餘位元是 Field Number。
 * 
 * @param {Uint8Array} data 原始字節數據
 * @param {number} pos 起始偏移量
 * @returns {[number, number, number]} [fieldNum, wireType, newPos] 傳回欄位編號、類型與更新後的位置
 */
export function readTag(data, pos) {
  const [tag, newPos] = readVarint(data, pos);
  return [tag >> 3, tag & 0x7, newPos];
}

/**
 * 讀取 Varint (Variable-length Quantity)
 * Varint 是 Protobuf 核心編碼方式，使用一個或多個位元組表示整數。
 * 每個位元組的最高位 (MSB) 為 1 表示後續還有位元組，為 0 表示結束。
 * 
 * @param {Uint8Array} data 原始字節數據
 * @param {number} pos 起始偏移量
 * @returns {[number, number]} [value, newPos] 傳回解碼後的數值與更新後的位置
 */
export function readVarint(data, pos) {
  let result = 0;
  let shift = 0;

  while (pos < data.length) {
    const byte = data[pos++];
    // 取低 7 位元並左移到正確位置併入結果
    result |= (byte & 0x7f) << shift;
    // 如果最高位為 0，則表示這是最後一個位元組
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }

  return [result >>> 0, pos];
}

/**
 * 讀取長度界定 (Length-Delimited) 欄位
 * 用於解碼字串 (string)、字節 (bytes) 或巢狀訊息 (embedded messages)。
 * 格式為：[長度(Varint)] [內容(bytes)]
 * 
 * @param {Uint8Array} data 原始字節數據
 * @param {number} pos 起始偏移量
 * @returns {[Uint8Array, number]} [fieldData, newPos] 傳回欄位數據片段與更新後的位置
 */
export function readLengthDelimited(data, pos) {
  const [length, newPos] = readVarint(data, pos);
  return [data.slice(newPos, newPos + length), newPos + length];
}

/**
 * 跳過不需要或尚未實作的欄位
 * 在手動解析時，若遇到不需要的欄位編號，需根據其 Wire Type 正確跳過。
 * 
 * @param {Uint8Array} data 原始字節數據
 * @param {number} pos 當前偏移量
 * @param {number} wireType 欄位的電傳類型
 * @returns {number} newPos 更新後的偏移量
 */
export function skipField(data, pos, wireType) {
  switch (wireType) {
    case 0: // Varint：持續讀取直到 MSB 為 0
      while (pos < data.length && (data[pos] & 0x80) !== 0) pos++;
      return pos + 1;
    case 2: { // Length-delimited：先讀取長度，再跳過該長度的內容
      const [length, newPos] = readVarint(data, pos);
      return newPos + length;
    }
    case 5: // 32-bit：固定 4 位元組
      return pos + 4;
    case 1: // 64-bit：固定 8 位元組
      return pos + 8;
    default:
      return pos;
  }
}

// ============================================================================
// 反射 API 回應解析器 (Reflection API Response Parsers)
// 專門解析 ServerReflection 回傳的各種 Response 訊息
// ============================================================================

/**
 * 解析 ListServicesResponse
 * 當呼叫 Reflection API 的 list_services 時，會收到包含所有可用服務名稱的回應。
 * 
 * @param {Uint8Array} data 封裝在 ReflectionResponse 中的二進位資料
 * @returns {string[]} 服務名稱列表 (例如: ["grpc.reflection.v1.ServerReflection", "myapp.Greeter"])
 */
export function parseListServicesResponse(data) {
  const services = [];
  let pos = 0;

  while (pos < data.length) {
    const [fieldNum, wireType, newPos] = readTag(data, pos);
    pos = newPos;

    if (wireType === 2) {
      const [fieldData, nextPos] = readLengthDelimited(data, pos);
      pos = nextPos;

      // field 6: list_services_response
      if (fieldNum === 6) {
        services.push(...parseListServicesResponseField(fieldData));
      } 
      // field 7: error_response
      else if (fieldNum === 7) {
        logErrorResponse(fieldData);
      }
    } else {
      pos = skipField(data, pos, wireType);
    }
  }

  return services;
}

/**
 * 解析 ListServicesResponse 內部的 service 重複欄位
 * 內部結構包含一系列的 ServiceResponse 訊息。
 * 
 * @param {Uint8Array} data
 * @returns {string[]}
 */
function parseListServicesResponseField(data) {
  const services = [];
  let pos = 0;

  while (pos < data.length) {
    const [fieldNum, wireType, newPos] = readTag(data, pos);
    pos = newPos;

    if (wireType === 2) {
      const [fieldData, nextPos] = readLengthDelimited(data, pos);
      pos = nextPos;

      // field 1: service name (string)
      if (fieldNum === 1) {
        const name = parseServiceName(fieldData);
        if (name) services.push(name);
      }
    } else {
      pos = skipField(data, pos, wireType);
    }
  }

  return services;
}

/**
 * 提取 ServiceResponse 中的名稱字串
 * 
 * @param {Uint8Array} data
 * @returns {string | null}
 */
function parseServiceName(data) {
  let pos = 0;

  while (pos < data.length) {
    const [fieldNum, wireType, newPos] = readTag(data, pos);
    pos = newPos;

    if (wireType === 2) {
      const [fieldData, nextPos] = readLengthDelimited(data, pos);
      pos = nextPos;

      // field 1: name (string)
      if (fieldNum === 1) {
        return new TextDecoder().decode(fieldData);
      }
    } else {
      pos = skipField(data, pos, wireType);
    }
  }

  return null;
}

/**
 * 解析 FileDescriptorResponse
 * 這是 Reflection 最重要的部分，它回傳一組 FileDescriptorProto，包含了所有定義詳情。
 * 
 * @param {Uint8Array} data
 * @returns {Uint8Array[] | null} 一組 FileDescriptorProto 的二進位陣列
 */
export function parseFileDescriptorResponse(data) {
  let pos = 0;

  while (pos < data.length) {
    const [fieldNum, wireType, newPos] = readTag(data, pos);
    pos = newPos;

    if (wireType === 2) {
      const [fieldData, nextPos] = readLengthDelimited(data, pos);
      pos = nextPos;

      // field 4: file_descriptor_response
      if (fieldNum === 4) {
        return parseFileDescriptorResponseField(fieldData);
      } 
      // field 7: error_response
      else if (fieldNum === 7) {
        logErrorResponse(fieldData);
      }
    } else {
      pos = skipField(data, pos, wireType);
    }
  }

  return null;
}

/**
 * 從 FileDescriptorResponse 中提取所有 file_descriptor_proto 位元組
 * 每一段位元組都是一個獨立的 FileDescriptorProto 訊息。
 * 
 * @param {Uint8Array} data
 * @returns {Uint8Array[] | null}
 */
function parseFileDescriptorResponseField(data) {
  const descriptors = [];
  let pos = 0;

  while (pos < data.length) {
    const [fieldNum, wireType, newPos] = readTag(data, pos);
    pos = newPos;

    if (wireType === 2) {
      const [fieldData, nextPos] = readLengthDelimited(data, pos);
      pos = nextPos;

      // field 1: file_descriptor_proto (bytes)
      if (fieldNum === 1) {
        descriptors.push(fieldData);
      }
    } else {
      pos = skipField(data, pos, wireType);
    }
  }

  return descriptors.length > 0 ? descriptors : null;
}

// ============================================================================
// 錯誤處理 (Error Handling)
// ============================================================================

/**
 * 解析並記錄 Reflection Error Response
 * 當伺服器無法找到要求的服務或檔案時，會回傳此訊息。
 * 
 * @param {Uint8Array} data
 */
export function logErrorResponse(data) {
  let pos = 0;
  let code = 0;
  let msg = '';

  while (pos < data.length) {
    const [fieldNum, wireType, newPos] = readTag(data, pos);
    pos = newPos;

    // field 1: error_code (int32)
    if (wireType === 0 && fieldNum === 1) {
      const [v, nextPos] = readVarint(data, pos);
      pos = nextPos;
      code = v;
    } 
    // field 2: error_message (string)
    else if (wireType === 2 && fieldNum === 2) {
      const [fieldData, nextPos] = readLengthDelimited(data, pos);
      pos = nextPos;
      msg = new TextDecoder().decode(fieldData);
    } else {
      pos = skipField(data, pos, wireType);
    }
  }

  logger.warn(`Server returned error (${code}): ${msg}`);
}

