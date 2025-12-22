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

/**
 * 從原始資料提取 Protobuf payload
 */
async function extractPayload(data, isBase64, headers = {}) {
  let buffer;
  const contentType = (headers['content-type'] || '').toLowerCase();
  
  // 1. 初始解碼 (Base64 or String/Uint8Array)
  if (typeof data === 'string') {
    // 如果是 grpc-web-text，通常資料本身就是 Base64
    buffer = isBase64 ? Uint8Array.from(atob(data), c => c.charCodeAt(0)) : new TextEncoder().encode(data);
  } else {
    buffer = new Uint8Array(data);
  }
  
  // 2. 處理 application/grpc-web-text
  // 為了解決雙層 Base64 問題 (HAR Base64 -> ASCII Text(Base64) -> Binary)
  if (contentType.includes('grpc-web-text') && buffer.length > 0) {
    // 檢查特徵：如果 buffer 開頭已經是 0x00 (Data) 或 0x01 (Trailer)，
    // 或者包含大量不可列印字元，表示它已經是二進位框架，不需要再 atob
    let nonPrintable = 0;
    const checkLen = Math.min(buffer.length, 64);
    for (let i = 0; i < checkLen; i++) {
      const c = buffer[i];
      if (c < 32 && c !== 10 && c !== 13 && c !== 9) nonPrintable++;
    }

    // 如果不可列印字元多於 10%，或開頭明顯是 gRPC Frame Flag (0 或 1)，則跳過
    const isBinary = nonPrintable / checkLen > 0.1 || buffer[0] === 0 || buffer[0] === 1;

    if (!isBinary) {
      try {
        // 將 buffer 轉回字串並過濾無效字元
        const text = new TextDecoder().decode(buffer)
          .replace(/[^A-Za-z0-9+/=]/g, '');
        
        if (text.length > 4) {
          // 清除內部無效的 '=' (只保留結尾的)
          let cleanText = text.replace(/=/g, '');
          while (cleanText.length % 4 !== 0) cleanText += '=';
          
          try {
            const binStr = atob(cleanText);
            const newBuf = new Uint8Array(binStr.length);
            for (let i = 0; i < binStr.length; i++) {
              newBuf[i] = binStr.charCodeAt(i);
            }
            buffer = newBuf;
          } catch (e) {
            // 如果 atob 仍然失敗，說明資料雖然是 ASCII 但不是合法的 Base64
            console.debug("[Network] ASCII detected but not Base64, skipping conversion");
          }
        }
      } catch (e) {
        console.warn("[Network] gRPC-Web-Text pre-parse failed:", e);
      }
    }
  }

  // 3. 處理 Gzip 壓縮
  const encoding = (headers['grpc-encoding'] || headers['connect-content-encoding'] || '').toLowerCase();
  if (encoding === 'gzip' && typeof DecompressionStream !== 'undefined') {
    try {
      const ds = new DecompressionStream('gzip');
      const decompressionResponse = new Response(buffer);
      const reader = decompressionResponse.body.pipeThrough(ds).getReader();
      const chunks = [];
      let totalLength = 0;
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        totalLength += value.length;
      }
      
      buffer = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        buffer.set(chunk, offset);
        offset += chunk.length;
      }
    } catch (e) {
      console.warn("[Network] Gzip decompression failed:", e);
    }
  }

  // 4. 處理 gRPC Length-Prefixed Framing (5-byte header)
  const isGrpc = contentType.includes('grpc') || contentType.includes('connect');
  if (isGrpc) {
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
        console.warn(`[extractPayload] Frame length ${length} extends beyond buffer ${buffer.length}`);
        break;
      }

      // gRPC Flags: bit 0 (0x01) is compression, bit 7 (0x80) is trailers
      const isCompressed = (flags & 0x01) === 0x01;
      const isData = (flags & 0x80) === 0;
      
      if (isData) {
        let chunk = buffer.slice(start, end);
        
        // 處理 compressed frame
        if (isCompressed && length > 0 && typeof DecompressionStream !== 'undefined') {
          try {
            const ds = new DecompressionStream('gzip'); 
            const decompressed = await new Response(chunk).body.pipeThrough(ds);
            chunk = new Uint8Array(await new Response(decompressed).arrayBuffer());
          } catch (e) {
            console.warn("[Network] Per-frame decompression failed:", e);
          }
        }
        
        messageChunks.push(chunk);
      }
      
      pos = end;
    }

    if (hasFraming) {
      const totalLen = messageChunks.reduce((acc, c) => acc + c.length, 0);
      const combined = new Uint8Array(totalLen);
      let offset = 0;
      for (const chunk of messageChunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      return combined;
    }
  }

  return buffer;
}
