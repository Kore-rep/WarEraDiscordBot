import { computeMuScore } from '../../../src/services/muDirectory/score';

describe('computeMuScore', () => {
  it('averages tier scores across ranking entries', () => {
    const mu = {
      rankings: {
        a: { tier: 'gold' }, // 5.0
        b: { tier: 'platinum' }, // 7.5
        c: { tier: 'silver' }, // 2.5
      },
    };
    expect(computeMuScore(mu)).toBe(5.0);
  });

  it('treats none/unranked/bronze as 0 and is case-insensitive', () => {
    const mu = {
      rankings: {
        a: { tier: 'DIAMOND' }, // 10
        b: { tier: 'bronze' }, // 0
        c: { tier: 'Unranked' }, // 0
        d: { tier: 'none' }, // 0
      },
    };
    expect(computeMuScore(mu)).toBe(2.5);
  });

  it('returns 0 for missing or non-object rankings', () => {
    expect(computeMuScore({})).toBe(0);
    expect(computeMuScore({ rankings: null })).toBe(0);
    expect(computeMuScore({ rankings: {} })).toBe(0);
    expect(computeMuScore(undefined)).toBe(0);
  });

  it('ignores non-object ranking entries and unknown tiers', () => {
    const mu = {
      rankings: {
        a: { tier: 'gold' }, // 5
        b: 'not-an-object',
        c: { tier: 'mythic' }, // unknown -> 0
      },
    };
    // (5 + 0) / 2 = 2.5  (the string entry is skipped entirely)
    expect(computeMuScore(mu)).toBe(2.5);
  });
});
