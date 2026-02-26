import { writable } from 'svelte/store';

const initialLanguage = localStorage.getItem('grpc_debugger_lang') || 'en';

export const language = writable(initialLanguage);

language.subscribe(val => {
  localStorage.setItem('grpc_debugger_lang', val);
});

// 資料來源開關：PostMessage (interceptor) 與 Reflection，預設皆啟用
const initialPostMessage = localStorage.getItem('grpc_debugger_postmessage') !== 'false';
const initialReflection = localStorage.getItem('grpc_debugger_reflection') !== 'false';

export const enablePostMessage = writable(initialPostMessage);
export const enableReflection = writable(initialReflection);

enablePostMessage.subscribe(val => {
  localStorage.setItem('grpc_debugger_postmessage', String(val));
});

enableReflection.subscribe(val => {
  localStorage.setItem('grpc_debugger_reflection', String(val));
});
