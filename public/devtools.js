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

/**
 * 處理並發送 gRPC 請求到面板
 */
function processEntry(entry) {
  const method = extractMethodFromUrl(entry.request.url);
  const parts = method.split('/');
  const endpoint = parts.pop() || parts.pop();
  const requestHeaders = headersToObject(entry.request.headers);
  const responseHeaders = headersToObject(entry.response.headers);
  const grpcStatus = parseGrpcStatus(responseHeaders);

  entry.getContent((body, encoding) => {
    const data = {
      id: entry.startedDateTime + '_' + entry.request.url,
      method,
      endpoint,
      methodType: 'unary',
      url: entry.request.url,
      startTime: new Date(entry.startedDateTime).getTime() / 1000,
      duration: entry.time,
      size: entry.response.bodySize,
      httpStatus: entry.response.status,
      requestHeaders,
      responseHeaders,
      grpcStatus: grpcStatus.code,
      grpcMessage: grpcStatus.message,
      requestRaw: entry.request.postData?.text || null,
      responseRaw: body,
      responseBase64Encoded: encoding === 'base64',
      request: null,
      response: null,
      error: null,
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
