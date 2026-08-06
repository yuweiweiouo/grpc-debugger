// @ts-nocheck
/* global chrome */

// protobuf-ts calls retain their generated method metadata at runtime. This
// inspector pauses immediately before fetch/XHR, discovers that metadata, and
// delegates JSON conversion back to the page's protobuf-ts runtime.
const PROTOCOL_VERSION = '1.3';
const RECORDS_KEY = 'protobufTsInspectorRecords';
const MAX_RECORDS = 200;
const OBJECT_GROUP = 'protobuf-ts-inspector';
const PAUSE_INSPECTION_BUDGET_MS = 350;
const INSPECTION_COMMAND_TIMEOUT_MS = 200;

const processingTargets = new Set();
const endpointTypes = new Map();
const rpcMethodCache = new Map();
const pendingCalls = new Map();
const networkRequests = new Map();
let recordMutation = Promise.resolve();

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('Unable to configure Side Panel:', error));

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void handleMessage(message)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }));
  return true;
});

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (method === 'Debugger.paused') {
    void handlePaused(source, params);
  } else if (method === 'Network.requestWillBeSent') {
    handleRequestWillBeSent(source, params);
  } else if (method === 'Network.responseReceived') {
    handleResponseReceived(source, params);
  } else if (method === 'Network.loadingFinished') {
    void handleLoadingFinished(source, params);
  } else if (method === 'Network.loadingFailed') {
    void handleLoadingFailed(source, params);
  }
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId != null) clearRuntimeStateForTab(source.tabId);
});

async function handleMessage(message) {
  switch (message?.type) {
    case 'start':
      return startInspecting(message.tabId, message.urlFilter ?? '');
    case 'stop':
      await stopInspecting(message.tabId);
      return {};
    case 'status':
      return {
        attached: await isAttached(message.tabId),
        urlFilter: (await chrome.storage.local.get(configStorageKey(message.tabId)))[configStorageKey(message.tabId)]?.urlFilter ?? '',
      };
    case 'records':
      return { records: await getRecords(message.tabId) };
    case 'clear':
      await clearRecords(message.tabId);
      return {};
    default:
      throw new Error('Unknown inspector request');
  }
}

async function startInspecting(tabId, urlFilter) {
  if (!Number.isInteger(tabId)) throw new Error('無效的分頁 ID');
  const normalizedFilter = urlFilter.trim();
  const target = { tabId };
  if (!(await isAttached(tabId))) await chrome.debugger.attach(target, PROTOCOL_VERSION);

  await Promise.all([
    send(target, 'Debugger.enable'),
    send(target, 'Runtime.enable'),
    send(target, 'Network.enable'),
  ]);

  const configKey = configStorageKey(tabId);
  const previous = (await chrome.storage.local.get(configKey))[configKey];
  const previousBreakpoints = [previous?.urlFilter, ...(previous?.autoPaths ?? [])].filter((breakpoint) => breakpoint !== undefined);
  for (const breakpoint of new Set(previousBreakpoints)) {
    try {
      await send(target, 'DOMDebugger.removeXHRBreakpoint', { url: breakpoint });
    } catch {
      // Navigation may have already discarded the old breakpoint.
    }
  }

  await send(target, 'DOMDebugger.setXHRBreakpoint', { url: normalizedFilter });
  await chrome.storage.local.set({ [configKey]: { urlFilter: normalizedFilter, startedAt: new Date().toISOString() } });
  return { attached: true, urlFilter: normalizedFilter };
}

