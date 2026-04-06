const BRIDGE_KEY = '__GRPC_DEBUGGER_BRIDGE__';
const EVENT_QUEUE_KEY = '__GRPC_DEBUGGER_EVENT_QUEUE__';
const BRIDGE_EVENT_SOURCE = '__GRPC_DEBUGGER_BRIDGE_EVENT__';
const MAX_QUEUED_EVENTS = 1000;

function sanitizeForBridge(value, seen = new WeakSet()) {
  if (value == null) {
    return value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'function') {
    return undefined;
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (value instanceof Uint8Array) {
    return Array.from(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (seen.has(value)) {
    return '[Circular]';
  }

  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForBridge(item, seen));
  }

  const next = {};
  for (const [key, item] of Object.entries(value)) {
    const sanitized = sanitizeForBridge(item, seen);
    if (sanitized !== undefined) {
      next[key] = sanitized;
    }
  }
  return next;
}

export function normalizeMethodPath(value) {
  if (!value || typeof value !== 'string') {
    return '';
  }

  const bracketMatch = value.match(/^(\w+)\s*\[([^\]]+)\]$/);
  if (bracketMatch) {
    return `/${bracketMatch[2]}/${bracketMatch[1]}`;
  }

  return value.startsWith('/') ? value : `/${value}`;
}

export function ensureDebuggerBridge(target = window) {
  if (target[BRIDGE_KEY]) {
    return target[BRIDGE_KEY];
  }

  const eventQueue = target[EVENT_QUEUE_KEY] = target[EVENT_QUEUE_KEY] || [];

  const bridge = {
    enqueueEvent(event) {
      if (!event) {
        return;
      }

      const normalizedEvent = sanitizeForBridge(event);

      if (target !== target.top) {
        let forwarded = false;
        try {
          target.top.postMessage(
            {
              source: BRIDGE_EVENT_SOURCE,
              action: 'enqueueBridgeEvent',
              payload: normalizedEvent,
            },
            '*'
          );
          forwarded = true;
        } catch {
          // ignore forwarding failures and fall back to local queue
        }

        if (forwarded) {
          return;
        }
      }

      eventQueue.push(normalizedEvent);
      if (eventQueue.length > MAX_QUEUED_EVENTS) {
        eventQueue.splice(0, eventQueue.length - Math.floor(MAX_QUEUED_EVENTS / 2));
      }
    },

    enqueueCall(data) {
      this.enqueueEvent({ kind: 'call', data });
    },

    enqueueSchema(schema, source = '') {
      if (!schema) {
        return;
      }

      this.enqueueEvent({
        kind: 'schema',
        data: { schema, source },
      });
    },

  };

  target[BRIDGE_KEY] = bridge;
  return bridge;
}
