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
const networkRequests = new Map();
const hiddenServicesByTab = new Map();
let recordMutation = Promise.resolve();
let recordsCache = null;
let recordsLoad = null;
let recordFlushTimer = null;
let recordFlush = Promise.resolve();

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
  } else if (method === 'Runtime.executionContextsCleared') {
    if (source.tabId != null) clearDecoderStateForTab(source.tabId);
  } else if (method === 'Page.frameNavigated' && !params?.frame?.parentId) {
    if (source.tabId != null) clearDecoderStateForTab(source.tabId);
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
      {
        const config = (await chrome.storage.local.get(configStorageKey(message.tabId)))[configStorageKey(message.tabId)];
        const hiddenServices = (await chrome.storage.local.get(hiddenServicesStorageKey(message.tabId)))[hiddenServicesStorageKey(message.tabId)] ?? [];
      return {
        attached: await isAttached(message.tabId),
        urlFilter: config?.urlFilter ?? '',
        hiddenServices,
      };
      }
    case 'records':
      return { records: await getRecords(message.tabId) };
    case 'setHiddenServices':
      hiddenServicesByTab.set(message.tabId, new Set(message.services ?? []));
      await chrome.storage.local.set({ [hiddenServicesStorageKey(message.tabId)]: message.services ?? [] });
      return {};
    case 'clear':
      await clearRecords(message.tabId);
      return {};
    default:
      throw new Error('Unknown inspector request');
  }
}

