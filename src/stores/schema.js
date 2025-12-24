/**
 * Schema 狀態管理 (Schema Store)
 * 
 * 負責管理全域的 Protobuf 服務定義與 Reflection (反射) 狀態：
 * 1. 協調 Auto-Reflection 請求，防止多個請求同時對同一個 Origin 進行反射。
 * 2. 儲存已註冊的服務列表，並提供可見性切換功能。
 * 3. 處理「本地定義優先」策略：若專案內已有特定 Service 的定義，則跳過 Reflection。
 */

import { writable } from 'svelte/store';
import { protoEngine } from '../lib/proto-engine';
import reflectionClient from '../lib/reflection-client';

// 目前註冊的所有服務定義
export const services = writable([]);
// 反射操作的狀態指示
export const reflectionStatus = writable(null); // 'loading' | 'success' | 'failed' | null
// 已知的伺服器站點 (用於 Playground 自動填充 URL)
export const knownHosts = writable([]);

// 已完成反射的伺服器站點 (Set<origin>)
const reflectedServers = new Set();

// 正在進行中的反射 Promise (用於重複請求的併發等待)
const reflectionPromises = new Map();

// 旗標：追蹤是否已從本地檔案系統載入過 Schema
let localProtoRegistered = false;

/**
 * 等待同步：若特定 Origin 正處於反射狀態，則等待其完成
 */
export async function waitForReflection(origin) {
  if (reflectionPromises.has(origin)) {
    await reflectionPromises.get(origin);
  }
  return reflectedServers.has(origin);
}

/**
 * 智能自動反射 (Auto-Reflection)
 * 這是 Debugger 的核心自動化功能，當監測到新的 gRPC URL 時自動尋找定義。
 * 
 * 優化策略：
 * 1. 本地優先：若本地已載入該 Method 定義，則完全不發起 Reflection 請求。
 * 2. 併發保護：對同一個 Origin 只會啟動一個反射任務，其餘調用者會自動進入隊列等待結果。
 */
export async function tryAutoReflection(url) {
  if (!url || typeof url !== 'string') return false;
  
  try {
    // 防禦：忽略無法解析為完整 URL 的相對路徑
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return false;
    }
    const origin = new URL(url).origin;
    
    // 策略 1：本地搶佔檢測
    if (localProtoRegistered && protoEngine.serviceMap.size > 0) {
      const methodPath = new URL(url).pathname;
      if (protoEngine.findMethod(methodPath)) {
        // console.log(`[Schema] 已有本地定義，跳過反射：${methodPath}`);
        return false;
      }
    }
    
    // 策略 2：快取與重複請求過濾
    if (reflectedServers.has(origin)) {
      return false;
    }
    
    // 處理正在進行的併發請求
    if (reflectionPromises.has(origin)) {
      await reflectionPromises.get(origin);
      return reflectedServers.has(origin);
    }
    
    // 發啟新的反射任務
    const promise = performReflection(origin);
    reflectionPromises.set(origin, promise);
    
    const success = await promise;
    // 反射完成後釋放 Promise 快取
    reflectionPromises.delete(origin);
    
    return success;
  } catch (e) {
    console.error('[Schema] 自動反射發生異常:', e);
    return false;
  }
}

/**
 * 執行反射：調用 Client 與伺服器通訊
 */
async function performReflection(origin) {
  // console.log(`[Schema] 開始嘗試反射伺服器：${origin}`);
  
  try {
    reflectionStatus.set('loading');
    
    // 取得 FileRegistry 與 ServiceMap
    const result = await reflectionClient.fetchFromServer(origin);
    
    if (result) {
      registerSchema(result, '', origin);
      reflectedServers.add(origin);
      knownHosts.update(hosts => hosts.includes(origin) ? hosts : [...hosts, origin]);
      reflectionStatus.set('success');
      return true;
    } else {
      // 標記為完成 (即便失敗也標記，防止對不支援反射的伺服器進行無窮嘗試)
      reflectedServers.add(origin);
      reflectionStatus.set('failed');
      return false;
    }
  } catch (e) {
    reflectedServers.add(origin);
    reflectionStatus.set('failed');
    console.error(`[Schema] 反射失敗 ${origin}:`, e);
    return false;
  }
}

/**
 * 查詢特定 URL 是否已完成過反射
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
 * 註冊計畫：將結果載入引擎並同步到 UI Store
 * 
 * @param {object} data 包含 services 與 messages 的 schema 資料
 * @param {string} [source] 來源標籤
 * @param {string} [sourceHost] 服務來源的主機網址
 */
export function registerSchema(data, source = '', sourceHost = '') {
  // 1. 更新底層解碼引擎的註冊表
  protoEngine.registerSchema(data);

  // 2. 標記本地註冊狀態
  if (source?.startsWith('auto-detect')) {
    localProtoRegistered = true;
  }

  // 3. 更新 UI 顯示用的服務列表
  if (data.services) {
    services.update(list => {
      const newList = [...list];
      for (const service of data.services) {
        const existingIdx = newList.findIndex(s => s.fullName === service.fullName);
        const serviceWithHost = { ...service, sourceHost: sourceHost || service.sourceHost || '' };
        if (existingIdx === -1) {
          newList.push(serviceWithHost);
        } else {
          // 若已存在則更新 (例如從 Reflection 更新本地占位符)
          newList[existingIdx] = serviceWithHost;
        }
      }
      return newList;
    });
  }
}

/**
 * 清除所有暫存的 Schema 與反射紀錄 (用於 重置/Reset)
 */
export function clearAllSchemas() {
  services.set([]);
  reflectionStatus.set(null);
  reflectedServers.clear();
  reflectionPromises.clear();
  protoEngine.schemas.clear();
  protoEngine.serviceMap.clear();
}

/**
 * 切換服務的可見性
 * 當使用者點擊隱藏某個服務時，該服務下所有的網路請求將不再顯示在 List 中。
 */
export function toggleServiceVisibility(fullName) {
  services.update(list => {
    return list.map(s => {
      if (s.fullName === fullName) {
        return { ...s, hidden: !s.hidden };
      }
      return s;
    });
  });
}

