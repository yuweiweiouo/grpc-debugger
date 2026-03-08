import { describe, it, expect } from 'vitest';

globalThis.localStorage = globalThis.localStorage || (() => {
  let store = {};
  return {
    getItem: (key) => store[key] ?? null,
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

const { translations } = await import('../src/lib/i18n.js');

describe('i18n', () => {
  const enKeys = Object.keys(translations.en).sort();
  const zhKeys = Object.keys(translations.zh).sort();

  it('en 和 zh 應擁有完全相同的 key 集合', () => {
    expect(enKeys).toEqual(zhKeys);
  });

  it('翻譯值不應為空字串', () => {
    for (const key of enKeys) {
      expect(translations.en[key], `en.${key} 不應為空`).not.toBe('');
      expect(translations.zh[key], `zh.${key} 不應為空`).not.toBe('');
    }
  });

  it('不應包含重複的 key', () => {
    const enKeySet = new Set(Object.keys(translations.en));
    const zhKeySet = new Set(Object.keys(translations.zh));
    expect(enKeySet.size).toBe(Object.keys(translations.en).length);
    expect(zhKeySet.size).toBe(Object.keys(translations.zh).length);
  });

  it('應包含核心必要 key', () => {
    const requiredKeys = ['network', 'services', 'settings', 'request', 'response', 'headers', 'proto'];
    for (const key of requiredKeys) {
      expect(translations.en).toHaveProperty(key);
      expect(translations.zh).toHaveProperty(key);
    }
  });
});
