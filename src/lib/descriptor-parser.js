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
// FileDescriptorProto Parsers
// ============================================================================

/**
 * @typedef {Object} FileDescriptor
 * @property {string} name
 * @property {string} package
 * @property {string[]} dependency
 * @property {MessageType[]} messageType
 * @property {EnumType[]} [enumType]
 * @property {ServiceType[]} service
 */

/**
 * @typedef {Object} MessageType
 * @property {string} name
 * @property {FieldDescriptor[]} field
 * @property {MessageType[]} nestedType
 * @property {EnumType[]} [enumType]
 */

/**
 * @typedef {Object} FieldDescriptor
 * @property {string} name
 * @property {number} number
 * @property {number} type
 * @property {string} [type_name]
 */

/**
 * @typedef {Object} EnumType
 * @property {string} name
 * @property {EnumValue[]} value
 */

/**
 * @typedef {Object} EnumValue
 * @property {string} name
 * @property {number} number
 */

/**
 * @typedef {Object} ServiceType
 * @property {string} name
 * @property {MethodDescriptor[]} method
 */

/**
 * @typedef {Object} MethodDescriptor
 * @property {string} name
 * @property {string} inputType
 * @property {string} outputType
 */

/**
 * 將 FileDescriptorProto 位元組解析為結構化物件
 * @param {Uint8Array} bytes
 * @returns {FileDescriptor}
 */
export function bytesToDescriptor(bytes) {
  const descriptor = {
    name: '',
    package: '',
    dependency: [],
    messageType: [],
    service: [],
  };

  let pos = 0;
  while (pos < bytes.length) {
    const [fieldNum, wireType, newPos] = readTag(bytes, pos);
    pos = newPos;

    if (wireType === 2) {
      const [fieldData, nextPos] = readLengthDelimited(bytes, pos);
      pos = nextPos;

      switch (fieldNum) {
        case 1: // name
          descriptor.name = new TextDecoder().decode(fieldData);
          break;
        case 2: // package
          descriptor.package = new TextDecoder().decode(fieldData);
          break;
        case 3: // dependency
          descriptor.dependency.push(new TextDecoder().decode(fieldData));
          break;
        case 4: { // message_type
          const msg = parseMessageType(fieldData);
          if (msg) descriptor.messageType.push(msg);
          break;
        }
        case 5: { // enum_type
          const enm = parseEnumType(fieldData);
          if (enm) (descriptor.enumType = descriptor.enumType || []).push(enm);
          break;
        }
        case 6: { // service
          const svc = parseServiceType(fieldData);
          if (svc) descriptor.service.push(svc);
          break;
        }
      }
    } else {
      pos = skipField(bytes, pos, wireType);
    }
  }

  return descriptor;
}

/**
 * 解析 DescriptorProto（Message）
 * @param {Uint8Array} data
 * @returns {MessageType}
 */
export function parseMessageType(data) {
  const message = {
    name: '',
    field: [],
    nestedType: [],
  };

  let pos = 0;
  while (pos < data.length) {
    const [fieldNum, wireType, newPos] = readTag(data, pos);
    pos = newPos;

    if (wireType === 2) {
      const [fieldData, nextPos] = readLengthDelimited(data, pos);
      pos = nextPos;

      switch (fieldNum) {
        case 1: // name
          message.name = new TextDecoder().decode(fieldData);
          break;
        case 2: { // field
          const field = parseFieldDescriptor(fieldData);
          if (field) message.field.push(field);
          break;
        }
        case 3: { // nested_type
          const nested = parseMessageType(fieldData);
          if (nested) message.nestedType.push(nested);
          break;
        }
        case 4: { // enum_type
          const enm = parseEnumType(fieldData);
          if (enm) (message.enumType = message.enumType || []).push(enm);
          break;
        }
      }
    } else {
      pos = skipField(data, pos, wireType);
    }
  }

  // 診斷：顯示解析結果
  if (message.name && message.name.includes('Res')) {
    console.log(`[DescParser] parseMessageType: ${message.name} has ${message.field.length} fields:`,
      message.field.map(f => `${f.name}(#${f.number})`).join(', '));
  }

  return message;
}

/**
 * 解析 EnumDescriptorProto
 * @param {Uint8Array} data
 * @returns {EnumType}
 */
