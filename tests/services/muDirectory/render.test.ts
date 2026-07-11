import {
  renderDirectory,
  formatDamage,
  formatScore,
  formatLevel,
  formatCommanders,
  MuDirectoryEntry,
} from '../../../src/services/muDirectory/render';

const entry = (over: Partial<MuDirectoryEntry>): MuDirectoryEntry => ({
  name: 'MU',
  url: 'https://app.warera.io/mu/x',
  hqLevel: 0,
  dormsLevel: 0,
  commanders: [],
  score: 0,
  potentialDamage: 0,
  ...over,
});

describe('render formatters', () => {
  it('formats score to one decimal', () => {
    expect(formatScore(5)).toBe('5.0');
    expect(formatScore(2.53)).toBe('2.5');
    expect(formatScore('bad')).toBe('0.0');
  });

  it('formats damage with thousands separators', () => {
    expect(formatDamage(68622334)).toBe('68,622,334');
    expect(formatDamage(0)).toBe('0');
    expect(formatDamage(undefined)).toBe('0');
  });

  it('formats levels as truncated ints defaulting to 0', () => {
    expect(formatLevel(3)).toBe(3);
    expect(formatLevel('bad')).toBe(0);
  });

  it('formats commanders or falls back to Unknown', () => {
    expect(formatCommanders(['Alice', 'Bob'])).toBe('Alice, Bob');
    expect(formatCommanders([])).toBe('Unknown');
    expect(formatCommanders(undefined)).toBe('Unknown');
  });
});

describe('renderDirectory', () => {
  it('renders INFO / MU\'s / LEADERBOARD sections with a leaderboard sorted by score then damage', () => {
    const out = renderDirectory([
      entry({ name: 'Alpha', score: 5, potentialDamage: 100, hqLevel: 4, dormsLevel: 5, commanders: ['Cmd'] }),
      entry({ name: 'Bravo', score: 5, potentialDamage: 200 }),
      entry({ name: 'Charlie', score: 7.5, potentialDamage: 10 }),
    ]);

    expect(out).toContain('**INFO**');
    expect(out).toContain("**MU's**");
    expect(out).toContain('**LEADERBOARD + STATS**');
    expect(out).toContain('> **[Alpha](<https://app.warera.io/mu/x>)**');
    expect(out).toContain('> HQ: 4/4');
    expect(out).toContain('> Dorms: 5/5');
    expect(out).toContain('> Commanders: Cmd');

    // Leaderboard order: Charlie (7.5) first, then Bravo (5, 200) before Alpha (5, 100).
    const lb = out.slice(out.indexOf('**LEADERBOARD + STATS**'));
    const first = lb.indexOf('Charlie');
    const second = lb.indexOf('Bravo');
    const third = lb.indexOf('Alpha');
    expect(first).toBeLessThan(second);
    expect(second).toBeLessThan(third);
    expect(lb).toContain('1. **Charlie**');
  });

  it('renders empty-state text when there are no MUs', () => {
    const out = renderDirectory([]);
    expect(out).toContain('No MUs saved yet.');
    expect(out).toContain('No leaderboard entries yet.');
  });
});
