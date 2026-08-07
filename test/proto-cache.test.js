import { describe, expect, it } from 'vitest';
import { createProtoServiceCacheEntry, findCachedProtoMetadata } from '../src/extension/proto-cache.ts';

describe('proto cache', () => {
  it('保存一個服務的所有方法與 schema', () => {
    const entry = createProtoServiceCacheEntry({
      service: {
        typeName: 'example.UserService',
        methods: [
          { name: 'GetUser', inputType: 'example.GetUserRequest', outputType: 'example.User' },
          { name: 'ListUsers', inputType: 'example.ListUsersRequest', outputType: 'example.ListUsersResponse' },
        ],
      },
      schema: { messages: { 'example.User': { fields: [] } } },
    });

    expect(entry?.methods).toHaveProperty('/example.UserService/GetUser');
    expect(entry?.methods).toHaveProperty('/example.UserService/ListUsers');
  });

  it('可透過 endpoint 重用已保存的 Proto 資訊', () => {
    const entry = createProtoServiceCacheEntry({
      service: {
        typeName: 'example.UserService',
        methods: [{ name: 'GetUser', inputType: 'example.GetUserRequest', outputType: 'example.User' }],
      },
      schema: { messages: { 'example.User': { fields: [] } } },
    });

    expect(findCachedProtoMetadata(
      { 'example.UserService': entry },
      '/api/v1/example.UserService/GetUser',
    )).toMatchObject({
      requestType: 'example.GetUserRequest',
      responseType: 'example.User',
      schema: { messages: { 'example.User': { fields: [] } } },
    });
  });
});
