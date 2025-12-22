/**
 * gRPC Debugger - Robust Interceptor v2.3 (Ironclad)
 * 攔截 fetch 與 XHR 請求，包含版本化日誌與同步 XHR 支援
 */
(function() {
  const VERSION = "v2.16";
  const GRPC_CONTENT_TYPES = ['grpc', 'connect'];
  
  /**
   * 正規化 URL (Fuzzy Match): 移除 protocol, query 與 hash
   */
  function normalizeUrlFuzzy(url) {
    try {
      // v2.7: 只保留 Pathname。
      // 這是為了避免 hostname/port 在不同環境（localhost/dev）
      // 以及不同獲取來源（Fetch/XHR vs HAR）之間的格式差異。
      const u = new URL(url, window.location.href);
      return u.pathname.replace(/\/$/, "");
    } catch {
      // 如果不是絕對路徑，嘗試處理相對路徑
      if (typeof url === 'string') {
        const pathOnly = url.split('?')[0].split('#')[0];
        return pathOnly.replace(/\/$/, "");
      }
      return url;
    }
  }

  /**
   * 高效將 ArrayBuffer/Uint8Array 轉為 Base64
   */
  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
  
  /**
   * 檢查是否為 gRPC 相關請求
   */
  function isGrpcRequest(contentType) {
    if (!contentType) return false;
    const ct = contentType.toLowerCase();
    // v2.7: 擴大判定範圍，捕捉更多潛在的 gRPC-Web / Connect 流量
    return (
      ct.includes('grpc') || 
      ct.includes('connect') || 
      ct.includes('proto') || 
      ct.includes('json') ||
      ct.includes('stream') ||
      ct.includes('message/reader')
    );
  }
  
  /**
   * 提取 request body 為 ArrayBuffer (同步版本)
   */
  function extractBodySync(body) {
    if (!body) return null;
    if (body instanceof ArrayBuffer) return body;
    if (body instanceof Uint8Array) return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
    if (body instanceof Blob) return null; // Blob 必須異步處理，對 XHR 較不友善
    if (typeof body === 'string') return new TextEncoder().encode(body).buffer;
    return null;
  }

  /**
   * 生成唯一請求 ID 用於跨流追蹤 (Dual-Stream Sync)
   */
  function generateRequestId() {
    return 'req-' + Math.random().toString(36).substring(2, 11) + '-' + Date.now();
  }

  // --- Fetch 攔截 ---
  const originalFetch = window.fetch;
  window.fetch = async function(input, init) {
    const rawUrl = typeof input === "string" ? input : input.url;
    const fuzzyUrl = normalizeUrlFuzzy(rawUrl);
    const options = init || (typeof input === "object" ? input : {});
    
    let contentType = "";
    try {
      if (options.headers) {
        if (typeof options.headers.get === "function") {
          contentType = options.headers.get("content-type") || options.headers.get("Content-Type") || "";
        } else {
          contentType = options.headers["content-type"] || options.headers["Content-Type"] || "";
        }
      }
    } catch (e) {}

    if (isGrpcRequest(contentType) && options.body) {
      try {
        let bodyBuffer = null;
        if (options.body instanceof Blob) {
          bodyBuffer = await options.body.arrayBuffer();
        } else {
          bodyBuffer = extractBodySync(options.body);
        }

        if (bodyBuffer && bodyBuffer.byteLength > 0) {
          // v2.9 Ghost Sync: 直接發送數據，不注入 Header
          window.postMessage({
            type: '__GRPCWEB_DEVTOOLS__',
            action: 'capturedRequestBody',
            url: fuzzyUrl,
            bodyBase64: arrayBufferToBase64(bodyBuffer),
            timestamp: Date.now(),
            _v: VERSION
          }, '*');
          console.log(`%c[gRPC Debugger ${VERSION}] 👻 Ghost Intercepted (Fetch): ${fuzzyUrl}`, "color: #d946ef; font-weight: bold;");
        }
      } catch (e) {}
    }
    return originalFetch.apply(this, arguments);
  };

  // --- XHR 攔截 ---
  const XHR = window.XMLHttpRequest;
  const originalOpen = XHR.prototype.open;
  const originalSend = XHR.prototype.send;
  const originalSetHeader = XHR.prototype.setRequestHeader;

  XHR.prototype.open = function(method, url) {
    this._url = normalizeUrlFuzzy(url);
    this._headers = {};
    return originalOpen.apply(this, arguments);
  };

  XHR.prototype.setRequestHeader = function(header, value) {
    this._headers[header.toLowerCase()] = value;
    return originalSetHeader.apply(this, arguments);
  };

  XHR.prototype.send = function(body) {
    if (isGrpcRequest(this._headers['content-type']) && body) {
      try {
        const bodyBuffer = extractBodySync(body);
        if (bodyBuffer && bodyBuffer.byteLength > 0) {
          // v2.9 Ghost Sync: 不注入 Header
          window.postMessage({
            type: '__GRPCWEB_DEVTOOLS__',
            action: 'capturedRequestBody',
            url: this._url,
            bodyBase64: arrayBufferToBase64(bodyBuffer),
            timestamp: Date.now(),
            _v: VERSION
          }, '*');
          console.log(`%c[gRPC Debugger ${VERSION}] 👻 Ghost Intercepted (XHR): ${this._url}`, "color: #d946ef; font-weight: bold;");
        }
      } catch (e) {}
    }
    return originalSend.apply(this, arguments);
  };

  console.log(`%c[gRPC Debugger ${VERSION}] Ironclad Interceptor Installed (Fetch/XHR)`, "color: #3b82f6; font-weight: bold; padding: 4px; border: 1px solid #3b82f6; border-radius: 4px;");
})();
