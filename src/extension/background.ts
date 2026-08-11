// @ts-nocheck
/* global chrome */

import { createProtoServiceCacheEntry, findCachedProtoMetadata } from './proto-cache.ts';

// protobuf-ts calls retain their generated method metadata at runtime. This
// inspector pauses immediately before fetch/XHR, discovers that metadata, and
// delegates JSON conversion back to the page's protobuf-ts runtime.
const PROTOCOL_VERSION = '1.3';
const RECORDS_KEY = 'protobufTsInspectorRecordsV2';
const PROTO_CACHE_KEY = 'protobufTsInspectorProtoCacheV3';
const MAX_RECORDS_PER_TAB = 200;
const OBJECT_GROUP = 'protobuf-ts-inspector';
const PAUSE_INSPECTION_BUDGET_MS = 350;
const PAUSE_WATCHDOG_MS = 300;
const INSPECTION_COMMAND_TIMEOUT_MS = 200;
const NETWORK_BODY_COMMAND_TIMEOUT_MS = 5000;
const RUNTIME_DECODE_COMMAND_TIMEOUT_MS = 5000;

const processingTargets = new Set();
const endpointTypes = new Map();
const networkRequests = new Map();
const preCapturedCalls = new Map();
const hiddenServicesByTab = new Map();
const detectionConfigs = new Map();
const detectedServicesByTab = new Map();
const detectionTransitions = new Map();
const lightweightInterceptorStates = new Map();
let recordMutation = Promise.resolve();
let recordsCache = null;
let recordsLoad = null;
let recordFlushTimer = null;
let recordFlush = Promise.resolve();
let protoCache = null;
let protoCacheLoad = null;
let protoCacheMutation = Promise.resolve();

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('Unable to configure Side Panel:', error));

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void bindSidePanelToTab(tabId);
});

void chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
  if (Number.isInteger(tab?.id)) return bindSidePanelToTab(tab.id);
}).catch((error) => console.warn('Unable to find active tab for Side Panel:', error));

function bindSidePanelToTab(tabId) {
  return chrome.sidePanel.setOptions({
    tabId,
    path: `index.html?tabId=${tabId}`,
    enabled: true,
  }).catch((error) => console.warn('Unable to bind Side Panel to tab:', error));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handleMessage(message, sender)
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
    if (source.tabId != null) {
      clearDecoderStateForTab(source.tabId);
      resetDetectedServices(source.tabId);
    }
  }
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId != null) clearRuntimeStateForTab(source.tabId);
});

chrome.webNavigation.onCommitted.addListener(({ tabId, frameId }) => {
  if (frameId === 0) lightweightInterceptorStates.delete(tabId);
});

async function handleMessage(message, sender) {
  switch (message?.type) {
    case 'start':
      return setDetectionMode(message.tabId, true, true, message.urlFilter ?? '');
    case 'stop':
      return setDetectionMode(message.tabId, false, false);
    case 'setDetectionMode':
      return setDetectionMode(
        message.tabId,
        message.requestDetectionEnabled,
        message.protoDetectionEnabled,
        message.urlFilter,
      );
    case 'lightweightBridgeReady':
      if (Number.isInteger(sender?.tab?.id)) {
        await queueDetectionTransition(sender.tab.id, async () => {
          const config = await getDetectionConfig(sender.tab.id);
          await configureLightweightInterceptor(
            sender.tab.id,
            Boolean(config?.requestDetectionEnabled && !config?.protoDetectionEnabled),
            true,
          );
        });
      }
      return {};
    case 'lightweightPayload':
      if (Number.isInteger(sender?.tab?.id)) {
        await addLightweightPayload(sender.tab.id, message.payload);
      }
      return {};
    case 'status':
      return queueDetectionTransition(message.tabId, async () => {
        const config = await getDetectionConfig(message.tabId);
        if (config?.requestDetectionEnabled && config.protoDetectionEnabled) {
          if (!(await isAttached(message.tabId))) {
            await startProtoInspection(message.tabId, config.urlFilter ?? '', config);
          }
        } else if (config?.requestDetectionEnabled) {
          await configureLightweightInterceptor(message.tabId, true);
        }
        const hiddenServices = (await chrome.storage.local.get(hiddenServicesStorageKey(message.tabId)))[hiddenServicesStorageKey(message.tabId)] ?? [];
        return {
          attached: await isAttached(message.tabId),
          urlFilter: config?.urlFilter ?? '',
          requestDetectionEnabled: Boolean(config?.requestDetectionEnabled),
          protoDetectionEnabled: Boolean(config?.protoDetectionEnabled),
          hiddenServices,
        };
      });
    case 'records':
      return { records: await getRecords(message.tabId) };
    case 'setHiddenServices':
      hiddenServicesByTab.set(message.tabId, new Set(message.services ?? []));
      await chrome.storage.local.set({ [hiddenServicesStorageKey(message.tabId)]: message.services ?? [] });
      return {};
    case 'clear':
      await clearRecords(message.tabId);
      return {};
    case 'inspectorRecordAdded':
      return {};
    default:
      throw new Error('Unknown inspector request');
  }
}

