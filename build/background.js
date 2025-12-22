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

// ============================================================================
// Message Handlers
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (!tabId || !connections[tabId]?.panel) return;

  // Relay registration messages to the panel
  connections[tabId].panel.postMessage(message);
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