async function stopInspecting(tabId) {
  if (!Number.isInteger(tabId)) return;
  const target = { tabId };
  const configKey = configStorageKey(tabId);
  const config = (await chrome.storage.local.get(configKey))[configKey];

  if (await isAttached(tabId)) {
    try {
      await send(target, 'Runtime.releaseObjectGroup', { objectGroup: OBJECT_GROUP });
    } catch {
      // The inspected page can be gone before stop is clicked.
    }
    for (const breakpoint of new Set([config?.urlFilter, ...(config?.autoPaths ?? [])].filter((breakpoint) => breakpoint !== undefined))) {
      try {
        await send(target, 'DOMDebugger.removeXHRBreakpoint', { url: breakpoint });
      } catch {
        // Detaching is sufficient when the breakpoint no longer exists.
      }
    }
    await chrome.debugger.detach(target);
  }

  await chrome.storage.local.remove(configKey);
  clearRuntimeStateForTab(tabId);
}

async function isAttached(tabId) {
  if (!Number.isInteger(tabId)) return false;
  const targets = await chrome.debugger.getTargets();
  return targets.some((target) => target.tabId === tabId && target.attached);
}

async function handlePaused(source, params) {
  if (source.tabId == null) return;
  const targetKey = debuggerTargetKey(source);
  if (processingTargets.has(targetKey)) {
    await resumeDebugger(source);
    return;
  }
  processingTargets.add(targetKey);

  try {
    const callFrames = params?.callFrames ?? [];
    const deadline = Date.now() + PAUSE_INSPECTION_BUDGET_MS;
    let endpoint = findKnownEndpoint(source, params?.data?.url);
    let cache = endpoint && rpcMethodCache.get(endpointKey(source, endpoint));
    let located;
    let captured;

    if (cache) {
      try {
        located = await locateCachedRpcInput(source, callFrames, cache, deadline);
        if (located) {
          captured = {
            ...cache.metadata,
            request: await captureCachedRpcRequest(source, cache.methodObjectId, located.inputObjectId),
          };
        }
      } catch {
        rpcMethodCache.delete(endpointKey(source, endpoint));
        cache = null;
      }
    }

    if (!captured) {
      located = await locateRpcMethod(source, callFrames, deadline);
      if (!located) return;
      captured = await captureRpcCall(source, located.methodObjectId, located.inputObjectId);
      if (!captured) return;

      endpoint = `/${captured.service.typeName}/${captured.method.name}`;
      const cacheKey = endpointKey(source, endpoint);
      const { request, ...metadata } = captured;
      rpcMethodCache.set(cacheKey, {
        methodObjectId: located.methodObjectId,
        inputName: located.inputName,
        metadata,
      });
      endpointTypes.set(cacheKey, await getMethodTypeHandles(source, located.methodObjectId));
    }

    if (!endpoint) return;
    const queue = pendingCalls.get(endpointKey(source, endpoint)) ?? [];
    const callId = crypto.randomUUID();
    queue.push(callId);
    pendingCalls.set(endpointKey(source, endpoint), queue);

    await addRecord({
      id: callId,
      tabId: source.tabId,
      timestamp: new Date().toISOString(),
      endpoint,
      url: params?.data?.url,
      status: 'pending',
      ...captured,
    });
  } catch (error) {
    // Non-protobuf requests and navigation can invalidate a paused scope.
    // Never surface these internal inspection failures as blank RPC records.
    console.warn('Skipping paused request inspection:', error);
  } finally {
    await resumeDebugger(source);
    processingTargets.delete(targetKey);
  }
}

async function locateRpcMethod(source, callFrames, deadline) {
  for (const frame of callFrames) {
    if (Date.now() >= deadline) return;
    const candidates = await getScopeCandidates(source, frame, deadline);
    for (const candidate of candidates) {
      if (Date.now() >= deadline) return;
      if (!candidate.objectId || !(await isRpcMethodObject(source, candidate.objectId))) continue;
      const input = await findInputObject(source, candidate.objectId, candidates, deadline);
      return { methodObjectId: candidate.objectId, inputObjectId: input?.objectId, inputName: input?.name };
    }
  }
}

