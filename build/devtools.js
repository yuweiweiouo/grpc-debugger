/* global chrome */
// DevTools Entry Point - gRPC Debugger v2.24
// 使用 FIFO + Path 策略匹配，無 pending 條目（避免 Race Condition）

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

// 監聽來自 background 的攔截訊息
chrome.runtime.onMessage.addListener((message) => {
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
      const filtered = queue.filter(q => now - q.timestamp < 60000);
      if (filtered.length === 0) {
        capturedBodies.delete(path);
      } else {
        capturedBodies.set(path, filtered);
      }
    }
  }
});

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
    const maxRetries = 30;
    
    while (retryCount < maxRetries) {
      const queue = capturedBodies.get(fuzzyUrl);
      if (queue && queue.length > 0) {
        captured = queue.shift(); // FIFO: 取出第一個
        if (queue.length === 0) capturedBodies.delete(fuzzyUrl);
        break;
      }
      
      if (!entry.request.postData) break;
      
      await new Promise(res => setTimeout(res, 100));
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
