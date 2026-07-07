import { BattleService } from '../../../src/services/battle/BattleService';
import { DiscordService } from '../../../src/services/discord/DiscordService';
import { ApiService } from '../../../src/services/api/ApiService';
import { ServerConfigManager } from '../../../src/utils/serverConfigManager';

jest.mock('../../../src/services/discord/DiscordService');
jest.mock('../../../src/services/api/ApiService');
jest.mock('../../../src/utils/serverConfigManager');
jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('BattleService', () => {
  let battleService: BattleService;
  let mockDiscordService: jest.Mocked<DiscordService>;
  let mockApiService: jest.Mocked<ApiService>;

  // A battle carrying an attacker-side bounty that SimpleBountyTracker will detect
  const makeBattle = (id = 'battle-1') => ({
    _id: id,
    attacker: {
      country: 'country-1',
      region: 'region-1',
      bountyEffectiveAt: '2026-01-01T00:00:00.000Z',
      moneyPer1kDamages: 100,
      moneyPool: 5000,
    },
    defender: {
      country: 'country-2',
      region: 'region-2',
      bountyEffectiveAt: null,
      moneyPer1kDamages: 0,
      moneyPool: 0,
    },
  });

  const countries = new Map([['country-1', { name: 'USA' }]]);
  const regions = new Map([['region-1', { name: 'Texas' }]]);

  const configureServers = (
    servers: Record<string, { enabled?: boolean; channelId?: string; bountyThreshold?: number; minBountyToSend?: number; roleIds?: string[] }>
  ) => {
    const map = new Map(
      Object.entries(servers).map(([id, cfg]) => [id, { bountyBattles: { channelId: 'channel-1', roleIds: [], ...cfg } }])
    );
    (ServerConfigManager.readServerConfigs as jest.Mock).mockReturnValue(map);
    (ServerConfigManager.getServerConfig as jest.Mock).mockImplementation((id: string) => map.get(id) ?? null);
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockDiscordService = {
      sendBountyAlert: jest.fn().mockResolvedValue(undefined),
    } as any;

    mockApiService = {
      fetchBattles: jest.fn().mockResolvedValue({ battles: [makeBattle()], countries, regions }),
      filterBattlesWithBountyRewards: jest.fn((battles: any[]) => battles),
    } as any;

    battleService = new BattleService(mockDiscordService, mockApiService);
  });

  describe('processBattles', () => {
    it('sends a bounty alert to a configured, enabled server', async () => {
      configureServers({ 'server-1': { enabled: true, roleIds: ['role-1'], bountyThreshold: 0 } });

      await battleService.processBattles();

      expect(mockDiscordService.sendBountyAlert).toHaveBeenCalledTimes(1);
      expect(mockDiscordService.sendBountyAlert).toHaveBeenCalledWith('server-1', expect.any(String), ['role-1']);
    });

    it('skips servers where bounty battles are disabled', async () => {
      configureServers({ 'server-disabled': { enabled: false } });

      await battleService.processBattles();

      expect(mockDiscordService.sendBountyAlert).not.toHaveBeenCalled();
    });

    it('does not mention roles when the bounty is below the mention threshold', async () => {
      configureServers({ 'server-1': { enabled: true, roleIds: ['role-1'], bountyThreshold: 1000 } });

      await battleService.processBattles();

      expect(mockDiscordService.sendBountyAlert).toHaveBeenCalledWith('server-1', expect.any(String), []);
    });

    it('skips bounties below minBountyToSend', async () => {
      configureServers({ 'server-1': { enabled: true, minBountyToSend: 1000 } });

      await battleService.processBattles();

      expect(mockDiscordService.sendBountyAlert).not.toHaveBeenCalled();
    });

    it('does not alert for the same bounty twice', async () => {
      configureServers({ 'server-1': { enabled: true } });

      await battleService.processBattles();
      await battleService.processBattles();

      expect(mockDiscordService.sendBountyAlert).toHaveBeenCalledTimes(1);
    });

    it('throws if the API fetch fails', async () => {
      (mockApiService.fetchBattles as jest.Mock).mockRejectedValue(new Error('API Error'));

      await expect(battleService.processBattles()).rejects.toThrow('API Error');
    });

    it('continues with other servers if one send fails', async () => {
      configureServers({ 'server-1': { enabled: true }, 'server-2': { enabled: true } });
      (mockDiscordService.sendBountyAlert as jest.Mock)
        .mockRejectedValueOnce(new Error('Discord error'))
        .mockResolvedValueOnce(undefined);

      await expect(battleService.processBattles()).resolves.not.toThrow();
      expect(mockDiscordService.sendBountyAlert).toHaveBeenCalledTimes(2);
    });
  });

  describe('cleanupOldBattles', () => {
    it('completes without throwing', async () => {
      await expect(battleService.cleanupOldBattles()).resolves.not.toThrow();
    });
  });

  describe('getTrackedBattleCount', () => {
    it('returns a non-negative number', () => {
      const count = battleService.getTrackedBattleCount();
      expect(typeof count).toBe('number');
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });
});