async function locateCachedRpcInput(source, callFrames, cache, deadline) {
  for (const frame of callFrames) {
    if (Date.now() >= deadline) return;
    const candidates = await getScopeCandidates(source, frame, deadline, cache.inputName);
    const input = await findInputObject(source, cache.methodObjectId, candidates, deadline, cache.inputName);
    if (input) return { inputObjectId: input.objectId };
  }
}

async function getScopeCandidates(source, frame, deadline, preferredInputName) {
  const candidates = [];
  const allowedScopes = new Set(['local', 'closure', 'block', 'catch']);
  for (const scope of frame.scopeChain ?? []) {
    if (Date.now() >= deadline) return candidates;
    if (!allowedScopes.has(scope.type) || !scope.object?.objectId) continue;
    const properties = await sendInspectionCommand(source, 'Runtime.getProperties', {
      objectId: scope.object.objectId,
      ownProperties: true,
      accessorPropertiesOnly: false,
    });
    for (const property of properties?.result ?? []) {
      if (Date.now() >= deadline) return candidates;
      const value = property.value;
      if (!value?.objectId || value.subtype === 'null') continue;
      if (preferredInputName) {
        if (property.name === preferredInputName) return [{ name: property.name, objectId: value.objectId, subtype: value.subtype }];
        continue;
      }
      candidates.push({ name: property.name, objectId: value.objectId, subtype: value.subtype });
      if (candidates.length >= 80) return candidates;
    }
  }
  return candidates;
}

