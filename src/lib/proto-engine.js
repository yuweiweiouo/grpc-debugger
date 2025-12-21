/* global BigInt */
/**
 * ProtoEngine.js - gRPC Debugger 2.0 Core
 * A schema-driven integrated decoder for gRPC-Web and Connect-RPC.
 */

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
    return this._decode(schema, reader, typeName);
  }

  _decode(schema, reader, typeName = "unknown") {
    const result = {};
    const fields = schema ? schema.fields : [];
    const fieldMap = new Map((fields || []).map(f => [f.number, f]));

    if (!schema && typeName && typeName !== "unknown") {
       console.warn(`[ProtoEngine] Unknown message: ${typeName}. Blind decoding.`);
    }

    while (reader.pos < reader.len) {
      const tag = Number(reader.readVarint());
      const fieldNum = tag >>> 3;
      const wireType = tag & 0x7;

      if (fieldNum === 0) break; // Invalid field number

      const fieldDef = fieldMap.get(fieldNum);
      const fieldName = fieldDef ? fieldDef.name : `field_${fieldNum}`;
      
      let value;

      // 1. If we have a schema and it's a known type
      if (fieldDef) {
        // Handle Packed Repeated Fields (Wire Type 2 but expecting primitive types)
        if (wireType === 2 && this.isPackableType(fieldDef.type)) {
          const packData = reader.readBytes();
          const packReader = new ProtoReader(packData);
          value = [];
          while (packReader.pos < packReader.len) {
            value.push(this.readFieldValue(fieldDef, packReader, fieldDef.type));
          }
        } 
        else if (fieldDef.type === 11 || fieldDef.type === 18) { // MESSAGE or SGROUP
          const msgData = reader.readBytes();
          const nestedTypeName = (fieldDef.type_name || "").replace(/^\.+/, "");
          const nestedSchema = this.findMessage(nestedTypeName);
          if (!nestedSchema && nestedTypeName) {
            console.debug(`[ProtoEngine] Nested type not found: ${nestedTypeName}`);
          }
          value = this._decode(nestedSchema, new ProtoReader(msgData), nestedTypeName);
        }
        else {
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
            if (Object.keys(subDecoded).length > 0 && subReader.pos / subReader.len > 0.8) {
              value = subDecoded;
            } else {
              throw new Error("Maybe string");
            }
          } catch {
            try {
              value = new TextDecoder("utf-8", { fatal: true }).decode(raw);
            } catch {
              value = Array.from(raw).map(b => b.toString(16).padStart(2, 'x')).join(' ');
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
    // Standard packable types (scalars)
    const packables = [1, 2, 3, 4, 5, 6, 7, 8, 13, 14, 15, 16, 17, 18];
    return packables.includes(type);
  }

  readFieldValue(fieldDef, reader, wireType) {
    switch (fieldDef.type) {
      case 1:  return reader.readDouble(); // DOUBLE
      case 2:  return reader.readFloat();  // FLOAT
      case 3:  return reader.readVarint().toString(); // INT64
      case 4:  return reader.readVarint().toString(); // UINT64
      case 5:  return reader.readVarint(); // INT32
      case 6:  return reader.readFixed64().toString(); // FIXED64
      case 7:  return reader.readFixed32(); // FIXED32
      case 8:  return reader.readVarint() !== 0n; // BOOL
      case 9:  return reader.readString(); // STRING
      case 12: return reader.readBytes();  // BYTES
      case 13: return Number(reader.readVarint()); // UINT32
      case 14: // ENUM
        const val = Number(reader.readVarint());
        const enumDef = this.findMessage(fieldDef.type_name);
        if (enumDef && enumDef.isEnum && enumDef.values && enumDef.values[val] !== undefined) {
          return enumDef.values[val];
        }
        return val;
      case 15: return reader.readSFixed32(); // SFIXED32
      case 16: return reader.readSFixed64().toString(); // SFIXED64
      case 17: return reader.readSVarint(); // SINT32
      case 18: return reader.readSVarint64().toString(); // SINT64
      default: return reader.readField(wireType);
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
    this.view = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
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

  // ZigZag decoding for sint32
  readSVarint() {
    const n = this.readVarint();
    // ZigZag decode: (n >>> 1) ^ -(n & 1)
    const num = Number(n);
    return (num >>> 1) ^ -(num & 1);
  }

  // ZigZag decoding for sint64 (BigInt)
  readSVarint64() {
    const n = this.readVarint();
    // ZigZag decode for BigInt: (n >> 1n) ^ -(n & 1n)
    return (n >> 1n) ^ -(n & 1n);
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
    switch(wireType) {
      case 0: return this.readVarint().toString();
      case 1: return this.readFixed64().toString();
      case 2: return this.readBytes(); 
      case 5: return this.readFixed32();
      default: return null;
    }
  }
}

export const protoEngine = new ProtoEngine();
