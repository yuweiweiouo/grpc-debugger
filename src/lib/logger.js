/**
 * Logger - 統一日誌管理模組
 * 可依環境開關，避免在正式發布時污染使用者 console
 */

// 定義日誌等級
const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  NONE: 4
};

// 預設等級：開發環境顯示所有，非開發環境只顯示警告以上
const DEFAULT_LEVEL = import.meta.env?.DEV ? LOG_LEVELS.DEBUG : LOG_LEVELS.WARN;

let currentLevel = DEFAULT_LEVEL;

/**
 * 設定日誌等級
 * @param {'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'NONE'} level
 */
export function setLogLevel(level) {
  if (LOG_LEVELS[level] !== undefined) {
    currentLevel = LOG_LEVELS[level];
  }
}

/**
 * 建立帶有模組標籤的 logger 實例
 * @param {string} moduleName - 模組名稱，會以 [ModuleName] 格式顯示
 * @returns {Object} logger 實例
 */
export function createLogger(moduleName) {
  const prefix = `[${moduleName}]`;

  return {
    debug: (...args) => {
      if (currentLevel <= LOG_LEVELS.DEBUG) {
        console.debug(prefix, ...args);
      }
    },

    info: (...args) => {
      if (currentLevel <= LOG_LEVELS.INFO) {
        console.info(prefix, ...args);
      }
    },

    warn: (...args) => {
      if (currentLevel <= LOG_LEVELS.WARN) {
        console.warn(prefix, ...args);
      }
    },

    error: (...args) => {
      if (currentLevel <= LOG_LEVELS.ERROR) {
        console.error(prefix, ...args);
      }
    }
  };
}

// 預設 logger 實例（用於未指定模組的情況）
export const logger = createLogger('App');
