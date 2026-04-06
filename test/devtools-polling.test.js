import { describe, expect, it } from 'vitest';
import {
  computeNextPollDelay,
  decodePolledCalls,
  EMPTY_POLL_RESULT,
} from '../src/extension/devtools-polling.ts';

describe('devtools polling helpers', () => {
  describe('decodePolledCalls', () => {
    it('空佇列 sentinel 不應觸發 JSON parse', () => {
      expect(decodePolledCalls(EMPTY_POLL_RESULT)).toEqual([]);
      expect(decodePolledCalls('')).toEqual([]);
      expect(decodePolledCalls(null)).toEqual([]);
    });

    it('應保留頁面佇列中的 FIFO 順序', () => {
      const calls = [
        { method: '/svc/First', timestamp: 1 },
        { method: '/svc/Second', timestamp: 2 },
      ];

      expect(decodePolledCalls(JSON.stringify(calls))).toEqual(calls);
    });
  });

  describe('computeNextPollDelay', () => {
    it('有新資料時應立即回到基準 polling 間隔', () => {
      expect(computeNextPollDelay({ hadCalls: true, currentDelayMs: 2400 })).toBe(60);
    });

    it('idle 時應逐步退避，但不超過上限', () => {
      expect(computeNextPollDelay({ hadCalls: false, currentDelayMs: 60 })).toBe(120);
      expect(computeNextPollDelay({ hadCalls: false, currentDelayMs: 120 })).toBe(240);
      expect(computeNextPollDelay({ hadCalls: false, currentDelayMs: 600 })).toBe(600);
    });
  });
});