async function setDetectionMode(tabId, requestDetectionEnabled, protoDetectionEnabled, urlFilter) {
  if (!Number.isInteger(tabId)) throw new Error('無效的分頁 ID');
  return queueDetectionTransition(tabId, () => {
    return setDetectionModeForTab(tabId, requestDetectionEnabled, protoDetectionEnabled, urlFilter);
  });
}

async function queueDetectionTransition(tabId, operation) {
  const previousTransition = detectionTransitions.get(tabId) ?? Promise.resolve();
  const transition = previousTransition.catch(() => {}).then(operation);
  detectionTransitions.set(tabId, transition);

  try {
    return await transition;
  } finally {
    if (detectionTransitions.get(tabId) === transition) detectionTransitions.delete(tabId);
  }
}

async function setDetectionModeForTab(tabId, requestDetectionEnabled, protoDetectionEnabled, urlFilter) {
  const previous = await getDetectionConfig(tabId) ?? {};
  const requestEnabled = Boolean(requestDetectionEnabled);
  const protoEnabled = requestEnabled && Boolean(protoDetectionEnabled);
  const normalizedFilter = String(urlFilter ?? previous.urlFilter ?? '').trim();

  if (protoEnabled) {
    await startProtoInspection(tabId, normalizedFilter, previous);
  } else if (await isAttached(tabId)) {
    await stopProtoInspection(tabId, previous);
  }

  if (!requestEnabled) {
    detectionConfigs.delete(tabId);
    await chrome.storage.local.remove(configStorageKey(tabId));
  } else {
    const config = {
      ...previous,
      urlFilter: normalizedFilter,
      requestDetectionEnabled: true,
      protoDetectionEnabled: protoEnabled,
      startedAt: new Date().toISOString(),
    };
    detectionConfigs.set(tabId, config);
    await chrome.storage.local.set({ [configStorageKey(tabId)]: config });
  }
  await configureLightweightInterceptor(tabId, requestEnabled && !protoEnabled);

  return {
    attached: await isAttached(tabId),
    urlFilter: normalizedFilter,
    requestDetectionEnabled: requestEnabled,
    protoDetectionEnabled: protoEnabled,
  };
}

async function startProtoInspection(tabId, normalizedFilter, previous = {}) {
  if (!previous?.protoDetectionEnabled) resetDetectedServices(tabId);
  const storedHidden = (await chrome.storage.local.get(hiddenServicesStorageKey(tabId)))[hiddenServicesStorageKey(tabId)] ?? [];
  hiddenServicesByTab.set(tabId, new Set(storedHidden));
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

  const previousBreakpoints = [previous?.urlFilter, ...(previous?.autoPaths ?? [])].filter((breakpoint) => breakpoint !== undefined);
  for (const breakpoint of new Set(previousBreakpoints)) {
    try {
      await send(target, 'DOMDebugger.removeXHRBreakpoint', { url: breakpoint });
    } catch {
      // Navigation may have already discarded the old breakpoint.
    }
  }

  await send(target, 'DOMDebugger.setXHRBreakpoint', { url: normalizedFilter });
}

