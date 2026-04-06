/* global chrome */

function injectScripts() {
  const scripts = ['connect-web-interceptor.js', 'grpc-web-injector.js'];

  scripts.forEach((name) => {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL(name);
    script.async = false;
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  });
}

if (window.__GRPC_DEBUGGER_CONTENT_SCRIPT_INJECTED__) {
  console.log('[gRPC Debugger] Content script already active, skipping.');
} else {
  window.__GRPC_DEBUGGER_CONTENT_SCRIPT_INJECTED__ = true;

  const VERSION = 'v2.25';

  console.log(
    `%c[gRPC Debugger ${VERSION}] Content Script Active`,
    'background: #2563eb; color: white; padding: 2px 5px; border-radius: 3px;'
  );

  injectScripts();
}
