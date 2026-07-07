/**
 * Simple logger utility for the bot
 * Provides timestamped logging with different log levels
 */

import { formatErrorForLog } from './formatError';

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

const LOG_LEVEL_RANK: Record<LogLevel, number> = {
  [LogLevel.DEBUG]: 0,
  [LogLevel.INFO]: 1,
  [LogLevel.WARN]: 2,
  [LogLevel.ERROR]: 3,
};

/** Default matches previous behavior: all levels including DEBUG are emitted. */
const DEFAULT_LOG_LEVEL = LogLevel.DEBUG;

export function parseLogLevel(value: string | undefined): LogLevel {
  if (!value) {
    return DEFAULT_LOG_LEVEL;
  }

  const normalized = value.trim().toUpperCase();
  if (normalized in LogLevel) {
    return normalized as LogLevel;
  }

  console.warn(
    `[logger] Invalid LOG_LEVEL "${value}"; expected DEBUG, INFO, WARN, or ERROR. Using ${DEFAULT_LOG_LEVEL}.`
  );
  return DEFAULT_LOG_LEVEL;
}

class Logger {
  private minLevel: LogLevel;

  constructor(minLevel: LogLevel = DEFAULT_LOG_LEVEL) {
    this.minLevel = minLevel;
  }

  getMinLevel(): LogLevel {
    return this.minLevel;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_RANK[level] >= LOG_LEVEL_RANK[this.minLevel];
  }

  private formatMessage(level: LogLevel, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level}] ${message}`;
  }

  debug(message: string, ...args: unknown[]): void {
    if (!this.shouldLog(LogLevel.DEBUG)) {
      return;
    }
    console.log(this.formatMessage(LogLevel.DEBUG, message), ...args);
  }

  info(message: string, ...args: unknown[]): void {
    if (!this.shouldLog(LogLevel.INFO)) {
      return;
    }
    console.log(this.formatMessage(LogLevel.INFO, message), ...args);
  }

  warn(message: string, error?: unknown, ...args: unknown[]): void {
    if (!this.shouldLog(LogLevel.WARN)) {
      return;
    }
    if (error !== undefined) {
      console.warn(
        this.formatMessage(LogLevel.WARN, message),
        formatErrorForLog(error),
        ...args
      );
      return;
    }
    console.warn(this.formatMessage(LogLevel.WARN, message), ...args);
  }

  error(message: string, error?: Error | unknown, ...args: unknown[]): void {
    if (!this.shouldLog(LogLevel.ERROR)) {
      return;
    }
    const detail = error !== undefined ? formatErrorForLog(error) : '';
    const stack = error instanceof Error ? error.stack : undefined;
    console.error(
      this.formatMessage(LogLevel.ERROR, message),
      detail,
      stack ? `\n${stack}` : '',
      ...args
    );
  }
}

// Export a singleton instance (level read once at startup from LOG_LEVEL)
export const logger = new Logger(parseLogLevel(process.env.LOG_LEVEL));
