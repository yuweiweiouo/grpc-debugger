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
        this.schemas.set(fullName.replace(/^\.+/, ""), def);
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
   * Find message definition by name (with fallbacks)
   */
  findMessage(typeName) {
    if (!typeName) return null;
    const cleanName = typeName.replace(/^\.+/, "");
    
    // 1. Direct match
    if (this.schemas.has(cleanName)) return this.schemas.get(cleanName);

    // 2. Case-insensitive / normalized match
    const lowerName = cleanName.toLowerCase();
    for (const [name, def] of this.schemas.entries()) {
      if (name.toLowerCase() === lowerName) return def;
      if (name.split('.').pop().toLowerCase() === lowerName.split('.').pop().toLowerCase()) {
         // Potential match for short names, but be careful
      }
    }
    return null;
  }

  /**
   * Decode a message buffer using its type name
   */
  decodeMessage(typeName, buffer) {
    const schema = this.findMessage(typeName);
    const reader = new ProtoReader(buffer);
    return this._decode(schema, reader);
  }

  _decode(schema, reader) {
    const result = {};
    const fields = schema ? schema.fields : [];
    const fieldMap = new Map(fields.map(f => [f.number, f]));

    while (reader.pos < reader.len) {
      const tag = reader.readVarint();
      const fieldNum = tag >>> 3;
      const wireType = tag & 0x7;

      const fieldDef = fieldMap.get(fieldNum);
      const fieldName = fieldDef ? fieldDef.name : `field_${fieldNum}`;
      
      let value;
      if (fieldDef && fieldDef.type === 11) { // TYPE_MESSAGE
         const msgData = reader.readBytes();
         value = this.decodeMessage(fieldDef.type_name, msgData);
      } else {
         value = reader.readField(wireType);
      }

      // Handle Repeated fields
      if (result[fieldName] !== undefined) {
        if (!Array.isArray(result[fieldName])) {
          result[fieldName] = [result[fieldName]];
        }
        result[fieldName].push(value);
      } else {
        result[fieldName] = value;
      }
    }
    return result;
  }
}

/**
 * Low-level binary reader for Protobuf
 */
class ProtoReader {
  constructor(buffer) {
    this.buf = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    this.pos = 0;
    this.len = this.buf.length;
  }

  readVarint() {
    let val = 0;
    let shift = 0;
    while (this.pos < this.len) {
      const b = this.buf[this.pos++];
      val += (b & 0x7f) << shift;
      if (!(b & 0x80)) return val >>> 0;
      shift += 7;
    }
    return val;
  }

  readFixed32() {
    const val = (this.buf[this.pos] | 
                 (this.buf[this.pos+1] << 8) | 
                 (this.buf[this.pos+2] << 16) | 
                 (this.buf[this.pos+3] << 24)) >>> 0;
    this.pos += 4;
    return val;
  }

  readFixed64() {
    const low = this.readFixed32();
    const high = this.readFixed32();
    return (BigInt(high) << 32n) + BigInt(low);
  }

  readBytes() {
    const len = this.readVarint();
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
      case 0: return this.readVarint();
      case 1: return this.readFixed64().toString();
      case 2: 
        const data = this.readBytes();
        try {
          return new TextDecoder("utf-8", { fatal: true }).decode(data);
        } catch {
          return data; // Fallback to bytes
        }
      case 5: return this.readFixed32();
      default:
        // Skip unknown wire types
        return null;
    }
  }
}

export const protoEngine = new ProtoEngine();
