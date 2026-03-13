import { describe, expect, it, beforeEach, vi } from 'vitest';

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

describe('ui store', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('activePage 預設為 network', async () => {
    const { activePage } = await import('../src/stores/ui.js');
    let value;
    activePage.subscribe(v => value = v)();
    expect(value).toBe('network');
  });

  it('navigate 函數可以切換頁面', async () => {
    const { activePage, navigate } = await import('../src/stores/ui.js');
    let value;
    activePage.subscribe(v => value = v)();
    expect(value).toBe('network');
    
    navigate('services');
    activePage.subscribe(v => value = v)();
    expect(value).toBe('services');
    
    navigate('settings');
    activePage.subscribe(v => value = v)();
    expect(value).toBe('settings');
  });
});
