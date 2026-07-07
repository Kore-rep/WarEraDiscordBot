import { describe, expect, it } from '@jest/globals';
import { LogLevel, parseLogLevel } from '../../src/utils/logger';

describe('parseLogLevel', () => {
  it('defaults to DEBUG when unset', () => {
    expect(parseLogLevel(undefined)).toBe(LogLevel.DEBUG);
    expect(parseLogLevel('')).toBe(LogLevel.DEBUG);
  });

  it('accepts valid levels case-insensitively', () => {
    expect(parseLogLevel('info')).toBe(LogLevel.INFO);
    expect(parseLogLevel('WARN')).toBe(LogLevel.WARN);
    expect(parseLogLevel(' Error ')).toBe(LogLevel.ERROR);
  });

  it('falls back to DEBUG for invalid values', () => {
    expect(parseLogLevel('trace')).toBe(LogLevel.DEBUG);
  });
});
