import { describe, it, expect } from 'vitest';
import { frameRequest, unframeResponse } from '../src/lib/grpc-web-transport.js';

describe('grpc-web-transport', () => {
  describe('frameRequest', () => {
    it('應正確封裝空請求為 5 bytes header', () => {
      const body = new Uint8Array(0);
      const frame = frameRequest(body);
      
      expect(frame.length).toBe(5);
      expect(frame[0]).toBe(0); // Compression flag
      expect(frame[1]).toBe(0); // Length bytes (0)
      expect(frame[2]).toBe(0);
      expect(frame[3]).toBe(0);
      expect(frame[4]).toBe(0);
    });

    it('應正確封裝有內容的請求', () => {
      const body = new Uint8Array([0x0a, 0x05, 0x68, 0x65, 0x6c, 0x6c, 0x6f]); // "hello" protobuf
      const frame = frameRequest(body);
      
      expect(frame.length).toBe(5 + body.length);
      expect(frame[0]).toBe(0); // Not compressed
      expect(frame[4]).toBe(7); // Length = 7
      expect(frame.slice(5)).toEqual(body);
    });

    it('應正確處理大於 256 bytes 的請求', () => {
      const body = new Uint8Array(300).fill(0xff);
      const frame = frameRequest(body);
      
      expect(frame.length).toBe(5 + 300);
      // 300 = 0x012C -> [0, 0, 1, 44]
      expect(frame[3]).toBe(1);
      expect(frame[4]).toBe(44);
    });
  });

  describe('unframeResponse', () => {
    it('應正確解析單一 Data Frame', () => {
      // 建立一個 length=3 的 data frame
      const data = new Uint8Array([
        0x00, // flags: data frame
        0x00, 0x00, 0x00, 0x03, // length: 3
        0xaa, 0xbb, 0xcc // payload
      ]);
      
      const result = unframeResponse(data);
      
      expect(result).not.toBeNull();
      expect(result.length).toBe(1);
      expect(result[0]).toEqual(new Uint8Array([0xaa, 0xbb, 0xcc]));
    });

    it('應忽略 Trailer Frame (flags bit 0 set)', () => {
      const data = new Uint8Array([
        // Data frame
        0x00, 0x00, 0x00, 0x00, 0x02, 0xaa, 0xbb,
        // Trailer frame (flags = 0x80 | 0x01)
        0x81, 0x00, 0x00, 0x00, 0x01, 0xff
      ]);
      
      const result = unframeResponse(data);
      
      expect(result).not.toBeNull();
      expect(result.length).toBe(1);
      expect(result[0]).toEqual(new Uint8Array([0xaa, 0xbb]));
    });

    it('應處理多個 Data Frame', () => {
      const data = new Uint8Array([
        // Frame 1
        0x00, 0x00, 0x00, 0x00, 0x01, 0x11,
        // Frame 2
        0x00, 0x00, 0x00, 0x00, 0x01, 0x22
      ]);
      
      const result = unframeResponse(data);
      
      expect(result).not.toBeNull();
      expect(result.length).toBe(2);
    });

    it('應對空資料回傳 null', () => {
      expect(unframeResponse(new Uint8Array(0))).toBeNull();
      expect(unframeResponse(new Uint8Array(4))).toBeNull();
    });
  });
});
