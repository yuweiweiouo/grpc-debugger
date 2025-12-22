/* global BigInt */
/**
 * ProtoEngine.js - gRPC Debugger 2.0 Core
 * A schema-driven integrated decoder for gRPC-Web and Connect-RPC.
 */

/**
 * Protobuf Field Types 常數定義
 * @see https://protobuf.dev/programming-guides/encoding/
 */
const FieldType = {
  DOUBLE:   1,
  FLOAT:    2,
  INT64:    3,
  UINT64:   4,
  INT32:    5,
  FIXED64:  6,
  FIXED32:  7,
  BOOL:     8,
  STRING:   9,
  GROUP:    10,  // deprecated
  MESSAGE:  11,
  BYTES:    12,
  UINT32:   13,
  ENUM:     14,
  SFIXED32: 15,
  SFIXED64: 16,
  SINT32:   17,
  SINT64:   18,
};

// Packable types（可壓縮為 Length-delimited 格式的純量類型）
const PACKABLE_TYPES = new Set([
  FieldType.DOUBLE, FieldType.FLOAT, 
  FieldType.INT64, FieldType.UINT64, FieldType.INT32, 
  FieldType.FIXED64, FieldType.FIXED32, 
  FieldType.BOOL, 
  FieldType.UINT32, FieldType.ENUM,
  FieldType.SFIXED32, FieldType.SFIXED64,
  FieldType.SINT32, FieldType.SINT64
]);
export class ProtoEngine {
  constructor() {
    this.schemas = new Map(); // Full name -> Message Definition
    this.serviceMap = new Map(); // Path -> Method Info
  }

  /**
   * Register a schema (usually from Reflection or Frontend registration)
   */
  registerSchema(data) {
    if (data.messages) {
      for (const [fullName, def] of Object.entries(data.messages)) {
        const key = fullName.replace(/^\.+/, "");
        this.schemas.set(key, def);
      }
    }
    if (data.services) {
      for (const service of data.services) {
        for (const method of service.methods) {
          const path = `/${service.fullName}/${method.name}`;
          this.serviceMap.set(path, {
            serviceName: service.fullName,
            methodName: method.name,
            requestType: method.requestType.replace(/^\.+/, ""),
            responseType: method.responseType.replace(/^\.+/, ""),
          });
        }
      }
    }
  }

  /**
   * Find message definition by name (with multi-stage robust matching)
   */
  findMessage(typeName) {
    if (!typeName) return null;

    const cleanName = typeName.replace(/^\.+/, "");

    // Stage 1: Exact match
    if (this.schemas.has(cleanName)) {
      return this.schemas.get(cleanName);
    }

    // Stage 2: Suffix match (e.g., "Product" matches "common.Product")
    for (const [key, msg] of this.schemas) {
      if (key.endsWith(`.${cleanName}`) || key === cleanName) {
        return msg;
      }
    }

    // Stage 3: Case-insensitive tail match
    const lowerClean = cleanName.toLowerCase();
    for (const [key, msg] of this.schemas) {
      if (key.toLowerCase().endsWith(lowerClean)) {
        return msg;
      }
    }

    // Stage 4: Unique tail segment match (ultimate fallback)
    const tailSegment = cleanName.split(".").pop();
    if (tailSegment) {
      const candidates = [];
      for (const [key, msg] of this.schemas) {
        if (key.split(".").pop() === tailSegment) {
          candidates.push(msg);
        }
      }
      if (candidates.length === 1) {
        return candidates[0];
      }
    }

    // Log failure for diagnosis
    console.debug(`[ProtoEngine] No definition found for: ${cleanName}`);

    return null;
  }

  /**
   * Decode a message buffer using its type name
   */
  decodeMessage(typeName, buffer) {
    const reader = new ProtoReader(buffer);
    const schema = this.findMessage(typeName);

    if (typeName && !schema) {
      console.warn(
        `[ProtoEngine] decodeMessage: No schema found for "${typeName}". schemas.size=${this.schemas.size}`
      );
      // Log first 5 schema keys for diagnosis
      const keys = [...this.schemas.keys()].slice(0, 5);
      console.debug(
        `[ProtoEngine] Available schemas (first 5): ${keys.join(", ")}`
      );
    }

    return this._decode(schema, reader, typeName);
  }

