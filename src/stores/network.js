/**
 * 網路狀態管理 (Network Store)
 *
 * 只接受頁面主動送入的已解碼 gRPC 事件。
 * 不再處理 raw payload、HAR 回填或二次解碼管線。
 */

import { writable, derived, get } from 'svelte/store';
import { services } from './schema';
import { createLogger } from '../lib/logger';

const logger = createLogger('Network');

export const log = writable([]);
export const filterValue = writable('');
export const selectedId = writable(null);
export const preserveLog = writable(false);

export const filteredLog = derived(
  [log, filterValue, services],
  ([$log, $filterValue, $services]) => {
    const hiddenServicePrefixes = new Set(
      $services
        .filter((service) => service.hidden)
        .map((service) => `/${service.fullName}/`)
    );
    const lowerFilter = $filterValue.toLowerCase();

    return $log.filter((entry) => {
      if (isEntryHidden(entry, hiddenServicePrefixes)) {
        return false;
      }

      if (!$filterValue) {
        return true;
      }

      const method = typeof entry.method === 'string' ? entry.method : '';
      const endpoint = typeof entry.endpoint === 'string' ? entry.endpoint : '';
      return method.toLowerCase().includes(lowerFilter) || endpoint.toLowerCase().includes(lowerFilter);
    });
  }
);

export const selectedEntry = derived([log, selectedId], ([$log, $selectedId]) => {
  if ($selectedId === null) {
    return null;
  }

  return $log.find((entry) => entry.id === $selectedId) || null;
});

export async function addLog(entry) {
  normalizeEntryEndpoint(entry);

  log.update((list) => {
    const existingIdx = list.findIndex((item) => item.id === entry.id);
    logger.debug('addLog:', {
      id: entry.id,
      status: entry.status,
      source: entry._source || 'postmessage',
      existingIdx,
      listSize: list.length,
    });

    if (existingIdx !== -1) {
      const nextList = [...list];
      nextList[existingIdx] = {
        ...nextList[existingIdx],
        ...entry,
        request: entry.request ?? nextList[existingIdx].request,
        response: entry.response ?? nextList[existingIdx].response,
        error: entry.error ?? nextList[existingIdx].error,
        status: entry.status || nextList[existingIdx].status || 'finished',
      };
      return nextList;
    }

    return [...list, entry];
  });
}

function isEntryHidden(entry, hiddenServicePrefixes) {
  if (!entry?.method || hiddenServicePrefixes.size === 0) {
    return false;
  }

  const servicePrefix = getMethodServicePrefix(entry.method);
  return hiddenServicePrefixes.has(servicePrefix);
}

function getMethodServicePrefix(method) {
  const serviceEndIdx = method.indexOf('/', 1);
  if (serviceEndIdx === -1) {
    return '';
  }
  return method.slice(0, serviceEndIdx + 1);
}

function normalizeEntryEndpoint(entry) {
  if (!entry?.method) {
    return;
  }

  const parts = entry.method.split('/');
  entry.endpoint = parts.pop() || parts.pop();
}

export async function reprocessAllLogs() {
  return;
}

export function clearLogs(force = false) {
  if (get(preserveLog) && !force) {
    return;
  }

  log.set([]);
  selectedId.set(null);
}
