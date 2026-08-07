const MESSAGE_TYPE = '__GRPC_DEBUGGER_LIGHTWEIGHT_CALL__';
const BRIDGE_KEY = '__GRPC_DEBUGGER_LIGHTWEIGHT_BRIDGE__';

if (!window[BRIDGE_KEY]) {
  window[BRIDGE_KEY] = true;
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.type !== MESSAGE_TYPE) return;
    void chrome.runtime.sendMessage({ type: 'lightweightPayload', payload: event.data.payload });
  });

  void chrome.runtime.sendMessage({ type: 'lightweightBridgeReady' });
}
