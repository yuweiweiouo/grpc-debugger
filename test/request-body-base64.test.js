import { describe, expect, it } from 'vitest';
import { arrayBufferToBase64 } from '../src/extension/request-body-base64.ts';

function naiveArrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return Buffer.from(binary, 'binary').toString('base64');
}

describe('request-body-base64', () => {
  it('與既有實作輸出相同', () => {
    const payload = new Uint8Array([0, 1, 2, 3, 4, 5, 250, 251, 252, 253, 254, 255]);

    expect(arrayBufferToBase64(payload.buffer)).toBe(naiveArrayBufferToBase64(payload.buffer));
  });

  it('可處理超過單一 chunk 的 payload', () => {
    const payload = new Uint8Array(0x8000 * 2 + 17);
    for (let i = 0; i < payload.length; i++) {
      payload[i] = i % 251;
    }

    expect(arrayBufferToBase64(payload.buffer)).toBe(naiveArrayBufferToBase64(payload.buffer));
  });
});
