/**
 * gRPC Debugger - Fetch Interceptor
 * 攔截 fetch 請求，捕獲 binary request body 並轉為 Base64
 * 解決 HAR API 無法正確處理 binary postData 的問題
 */
(function() {
  const GRPC_CONTENT_TYPES = ['grpc', 'connect'];
  
  // 保存原始 fetch
  const originalFetch = window.fetch;
  
  /**
   * 將 ArrayBuffer/Uint8Array 轉為 Base64
   */
  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
  
  /**
   * 檢查是否為 gRPC 相關請求
   */
  function isGrpcRequest(url, options) {
    const contentType = options?.headers?.get?.('content-type') || 
                        options?.headers?.['content-type'] || 
                        options?.headers?.['Content-Type'] || '';
    return GRPC_CONTENT_TYPES.some(t => contentType.toLowerCase().includes(t));
  }
  
  /**
   * 提取 request body 為 ArrayBuffer
   */
  async function extractBody(body) {
    if (!body) return null;
    
    if (body instanceof ArrayBuffer) {
      return body;
    }
    if (body instanceof Uint8Array) {
      return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
    }
    if (body instanceof Blob) {
      return await body.arrayBuffer();
    }
    if (typeof body === 'string') {
      return new TextEncoder().encode(body).buffer;
    }
    // ReadableStream 或其他類型，無法直接讀取
    return null;
  }
  
  /**
   * 攔截後的 fetch
   */
  window.fetch = async function(input, init) {
    const url = typeof input === 'string' ? input : input.url;
    const options = init || (typeof input === 'object' ? input : {});
    
    // 只攔截 gRPC 請求
    if (isGrpcRequest(url, options) && options.body) {
      try {
        const bodyBuffer = await extractBody(options.body);
        
        if (bodyBuffer && bodyBuffer.byteLength > 0) {
          const base64Body = arrayBufferToBase64(bodyBuffer);
          const requestId = `${Date.now()}_${url}`;
          
          // 發送 request body 到 extension
          window.postMessage({
            type: '__GRPCWEB_DEVTOOLS__',
            action: 'capturedRequestBody',
            requestId,
            url,
            bodyBase64: base64Body,
            bodyLength: bodyBuffer.byteLength,
          }, '*');
        }
      } catch (e) {
        console.debug('[gRPC Debugger] Failed to capture request body:', e);
      }
    }
    
    // 調用原始 fetch
    return originalFetch.apply(this, arguments);
  };

  console.log('[gRPC Debugger] Fetch interceptor installed');
})();
