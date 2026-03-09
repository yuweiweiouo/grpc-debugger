/**
 * 日誌系統 (Logger)
 * 提供統一的日誌輸出介面，支援分級 (debug, info, warn, error) 
 * 與標籤化 (Prefix)，便於在複雜的非同步流程中追蹤問題。
 */

type LogLevelName = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'NONE';

interface Logger {
  debug: (...args: unknown[]) => void;
  info:  (...args: unknown[]) => void;
  warn:  (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

const LOG_LEVELS: Record<LogLevelName, number> = {
  DEBUG: 0,
  INFO:  1,
  WARN:  2,
  ERROR: 3,
  NONE:  4,
};

const DEFAULT_LEVEL =
  (import.meta as any).env?.DEV ? LOG_LEVELS.DEBUG : LOG_LEVELS.WARN;

let currentLevel = DEFAULT_LEVEL;

export function setLogLevel(level: LogLevelName): void {
  if (LOG_LEVELS[level] !== undefined) {
    currentLevel = LOG_LEVELS[level];
  }
}

export function createLogger(moduleName: string): Logger {
  const prefix = `[${moduleName}]`;
  return {
    debug: (...args) => { if (currentLevel <= LOG_LEVELS.DEBUG) console.debug(prefix, ...args); },
    info:  (...args) => { if (currentLevel <= LOG_LEVELS.INFO)  console.info(prefix, ...args); },
    warn:  (...args) => { if (currentLevel <= LOG_LEVELS.WARN)  console.warn(prefix, ...args); },
    error: (...args) => { if (currentLevel <= LOG_LEVELS.ERROR) console.error(prefix, ...args); },
  };
}

export const logger = createLogger('App');
