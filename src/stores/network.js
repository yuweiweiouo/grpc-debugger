/**
 * 網路狀態管理 (Network Store)
 * 
 * 這是 Debugger 的數據中心，負責：
 * 1. 儲存與過濾網路請求紀錄 (gRPC Calls)。
 * 2. 實作複雜的解碼管線 (Extraction Pipeline)：處理 Base64、Gzip、gRPC Framing。
 * 3. 處理多來源同步 (Merge Logic)：合併來自 HAR 檔案與即時攔截的請求數據。
 */

import { writable, derived, get } from 'svelte/store';
import { protoEngine } from '../lib/proto-engine';
import { tryAutoReflection, hasReflected, services } from './schema';

// 原始日誌陣列
export const log = writable([]);
// UI 過濾關鍵字
export const filterValue = writable('');
// 目前選擇的日誌索引
export const selectedIdx = writable(null);
// 是否在清除時保留紀錄 (Preserve Log)
export const preserveLog = writable(true);

/**
 * 衍生日誌 (Filtered Log)
 * 根據使用者輸入的關鍵字以及服務的隱藏設定進行即時過濾。
 */
export const filteredLog = derived(
  [log, filterValue, services],
  ([$log, $filterValue, $services]) => {
    // 獲取所有使用者標記為隱藏的服務名稱
    const hiddenServiceNames = $services.filter(s => s.hidden).map(s => s.fullName);

    return $log.filter(entry => {
      // 1. 隱藏過濾：若該請求屬於被隱藏的服務，則不顯示
      const isHidden = hiddenServiceNames.some(serviceName => 
        entry.method && entry.method.startsWith(`/${serviceName}/`)
      );
      if (isHidden) return false;

      // 2. 關鍵字過濾：比對方法名或 Endpoint
      if (!$filterValue) return true;
      const lowerFilter = $filterValue.toLowerCase();
      return (
        entry.method.toLowerCase().includes(lowerFilter) || 
        entry.endpoint.toLowerCase().includes(lowerFilter)
      );
    });
  }
);

/**
 * 目前選擇的日誌條目
 */
export const selectedEntry = derived(
  [filteredLog, selectedIdx],
  ([$filteredLog, $selectedIdx]) => {
    if ($selectedIdx === null) return null;
    return $filteredLog[$selectedIdx];
  }
);

/**
 * 新增網路日誌 (Main Entry Point)
 * 
 * 流程：
 * 1. 格式化 Endpoint。
 * 2. 自動嘗試反射 (Auto-Reflection) 以獲取對應的 Schema。
 * 3. 執行解碼管線將二進位轉為 JS 物件。
 * 4. 合併邏輯：防止重複顯示相同的請求 (支援從不同來源更新同一個請求狀態)。
 * 
 * @param {object} entry 請求條目物件
 */
export async function addLog(entry) {
  // 從 /pkg.Service/Method 提取最後的 Method 名稱作為顯示用
  if (entry.method) {
    const parts = entry.method.split("/");
    entry.endpoint = parts.pop() || parts.pop();
  }

  // 自動同步：若遇到未知的 URL，嘗試進行 gRPC 反射
  const isNewSchema = await tryAutoReflection(entry.url);
  
  // 執行解碼流程
  await processEntry(entry);
  
  // 合併與更新邏輯 (Prevent Duplicates)
  log.update(list => {
    // 優先使用精確 ID 匹配 (由攔截器或 HAR 產生)
    let existingIdx = list.findIndex(e => e.id === entry.id);
    
    // 若 ID 不存在，嘗試模糊匹配 (處理跨來源但內容相同的請求)
    if (existingIdx === -1) {
      existingIdx = list.findIndex(e => 
        e.method === entry.method && 
        Math.abs(e.startTime - entry.startTime) < 1.5 &&
        e.status === 'pending'
      );
    }

    if (existingIdx !== -1) {
      const newList = [...list];
      // 合併數據：保留已有的攔截數據，並補全剩餘資訊
      newList[existingIdx] = { 
        ...newList[existingIdx], 
        ...entry,
        request: entry.request || newList[existingIdx].request,
        requestRaw: entry.requestRaw || newList[existingIdx].requestRaw,
        status: entry.status || 'finished'
      };
      return newList;
    }
    return [...list, entry];
  });

  // 如果有新產生的 Schema，則觸發「全局重新解析」以修復先前因缺少 Schema 而解析失敗的舊紀錄
  if (isNewSchema) {
    await reprocessAllLogs();
  }
}

/**
 * 重新處理所有日誌
 * 當 Reflection 成功後，我們可以回頭解析那些之前顯示為 "No Schema" 的請求。
 */
export async function reprocessAllLogs() {
  const currentLogs = get(log);
  
  if (!currentLogs || currentLogs.length === 0) return;

  // 對所有具備原始資料的項目執行重新解碼
  await Promise.all(
    currentLogs.map(entry => processEntry(entry, true))
  );
  
  // 通知 Svelte 更新 UI
  log.set([...currentLogs]);
}

/**
 * 清除所有日誌
 */
export function clearLogs(force = false) {
  if (get(preserveLog) && !force) return;
  log.set([]);
  selectedIdx.set(null);
}

/**
 * 核心處理：將 entry 中的 Raw 資料轉換為可讀物件
 */
