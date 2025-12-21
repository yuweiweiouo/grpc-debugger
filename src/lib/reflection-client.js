// gRPC-Web Reflection Client
// Fetches both service list and full proto definitions (including message field names)

class ReflectionClient {
  constructor() {
    this.cache = new Map();
  }

  async fetchFromServer(serverUrl) {
    console.log("[Reflection] Attempting for:", serverUrl);

    // Try gRPC-Web binary first (most compatible)
    const reflectionServices = [
      "grpc.reflection.v1.ServerReflection",
      "grpc.reflection.v1alpha.ServerReflection",
    ];

    for (const reflectionService of reflectionServices) {
      try {
        // Step 1: Get service list
        const services = await this.listServices(serverUrl, reflectionService);
        if (!services || services.length === 0) continue;

        console.log("[Reflection] Found services:", services);

        // Step 2: Get file descriptors for each service (with dependency resolution)
        const result = {
          services: [],
          messages: {},
        };
        
        const loadedFiles = new Set();
        
        const loadFileDescriptors = async (descriptorBytes) => {
          if (!descriptorBytes) return;
          
          for (const bytes of descriptorBytes) {
            const descriptor = this.bytesToDescriptor(bytes);
            
            // Skip if already loaded
            if (loadedFiles.has(descriptor.name)) continue;
            loadedFiles.add(descriptor.name);
            
            // Parse current file
            const parsed = this.parseFileDescriptorSingle(descriptor);
            if (parsed) {
              result.services.push(...(parsed.services || []));
              Object.assign(result.messages, parsed.messages || {});
            }
            
            // Recursively load dependencies
            for (const depName of descriptor.dependency || []) {
              if (loadedFiles.has(depName)) continue;
              
              try {
                const depDescriptor = await this.getFileByFilename(
                  serverUrl,
                  reflectionService,
                  depName
                );
                if (depDescriptor) {
                  await loadFileDescriptors(depDescriptor);
                }
              } catch (e) {
                console.debug(`[Reflection] Could not load dependency: ${depName}`);
              }
            }
          }
        };

        for (const serviceName of services) {
          if (serviceName.includes("grpc.reflection")) continue;

          try {
            const fileDescriptor = await this.getFileContainingSymbol(
              serverUrl,
              reflectionService,
              serviceName
            );

            await loadFileDescriptors(fileDescriptor);
          } catch (e) {
            console.warn(`[Reflection] Failed to get descriptor for ${serviceName}:`, e.message);
          }
        }

        if (result.services.length > 0 || Object.keys(result.messages).length > 0) {
          console.log("[Reflection] Complete result:", result);
          console.log("[Reflection] Loaded message types:", Object.keys(result.messages));
          return result;
        }
      } catch (e) {
        console.warn(`[Reflection] ${reflectionService} failed:`, e.message);
      }
    }

    return null;
  }

  async listServices(serverUrl, reflectionService) {
    const url = `${serverUrl}/${reflectionService}/ServerReflectionInfo`;
    const host = new URL(serverUrl).host;

    // Encode: host = host (field 1), list_services = "" (field 7)
    const hostBytes = new TextEncoder().encode(host);
    const request = new Uint8Array(2 + hostBytes.length + 2);
    
    let offset = 0;
    request[offset++] = 0x0a; // field 1, wire type 2
    request[offset++] = hostBytes.length;
    request.set(hostBytes, offset);
    offset += hostBytes.length;
    
    request[offset++] = 0x3a; // field 7, wire type 2
    request[offset++] = 0x00; // length 0

    const responses = await this.sendGrpcWebRequest(url, request);
    if (!responses) return null;

    const services = [];
    for (const resp of responses) {
      services.push(...this.parseListServicesResponse(resp));
    }
    return services;
  }

