import { writable } from 'svelte/store';
import { protoEngine } from '../lib/proto-engine';
import reflectionClient from '../lib/reflection-client';

export const services = writable([]);
export const reflectionStatus = writable(null); // 'loading' | 'success' | 'failed' | null
export const reflectedServers = new Set(); // To avoid duplicate auto-reflections

export async function tryAutoReflection(url) {
  if (!url) return;
  
  try {
    const origin = new URL(url).origin;
    if (reflectedServers.has(origin)) return;
    
    reflectedServers.add(origin);
    reflectionStatus.set('loading');
    
    const result = await reflectionClient.fetchFromServer(origin);
    if (result) {
      registerSchema(result);
      reflectionStatus.set('success');
    } else {
      reflectionStatus.set('failed');
    }
  } catch (e) {
    console.error("[Reflection] Error during auto-reflection:", e);
    reflectionStatus.set('failed');
  }
}

export function registerSchema(data) {
  // 1. Ensure definitions are in engine
  protoEngine.registerSchema(data);

  // 2. Sync to UI store
  if (data.services) {
    services.update(list => {
      const newList = [...list];
      for (const service of data.services) {
        const existingIdx = newList.findIndex(s => s.fullName === service.fullName);
        if (existingIdx === -1) {
          newList.push(service);
        } else {
          // Update existing service methods if needed
          newList[existingIdx] = service;
        }
      }
      return newList;
    });
  }
}

export function clearAllSchemas() {
  services.set([]);
  reflectionStatus.set(null);
  reflectedServers.clear();
  protoEngine.schemas.clear();
  protoEngine.serviceMap.clear();
}