async function processEntry(entry, forceReprocess = false) {
  const methodInfo = protoEngine.findMethod(entry.method);
  
  // 處理請求資料解碼
  if (entry.requestRaw && (forceReprocess || !entry.request)) {
    try {
      const payload = await extractPayload(entry.requestRaw, entry.requestBase64Encoded, entry.requestHeaders);
      if (payload) {
        const typeName = methodInfo?.requestType || null;
        entry.request = protoEngine.decodeMessage(typeName, payload);
      }
    } catch (e) {
      entry.request = { _error: e.message };
    }
  }

  // 處理回應資料解碼
  if (entry.responseRaw && (forceReprocess || !entry.response)) {
    try {
      const payload = await extractPayload(entry.responseRaw, entry.responseBase64Encoded, entry.responseHeaders);
      const typeName = methodInfo?.responseType || null;
      if (payload) {
        entry.response = protoEngine.decodeMessage(typeName, payload);
      }
    } catch (e) {
      entry.response = { _error: e.message };
    }
  }
}

// ============================================================================
// 解碼管線工具 (Extraction Pipeline Utilities)
// 處理各種網路層的編碼與封裝
// ============================================================================

/**
 * 從各種混雜格式中提取出純粹的 Protobuf Payload
 * 管線順序：Base64 轉原文字節 -> 處理 gRPC-Web-Text 多重編碼 -> Gzip 解壓 -> gRPC Framing 剝離
 */
async function extractPayload(data, isBase64, headers = {}) {
  const contentType = (headers['content-type'] || '').toLowerCase();
  
  // 1. 初始轉換為 Uint8Array
  let buffer = decodeInitialData(data, isBase64);
  
  // 2. 處理 grpc-web-text 特有的雙層 Base64 (整個 Body 都是 Base64)
  if (contentType.includes('grpc-web-text')) {
    buffer = handleGrpcWebText(buffer);
  }
  
  // 3. 處理 Gzip 壓縮內容
  const encoding = (headers['grpc-encoding'] || headers['connect-content-encoding'] || '').toLowerCase();
  if (encoding === 'gzip') {
    buffer = await decompressGzip(buffer);
  }
  
  // 4. 剝離 gRPC Framing (移除 5-byte 的 Length-Prefixed 標頭)
  const isGrpc = contentType.includes('grpc') || contentType.includes('connect');
  if (isGrpc) {
    const extracted = await extractGrpcFrames(buffer);
    if (extracted) return extracted;
  }
  
  return buffer;
}

/**
 * 處理資料來源的初始二進位化
 */
function decodeInitialData(data, isBase64) {
  if (typeof data === 'string') {
    return isBase64 
      ? Uint8Array.from(atob(data), c => c.charCodeAt(0)) 
      : new TextEncoder().encode(data);
  }
  return new Uint8Array(data);
}

/**
 * 解碼 grpc-web-text 的文字流
 * 此格式會將二進位資料重新以 Base64 編碼為可見字串以通過某些代理服務器。
 */
function handleGrpcWebText(buffer) {
  if (buffer.length === 0) return buffer;
  
  // 簡易檢測：若高機率已經是二進位（包含大量不可見字元），則不需再次 Base64 解析
  let nonPrintable = 0;
  const checkLen = Math.min(buffer.length, 64);
  for (let i = 0; i < checkLen; i++) {
    const c = buffer[i];
    if (c < 32 && c !== 10 && c !== 13 && c !== 9) nonPrintable++;
  }
  
  const isBinary = nonPrintable / checkLen > 0.1 || buffer[0] === 0 || buffer[0] === 1;
  if (isBinary) return buffer;
  
  try {
    const text = new TextDecoder().decode(buffer).replace(/[^A-Za-z0-9+/=]/g, '');
    if (text.length <= 4) return buffer;
    
    // 修正 Base64 Padding 並還原二進位
    let cleanText = text.replace(/=/g, '');
    while (cleanText.length % 4 !== 0) cleanText += '=';
    
    const binStr = atob(cleanText);
    const newBuf = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) {
      newBuf[i] = binStr.charCodeAt(i);
    }
    return newBuf;
  } catch {
    return buffer;
  }
}

/**
 * 使用主流瀏覽器內建的 DecompressionStream 進行解壓
 */
async function decompressGzip(buffer) {
  if (typeof DecompressionStream === 'undefined') return buffer;
  
  try {
    const ds = new DecompressionStream('gzip');
    const reader = new Response(buffer).body.pipeThrough(ds).getReader();
    const chunks = [];
    let totalLength = 0;
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalLength += value.length;
    }
    
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  } catch (e) {
    console.warn('[Network] Gzip 解壓失敗:', e);
    return buffer;
  }
}

/**
 * 剝離 gRPC LPM (Length-Prefixed Framing)
 * 格式：[Flags:1b] [Length:4b] [Payload:Nb]
 */
async function extractGrpcFrames(buffer) {
  let pos = 0;
  const messageChunks = [];
  let hasFraming = false;
  
  while (pos + 5 <= buffer.length) {
    hasFraming = true;
    const flags = buffer[pos];
    const length = (buffer[pos + 1] << 24) | (buffer[pos + 2] << 16) | (buffer[pos + 3] << 8) | buffer[pos + 4];
    
    const start = pos + 5;
    const end = start + length;
    
    if (end > buffer.length) break;
    
    // 僅處理 Data Frame (Bit 7 為 0)
    const isCompressed = (flags & 0x01) === 0x01;
    const isData = (flags & 0x80) === 0;
    
    if (isData) {
      let chunk = buffer.slice(start, end);
      // 若標頭顯示此 Frame 單獨被壓縮，則遞迴解壓
      if (isCompressed && length > 0) {
        chunk = await decompressGzip(chunk);
      }
      messageChunks.push(chunk);
    }
    pos = end;
  }
  
  if (!hasFraming) return null;
  
  // 合併多個 Frames (處理 Streaming 的情況)
  const totalLen = messageChunks.reduce((acc, c) => acc + c.length, 0);
  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of messageChunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return combined;
}