  async getFileContainingSymbol(serverUrl, reflectionService, symbol) {
    const url = `${serverUrl}/${reflectionService}/ServerReflectionInfo`;
    const host = new URL(serverUrl).host;

    // Encode: host = host (field 1), file_containing_symbol = symbol (field 4)
    const hostBytes = new TextEncoder().encode(host);
    const symbolBytes = new TextEncoder().encode(symbol);
    
    const request = new Uint8Array(2 + hostBytes.length + 2 + symbolBytes.length);
    let offset = 0;
    
    request[offset++] = 0x0a; // field 1, wire type 2
    request[offset++] = hostBytes.length;
    request.set(hostBytes, offset);
    offset += hostBytes.length;
    
    request[offset++] = 0x22; // field 4, wire type 2
    request[offset++] = symbolBytes.length;
    request.set(symbolBytes, offset);

    const responses = await this.sendGrpcWebRequest(url, request);
    if (!responses) return null;

    const descriptors = [];
    for (const resp of responses) {
      descriptors.push(...(this.parseFileDescriptorResponse(resp) || []));
    }
    return descriptors.length > 0 ? descriptors : null;
  }

  async getFileByFilename(serverUrl, reflectionService, filename) {
    const url = `${serverUrl}/${reflectionService}/ServerReflectionInfo`;
    const host = new URL(serverUrl).host;

    // Encode: host = host (field 1), file_by_filename = filename (field 3)
    const hostBytes = new TextEncoder().encode(host);
    const filenameBytes = new TextEncoder().encode(filename);
    
    const request = new Uint8Array(2 + hostBytes.length + 2 + filenameBytes.length);
    let offset = 0;
    
    request[offset++] = 0x0a; // field 1, wire type 2
    request[offset++] = hostBytes.length;
    request.set(hostBytes, offset);
    offset += hostBytes.length;
    
    request[offset++] = 0x1a; // field 3, wire type 2
    request[offset++] = filenameBytes.length;
    request.set(filenameBytes, offset);

    const responses = await this.sendGrpcWebRequest(url, request);
    if (!responses) return null;

    const descriptors = [];
    for (const resp of responses) {
      descriptors.push(...(this.parseFileDescriptorResponse(resp) || []));
    }
    return descriptors.length > 0 ? descriptors : null;
  }

  async sendGrpcWebRequest(url, requestBody) {
    // Frame the request
    const frame = new Uint8Array(5 + requestBody.length);
    frame[0] = 0; // not compressed
    frame[1] = (requestBody.length >> 24) & 0xff;
    frame[2] = (requestBody.length >> 16) & 0xff;
    frame[3] = (requestBody.length >> 8) & 0xff;
    frame[4] = requestBody.length & 0xff;
    frame.set(requestBody, 5);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/grpc-web+proto",
        "Accept": "application/grpc-web+proto",
        "X-Grpc-Web": "1",
      },
      body: frame,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    const data = new Uint8Array(buffer);

    if (data.length < 5) return null;

    // Unframe all messages (gRPC-Web can send multiple frames in one response)
    const payloads = [];
    let pos = 0;
    while (pos + 5 <= data.length) {
      const flags = data[pos];
      const length = (data[pos + 1] << 24) | (data[pos + 2] << 16) | (data[pos + 3] << 8) | data[pos + 4];
      const start = pos + 5;
      const end = start + length;
      
      if (end > data.length) break;

      // Bit 7: Compressed, Bit 1: Trailers
      const isData = (flags & 0x80) === 0 && (flags & 0x01) === 0;
      if (isData) {
        payloads.push(data.slice(start, end));
      }
      pos = end;
    }

