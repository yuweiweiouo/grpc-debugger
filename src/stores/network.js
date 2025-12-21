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

export function addLog(entry) {
  if (entry.method) {
    const parts = entry.method.split("/");
    entry.endpoint = parts.pop() || parts.pop();
  }

  // Schema-Driven Decoding logic
  processEntry(entry);

  log.update(list => [...list, entry]);

  // Try auto-reflection if we don't have schema for this url
  if (entry.url && !protoEngine.serviceMap.has(entry.method)) {
    tryAutoReflection(entry.url).then(() => {
      // If reflection succeeded, re-process all logs that might now have schemas
      reprocessAllLogs();
    });
  }
}

export function reprocessAllLogs() {
  log.update(list => {
    list.forEach(entry => processEntry(entry));
    return [...list];
  });
}

export function clearLogs(force = false) {
  preserveLog.subscribe(preserve => {
    if (preserve && !force) return;
    log.set([]);
    selectedIdx.set(null);
  })();
}

function processEntry(entry) {
  const methodInfo = protoEngine.serviceMap.get(entry.method);
  
  // Decoding Request
  if (entry.requestRaw && !entry.request) {
    try {
      // Basic gRPC-Web frame decoding is still needed before proto decoding
      const payload = extractPayload(entry.requestRaw, entry.requestBase64Encoded);
      if (payload && methodInfo) {
        entry.request = protoEngine.decodeMessage(methodInfo.requestType, payload);
      }
    } catch (e) {
      entry.request = { _error: e.message };
    }
  }

  // Decoding Response
  if (entry.responseRaw && !entry.response) {
    try {
      const payload = extractPayload(entry.responseRaw, entry.responseBase64Encoded);
      if (payload && methodInfo) {
        entry.response = protoEngine.decodeMessage(methodInfo.responseType, payload);
      }
    } catch (e) {
      entry.response = { _error: e.message };
    }
  }
}

function extractPayload(data, isBase64) {
  let buffer;
  if (typeof data === 'string') {
    buffer = isBase64 ? Uint8Array.from(atob(data), c => c.charCodeAt(0)) : new TextEncoder().encode(data);
  } else {
    buffer = new Uint8Array(data);
  }
  
  // Skip gRPC-Web 5-byte header
  if (buffer.length >= 5) {
    const length = (buffer[1] << 24) | (buffer[2] << 16) | (buffer[3] << 8) | buffer[4];
    return buffer.slice(5, 5 + length);
  }
  return buffer;
}
