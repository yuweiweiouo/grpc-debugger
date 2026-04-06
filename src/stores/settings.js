import { writable } from 'svelte/store';

const SUPPORTED_LANGUAGES = new Set(['en', 'zh']);

export const STORAGE_KEYS = Object.freeze({
  LANGUAGE: 'grpc_debugger_lang',
  COMBINED_VIEW: 'grpc_debugger_combined_view',
  LIST_PANE_WIDTH: 'grpc_debugger_list_width',
  THEME: 'grpc_debugger_theme',
});

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
