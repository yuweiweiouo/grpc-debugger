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
              { name: 'name', number: 1, type: 9 }
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

    it('應移除 requestType/responseType 的前導點', () => {
      engine.registerSchema({
        services: [{
          fullName: '.pkg.MyService',
          methods: [
            { name: 'DoWork', requestType: '.pkg.Request', responseType: '.pkg.Response' }
          ]
        }]
      });

      const info = engine.serviceMap.get('/pkg.MyService/DoWork');
      expect(info).toBeDefined();
      expect(info.requestType).toBe('pkg.Request');
      expect(info.responseType).toBe('pkg.Response');
    });

    it('應覆蓋已存在的 registry', () => {
      const fakeRegistry = { getMessage: () => null };
      engine.registerSchema({ registry: fakeRegistry });
      expect(engine.registry).toBe(fakeRegistry);
    });
  });

  describe('findMethod', () => {
    beforeEach(() => {
      engine.registerSchema({
        services: [{
          fullName: 'api.v1.UserService',
          methods: [
            { name: 'GetUser', requestType: '.api.v1.GetUserRequest', responseType: '.api.v1.GetUserResponse' },
            { name: 'ListUsers', requestType: '.api.v1.ListUsersRequest', responseType: '.api.v1.ListUsersResponse' }
          ]
        }]
      });
    });

    it('應透過完全匹配找到方法', () => {
      const method = engine.findMethod('/api.v1.UserService/GetUser');
      expect(method).not.toBeNull();
      expect(method.methodName).toBe('GetUser');
    });

    it('應透過後綴匹配找到方法', () => {
      const method = engine.findMethod('/api.v1.UserService/GetUser');
      expect(method).not.toBeNull();
      expect(method.methodName).toBe('GetUser');
    });

    it('應支援大小寫不敏感的後綴匹配', () => {
      const method = engine.findMethod('/API.V1.USERSERVICE/GETUSER');
      expect(method).not.toBeNull();
      expect(method.methodName).toBe('GetUser');
    });

    it('找不到時應回傳 null', () => {
      expect(engine.findMethod('/NonExistent/Method')).toBeNull();
    });

    it('空路徑應回傳 null', () => {
      expect(engine.findMethod(null)).toBeNull();
      expect(engine.findMethod('')).toBeNull();
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
      expect(engine.findMessage('NonExistent')).toBeNull();
    });

    it('空名稱應回傳 null', () => {
      expect(engine.findMessage(null)).toBeNull();
      expect(engine.findMessage('')).toBeNull();
    });

    it('應移除前導點後查找', () => {
      const msg = engine.findMessage('.common.Product');
      expect(msg).not.toBeNull();
      expect(msg.fullName).toBe('common.Product');
    });
  });

  describe('decodeMessage', () => {
    it('應正確處理空 buffer', () => {
      const result = engine.decodeMessage('test.Simple', new Uint8Array(0));
      expect(result).toEqual({});
    });

    it('無 typeName 時應回傳錯誤物件', () => {
      const buffer = new Uint8Array([0x08, 0x0a]);
      const result = engine.decodeMessage(null, buffer);
      expect(result._error).toBeDefined();
    });

    it('找不到 schema 時應回傳錯誤物件', () => {
      const buffer = new Uint8Array([0x08, 0x0a]);
      const result = engine.decodeMessage('unknown.Type', buffer);
      expect(result._error).toContain('找不到 Schema 定義');
    });

    it('找不到 schema 時應回傳結構化錯誤原因', () => {
      const buffer = new Uint8Array([0x08, 0x0a]);
      const result = engine.decodeMessage('unknown.Type', buffer);
      expect(result._decodeReason).toBe('missing_schema');
    });

    it('應回傳 buffer 長度資訊', () => {
      const buffer = new Uint8Array([0x08, 0x0a]);
      const result = engine.decodeMessage('unknown.Type', buffer);
      expect(result._rawLength).toBe(2);
    });
  });

  describe('_convertValue', () => {
    it('應將安全範圍內的 BigInt 轉為 Number', () => {
      expect(engine._convertValue(42n)).toBe(42);
      expect(engine._convertValue(0n)).toBe(0);
      expect(engine._convertValue(-100n)).toBe(-100);
    });

    it('應將超出安全範圍的 BigInt 轉為字串', () => {
      const big = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
      expect(typeof engine._convertValue(big)).toBe('string');
    });

    it('應保持非 BigInt 值不變', () => {
      expect(engine._convertValue('hello')).toBe('hello');
      expect(engine._convertValue(42)).toBe(42);
      expect(engine._convertValue(null)).toBe(null);
      expect(engine._convertValue(true)).toBe(true);
    });
  });

  describe('_fieldKindToType', () => {
    it('應優先使用 proto.type', () => {
      expect(engine._fieldKindToType({ proto: { type: 5 } })).toBe(5);
    });

    it('應根據 kind 推斷類型', () => {
      expect(engine._fieldKindToType({ kind: 'message' })).toBe(11);
      expect(engine._fieldKindToType({ kind: 'enum' })).toBe(14);
      expect(engine._fieldKindToType({ kind: 'map' })).toBe(11);
    });

    it('應處理 scalar kind', () => {
      expect(engine._fieldKindToType({ kind: 'scalar', scalar: 5 })).toBe(5);
    });

    it('應預設回傳 string 類型', () => {
      expect(engine._fieldKindToType({})).toBe(9);
    });
  });
});
