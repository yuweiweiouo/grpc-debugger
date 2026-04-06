export const BASE_POLL_INTERVAL_MS = 60;
export const MAX_IDLE_POLL_INTERVAL_MS = 600;
export const EMPTY_POLL_RESULT = '__GRPC_DEBUGGER_EMPTY__';

export function decodePolledCalls(result) {
  if (!result || result === EMPTY_POLL_RESULT) {
    return {
      pageHref: '',
      events: [],
    };
  }

  const parsed = JSON.parse(result);
  if (Array.isArray(parsed)) {
    return {
      pageHref: '',
      events: parsed,
    };
  }

  return {
    pageHref: typeof parsed?.pageHref === 'string' ? parsed.pageHref : '',
    events: Array.isArray(parsed?.events) ? parsed.events : [],
  };
}

export function computeNextPollDelay({
  hadCalls,
  currentDelayMs,
  baseDelayMs = BASE_POLL_INTERVAL_MS,
  maxDelayMs = MAX_IDLE_POLL_INTERVAL_MS,
}) {
  if (hadCalls) {
    return baseDelayMs;
  }

  const nextDelay = Math.max(currentDelayMs || baseDelayMs, baseDelayMs) * 2;
  return Math.min(nextDelay, maxDelayMs);
}
