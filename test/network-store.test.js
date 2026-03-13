import { get } from 'svelte/store';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

globalThis.localStorage = globalThis.localStorage || (() => {
  let store = {};
  return {
    getItem: (key) => store[key] ?? null,
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

const {
  log,
  filteredLog,
  filterValue,
  selectedEntry,
  selectedId,
  addLog,
  reprocessAllLogs,
  clearLogs,
} = await import('../src/stores/network.js');
const { protoEngine } = await import('../src/lib/proto-engine.js');
const { services } = await import('../src/stores/schema.js');
const { enablePostMessage, enableReflection } = await import('../src/stores/settings.js');

function makeEntry(overrides = {}) {
  return {
    id: 'entry-1',
    method: '/pkg.Service/Call',
    requestHeaders: {},
    ...overrides,
  };
}

describe('network selective reprocessing', () => {
  beforeEach(() => {
    localStorage.clear();
    clearLogs(true);
    services.set([]);
    filterValue.set('');
    selectedId.set(null);
    enablePostMessage.set(true);
    enableReflection.set(true);

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(protoEngine, 'findMethod').mockReturnValue({
      requestType: 'pkg.Request',
      responseType: 'pkg.Response',
    });
    vi.spyOn(protoEngine, 'decodeMessage').mockImplementation((typeName, payload) => ({
      $typeName: typeName,
      size: payload.length,
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearLogs(true);
    services.set([]);
    filterValue.set('');
    selectedId.set(null);
    enablePostMessage.set(true);
    enableReflection.set(true);
  });

  it('只重試依賴 schema 的 decode failure entry', async () => {
    const schemaDependentEntry = makeEntry({
      id: 'schema-dependent',
      requestRaw: new Uint8Array([1, 2, 3]),
      request: {
        _error: '找不到 Schema 定義: pkg.Request',
        _decodeReason: 'missing_schema',
      },
    });
    const otherDecodeFailureEntry = makeEntry({
      id: 'other-decode-failure',
      requestRaw: new Uint8Array([4, 5, 6]),
      request: { _error: '解碼失敗: invalid wire type' },
    });

    log.set([schemaDependentEntry, otherDecodeFailureEntry]);

    await reprocessAllLogs();

    expect(protoEngine.decodeMessage).toHaveBeenCalledTimes(1);
    expect(schemaDependentEntry.request).toEqual({
      $typeName: 'pkg.Request',
      size: 3,
    });
    expect(otherDecodeFailureEntry.request).toEqual({
      _error: '解碼失敗: invalid wire type',
    });
  });

  it('不重試 interceptor entry', async () => {
    const interceptorEntry = makeEntry({
      id: 'interceptor-entry',
      _source: 'interceptor',
      requestRaw: new Uint8Array([1, 2, 3]),
      request: { hello: 'world' },
    });

    log.set([interceptorEntry]);

    await reprocessAllLogs();

    expect(protoEngine.decodeMessage).not.toHaveBeenCalled();
    expect(interceptorEntry.request).toEqual({ hello: 'world' });
  });

  it('沒有 raw payload 的 entry 不應被 retry', async () => {
    const noRawPayloadEntry = makeEntry({
      id: 'no-raw-payload',
      request: {
        _error: '找不到 Schema 定義: pkg.Request',
        _decodeReason: 'missing_schema',
      },
    });

    log.set([noRawPayloadEntry]);

    await reprocessAllLogs();

    expect(protoEngine.decodeMessage).not.toHaveBeenCalled();
    expect(noRawPayloadEntry.request).toEqual({
      _error: '找不到 Schema 定義: pkg.Request',
      _decodeReason: 'missing_schema',
    });
  });

  it('response 端的 missing schema entry 也應被 selective retry', async () => {
    const responseSchemaDependentEntry = makeEntry({
      id: 'response-schema-dependent',
      responseRaw: new Uint8Array([9, 8, 7]),
      response: {
        _error: '找不到 Schema 定義: pkg.Response',
        _decodeReason: 'missing_schema',
      },
    });

    log.set([responseSchemaDependentEntry]);

    await reprocessAllLogs();

    expect(protoEngine.decodeMessage).toHaveBeenCalledTimes(1);
    expect(protoEngine.decodeMessage).toHaveBeenCalledWith(
      'pkg.Response',
      expect.any(Uint8Array)
    );
    expect(responseSchemaDependentEntry.response).toEqual({
      $typeName: 'pkg.Response',
      size: 3,
    });
  });

  it('已成功 decode 的 entry 不應再次被 reprocess', async () => {
    const decodedRequest = { hello: 'world' };
    const alreadyDecodedEntry = makeEntry({
      id: 'already-decoded',
      requestRaw: new Uint8Array([7, 8, 9]),
      request: decodedRequest,
    });

    log.set([alreadyDecodedEntry]);

    await reprocessAllLogs();

    expect(protoEngine.decodeMessage).not.toHaveBeenCalled();
    expect(alreadyDecodedEntry.request).toBe(decodedRequest);
  });
});

describe('network store optimization paths', () => {
  beforeEach(() => {
    localStorage.clear();
    clearLogs(true);
    services.set([]);
    filterValue.set('');
    selectedId.set(null);
    enablePostMessage.set(true);
    enableReflection.set(true);

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(protoEngine, 'findMethod').mockReturnValue({
      requestType: 'pkg.Request',
      responseType: 'pkg.Response',
    });
    vi.spyOn(protoEngine, 'decodeMessage').mockImplementation((typeName, payload) => ({
      $typeName: typeName,
      size: payload.length,
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearLogs(true);
    services.set([]);
    filterValue.set('');
    selectedId.set(null);
    enablePostMessage.set(true);
    enableReflection.set(true);
  });

  it('filteredLog 對 hidden services 使用常數時間 lookup', () => {
    services.set([
      { fullName: 'pkg.HiddenService', hidden: true },
      { fullName: 'pkg.VisibleService', hidden: false },
    ]);
    log.set([
      makeEntry({ id: 'hidden', method: '/pkg.HiddenService/Call', endpoint: 'Call' }),
      makeEntry({ id: 'visible', method: '/pkg.VisibleService/Call', endpoint: 'Call' }),
    ]);

    const someSpy = vi.spyOn(Array.prototype, 'some');
    const entries = get(filteredLog);

    expect(entries.map(entry => entry.id)).toEqual(['visible']);
    expect(someSpy).not.toHaveBeenCalled();
  });

  it('filteredLog 在 entry 缺少 endpoint 時仍可依 method 過濾', () => {
    filterValue.set('stream');
    log.set([
      makeEntry({ id: 'method-only', method: '/pkg.Service/StreamCall' }),
      makeEntry({ id: 'other-method', method: '/pkg.Service/UnaryCall' }),
    ]);

    expect(() => get(filteredLog)).not.toThrow();
    expect(get(filteredLog).map(entry => entry.id)).toEqual(['method-only']);
  });

  it('filteredLog 在 entry 缺少 method 時仍可依 endpoint 過濾', () => {
    filterValue.set('stream');
    log.set([
      makeEntry({ id: 'endpoint-only', method: undefined, endpoint: 'StreamCall' }),
      makeEntry({ id: 'other-endpoint', method: undefined, endpoint: 'UnaryCall' }),
    ]);

    expect(() => get(filteredLog)).not.toThrow();
    expect(get(filteredLog).map(entry => entry.id)).toEqual(['endpoint-only']);
  });

  it('addLog 會正規化 endpoint，且 interceptor 不走 decode pipeline', async () => {
    const interceptorEntry = makeEntry({
      id: 'interceptor-entry',
      _source: 'interceptor',
      method: '/pkg.Service/StreamCall',
      request: { hello: 'world' },
    });

    await addLog(interceptorEntry);

    const [storedEntry] = get(log);
    expect(storedEntry.endpoint).toBe('StreamCall');
    expect(storedEntry.request).toEqual({ hello: 'world' });
    expect(protoEngine.decodeMessage).not.toHaveBeenCalled();
  });

  it('addLog 會尊重來源開關 gate', async () => {
    enablePostMessage.set(false);
    await addLog(makeEntry({ id: 'interceptor-disabled', _source: 'interceptor' }));

    enableReflection.set(false);
    await addLog(makeEntry({ id: 'reflection-disabled', _source: 'reflection' }));

    expect(get(log)).toEqual([]);
  });

  it('selectedEntry 會在列表順序變動後仍指向相同 id 的 entry', () => {
    const first = makeEntry({ id: 'first', endpoint: 'FirstCall' });
    const second = makeEntry({ id: 'second', endpoint: 'SecondCall' });

    log.set([first, second]);
    selectedId.set('second');

    log.set([makeEntry({ id: 'new', endpoint: 'NewCall' }), first, second]);

    expect(get(selectedEntry)?.id).toBe('second');
  });

  it('selectedEntry 會在 filter 改變後仍維持相同選取項目', () => {
    const first = makeEntry({ id: 'first', endpoint: 'FirstCall' });
    const second = makeEntry({ id: 'second', endpoint: 'SecondCall' });

    log.set([first, second]);
    selectedId.set('second');
    filterValue.set('second');

    expect(get(selectedEntry)?.id).toBe('second');
  });

  it('selectedEntry 在選取項目被 filter 隱藏後仍保留原始選取', () => {
    const first = makeEntry({ id: 'first', endpoint: 'FirstCall' });
    const second = makeEntry({ id: 'second', endpoint: 'SecondCall' });

    log.set([first, second]);
    selectedId.set('second');
    filterValue.set('first');

    expect(get(filteredLog).map(entry => entry.id)).toEqual(['first']);
    expect(get(selectedEntry)?.id).toBe('second');
  });
});
