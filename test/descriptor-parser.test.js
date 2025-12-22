import { describe, it, expect } from 'vitest';
import {
  readTag,
  readVarint,
  readLengthDelimited,
  skipField,
  bytesToDescriptor,
  parseFieldDescriptor,
} from '../src/lib/descriptor-parser.js';

describe('descriptor-parser', () => {
  describe('Low-level parsing', () => {
    describe('readVarint', () => {
      it('應正確解析單 byte varint', () => {
        const data = new Uint8Array([0x05]); // 5
        const [value, pos] = readVarint(data, 0);
        expect(value).toBe(5);
        expect(pos).toBe(1);
      });

      it('應正確解析多 byte varint', () => {
        const data = new Uint8Array([0xac, 0x02]); // 300
        const [value, pos] = readVarint(data, 0);
        expect(value).toBe(300);
        expect(pos).toBe(2);
      });

      it('應正確解析 offset 位置的 varint', () => {
        const data = new Uint8Array([0xff, 0xff, 0x0a]); // skip 2, then 10
        const [value, pos] = readVarint(data, 2);
        expect(value).toBe(10);
        expect(pos).toBe(3);
      });
    });

    describe('readTag', () => {
      it('應正確解析 field number 和 wire type', () => {
        // Tag 0x08 = field 1, wire type 0 (varint)
        const [fieldNum, wireType, pos] = readTag(new Uint8Array([0x08]), 0);
        expect(fieldNum).toBe(1);
        expect(wireType).toBe(0);
      });

      it('應正確解析 length-delimited 類型', () => {
        // Tag 0x0a = field 1, wire type 2 (length-delimited)
        const [fieldNum, wireType, pos] = readTag(new Uint8Array([0x0a]), 0);
        expect(fieldNum).toBe(1);
        expect(wireType).toBe(2);
      });

      it('應正確解析較大的 field number', () => {
        // Tag 0x50 = field 10, wire type 0
        const [fieldNum, wireType, pos] = readTag(new Uint8Array([0x50]), 0);
        expect(fieldNum).toBe(10);
        expect(wireType).toBe(0);
      });
    });

    describe('readLengthDelimited', () => {
      it('應正確讀取 length-prefixed 資料', () => {
        const data = new Uint8Array([0x03, 0xaa, 0xbb, 0xcc, 0xdd]);
        const [bytes, pos] = readLengthDelimited(data, 0);
        
        expect(bytes).toEqual(new Uint8Array([0xaa, 0xbb, 0xcc]));
        expect(pos).toBe(4);
      });
    });

    describe('skipField', () => {
      it('應正確跳過 varint 欄位', () => {
        const data = new Uint8Array([0xac, 0x02, 0xff]); // varint 300, then junk
        const newPos = skipField(data, 0, 0);
        expect(newPos).toBe(2);
      });

      it('應正確跳過 length-delimited 欄位', () => {
        const data = new Uint8Array([0x03, 0xaa, 0xbb, 0xcc, 0xdd]);
        const newPos = skipField(data, 0, 2);
        expect(newPos).toBe(4);
      });

      it('應正確跳過 32-bit 欄位', () => {
        const newPos = skipField(new Uint8Array(10), 0, 5);
        expect(newPos).toBe(4);
      });

      it('應正確跳過 64-bit 欄位', () => {
        const newPos = skipField(new Uint8Array(10), 0, 1);
        expect(newPos).toBe(8);
      });
    });
  });

  describe('FileDescriptorProto parsing', () => {
    describe('parseFieldDescriptor', () => {
      it('應正確解析欄位定義', () => {
        // 模擬一個簡單的 FieldDescriptorProto
        // field 1 (name) = "test_field"
        // field 3 (number) = 5
        // field 5 (type) = 9 (string)
        const fieldBytes = new Uint8Array([
          0x0a, 0x0a, // field 1, length 10
          0x74, 0x65, 0x73, 0x74, 0x5f, 0x66, 0x69, 0x65, 0x6c, 0x64, // "test_field"
          0x18, 0x05, // field 3, varint 5
          0x28, 0x09, // field 5, varint 9
        ]);
        
        const field = parseFieldDescriptor(fieldBytes);
        
        expect(field.name).toBe('test_field');
        expect(field.number).toBe(5);
        expect(field.type).toBe(9);
      });
    });

    describe('bytesToDescriptor', () => {
      it('應正確解析空的 FileDescriptor', () => {
        const bytes = new Uint8Array([]);
        const desc = bytesToDescriptor(bytes);
        
        expect(desc.name).toBe('');
        expect(desc.package).toBe('');
        expect(desc.dependency).toEqual([]);
        expect(desc.messageType).toEqual([]);
        expect(desc.service).toEqual([]);
      });

      it('應正確解析帶有 package 的 FileDescriptor', () => {
        // field 2 (package) = "test.pkg"
        const bytes = new Uint8Array([
          0x12, 0x08, // field 2, length 8
          0x74, 0x65, 0x73, 0x74, 0x2e, 0x70, 0x6b, 0x67 // "test.pkg"
        ]);
        
        const desc = bytesToDescriptor(bytes);
        expect(desc.package).toBe('test.pkg');
      });
    });
  });
});
