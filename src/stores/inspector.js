import { writable } from 'svelte/store';
import { clearLogs, replaceInspectorLogs } from './network';

export const activeTabId = writable(null);
export const monitoring = writable(false);
export const urlFilter = writable('');
export const inspectorError = writable('');
export const requestDetectionEnabled = writable(false);
export const protoDetectionEnabled = writable(false);
export const detectionUpdating = writable(false);

let refreshVersion = 0;
const clearingTabIds = new Set();

async function send(message) {
  if (typeof chrome === 'undefined' || !chrome.runtime) {
    throw new Error('此介面必須從 Chrome 擴充功能開啟。');
  }
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || '擴充功能服務未回應');
  return response;
}

async function getCurrentTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!Number.isInteger(tab?.id)) throw new Error('找不到目前分頁');
  activeTabId.set(tab.id);
  return tab.id;
}

export async function refreshInspector() {
  const version = ++refreshVersion;
  try {
    const tabId = await getCurrentTabId();
    const [status, records] = await Promise.all([
      send({ type: 'status', tabId }),
      send({ type: 'records', tabId }),
    ]);
    if (version !== refreshVersion || clearingTabIds.has(tabId)) return;

    monitoring.set(Boolean(status.attached));
    urlFilter.set(status.urlFilter ?? '');
    requestDetectionEnabled.set(Boolean(status.requestDetectionEnabled));
    protoDetectionEnabled.set(Boolean(status.protoDetectionEnabled));
    await replaceInspectorLogs(records.records ?? [], status.hiddenServices ?? []);
    inspectorError.set('');
  } catch (error) {
    if (version !== refreshVersion) return;
    inspectorError.set(error instanceof Error ? error.message : String(error));
  }
}

export async function startInspector() {
  return setDetectionMode(true, true);
}

export async function stopInspector() {
  return setDetectionMode(false, false);
}

export async function setRequestDetection(enabled) {
  return setDetectionMode(enabled, enabled && getStoreValue(protoDetectionEnabled));
}

export async function setProtoDetection(enabled) {
  if (enabled && !getStoreValue(requestDetectionEnabled)) return;
  return setDetectionMode(getStoreValue(requestDetectionEnabled), enabled);
}

async function setDetectionMode(requestEnabled, protoEnabled) {
  detectionUpdating.set(true);
  try {
    const tabId = await getCurrentTabId();
    const filter = getStoreValue(urlFilter);
    const result = await send({
      type: 'setDetectionMode',
      tabId,
      requestDetectionEnabled: requestEnabled,
      protoDetectionEnabled: protoEnabled,
      urlFilter: filter.trim(),
    });
    monitoring.set(Boolean(result.attached));
    requestDetectionEnabled.set(Boolean(result.requestDetectionEnabled));
    protoDetectionEnabled.set(Boolean(result.protoDetectionEnabled));
    urlFilter.set(result.urlFilter ?? '');
    inspectorError.set('');
  } catch (error) {
    inspectorError.set(error instanceof Error ? error.message : String(error));
  } finally {
    detectionUpdating.set(false);
  }
}

export async function clearInspectorRecords(tabId) {
  const hasTargetTabId = Number.isInteger(tabId);
  if (!hasTargetTabId || getStoreValue(activeTabId) === tabId) {
    // 先清除目前面板，避免等待背景 storage 寫入才更新 UI。
    clearLogs(true);
  }

  let targetTabId;
  try {
    targetTabId = hasTargetTabId ? tabId : await getCurrentTabId();
    clearingTabIds.add(targetTabId);
    ++refreshVersion;
    await send({ type: 'clear', tabId: targetTabId });
    clearingTabIds.delete(targetTabId);
    await refreshInspector();
  } catch (error) {
    if (Number.isInteger(targetTabId)) {
      clearingTabIds.delete(targetTabId);
    }
    await refreshInspector();
    inspectorError.set(error instanceof Error ? error.message : String(error));
  }
}

export async function setHiddenServices(serviceNames) {
  try {
    const tabId = await getCurrentTabId();
    await send({ type: 'setHiddenServices', tabId, services: serviceNames });
  } catch (error) {
    inspectorError.set(error instanceof Error ? error.message : String(error));
  }
}

function getStoreValue(store) {
  let value;
  const unsubscribe = store.subscribe((next) => { value = next; });
  unsubscribe();
  return value;
}
