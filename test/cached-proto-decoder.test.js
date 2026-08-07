import { describe, expect, it } from 'vitest';
import { decodeCachedProtoMessage } from '../src/lib/cached-proto-decoder.js';

describe('cached proto decoder', () => {
  it('以保存的 runtime schema 解碼字串與數值欄位', () => {
    const schema = {
      messages: {
        'example.User': {
          typeName: 'example.User',
          fields: [
            { number: 1, name: 'name', kind: 'scalar', type: 'string' },
            { number: 2, name: 'age', kind: 'scalar', type: 'int32' },
          ],
        },
      },
    };

    expect(decodeCachedProtoMessage(
      schema,
      'example.User',
      new Uint8Array([0x0a, 0x03, 0x41, 0x64, 0x61, 0x10, 0x1e]),
    )).toEqual({ $typeName: 'example.User', name: 'Ada', age: 30 });
  });
});
