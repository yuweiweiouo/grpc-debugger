import { writable } from 'svelte/store';

const initialLanguage = localStorage.getItem('grpc_debugger_lang') || 'en';

export const language = writable(initialLanguage);

language.subscribe(val => {
  localStorage.setItem('grpc_debugger_lang', val);
});
