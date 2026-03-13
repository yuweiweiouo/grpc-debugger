import { describe, expect, it, beforeEach, vi } from 'vitest';

import { writable } from 'svelte/store';

const localStorageMock = (() => {
  let store = {};
  return {
    getItem: (key) => store[key] || null,
    setItem: (key, value) => { store[key] = value; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(global, 'localStorage', { value: localStorageMock });

vi.mock('svelte/store', () => ({
  writable: vi.fn((val) => {
    let currentVal = val;
    const subscribers = new Set();
    return {
      subscribe: (fn) => {
        fn(currentVal);
        subscribers.add(fn);
        return () => subscribers.delete(fn);
      },
      set: (v) => {
        currentVal = v;
        subscribers.forEach(fn => fn(v));
      },
      update: (fn) => {
        const newVal = fn(currentVal);
        currentVal = newVal;
        subscribers.forEach(fn => fn(newVal));
      },
    };
  }),
}));

describe('layout store', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.resetModules();
  });

  it('listPaneWidth 預設為 400', async () => {
    const { listPaneWidth } = await import('../src/stores/layout.js');
    let value;
    listPaneWidth.subscribe(v => value = v)();
    expect(value).toBe(400);
  });

  it('listPaneWidth 從 localStorage 讀取已存的值', async () => {
    localStorageMock.setItem('grpc_debugger_list_width', '500');
    vi.resetModules();
    const { listPaneWidth } = await import('../src/stores/layout.js');
    let value;
    listPaneWidth.subscribe(v => value = v)();
    expect(value).toBe(500);
  });
});
