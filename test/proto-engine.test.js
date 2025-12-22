import { describe, it, expect, beforeEach } from 'vitest';
import { ProtoEngine } from '../src/lib/proto-engine.js';

describe('proto-engine', () => {
  let engine;

  beforeEach(() => {
    engine = new ProtoEngine();
  });

  describe('registerSchema', () => {
    it('應正確註冊 message 定義', () => {
      engine.registerSchema({
        messages: {
          'test.HelloRequest': {
            name: 'HelloRequest',
            fullName: 'test.HelloRequest',
            fields: [
              { name: 'name', number: 1, type: 9 } // string
            ]
          }
        }
      });

      expect(engine.schemas.size).toBe(1);
      expect(engine.schemas.has('test.HelloRequest')).toBe(true);
    });

    it('應正確註冊 service 定義', () => {
      engine.registerSchema({
        services: [{
          fullName: 'test.Greeter',
          methods: [
            { name: 'SayHello', requestType: '.test.HelloRequest', responseType: '.test.HelloResponse' }
          ]
        }]
      });

      expect(engine.serviceMap.size).toBe(1);
      expect(engine.serviceMap.has('/test.Greeter/SayHello')).toBe(true);
    });
  });

  describe('findMessage', () => {
    beforeEach(() => {
      engine.registerSchema({
        messages: {
          'common.Product': { name: 'Product', fullName: 'common.Product', fields: [] },
          'api.v1.User': { name: 'User', fullName: 'api.v1.User', fields: [] },
        }
      });
    });

    it('應透過完全匹配找到 message', () => {
      const msg = engine.findMessage('common.Product');
      expect(msg).not.toBeNull();
      expect(msg.fullName).toBe('common.Product');
    });

    it('應透過 suffix 匹配找到 message', () => {
      const msg = engine.findMessage('Product');
      expect(msg).not.toBeNull();
      expect(msg.fullName).toBe('common.Product');
    });

    it('找不到時應回傳 null', () => {
      const msg = engine.findMessage('NonExistent');
      expect(msg).toBeNull();
    });
  });

  describe('decodeMessage', () => {
    beforeEach(() => {
      engine.registerSchema({
        messages: {
          'test.Simple': {
            name: 'Simple',
            fullName: 'test.Simple',
            fields: [
              { name: 'id', number: 1, type: 5 }, // int32
              { name: 'name', number: 2, type: 9 }, // string
            ]
          }
        }
      });
    });

    it('應正確解碼簡單訊息', () => {
      // Protobuf: { id: 42, name: "test" }
      // Field 1 (varint): 0x08 0x2a = id=42
      // Field 2 (string): 0x12 0x04 "test" = name="test"
      const buffer = new Uint8Array([
        0x08, 0x2a, // field 1, varint 42
        0x12, 0x04, 0x74, 0x65, 0x73, 0x74 // field 2, string "test"
      ]);

      const result = engine.decodeMessage('test.Simple', buffer);

      expect(result.id).toBe(42n); // BigInt from varint
      expect(result.name).toBe('test');
    });

    it('應在無 schema 時執行盲測解碼', () => {
      const buffer = new Uint8Array([
        0x08, 0x0a, // field 1, varint 10
      ]);

      const result = engine.decodeMessage('unknown.Type', buffer);

      // 盲測解碼用 field_N 作為欄位名
      expect(result.field_1).toBeDefined();
    });

    it('應正確處理空 buffer', () => {
      const result = engine.decodeMessage('test.Simple', new Uint8Array(0));
      expect(result).toEqual({});
    });
  });

  describe('isPackableType', () => {
    it('應識別可壓縮的純量類型', () => {
      expect(engine.isPackableType(1)).toBe(true);  // DOUBLE
      expect(engine.isPackableType(5)).toBe(true);  // INT32
      expect(engine.isPackableType(8)).toBe(true);  // BOOL
      expect(engine.isPackableType(14)).toBe(true); // ENUM
    });

    it('應拒絕不可壓縮的類型', () => {
      expect(engine.isPackableType(9)).toBe(false);  // STRING
      expect(engine.isPackableType(11)).toBe(false); // MESSAGE
      expect(engine.isPackableType(12)).toBe(false); // BYTES
    });
  });
});