async function stopProtoInspection(tabId, config = {}) {
  const target = { tabId };

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

  // 紀錄會自行排程持久化；不可因其他分頁的大量寫入阻塞此分頁的停止操作。
  void flushRecords().catch(() => {});
  detectedServicesByTab.delete(tabId);
  clearRuntimeStateForTab(tabId);
}

async function configureLightweightInterceptor(tabId, enabled, force = false) {
  if (!force && lightweightInterceptorStates.get(tabId) === enabled) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['request-bridge.js'],
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      files: ['request-interceptor.js'],
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (isEnabled) => {
        if (window.__GRPC_DEBUGGER_LIGHTWEIGHT_INTERCEPTOR__) {
          window.__GRPC_DEBUGGER_LIGHTWEIGHT_INTERCEPTOR__.enabled = isEnabled;
          window.__GRPC_DEBUGGER_LIGHTWEIGHT_INTERCEPTOR__.configured = true;
        }
      },
      args: [enabled],
    });
    lightweightInterceptorStates.set(tabId, enabled);
  } catch (error) {
    // Chrome 內部頁面與受限制頁面無法注入，不影響其他分頁的偵測。
    console.warn('Unable to configure lightweight interceptor:', error);
  }
}

async function addLightweightPayload(tabId, payload) {
  if (!payload?.url || payload.method !== 'POST') return;
  if (isServiceHidden(tabId, payload.url)) return;

  const config = await getDetectionConfig(tabId);
  if (!config?.requestDetectionEnabled || config.protoDetectionEnabled) return;
  if (config.urlFilter && !String(payload.url).includes(config.urlFilter)) return;

  const requestContentType = String(payload.requestContentType ?? '');
  const responseContentType = String(payload.responseContentType ?? '');
  if (!isGrpcContentType(requestContentType || responseContentType)) return;

  let endpoint;
  try { endpoint = new URL(payload.url).pathname; } catch { endpoint = String(payload.url).split('?')[0]; }
  const metadata = await getCachedProtoMetadata(tabId, payload.url, endpoint);
  const timestamp = new Date(payload.timestamp ?? Date.now()).toISOString();
  const httpStatus = Number(payload.httpStatus) || 0;

  await addRecord({
    id: createRecordId(`lightweight-${tabId}`),
    tabId,
    timestamp,
    startTime: timestamp,
    endpoint,
    method: endpoint,
    url: payload.url,
    requestRaw: payload.requestBase64 ?? null,
    requestBase64Encoded: true,
    responseRaw: payload.responseBase64 ?? null,
    responseBase64Encoded: true,
    requestHeaders: { 'content-type': requestContentType },
    responseHeaders: { 'content-type': responseContentType },
    httpStatus,
    responseError: httpStatus >= 400 ? `HTTP ${httpStatus}` : undefined,
    status: 'finished',
    _source: 'lightweight',
    ...metadata,
  });
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
  let resumed = false;
  let inspectionExpired = false;
  const resumeOnce = async () => {
    if (resumed) return;
    resumed = true;
    await resumeDebugger(source);
  };
  const watchdog = setTimeout(() => {
    inspectionExpired = true;
    processingTargets.delete(targetKey);
    void resumeOnce();
  }, PAUSE_WATCHDOG_MS);

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
    const { request, ...metadata } = captured;
    enqueuePreCapturedCall(source, endpoint, {
      adapter: located.adapter,
      metadata,
      request,
    });

    // schema 已是擷取到的純資料；watchdog 恢復頁面後仍必須持久化，供重整後的 lightweight 模式解碼。
    void cacheDetectedService(source.tabId, params?.data?.url, captured)
      .catch((error) => console.warn('Unable to cache protobuf service:', error));
    if (inspectionExpired) return;

    const cacheKey = endpointKey(source, endpoint);
    if (located.adapter === 'grpc-web') {
      endpointTypes.set(cacheKey, {
        ...await getGrpcWebTypeHandles(source, located.methodObjectId, located.inputObjectId),
        metadata,
      });
    } else {
      await registerProtobufMethod(
        source,
        located.methodObjectId,
        captured,
        captured.method.name,
        captured.method,
      );
    }
  } catch (error) {
    // Non-protobuf requests and navigation can invalidate a paused scope.
    // Never surface these internal inspection failures as blank RPC records.
    console.warn('Skipping paused request inspection:', error);
  } finally {
    clearTimeout(watchdog);
    await resumeOnce();
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
  const preCapturedCall = takePreCapturedCall(source, params.request.url);
  const knownEndpoint = findKnownEndpoint(source, params.request.url);
  const requestContentType = getHeaderValue(params.request.headers, 'content-type').toLowerCase();
  if (!isGrpcContentType(requestContentType) && !knownEndpoint && !preCapturedCall) return;
  const endpoint = knownEndpoint ?? preCapturedCall?.endpoint;
  if (!endpoint) return;

  const typeInfo = endpointTypes.get(endpointKey(source, endpoint));
  const requestId = params.requestId;
  const recordId = createRecordId(`cdp-${debuggerTargetKey(source)}-${requestId}`);
  const record = {
    id: recordId,
    requestId,
    tabId: source.tabId,
    timestamp: new Date().toISOString(),
    endpoint,
    method: endpoint,
    url: params.request.url,
    requestHeaders: {
      ...(params.request.headers ?? {}),
      'content-type': requestContentType || 'application/grpc',
    },
    status: 'pending',
    _source: typeInfo?.adapter ?? preCapturedCall?.adapter ?? 'protobuf-ts',
    ...preCapturedCall?.metadata,
    ...typeInfo?.metadata,
    request: preCapturedCall?.request,
  };
  void addRecord(record);
  networkRequests.set(networkRequestKey(source, requestId), {
    source,
    requestId,
    recordId,
    endpoint,
    url: params.request.url,
    startedAt: Date.now(),
    typeInfo,
    requestContentType: requestContentType || 'application/grpc',
  });
  if (typeInfo) {
    void decodeAndPatchRequestBody(source, requestId, recordId, typeInfo, requestContentType || 'application/grpc');
  }
}

