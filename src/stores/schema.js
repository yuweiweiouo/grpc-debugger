/**
 * Schema 狀態管理 (Schema Store)
 *
 * 僅負責管理由頁面端主動註冊或自動偵測到的 Protobuf Schema。
 * 不再透過 HAR / Server Reflection 補抓定義，所有資料來源統一收斂到
 * 頁面端 PostMessage 橋接層。
 */

import { writable } from 'svelte/store';
import { protoEngine } from '../lib/proto-engine';

export const services = writable([]);

let localProtoRegistered = false;

export function registerSchema(data, source = '', sourceHost = '') {
  if (!data) {
    return;
  }

  protoEngine.registerSchema(data);

  if (source?.startsWith('auto-detect')) {
    localProtoRegistered = true;
  }

  if (!data.services) {
    return;
  }

  services.update((list) => {
    const nextList = [...list];

    for (const service of data.services) {
      const existingIdx = nextList.findIndex((item) => item.fullName === service.fullName);
      const nextService = {
        ...service,
        sourceHost: sourceHost || service.sourceHost || '',
      };

      if (existingIdx === -1) {
        nextList.push(nextService);
      } else {
        nextList[existingIdx] = {
          ...nextList[existingIdx],
          ...nextService,
        };
      }
    }

    return nextList;
  });
}

export function clearAllSchemas() {
  services.set([]);
  protoEngine.schemas.clear();
  protoEngine.serviceMap.clear();
  localProtoRegistered = false;
}

export function toggleServiceVisibility(fullName) {
  services.update((list) => {
    return list.map((service) => {
      if (service.fullName === fullName) {
        return { ...service, hidden: !service.hidden };
      }
      return service;
    });
  });
}

export function hasLocalSchemaRegistration() {
  return localProtoRegistered;
}