  _decode(schema, reader, typeName = "unknown") {
    const result = {};
    const fields = schema ? schema.fields : [];
    const fieldMap = new Map((fields || []).map((f) => [f.number, f]));

    // Diagnostic logging
    if (schema && typeName !== "unknown") {
      console.debug(
        `[ProtoEngine] _decode: type=${typeName}, schema.fields.length=${
          fields?.length || 0
        }, fieldMap.size=${fieldMap.size}`
      );
      if (fieldMap.size === 0 && schema) {
        console.warn(
          `[ProtoEngine] Schema exists but no fields! Schema keys:`,
          Object.keys(schema)
        );
      }
    }

    if (!schema && typeName && typeName !== "unknown") {
      console.warn(
        `[ProtoEngine] Unknown message: ${typeName}. Blind decoding.`
      );
    }

    while (reader.pos < reader.len) {
      const tag = Number(reader.readVarint());
      const fieldNum = tag >>> 3;
      const wireType = tag & 0x7;

      if (fieldNum === 0) break; // Invalid field number

      const fieldDef = fieldMap.get(fieldNum);
      const fieldName = fieldDef ? fieldDef.name : `field_${fieldNum}`;

      // Log when field number not found in schema (indicates version mismatch)
      if (!fieldDef && schema && typeName !== "unknown") {
        const schemaFieldNums = [...fieldMap.keys()].join(",");
        console.debug(
          `[ProtoEngine] Field ${fieldNum} not in schema for ${typeName}. Schema has fields: [${schemaFieldNums}]`
        );
      }

      let value;

      // 1. If we have a schema and it's a known type
      if (fieldDef) {
        // Handle Packed Repeated Fields (Wire Type 2 but expecting primitive types)
        if (wireType === 2 && this.isPackableType(fieldDef.type)) {
          const packData = reader.readBytes();
          const packReader = new ProtoReader(packData);
          value = [];
          while (packReader.pos < packReader.len) {
            value.push(
              this.readFieldValue(fieldDef, packReader, fieldDef.type)
            );
          }
        } else if (fieldDef.type === FieldType.MESSAGE || fieldDef.type === FieldType.SINT64) {
          // MESSAGE or SINT64 (legacy GROUP handling)
          const msgData = reader.readBytes();
          const nestedTypeName = (fieldDef.type_name || "").replace(/^\.+/, "");
          const nestedSchema = this.findMessage(nestedTypeName);
          if (!nestedSchema && nestedTypeName) {
            console.debug(
              `[ProtoEngine] Nested type not found: ${nestedTypeName}`
            );
          }
          value = this._decode(
            nestedSchema,
            new ProtoReader(msgData),
            nestedTypeName
          );
        } else {
          value = this.readFieldValue(fieldDef, reader, wireType);
        }
      }
      // 2. Blind decoding (No schema or unknown field)
      else {
        if (wireType === 2) {
          const raw = reader.readBytes();
          // Heuristic: try to guess if it's a nested message
          try {
            const subReader = new ProtoReader(raw);
            const subDecoded = this._decode(null, subReader);
            // If it has at least one field and consumed most bytes (allow for small trailing padding)
            if (
              Object.keys(subDecoded).length > 0 &&
              subReader.pos / subReader.len > 0.8
            ) {
              value = subDecoded;
            } else {
              throw new Error("Maybe string");
            }
          } catch {
            try {
              value = new TextDecoder("utf-8", { fatal: true }).decode(raw);
            } catch {
              value = Array.from(raw)
                .map((b) => b.toString(16).padStart(2, "x"))
                .join(" ");
            }
          }
        } else {
          value = reader.readField(wireType);
        }
      }

      // Handle Repeated fields
      if (result[fieldName] !== undefined) {
        if (!Array.isArray(result[fieldName])) {
          result[fieldName] = [result[fieldName]];
        }
        if (Array.isArray(value)) {
          result[fieldName].push(...value);
        } else {
          result[fieldName].push(value);
        }
      } else {
        result[fieldName] = value;
      }
    }
    return result;
  }