async function isRpcMethodObject(source, objectId) {
  const result = await sendInspectionCommand(source, 'Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: `function () {
      return Boolean(this && typeof this === 'object' && typeof this.name === 'string' &&
        this.service && typeof this.service.typeName === 'string' &&
        this.I && typeof this.I.typeName === 'string' && Array.isArray(this.I.fields) &&
        typeof this.I.toJson === 'function' && typeof this.I.fromBinary === 'function' &&
        this.O && typeof this.O.typeName === 'string' && Array.isArray(this.O.fields) &&
        typeof this.O.toJson === 'function' && typeof this.O.fromBinary === 'function');
    }`,
    returnByValue: true,
    silent: true,
  });
  return result?.result?.value === true;
}

async function findInputObject(source, methodObjectId, candidates, deadline, preferredInputName) {
  const preferredNames = /^(input|request|req|message|payload)$/i;
  const sorted = [...candidates].sort((a, b) => {
    return Number(b.name === preferredInputName) - Number(a.name === preferredInputName) ||
      Number(preferredNames.test(b.name)) - Number(preferredNames.test(a.name));
  });
  for (const candidate of sorted) {
    if (Date.now() >= deadline) return;
    if (!candidate.objectId || candidate.objectId === methodObjectId) continue;
    if (['arraybuffer', 'typedarray', 'dataview', 'promise'].includes(candidate.subtype)) continue;
    const result = await sendInspectionCommand(source, 'Runtime.callFunctionOn', {
      objectId: methodObjectId,
      functionDeclaration: 'function (value) { try { return typeof this.I?.is === "function" && this.I.is(value, 20); } catch { return false; } }',
      arguments: [{ objectId: candidate.objectId }],
      returnByValue: true,
      silent: true,
    });
    if (result?.result?.value === true) return candidate;
  }
}

async function captureRpcCall(source, methodObjectId, inputObjectId) {
  const result = await sendInspectionCommand(source, 'Runtime.callFunctionOn', {
    objectId: methodObjectId,
    functionDeclaration: captureRpcInPage.toString(),
    arguments: [inputObjectId ? { objectId: inputObjectId } : { value: null }],
    returnByValue: true,
    silent: true,
  });
  if (result?.exceptionDetails) throw new Error(result.exceptionDetails.text || '無法讀取 protobuf-ts RPC');
  return result?.result?.value;
}

async function captureCachedRpcRequest(source, methodObjectId, inputObjectId) {
  const result = await sendInspectionCommand(source, 'Runtime.callFunctionOn', {
    objectId: methodObjectId,
    functionDeclaration: `function (input) {
      return input == null ? null : this.I.toJson(input, { emitDefaultValues: true });
    }`,
    arguments: [inputObjectId ? { objectId: inputObjectId } : { value: null }],
    returnByValue: true,
    silent: true,
  });
  if (result?.exceptionDetails) throw new Error(result.exceptionDetails.text || '無法讀取 protobuf-ts request');
  return result?.result?.value;
}

async function getMethodTypeHandles(source, methodObjectId) {
  const [input, output] = await Promise.all(['I', 'O'].map((property) => sendInspectionCommand(source, 'Runtime.callFunctionOn', {
    objectId: methodObjectId,
    functionDeclaration: `function () { return this.${property}; }`,
    returnByValue: false,
    objectGroup: OBJECT_GROUP,
    silent: true,
  })));
  return { inputTypeId: input?.result?.objectId, outputTypeId: output?.result?.objectId };
}

function handleRequestWillBeSent(source, params) {
  if (source.tabId == null || !params?.requestId || !params?.request?.url) return;
  const endpoint = findKnownEndpoint(source, params.request.url);
  if (!endpoint) return;
  const key = endpointKey(source, endpoint);
  const queue = pendingCalls.get(key) ?? [];
  const callId = queue.shift();
  if (queue.length) pendingCalls.set(key, queue); else pendingCalls.delete(key);
  networkRequests.set(networkRequestKey(source, params.requestId), {
    source,
    callId,
    endpoint,
    url: params.request.url,
    startedAt: Date.now(),
  });
}

function handleResponseReceived(source, params) {
  const request = networkRequests.get(networkRequestKey(source, params?.requestId));
  if (!request) return;
  const headers = params?.response?.headers ?? {};
  request.contentType = String(headers['content-type'] ?? headers['Content-Type'] ?? params?.response?.mimeType ?? '').toLowerCase();
}

async function handleLoadingFinished(source, params) {
  const key = networkRequestKey(source, params?.requestId);
  const request = networkRequests.get(key);
  if (!request?.endpoint) return;
  try {
    const body = await send(source, 'Network.getResponseBody', { requestId: params.requestId });
    const raw = decodeCdpBody(body?.body ?? '', Boolean(body?.base64Encoded));
    const bytes = request.contentType?.includes('grpc-web-text') ? decodeBase64StreamBytes(new TextDecoder().decode(raw)) : raw;
    const typeInfo = endpointTypes.get(endpointKey(source, request.endpoint));
    if (!typeInfo?.outputTypeId) throw new Error('找不到回應型別，請重新觸發此 RPC。');

    const responses = [];
    for (const frame of parseGrpcWebFrames(bytes)) {
      if (frame.isTrailer) continue;
      if (frame.compressed) responses.push({ _error: '尚不支援壓縮的 gRPC-Web frame。' });
      else responses.push(await decodeMessageWithRuntime(source, typeInfo.outputTypeId, frame.data));
    }
    const patch = {
      status: 'finished',
      response: responses.length <= 1 ? responses[0] : responses,
      responseReceivedAt: new Date().toISOString(),
      duration: Date.now() - request.startedAt,
    };
    if (request.callId) await patchRecord(request.callId, patch);
    else await addRecord({ id: crypto.randomUUID(), tabId: source.tabId, timestamp: new Date().toISOString(), endpoint: request.endpoint, url: request.url, ...patch });
  } catch (error) {
    if (request.callId) await patchRecord(request.callId, {
      status: 'finished',
      duration: Date.now() - request.startedAt,
      responseError: error instanceof Error ? error.message : String(error),
    });
  } finally {
    networkRequests.delete(key);
  }
}

async function handleLoadingFailed(source, params) {
  const key = networkRequestKey(source, params?.requestId);
  const request = networkRequests.get(key);
  if (request?.callId) await patchRecord(request.callId, {
    status: 'finished',
    duration: Date.now() - request.startedAt,
    responseError: params?.errorText || '網路請求失敗',
  });
  networkRequests.delete(key);
}

async function decodeMessageWithRuntime(source, objectId, bytes) {
  const result = await send(source, 'Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: `function (base64) {
      const binary = atob(base64); const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return this.toJson(this.fromBinary(bytes), { emitDefaultValues: true });
    }`,
    arguments: [{ value: bytesToBase64(bytes) }],
    returnByValue: true,
    silent: true,
  });
  if (result?.exceptionDetails) throw new Error(result.exceptionDetails.text || 'protobuf-ts 無法解碼回應');
  return result?.result?.value;
}

function captureRpcInPage(input) {
  const scalarNames = { 1: 'double', 2: 'float', 3: 'int64', 4: 'uint64', 5: 'int32', 6: 'fixed64', 7: 'fixed32', 8: 'bool', 9: 'string', 12: 'bytes', 13: 'uint32', 15: 'sfixed32', 16: 'sfixed64', 17: 'sint32', 18: 'sint64' };
  const messages = {};
  const enums = {};
  const visiting = new Set();
  const resolveLazy = (value) => { try { return typeof value === 'function' ? value() : value; } catch { return undefined; } };
  const summarizeEnum = (thunk) => {
    const value = resolveLazy(thunk);
    if (!Array.isArray(value)) return { typeName: String(value ?? 'unknown'), values: [] };
    const [typeName, enumObject] = value;
    const summary = { typeName: String(typeName), values: Object.entries(enumObject ?? {}).filter(([, number]) => typeof number === 'number').map(([name, number]) => ({ name, number })) };
    enums[summary.typeName] = summary;
    return summary;
  };
  const visitMessage = (type) => {
    if (!type?.typeName || visiting.has(type.typeName)) return;
    visiting.add(type.typeName);
    const message = { typeName: type.typeName, fields: [] };
    messages[type.typeName] = message;
    for (const field of type.fields ?? []) {
      const item = { number: field.no, name: field.name, localName: field.localName, jsonName: field.jsonName, kind: field.kind, repeated: field.repeat, optional: Boolean(field.opt), oneof: field.oneof };
      if (field.kind === 'scalar') item.type = scalarNames[field.T] ?? `scalar(${String(field.T)})`;
      else if (field.kind === 'message') { const nested = resolveLazy(field.T); item.typeName = nested?.typeName ?? 'unknown'; visitMessage(nested); }
      else if (field.kind === 'enum') item.typeName = summarizeEnum(field.T).typeName;
      else if (field.kind === 'map') { item.keyType = scalarNames[field.K] ?? `scalar(${String(field.K)})`; item.value = field.V?.kind; }
      message.fields.push(item);
    }
  };
  const service = this.service;
  const methods = [];
  for (const method of service?.methods ?? [this]) {
    visitMessage(method.I); visitMessage(method.O);
    methods.push({ name: method.name, inputType: method.I?.typeName, outputType: method.O?.typeName, clientStreaming: Boolean(method.clientStreaming), serverStreaming: Boolean(method.serverStreaming) });
  }
  return {
    service: { typeName: service?.typeName ?? 'unknown', methods },
    method: { name: this.name, localName: this.localName, clientStreaming: Boolean(this.clientStreaming), serverStreaming: Boolean(this.serverStreaming) },
    requestType: this.I?.typeName,
    responseType: this.O?.typeName,
    request: input == null ? null : this.I.toJson(input, { emitDefaultValues: true }),
    schema: { messages, enums },
  };
}

function decodeCdpBody(body, base64Encoded) { return base64Encoded ? decodeBase64Bytes(body) : new TextEncoder().encode(body); }
function decodeBase64Bytes(base64) {
  const normalized = base64.replace(/\s+/g, '');
  const binary = atob(normalized + '='.repeat((4 - (normalized.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
function decodeBase64StreamBytes(text) {
  const normalized = text.replace(/\s+/g, '');
  if (!normalized) return new Uint8Array();
  const parts = normalized.match(/[^=]+={0,2}/g) ?? [];
  const decoded = parts.map(decodeBase64Bytes);
  const output = new Uint8Array(decoded.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of decoded) { output.set(part, offset); offset += part.length; }
  return output;
}
function bytesToBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}
function parseGrpcWebFrames(bytes) {
  const frames = [];
  for (let offset = 0; offset + 5 <= bytes.length;) {
    const flags = bytes[offset];
    const length = ((bytes[offset + 1] * 0x1000000) + (bytes[offset + 2] * 0x10000) + (bytes[offset + 3] * 0x100) + bytes[offset + 4]) >>> 0;
    offset += 5;
    if (offset + length > bytes.length) throw new Error(`無效的 gRPC-Web frame 長度：${length}`);
    frames.push({ isTrailer: (flags & 0x80) !== 0, compressed: (flags & 0x01) !== 0, data: bytes.slice(offset, offset + length) });
    offset += length;
  }
  return frames;
}
function findKnownEndpoint(source, url) {
  let pathname;
  try { pathname = new URL(url).pathname; } catch { pathname = url; }
  const prefix = `${source.tabId}:${source.sessionId ?? 'root'}:`;
  for (const key of endpointTypes.keys()) {
    if (!key.startsWith(prefix)) continue;
    const endpoint = key.slice(prefix.length);
    if (pathname.endsWith(endpoint)) return endpoint;
  }
}
function mutateRecords(mutator) {
  recordMutation = recordMutation.catch(() => {}).then(async () => {
    const stored = await chrome.storage.local.get(RECORDS_KEY);
    const records = Array.isArray(stored[RECORDS_KEY]) ? stored[RECORDS_KEY] : [];
    const next = mutator(records);
    await chrome.storage.local.set({ [RECORDS_KEY]: next });
  });
  return recordMutation;
}
function addRecord(record) { return mutateRecords((records) => [...records, record].slice(-MAX_RECORDS)); }
function patchRecord(id, patch) { return mutateRecords((records) => records.map((record) => record.id === id ? { ...record, ...patch } : record)); }
async function getRecords(tabId) { const stored = await chrome.storage.local.get(RECORDS_KEY); return (stored[RECORDS_KEY] ?? []).filter((record) => record.tabId === tabId); }
function clearRecords(tabId) { return mutateRecords((records) => records.filter((record) => record.tabId !== tabId)); }
function clearRuntimeStateForTab(tabId) {
  const prefix = `${tabId}:`;
  for (const key of endpointTypes.keys()) if (key.startsWith(prefix)) endpointTypes.delete(key);
  for (const key of rpcMethodCache.keys()) if (key.startsWith(prefix)) rpcMethodCache.delete(key);
  for (const key of pendingCalls.keys()) if (key.startsWith(prefix)) pendingCalls.delete(key);
  for (const [key, request] of networkRequests) if (request.source.tabId === tabId) networkRequests.delete(key);
}
function endpointKey(source, endpoint) { return `${source.tabId}:${source.sessionId ?? 'root'}:${endpoint}`; }
function debuggerTargetKey(source) { return `${source.tabId}:${source.sessionId ?? 'root'}`; }
function networkRequestKey(source, requestId) { return `${debuggerTargetKey(source)}:${requestId}`; }
function configStorageKey(tabId) { return `protobufTsInspectorConfig:${tabId}`; }
function send(target, method, params) { return chrome.debugger.sendCommand(target, method, params); }

async function resumeDebugger(source) {
  try {
    await send(source, 'Debugger.resume');
  } catch {
    // A navigation or detach can invalidate the paused target.
  }
}

function sendInspectionCommand(target, method, params) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out while inspecting ${method}`));
    }, INSPECTION_COMMAND_TIMEOUT_MS);

    send(target, method, params).then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
