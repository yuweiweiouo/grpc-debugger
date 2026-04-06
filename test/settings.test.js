import { describe, expect, it, beforeEach, vi } from 'vitest';

const localStorageMock = (() => {
  let store = {};
  return {
    getItem: (key) => store[key] || null,
    setItem: (key, value) => { store[key] = value; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(global, 'localStorage', { value: localStorageMock });

describe('settings store', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it('STORAGE_KEYS 應包含所有必要的 key', async () => {
    const { STORAGE_KEYS } = await import('../src/stores/settings.js');
    expect(STORAGE_KEYS.LANGUAGE).toBe('grpc_debugger_lang');
    expect(STORAGE_KEYS.COMBINED_VIEW).toBe('grpc_debugger_combined_view');
    expect(STORAGE_KEYS.LIST_PANE_WIDTH).toBe('grpc_debugger_list_width');
    expect(STORAGE_KEYS.THEME).toBe('grpc_debugger_theme');
    expect(STORAGE_KEYS.LISTEN_LEGACY_POSTMESSAGE).toBe('grpc_debugger_listen_legacy_postmessage');
    expect(STORAGE_KEYS.LISTEN_GRPC_WEB_DEVTOOLS).toBe('grpc_debugger_listen_grpc_web_devtools');
  });

  it('language store 預設為 en', async () => {
    const { language } = await import('../src/stores/settings.js');
    let value;
    language.subscribe(v => value = v)();
    expect(value).toBe('en');
  });

  it('language store 遇到非法值時會 fallback 到 en', async () => {
    vi.resetModules();
    localStorageMock.clear();
    localStorageMock.setItem('grpc_debugger_lang', 'jp');
    const { language } = await import('../src/stores/settings.js');
    let value;
    language.subscribe(v => value = v)();
    expect(value).toBe('en');
  });

  it('combinedView store 預設為 false', async () => {
    vi.resetModules();
    localStorageMock.clear();
    const { combinedView } = await import('../src/stores/settings.js');
    let value;
    combinedView.subscribe(v => value = v)();
    expect(value).toBe(false);
  });

  it('theme store 預設為 system', async () => {
    vi.resetModules();
    localStorageMock.clear();
    const { theme } = await import('../src/stores/settings.js');
    let value;
    theme.subscribe(v => value = v)();
    expect(value).toBe('system');
  });

  it('監聽選項會依 domain 載入與儲存', async () => {
    vi.resetModules();
    localStorageMock.clear();
    const {
      listenLegacyPostmessage,
      listenGrpcWebDevtools,
      setInspectedPageHref,
    } = await import('../src/stores/settings.js');

    let legacyValue;
    let grpcWebValue;
    const unsubscribeLegacy = listenLegacyPostmessage.subscribe(v => legacyValue = v);
    const unsubscribeGrpcWeb = listenGrpcWebDevtools.subscribe(v => grpcWebValue = v);

    setInspectedPageHref('https://alpha.example.test/path');
    expect(legacyValue).toBe(true);
    expect(grpcWebValue).toBe(true);

    listenLegacyPostmessage.set(false);
    listenGrpcWebDevtools.set(false);

    setInspectedPageHref('https://beta.example.test/path');
    expect(legacyValue).toBe(true);
    expect(grpcWebValue).toBe(true);

    setInspectedPageHref('https://alpha.example.test/other');
    expect(legacyValue).toBe(false);
    expect(grpcWebValue).toBe(false);

    unsubscribeLegacy();
    unsubscribeGrpcWeb();
  });

  it('shouldCaptureCall 只接受當前頁面且符合 ingress 設定的事件', async () => {
    vi.resetModules();
    localStorageMock.clear();
    const {
      listenGrpcWebDevtools,
      setInspectedPageHref,
      shouldCaptureCall,
    } = await import('../src/stores/settings.js');

    setInspectedPageHref('https://example.test/current');
    listenGrpcWebDevtools.set(false);

    expect(shouldCaptureCall({
      _debugIngress: 'grpc-web-devtools',
      _debugFrameHref: 'https://example.test/current',
    })).toBe(false);

    expect(shouldCaptureCall({
      _debugIngress: 'legacy-postmessage',
      _debugFrameHref: 'https://example.test/other',
    })).toBe(false);

    expect(shouldCaptureCall({
      _debugIngress: 'manual-sendCall',
      _debugFrameHref: 'https://example.test/current',
    })).toBe(true);
  });
});
