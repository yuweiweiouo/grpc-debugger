// @ts-nocheck
/* global chrome */
// DevTools Entry Point - gRPC Debugger v2.24
// 使用 FIFO + Path 策略匹配，無 pending 條目（避免 Race Condition）

import {
  BASE_POLL_INTERVAL_MS,
  computeNextPollDelay,
  decodePolledCalls,
  EMPTY_POLL_RESULT,
} from './devtools-polling.ts';
import { PAGE_MANAGED_CALL_QUEUE_FLAG } from './call-queue-mode.ts';

/**
 * 檢查是否為 gRPC-Web 請求
 */
function isGrpcWebRequest(entry) {
  const contentType = entry.request?.postData?.mimeType || '';
  const responseType = entry.response?.content?.mimeType || '';
  return (
    contentType.includes('grpc-web') ||
    contentType.includes('application/grpc') ||
    responseType.includes('grpc-web') ||
    responseType.includes('application/grpc')
  );
}

/**
 * 從 URL 提取 gRPC 方法路徑
 */
function extractMethodFromUrl(url) {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(Boolean);
    if (pathParts.length >= 2) {
      return '/' + pathParts.join('/');
    }
    return urlObj.pathname;
  } catch {
    return url;
  }
}

/**
 * 將 HAR headers 陣列轉換為物件
 */
function headersToObject(headers) {
  const result = {};
  for (const h of headers || []) {
    result[h.name.toLowerCase()] = h.value;
  }
  return result;
}

/**
 * 解析 gRPC 狀態碼
 */
function parseGrpcStatus(headers) {
  const grpcStatus = headers['grpc-status'];
  const grpcMessage = headers['grpc-message'];
  return {
    code: grpcStatus ? parseInt(grpcStatus, 10) : null,
    message: grpcMessage ? decodeURIComponent(grpcMessage) : null,
  };
}

// 緩存
const pendingEntries = [];
let panelWindow = null;
let panelReady = false;
let currentPollDelayMs = BASE_POLL_INTERVAL_MS;

// v2.23: 使用 Map(path => Array) 儲存，配合 FIFO 匹配
const capturedBodies = new Map();

/**
 * 正規化 URL
 */
function normalizeUrlFuzzy(url) {
  try {
    const u = new URL(url);
    return u.pathname.replace(/\/$/, "");
  } catch {
    if (typeof url === 'string') {
      const pathOnly = url.split('?')[0].split('#')[0];
      return pathOnly.replace(/\/$/, "");
    }
    return url;
  }
}

// 監聽來自 background 的訊息（統一透過 chrome.runtime.sendMessage 廣播）
chrome.runtime.onMessage.addListener((message) => {
  // 處理 fetch-interceptor 攔截的 request body 快取
  if (message.type === '__GRPCWEB_DEVTOOLS__' && message.action === 'capturedRequestBody') {
    const fuzzyUrl = message.path || normalizeUrlFuzzy(message.url);
    const internalId = 'ghost-' + Math.random().toString(36).substring(2, 9);
    const requestHash = message.requestHash || 'no-hash';
    
    console.log(`[gRPC Debugger v2.24] 👻 Ghost Intercepted: ${fuzzyUrl} [ID: ${internalId}]`);
    
    // v2.24: 只緩存，不發送 pending 條目（避免 Race Condition）
    if (!capturedBodies.has(fuzzyUrl)) {
      capturedBodies.set(fuzzyUrl, []);
    }
    
    const interceptData = {
      id: internalId,
      requestHash,
      bodyBase64: message.bodyBase64,
      timestamp: message.timestamp || Date.now(),
      url: message.url
    };
    
    capturedBodies.get(fuzzyUrl).push(interceptData);

    // 定期清理
    const now = Date.now();
    for (const [path, queue] of capturedBodies.entries()) {
      const filtered = queue.filter(q => now - q.timestamp < ENTRY_CACHE_TTL_MS);
      if (filtered.length === 0) {
        capturedBodies.delete(path);
      } else {
        capturedBodies.set(path, filtered);
      }
    }
  }
});

// ============================================================================
// PostMessage Interceptor — 直接注入到頁面
// 
// 使用 inspectedWindow.eval 在頁面 main world 注入 message listener，
// 完全不依賴 content-script 或 injector 的載入時機。
// ============================================================================

const MAX_MATCH_RETRIES = 30;
const MATCH_RETRY_DELAY_MS = 100;
const ENTRY_CACHE_TTL_MS = 60000;

function scheduleInterceptorPoll(delayMs = currentPollDelayMs) {
  setTimeout(pollInterceptorCalls, delayMs);
}

/**
 * 透過 inspectedWindow.eval 在頁面注入 postMessage 監聽器
 * 監聽 __GRPCWEB_DEVTOOLS__ type + gRPCNetworkCall action
 */
function injectCallCaptureListener() {
  chrome.devtools.inspectedWindow.eval(`
    (function() {
      if (window.__GRPC_DEBUGGER_LISTENER_INJECTED__) return;
      if (window['${PAGE_MANAGED_CALL_QUEUE_FLAG}']) {
        window.__GRPC_DEBUGGER_LISTENER_INJECTED__ = true;
        return;
      }
      window.__GRPC_DEBUGGER_LISTENER_INJECTED__ = true;
      window.__GRPC_CALLS_QUEUE__ = [];
      
      window.addEventListener('message', function(event) {
        if (event.source !== window) return;
        var msg = event.data;
        if (msg && msg.type === '__GRPCWEB_DEVTOOLS__' && msg.action === 'gRPCNetworkCall') {
          window.__GRPC_CALLS_QUEUE__.push({
            method: msg.method || '',
            methodType: msg.methodType || 'unary',
            request: msg.request || null,
            response: msg.response || null,
            error: msg.error || null,
            timestamp: Date.now()
          });
        }
      });
    })();
  `);
}

