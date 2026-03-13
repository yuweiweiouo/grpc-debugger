import { describe, expect, it } from 'vitest';
import { computeRequestHash } from '../src/extension/request-hash.ts';

describe('request-hash', () => {
  it('使用 32-bit 整數乘法避免 FNV-1a 精度漂移', () => {
    const path = '/izge7fm:s7-/cm|z7ugo';
    const headers = 'wkqk8w567|tv4rq3mcu8fhexkjrk5mi4hj/4pk2a';
    const body = Uint8Array.from({ length: 128 }, (_, i) => (i * 137 + 37) % 256);

    expect(computeRequestHash(path, headers, body)).toBe('2f4d3630');
    expect(computeRequestHash(path, headers, body)).not.toBe('f2dc6a14');
  });

  it('相同輸入應產生相同 hash', () => {
    const path = '/pkg.Service/Call';
    const headers = 'content-type:application/grpc-web+proto';
    const body = new Uint8Array([1, 2, 3, 4, 5]);

    expect(computeRequestHash(path, headers, body)).toBe(
      computeRequestHash(path, headers, body)
    );
  });
});
