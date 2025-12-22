/**
 * JavaScript 啟動入口
 * 
 * 負責將 Svelte 根組件掛載到 DOM，並啟動全域邏輯。
 */
import { mount } from 'svelte';
import App from './App.svelte';

const app = mount(App, {
  target: document.getElementById('app'),
});

export default app;
