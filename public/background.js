/* global chrome */
// gRPC Debugger - Background Service Worker
// 使用 Message Passing 中繼 Panel 與 DevTools 間的通訊

// ============================================================================
// Type Definitions (JSDoc)
// ============================================================================

/**
 * Tab 連線資訊
 * @typedef {Object} TabConnection
 * @property {chrome.runtime.Port} [panel] - DevTools Panel 連線
 * @property {chrome.runtime.Port} [content] - Content Script 連線
 */

// ============================================================================
// Global State
// ============================================================================

/** @type {Object.<number, TabConnection>} Tab ID -> 連線對照表 */
const connections = {};

/** @type {Map<string, {bodyBase64: string, timestamp: number}>} URL -> 攔截的 request body */
const capturedBodies = new Map();

// 定期清理過期的 captured bodies（超過 30 秒）
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of capturedBodies.entries()) {
    if (now - value.timestamp > 30000) {
      capturedBodies.delete(key);
    }
  }
}, 10000);

// ============================================================================
// Message Handlers
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  
  // 避免自循環
  if (message._relayedBy === 'background') return;

  // 處理 fetch-interceptor 攔截的 request body
  if (message.type === '__GRPCWEB_DEVTOOLS__' && message.action === 'capturedRequestBody') {
    if (tabId) {
      const key = `${tabId}_${message.url}`;
      capturedBodies.set(key, {
        bodyBase64: message.bodyBase64,
        timestamp: Date.now(),
      });
    }

    // 廣播給 extension 其他部分（panel, devtools.js）
    message._relayedBy = 'background';
    chrome.runtime.sendMessage(message);
    return;
  }
  
  // Relay other messages (like registerSchema)
  message._relayedBy = 'background';
  chrome.runtime.sendMessage(message);
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'panel' && port.name !== 'content') {
    return;
  }

  /**
   * 處理來自 Panel 或 Content Script 的訊息
   * @param {Object} message
   */
  const extensionListener = (message) => {
    const tabId = port.sender?.tab?.id >= 0 ? port.sender.tab.id : message.tabId;

    if (message.action === 'init') {
      if (!connections[tabId]) {
        connections[tabId] = {};
      }
      connections[tabId][port.name] = port;
      return;
    }

    // Relay gRPC network calls from panel (captured via devtools.network)
    if (message.action === 'gRPCNetworkCall') {
      const conn = connections[tabId]?.panel;
      if (conn) {
        conn.postMessage(message);
      }
      return;
    }

    if (message.target) {
      const conn = connections[tabId]?.[message.target];
      if (conn) {
        conn.postMessage(message);
      }
    }
  };

  port.onMessage.addListener(extensionListener);

  port.onDisconnect.addListener((disconnectedPort) => {
    disconnectedPort.onMessage.removeListener(extensionListener);

    for (const tabId of Object.keys(connections)) {
      if (connections[tabId][disconnectedPort.name] === disconnectedPort) {
        delete connections[tabId][disconnectedPort.name];

        if (Object.keys(connections[tabId]).length === 0) {
          delete connections[tabId];
        }
        break;
      }
    }
  });
});
