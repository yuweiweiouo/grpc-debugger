import { writable, derived, get } from 'svelte/store';
import { protoEngine } from '../lib/proto-engine';
import { tryAutoReflection, hasReflected } from './schema';

export const log = writable([]);
export const filterValue = writable('');
export const selectedIdx = writable(null);
export const preserveLog = writable(true);

export const filteredLog = derived(
  [log, filterValue],
  ([$log, $filterValue]) => {
    if (!$filterValue) return $log;
    const lowerFilter = $filterValue.toLowerCase();
    return $log.filter(entry => 
      entry.method.toLowerCase().includes(lowerFilter) || 
      entry.endpoint.toLowerCase().includes(lowerFilter)
    );
  }
);

export const selectedEntry = derived(
  [filteredLog, selectedIdx],
  ([$filteredLog, $selectedIdx]) => {
    if ($selectedIdx === null) return null;
    return $filteredLog[$selectedIdx];
  }
);

/**
 * 新增網路日誌
 * 1. 先確保 reflection 完成（如果需要）
 * 2. 使用正確的 schema 解碼
 * 3. 如果是首次載入 schema，重新處理舊 logs
 */
export async function addLog(entry) {
  if (entry.method) {
    const parts = entry.method.split("/");
    entry.endpoint = parts.pop() || parts.pop();
  }

  // 確保 reflection 完成後再解碼
  const isNewSchema = await tryAutoReflection(entry.url);
  
  // 解碼（此時 schema 一定已載入或確認不可用）
  await processEntry(entry);
  
  // 加入 log
  log.update(list => [...list, entry]);

  // 如果剛載入了新 schema，重新處理之前的所有 logs
  if (isNewSchema) {
    await reprocessAllLogs();
  }
}

/**
 * 重新處理所有日誌（在 schema 載入後呼叫）
 */
export async function reprocessAllLogs() {
  const currentLogs = get(log);
  
  if (!currentLogs || currentLogs.length === 0) {
    console.debug(`[Network] No logs to reprocess`);
    return;
  }

  console.debug(`[Network] Reprocessing ${currentLogs.length} entries`);
  console.debug(`[Network] serviceMap size: ${protoEngine.serviceMap.size}`);
  console.debug(`[Network] schemas size: ${protoEngine.schemas.size}`);
  
  if (protoEngine.serviceMap.size > 0) {
    console.debug(`[Network] Available methods:`, [...protoEngine.serviceMap.keys()]);
  }

  // 強制重新解碼所有有原始資料的 entries
  await Promise.all(
    currentLogs.map(entry => processEntry(entry, true))
  );
  
  // 觸發 UI 更新
  log.set([...currentLogs]);
  
  console.debug(`[Network] Reprocessing complete`);
}

export function clearLogs(force = false) {
  if (get(preserveLog) && !force) return;
  log.set([]);
  selectedIdx.set(null);
}

/**
 * 處理單一 entry 的解碼
 * @param {object} entry
 * @param {boolean} forceReprocess - 強制重新解碼
 */
async function processEntry(entry, forceReprocess = false) {
  const methodInfo = protoEngine.findMethod(entry.method);
  
  // Request 解碼
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

  // Response 解碼
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
// Payload Extraction Utilities
// ============================================================================

/**
 * 從原始資料提取 Protobuf payload（主協調函數）
 * @param {string | Uint8Array} data - 原始資料
 * @param {boolean} isBase64 - 是否需要 Base64 解碼
 * @param {object} headers - HTTP headers
 * @returns {Promise<Uint8Array>} - 解碼後的 payload
 */
async function extractPayload(data, isBase64, headers = {}) {
  const contentType = (headers['content-type'] || '').toLowerCase();
  
  // Step 1: 初始 Base64 解碼
  let buffer = decodeInitialData(data, isBase64);
  
  // Step 2: 處理 grpc-web-text 雙層 Base64
  if (contentType.includes('grpc-web-text')) {
    buffer = handleGrpcWebText(buffer);
  }
  
  // Step 3: 全域 Gzip 解壓
  const encoding = (headers['grpc-encoding'] || headers['connect-content-encoding'] || '').toLowerCase();
  if (encoding === 'gzip') {
    buffer = await decompressGzip(buffer);
  }
  
  // Step 4: 提取 gRPC Framing
  const isGrpc = contentType.includes('grpc') || contentType.includes('connect');
  if (isGrpc) {
    const extracted = await extractGrpcFrames(buffer);
    if (extracted) return extracted;
  }
  
  return buffer;
}

/**
 * 初始資料解碼（Base64 或字串轉 Uint8Array）
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
 * 處理 grpc-web-text 的雙層 Base64 問題
 * HAR 可能會先 Base64 編碼，然後資料本身又是 Base64
 */
function handleGrpcWebText(buffer) {
  if (buffer.length === 0) return buffer;
  
  // 檢查是否已經是二進位資料（包含不可列印字元或以 gRPC frame flag 開頭）
  let nonPrintable = 0;
  const checkLen = Math.min(buffer.length, 64);
  for (let i = 0; i < checkLen; i++) {
    const c = buffer[i];
    if (c < 32 && c !== 10 && c !== 13 && c !== 9) nonPrintable++;
  }
  
  const isBinary = nonPrintable / checkLen > 0.1 || buffer[0] === 0 || buffer[0] === 1;
  if (isBinary) return buffer;
  
  // 嘗試 Base64 解碼
  try {
    const text = new TextDecoder().decode(buffer).replace(/[^A-Za-z0-9+/=]/g, '');
    if (text.length <= 4) return buffer;
    
    // 修正 padding
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
 * Gzip 解壓縮
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
    console.warn('[Network] Gzip decompression failed:', e);
    return buffer;
  }
}

/**
 * 提取 gRPC Length-Prefixed Framing 中的資料
 * 返回 null 表示沒有有效的 framing
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
    
    if (end > buffer.length) {
      console.warn(`[extractPayload] Frame length ${length} exceeds buffer ${buffer.length}`);
      break;
    }
    
    // gRPC Flags: bit 0 = compression, bit 7 = trailers
    const isCompressed = (flags & 0x01) === 0x01;
    const isData = (flags & 0x80) === 0;
    
    if (isData) {
      let chunk = buffer.slice(start, end);
      
      if (isCompressed && length > 0) {
        chunk = await decompressGzip(chunk);
      }
      
      messageChunks.push(chunk);
    }
    
    pos = end;
  }
  
  if (!hasFraming) return null;
  
  // 合併所有資料塊
  const totalLen = messageChunks.reduce((acc, c) => acc + c.length, 0);
  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of messageChunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return combined;
}
