import { get } from 'svelte/store';
import { describe, it, expect, beforeEach } from 'vitest';

globalThis.localStorage = globalThis.localStorage || (() => {
  let store = {};
  return {
    getItem: (key) => store[key] ?? null,
    setItem: (key, value) => {
      store[key] = String(value);
    },
    removeItem: (key) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

const { log, filteredLog, filterValue, selectedEntry, selectedId, addLog, reprocessAllLogs, clearLogs } =
  await import('../src/stores/network.js');
const { services } = await import('../src/stores/schema.js');

function makeEntry(overrides = {}) {
  return {
    id: 'entry-1',
    method: '/pkg.Service/Call',
    requestHeaders: {},
    request: { hello: 'world' },
    response: { ok: true },
    ...overrides,
  };
}

describe('network store postmessage only', () => {
  beforeEach(() => {
    localStorage.clear();
    clearLogs(true);
    services.set([]);
    filterValue.set('');
    selectedId.set(null);
  });

  it('addLog 會正規化 endpoint 並保留已解碼資料', async () => {
    await addLog(
      makeEntry({
        id: 'decoded-entry',
        method: '/pkg.Service/StreamCall',
        request: { hello: 'grpc' },
      })
    );

    expect(get(log)[0]).toMatchObject({
      endpoint: 'StreamCall',
      request: { hello: 'grpc' },
    });
  });

  it('reprocessAllLogs 在 postmessage only 模式下為 no-op', async () => {
    const entry = makeEntry({ id: 'noop-entry' });
    log.set([entry]);

    await expect(reprocessAllLogs()).resolves.toBeUndefined();
    expect(get(log)).toEqual([entry]);
  });

  it('同 id addLog 會合併後續更新', async () => {
    await addLog(makeEntry({ id: 'same', response: null, status: 'pending' }));
    await addLog(makeEntry({ id: 'same', response: { ok: true }, status: 'finished' }));

    expect(get(log)).toHaveLength(1);
    expect(get(log)[0]).toMatchObject({
      id: 'same',
      status: 'finished',
      response: { ok: true },
    });
  });

  it('filteredLog 對 hidden services 使用 service prefix 過濾', () => {
    services.set([
      { fullName: 'pkg.HiddenService', hidden: true },
      { fullName: 'pkg.VisibleService', hidden: false },
    ]);
    log.set([
      makeEntry({ id: 'hidden', method: '/pkg.HiddenService/Call', endpoint: 'Call' }),
      makeEntry({ id: 'visible', method: '/pkg.VisibleService/Call', endpoint: 'Call' }),
    ]);

    expect(get(filteredLog).map((entry) => entry.id)).toEqual(['visible']);
  });

  it('filteredLog 在 entry 缺少 endpoint 時仍可依 method 過濾', () => {
    filterValue.set('stream');
    log.set([
      makeEntry({ id: 'method-only', method: '/pkg.Service/StreamCall', endpoint: undefined }),
      makeEntry({ id: 'other-method', method: '/pkg.Service/UnaryCall', endpoint: undefined }),
    ]);

    expect(get(filteredLog).map((entry) => entry.id)).toEqual(['method-only']);
  });

  it('filteredLog 在 entry 缺少 method 時仍可依 endpoint 過濾', () => {
    filterValue.set('stream');
    log.set([
      makeEntry({ id: 'endpoint-only', method: undefined, endpoint: 'StreamCall' }),
      makeEntry({ id: 'other-endpoint', method: undefined, endpoint: 'UnaryCall' }),
    ]);

    expect(get(filteredLog).map((entry) => entry.id)).toEqual(['endpoint-only']);
  });

  it('selectedEntry 會在列表順序變動後仍指向相同 id 的 entry', () => {
    const first = makeEntry({ id: 'first', endpoint: 'FirstCall' });
    const second = makeEntry({ id: 'second', endpoint: 'SecondCall' });

    log.set([first, second]);
    selectedId.set('second');

    log.set([makeEntry({ id: 'new', endpoint: 'NewCall' }), first, second]);

    expect(get(selectedEntry)?.id).toBe('second');
  });

  it('selectedEntry 在選取項目被 filter 隱藏後仍保留原始選取', () => {
    const first = makeEntry({ id: 'first', endpoint: 'FirstCall' });
    const second = makeEntry({ id: 'second', endpoint: 'SecondCall' });

    log.set([first, second]);
    selectedId.set('second');
    filterValue.set('first');

    expect(get(filteredLog).map((entry) => entry.id)).toEqual(['first']);
    expect(get(selectedEntry)?.id).toBe('second');
  });
});
