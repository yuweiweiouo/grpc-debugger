import { describe, it, expect } from 'vitest';
import {
  readTag,
  readVarint,
  readLengthDelimited,
  skipField,
  parseListServicesResponse,
  parseFileDescriptorResponse,
} from '../src/lib/descriptor-parser.js';

describe('descriptor-parser', () => {
  describe('Low-level parsing', () => {
    describe('readVarint', () => {
      it('應正確解析單 byte varint', () => {
        const data = new Uint8Array([0x05]);
        const [value, pos] = readVarint(data, 0);
        expect(value).toBe(5);
        expect(pos).toBe(1);
      });

      it('應正確解析多 byte varint', () => {
        const data = new Uint8Array([0xac, 0x02]);
        const [value, pos] = readVarint(data, 0);
        expect(value).toBe(300);
        expect(pos).toBe(2);
      });

      it('應正確解析 offset 位置的 varint', () => {
        const data = new Uint8Array([0xff, 0xff, 0x0a]);
        const [value, pos] = readVarint(data, 2);
        expect(value).toBe(10);
        expect(pos).toBe(3);
      });

      it('應正確解析 varint 0', () => {
        const data = new Uint8Array([0x00]);
        const [value, pos] = readVarint(data, 0);
        expect(value).toBe(0);
        expect(pos).toBe(1);
      });

      it('應正確解析 varint 127 (最大單位元組值)', () => {
        const data = new Uint8Array([0x7f]);
        const [value, pos] = readVarint(data, 0);
        expect(value).toBe(127);
        expect(pos).toBe(1);
      });

      it('應正確解析 varint 128 (最小雙位元組值)', () => {
        const data = new Uint8Array([0x80, 0x01]);
        const [value, pos] = readVarint(data, 0);
        expect(value).toBe(128);
        expect(pos).toBe(2);
      });
    });

    describe('readTag', () => {
      it('應正確解析 field number 和 wire type', () => {
        const [fieldNum, wireType, pos] = readTag(new Uint8Array([0x08]), 0);
        expect(fieldNum).toBe(1);
        expect(wireType).toBe(0);
      });

      it('應正確解析 length-delimited 類型', () => {
        const [fieldNum, wireType, pos] = readTag(new Uint8Array([0x0a]), 0);
        expect(fieldNum).toBe(1);
        expect(wireType).toBe(2);
      });

      it('應正確解析較大的 field number', () => {
        const [fieldNum, wireType, pos] = readTag(new Uint8Array([0x50]), 0);
        expect(fieldNum).toBe(10);
        expect(wireType).toBe(0);
      });

      it('應正確解析 wire type 5 (32-bit)', () => {
        // field 1, wire type 5 = 0x0d
        const [fieldNum, wireType] = readTag(new Uint8Array([0x0d]), 0);
        expect(fieldNum).toBe(1);
        expect(wireType).toBe(5);
      });
    });

    describe('readLengthDelimited', () => {
      it('應正確讀取 length-prefixed 資料', () => {
        const data = new Uint8Array([0x03, 0xaa, 0xbb, 0xcc, 0xdd]);
        const [bytes, pos] = readLengthDelimited(data, 0);
        
        expect(bytes).toEqual(new Uint8Array([0xaa, 0xbb, 0xcc]));
        expect(pos).toBe(4);
      });

      it('應正確處理長度為 0 的情況', () => {
        const data = new Uint8Array([0x00, 0xaa]);
        const [bytes, pos] = readLengthDelimited(data, 0);
        expect(bytes.length).toBe(0);
        expect(pos).toBe(1);
      });
    });

    describe('skipField', () => {
      it('應正確跳過 varint 欄位', () => {
        const data = new Uint8Array([0xac, 0x02, 0xff]);
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

      it('應對未知 wire type 原地返回', () => {
        const newPos = skipField(new Uint8Array(10), 3, 3);
        expect(newPos).toBe(3);
      });
    });
  });

  describe('Reflection response parsing', () => {
    describe('parseListServicesResponse', () => {
      it('應對空資料回傳空陣列', () => {
        expect(parseListServicesResponse(new Uint8Array([]))).toEqual([]);
      });
    });

    describe('parseFileDescriptorResponse', () => {
      it('應對空資料回傳 null', () => {
        expect(parseFileDescriptorResponse(new Uint8Array([]))).toBeNull();
      });
    });
  });
});