  isPackableType(type) {
    return PACKABLE_TYPES.has(type);
  }

  readFieldValue(fieldDef, reader, wireType) {
    switch (fieldDef.type) {
      case FieldType.DOUBLE:
        return reader.readDouble();
      case FieldType.FLOAT:
        return reader.readFloat();
      case FieldType.INT64:
        return reader.readVarint().toString();
      case FieldType.UINT64:
        return reader.readVarint().toString();
      case FieldType.INT32:
        return reader.readVarint();
      case FieldType.FIXED64:
        return reader.readFixed64().toString();
      case FieldType.FIXED32:
        return reader.readFixed32();
      case FieldType.BOOL:
        return reader.readVarint() !== 0n;
      case FieldType.STRING:
        return reader.readString();
      case FieldType.BYTES:
        return reader.readBytes();
      case FieldType.UINT32:
        return Number(reader.readVarint());
      case FieldType.ENUM: {
        const val = Number(reader.readVarint());
        const enumDef = this.findMessage(fieldDef.type_name);
        if (
          enumDef &&
          enumDef.isEnum &&
          enumDef.values &&
          enumDef.values[val] !== undefined
        ) {
          return enumDef.values[val];
        }
        return val;
      }
      case FieldType.SFIXED32:
        return reader.readSFixed32();
      case FieldType.SFIXED64:
        return reader.readSFixed64().toString();
      case FieldType.SINT32:
        return reader.readSVarint();
      case FieldType.SINT64:
        return reader.readSVarint64().toString();
      default:
        return reader.readField(wireType);
    }
  }
}

/**
 * Low-level binary reader for Protobuf (BigInt supported)
 */
class ProtoReader {
  constructor(buffer) {
    this.buf = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    this.pos = 0;
    this.len = this.buf.length;
    this.view = new DataView(
      this.buf.buffer,
      this.buf.byteOffset,
      this.buf.byteLength
    );
  }

  readVarint() {
    let val = 0n;
    let shift = 0n;
    while (this.pos < this.len) {
      const b = BigInt(this.buf[this.pos++]);
      val |= (b & 0x7fn) << shift;
      if (!(b & 0x80n)) return val;
      shift += 7n;
    }
    return val;
  }

  readSVarint() {
    const n = Number(this.readVarint());
    return (n >>> 1) ^ -(n & 1);
  }

  readSVarint64() {
    const n = this.readVarint();
    return (n >> 1n) ^ -(n & 1n);
  }

  readFixed32() {
    if (this.pos + 4 > this.len) return 0;
    const val = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return val;
  }

  readSFixed32() {
    if (this.pos + 4 > this.len) return 0;
    const val = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return val;
  }

  readFixed64() {
    if (this.pos + 8 > this.len) return 0n;
    const low = BigInt(this.view.getUint32(this.pos, true));
    const high = BigInt(this.view.getUint32(this.pos + 4, true));
    this.pos += 8;
    return (high << 32n) | low;
  }

  readSFixed64() {
    if (this.pos + 8 > this.len) return 0n;
    const low = BigInt(this.view.getUint32(this.pos, true));
    const high = BigInt(this.view.getInt32(this.pos + 4, true));
    this.pos += 8;
    return (high << 32n) | low;
  }

  readFloat() {
    if (this.pos + 4 > this.len) return 0;
    const val = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return val;
  }

  readDouble() {
    if (this.pos + 8 > this.len) return 0;
    const val = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return val;
  }

  readBytes() {
    const len = Number(this.readVarint());
    const data = this.buf.slice(this.pos, this.pos + len);
    this.pos += len;
    return data;
  }

  readString() {
    const bytes = this.readBytes();
    return new TextDecoder().decode(bytes);
  }

  readField(wireType) {
    switch (wireType) {
      case 0:
        return this.readVarint().toString();
      case 1:
        return this.readFixed64().toString();
      case 2:
        return this.readBytes();
      case 5:
        return this.readFixed32();
      default:
        return null;
    }
  }
}

export const protoEngine = new ProtoEngine();
