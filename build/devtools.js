/* global chrome */
// DevTools Entry Point - 建立 gRPC Debugger 面板並設定 HAR 監聽

/**
 * 檢查是否為 gRPC-Web 請求
 * @param {Object} entry - HAR Entry
 * @returns {boolean}
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
 * @param {string} url
 * @returns {string}
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
 * @param {Array<{name: string, value: string}>} headers
 * @returns {Object.<string, string>}
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
 * @param {Object.<string, string>} headers
 * @returns {{code: number | null, message: string | null}}
 */
function parseGrpcStatus(headers) {
  const grpcStatus = headers['grpc-status'];
  const grpcMessage = headers['grpc-message'];
  return {
    code: grpcStatus ? parseInt(grpcStatus, 10) : null,
    message: grpcMessage ? decodeURIComponent(grpcMessage) : null,
  };
}

// 緩存等待中的請求（在面板尚未準備好時）
const pendingEntries = [];
let panelWindow = null;
let panelReady = false;

// 緩存從 fetch-interceptor 攔截的 request bodies
const capturedBodies = new Map();

/**
 * 正規化 URL (Fuzzy Match): 移除 protocol, hostname (可選), query 與 hash
 * 用於極端情況下的異步通訊匹配
 */
function normalizeUrlFuzzy(url) {
  try {
    const u = new URL(url);
    // v2.7: 兩端統一只保留 Pathname。
    return u.pathname.replace(/\/$/, "");
  } catch {
    // 處理相對路徑或格式錯誤
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
    const fuzzyUrl = normalizeUrlFuzzy(message.url);
    const internalId = 'ghost-' + Math.random().toString(36).substring(2, 9);
    
    console.log(`[gRPC Debugger v2.10] 👻 Ghost Intercepted: ${fuzzyUrl} [Allocated UI ID: ${internalId}]`);
    
    // v2.10: 使用 FIFO 隊列存儲，解決併發併發
    if (!capturedBodies.has(fuzzyUrl)) {
      capturedBodies.set(fuzzyUrl, []);
    }
    
    const interceptData = {
      id: internalId,
      bodyBase64: message.bodyBase64,
      timestamp: message.timestamp || Date.now(),
      url: message.url
    };
    
    capturedBodies.get(fuzzyUrl).push(interceptData);

    // --- Dual-Stream Sync: 立即發送佔位請求到 UI ---
    const method = extractMethodFromUrl(message.url);
    const parts = method.split('/');
    const endpoint = parts.pop() || parts.pop();

    const pendingData = {
      id: internalId,
      method,
      endpoint,
      methodType: 'unary',
      url: message.url,
      startTime: interceptData.timestamp / 1000,
      status: 'pending',
      requestRaw: message.bodyBase64,
      requestBase64Encoded: true,
      _isPending: true
    };

    if (panelReady && panelWindow?.dispatchGrpcEvent) {
      panelWindow.dispatchGrpcEvent(pendingData);
    } else {
      pendingEntries.push(pendingData);
    }

    // 定期清理 (只保留最近 100 個請求或 60 秒內的數據)
    const now = Date.now();
    for (const [path, queue] of capturedBodies.entries()) {
      capturedBodies.set(path, queue.filter(q => now - q.timestamp < 60000).slice(-100));
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
    
    // v2.10 Race Condition Fix: 
    // 強制等待最多 3 秒，確保攔截器訊息 (A流) 跳過四層 Message Bus 後到達
    let retryCount = 0;
    const maxRetries = 30; // 30 * 100ms = 3s
    
    while (retryCount < maxRetries) {
      const queue = capturedBodies.get(fuzzyUrl);
      if (queue && queue.length > 0) {
        // 尋找最匹配的幽靈請求 (時間戳相差 2 秒內)
        let bestMatchIdx = -1;
        let minDiff = 2000;

        for (let i = 0; i < queue.length; i++) {
          const diff = Math.abs(queue[i].timestamp - harStartTime);
          if (diff < minDiff) {
            minDiff = diff;
            bestMatchIdx = i;
          }
        }

        if (bestMatchIdx !== -1) {
          captured = queue.splice(bestMatchIdx, 1)[0];
          break;
        }
      }
      
      // 只有在真的有 postData 的情況下才需要死等攔截器
      if (!entry.request.postData) break;
      
      await new Promise(res => setTimeout(res, 100));
      retryCount++;
    }

    const requestRaw = captured?.bodyBase64 || entry.request.postData?.text || null;
    const requestBase64Encoded = !!captured?.bodyBase64;
    
    if (captured) {
      console.log(`[gRPC Debugger v2.10] ✅ Ghost Matched: ${fuzzyUrl} [Match Diff: ${Math.abs(captured.timestamp - harStartTime)}ms]`);
    } else if (entry.request.postData?.text) {
      console.warn(`[gRPC Debugger v2.10] ❌ Ghost Missed for ${fuzzyUrl} after 3s. Possible missing interceptor or wrong path.`);
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
      _isUpdate: !!captured // 如果有 captured 代表這是在補完之前的 Pending
    };

    if (panelReady && panelWindow?.dispatchGrpcEvent) {
      panelWindow.dispatchGrpcEvent(data);
    } else {
      // 緩存請求，等面板準備好再發送
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
  // 監聽面板開啟事件
  panel.onShown.addListener((win) => {
    panelWindow = win;
    
    // 面板第一次顯示時，標記為準備好並發送緩存的請求
    if (!panelReady) {
      panelReady = true;
      // 延遲一小段時間確保 dispatchGrpcEvent 已註冊
      setTimeout(flushPendingEntries, 100);
    } else {
      // 面板重新顯示時也發送緩存的請求
      flushPendingEntries();
    }
  });

  panel.onHidden.addListener(() => {
    // 面板隱藏時不設為 null，保持引用以便在背景處理請求
    // panelWindow = null;
  });
});

// 監聽網路請求完成事件（在 panel.create 外面，確保一直監聽）
chrome.devtools.network.onRequestFinished.addListener((entry) => {
  if (!isGrpcWebRequest(entry)) return;
  processEntry(entry);
});
