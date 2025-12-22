/**
 * gRPC-Web 傳輸層 (Transport Layer)
 * 負責處理 gRPC-Web 協定的 HTTP 傳輸、Frame 封裝 (Framing) 與解析 (Unframing)。
 * gRPC-Web 使用一種稱為 "Length-Prefixed Message" 的格式在 HTTP ボディ中傳遞數據。
 */

import { createLogger } from './logger.js';

const logger = createLogger('Transport');

/**
 * 建立 gRPC-Web Length-Prefixed Frame
 * 每個 Frame 的格式為：
 * - 1 byte: 壓縮標誌 (0 表示未壓縮，1 表示壓縮)
 * - 4 bytes: 訊息長度 (網路位元組序 Big-Endian)
 * - N bytes: 原始訊息內容
 * 
 * @param {Uint8Array} body 要封裝的請求內容（通常是 Protobuf 二進位資）
 * @returns {Uint8Array} 封裝後的完整 Frame
 */
export function frameRequest(body) {
  const frame = new Uint8Array(5 + body.length);
  frame[0] = 0; // Compression flag: 0 (not compressed)
  
  // 寫入 4 位元組的長度資訊 (Big-Endian 排列)
  frame[1] = (body.length >> 24) & 0xff;
  frame[2] = (body.length >> 16) & 0xff;
  frame[3] = (body.length >> 8) & 0xff;
  frame[4] = body.length & 0xff;
  
  // 填充實際內容
  frame.set(body, 5);
  return frame;
}

/**
 * 解析 gRPC-Web Response Frames
 * gRPC-Web 的 HTTP 回應可能包含多個 Frame：
 * 1. Data Frames: 包含實際的 Protobuf 回應訊息。
 * 2. Trailer Frame: 包含 gRPC 狀態碼與錯誤訊息（通常是最後一個 Frame，且帶有特殊的 flags）。
 * 
 * @param {Uint8Array} data 來自 fetch 回傳的原始二進位數據 (Uint8Array)
 * @returns {Uint8Array[] | null} 僅包含 Data Frames 的內容陣列。若無有效數據則回傳 null。
 */
export function unframeResponse(data) {
  if (data.length < 5) return null;

  const payloads = [];
  let pos = 0;

  // 循環解析 Buffer 中的所有 Frame
  while (pos + 5 <= data.length) {
    const flags = data[pos];
    
    // 讀取該 Frame 的長度
    const length =
      (data[pos + 1] << 24) |
      (data[pos + 2] << 16) |
      (data[pos + 3] << 8) |
      data[pos + 4];
      
    const start = pos + 5;
    const end = start + length;

    // 防止讀取越界，若數據不完整則停止解析
    if (end > data.length) break;

    /**
     * Flags 欄位說明：
     * - Bit 7 (0x80): 表示數據是否經過壓縮。
     * - Bit 0 (0x01): 表示這是 Trailer Frame (包含 metadata 與狀態碼)。
     * 我們目前只處理未壓縮且非 Trailer 的 Data Frame。
     */
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
 * 使用標準瀏覽器 fetch API 與 gRPC-Web 伺服器交互。
 * 
 * @param {string} url 請求的端點 URL
 * @param {Uint8Array} requestBody 尚未封裝的請求內容
 * @returns {Promise<Uint8Array[] | null>} 解析後的 Data Frames 列表
 */
export async function sendGrpcWebRequest(url, requestBody) {
  // 將內容封裝入 gRPC-Web Frame
  const frame = frameRequest(requestBody);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/grpc-web+proto', // 宣告為 gRPC-Web Protobuf 格式
      'Accept': 'application/grpc-web+proto',
      'X-Grpc-Web': '1',                            // 特定標頭，指示這是一個 gRPC-Web 請求
    },
    body: frame,
  });

  if (!response.ok) {
    throw new Error(`HTTP 傳輸錯誤 ${response.status}: ${response.statusText}`);
  }

  // 讀取回應內容為 ArrayBuffer 並轉為 Uint8Array
  const buffer = await response.arrayBuffer();
  const data = new Uint8Array(buffer);

  // 解析回應中的 Frames 並傳回 Data 內容
  return unframeResponse(data);
}

