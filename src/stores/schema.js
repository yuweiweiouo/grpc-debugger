import { writable } from 'svelte/store';
import { protoEngine } from '../lib/proto-engine';
import reflectionClient from '../lib/reflection-client';

export const services = writable([]);
export const reflectionStatus = writable(null); // 'loading' | 'success' | 'failed' | null

// 已完成 reflection 的 servers
const reflectedServers = new Set();

// 進行中的 reflection Promises（用於等待）
const reflectionPromises = new Map();

// 是否已從本地 proto library 註冊 schema（優先於 reflection）
let localProtoRegistered = false;

/**
 * 等待指定 origin 的 reflection 完成（如果有的話）
 * @param {string} origin
 * @returns {Promise<boolean>} 是否有 schema
 */
export async function waitForReflection(origin) {
  if (reflectionPromises.has(origin)) {
    await reflectionPromises.get(origin);
  }
  return reflectedServers.has(origin);
}

/**
 * 嘗試對指定 URL 進行 auto-reflection
 * 優先檢查：
 * 1. 本地 proto library 已註冊 → 跳過 reflection
 * 2. protoEngine 已有對應的 method → 跳過 reflection
 * 3. 已完成的 reflection（直接返回）
 * 4. 進行中的 reflection（等待完成）
 * 5. 尚未開始的 reflection（開始並等待）
 * 
 * @param {string} url
 * @returns {Promise<boolean>} 是否成功載入新 schema
 */
export async function tryAutoReflection(url) {
  if (!url) return false;
  
  try {
    const origin = new URL(url).origin;
    
    // 如果本地 proto 已註冊且有對應的 schema，跳過 reflection
    if (localProtoRegistered && protoEngine.serviceMap.size > 0) {
      // 檢查這個 URL 對應的 method 是否已在 serviceMap 中
      const methodPath = new URL(url).pathname;
      if (protoEngine.findMethod(methodPath)) {
        console.log(`[Schema] Skipping reflection - local proto available for ${methodPath}`);
        return false;
      }
    }
    
    // 已完成，直接返回
    if (reflectedServers.has(origin)) {
      return false;
    }
    
    // 進行中，等待完成
    if (reflectionPromises.has(origin)) {
      await reflectionPromises.get(origin);
      // 等待完成後，檢查是否成功
      return reflectedServers.has(origin);
    }
    
    // 開始新 reflection
    const promise = performReflection(origin);
    reflectionPromises.set(origin, promise);
    
    const success = await promise;
    
    // 完成後清理 promise（保留 reflectedServers 記錄）
    reflectionPromises.delete(origin);
    
    return success;
  } catch (e) {
    console.error('[Schema] Error during auto-reflection:', e);
    return false;
  }
}

/**
 * 執行實際的 reflection 請求
 * @param {string} origin
 * @returns {Promise<boolean>}
 */
async function performReflection(origin) {
  console.log(`[Schema] Starting reflection for: ${origin}`);
  
  try {
    reflectionStatus.set('loading');
    
    const result = await reflectionClient.fetchFromServer(origin);
    
    console.log(`[Schema] Reflection result:`, result);
    
    if (result) {
      console.log(`[Schema] Got ${result.services?.length || 0} services, ${Object.keys(result.messages || {}).length} messages`);
      registerSchema(result);
      reflectedServers.add(origin);
      reflectionStatus.set('success');
      console.log(`[Schema] Reflection completed for ${origin}`);
      console.log(`[Schema] serviceMap size after register: ${protoEngine.serviceMap.size}`);
      return true;
    } else {
      reflectedServers.add(origin);
      reflectionStatus.set('failed');
      console.warn(`[Schema] Reflection returned null for ${origin}`);
      return false;
    }
  } catch (e) {
    reflectedServers.add(origin);
    reflectionStatus.set('failed');
    console.error(`[Schema] Reflection error for ${origin}:`, e);
    return false;
  }
}

/**
 * 檢查指定 origin 是否已完成 reflection
 * @param {string} url
 * @returns {boolean}
 */
export function hasReflected(url) {
  if (!url) return false;
  try {
    const origin = new URL(url).origin;
    return reflectedServers.has(origin);
  } catch {
    return false;
  }
}

/**
 * 註冊 schema
 * @param {object} data - Schema data
 * @param {string} [source] - 來源標識 ('auto-detect:google-protobuf', 'reflection', etc.)
 */
export function registerSchema(data, source = '') {
  protoEngine.registerSchema(data);

  // 標記是否從本地 proto library 註冊
  if (source?.startsWith('auto-detect')) {
    localProtoRegistered = true;
    console.log(`[Schema] Local proto registered from: ${source}`);
  }

  if (data.services) {
    services.update(list => {
      const newList = [...list];
      for (const service of data.services) {
        const existingIdx = newList.findIndex(s => s.fullName === service.fullName);
        if (existingIdx === -1) {
          newList.push(service);
        } else {
          newList[existingIdx] = service;
        }
      }
      return newList;
    });
  }
}

export function clearAllSchemas() {
  services.set([]);
  reflectionStatus.set(null);
  reflectedServers.clear();
  reflectionPromises.clear();
  protoEngine.schemas.clear();
  protoEngine.serviceMap.clear();
}
