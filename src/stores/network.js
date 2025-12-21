import { writable, derived } from 'svelte/store';
import { protoEngine } from '../lib/proto-engine';
import { tryAutoReflection } from './schema';

export const log = writable([]);
export const filterValue = writable('');
export const selectedIdx = writable(null);
export const preserveLog = writable(false);

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

export async function addLog(entry) {
  if (entry.method) {
    const parts = entry.method.split("/");
    entry.endpoint = parts.pop() || parts.pop();
  }

  // Schema-Driven Decoding logic (MUST await now)
  await processEntry(entry);

  log.update(list => [...list, entry]);

  // Try auto-reflection if we don't have schema for this url
  if (entry.url && !protoEngine.serviceMap.has(entry.method)) {
    tryAutoReflection(entry.url).then(() => {
      // If reflection succeeded, re-process all logs that might now have schemas
      reprocessAllLogs();
    });
  }
}

export async function reprocessAllLogs() {
  let currentLogs;
  log.subscribe(l => currentLogs = l)();
  
  if (!currentLogs) return;

  // Clear old decoded results to force re-decode
  for (const entry of currentLogs) {
    entry.request = null;
    entry.response = null;
  }

  // Process all entries in parallel
  await Promise.all(currentLogs.map(entry => processEntry(entry)));
  
  // Trigger update
  log.set([...currentLogs]);
}

export function clearLogs(force = false) {
  preserveLog.subscribe(preserve => {
    if (preserve && !force) return;
    log.set([]);
    selectedIdx.set(null);
  })();
}

async function processEntry(entry) {
  const methodInfo = protoEngine.serviceMap.get(entry.method);
  
  if (!methodInfo && entry.method) {
    console.debug(`[Network] No method info for: ${entry.method}`);
  }
  
  // Decoding Request
  if (entry.requestRaw && !entry.request) {
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

  // Decoding Response
  if (entry.responseRaw && !entry.response) {
    try {
      const payload = await extractPayload(entry.responseRaw, entry.responseBase64Encoded, entry.responseHeaders);
      if (payload) {
        const typeName = methodInfo?.responseType || null;
        entry.response = protoEngine.decodeMessage(typeName, payload);
      }
    } catch (e) {
      entry.response = { _error: e.message };
    }
  }
}

async function extractPayload(data, isBase64, headers = {}) {
  let buffer;
  if (typeof data === 'string') {
    buffer = isBase64 ? Uint8Array.from(atob(data), c => c.charCodeAt(0)) : new TextEncoder().encode(data);
  } else {
    buffer = new Uint8Array(data);
  }
  
  if (buffer.length === 0) return null;

  // 1. Handle Compression
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
      
      const newBuffer = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        newBuffer.set(chunk, offset);
        offset += chunk.length;
      }
      buffer = newBuffer;
    } catch (e) {
      console.warn("[Network] Gzip decompression failed:", e);
    }
  }

  // 2. Handle gRPC-Web / Connect Length-Prefixed Framing
  let pos = 0;
  const messageChunks = [];
  
  while (pos + 5 <= buffer.length) {
    const flags = buffer[pos];
    const length = (buffer[pos + 1] << 24) | (buffer[pos + 2] << 16) | (buffer[pos + 3] << 8) | buffer[pos + 4];
    
    const start = pos + 5;
    const end = start + length;
    
    if (end > buffer.length) break;

    // In most gRPC-Web cases, flags=0 is data. 
    // However, some implementations might use flags=1 for compression (if not handle at transport layer).
    // The most robust way is to aggregate everything that isn't a known Control Frame.
    const isData = (flags & 0x01) === 0; // Skip Trailers (bit 0 set)
    
    if (isData) {
      messageChunks.push(buffer.slice(start, end));
    }
    
    pos = end;
  }

  if (messageChunks.length > 0) {
    // Combine all data frames (usually just one, but streaming has multiple)
    const totalLen = messageChunks.reduce((acc, c) => acc + c.length, 0);
    const combined = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of messageChunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    return combined;
  }

  return buffer; // Fallback to raw if no framing detected
}
