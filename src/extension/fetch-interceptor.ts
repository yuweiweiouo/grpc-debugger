// @ts-nocheck
import { arrayBufferToBase64 } from './request-body-base64';

/**
 * gRPC Debugger - Robust Interceptor v2.23 (Ironclad)
 * 攔截 fetch 與 XHR 請求，包含版本化日誌與同步 XHR 支援
 */
(function() {
  // v2.23: 防止重複注入
  if (window.__GRPC_DEBUGGER_INTERCEPTOR_INJECTED__) {
    console.log('[gRPC Debugger] Interceptor already injected, skipping.');
    return;
  }
  window.__GRPC_DEBUGGER_INTERCEPTOR_INJECTED__ = true;
  
  const VERSION = "v2.23";
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
   * 將 URL 轉為完整格式 (含 protocol + host)
   * v2.17: 確保傳送完整 URL 給 DevTools
   */
  function toFullUrl(url) {
    try {
      return new URL(url, window.location.href).href;
    } catch {
      return url;
    }
  }

  /**
   * 快速計算請求的雜湊值 (FNV-1a)
   * v2.22: 將 path + headers + body 一起 hash，避免 body 為空時無法區分
   * @param {string} path - URL 路徑
   * @param {string} headersStr - 序列化的 headers
   * @param {ArrayBuffer} bodyBuffer - request body
   * @returns {string} 8 字元 hex hash
   */
  function computeRequestHash(path, headersStr, bodyBuffer) {
    // FNV-1a 32-bit hash
    let hash = 2166136261;
    
    // Hash path
    for (let i = 0; i < path.length; i++) {
      hash ^= path.charCodeAt(i);
      hash = (hash * 16777619) >>> 0;
    }
    
    // Hash headers
    for (let i = 0; i < headersStr.length; i++) {
      hash ^= headersStr.charCodeAt(i);
      hash = (hash * 16777619) >>> 0;
    }
    
    // Hash body
    if (bodyBuffer) {
      const bytes = new Uint8Array(bodyBuffer);
      for (let i = 0; i < bytes.length; i++) {
        hash ^= bytes[i];
        hash = (hash * 16777619) >>> 0;
      }
    }
    
    return hash.toString(16).padStart(8, '0');
  }

  /**
   * 將 headers 物件轉為排序後的字串
   */
  function serializeHeaders(headers) {
    if (!headers) return '';
    try {
      let pairs = [];
      if (typeof headers.entries === 'function') {
        for (const [k, v] of headers.entries()) {
          pairs.push(`${k.toLowerCase()}:${v}`);
        }
      } else if (typeof headers === 'object') {
        for (const k of Object.keys(headers)) {
          pairs.push(`${k.toLowerCase()}:${headers[k]}`);
        }
      }
      return pairs.sort().join('|');
    } catch {
      return '';
    }
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
          // v2.22: 傳送完整 URL、fuzzy path 與 requestHash (path + headers + body)
          const fullUrl = toFullUrl(rawUrl);
          const headersStr = serializeHeaders(options.headers);
          const requestHash = computeRequestHash(fuzzyUrl, headersStr, bodyBuffer);
          window.postMessage({
            type: '__GRPCWEB_DEVTOOLS__',
            action: 'capturedRequestBody',
            url: fullUrl,
            path: fuzzyUrl,
            requestHash,
            bodyBase64: arrayBufferToBase64(bodyBuffer),
            timestamp: Date.now(),
            _v: VERSION
          }, '*');
          console.log(`%c[gRPC Debugger ${VERSION}] 👻 Ghost Intercepted (Fetch): ${fuzzyUrl} [Hash: ${requestHash}]`, "color: #d946ef; font-weight: bold;");
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
    this._rawUrl = url;
    this._url = normalizeUrlFuzzy(url);
    this._headers = {};
    return originalOpen.apply(this, arguments);
  };

  XHR.prototype.setRequestHeader = function(header, value) {
    this._headers[header.toLowerCase()] = value;
    return originalSetHeader.apply(this, arguments);
  };

  XHR.prototype.send = function(body) {
    const rawXhrUrl = this._rawUrl;
    const fuzzyXhrUrl = this._url;
    
    if (isGrpcRequest(this._headers['content-type']) && body) {
      try {
        const bodyBuffer = extractBodySync(body);
        if (bodyBuffer && bodyBuffer.byteLength > 0) {
          // v2.22: 傳送完整 URL、fuzzy path 與 requestHash (path + headers + body)
          const fullUrl = toFullUrl(rawXhrUrl);
          const headersStr = serializeHeaders(this._headers);
          const requestHash = computeRequestHash(fuzzyXhrUrl, headersStr, bodyBuffer);
          window.postMessage({
            type: '__GRPCWEB_DEVTOOLS__',
            action: 'capturedRequestBody',
            url: fullUrl,
            path: fuzzyXhrUrl,
            requestHash,
            bodyBase64: arrayBufferToBase64(bodyBuffer),
            timestamp: Date.now(),
            _v: VERSION
          }, '*');
          console.log(`%c[gRPC Debugger ${VERSION}] 👻 Ghost Intercepted (XHR): ${fuzzyXhrUrl} [Hash: ${requestHash}]`, "color: #d946ef; font-weight: bold;");
        }
      } catch (e) {}
    }
    return originalSend.apply(this, arguments);
  };

  console.log(`%c[gRPC Debugger ${VERSION}] Ironclad Interceptor Installed (Fetch/XHR)`, "color: #3b82f6; font-weight: bold; padding: 4px; border: 1px solid #3b82f6; border-radius: 4px;");
})();
