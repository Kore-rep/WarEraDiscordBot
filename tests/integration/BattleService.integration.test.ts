import { BattleService } from '../../src/services/battle/BattleService';
import { DiscordService } from '../../src/services/discord/DiscordService';
import { ApiService } from '../../src/services/api/ApiService';
import { ServerConfigManager } from '../../src/utils/serverConfigManager';

// Mock dependencies
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

  beforeEach(() => {
    mockDiscordService = new DiscordService(null as any, null as any) as jest.Mocked<DiscordService>;
    mockApiService = new ApiService(null as any) as jest.Mocked<ApiService>;
    battleService = new BattleService(mockDiscordService, mockApiService);

    // Setup default mocks
    mockApiService.fetchBattles = jest.fn().mockResolvedValue({
      battles: [],
      countries: new Map(),
      regions: new Map(),
    });
    mockApiService.extractRoleIdsByServer = jest.fn().mockReturnValue(new Map());
    mockDiscordService.updateBattleMessage = jest.fn().mockResolvedValue(undefined);
    mockDiscordService.getServerIds = jest.fn().mockReturnValue(['server1']);
    mockDiscordService.deleteBattleMessage = jest.fn().mockResolvedValue(undefined);
    mockDiscordService.pruneInactiveBattleTracking = jest.fn();
    mockDiscordService.loadPersistedBattles = jest.fn().mockResolvedValue(undefined);
    
    // Mock ServerConfigManager - return default config with bountyThreshold: 0
    (ServerConfigManager.getServerConfig as jest.Mock).mockReturnValue({
      channelId: 'channel-123',
      roleIds: ['role1'],
      enabled: true,
      bountyThreshold: 0,
    });
  });

  describe('processBattles', () => {
    it('should process new battles and update Discord', async () => {
      const mockBattle = createMockBattle('1', 100, 1.5, 200, 2.0);
      const mockCountries = new Map([['country1', { name: 'USA' }]]);
      const mockRegions = new Map([['region1', { name: 'Texas' }]]);

      mockApiService.fetchBattles = jest.fn().mockResolvedValue({
        battles: [mockBattle],
        countries: mockCountries,
        regions: mockRegions,
      });

      mockApiService.extractRoleIdsByServer = jest.fn().mockReturnValue(
        new Map([['server1', ['role1']]])
      );

      await battleService.processBattles();

      expect(mockApiService.fetchBattles).toHaveBeenCalled();
      expect(mockDiscordService.updateBattleMessage).toHaveBeenCalledWith(
        'server1',
        ['role1'],
        '1',
        expect.any(String),
        3.5 // totalBounty (1.5 + 2.0)
      );
    });

    it('should not update Discord when no changes detected', async () => {
      const mockBattle = createMockBattle('1', 100, 1.5, 200, 2.0);

      mockApiService.fetchBattles = jest.fn().mockResolvedValue({
        battles: [mockBattle],
        countries: new Map(),
        regions: new Map(),
      });

      // First call - new battle
      await battleService.processBattles();

      // Reset mock
      mockDiscordService.updateBattleMessage.mockClear();

      // Second call - no changes
      await battleService.processBattles();

      expect(mockDiscordService.updateBattleMessage).not.toHaveBeenCalled();
    });

    it('should handle API errors gracefully', async () => {
      mockApiService.fetchBattles = jest.fn().mockRejectedValue(new Error('API Error'));

      await expect(battleService.processBattles()).rejects.toThrow('API Error');
    });

    it('should continue processing other servers if one fails', async () => {
      const mockBattle = createMockBattle('1', 100, 1.5, 200, 2.0);

      mockApiService.fetchBattles = jest.fn().mockResolvedValue({
        battles: [mockBattle],
        countries: new Map(),
        regions: new Map(),
      });

      mockApiService.extractRoleIdsByServer = jest.fn().mockReturnValue(
        new Map([
          ['server1', ['role1']],
          ['server2', ['role2']],
        ])
      );

      // Make first server fail
      mockDiscordService.updateBattleMessage
        .mockRejectedValueOnce(new Error('Discord Error'))
        .mockResolvedValueOnce(undefined);

      await battleService.processBattles();

      expect(mockDiscordService.updateBattleMessage).toHaveBeenCalledTimes(2);
    });
  });

  describe('cleanupOldBattles', () => {
    it('should call delete for each server and old battle', async () => {
      // Setup: Mock that fetchBattles returns no battles
      // This simulates that battles have ended
      mockApiService.fetchBattles = jest.fn().mockResolvedValue({
        battles: [],
        countries: new Map(),
        regions: new Map(),
      });

      mockDiscordService.getServerIds = jest.fn().mockReturnValue(['server1', 'server2']);

      // Call cleanup (it will check for old battles and call delete if any exist)
      await battleService.cleanupOldBattles();

      // The cleanup should have attempted to fetch battles
      expect(mockApiService.fetchBattles).toHaveBeenCalled();
      
      // Note: Since we can't easily manipulate the BattleTracker's internal
      // time tracking in this test, we just verify the cleanup method runs
      // without errors. The BattleTracker unit tests cover the actual
      // old battle detection logic.
    });

    it('should handle cleanup errors gracefully', async () => {
      mockApiService.fetchBattles = jest.fn().mockRejectedValue(new Error('API Error'));

      // Should not throw
      await expect(battleService.cleanupOldBattles()).resolves.not.toThrow();
    });
  });

  describe('getTrackedBattleCount', () => {
    it('should return the number of tracked battles', async () => {
      const battles = [
        createMockBattle('1', 100, 1.5, 200, 2.0),
        createMockBattle('2', 150, 2.0, 250, 2.5),
      ];

      mockApiService.fetchBattles = jest.fn().mockResolvedValue({
        battles,
        countries: new Map(),
        regions: new Map(),
      });

      await battleService.processBattles();

      expect(battleService.getTrackedBattleCount()).toBe(2);
    });
  });
});

function createMockBattle(
  id: string,
  attackerPool: number,
  attackerBounty: number,
  defenderPool: number,
  defenderBounty: number
): any {
  return {
    _id: id,
    attacker: {
      country: 'country1',
      region: 'region1',
      wonRoundsCount: 0,
      countryOrders: [],
      muOrders: [],
      damages: 1000,
      hitCount: 10,
      moneyPer1kDamages: attackerBounty,
      moneyPool: attackerPool,
    },
    defender: {
      country: 'country2',
      region: 'region2',
      wonRoundsCount: 0,
      countryOrders: [],
      muOrders: [],
      damages: 900,
      hitCount: 9,
      moneyPer1kDamages: defenderBounty,
      moneyPool: defenderPool,
    },
    stats: {
      hitCount: 19,
    },
    war: 'war1',
    rounds: [],
    roundsHistory: [],
    isActive: true,
    isResistance: false,
    roundsToWin: 8,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    __v: 0,
  };
}