export function parseEnumType(data) {
  const enm = { name: '', value: [] };
  let pos = 0;

  while (pos < data.length) {
    const [fieldNum, wireType, newPos] = readTag(data, pos);
    pos = newPos;

    if (wireType === 2) {
      const [fieldData, nextPos] = readLengthDelimited(data, pos);
      pos = nextPos;

      if (fieldNum === 1) {
        enm.name = new TextDecoder().decode(fieldData);
      } else if (fieldNum === 2) {
        const val = parseEnumValue(fieldData);
        if (val) enm.value.push(val);
      }
    } else {
      pos = skipField(data, pos, wireType);
    }
  }

  return enm;
}

/**
 * 解析 EnumValueDescriptorProto
 * @param {Uint8Array} data
 * @returns {EnumValue}
 */
export function parseEnumValue(data) {
  const val = { name: '', number: 0 };
  let pos = 0;

  while (pos < data.length) {
    const [fieldNum, wireType, newPos] = readTag(data, pos);
    pos = newPos;

    if (wireType === 2 && fieldNum === 1) {
      const [fieldData, nextPos] = readLengthDelimited(data, pos);
      pos = nextPos;
      val.name = new TextDecoder().decode(fieldData);
    } else if (wireType === 0 && fieldNum === 2) {
      const [v, nextPos] = readVarint(data, pos);
      pos = nextPos;
      val.number = v;
    } else {
      pos = skipField(data, pos, wireType);
    }
  }

  return val;
}

/**
 * 解析 FieldDescriptorProto
 * @param {Uint8Array} data
 * @returns {FieldDescriptor}
 */
export function parseFieldDescriptor(data) {
  const field = {
    name: '',
    number: 0,
    type: 0,
    label: 1, // 預設 OPTIONAL (1=OPTIONAL, 2=REQUIRED, 3=REPEATED)
  };

  let pos = 0;
  while (pos < data.length) {
    const [fieldNum, wireType, newPos] = readTag(data, pos);
    pos = newPos;

    if (wireType === 2) {
      const [fieldData, nextPos] = readLengthDelimited(data, pos);
      pos = nextPos;

      if (fieldNum === 1) {
        field.name = new TextDecoder().decode(fieldData);
      } else if (fieldNum === 6) {
        field.type_name = new TextDecoder().decode(fieldData);
      }
    } else if (wireType === 0) {
      const [value, nextPos] = readVarint(data, pos);
      pos = nextPos;

      if (fieldNum === 3) {
        field.number = value;
      } else if (fieldNum === 4) {
        // Label: 1=OPTIONAL, 2=REQUIRED, 3=REPEATED
        field.label = value;
      } else if (fieldNum === 5) {
        field.type = value;
      }
    } else {
      pos = skipField(data, pos, wireType);
    }
  }

  return field;
}

/**
 * 解析 ServiceDescriptorProto
 * @param {Uint8Array} data
 * @returns {ServiceType}
 */
export function parseServiceType(data) {
  const service = {
    name: '',
    method: [],
  };

  let pos = 0;
  while (pos < data.length) {
    const [fieldNum, wireType, newPos] = readTag(data, pos);
    pos = newPos;

    if (wireType === 2) {
      const [fieldData, nextPos] = readLengthDelimited(data, pos);
      pos = nextPos;

      if (fieldNum === 1) {
        service.name = new TextDecoder().decode(fieldData);
      } else if (fieldNum === 2) {
        const method = parseMethodDescriptor(fieldData);
        if (method) service.method.push(method);
      }
    } else {
      pos = skipField(data, pos, wireType);
    }
  }

  return service;
}

/**
 * 解析 MethodDescriptorProto
 * @param {Uint8Array} data
 * @returns {MethodDescriptor}
 */
export function parseMethodDescriptor(data) {
  const method = {
    name: '',
    inputType: '',
    outputType: '',
  };

  let pos = 0;
  while (pos < data.length) {
    const [fieldNum, wireType, newPos] = readTag(data, pos);
    pos = newPos;

    if (wireType === 2) {
      const [fieldData, nextPos] = readLengthDelimited(data, pos);
      pos = nextPos;

      switch (fieldNum) {
        case 1: // name
          method.name = new TextDecoder().decode(fieldData);
          break;
        case 2: // input_type
          method.inputType = new TextDecoder().decode(fieldData);
          break;
        case 3: // output_type
          method.outputType = new TextDecoder().decode(fieldData);
          break;
      }
    } else {
      pos = skipField(data, pos, wireType);
    }
  }

  return method;
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
