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

        // Step 2: Get file descriptors for each service
        const result = {
          services: [],
          messages: {},
        };

        for (const serviceName of services) {
          if (serviceName.includes("grpc.reflection")) continue;

          try {
            const fileDescriptor = await this.getFileContainingSymbol(
              serverUrl,
              reflectionService,
              serviceName
            );

            if (fileDescriptor) {
              const parsed = this.parseFileDescriptor(fileDescriptor);
              if (parsed) {
                result.services.push(...(parsed.services || []));
                Object.assign(result.messages, parsed.messages || {});
              }
            }
          } catch (e) {
            console.warn(`[Reflection] Failed to get descriptor for ${serviceName}:`, e.message);
          }
        }

        if (result.services.length > 0 || Object.keys(result.messages).length > 0) {
          console.log("[Reflection] Complete result:", result);
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

    // Encode: list_services = "" (field 7)
    const request = new Uint8Array([0x3a, 0x00]);
    const response = await this.sendGrpcWebRequest(url, request);

    if (!response) return null;

    return this.parseListServicesResponse(response);
  }

  async getFileContainingSymbol(serverUrl, reflectionService, symbol) {
    const url = `${serverUrl}/${reflectionService}/ServerReflectionInfo`;

    // Encode: file_containing_symbol = symbol (field 4)
    const symbolBytes = new TextEncoder().encode(symbol);
    const request = new Uint8Array(2 + symbolBytes.length);
    request[0] = 0x22; // field 4, wire type 2
    request[1] = symbolBytes.length;
    request.set(symbolBytes, 2);

    const response = await this.sendGrpcWebRequest(url, request);

    if (!response) return null;

    return this.parseFileDescriptorResponse(response);
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

    // Unframe
    const length = (data[1] << 24) | (data[2] << 16) | (data[3] << 8) | data[4];
    return data.slice(5, 5 + length);
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

        // Extract messages
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
                type_name: f.type_name,
              })),
            };

            // Handle nested types
            if (msg.nestedType && msg.nestedType.length > 0) {
              extractMessages(msg.nestedType, fullName);
            }
          }
        };

        extractMessages(descriptor.messageType, packageName);
      }

      console.log("[Reflection] Parsed descriptor:", result);
      return result;
    } catch (e) {
      console.warn("[Reflection] Failed to parse file descriptor:", e);
      return null;
    }
  }

  bytesToDescriptor(bytes) {
    // Parse FileDescriptorProto manually
    const descriptor = {
      name: "",
      package: "",
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
        } else if (fieldNum === 4) { // message_type
          const msg = this.parseMessageType(fieldData);
          if (msg) descriptor.messageType.push(msg);
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
        }
      } else {
        pos = this.skipField(data, pos, wireType);
      }
    }

    return message;
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
}

const reflectionClient = new ReflectionClient();
export default reflectionClient;
