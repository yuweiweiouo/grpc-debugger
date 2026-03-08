import { writable } from 'svelte/store';

export const STORAGE_KEYS = Object.freeze({
  LANGUAGE: 'grpc_debugger_lang',
  POST_MESSAGE: 'grpc_debugger_postmessage',
  REFLECTION: 'grpc_debugger_reflection',
  COMBINED_VIEW: 'grpc_debugger_combined_view',
  LIST_PANE_WIDTH: 'grpc_debugger_list_width',
});

const initialLanguage = localStorage.getItem(STORAGE_KEYS.LANGUAGE) || 'en';

export const language = writable(initialLanguage);

language.subscribe(val => {
  localStorage.setItem(STORAGE_KEYS.LANGUAGE, val);
});

const initialPostMessage = localStorage.getItem(STORAGE_KEYS.POST_MESSAGE) !== 'false';
const initialReflection = localStorage.getItem(STORAGE_KEYS.REFLECTION) !== 'false';

export const enablePostMessage = writable(initialPostMessage);
export const enableReflection = writable(initialReflection);

enablePostMessage.subscribe(val => {
  localStorage.setItem(STORAGE_KEYS.POST_MESSAGE, String(val));
});

enableReflection.subscribe(val => {
  localStorage.setItem(STORAGE_KEYS.REFLECTION, String(val));
});

const initialCombinedView = localStorage.getItem(STORAGE_KEYS.COMBINED_VIEW) === 'true';
export const combinedView = writable(initialCombinedView);

combinedView.subscribe(val => {
  localStorage.setItem(STORAGE_KEYS.COMBINED_VIEW, val ? 'true' : 'false');
});
