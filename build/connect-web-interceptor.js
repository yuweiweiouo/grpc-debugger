// gRPC Debugger - Connect-Web Integration
// All request interception is handled by chrome.debugger in background.js.
// This script provides an optional API for frontend to register proto definitions.

// Empty interceptor that does nothing - just passes through
// Request interception is handled automatically by the Debugger API
const interceptor = (next) => async (req) => {
  return await next(req);
};

window.__CONNECT_WEB_DEVTOOLS__ = interceptor;

// API for registering proto definitions (optional enhancement)
window.__CONNECT_WEB_DEVTOOLS__.registerType = function(typeName, typeClass) {
  // Store type info for potential future use with decoding
  window.__CONNECT_WEB_DEVTOOLS__._types = window.__CONNECT_WEB_DEVTOOLS__._types || {};
  window.__CONNECT_WEB_DEVTOOLS__._types[typeName] = typeClass;
};

// Dispatch ready event for backward compatibility
const readyEvent = new CustomEvent("connect-web-dev-tools-ready");
window.dispatchEvent(readyEvent);