async function startInspecting(tabId, urlFilter) {
  if (!Number.isInteger(tabId)) throw new Error('無效的分頁 ID');
  const storedHidden = (await chrome.storage.local.get(hiddenServicesStorageKey(tabId)))[hiddenServicesStorageKey(tabId)] ?? [];
  hiddenServicesByTab.set(tabId, new Set(storedHidden));
  const normalizedFilter = urlFilter.trim();
  const target = { tabId };
  if (!(await isAttached(tabId))) await chrome.debugger.attach(target, PROTOCOL_VERSION);

  await Promise.all([
    send(target, 'Debugger.enable'),
    send(target, 'Runtime.enable'),
    send(target, 'Page.enable'),
    send(target, 'Network.enable', {
      maxTotalBufferSize: 50 * 1024 * 1024,
      maxResourceBufferSize: 10 * 1024 * 1024,
      maxPostDataSize: 10 * 1024 * 1024,
      enableDurableMessages: true,
    }),
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
  await flushRecords();
  clearRuntimeStateForTab(tabId);
}

async function isAttached(tabId) {
  if (!Number.isInteger(tabId)) return false;
  const targets = await chrome.debugger.getTargets();
  return targets.some((target) => target.tabId === tabId && target.attached);
}

async function handlePaused(source, params) {
  if (source.tabId == null) return;
  if (isServiceHidden(source.tabId, params?.data?.url)) {
    await resumeDebugger(source);
    return;
  }
  if (findKnownEndpoint(source, params?.data?.url)) {
    await resumeDebugger(source);
    return;
  }
  const targetKey = debuggerTargetKey(source);
  if (processingTargets.has(targetKey)) {
    await resumeDebugger(source);
    return;
  }
  processingTargets.add(targetKey);

  try {
    const callFrames = params?.callFrames ?? [];
    const deadline = Date.now() + PAUSE_INSPECTION_BUDGET_MS;
    const located = await locateRpcMethod(source, callFrames, deadline);
    if (!located) return;
    const captured = located.adapter === 'grpc-web'
      ? await captureGrpcWebCall(source, located.methodObjectId, located.inputObjectId)
      : await captureRpcCall(source, located.methodObjectId, located.inputObjectId);
    if (!captured) return;

    const endpoint = captured.endpoint || `/${captured.service.typeName}/${captured.method.name}`;
    const cacheKey = endpointKey(source, endpoint);
    const { request, ...metadata } = captured;
    if (located.adapter === 'grpc-web') {
      endpointTypes.set(cacheKey, {
        ...await getGrpcWebTypeHandles(source, located.methodObjectId, located.inputObjectId),
        metadata,
      });
    } else {
      await registerProtobufServiceMethods(source, located.methodObjectId, captured);
    }
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
      if (!candidate.objectId) continue;
      if (await isGrpcWebDescriptor(source, candidate.objectId)) {
        const input = await findGrpcWebInput(source, candidates, deadline);
        return { adapter: 'grpc-web', methodObjectId: candidate.objectId, inputObjectId: input?.objectId };
      }
      if (await isRpcMethodObject(source, candidate.objectId)) {
        const input = await findInputObject(source, candidate.objectId, candidates, deadline);
        return { adapter: 'protobuf-ts', methodObjectId: candidate.objectId, inputObjectId: input?.objectId, inputName: input?.name };
      }
    }
  }
}

async function locateGrpcWebMethod(source, callFrames, deadline) {
  for (const frame of callFrames) {
    if (Date.now() >= deadline) return;
    const candidates = await getScopeCandidates(source, frame, deadline);
    for (const candidate of candidates) {
      if (Date.now() >= deadline) return;
      if (!candidate.objectId || !(await isGrpcWebDescriptor(source, candidate.objectId))) continue;
      const input = await findGrpcWebInput(source, candidates, deadline);
      return { adapter: 'grpc-web', methodObjectId: candidate.objectId, inputObjectId: input?.objectId };
    }
  }
}

async function locateCachedGrpcWebInput(source, callFrames, cache, deadline) {
  for (const frame of callFrames) {
    if (Date.now() >= deadline) return;
    const candidates = await getScopeCandidates(source, frame, deadline);
    const input = await findGrpcWebInput(source, candidates, deadline);
    if (input) return { adapter: 'grpc-web', methodObjectId: cache.methodObjectId, inputObjectId: input.objectId };
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

async function isGrpcWebDescriptor(source, objectId) {
  const result = await sendInspectionCommand(source, 'Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: `function () {
      try {
        return Boolean(typeof this?.getName === 'function' &&
          typeof this.getName() === 'string' && this.getName().startsWith('/') &&
          typeof this.a === 'function' && typeof this.b === 'function');
      } catch { return false; }
    }`,
    returnByValue: true,
    silent: true,
  });
  return result?.result?.value === true;
}

async function findGrpcWebInput(source, candidates, deadline) {
  for (const candidate of candidates) {
    if (Date.now() >= deadline) return;
    if (!candidate.objectId || ['arraybuffer', 'typedarray', 'dataview', 'promise'].includes(candidate.subtype)) continue;
    const result = await sendInspectionCommand(source, 'Runtime.callFunctionOn', {
      objectId: candidate.objectId,
      functionDeclaration: 'function () { return typeof this.serializeBinary === "function" && typeof this.toObject === "function"; }',
      returnByValue: true,
      silent: true,
    });
    if (result?.result?.value === true) return candidate;
  }
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

async function captureGrpcWebCall(source, methodDescriptorId, inputObjectId) {
  const result = await sendInspectionCommand(source, 'Runtime.callFunctionOn', {
    objectId: methodDescriptorId,
    functionDeclaration: `function (input) {
      const endpoint = this.getName();
      const parts = endpoint.split('/').filter(Boolean);
      const serviceName = parts.at(-2) || 'unknown';
      const methodName = parts.at(-1) || 'unknown';
      return {
        endpoint,
        service: { typeName: serviceName, methods: [{ name: methodName, inputType: 'google-protobuf', outputType: 'google-protobuf' }] },
        method: { name: methodName, localName: methodName, clientStreaming: false, serverStreaming: false },
        requestType: 'google-protobuf',
        responseType: 'google-protobuf',
        request: input == null ? null : input.toObject(),
        schema: { messages: {}, enums: {} },
      };
    }`,
    arguments: [inputObjectId ? { objectId: inputObjectId } : { value: null }],
    returnByValue: true,
    silent: true,
  });
  if (result?.exceptionDetails) throw new Error(result.exceptionDetails.text || '無法讀取 grpc-web RPC');
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

async function registerProtobufServiceMethods(source, methodObjectId, captured) {
  const serviceMethods = await sendInspectionCommand(source, 'Runtime.callFunctionOn', {
    objectId: methodObjectId,
    functionDeclaration: 'function () { return this.service?.methods; }',
    returnByValue: false,
    objectGroup: OBJECT_GROUP,
    silent: true,
  });
  const methodsObjectId = serviceMethods?.result?.objectId;
  if (!methodsObjectId) {
    await registerProtobufMethod(source, methodObjectId, captured, captured.method.name);
    return;
  }

  const properties = await sendInspectionCommand(source, 'Runtime.getProperties', {
    objectId: methodsObjectId,
    ownProperties: true,
    accessorPropertiesOnly: false,
  });
  const methodObjectIds = (properties?.result ?? [])
    .filter((property) => /^\d+$/.test(property.name) && property.value?.objectId)
    .map((property) => property.value.objectId);

  for (const serviceMethodId of methodObjectIds) {
    const info = await sendInspectionCommand(source, 'Runtime.callFunctionOn', {
      objectId: serviceMethodId,
      functionDeclaration: 'function () { return { name: this.name, localName: this.localName, clientStreaming: Boolean(this.clientStreaming), serverStreaming: Boolean(this.serverStreaming) }; }',
      returnByValue: true,
      silent: true,
    });
    const methodName = info?.result?.value?.name;
    if (methodName) await registerProtobufMethod(source, serviceMethodId, captured, methodName, info.result.value);
  }
}

async function registerProtobufMethod(source, methodObjectId, captured, methodName, runtimeMetadata = {}) {
  const definition = captured.service.methods.find((method) => method.name === methodName) ?? {};
  const endpoint = `/${captured.service.typeName}/${methodName}`;
  const { request, ...baseMetadata } = captured;
  endpointTypes.set(endpointKey(source, endpoint), {
    ...await getMethodTypeHandles(source, methodObjectId),
    adapter: 'protobuf-ts',
    metadata: {
      ...baseMetadata,
      method: {
        name: methodName,
        localName: runtimeMetadata.localName ?? methodName,
        clientStreaming: runtimeMetadata.clientStreaming ?? Boolean(definition.clientStreaming),
        serverStreaming: runtimeMetadata.serverStreaming ?? Boolean(definition.serverStreaming),
      },
      requestType: definition.inputType ?? captured.requestType,
      responseType: definition.outputType ?? captured.responseType,
    },
  });
}

async function getGrpcWebTypeHandles(source, methodDescriptorId, inputObjectId) {
  const input = inputObjectId && await sendInspectionCommand(source, 'Runtime.callFunctionOn', {
    objectId: inputObjectId,
    functionDeclaration: 'function () { return this.constructor; }',
    returnByValue: false,
    objectGroup: OBJECT_GROUP,
    silent: true,
  });
  return {
    adapter: 'grpc-web',
    methodDescriptorId,
    inputTypeId: input?.result?.objectId,
  };
}

function handleRequestWillBeSent(source, params) {
  if (source.tabId == null || !params?.requestId || !params?.request?.url) return;
  if (isServiceHidden(source.tabId, params.request.url)) return;
  if (params.request.method !== 'POST') return;
  const requestContentType = getHeaderValue(params.request.headers, 'content-type').toLowerCase();
  if (!isGrpcContentType(requestContentType)) return;
  const endpoint = findKnownEndpoint(source, params.request.url);
  if (!endpoint) return;

  const typeInfo = endpointTypes.get(endpointKey(source, endpoint));
  if (!typeInfo) return;
  const requestId = params.requestId;
  const record = {
    id: requestId,
    requestId,
    tabId: source.tabId,
    timestamp: new Date().toISOString(),
    endpoint,
    method: endpoint,
    url: params.request.url,
    requestHeaders: params.request.headers ?? {},
    status: 'pending',
    _source: typeInfo.adapter ?? 'protobuf-ts',
    ...typeInfo.metadata,
  };
  void addRecord(record);
  networkRequests.set(networkRequestKey(source, requestId), {
    source,
    requestId,
    endpoint,
    url: params.request.url,
    startedAt: Date.now(),
    typeInfo,
    requestContentType,
  });
  void decodeAndPatchRequestBody(source, requestId, typeInfo, requestContentType);
}

async function decodeAndPatchRequestBody(source, requestId, typeInfo, contentType) {
  try {
    const postData = await send(source, 'Network.getRequestPostData', { requestId });
    const request = await decodeGrpcPayload(
      source,
      typeInfo,
      decodeCdpBody(postData?.postData ?? '', Boolean(postData?.base64Encoded)),
      contentType,
      'request',
    );
    await patchRecord(requestId, { request });
  } catch (error) {
    await patchRecord(requestId, { requestError: error instanceof Error ? error.message : String(error) });
  }
}

function handleResponseReceived(source, params) {
  const request = networkRequests.get(networkRequestKey(source, params?.requestId));
  if (!request) return;
  const headers = params?.response?.headers ?? {};
  request.contentType = String(headers['content-type'] ?? headers['Content-Type'] ?? params?.response?.mimeType ?? '').toLowerCase();
  void patchRecord(request.requestId, {
    httpStatus: params?.response?.status,
    responseHeaders: headers,
  });
}

async function handleLoadingFinished(source, params) {
  const key = networkRequestKey(source, params?.requestId);
  const request = networkRequests.get(key);
  if (!request?.endpoint) return;
  try {
    const body = await send(source, 'Network.getResponseBody', { requestId: params.requestId });
    const raw = decodeCdpBody(body?.body ?? '', Boolean(body?.base64Encoded));
    const response = await decodeGrpcPayload(source, request.typeInfo, raw, request.contentType || request.requestContentType, 'response');
    const patch = {
      status: 'finished',
      response,
      responseReceivedAt: new Date().toISOString(),
      duration: Date.now() - request.startedAt,
    };
    await patchRecord(request.requestId, patch);
  } catch (error) {
    await patchRecord(request.requestId, {
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
  if (request) await patchRecord(request.requestId, {
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

async function decodeGrpcWebResponse(source, methodDescriptorId, bytes) {
  const result = await send(source, 'Runtime.callFunctionOn', {
    objectId: methodDescriptorId,
    functionDeclaration: `function (base64) {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return this.b(bytes).toObject();
    }`,
    arguments: [{ value: bytesToBase64(bytes) }],
    returnByValue: true,
    silent: true,
  });
  if (result?.exceptionDetails) throw new Error(result.exceptionDetails.text || 'grpc-web 無法解碼回應');
  return result?.result?.value;
}

async function decodeGrpcWebRequest(source, inputTypeId, bytes) {
  const result = await send(source, 'Runtime.callFunctionOn', {
    objectId: inputTypeId,
    functionDeclaration: `function (base64) {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return this.deserializeBinary(bytes).toObject();
    }`,
    arguments: [{ value: bytesToBase64(bytes) }],
    returnByValue: true,
    silent: true,
  });
  if (result?.exceptionDetails) throw new Error(result.exceptionDetails.text || 'grpc-web 無法解碼請求');
  return result?.result?.value;
}

async function decodeGrpcPayload(source, typeInfo, rawBytes, contentType, direction) {
  let bytes = rawBytes;
  if (contentType?.includes('grpc-web-text')) {
    bytes = decodeBase64StreamBytes(new TextDecoder().decode(bytes));
  }
  const values = [];
  for (const frame of parseGrpcWebFrames(bytes)) {
    if (frame.isTrailer) continue;
    if (frame.compressed) {
      values.push({ _error: '尚不支援壓縮的 gRPC-Web frame。' });
      continue;
    }
    if (typeInfo.adapter === 'grpc-web') {
      values.push(direction === 'request'
        ? await decodeGrpcWebRequest(source, typeInfo.inputTypeId, frame.data)
        : await decodeGrpcWebResponse(source, typeInfo.methodDescriptorId, frame.data));
    } else {
      values.push(await decodeMessageWithRuntime(
        source,
        direction === 'request' ? typeInfo.inputTypeId : typeInfo.outputTypeId,
        frame.data,
      ));
    }
  }
  return values.length <= 1 ? values[0] ?? null : values;
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
async function loadRecordsCache() {
  if (recordsCache) return recordsCache;
  if (!recordsLoad) {
    recordsLoad = chrome.storage.local.get(RECORDS_KEY).then((stored) => {
      recordsCache = Array.isArray(stored[RECORDS_KEY]) ? stored[RECORDS_KEY] : [];
      return recordsCache;
    });
  }
  return recordsLoad;
}

function persistRecords() {
  recordFlush = chrome.storage.local.set({ [RECORDS_KEY]: recordsCache ?? [] });
  return recordFlush;
}

function scheduleRecordFlush() {
  if (recordFlushTimer) return;
  recordFlushTimer = setTimeout(() => {
    recordFlushTimer = null;
    void persistRecords();
  }, 80);
}

async function flushRecords() {
  await recordMutation;
  if (recordFlushTimer) {
    clearTimeout(recordFlushTimer);
    recordFlushTimer = null;
  }
  await persistRecords();
}

function mutateRecords(mutator) {
  recordMutation = recordMutation.catch(() => {}).then(async () => {
    const records = await loadRecordsCache();
    recordsCache = mutator(records);
    scheduleRecordFlush();
  });
  return recordMutation;
}
function addRecord(record) { return mutateRecords((records) => [...records, record].slice(-MAX_RECORDS)); }
function patchRecord(id, patch) { return mutateRecords((records) => records.map((record) => record.id === id ? { ...record, ...patch } : record)); }
async function getRecords(tabId) { await recordMutation; return (await loadRecordsCache()).filter((record) => record.tabId === tabId); }
async function clearRecords(tabId) { await mutateRecords((records) => records.filter((record) => record.tabId !== tabId)); await flushRecords(); }
function clearRuntimeStateForTab(tabId) {
  hiddenServicesByTab.delete(tabId);
  clearDecoderStateForTab(tabId);
}
function clearDecoderStateForTab(tabId) {
  const prefix = `${tabId}:`;
  for (const key of endpointTypes.keys()) if (key.startsWith(prefix)) endpointTypes.delete(key);
  for (const [key, request] of networkRequests) if (request.source.tabId === tabId) networkRequests.delete(key);
}
function endpointKey(source, endpoint) { return `${source.tabId}:${source.sessionId ?? 'root'}:${endpoint}`; }
function debuggerTargetKey(source) { return `${source.tabId}:${source.sessionId ?? 'root'}`; }
function networkRequestKey(source, requestId) { return `${debuggerTargetKey(source)}:${requestId}`; }
function configStorageKey(tabId) { return `protobufTsInspectorConfig:${tabId}`; }
function hiddenServicesStorageKey(tabId) { return `protobufTsInspectorHiddenServices:${tabId}`; }
function getHeaderValue(headers, name) {
  const key = Object.keys(headers ?? {}).find((header) => header.toLowerCase() === name);
  return key ? String(headers[key]) : '';
}
function isGrpcContentType(contentType) {
  return /(?:grpc|connect|protobuf|proto)/i.test(contentType);
}
function isServiceHidden(tabId, rawUrl) {
  const hidden = hiddenServicesByTab.get(tabId);
  if (!hidden?.size || !rawUrl) return false;
  try {
    return new URL(rawUrl).pathname.split('/').some((segment) => hidden.has(decodeURIComponent(segment)));
  } catch {
    return false;
  }
}
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
