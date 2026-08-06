import { writable } from 'svelte/store';
import { replaceInspectorLogs } from './network';

export const activeTabId = writable(null);
export const monitoring = writable(false);
export const urlFilter = writable('');
export const inspectorError = writable('');

async function send(message) {
  if (typeof chrome === 'undefined' || !chrome.runtime) {
    throw new Error('此介面必須從 Chrome 擴充功能的 Side Panel 開啟。');
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
  try {
    const tabId = await getCurrentTabId();
    const [status, records] = await Promise.all([
      send({ type: 'status', tabId }),
      send({ type: 'records', tabId }),
    ]);
    monitoring.set(Boolean(status.attached));
    urlFilter.set(status.urlFilter ?? '');
    replaceInspectorLogs(records.records ?? []);
    inspectorError.set('');
  } catch (error) {
    inspectorError.set(error instanceof Error ? error.message : String(error));
  }
}

export async function startInspector() {
  try {
    const tabId = await getCurrentTabId();
    const filter = getStoreValue(urlFilter);
    const result = await send({ type: 'start', tabId, urlFilter: filter.trim() });
    monitoring.set(Boolean(result.attached));
    inspectorError.set('');
  } catch (error) {
    inspectorError.set(error instanceof Error ? error.message : String(error));
  }
}

export async function stopInspector() {
  try {
    const tabId = await getCurrentTabId();
    await send({ type: 'stop', tabId });
    monitoring.set(false);
    inspectorError.set('');
  } catch (error) {
    inspectorError.set(error instanceof Error ? error.message : String(error));
  }
}

export async function clearInspectorRecords() {
  try {
    const tabId = await getCurrentTabId();
    await send({ type: 'clear', tabId });
    await refreshInspector();
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
