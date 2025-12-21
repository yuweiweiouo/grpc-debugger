/* global chrome */
/**
 * gRPC Debugger 2.0 - Content Script
 * Relays messages from the page to the background script.
 */

// Inject registration helpers
const scripts = ["grpc-web-injector.js", "connect-web-interceptor.js"];
scripts.forEach(file => {
  const s = document.createElement("script");
  s.src = chrome.runtime.getURL(file);
  s.onload = () => s.remove();
  (document.head || document.documentElement).appendChild(s);
});

// Relay messages from page to background
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (event.data && event.data.type === "__GRPCWEB_DEVTOOLS__") {
    // Port to background is already connected in background.js via onConnect
    chrome.runtime.sendMessage(event.data);
  }
});
