import { ApiService } from '../../../src/services/api/ApiService';
import { DiscordService } from '../../../src/services/discord/DiscordService';
import { LeaderboardService } from '../../../src/services/leaderboard/LeaderboardService';
import { writeWeeklySnapshot } from '../../../src/services/leaderboard/weeklyDamageSnapshotStore';
import { LeaderboardConfig, LeaderboardSnapshot } from '../../../src/config/config';
import { ServerConfigManager } from '../../../src/utils/serverConfigManager';

jest.mock('../../../src/utils/serverConfigManager');
jest.mock('../../../src/services/leaderboard/weeklyDamageSnapshotStore', () => ({
  ...jest.requireActual('../../../src/services/leaderboard/weeklyDamageSnapshotStore'),
  writeWeeklySnapshot: jest.fn(async () => undefined),
}));
jest.mock('../../../src/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

describe('LeaderboardService offline refresh', () => {
  it('separates prestige players while retaining all players in overall and CSV results', async () => {
    const config: LeaderboardConfig = {
      enabled: true,
      channelId: 'channel-1',
      countryIds: [],
      countryNames: [],
      topCount: 10,
      levelBrackets: [
        { minLevel: 0, maxLevel: 19, label: '0-19' },
        { minLevel: 20, maxLevel: 29, label: '20-29' },
        { minLevel: 30, maxLevel: 39, label: '30-39' },
        { minLevel: 40, maxLevel: 44, label: '40-44' },
        { minLevel: 45, label: '45+' },
      ],
    };
    const players = [
      { id: 'newcomer', name: 'Newcomer', level: 19, prestigeLevel: 0, weekly: 60, total: 600 },
      { id: 'regular', name: 'Regular', level: 35, prestigeLevel: 0, weekly: 100, total: 1000 },
      { id: 'prestige-two', name: 'Prestige Two', level: 35, prestigeLevel: 2, weekly: 200, total: 2000 },
      { id: 'prestige-one', name: 'Prestige One', level: 41, prestigeLevel: 1, weekly: 150, total: 1500 },
      { id: 'legacy', name: 'Legacy', level: 42, weekly: 80, total: 800 },
      { id: 'boundary', name: 'Boundary', level: 45, prestigeLevel: 0, weekly: 75, total: 750 },
      { id: 'veteran', name: 'Veteran', level: 46, prestigeLevel: 0, weekly: 70, total: 700 },
    ];
    const userData = new Map(players.map(player => [player.id, {
      _id: player.id,
      username: player.name,
      country: 'sa',
      leveling: {
        level: player.level,
        ...('prestigeLevel' in player ? { prestigeLevel: player.prestigeLevel } : {}),
      },
      rankings: {
        weeklyUserDamages: { value: player.weekly },
        userDamages: { value: player.total },
      },
    }]));
    const unit = {
      _id: 'mu-1',
      name: 'Test Unit',
      members: [...players.map(player => player.id), 'regular'],
      rankings: { muWeeklyDamages: { value: 5000 }, muDamages: { value: 10000 } },
    };
    const batchClient = {
      runBatch: jest.fn(async () => undefined),
      mu: { getById: jest.fn(async () => ({ result: { data: unit } })) },
      user: { getUserLite: jest.fn(async (id: string) => ({ result: { data: userData.get(id) } })) },
      country: { getCountryById: jest.fn(async () => ({ result: { data: { code: 'ZA' } } })) },
    };
    const apiService = {
      createCommandBatchClient: jest.fn(() => batchClient),
    } as unknown as ApiService;
    const discordService = {
      updateLeaderboardMessage: jest.fn(async () => 'message-1'),
    } as unknown as DiscordService;
    (ServerConfigManager.getServerConfig as jest.Mock).mockReturnValue({ leaderboard: config });
    (ServerConfigManager.getMilitaryUnits as jest.Mock).mockReturnValue([{ muId: unit._id }]);

    await new LeaderboardService(discordService, apiService).refreshServer('server-1');

    const [, , , embeds] = (discordService.updateLeaderboardMessage as jest.Mock).mock.calls[0];
    const rendered = embeds.map((embed: { toJSON: () => { title: string; description: string } }) => embed.toJSON());
    expect(rendered).toHaveLength(9);
    expect(rendered[0].title).toContain('0-19');
    expect(rendered[0].description).toContain('Newcomer');
    expect(rendered[1].title).toContain('20-29');
    expect(rendered[2].description).toContain('Regular');
    expect(rendered[2].description).not.toContain('Prestige Two');
    expect(rendered[3].description).toContain('Legacy');
    expect(rendered[3].description).not.toContain('Boundary');
    expect(rendered[3].description).not.toContain('Prestige One');
    expect(rendered[4].description).toContain('Veteran');
    expect(rendered[4].description).toContain('Boundary');
    expect(rendered[5].title).toContain('Prestige');
    expect(rendered[5].description).toContain('P2 · Lv 35 ·');
    expect(rendered[5].description).toContain('P1 · Lv 41 ·');
    expect(rendered[5].description).not.toContain('Regular');
    expect(rendered[6].description).toContain('Regular');
    expect(rendered[6].description).toContain('Prestige Two');
    expect(rendered[6].description).toContain('Legacy');

    const [, saved] = (ServerConfigManager.updateLeaderboardConfig as jest.Mock).mock.calls[0];
    const snapshot = saved.lastSnapshot as LeaderboardSnapshot;
    expect(snapshot.playerWeeklyByBracket['0-19'].map(entry => entry.id)).toEqual(['newcomer']);
    expect(snapshot.playerWeeklyByBracket['30-39'].map(entry => entry.id)).toEqual(['regular']);
    expect(snapshot.playerWeeklyByBracket['40-44'].map(entry => entry.id)).toEqual(['legacy']);
    expect(snapshot.playerWeeklyByBracket['45+'].map(entry => entry.id)).toEqual(['boundary', 'veteran']);
    expect(snapshot.playerWeeklyByBracket.Prestige.map(entry => entry.id)).toEqual([
      'prestige-two', 'prestige-one',
    ]);
    expect(snapshot.playerTotal).toHaveLength(7);

    const userCsvCall = (writeWeeklySnapshot as jest.Mock).mock.calls.find(call => call[1] === 'users');
    expect(userCsvCall[3]).toContain('prestige_level');
    expect(userCsvCall[3]).toContain('prestige-two,Prestige Two,35,ZA,200,2');
    expect(userCsvCall[3]).toContain('legacy,Legacy,42,ZA,80,0');
    expect(batchClient.user.getUserLite).toHaveBeenCalledTimes(7);
    expect((apiService.createCommandBatchClient as jest.Mock)).toHaveBeenCalledTimes(3);
  });
});
