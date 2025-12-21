import { derived } from 'svelte/store';
import { language } from '../stores/settings';

export const translations = {
  en: {
    network: 'Network',
    services: 'Services',
    settings: 'Settings',
    filter_placeholder: 'Filter methods...',
    clear_logs: 'Clear logs',
    no_requests: 'No gRPC requests detected.',
    headers: 'Headers',
    request: 'Request',
    response: 'Response',
    proto: 'Proto',
    general: 'General',
    status: 'Status',
    request_headers: 'Request Headers',
    no_data: 'No data found or schema missing.',
    loaded_services: 'Loaded Services',
    clear_all: 'Clear All',
    language: 'Language',
    coming_soon: 'Coming soon...',
    select_request: 'Select a request to view details',
    no_schemas_yet: 'No schemas registered yet.',
    hint_register: 'Use Reflection or register via Frontend API.',
  },
  zh: {
    network: '網路紀錄',
    services: '服務列表',
    settings: '設定',
    filter_placeholder: '過濾方法...',
    clear_logs: '清除紀錄',
    no_requests: '尚未偵測到 gRPC 請求。',
    headers: '標頭',
    request: '請求內容',
    response: '響應內容',
    proto: '定義 (Proto)',
    general: '一般資訊',
    status: '狀態',
    request_headers: '請求標頭',
    no_data: '找不到數據或缺少 Schema 定義。',
    loaded_services: '已載入的服務',
    clear_all: '全部清除',
    language: '語系設定',
    coming_soon: '即將推出...',
    select_request: '選擇一個請求以查看詳情',
    no_schemas_yet: '尚未註冊任何 Schema 定義。',
    hint_register: '請使用 Reflection 或透過前端 API 註冊。',
  }
};

export const t = derived(language, ($lang) => {
  return (key) => translations[$lang][key] || key;
});
