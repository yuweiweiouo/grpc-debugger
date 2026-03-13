export function computeRequestHash(path, headersStr, bodyBuffer) {
  let hash = 2166136261;

  for (let i = 0; i < path.length; i++) {
    hash ^= path.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }

  for (let i = 0; i < headersStr.length; i++) {
    hash ^= headersStr.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }

  if (bodyBuffer) {
    const bytes = bodyBuffer instanceof Uint8Array ? bodyBuffer : new Uint8Array(bodyBuffer);
    for (let i = 0; i < bytes.length; i++) {
      hash ^= bytes[i];
      hash = Math.imul(hash, 16777619) >>> 0;
    }
  }

  return hash.toString(16).padStart(8, '0');
}
