/* global chrome */

import reflectionClient from "./reflection-client";

const STORAGE_KEY = "grpc_web_devtools_schemas";

class SchemaManager {
  constructor() {
    this.schemas = new Map();
    this.serviceMethodMap = new Map();
    this.initialized = false;
    this.reflectedServers = new Set();
  }

  async initialize() {
    if (this.initialized) return;

    try {
      const stored = await this.loadFromStorage();
      if (stored) {
        for (const [name, data] of Object.entries(stored)) {
          this.schemas.set(name, data);
          this.buildServiceMap(data);
        }
      }
      this.initialized = true;
    } catch (e) {
      console.warn("Failed to load schemas from storage:", e);
    }
  }

  async loadFromStorage() {
    return new Promise((resolve) => {
      if (typeof chrome !== "undefined" && chrome.storage) {
        chrome.storage.local.get([STORAGE_KEY], (result) => {
          resolve(result[STORAGE_KEY] || null);
        });
      } else {
        const stored = localStorage.getItem(STORAGE_KEY);
        resolve(stored ? JSON.parse(stored) : null);
      }
    });
  }

  async saveToStorage() {
    const data = {};
    for (const [name, schema] of this.schemas) {
      data[name] = schema;
    }

    return new Promise((resolve) => {
      if (typeof chrome !== "undefined" && chrome.storage) {
        chrome.storage.local.set({ [STORAGE_KEY]: data }, resolve);
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        resolve();
      }
    });
  }

  // loadProtoFile removed - only supporting Reflection and frontend manual registration

  // Manual proto parsing removed.


  buildServiceMap(schema) {
    for (const service of schema.services) {
      for (const method of service.methods) {
        const path = `/${service.fullName}/${method.name}`;
        this.serviceMethodMap.set(path, {
          service: service.name,
          method: method.name,
          requestType: method.requestType,
          responseType: method.responseType,
        });
      }
    }
  }

  getMethodInfo(path) {
    const methodInfo = this.serviceMethodMap.get(path);
    if (!methodInfo) return null;

    return {
      ...methodInfo,
      requestMessage: this.getMessageByName(methodInfo.requestType),
      responseMessage: this.getMessageByName(methodInfo.responseType),
    };
  }

  applyFieldNames(decoded, messageType) {
    if (!messageType || typeof decoded !== "object" || decoded === null) {
      return decoded;
    }

    const result = {};
    const fieldMap = new Map(messageType.fields.map((f) => [f.number, f]));

    for (const [key, value] of Object.entries(decoded)) {
      const fieldNumber = parseInt(key, 10);
      const fieldDef = fieldMap.get(fieldNumber);

      if (fieldDef) {
        const fieldName = fieldDef.name;
        // Debug nested types
        if (fieldDef.type === 11 || fieldDef.type_name) {
          const nestedMsg = this.getMessageByName(fieldDef.type_name);
          if (!nestedMsg) {
            console.warn(`[SchemaManager] No definition found for nested type: ${fieldDef.type_name} (Field: ${fieldName})`);
          }

          if (Array.isArray(value)) {
            result[fieldName] = value.map((v) => this.applyFieldNames(v, nestedMsg));
          } else if (typeof value === "object" && value !== null) {
            result[fieldName] = this.applyFieldNames(value, nestedMsg);
          } else {
            result[fieldName] = value;
          }
        } else if (Array.isArray(value)) {
          result[fieldName] = value;
        } else {
          result[fieldName] = value;
        }
      } else {
        result[`field_${key}`] = value;
      }
    }

    return result;
  }

  getMessageByName(typeName) {
    if (!typeName) return null;

    const cleanSearchName = typeName.replace(/^\.+/, "").replace(/\.+$/, "").toLowerCase();
    const shortSearchName = cleanSearchName.split(".").pop();

    const allMsgDefs = [];
    for (const [, schema] of this.schemas) {
      for (const [msgFullName, msgDef] of Object.entries(schema.messages)) {
        const cleanMsgName = msgFullName.replace(/^\.+/, "").replace(/\.+$/, "").toLowerCase();
        allMsgDefs.push({ cleanMsgName, msgDef });
      }
    }

    // Phase 1: Exact full name match (normalized dots)
    let found = allMsgDefs.find(m => m.cleanMsgName === cleanSearchName);
    if (found) return found.msgDef;

    // Phase 2: EndsWith match (e.g. searching for "common.Pagination" matches "foo.common.Pagination")
    found = allMsgDefs.find(m => m.cleanMsgName.endsWith("." + cleanSearchName));
    if (found) return found.msgDef;

    // Phase 3: Inverse EndsWith match (e.g. searching for "foo.common.Pagination" matches "common.Pagination")
    found = allMsgDefs.find(m => cleanSearchName.endsWith("." + m.cleanMsgName));
    if (found) return found.msgDef;

    // Phase 4: Short name match (e.g. "Pagination")
    found = allMsgDefs.find(m => m.msgDef.name.toLowerCase() === shortSearchName);
    if (found) return found.msgDef;

    console.warn(`[SchemaManager] UNABLE to find message: "${typeName}"`);
    return null;
  }

  getAllServices() {
    const services = [];
    for (const [fileName, schema] of this.schemas) {
      for (const service of schema.services) {
        services.push({
          fileName,
          ...service,
        });
      }
    }
    return services;
  }

  async removeSchema(fileName) {
    this.schemas.delete(fileName);
    this.rebuildServiceMap();
    await this.saveToStorage();
  }

  rebuildServiceMap() {
    this.serviceMethodMap.clear();
    for (const [, schema] of this.schemas) {
      this.buildServiceMap(schema);
    }
  }

  async clearAll() {
    this.schemas.clear();
    this.serviceMethodMap.clear();
    this.reflectedServers.clear();
    await this.saveToStorage();
  }

  async tryReflection(url) {
    if (!url) return false;

    try {
      const serverUrl = new URL(url).origin;

      if (this.reflectedServers.has(serverUrl)) {
        return false;
      }

      this.reflectedServers.add(serverUrl);

      console.log("[SchemaManager] Attempting reflection for:", serverUrl);

      const result = await reflectionClient.fetchFromServer(serverUrl);

      if (result && (result.services.length > 0 || Object.keys(result.messages).length > 0)) {
        console.log("[SchemaManager] Reflection succeeded:", result);

        const schema = {
          name: `reflection:${serverUrl}`,
          services: result.services,
          messages: result.messages,
        };

        this.schemas.set(schema.name, schema);
        this.buildServiceMap(schema);

        return true;
      }
    } catch (e) {
      console.warn("[SchemaManager] Reflection failed:", e.message);
    }

    return false;
  }

  getProtoDefinition(methodPath) {
    const methodInfo = this.serviceMethodMap.get(methodPath);
    if (!methodInfo) return null;

    const requestMsg = this.getMessageByName(methodInfo.requestType);
    const responseMsg = this.getMessageByName(methodInfo.responseType);

    return {
      method: methodInfo.method,
      request: {
        type: methodInfo.requestType,
        fields: requestMsg ? requestMsg.fields : [],
      },
      response: {
        type: methodInfo.responseType,
        fields: responseMsg ? responseMsg.fields : [],
      }
    };
  }
}

const schemaManager = new SchemaManager();
export default schemaManager;
