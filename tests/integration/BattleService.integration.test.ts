import { BattleService } from '../../src/services/battle/BattleService';
import { DiscordService } from '../../src/services/discord/DiscordService';
import { ApiService } from '../../src/services/api/ApiService';
import { ServerConfigManager } from '../../src/utils/serverConfigManager';

jest.mock('../../src/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../src/services/discord/DiscordService');
jest.mock('../../src/services/api/ApiService');
jest.mock('../../src/utils/serverConfigManager');

describe('BattleService Integration', () => {
  let battleService: BattleService;
  let mockDiscordService: jest.Mocked<DiscordService>;
  let mockApiService: jest.Mocked<ApiService>;

  const setConfiguredServers = (ids: string[]) => {
    const map = new Map(
      ids.map(id => [id, { bountyBattles: { channelId: 'channel-123', roleIds: ['role1'], enabled: true, bountyThreshold: 0 } }])
    );
    (ServerConfigManager.readServerConfigs as jest.Mock).mockReturnValue(map);
    (ServerConfigManager.getServerConfig as jest.Mock).mockImplementation((id: string) => map.get(id) ?? null);
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockDiscordService = new DiscordService(null as any) as jest.Mocked<DiscordService>;
    mockApiService = new ApiService(null as any) as jest.Mocked<ApiService>;
    battleService = new BattleService(mockDiscordService, mockApiService);

    mockApiService.fetchBattles = jest.fn().mockResolvedValue({
      battles: [],
      countries: new Map(),
      regions: new Map(),
    });
    mockApiService.filterBattlesWithBountyRewards = jest.fn((battles: any[]) => battles);
    mockDiscordService.sendBountyAlert = jest.fn().mockResolvedValue(undefined);

    setConfiguredServers(['server1']);
  });

  describe('processBattles', () => {
    it('sends a bounty alert for a newly detected bounty', async () => {
      mockApiService.fetchBattles = jest.fn().mockResolvedValue({
        battles: [createMockBattle('1')],
        countries: new Map([['country1', { name: 'USA' }]]),
        regions: new Map([['region1', { name: 'Texas' }]]),
      });

      await battleService.processBattles();

      expect(mockApiService.fetchBattles).toHaveBeenCalled();
      expect(mockDiscordService.sendBountyAlert).toHaveBeenCalledWith('server1', expect.any(String), ['role1']);
    });

    it('does not re-alert when the same bounty is seen again', async () => {
      mockApiService.fetchBattles = jest.fn().mockResolvedValue({
        battles: [createMockBattle('1')],
        countries: new Map(),
        regions: new Map(),
      });

      await battleService.processBattles();
      mockDiscordService.sendBountyAlert.mockClear();
      await battleService.processBattles();

      expect(mockDiscordService.sendBountyAlert).not.toHaveBeenCalled();
    });

    it('propagates API errors', async () => {
      mockApiService.fetchBattles = jest.fn().mockRejectedValue(new Error('API Error'));

      await expect(battleService.processBattles()).rejects.toThrow('API Error');
    });

    it('continues with other servers if one fails', async () => {
      setConfiguredServers(['server1', 'server2']);
      mockApiService.fetchBattles = jest.fn().mockResolvedValue({
        battles: [createMockBattle('1')],
        countries: new Map(),
        regions: new Map(),
      });
      mockDiscordService.sendBountyAlert
        .mockRejectedValueOnce(new Error('Discord Error'))
        .mockResolvedValueOnce(undefined);

      await expect(battleService.processBattles()).resolves.not.toThrow();
      expect(mockDiscordService.sendBountyAlert).toHaveBeenCalledTimes(2);
    });
  });

  describe('cleanupOldBattles', () => {
    it('runs without throwing', async () => {
      await expect(battleService.cleanupOldBattles()).resolves.not.toThrow();
    });
  });

  describe('getTrackedBattleCount', () => {
    it('counts distinct bounties alerted', async () => {
      mockApiService.fetchBattles = jest.fn().mockResolvedValue({
        battles: [createMockBattle('1'), createMockBattle('2')],
        countries: new Map(),
        regions: new Map(),
      });

      await battleService.processBattles();

      expect(battleService.getTrackedBattleCount()).toBe(2);
    });
  });
});

function createMockBattle(id: string): any {
  return {
    _id: id,
    attacker: {
      country: 'country1',
      region: 'region1',
      bountyEffectiveAt: `2026-01-0${id}T00:00:00.000Z`,
      moneyPer1kDamages: 100,
      moneyPool: 5000,
    },
    defender: {
      country: 'country2',
      region: 'region2',
      bountyEffectiveAt: null,
      moneyPer1kDamages: 0,
      moneyPool: 0,
    },
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
