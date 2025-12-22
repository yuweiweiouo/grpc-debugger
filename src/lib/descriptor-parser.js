/**
 * Protobuf Descriptor Parser
 * 負責解析 gRPC Reflection API 回應與 FileDescriptorProto 二進位格式
 */

import { createLogger } from './logger.js';

const logger = createLogger('DescParser');

// ============================================================================
// Low-Level Protobuf Parsing Utilities
// ============================================================================

/**
 * 讀取 Tag（Field Number + Wire Type）
 * @param {Uint8Array} data
 * @param {number} pos
 * @returns {[number, number, number]} [fieldNum, wireType, newPos]
 */
export function readTag(data, pos) {
  const [tag, newPos] = readVarint(data, pos);
  return [tag >> 3, tag & 0x7, newPos];
}

/**
 * 讀取 Varint
 * @param {Uint8Array} data
 * @param {number} pos
 * @returns {[number, number]} [value, newPos]
 */
export function readVarint(data, pos) {
  let result = 0;
  let shift = 0;

  while (pos < data.length) {
    const byte = data[pos++];
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }

  return [result >>> 0, pos];
}

/**
 * 讀取 Length-Delimited 欄位
 * @param {Uint8Array} data
 * @param {number} pos
 * @returns {[Uint8Array, number]} [fieldData, newPos]
 */
export function readLengthDelimited(data, pos) {
  const [length, newPos] = readVarint(data, pos);
  return [data.slice(newPos, newPos + length), newPos + length];
}

/**
 * 跳過不需要的欄位
 * @param {Uint8Array} data
 * @param {number} pos
 * @param {number} wireType
 * @returns {number} newPos
 */
export function skipField(data, pos, wireType) {
  switch (wireType) {
    case 0: // Varint
      while (pos < data.length && (data[pos] & 0x80) !== 0) pos++;
      return pos + 1;
    case 2: { // Length-delimited
      const [length, newPos] = readVarint(data, pos);
      return newPos + length;
    }
    case 5: // 32-bit
      return pos + 4;
    case 1: // 64-bit
      return pos + 8;
    default:
      return pos;
  }
}

// ============================================================================
// Reflection API Response Parsers
// ============================================================================

/**
 * 解析 ListServicesResponse
 * @param {Uint8Array} data
 * @returns {string[]} 服務名稱列表
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

      if (fieldNum === 6) {
        // list_services_response
        services.push(...parseListServicesResponseField(fieldData));
      } else if (fieldNum === 7) {
        // error_response
        logErrorResponse(fieldData);
      }
    } else {
      pos = skipField(data, pos, wireType);
    }
  }

  return services;
}

/**
 * 解析 ListServicesResponse 內的 service 欄位
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
 * 解析 ServiceResponse 取得服務名稱
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
 * @param {Uint8Array} data
 * @returns {Uint8Array[] | null} FileDescriptorProto 位元組陣列
 */
export function parseFileDescriptorResponse(data) {
  let pos = 0;

  while (pos < data.length) {
    const [fieldNum, wireType, newPos] = readTag(data, pos);
    pos = newPos;

    if (wireType === 2) {
      const [fieldData, nextPos] = readLengthDelimited(data, pos);
      pos = nextPos;

      if (fieldNum === 4) {
        return parseFileDescriptorResponseField(fieldData);
      } else if (fieldNum === 7) {
        logErrorResponse(fieldData);
      }
    } else {
      pos = skipField(data, pos, wireType);
    }
  }

  return null;
}

/**
 * 解析 FileDescriptorResponse 內的 file_descriptor_proto
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
// Error Handling
// ============================================================================

/**
 * 記錄 Reflection Error Response
 * @param {Uint8Array} data
 */
export function logErrorResponse(data) {
  let pos = 0;
  let code = 0;
  let msg = '';

  while (pos < data.length) {
    const [fieldNum, wireType, newPos] = readTag(data, pos);
    pos = newPos;

    if (wireType === 0 && fieldNum === 1) {
      const [v, nextPos] = readVarint(data, pos);
      pos = nextPos;
      code = v;
    } else if (wireType === 2 && fieldNum === 2) {
      const [fieldData, nextPos] = readLengthDelimited(data, pos);
      pos = nextPos;
      msg = new TextDecoder().decode(fieldData);
    } else {
      pos = skipField(data, pos, wireType);
    }
  }

  logger.warn(`Server returned error (${code}): ${msg}`);
}
