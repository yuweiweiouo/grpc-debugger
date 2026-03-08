import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger, setLogLevel } from '../src/lib/logger.js';

describe('logger', () => {
  let consoleSpy;

  beforeEach(() => {
    consoleSpy = {
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
    setLogLevel('DEBUG');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createLogger', () => {
    it('應回傳包含四個方法的 logger 物件', () => {
      const logger = createLogger('Test');
      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
    });

    it('應在輸出中包含模組名稱前綴', () => {
      const logger = createLogger('MyModule');
      logger.info('hello');
      expect(consoleSpy.info).toHaveBeenCalledWith('[MyModule]', 'hello');
    });
  });

  describe('setLogLevel', () => {
    it('設為 NONE 時應完全靜默', () => {
      setLogLevel('NONE');
      const logger = createLogger('Silent');
      logger.debug('a');
      logger.info('b');
      logger.warn('c');
      logger.error('d');
      expect(consoleSpy.debug).not.toHaveBeenCalled();
      expect(consoleSpy.info).not.toHaveBeenCalled();
      expect(consoleSpy.warn).not.toHaveBeenCalled();
      expect(consoleSpy.error).not.toHaveBeenCalled();
    });

    it('設為 WARN 時應只輸出 warn 和 error', () => {
      setLogLevel('WARN');
      const logger = createLogger('Filtered');
      logger.debug('a');
      logger.info('b');
      logger.warn('c');
      logger.error('d');
      expect(consoleSpy.debug).not.toHaveBeenCalled();
      expect(consoleSpy.info).not.toHaveBeenCalled();
      expect(consoleSpy.warn).toHaveBeenCalledOnce();
      expect(consoleSpy.error).toHaveBeenCalledOnce();
    });

    it('設為 ERROR 時應只輸出 error', () => {
      setLogLevel('ERROR');
      const logger = createLogger('ErrOnly');
      logger.debug('a');
      logger.info('b');
      logger.warn('c');
      logger.error('d');
      expect(consoleSpy.debug).not.toHaveBeenCalled();
      expect(consoleSpy.info).not.toHaveBeenCalled();
      expect(consoleSpy.warn).not.toHaveBeenCalled();
      expect(consoleSpy.error).toHaveBeenCalledOnce();
    });

    it('設為 DEBUG 時應輸出所有等級', () => {
      setLogLevel('DEBUG');
      const logger = createLogger('All');
      logger.debug('a');
      logger.info('b');
      logger.warn('c');
      logger.error('d');
      expect(consoleSpy.debug).toHaveBeenCalledOnce();
      expect(consoleSpy.info).toHaveBeenCalledOnce();
      expect(consoleSpy.warn).toHaveBeenCalledOnce();
      expect(consoleSpy.error).toHaveBeenCalledOnce();
    });

    it('應忽略無效的等級名稱', () => {
      setLogLevel('DEBUG');
      setLogLevel('INVALID_LEVEL');
      const logger = createLogger('Test');
      logger.debug('still works');
      expect(consoleSpy.debug).toHaveBeenCalledOnce();
    });
  });

  describe('多參數支援', () => {
    it('應正確傳遞多個參數', () => {
      const logger = createLogger('Multi');
      const obj = { key: 'value' };
      logger.info('msg', obj, 42);
      expect(consoleSpy.info).toHaveBeenCalledWith('[Multi]', 'msg', obj, 42);
    });
  });
});
