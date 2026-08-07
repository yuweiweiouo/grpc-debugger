import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

globalThis.localStorage = globalThis.localStorage || (() => {
  let store = {};
  return {
    getItem: (key) => store[key] ?? null,
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

describe('inspector clearing', () => {
  let clearInspectorRecords;
  let activeTabId;
  let setRequestDetection;
  let setProtoDetection;
  let requestDetectionEnabled;
  let protoDetectionEnabled;
  let log;
  let selectedId;
  let resolveClear;

  beforeEach(async () => {
    localStorage.clear();
    vi.resetModules();
    resolveClear = null;
    globalThis.chrome = {
      runtime: {
        sendMessage: vi.fn((message) => {
          if (message.type === 'clear') {
            return new Promise((resolve) => { resolveClear = resolve; });
          }
          if (message.type === 'status') {
            return Promise.resolve({ ok: true, attached: true, urlFilter: '', hiddenServices: [] });
          }
          if (message.type === 'records') {
            return Promise.resolve({ ok: true, records: [] });
          }
          if (message.type === 'setDetectionMode') {
            return Promise.resolve({
              ok: true,
              attached: message.protoDetectionEnabled,
              urlFilter: message.urlFilter,
              requestDetectionEnabled: message.requestDetectionEnabled,
              protoDetectionEnabled: message.protoDetectionEnabled,
            });
          }
          return Promise.resolve({ ok: true });
        }),
      },
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 12 }]),
      },
    };

    ({
      clearInspectorRecords,
      activeTabId,
      setRequestDetection,
      setProtoDetection,
      requestDetectionEnabled,
      protoDetectionEnabled,
    } = await import('../src/stores/inspector.js'));
    ({ log, selectedId } = await import('../src/stores/network.js'));
  });

  it('背景清除尚未完成時立即清空目前面板', async () => {
    activeTabId.set(12);
    log.set([{ id: 'record-1' }]);
    selectedId.set('record-1');

    const clearing = clearInspectorRecords(12);

    expect(get(log)).toEqual([]);
    expect(get(selectedId)).toBeNull();
    expect(resolveClear).toBeTypeOf('function');

    resolveClear({ ok: true });
    await clearing;
  });

  it('其他分頁的導覽不會清除目前面板', async () => {
    activeTabId.set(12);
    log.set([{ id: 'record-1' }]);

    const clearing = clearInspectorRecords(99);

    expect(get(log)).toEqual([{ id: 'record-1' }]);
    resolveClear({ ok: true });
    await clearing;
  });

  it('Proto 偵測依附於請求偵測開關', async () => {
    await setRequestDetection(true);

    expect(get(requestDetectionEnabled)).toBe(true);
    expect(get(protoDetectionEnabled)).toBe(false);
    expect(chrome.runtime.sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'setDetectionMode',
      requestDetectionEnabled: true,
      protoDetectionEnabled: false,
    }));

    await setProtoDetection(true);

    expect(get(protoDetectionEnabled)).toBe(true);
    expect(chrome.runtime.sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'setDetectionMode',
      requestDetectionEnabled: true,
      protoDetectionEnabled: true,
    }));

    await setRequestDetection(false);

    expect(get(requestDetectionEnabled)).toBe(false);
    expect(get(protoDetectionEnabled)).toBe(false);
  });
});
