/* global chrome */
/**
 * gRPC Debugger 1.0 - Content Script
 * Relays messages from the page to the background script.
 */

// v2.23: 防止重複注入
if (window.__GRPC_DEBUGGER_CONTENT_SCRIPT_INJECTED__) {
  console.log('[gRPC Debugger] Content script already active, skipping.');
} else {
  window.__GRPC_DEBUGGER_CONTENT_SCRIPT_INJECTED__ = true;
  
  const VERSION = "v2.23";
  console.log(`%c[gRPC Debugger ${VERSION}] Content Script Active`, "background: #3b82f6; color: white; padding: 2px 5px; border-radius: 3px;");

  const scripts = ["fetch-interceptor.js", "connect-web-interceptor.js", "grpc-web-injector.js"];
  scripts.forEach(s => {
    console.log(`[gRPC Debugger ${VERSION}] Injecting ${s}...`);
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL(s);
    (document.head || document.documentElement).appendChild(script);
  });
}

// Relay messages from page to background
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (event.data && event.data.type === "__GRPCWEB_DEVTOOLS__") {
    // Port to background is already connected in background.js via onConnect
    chrome.runtime.sendMessage(event.data);
  }
});
