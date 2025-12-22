import { writable } from 'svelte/store';

// 預設寬度 350px
const initialWidth = parseInt(localStorage.getItem('grpc_debugger_list_width')) || 350;

export const listPaneWidth = writable(initialWidth);

listPaneWidth.subscribe(val => {
  localStorage.setItem('grpc_debugger_list_width', val.toString());
});
