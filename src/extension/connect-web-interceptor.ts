// @ts-nocheck
// Connect-Web 路徑目前不做自動 hook，僅保留手動整合 API 入口。

const interceptor = (next) => async (req) => {
  return await next(req);
};

window.__CONNECT_WEB_DEVTOOLS__ = interceptor;

window.__CONNECT_WEB_DEVTOOLS__.registerType = function(typeName, typeClass) {
  window.__CONNECT_WEB_DEVTOOLS__._types = window.__CONNECT_WEB_DEVTOOLS__._types || {};
  window.__CONNECT_WEB_DEVTOOLS__._types[typeName] = typeClass;
};

const readyEvent = new CustomEvent('connect-web-dev-tools-ready');
window.dispatchEvent(readyEvent);