async function decodeAndPatchRequestBody(source, requestId, recordId, typeInfo, contentType) {
  try {
    const postData = await sendNetworkCommand(source, 'Network.getRequestPostData', { requestId });
    const request = await decodeGrpcPayload(
      source,
      typeInfo,
      decodeCdpBody(postData?.postData ?? '', Boolean(postData?.base64Encoded)),
      contentType,
      'request',
    );
    await patchRecord(source.tabId, recordId, { request });
  } catch (error) {
    await patchRecord(source.tabId, recordId, { requestError: error instanceof Error ? error.message : String(error) });
  }
}

function handleResponseReceived(source, params) {
  const request = networkRequests.get(networkRequestKey(source, params?.requestId));
  if (!request) return;
  const headers = params?.response?.headers ?? {};
  request.contentType = String(headers['content-type'] ?? headers['Content-Type'] ?? params?.response?.mimeType ?? '').toLowerCase();
  void patchRecord(source.tabId, request.recordId, {
    httpStatus: params?.response?.status,
    responseHeaders: headers,
  });
}

async function handleLoadingFinished(source, params) {
  const key = networkRequestKey(source, params?.requestId);
  const request = networkRequests.get(key);
  if (!request?.endpoint) return;
  try {
    const typeInfo = request.typeInfo ?? endpointTypes.get(endpointKey(source, request.endpoint));
    if (!typeInfo) {
      await patchRecord(source.tabId, request.recordId, {
        status: 'finished',
        responseReceivedAt: new Date().toISOString(),
        duration: Date.now() - request.startedAt,
      });
      return;
    }
    const body = await sendNetworkCommand(source, 'Network.getResponseBody', { requestId: params.requestId });
    const raw = decodeCdpBody(body?.body ?? '', Boolean(body?.base64Encoded));
    const response = await decodeGrpcPayload(source, typeInfo, raw, request.contentType || request.requestContentType, 'response');
    const patch = {
      status: 'finished',
      response,
      responseReceivedAt: new Date().toISOString(),
      duration: Date.now() - request.startedAt,
    };
    await patchRecord(source.tabId, request.recordId, patch);
  } catch (error) {
    await patchRecord(source.tabId, request.recordId, {
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
  if (request) await patchRecord(source.tabId, request.recordId, {
    status: 'finished',
    duration: Date.now() - request.startedAt,
    responseError: params?.errorText || '網路請求失敗',
  });
  networkRequests.delete(key);
}

async function decodeMessageWithRuntime(source, objectId, bytes) {
  const result = await sendRuntimeDecodeCommand(source, 'Runtime.callFunctionOn', {
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
  const result = await sendRuntimeDecodeCommand(source, 'Runtime.callFunctionOn', {
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
  const result = await sendRuntimeDecodeCommand(source, 'Runtime.callFunctionOn', {
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
function enqueuePreCapturedCall(source, endpoint, call) {
  const key = debuggerTargetKey(source);
  const calls = preCapturedCalls.get(key) ?? [];
  const now = Date.now();
  const recentCalls = calls.filter((item) => now - item.capturedAt < 5000);
  recentCalls.push({ ...call, endpoint, capturedAt: now });
  preCapturedCalls.set(key, recentCalls);
}
function takePreCapturedCall(source, rawUrl) {
  const key = debuggerTargetKey(source);
  const calls = preCapturedCalls.get(key);
  if (!calls?.length) return null;
  let pathname;
  try { pathname = new URL(rawUrl).pathname; } catch { pathname = rawUrl; }
  const now = Date.now();
  const matchIndex = calls.findIndex((call) => {
    return now - call.capturedAt < 5000 && pathname.endsWith(call.endpoint);
  });
  if (matchIndex === -1) {
    preCapturedCalls.set(key, calls.filter((call) => now - call.capturedAt < 5000));
    return null;
  }
  const [call] = calls.splice(matchIndex, 1);
  if (calls.length) preCapturedCalls.set(key, calls);
  else preCapturedCalls.delete(key);
  return call;
}
async function loadRecordsCache() {
  if (recordsCache) return recordsCache;
  if (!recordsLoad) {
    recordsLoad = chrome.storage.local.get(RECORDS_KEY).then((stored) => {
      const value = stored[RECORDS_KEY];
      recordsCache = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      return recordsCache;
    });
  }
  return recordsLoad;
}

async function getDetectionConfig(tabId) {
  if (detectionConfigs.has(tabId)) return detectionConfigs.get(tabId);
  const key = configStorageKey(tabId);
  const config = (await chrome.storage.local.get(key))[key] ?? null;
  detectionConfigs.set(tabId, config);
  return config;
}

async function loadProtoCache() {
  if (protoCache) return protoCache;
  if (!protoCacheLoad) {
    protoCacheLoad = chrome.storage.local.get(PROTO_CACHE_KEY).then((stored) => {
      const value = stored[PROTO_CACHE_KEY];
      protoCache = value && typeof value === 'object' ? value : {};
      return protoCache;
    });
  }
  return protoCacheLoad;
}

function resetDetectedServices(tabId) {
  detectedServicesByTab.set(tabId, new Set());
}

async function cacheDetectedService(tabId, rawUrl, captured) {
  const serviceName = captured?.service?.typeName;
  const entry = createProtoServiceCacheEntry(captured);
  if (!serviceName || !entry) return;
  const origin = cacheOrigin(rawUrl);

  const detectedServices = detectedServicesByTab.get(tabId) ?? new Set();
  const serviceKey = `${origin}:${serviceName}`;
  if (detectedServices.has(serviceKey)) return;
  detectedServices.add(serviceKey);
  detectedServicesByTab.set(tabId, detectedServices);

  protoCacheMutation = protoCacheMutation.catch(() => {}).then(async () => {
    const cache = await loadProtoCache();
    cache[tabId] ??= {};
    cache[tabId][origin] ??= {};
    cache[tabId][origin][serviceName] = entry;
    await chrome.storage.local.set({ [PROTO_CACHE_KEY]: cache });
  });

  try {
    await protoCacheMutation;
    await enrichLightweightRecords(tabId);
    chrome.runtime.sendMessage({ type: 'inspectorSchemaAdded', tabId }).catch(() => {});
  } catch (error) {
    detectedServices.delete(serviceKey);
    throw error;
  }
}

async function getCachedProtoMetadata(tabId, rawUrl, endpoint) {
  const cache = await loadProtoCache();
  return findProtoMetadataForUrl(cache[tabId], rawUrl, endpoint);
}

function findProtoMetadataForUrl(cacheByOrigin, rawUrl, endpoint) {
  const origin = cacheOrigin(rawUrl);
  return findCachedProtoMetadata(cacheByOrigin?.[origin], endpoint)
    ?? (origin === 'unknown' ? null : findCachedProtoMetadata(cacheByOrigin?.unknown, endpoint));
}

async function enrichLightweightRecords(tabId) {
  const cache = await loadProtoCache();
  await mutateRecords(tabId, (records) => records.map((record) => {
    if (record._source !== 'lightweight' || !record.url || !record.endpoint) return record;
    const metadata = findProtoMetadataForUrl(cache[tabId], record.url, record.endpoint);
    return metadata ? { ...record, ...metadata } : record;
  }));
}

function persistRecords() {
  const snapshot = recordsCache ?? {};
  recordFlush = recordFlush.catch(() => {}).then(() => {
    return chrome.storage.local.set({ [RECORDS_KEY]: snapshot });
  });
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

function mutateRecords(tabId, mutator) {
  recordMutation = recordMutation.catch(() => {}).then(async () => {
    const recordsByTab = await loadRecordsCache();
    recordsCache = {
      ...recordsByTab,
      [tabId]: mutator(recordsByTab[tabId] ?? []),
    };
    scheduleRecordFlush();
  });
  return recordMutation;
}
function addRecord(record) {
  return mutateRecords(record.tabId, (records) => {
    const retained = records.length >= MAX_RECORDS_PER_TAB
      ? records.slice(1)
      : records;
    return [...retained, record];
  }).then(() => {
    chrome.runtime.sendMessage({ type: 'inspectorRecordAdded', tabId: record.tabId }).catch(() => {});
  });
}
function patchRecord(tabId, id, patch) {
  return mutateRecords(tabId, (records) => records.map((record) => {
    return record.id === id ? { ...record, ...patch } : record;
  }));
}
async function getRecords(tabId) { await recordMutation; return [...((await loadRecordsCache())[tabId] ?? [])]; }
async function clearRecords(tabId) { await mutateRecords(tabId, () => []); await flushRecords(); }
function clearRuntimeStateForTab(tabId) {
  hiddenServicesByTab.delete(tabId);
  detectedServicesByTab.delete(tabId);
  lightweightInterceptorStates.delete(tabId);
  clearDecoderStateForTab(tabId);
}
function clearDecoderStateForTab(tabId) {
  const prefix = `${tabId}:`;
  for (const key of endpointTypes.keys()) if (key.startsWith(prefix)) endpointTypes.delete(key);
  for (const [key, request] of networkRequests) if (request.source.tabId === tabId) networkRequests.delete(key);
  for (const key of preCapturedCalls.keys()) if (key.startsWith(prefix)) preCapturedCalls.delete(key);
  for (const key of processingTargets) if (key.startsWith(prefix)) processingTargets.delete(key);
}
function endpointKey(source, endpoint) { return `${source.tabId}:${source.sessionId ?? 'root'}:${endpoint}`; }
function debuggerTargetKey(source) { return `${source.tabId}:${source.sessionId ?? 'root'}`; }
function networkRequestKey(source, requestId) { return `${debuggerTargetKey(source)}:${requestId}`; }
function createRecordId(prefix) {
  if (typeof globalThis.crypto?.randomUUID === 'function') return `${prefix}:${globalThis.crypto.randomUUID()}`;
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}
function cacheOrigin(rawUrl) {
  try { return new URL(rawUrl).origin; } catch { return 'unknown'; }
}
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
  return sendCommandWithTimeout(target, method, params, INSPECTION_COMMAND_TIMEOUT_MS);
}

function sendNetworkCommand(target, method, params) {
  return sendCommandWithTimeout(target, method, params, NETWORK_BODY_COMMAND_TIMEOUT_MS);
}

function sendRuntimeDecodeCommand(target, method, params) {
  return sendCommandWithTimeout(target, method, params, RUNTIME_DECODE_COMMAND_TIMEOUT_MS);
}

function sendCommandWithTimeout(target, method, params, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out while running ${method}`));
    }, timeoutMs);

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
