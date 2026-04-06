import { describe, expect, it, vi } from 'vitest';
import { ensureDebuggerBridge, normalizeMethodPath } from '../src/extension/page-bridge.ts';

describe('page bridge', () => {
  it('會正規化 legacy method path 格式', () => {
    expect(normalizeMethodPath('UnaryCall [pkg.Service]')).toBe('/pkg.Service/UnaryCall');
    expect(normalizeMethodPath('/pkg.Service/UnaryCall')).toBe('/pkg.Service/UnaryCall');
    expect(normalizeMethodPath('pkg.Service/UnaryCall')).toBe('/pkg.Service/UnaryCall');
  });

  it('會保留 enqueue 的每一筆 call 事件', () => {
    const target = {};
    const bridge = ensureDebuggerBridge(target);
    const now = Date.now();

    bridge.enqueueCall({
      method: '/pkg.Service/UnaryCall',
      request: { hello: 'world' },
      response: { ok: true },
      startTime: now,
    });
    bridge.enqueueCall({
      method: '/pkg.Service/UnaryCall',
      request: { hello: 'world' },
      response: { ok: true },
      startTime: now + 10,
    });

    expect(target.__GRPC_DEBUGGER_EVENT_QUEUE__).toHaveLength(2);
  });

  it('子 frame 事件會轉送到 top window', () => {
    const postMessage = vi.fn();
    const topTarget = { postMessage };
    const childTarget = { top: topTarget };
    const bridge = ensureDebuggerBridge(childTarget);

    bridge.enqueueCall({
      method: '/pkg.Service/UnaryCall',
      request: { id: 1n },
    });

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][0]).toMatchObject({
      source: '__GRPC_DEBUGGER_BRIDGE_EVENT__',
      action: 'enqueueBridgeEvent',
      payload: {
        kind: 'call',
        data: {
          method: '/pkg.Service/UnaryCall',
          request: { id: '1' },
        },
      },
    });
  });
});
