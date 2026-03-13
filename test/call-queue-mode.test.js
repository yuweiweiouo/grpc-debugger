import { describe, expect, it } from 'vitest';
import {
  PAGE_MANAGED_CALL_QUEUE_FLAG,
  shouldInstallFallbackCallListener,
} from '../src/extension/call-queue-mode.ts';

describe('call queue mode', () => {
  it('頁面已自行管理 call queue 時，不應再安裝 fallback listener', () => {
    expect(
      shouldInstallFallbackCallListener({
        [PAGE_MANAGED_CALL_QUEUE_FLAG]: true,
      })
    ).toBe(false);
  });

  it('沒有頁面 queue 管理旗標時，才安裝 fallback listener', () => {
    expect(shouldInstallFallbackCallListener({})).toBe(true);
    expect(shouldInstallFallbackCallListener(null)).toBe(true);
  });
});
