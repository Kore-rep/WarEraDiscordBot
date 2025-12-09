/**
 * Simple logger utility for the bot
 * Provides timestamped logging with different log levels
 */

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

class Logger {
  private formatMessage(level: LogLevel, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level}] ${message}`;
  }

  debug(message: string, ...args: unknown[]): void {
    console.log(this.formatMessage(LogLevel.DEBUG, message), ...args);
  }

  info(message: string, ...args: unknown[]): void {
    console.log(this.formatMessage(LogLevel.INFO, message), ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    console.warn(this.formatMessage(LogLevel.WARN, message), ...args);
  }

  error(message: string, error?: Error | unknown, ...args: unknown[]): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error(
      this.formatMessage(LogLevel.ERROR, message),
      errorMessage,
      stack ? `\n${stack}` : '',
      ...args
    );
  }
}

// Export a singleton instance
export const logger = new Logger();

