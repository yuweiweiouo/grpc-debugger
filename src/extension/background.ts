/* global chrome */

chrome.runtime.onInstalled.addListener(() => {
  // 保留 service worker 入口，資料接收已改由 page bridge + devtools polling 處理。
});
