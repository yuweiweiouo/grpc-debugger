import { get, writable } from 'svelte/store';

const SUPPORTED_LANGUAGES = new Set(['en', 'zh']);

export const STORAGE_KEYS = Object.freeze({
  LANGUAGE: 'grpc_debugger_lang',
  COMBINED_VIEW: 'grpc_debugger_combined_view',
  LIST_PANE_WIDTH: 'grpc_debugger_list_width',
  THEME: 'grpc_debugger_theme',
  LISTEN_LEGACY_POSTMESSAGE: 'grpc_debugger_listen_legacy_postmessage',
  LISTEN_GRPC_WEB_DEVTOOLS: 'grpc_debugger_listen_grpc_web_devtools',
});

function getDomainStorageKey(baseKey, domainKey) {
  return `${baseKey}:${domainKey}`;
}

function parseBooleanStorage(value, fallbackValue) {
  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  return fallbackValue;
}

export function getDomainKeyFromHref(href) {
  if (!href || typeof href !== 'string') {
    return '';
  }

  try {
    const url = new URL(href);
    return url.host || url.hostname || '';
  } catch {
    return '';
  }
}

export const inspectedPage = writable({ href: '', domainKey: '' });

export function setInspectedPageHref(href = '') {
  inspectedPage.set({
    href,
    domainKey: getDomainKeyFromHref(href),
  });
}

function createDomainScopedBooleanStore(storageKey, defaultValue) {
  const store = writable(defaultValue);
  let activeDomainKey = '';
  let hydrating = false;

  inspectedPage.subscribe(({ domainKey }) => {
    activeDomainKey = domainKey || '';
    hydrating = true;

    if (!activeDomainKey) {
      store.set(defaultValue);
      hydrating = false;
      return;
    }

    const storedValue = localStorage.getItem(getDomainStorageKey(storageKey, activeDomainKey));
    store.set(parseBooleanStorage(storedValue, defaultValue));
    hydrating = false;
  });

  store.subscribe((value) => {
    if (hydrating || !activeDomainKey) {
      return;
    }

    localStorage.setItem(getDomainStorageKey(storageKey, activeDomainKey), value ? 'true' : 'false');
  });

  return store;
}

const storedLanguage = localStorage.getItem(STORAGE_KEYS.LANGUAGE);
const initialLanguage = SUPPORTED_LANGUAGES.has(storedLanguage) ? storedLanguage : 'en';

export const language = writable(initialLanguage);

language.subscribe(val => {
  localStorage.setItem(STORAGE_KEYS.LANGUAGE, val);
});

const initialCombinedView = localStorage.getItem(STORAGE_KEYS.COMBINED_VIEW) === 'true';
export const combinedView = writable(initialCombinedView);

combinedView.subscribe(val => {
  localStorage.setItem(STORAGE_KEYS.COMBINED_VIEW, val ? 'true' : 'false');
});

const initialTheme = localStorage.getItem(STORAGE_KEYS.THEME) || 'system';
export const theme = writable(initialTheme);

theme.subscribe(val => {
  localStorage.setItem(STORAGE_KEYS.THEME, val);
});

export const listenLegacyPostmessage = createDomainScopedBooleanStore(
  STORAGE_KEYS.LISTEN_LEGACY_POSTMESSAGE,
  true
);

export const listenGrpcWebDevtools = createDomainScopedBooleanStore(
  STORAGE_KEYS.LISTEN_GRPC_WEB_DEVTOOLS,
  true
);

export function shouldCaptureCall(entry) {
  const inspected = get(inspectedPage);
  const frameHref = typeof entry?._debugFrameHref === 'string' ? entry._debugFrameHref : '';
  const ingress = entry?._debugIngress;

  if (inspected.href && frameHref && frameHref !== inspected.href) {
    return false;
  }

  if (ingress === 'legacy-postmessage') {
    return get(listenLegacyPostmessage);
  }

  if (ingress === 'grpc-web-devtools') {
    return get(listenGrpcWebDevtools);
  }

  return true;
}
