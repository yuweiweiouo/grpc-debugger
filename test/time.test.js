import { describe, expect, it } from 'vitest';
import { normalizeTimestampMs, resolveTimestampMs } from '../src/lib/time.ts';

describe('normalizeTimestampMs', () => {
  it('保留毫秒時間戳不變', () => {
    expect(normalizeTimestampMs(1712345678901)).toBe(1712345678901);
  });

  it('將秒級時間戳轉成毫秒', () => {
    expect(normalizeTimestampMs(1712345678)).toBe(1712345678000);
  });

  it('對空值回傳 null', () => {
    expect(normalizeTimestampMs(null)).toBeNull();
    expect(normalizeTimestampMs(undefined)).toBeNull();
  });
});

describe('resolveTimestampMs', () => {
  it('優先保留傳入的時間戳', () => {
    expect(resolveTimestampMs(1712345678901, 123)).toBe(1712345678901);
  });

  it('缺少時間戳時退回 fallback', () => {
    expect(resolveTimestampMs(undefined, 1712345678000)).toBe(1712345678000);
  });
});
