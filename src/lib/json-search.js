/**
 * 建立 JSON 搜尋結果與需展開的祖先節點索引。
 *
 * JsonTree 以路徑顯示巢狀資料；預先索引可避免每個節點重複遞迴掃描子樹。
 */
export function createSearchIndex(data, query) {
  const matches = [];
  const matchingAncestorPaths = new Set();

  if (!query || !isSearchableObject(data)) {
    return { matches, matchingAncestorPaths };
  }

  const normalizedQuery = query.toLowerCase();
  collectMatches(data, normalizedQuery, '', matches, matchingAncestorPaths, new WeakSet());

  return { matches, matchingAncestorPaths };
}

function collectMatches(value, query, prefix, matches, matchingAncestorPaths, ancestors) {
  if (!isSearchableObject(value) || ancestors.has(value)) return;

  ancestors.add(value);
  for (const key of Object.keys(value)) {
    if (key === '$typeName') continue;

    const path = prefix ? `${prefix}.${key}` : key;
    if (key.toLowerCase().includes(query)) {
      addMatch(path, 'key', matches, matchingAncestorPaths);
    }

    const child = value[key];
    if (isSearchableObject(child)) {
      collectMatches(child, query, path, matches, matchingAncestorPaths, ancestors);
      continue;
    }

    if (child !== null && child !== undefined && matchesValue(child, query)) {
      addMatch(path, 'value', matches, matchingAncestorPaths);
    }
  }
  ancestors.delete(value);
}

function isSearchableObject(value) {
  return value !== null && typeof value === 'object' && !(value instanceof Uint8Array);
}

function matchesValue(value, query) {
  const displayValue = typeof value === 'string' ? `"${value}"` : String(value);
  return displayValue.toLowerCase().includes(query);
}

function addMatch(path, type, matches, matchingAncestorPaths) {
  matches.push(`${path}:${type}`);

  const segments = path.split('.');
  segments.pop();
  while (segments.length > 0) {
    matchingAncestorPaths.add(segments.join('.'));
    segments.pop();
  }
}
