/* global chrome */

import {
  BASE_POLL_INTERVAL_MS,
  computeNextPollDelay,
  decodePolledCalls,
  EMPTY_POLL_RESULT,
} from './devtools-polling.ts';

const pendingEntries = [];
const pendingSchemas = [];
const MAX_PENDING_EVENTS = 1000;
let panelWindow = null;
let currentPollDelayMs = BASE_POLL_INTERVAL_MS;
let flushTimer = null;

function scheduleBridgePoll(delayMs = currentPollDelayMs) {
  setTimeout(pollBridgeEvents, delayMs);
}

function schedulePendingFlush(delayMs = 50) {
  if (flushTimer !== null) {
    return;
  }

  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushPendingEntries();

    if (panelWindow && (pendingEntries.length > 0 || pendingSchemas.length > 0)) {
      schedulePendingFlush();
    }
  }, delayMs);
}

function pushPending(queue, data) {
  queue.push(data);
  if (queue.length > MAX_PENDING_EVENTS) {
    queue.splice(0, queue.length - Math.floor(MAX_PENDING_EVENTS / 2));
  }
  schedulePendingFlush();
}

function dispatchCall(data) {
  if (panelWindow?.dispatchGrpcEvent) {
    panelWindow.dispatchGrpcEvent(data);
    return;
  }

  pushPending(pendingEntries, data);
}

function dispatchSchema(data) {
  if (panelWindow?.dispatchSchemaEvent) {
    panelWindow.dispatchSchemaEvent(data);
    return;
  }

  pushPending(pendingSchemas, data);
}

function dispatchPageContext(pageHref) {
  if (panelWindow?.dispatchPageContext && typeof pageHref === 'string' && pageHref) {
    panelWindow.dispatchPageContext({ pageHref });
  }
}

function shouldDispatchCallForPage(data, pageHref) {
  const frameHref = typeof data?._debugFrameHref === 'string' ? data._debugFrameHref : '';

  if (!pageHref || !frameHref) {
    return true;
  }

  return frameHref === pageHref;
}

function flushPendingEntries() {
  if (!panelWindow || !panelWindow.dispatchGrpcEvent || !panelWindow.dispatchSchemaEvent) {
    return;
  }

  while (pendingSchemas.length > 0 && panelWindow.dispatchSchemaEvent) {
    panelWindow.dispatchSchemaEvent(pendingSchemas.shift());
  }

  while (pendingEntries.length > 0 && panelWindow.dispatchGrpcEvent) {
    panelWindow.dispatchGrpcEvent(pendingEntries.shift());
  }
}

function pollBridgeEvents() {
  chrome.devtools.inspectedWindow.eval(
    `(function() {
      var queue = window.__GRPC_DEBUGGER_EVENT_QUEUE__;
      if (!Array.isArray(queue) || queue.length === 0) {
        return '${EMPTY_POLL_RESULT}';
      }

      var pageHref = window.location.href || '';
      var events = queue.slice();
      queue.splice(0, queue.length);
      return JSON.stringify({ pageHref: pageHref, events: events });
    })()`,
    (result, isException) => {
      let hadEvents = false;

      try {
        const { pageHref, events } = isException
          ? { pageHref: '', events: [] }
          : decodePolledCalls(result);
        hadEvents = events.length > 0;
        dispatchPageContext(pageHref);

        for (const event of events) {
          if (event?.kind === 'schema' && event.data) {
            dispatchSchema(event.data);
            continue;
          }

          if (event?.kind === 'call' && event.data && shouldDispatchCallForPage(event.data, pageHref)) {
            dispatchCall(event.data);
          }
        }
      } finally {
        currentPollDelayMs = computeNextPollDelay({
          hadCalls: hadEvents,
          currentDelayMs: currentPollDelayMs,
        });
        scheduleBridgePoll();
      }
    }
  );
}

scheduleBridgePoll();

chrome.devtools.panels.create('gRPC Debugger', 'launchericon-48-48.png', 'index.html', (panel) => {
  panel.onShown.addListener((win) => {
    panelWindow = win;
    schedulePendingFlush(0);
  });

  if (panel.onHidden?.addListener) {
    panel.onHidden.addListener(() => {
      panelWindow = null;
    });
  }
});
