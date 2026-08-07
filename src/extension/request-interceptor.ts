(() => {
  const STATE_KEY = '__GRPC_DEBUGGER_LIGHTWEIGHT_INTERCEPTOR__';
  const MESSAGE_TYPE = '__GRPC_DEBUGGER_LIGHTWEIGHT_CALL__';
  const MAX_CAPTURE_BYTES = 10 * 1024 * 1024;

  if (window[STATE_KEY]) return;

  const state = { enabled: false };
  window[STATE_KEY] = state;

  const xhrInfo = new WeakMap();
  const originalFetch = window.fetch;
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

  window.fetch = function(input, init) {
    const snapshot = state.enabled ? createFetchSnapshot(input, init) : null;
    const result = originalFetch.apply(this, arguments);
    if (snapshot) void captureFetch(snapshot, result);
    return result;
  };

  XMLHttpRequest.prototype.open = function(method, url) {
    xhrInfo.set(this, {
      method: String(method).toUpperCase(),
      url: new URL(url, window.location.href).href,
      headers: {},
    });
    return originalOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    xhrInfo.get(this)?.headers && (xhrInfo.get(this).headers[String(name).toLowerCase()] = String(value));
    return originalSetRequestHeader.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function(body) {
    const info = xhrInfo.get(this);
    if (state.enabled && info?.method === 'POST') {
      const requestBody = readBody(body);
      this.addEventListener('loadend', () => { void captureXhr(this, info, requestBody); }, { once: true });
    }
    return originalSend.apply(this, arguments);
  };

  function createFetchSnapshot(input, init) {
    const request = input instanceof Request ? input : null;
    const url = new URL(request?.url ?? input, window.location.href).href;
    const method = String(init?.method ?? request?.method ?? 'GET').toUpperCase();
    if (method !== 'POST') return null;

    const headers = toHeaders(init?.headers ?? request?.headers);
    const body = init?.body !== undefined
      ? readBody(init.body)
      : request
        ? request.clone().arrayBuffer().catch(() => null)
        : Promise.resolve(null);

    return { url, method, headers, body };
  }

  async function captureFetch(snapshot, responsePromise) {
    try {
      const response = await responsePromise;
      const responseContentType = response.headers.get('content-type') ?? '';
      const requestContentType = snapshot.headers['content-type'] ?? '';
      if (!isGrpcContentType(requestContentType || responseContentType)) return;

      const [requestBuffer, responseBuffer] = await Promise.all([
        snapshot.body,
        response.clone().arrayBuffer().catch(() => null),
      ]);
      emit({
        url: snapshot.url,
        method: snapshot.method,
        requestBase64: toBase64(requestBuffer),
        responseBase64: toBase64(responseBuffer),
        requestContentType,
        responseContentType,
        httpStatus: response.status,
      });
    } catch {
      // 網頁請求本身不應因除錯攔截失敗而受到影響。
    }
  }

  async function captureXhr(xhr, info, requestBody) {
    try {
      const responseContentType = xhr.getResponseHeader('content-type') ?? '';
      const requestContentType = info.headers['content-type'] ?? '';
      if (!isGrpcContentType(requestContentType || responseContentType)) return;

      emit({
        url: info.url,
        method: info.method,
        requestBase64: toBase64(await requestBody),
        responseBase64: toBase64(await readBody(xhr.response)),
        requestContentType,
        responseContentType,
        httpStatus: xhr.status,
      });
    } catch {
      // 網頁請求本身不應因除錯攔截失敗而受到影響。
    }
  }

  function emit(payload) {
    if (!state.enabled) return;
    window.postMessage({ type: MESSAGE_TYPE, payload: { ...payload, timestamp: Date.now() } }, window.location.origin);
  }

  function toHeaders(headers) {
    const result = {};
    if (!headers) return result;
    if (typeof headers.entries === 'function') {
      for (const [name, value] of headers.entries()) result[String(name).toLowerCase()] = String(value);
      return result;
    }
    for (const [name, value] of Object.entries(headers)) result[name.toLowerCase()] = String(value);
    return result;
  }

  function isGrpcContentType(contentType) {
    return /(?:grpc|connect|protobuf|proto)/i.test(contentType);
  }

  async function readBody(body) {
    if (!body) return null;
    if (body instanceof ArrayBuffer) return body;
    if (ArrayBuffer.isView(body)) return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
    if (body instanceof Blob) return body.arrayBuffer();
    if (typeof body === 'string') return new TextEncoder().encode(body).buffer;
    return null;
  }

  function toBase64(buffer) {
    if (!buffer || buffer.byteLength > MAX_CAPTURE_BYTES) return null;
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  }
})();
