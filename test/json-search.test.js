import { describe, expect, it } from 'vitest';
import { createSearchIndex } from '../src/lib/json-search.js';

describe('json search index', () => {
  it('保留既有匹配路徑並標記需展開的祖先節點', () => {
    const index = createSearchIndex({
      response: {
        items: [{ name: 'needle' }],
      },
    }, 'needle');

    expect(index.matches).toEqual(['response.items.0.name:value']);
    expect(index.matchingAncestorPaths).toEqual(
      new Set(['response', 'response.items', 'response.items.0']),
    );
  });

  it('維持欄位名稱搜尋與 $typeName 忽略規則', () => {
    const index = createSearchIndex({
      $typeName: 'needle.Type',
      metadata: { requestId: 'abc' },
    }, 'request');

    expect(index.matches).toEqual(['metadata.requestId:key']);
    expect(index.matchingAncestorPaths).toEqual(new Set(['metadata']));
  });

  it('遇到循環參照仍能安全完成搜尋', () => {
    const data = { value: 'needle' };
    data.self = data;

    expect(createSearchIndex(data, 'needle').matches).toEqual(['value:value']);
  });
});
