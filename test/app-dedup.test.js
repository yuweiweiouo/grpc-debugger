import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('App.svelte deduplication logic', () => {
  const DEDUP_WINDOW_MS = 2000;
  let recentlyProcessedCalls;
  let buildDedupKey;
  let isRecentlyProcessed;

  beforeEach(() => {
    recentlyProcessedCalls = new Map();
    
    buildDedupKey = (method, startTime) => {
      const normalizedMethod = method?.replace(/^\/+/, '') || '';
      const ts = typeof startTime === 'number' ? Math.floor(startTime / 100) : 0;
      return `${normalizedMethod}|${ts}`;
    };

    isRecentlyProcessed = (method, startTime) => {
      const key = buildDedupKey(method, startTime);
      const now = Date.now();
      for (const [k, ts] of recentlyProcessedCalls.entries()) {
        if (now - ts > DEDUP_WINDOW_MS) recentlyProcessedCalls.delete(k);
      }
      if (recentlyProcessedCalls.has(key)) return true;
      recentlyProcessedCalls.set(key, now);
      return false;
    };
  });

  describe('buildDedupKey', () => {
    it('應正規化帶前導斜線的 method', () => {
      expect(buildDedupKey('/pkg.Service/Method', 1000)).toBe('pkg.Service/Method|10');
      expect(buildDedupKey('//pkg.Service/Method', 1000)).toBe('pkg.Service/Method|10');
    });

    it('應將 timestamp 取整到 100ms', () => {
      expect(buildDedupKey('Method', 1000)).toBe('Method|10');
      expect(buildDedupKey('Method', 1099)).toBe('Method|10');
      expect(buildDedupKey('Method', 1100)).toBe('Method|11');
    });

    it('應處理空值', () => {
      expect(buildDedupKey(null, 1000)).toBe('|10');
      expect(buildDedupKey('', 1000)).toBe('|10');
      expect(buildDedupKey('Method', null)).toBe('Method|0');
    });
  });

  describe('isRecentlyProcessed', () => {
    it('首次呼叫應回傳 false 並加入追蹤', () => {
      const result = isRecentlyProcessed('/pkg.Service/Method', 1000);
      expect(result).toBe(false);
      expect(recentlyProcessedCalls.size).toBe(1);
    });

    it('相同 method + timestamp 應回傳 true（重複）', () => {
      isRecentlyProcessed('/pkg.Service/Method', 1000);
      const result = isRecentlyProcessed('/pkg.Service/Method', 1000);
      expect(result).toBe(true);
    });

    it('相同 method + 相近 timestamp（100ms 內）應視為重複', () => {
      isRecentlyProcessed('/pkg.Service/Method', 1000);
      const result = isRecentlyProcessed('/pkg.Service/Method', 1050);
      expect(result).toBe(true);
    });

    it('不同 method 不應視為重複', () => {
      isRecentlyProcessed('/pkg.Service/MethodA', 1000);
      const result = isRecentlyProcessed('/pkg.Service/MethodB', 1000);
      expect(result).toBe(false);
    });

    it('timestamp 差距超過 100ms 不應視為重複', () => {
      isRecentlyProcessed('/pkg.Service/Method', 1000);
      const result = isRecentlyProcessed('/pkg.Service/Method', 1200);
      expect(result).toBe(false);
    });

    it('超過 DEDUP_WINDOW_MS 的紀錄應被清除', async () => {
      isRecentlyProcessed('/pkg.Service/Method', 1000);
      expect(recentlyProcessedCalls.size).toBe(1);

      await new Promise(resolve => setTimeout(resolve, DEDUP_WINDOW_MS + 100));

      isRecentlyProcessed('/pkg.Service/Other', 2000);
      expect(recentlyProcessedCalls.size).toBe(1);
    });
  });

  describe('模擬 addLog 去重場景', () => {
    it('pollInterceptorCalls 先處理，runtimeMessageListener 應跳過', () => {
      const addLogCalls = [];
      const mockAddLog = (data) => addLogCalls.push(data);

      const dispatchGrpcEvent = (data) => {
        if (isRecentlyProcessed(data.method, data.startTime)) return;
        mockAddLog(data);
      };

      const runtimeMessageListener = (message) => {
        if (message.type === '__GRPCWEB_DEVTOOLS__' && message.action === 'gRPCNetworkCall') {
          const startTime = message.timestamp;
          if (isRecentlyProcessed(message.method, startTime)) return;
          mockAddLog({ method: message.method, startTime, _source: 'runtime' });
        }
      };

      const data = {
        method: '/pkg.Service/Method',
        startTime: 1000,
        _source: 'poll'
      };

      dispatchGrpcEvent(data);
      runtimeMessageListener({
        type: '__GRPCWEB_DEVTOOLS__',
        action: 'gRPCNetworkCall',
        method: '/pkg.Service/Method',
        timestamp: 1000
      });

      expect(addLogCalls.length).toBe(1);
      expect(addLogCalls[0]._source).toBe('poll');
    });

    it('runtimeMessageListener 先處理，pollInterceptorCalls 應跳過', () => {
      const addLogCalls = [];
      const mockAddLog = (data) => addLogCalls.push(data);

      const dispatchGrpcEvent = (data) => {
        if (isRecentlyProcessed(data.method, data.startTime)) return;
        mockAddLog(data);
      };

      const runtimeMessageListener = (message) => {
        if (message.type === '__GRPCWEB_DEVTOOLS__' && message.action === 'gRPCNetworkCall') {
          const startTime = message.timestamp;
          if (isRecentlyProcessed(message.method, startTime)) return;
          mockAddLog({ method: message.method, startTime, _source: 'runtime' });
        }
      };

      runtimeMessageListener({
        type: '__GRPCWEB_DEVTOOLS__',
        action: 'gRPCNetworkCall',
        method: '/pkg.Service/Method',
        timestamp: 1000
      });

      dispatchGrpcEvent({
        method: '/pkg.Service/Method',
        startTime: 1000,
        _source: 'poll'
      });

      expect(addLogCalls.length).toBe(1);
      expect(addLogCalls[0]._source).toBe('runtime');
    });
  });
});
