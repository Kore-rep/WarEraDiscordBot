import { describe, expect, it } from '@jest/globals';
import {
  buildLeaderboardPayload,
  parseLevelBrackets,
  PRESTIGE_BRACKET_LABEL,
  userMatchesBracket,
} from '../../../src/services/leaderboard/leaderboardFormatter';
import { LeaderboardSnapshot, LevelBracket } from '../../../src/config/config';

const bracket: LevelBracket = { minLevel: 30, maxLevel: 39, label: '30-39' };

describe('prestige leaderboards', () => {
  it('keeps level 45 out of 40-44 and in 45+', () => {
    const brackets = parseLevelBrackets('0-19,20-29,30-39,40-44,45+');
    expect(userMatchesBracket(45, brackets[3])).toBe(false);
    expect(userMatchesBracket(45, brackets[4])).toBe(true);
    expect(() => parseLevelBrackets('40-45,45+')).toThrow('Level brackets overlap');
  });

  it('keeps P1+ players out of ordinary level brackets', () => {
    expect(userMatchesBracket(33, bracket, 0)).toBe(true);
    expect(userMatchesBracket(33, bracket, 1)).toBe(false);
    expect(userMatchesBracket(33, bracket, 2)).toBe(false);
    expect(userMatchesBracket(40, bracket, 0)).toBe(false);
  });

  it('renders a separate weekly prestige board and an open overall total', () => {
    const regular = { id: 'regular', name: 'Regular', value: 100, level: 33, prestigeLevel: 0 };
    const veteran = { id: 'veteran', name: 'Veteran', value: 200, level: 33, prestigeLevel: 2 };
    const lastSnapshot: LeaderboardSnapshot = {
      playerWeeklyByBracket: { [bracket.label]: [regular] },
      playerTotal: [regular],
      muWeekly: [],
      muTotal: [],
      capturedAt: '2026-09-27T00:00:00.000Z',
    };

    const payload = buildLeaderboardPayload({
      playerWeeklyByBracket: {
        [bracket.label]: [regular],
        [PRESTIGE_BRACKET_LABEL]: [veteran],
      },
      playerTotal: [veteran, regular],
      muWeekly: [],
      muTotal: [],
      levelBrackets: [bracket],
      topCount: 10,
      lastSnapshot,
      updatedAt: new Date('2026-09-27T01:00:00.000Z'),
      nextRefreshAt: new Date('2026-09-27T02:01:00.000Z'),
    });

    const embeds = payload.embeds.map(embed => embed.toJSON());
    expect(embeds).toHaveLength(5);
    expect(embeds[0].description).toContain('Regular');
    expect(embeds[0].description).not.toContain('Veteran');
    expect(embeds[1].title).toContain('Prestige');
    expect(embeds[1].description).toContain('P2 · Lv 33 ·');
    expect(embeds[1].description).toContain('Veteran');
    expect(embeds[1].description).toContain('NEW');
    expect(embeds[2].title).toContain('Overall');
    expect(embeds[2].description).toContain('Veteran');
    expect(embeds[2].description).toContain('Regular');
  });
});
