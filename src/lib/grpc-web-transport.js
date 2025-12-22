/**
 * gRPC-Web Transport Layer
 * 負責 gRPC-Web 的 HTTP 傳輸、Frame 封裝與解析
 */

import { createLogger } from './logger.js';

const logger = createLogger('Transport');

/**
 * 建立 gRPC-Web Length-Prefixed Frame
 * @param {Uint8Array} body - 要封裝的請求內容
 * @returns {Uint8Array} 封裝後的 Frame
 */
export function frameRequest(body) {
  const frame = new Uint8Array(5 + body.length);
  frame[0] = 0; // Compression flag: not compressed
  frame[1] = (body.length >> 24) & 0xff;
  frame[2] = (body.length >> 16) & 0xff;
  frame[3] = (body.length >> 8) & 0xff;
  frame[4] = body.length & 0xff;
  frame.set(body, 5);
  return frame;
}

/**
 * 解析 gRPC-Web Response Frames
 * gRPC-Web 可能在單一 Response 中回傳多個 Frame
 * @param {Uint8Array} data - 原始 Response Buffer
 * @returns {Uint8Array[] | null} 資料 Frame 陣列，若無有效資料則回傳 null
 */
export function unframeResponse(data) {
  if (data.length < 5) return null;

  const payloads = [];
  let pos = 0;

  while (pos + 5 <= data.length) {
    const flags = data[pos];
    const length =
      (data[pos + 1] << 24) |
      (data[pos + 2] << 16) |
      (data[pos + 3] << 8) |
      data[pos + 4];
    const start = pos + 5;
    const end = start + length;

    if (end > data.length) break;

    // Bit 7: Compressed, Bit 0: Trailers
    // 只處理資料 Frame（非 Trailer 且非壓縮）
    const isDataFrame = (flags & 0x80) === 0 && (flags & 0x01) === 0;
    if (isDataFrame) {
      payloads.push(data.slice(start, end));
    }

    pos = end;
  }

  return payloads.length > 0 ? payloads : null;
}

/**
 * 發送 gRPC-Web 請求
 * @param {string} url - 請求 URL
 * @param {Uint8Array} requestBody - 請求內容（未封裝）
 * @returns {Promise<Uint8Array[] | null>} 回應的資料 Frame 陣列
 */
export async function sendGrpcWebRequest(url, requestBody) {
  const frame = frameRequest(requestBody);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/grpc-web+proto',
      Accept: 'application/grpc-web+proto',
      'X-Grpc-Web': '1',
    },
    body: frame,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  const data = new Uint8Array(buffer);

  return unframeResponse(data);
}
