import { writable } from 'svelte/store';
import { protoEngine } from '../lib/proto-engine';
import reflectionClient from '../lib/reflection-client';

export const services = writable([]);
export const reflectionStatus = writable(null); // 'loading' | 'success' | 'failed' | null
export const reflectedServers = new Set(); // To avoid duplicate auto-reflections

// Track pending reflection promises to avoid duplicate requests
const pendingReflections = new Map();

export async function tryAutoReflection(url) {
  if (!url) return false;
  
  try {
    const origin = new URL(url).origin;
    
    // If already reflected, return false (no need to reprocess)
    if (reflectedServers.has(origin)) return false;
    
    // If reflection is in progress for this origin, wait for it
    if (pendingReflections.has(origin)) {
      return pendingReflections.get(origin);
    }
    
    // Start new reflection
    const reflectionPromise = (async () => {
      reflectionStatus.set('loading');
      
      const result = await reflectionClient.fetchFromServer(origin);
      if (result) {
        registerSchema(result);
        reflectedServers.add(origin);
        reflectionStatus.set('success');
        console.debug(`[Schema] Reflection completed for ${origin}, shouldReprocess: true`);
        return true; // Signals that logs should be reprocessed
      } else {
        reflectedServers.add(origin); // Mark as attempted even if failed
        reflectionStatus.set('failed');
        return false;
      }
    })();
    
    pendingReflections.set(origin, reflectionPromise);
    const result = await reflectionPromise;
    pendingReflections.delete(origin);
    return result;
  } catch (e) {
    console.error("[Reflection] Error during auto-reflection:", e);
    reflectionStatus.set('failed');
    return false;
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