    // For reflection, we usually care about the aggregated data or the first valid response
    // If it's multiple frames, they are usually separate ServerReflectionResponse messages
    return payloads.length > 0 ? payloads : null;
  }

  parseListServicesResponse(data) {
    const services = [];
    let pos = 0;

    while (pos < data.length) {
      const [fieldNum, wireType, newPos] = this.readTag(data, pos);
      pos = newPos;

      if (wireType === 2) {
        const [fieldData, nextPos] = this.readLengthDelimited(data, pos);
        pos = nextPos;

        if (fieldNum === 6) { // list_services_response
          services.push(...this.parseListServicesResponseField(fieldData));
        } else if (fieldNum === 7) { // error_response
          this.logErrorResponse(fieldData);
        }
      } else {
        pos = this.skipField(data, pos, wireType);
      }
    }

    return services;
  }

  parseListServicesResponseField(data) {
    const services = [];
    let pos = 0;

    while (pos < data.length) {
      const [fieldNum, wireType, newPos] = this.readTag(data, pos);
      pos = newPos;

      if (wireType === 2) {
        const [fieldData, nextPos] = this.readLengthDelimited(data, pos);
        pos = nextPos;

        if (fieldNum === 1) { // service
          const name = this.parseServiceName(fieldData);
          if (name) services.push(name);
        }
      } else {
        pos = this.skipField(data, pos, wireType);
      }
    }

    return services;
  }

  parseServiceName(data) {
    let pos = 0;

    while (pos < data.length) {
      const [fieldNum, wireType, newPos] = this.readTag(data, pos);
      pos = newPos;

      if (wireType === 2) {
        const [fieldData, nextPos] = this.readLengthDelimited(data, pos);
        pos = nextPos;

        if (fieldNum === 1) { // name
          return new TextDecoder().decode(fieldData);
        }
      } else {
        pos = this.skipField(data, pos, wireType);
      }
    }

    return null;
  }

  parseFileDescriptorResponse(data) {
    let pos = 0;

    while (pos < data.length) {
      const [fieldNum, wireType, newPos] = this.readTag(data, pos);
      pos = newPos;

      if (wireType === 2) {
        const [fieldData, nextPos] = this.readLengthDelimited(data, pos);
        pos = nextPos;

        if (fieldNum === 4) { // file_descriptor_response
          return this.parseFileDescriptorResponseField(fieldData);
        } else if (fieldNum === 7) { // error_response
          this.logErrorResponse(fieldData);
        }
      } else {
        pos = this.skipField(data, pos, wireType);
      }
    }

    return null;
  }

  parseFileDescriptorResponseField(data) {
    const descriptors = [];
    let pos = 0;

    while (pos < data.length) {
      const [fieldNum, wireType, newPos] = this.readTag(data, pos);
      pos = newPos;

      if (wireType === 2) {
        const [fieldData, nextPos] = this.readLengthDelimited(data, pos);
        pos = nextPos;

        if (fieldNum === 1) { // file_descriptor_proto (bytes)
          descriptors.push(fieldData);
        }
      } else {
        pos = this.skipField(data, pos, wireType);
      }
    }

    return descriptors.length > 0 ? descriptors : null;
  }

  parseFileDescriptor(descriptorBytes) {
    try {
      const result = {
        services: [],
        messages: {},
      };

      for (const bytes of descriptorBytes) {
        const descriptor = this.bytesToDescriptor(bytes);
        const parsed = this.parseFileDescriptorSingle(descriptor);
        if (parsed) {
          result.services.push(...(parsed.services || []));
          Object.assign(result.messages, parsed.messages || {});
        }
      }

      console.log("[Reflection] Parsed descriptor:", result);
      return result;
    } catch (e) {
      console.warn("[Reflection] Failed to parse file descriptor:", e);
      return null;
    }
  }

  parseFileDescriptorSingle(descriptor) {
    try {
      const result = {
        services: [],
        messages: {},
      };

      const packageName = descriptor.package || "";

      // Extract services
      for (const svc of descriptor.service || []) {
        const fullName = packageName ? `${packageName}.${svc.name}` : svc.name;
        result.services.push({
          name: svc.name,
          fullName,
          methods: (svc.method || []).map((m) => ({
            name: m.name,
            requestType: m.inputType?.replace(/^\./, "") || "",
            responseType: m.outputType?.replace(/^\./, "") || "",
          })),
        });
      }

      // Extract messages and enums
      const extractMessages = (messages, prefix) => {
        for (const msg of messages || []) {
          const fullName = prefix ? `${prefix}.${msg.name}` : msg.name;
          result.messages[fullName] = {
            name: msg.name,
            fullName,
            fields: (msg.field || []).map((f) => ({
              name: f.name,
              number: f.number,
              type: f.type,
              type_name: f.type_name?.replace(/^\./, "") || "",
            })),
          };

          // Handle nested types
          if (msg.nestedType && msg.nestedType.length > 0) {
            extractMessages(msg.nestedType, fullName);
          }
          // Handle nested enums
          if (msg.enumType && msg.enumType.length > 0) {
            extractEnums(msg.enumType, fullName);
          }
        }
      };

      const extractEnums = (enums, prefix) => {
        for (const e of enums || []) {
          const fullName = prefix ? `${prefix}.${e.name}` : e.name;
          result.messages[fullName] = {
            name: e.name,
            fullName,
            isEnum: true,
            values: (e.value || []).reduce((acc, v) => {
              acc[v.number] = v.name;
              return acc;
            }, {}),
          };
        }
      };

      extractMessages(descriptor.messageType, packageName);
      extractEnums(descriptor.enumType, packageName);

      return result;
    } catch (e) {
      console.warn("[Reflection] Failed to parse single descriptor:", e);
      return null;
    }
  }

  bytesToDescriptor(bytes) {
    // Parse FileDescriptorProto manually
    const descriptor = {
      name: "",
      package: "",
      dependency: [],
      messageType: [],
      service: [],
    };

    let pos = 0;
    while (pos < bytes.length) {
      const [fieldNum, wireType, newPos] = this.readTag(bytes, pos);
      pos = newPos;

      if (wireType === 2) {
        const [fieldData, nextPos] = this.readLengthDelimited(bytes, pos);
        pos = nextPos;

        if (fieldNum === 1) { // name
          descriptor.name = new TextDecoder().decode(fieldData);
        } else if (fieldNum === 2) { // package
          descriptor.package = new TextDecoder().decode(fieldData);
        } else if (fieldNum === 3) { // dependency
          descriptor.dependency.push(new TextDecoder().decode(fieldData));
        } else if (fieldNum === 4) { // message_type
          const msg = this.parseMessageType(fieldData);
          if (msg) descriptor.messageType.push(msg);
        } else if (fieldNum === 5) { // enum_type
          const enm = this.parseEnumType(fieldData);
          if (enm) (descriptor.enumType = descriptor.enumType || []).push(enm);
        } else if (fieldNum === 6) { // service
          const svc = this.parseServiceType(fieldData);
          if (svc) descriptor.service.push(svc);
        }
      } else {
        pos = this.skipField(bytes, pos, wireType);
      }
    }

    return descriptor;
  }

  parseMessageType(data) {
    const message = {
      name: "",
      field: [],
      nestedType: [],
    };

    let pos = 0;
    while (pos < data.length) {
      const [fieldNum, wireType, newPos] = this.readTag(data, pos);
      pos = newPos;

      if (wireType === 2) {
        const [fieldData, nextPos] = this.readLengthDelimited(data, pos);
        pos = nextPos;

        if (fieldNum === 1) { // name
          message.name = new TextDecoder().decode(fieldData);
        } else if (fieldNum === 2) { // field
          const field = this.parseFieldDescriptor(fieldData);
          if (field) message.field.push(field);
        } else if (fieldNum === 3) { // nested_type
          const nested = this.parseMessageType(fieldData);
          if (nested) message.nestedType.push(nested);
        } else if (fieldNum === 4) { // enum_type
          const enm = this.parseEnumType(fieldData);
          if (enm) (message.enumType = message.enumType || []).push(enm);
        }
      } else {
        pos = this.skipField(data, pos, wireType);
      }
    }

    return message;
  }

  parseEnumType(data) {
    const enm = { name: "", value: [] };
    let pos = 0;
    while (pos < data.length) {
      const [fieldNum, wireType, newPos] = this.readTag(data, pos);
      pos = newPos;
      if (wireType === 2) {
        const [fieldData, nextPos] = this.readLengthDelimited(data, pos);
        pos = nextPos;
        if (fieldNum === 1) enm.name = new TextDecoder().decode(fieldData);
        else if (fieldNum === 2) {
          const val = this.parseEnumValue(fieldData);
          if (val) enm.value.push(val);
        }
      } else pos = this.skipField(data, pos, wireType);
    }
    return enm;
  }

  parseEnumValue(data) {
    const val = { name: "", number: 0 };
    let pos = 0;
    while (pos < data.length) {
      const [fieldNum, wireType, newPos] = this.readTag(data, pos);
      pos = newPos;
      if (wireType === 2 && fieldNum === 1) {
        const [fieldData, nextPos] = this.readLengthDelimited(data, pos);
        pos = nextPos;
        val.name = new TextDecoder().decode(fieldData);
      } else if (wireType === 0 && fieldNum === 2) {
        const [v, nextPos] = this.readVarint(data, pos);
        pos = nextPos;
        val.number = v;
      } else pos = this.skipField(data, pos, wireType);
    }
    return val;
  }

  parseFieldDescriptor(data) {
    const field = {
      name: "",
      number: 0,
      type: 0,
    };

    let pos = 0;
    while (pos < data.length) {
      const [fieldNum, wireType, newPos] = this.readTag(data, pos);
      pos = newPos;

      if (wireType === 2) {
        const [fieldData, nextPos] = this.readLengthDelimited(data, pos);
        pos = nextPos;

        if (fieldNum === 1) { // name
          field.name = new TextDecoder().decode(fieldData);
        } else if (fieldNum === 6) { // type_name
          field.type_name = new TextDecoder().decode(fieldData);
        }
      } else if (wireType === 0) {
        const [value, nextPos] = this.readVarint(data, pos);
        pos = nextPos;

        if (fieldNum === 3) { // number
          field.number = value;
        } else if (fieldNum === 5) { // type
          field.type = value;
        }
      } else {
        pos = this.skipField(data, pos, wireType);
      }
    }

    return field;
  }

  parseServiceType(data) {
    const service = {
      name: "",
      method: [],
    };

    let pos = 0;
    while (pos < data.length) {
      const [fieldNum, wireType, newPos] = this.readTag(data, pos);
      pos = newPos;

      if (wireType === 2) {
        const [fieldData, nextPos] = this.readLengthDelimited(data, pos);
        pos = nextPos;

        if (fieldNum === 1) { // name
          service.name = new TextDecoder().decode(fieldData);
        } else if (fieldNum === 2) { // method
          const method = this.parseMethodDescriptor(fieldData);
          if (method) service.method.push(method);
        }
      } else {
        pos = this.skipField(data, pos, wireType);
      }
    }

    return service;
  }

  parseMethodDescriptor(data) {
    const method = {
      name: "",
      inputType: "",
      outputType: "",
    };

    let pos = 0;
    while (pos < data.length) {
      const [fieldNum, wireType, newPos] = this.readTag(data, pos);
      pos = newPos;

      if (wireType === 2) {
        const [fieldData, nextPos] = this.readLengthDelimited(data, pos);
        pos = nextPos;

        if (fieldNum === 1) { // name
          method.name = new TextDecoder().decode(fieldData);
        } else if (fieldNum === 2) { // input_type
          method.inputType = new TextDecoder().decode(fieldData);
        } else if (fieldNum === 3) { // output_type
          method.outputType = new TextDecoder().decode(fieldData);
        }
      } else {
        pos = this.skipField(data, pos, wireType);
      }
    }

    return method;
  }

  // Utility methods for protobuf parsing

  readTag(data, pos) {
    const [tag, newPos] = this.readVarint(data, pos);
    return [tag >> 3, tag & 0x7, newPos];
  }

  readVarint(data, pos) {
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

  readLengthDelimited(data, pos) {
    const [length, newPos] = this.readVarint(data, pos);
    return [data.slice(newPos, newPos + length), newPos + length];
  }

  skipField(data, pos, wireType) {
    if (wireType === 0) {
      while (pos < data.length && (data[pos] & 0x80) !== 0) pos++;
      return pos + 1;
    } else if (wireType === 2) {
      const [length, newPos] = this.readVarint(data, pos);
      return newPos + length;
    } else if (wireType === 5) {
      return pos + 4;
    } else if (wireType === 1) {
      return pos + 8;
    }
    return pos;
  }

  logErrorResponse(data) {
    let pos = 0;
    let code = 0;
    let msg = "";

    while (pos < data.length) {
      const [fieldNum, wireType, newPos] = this.readTag(data, pos);
      pos = newPos;

      if (wireType === 0 && fieldNum === 1) { // error_code
        const [v, nextPos] = this.readVarint(data, pos);
        pos = nextPos;
        code = v;
      } else if (wireType === 2 && fieldNum === 2) { // error_message
        const [fieldData, nextPos] = this.readLengthDelimited(data, pos);
        pos = nextPos;
        msg = new TextDecoder().decode(fieldData);
      } else {
        pos = this.skipField(data, pos, wireType);
      }
    }

    console.warn(`[Reflection] Server returned error (${code}): ${msg}`);
  }
}

const reflectionClient = new ReflectionClient();
export default reflectionClient;
