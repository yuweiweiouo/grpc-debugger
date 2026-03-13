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

  it('邊界：開啟 combined view 時，data tab 保持不變', () => {
    expect(normalizeActiveTab('data', true)).toBe('data');
  });

  it('邊界：關閉 combined view 時，request/response 保持不變', () => {
    expect(normalizeActiveTab('request', false)).toBe('request');
    expect(normalizeActiveTab('response', false)).toBe('response');
  });

  it('邊界：空字串或 null 輸入應原樣返回', () => {
    expect(normalizeActiveTab('', true)).toBe('');
    expect(normalizeActiveTab('', false)).toBe('');
    expect(normalizeActiveTab(null, true)).toBe(null);
    expect(normalizeActiveTab(null, false)).toBe(null);
  });

  it('邊界：未知的 tab 名稱保持不變', () => {
    expect(normalizeActiveTab('unknown', true)).toBe('unknown');
    expect(normalizeActiveTab('unknown', false)).toBe('unknown');
  });
});