// DevTools 開啟時立即注入
injectCallCaptureListener();

// 頁面導覽後重新注入（因為 listener 會隨頁面卸載消失）
chrome.devtools.network.onNavigated.addListener(() => {
  injectCallCaptureListener();
});

/**
 * 輪詢：從頁面佇列中 drain call data
 */
function pollInterceptorCalls() {
  chrome.devtools.inspectedWindow.eval(
    `(function() {
       var q = window.__GRPC_CALLS_QUEUE__;
       if (!q || q.length === 0) return '${EMPTY_POLL_RESULT}';
       window.__GRPC_CALLS_QUEUE__ = [];
       return JSON.stringify(q);
     })()`,
    (result, isException) => {
      let hadCalls = false;

      try {
        const calls = isException ? [] : decodePolledCalls(result);
        hadCalls = calls.length > 0;
        for (const call of calls) {
          const method = call.method?.startsWith('/') ? call.method : `/${call.method || ''}`;
          const parts = method.split('/');
          const endpoint = parts.pop() || parts.pop();
          
          const data = {
            id: `interceptor-${call.timestamp || Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            method,
            endpoint,
            methodType: call.methodType || 'unary',
            request: call.request,
            response: call.error
              ? { _error: call.error.message || String(call.error), _code: call.error.code }
              : call.response,
            error: call.error || null,
            status: 'finished',
            startTime: (call.timestamp || Date.now()) / 1000,
            _source: 'interceptor',
          };

          if (panelWindow?.dispatchGrpcEvent) {
            panelWindow.dispatchGrpcEvent(data);
          } else {
            pendingEntries.push(data);
          }
        }
      } catch (e) {
        // JSON parse 失敗時靜默忽略
      } finally {
        currentPollDelayMs = computeNextPollDelay({
          hadCalls,
          currentDelayMs: currentPollDelayMs,
        });
        scheduleInterceptorPoll();
      }
    }
  );
}

// 啟動輪詢
scheduleInterceptorPoll();

/**
 * 處理並發送 gRPC 請求到面板
 */
function processEntry(entry) {
  const method = extractMethodFromUrl(entry.request.url);
  const parts = method.split('/');
  const endpoint = parts.pop() || parts.pop();
  const responseHeaders = headersToObject(entry.response.headers);
  const grpcStatus = parseGrpcStatus(responseHeaders);

  entry.getContent(async (body, encoding) => {
    const fuzzyUrl = normalizeUrlFuzzy(entry.request.url);
    const harStartTime = new Date(entry.startedDateTime).getTime();
    
    let captured = null;
    
    // v2.23: 使用 FIFO 策略 - 直接取隊列第一個
    // 前提假設：同一 path 的攔截順序 = HAR 觸發順序
    let retryCount = 0;
    
    while (retryCount < MAX_MATCH_RETRIES) {
      const queue = capturedBodies.get(fuzzyUrl);
      if (queue && queue.length > 0) {
        captured = queue.shift(); // FIFO: 取出第一個
        if (queue.length === 0) capturedBodies.delete(fuzzyUrl);
        break;
      }
      
      if (!entry.request.postData) break;
      
      await new Promise(res => setTimeout(res, MATCH_RETRY_DELAY_MS));
      retryCount++;
    }

    const requestRaw = captured?.bodyBase64 || entry.request.postData?.text || null;
    const requestBase64Encoded = !!captured?.bodyBase64;
    
    if (captured) {
      console.log(`[gRPC Debugger v2.24] ✅ Ghost Matched (FIFO): ${fuzzyUrl} [ID: ${captured.id}]`);
    } else if (entry.request.postData?.text) {
      console.warn(`[gRPC Debugger v2.24] ❌ Ghost Missed: ${fuzzyUrl}`);
    }
    
    const data = {
      id: captured?.id || (entry.startedDateTime + '_' + entry.request.url),
      method,
      endpoint,
      methodType: 'unary',
      url: entry.request.url,
      startTime: harStartTime / 1000,
      duration: entry.time,
      size: entry.response.bodySize,
      httpStatus: entry.response.status,
      requestHeaders: headersToObject(entry.request.headers),
      responseHeaders,
      grpcStatus: grpcStatus.code,
      grpcMessage: grpcStatus.message,
      requestRaw,
      requestBase64Encoded,
      responseRaw: body,
      responseBase64Encoded: encoding === 'base64',
      status: 'finished',
      _isUpdate: !!captured
    };

    if (panelReady && panelWindow?.dispatchGrpcEvent) {
      panelWindow.dispatchGrpcEvent(data);
    } else {
      pendingEntries.push(data);
    }
  });
}

/**
 * 發送所有緩存的請求到面板
 */
function flushPendingEntries() {
  if (!panelWindow?.dispatchGrpcEvent) return;
  
  while (pendingEntries.length > 0) {
    const data = pendingEntries.shift();
    panelWindow.dispatchGrpcEvent(data);
  }
}

// 建立 DevTools 面板
chrome.devtools.panels.create('gRPC Debugger', 'launchericon-48-48.png', 'index.html', (panel) => {
  panel.onShown.addListener((win) => {
    panelWindow = win;
    
    if (!panelReady) {
      panelReady = true;
      setTimeout(flushPendingEntries, 100);
    } else {
      flushPendingEntries();
    }
  });

  panel.onHidden.addListener(() => {
    // 保持引用
  });
});

// 監聽網路請求完成事件
chrome.devtools.network.onRequestFinished.addListener((entry) => {
  if (!isGrpcWebRequest(entry)) return;
  processEntry(entry);
});
