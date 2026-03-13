const BASE64_CHUNK_SIZE = 0x8000;
const globalWithBuffer = /** @type {typeof globalThis & { Buffer?: { from(input: string, encoding: string): { toString(encoding: string): string } } }} */ (globalThis);

function encodeBinaryStringToBase64(binary) {
  if (typeof btoa === 'function') {
    return btoa(binary);
  }

  if (globalWithBuffer.Buffer) {
    return globalWithBuffer.Buffer.from(binary, 'binary').toString('base64');
  }

  throw new Error('No Base64 encoder available');
}

export function arrayBufferToBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

  if (bytes.byteLength === 0) {
    return '';
  }

  const chunkCount = Math.ceil(bytes.byteLength / BASE64_CHUNK_SIZE);
  const binaryChunks = new Array(chunkCount);

  for (let i = 0; i < chunkCount; i++) {
    const start = i * BASE64_CHUNK_SIZE;
    const end = Math.min(start + BASE64_CHUNK_SIZE, bytes.byteLength);
    const chunk = bytes.subarray(start, end);
    binaryChunks[i] = String.fromCharCode.apply(null, chunk);
  }

  return encodeBinaryStringToBase64(binaryChunks.join(''));
}
