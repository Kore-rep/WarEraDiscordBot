import { BattleService } from '../../../src/services/battle/BattleService';
import { DiscordService } from '../../../src/services/discord/DiscordService';
import { ApiService } from '../../../src/services/api/ApiService';
import { ServerConfigManager } from '../../../src/utils/serverConfigManager';

// Mock dependencies
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

  beforeEach(() => {
    jest.clearAllMocks();

    mockDiscordService = {
      updateBattleMessage: jest.fn(),
      deleteBattleMessage: jest.fn(),
      getServerIds: jest.fn(),
    } as any;

    mockApiService = {
      fetchBattles: jest.fn(),
      extractRoleIdsByServer: jest.fn(),
    } as any;

    battleService = new BattleService(mockDiscordService, mockApiService);
  });

  describe('processBattles with enabled/disabled check', () => {
    const mockBattle = {
      _id: 'battle-1',
      money: 1000,
      pool: 5000,
      moneyPer1kDamages: 100,
      createdAt: new Date().toISOString(),
      attackers: [],
      defenders: [],
      region: 'region-1',
      attacker: {
        moneyPool: 5000,
        moneyPer1kDamages: 100,
      },
      defender: {
        moneyPool: 0,
        moneyPer1kDamages: 0,
      },
    };

    const mockCountries = new Map([['country-1', { name: 'USA' }]]);
    const mockRegions = new Map([['region-1', { name: 'Texas' }]]);

    it('should process battles for enabled servers', async () => {
      (mockApiService.fetchBattles as jest.Mock).mockResolvedValue({
        battles: [mockBattle],
        countries: mockCountries,
        regions: mockRegions,
      });

      (mockApiService.extractRoleIdsByServer as jest.Mock).mockReturnValue(
        new Map([['server-1', ['role-1']]])
      );

      (ServerConfigManager.getServerConfig as jest.Mock).mockReturnValue({
        channelId: 'channel-1',
        roleIds: ['role-1'],
        enabled: true,
      });

      await battleService.processBattles();

      expect(mockDiscordService.updateBattleMessage).toHaveBeenCalled();
    });

    it('should skip battles for disabled servers', async () => {
      (mockApiService.fetchBattles as jest.Mock).mockResolvedValue({
        battles: [mockBattle],
        countries: mockCountries,
        regions: mockRegions,
      });

      (mockApiService.extractRoleIdsByServer as jest.Mock).mockReturnValue(
        new Map([['server-disabled', ['role-1']]])
      );

      (ServerConfigManager.getServerConfig as jest.Mock).mockReturnValue({
        bountyBattles: {
          channelId: 'channel-1',
          roleIds: ['role-1'],
          enabled: false,
          bountyThreshold: 0,
        },
      });

      await battleService.processBattles();

      expect(mockDiscordService.updateBattleMessage).not.toHaveBeenCalled();
    });

    it('should process battles for servers with enabled:undefined (default to true)', async () => {
      (mockApiService.fetchBattles as jest.Mock).mockResolvedValue({
        battles: [mockBattle],
        countries: mockCountries,
        regions: mockRegions,
      });

      (mockApiService.extractRoleIdsByServer as jest.Mock).mockReturnValue(
        new Map([['server-2', ['role-1']]])
      );

      (ServerConfigManager.getServerConfig as jest.Mock).mockReturnValue({
        bountyBattles: {
          channelId: 'channel-1',
          roleIds: ['role-1'],
          // enabled is undefined - should default to true
          bountyThreshold: 0,
        },
      });

      await battleService.processBattles();

      expect(mockDiscordService.updateBattleMessage).toHaveBeenCalled();
    });

    it('should process battles for servers with no config (null)', async () => {
      (mockApiService.fetchBattles as jest.Mock).mockResolvedValue({
        battles: [mockBattle],
        countries: mockCountries,
        regions: mockRegions,
      });

      (mockApiService.extractRoleIdsByServer as jest.Mock).mockReturnValue(
        new Map([['server-3', ['role-1']]])
      );

      (ServerConfigManager.getServerConfig as jest.Mock).mockReturnValue(null);

      await battleService.processBattles();

      // Should process even if no config (for backwards compatibility)
      expect(mockDiscordService.updateBattleMessage).toHaveBeenCalled();
    });

    it('should handle mixed enabled/disabled servers', async () => {
      (mockApiService.fetchBattles as jest.Mock).mockResolvedValue({
        battles: [mockBattle],
        countries: mockCountries,
        regions: mockRegions,
      });

      (mockApiService.extractRoleIdsByServer as jest.Mock).mockReturnValue(
        new Map([
          ['server-enabled', ['role-1']],
          ['server-disabled', ['role-2']],
        ])
      );

      (ServerConfigManager.getServerConfig as jest.Mock).mockImplementation((serverId) => {
        if (serverId === 'server-enabled') {
          return {
            bountyBattles: {
              channelId: 'channel-1',
              roleIds: ['role-1'],
              enabled: true,
              bountyThreshold: 0,
            },
          };
        } else if (serverId === 'server-disabled') {
          return {
            bountyBattles: {
              channelId: 'channel-2',
              roleIds: ['role-2'],
              enabled: false,
              bountyThreshold: 0,
            },
          };
        }
        return null;
      });

      await battleService.processBattles();

      // Should be called once for enabled server only
      expect(mockDiscordService.updateBattleMessage).toHaveBeenCalledTimes(1);
      expect(mockDiscordService.updateBattleMessage).toHaveBeenCalledWith(
        'server-enabled',
        ['role-1'],
        'battle-1',
        expect.any(String),
        100 // totalBounty
      );
    });

    it('should not throw error if ServerConfigManager throws', async () => {
      (mockApiService.fetchBattles as jest.Mock).mockResolvedValue({
        battles: [mockBattle],
        countries: mockCountries,
        regions: mockRegions,
      });

      (mockApiService.extractRoleIdsByServer as jest.Mock).mockReturnValue(
        new Map([['server-1', ['role-1']]])
      );

      (ServerConfigManager.getServerConfig as jest.Mock).mockImplementation(() => {
        throw new Error('Config read error');
      });

      // Should not throw, but continue processing
      await expect(battleService.processBattles()).resolves.not.toThrow();
    });
  });

  describe('cleanupOldBattles', () => {
    it('should call cleanup without throwing error', async () => {
      (mockApiService.fetchBattles as jest.Mock).mockResolvedValue({
        battles: [],
        countries: new Map(),
        regions: new Map(),
      });

      (mockDiscordService.getServerIds as jest.Mock).mockReturnValue(['server-1', 'server-2']);

      // Should complete without throwing
      await expect(battleService.cleanupOldBattles()).resolves.not.toThrow();

      // Verify API was called to get current battles
      expect(mockApiService.fetchBattles).toHaveBeenCalled();
    });
  });

  describe('getTrackedBattleCount', () => {
    it('should return the number of tracked battles', () => {
      const count = battleService.getTrackedBattleCount();
      expect(typeof count).toBe('number');
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  describe('error handling', () => {
    it('should handle API fetch errors', async () => {
      (mockApiService.fetchBattles as jest.Mock).mockRejectedValue(
        new Error('API Error')
      );

      await expect(battleService.processBattles()).rejects.toThrow('API Error');
    });

    it('should continue processing other servers if one fails', async () => {
      const mockBattle = {
        _id: 'battle-1',
        money: 1000,
        pool: 5000,
        moneyPer1kDamages: 100,
        createdAt: new Date().toISOString(),
        attackers: [],
        defenders: [],
        region: 'region-1',
        attacker: {
          moneyPool: 5000,
          moneyPer1kDamages: 100,
        },
        defender: {
          moneyPool: 0,
          moneyPer1kDamages: 0,
        },
      };

      (mockApiService.fetchBattles as jest.Mock).mockResolvedValue({
        battles: [mockBattle],
        countries: new Map(),
        regions: new Map(),
      });

      (mockApiService.extractRoleIdsByServer as jest.Mock).mockReturnValue(
        new Map([
          ['server-1', ['role-1']],
          ['server-2', ['role-2']],
        ])
      );

      (ServerConfigManager.getServerConfig as jest.Mock).mockReturnValue({
        channelId: 'channel-1',
        roleIds: ['role-1'],
        enabled: true,
      });

      // Make first server fail, second should still process
      (mockDiscordService.updateBattleMessage as jest.Mock)
        .mockRejectedValueOnce(new Error('Discord error'))
        .mockResolvedValueOnce(undefined);

      await expect(battleService.processBattles()).resolves.not.toThrow();

      // Should have attempted to update for both servers
      expect(mockDiscordService.updateBattleMessage).toHaveBeenCalledTimes(2);
    });
  });
});
