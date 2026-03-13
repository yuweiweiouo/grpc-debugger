import { describe, expect, it } from 'vitest';
import { normalizeActiveTab } from '../src/lib/network-details-tabs.ts';

describe('normalizeActiveTab', () => {
  it('開啟 combined view 時，request/response 會切到 data tab', () => {
    expect(normalizeActiveTab('request', true)).toBe('data');
    expect(normalizeActiveTab('response', true)).toBe('data');
  });

  it('關閉 combined view 時，data tab 會回到 request', () => {
    expect(normalizeActiveTab('data', false)).toBe('request');
  });

  it('其他 tab 保持不變', () => {
    expect(normalizeActiveTab('headers', true)).toBe('headers');
    expect(normalizeActiveTab('proto', false)).toBe('proto');
  });
});
