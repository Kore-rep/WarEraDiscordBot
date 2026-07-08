import { splitMessage, DISCORD_MESSAGE_LIMIT } from '../../../src/services/discord/messageChunker';

describe('splitMessage', () => {
  it('returns an empty array for empty content', () => {
    expect(splitMessage('')).toEqual([]);
  });

  it('returns a single chunk when within the limit', () => {
    expect(splitMessage('hello')).toEqual(['hello']);
  });

  it('splits on line boundaries when over the limit', () => {
    const line = 'x'.repeat(1000);
    const chunks = splitMessage([line, line, line].join('\n'), 1500);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(1500);
    }
    // No content is lost or duplicated
    expect(chunks.join('\n')).toBe([line, line, line].join('\n'));
  });

  it('hard-splits a single line that is longer than the limit', () => {
    const chunks = splitMessage('y'.repeat(2500), 1000);
    expect(chunks).toHaveLength(3);
    expect(chunks.every(c => c.length <= 1000)).toBe(true);
    expect(chunks.join('')).toBe('y'.repeat(2500));
  });

  it('keeps every chunk within Discord’s 2000-char default limit', () => {
    const big = Array.from({ length: 500 }, (_, i) => `line ${i} ${'z'.repeat(20)}`).join('\n');
    const chunks = splitMessage(big);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(DISCORD_MESSAGE_LIMIT);
    }
  });
});
