const WIRE_TYPES = {
  VARINT: 0,
  I64: 1,
  LEN: 2,
  SGROUP: 3,
  EGROUP: 4,
  I32: 5,
};

function isValidBase64(str) {
  if (typeof str !== "string") return false;
  if (str.length === 0) return false;
  try {
    return btoa(atob(str)) === str.replace(/\s/g, "");
  } catch {
    return false;
  }
}

function stringToUint8Array(str) {
  const buffer = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    buffer[i] = str.charCodeAt(i);
  }
  return buffer;
}

export function decodeGrpcWebFrame(data, isBase64Encoded = true) {
  let buffer;

  if (data instanceof Uint8Array) {
    buffer = data;
  } else if (typeof data === "string") {
    if (isBase64Encoded && isValidBase64(data)) {
      try {
        const binaryString = atob(data);
        buffer = stringToUint8Array(binaryString);
      } catch {
        buffer = stringToUint8Array(data);
      }
    } else {
      buffer = stringToUint8Array(data);
    }
  } else if (Array.isArray(data)) {
    buffer = new Uint8Array(data);
  } else {
    throw new Error("Invalid data format");
  }

  const frames = [];
  let offset = 0;

  while (offset < buffer.length) {
    if (offset + 5 > buffer.length) break;

    const compressed = buffer[offset];
    const length =
      (buffer[offset + 1] << 24) |
      (buffer[offset + 2] << 16) |
      (buffer[offset + 3] << 8) |
      buffer[offset + 4];

    offset += 5;

    if (length > buffer.length - offset || length < 0) break;

    const payload = buffer.slice(offset, offset + length);
    offset += length;

    const isTrailer = compressed === 0x80;

    frames.push({
      compressed: compressed === 1,
      isTrailer,
      length,
      payload,
    });
  }

  return frames;
}

export function decodeProtobufRaw(buffer) {
  if (!(buffer instanceof Uint8Array)) {
    buffer = new Uint8Array(buffer);
  }

  const reader = new ProtobufReader(buffer);
  return reader.readMessage();
}

class ProtobufReader {
  constructor(buffer) {
    this.buffer = buffer;
    this.pos = 0;
  }

  readMessage() {
    const result = {};

    while (this.pos < this.buffer.length) {
      try {
        const tag = this.readVarint();
        if (tag === 0) break;

        const fieldNumber = tag >>> 3;
        const wireType = tag & 0x7;

        const value = this.readField(wireType);

        if (result[fieldNumber] !== undefined) {
          if (!Array.isArray(result[fieldNumber])) {
            result[fieldNumber] = [result[fieldNumber]];
          }
          result[fieldNumber].push(value);
        } else {
          result[fieldNumber] = value;
        }
      } catch (e) {
        break;
      }
    }

    return result;
  }

  readField(wireType) {
    switch (wireType) {
      case WIRE_TYPES.VARINT:
        return this.readVarint();
      case WIRE_TYPES.I64:
        return this.readFixed64();
      case WIRE_TYPES.LEN:
        return this.readLengthDelimited();
      case WIRE_TYPES.I32:
        return this.readFixed32();
      case WIRE_TYPES.SGROUP:
      case WIRE_TYPES.EGROUP:
        throw new Error("Groups are deprecated and not supported");
      default:
        throw new Error(`Unknown wire type: ${wireType}`);
    }
  }

  readVarint() {
    let result = 0;
    let shift = 0;

    while (this.pos < this.buffer.length) {
      const byte = this.buffer[this.pos++];
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) {
        return result >>> 0;
      }
      shift += 7;
      if (shift > 35) {
        throw new Error("Varint too long");
      }
    }

    throw new Error("Unexpected end of buffer");
  }

  readFixed32() {
    if (this.pos + 4 > this.buffer.length) {
      throw new Error("Unexpected end of buffer");
    }
    const value =
      this.buffer[this.pos] |
      (this.buffer[this.pos + 1] << 8) |
      (this.buffer[this.pos + 2] << 16) |
      (this.buffer[this.pos + 3] << 24);
    this.pos += 4;
    return value >>> 0;
  }

  readFixed64() {
    const low = this.readFixed32();
    const high = this.readFixed32();
    return { low, high, toString: () => `${high * 0x100000000 + low}` };
  }

  readLengthDelimited() {
    const length = this.readVarint();
    if (this.pos + length > this.buffer.length) {
      throw new Error("Unexpected end of buffer");
    }

    const data = this.buffer.slice(this.pos, this.pos + length);
    this.pos += length;

    const stringResult = this.tryDecodeAsString(data);
    if (stringResult !== null) {
      return stringResult;
    }

    const messageResult = this.tryDecodeAsMessage(data);
    if (messageResult !== null) {
      return messageResult;
    }

    return this.formatBytes(data);
  }

  tryDecodeAsString(data) {
    try {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      const str = decoder.decode(data);

      if (this.isValidUtf8String(str)) {
        return str;
      }
    } catch {
      // Not valid UTF-8
    }
    return null;
  }

  isValidUtf8String(str) {
    if (str.length === 0) return true;

    const printableRatio =
      str.split("").filter((c) => {
        const code = c.charCodeAt(0);
        return (
          (code >= 0x20 && code <= 0x7e) ||
          code === 0x09 ||
          code === 0x0a ||
          code === 0x0d ||
          code >= 0x80
        );
      }).length / str.length;

    return printableRatio > 0.8;
  }

  tryDecodeAsMessage(data) {
    if (data.length < 2) return null;

    try {
      const reader = new ProtobufReader(data);
      const result = reader.readMessage();

      if (Object.keys(result).length > 0 && reader.pos === data.length) {
        return result;
      }
    } catch {
      // Not a valid message
    }
    return null;
  }

  formatBytes(data) {
    if (data.length <= 32) {
      return Array.from(data)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(" ");
    }
    return `<${data.length} bytes>`;
  }
}

export function decodeTrailer(payload) {
  try {
    const decoder = new TextDecoder("utf-8");
    const text = decoder.decode(payload);
    const headers = {};

    text.split("\r\n").forEach((line) => {
      const colonIndex = line.indexOf(":");
      if (colonIndex > 0) {
        const key = line.slice(0, colonIndex).trim();
        const value = line.slice(colonIndex + 1).trim();
        headers[key] = value;
      }
    });

    return headers;
  } catch {
    return null;
  }
}

export function formatDecodedMessage(decoded, indent = 0) {
  if (typeof decoded !== "object" || decoded === null) {
    return decoded;
  }

  const result = {};
  for (const [key, value] of Object.entries(decoded)) {
    if (Array.isArray(value)) {
      result[`field_${key}`] = value.map((v) => formatDecodedMessage(v, indent + 1));
    } else if (typeof value === "object" && value !== null) {
      if (value.low !== undefined && value.high !== undefined) {
        result[`field_${key}`] = value.toString();
      } else {
        result[`field_${key}`] = formatDecodedMessage(value, indent + 1);
      }
    } else {
      result[`field_${key}`] = value;
    }
  }
  return result;
}
