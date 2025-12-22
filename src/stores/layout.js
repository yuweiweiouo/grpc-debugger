import { writable } from 'svelte/store';

// 預設寬度 400px，確保時間戳與耗時欄位皆可見
const initialWidth = parseInt(localStorage.getItem('grpc_debugger_list_width')) || 400;

export const listPaneWidth = writable(initialWidth);

listPaneWidth.subscribe(val => {
  localStorage.setItem('grpc_debugger_list_width', val.toString());
});
