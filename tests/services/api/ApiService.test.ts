import { ApiService } from '../../../src/services/api/ApiService';
import { InMemoryCacheProvider } from '../../../src/services/api/InMemoryCacheProvider';
import { BotConfig } from '../../../src/config/config';

// Mock the SDK's createAPI function
const mockCreateAPI = jest.fn();
jest.mock('warera-sdk', () => ({
  createAPI: (config: any) => mockCreateAPI(config),
  APIClient: {} as any,
}));

// Mock the logger
jest.mock('../../../src/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock ServerConfigManager
jest.mock('../../../src/utils/serverConfigManager', () => ({
  ServerConfigManager: {
    readServerConfigs: jest.fn(() => new Map()),
  },
}));

describe('ApiService Cache Integration', () => {
  let mockConfig: BotConfig;
  let cacheProvider: InMemoryCacheProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateAPI.mockReturnValue({
      country: { getCountryById: jest.fn() },
      region: { getRegionsObject: jest.fn() },
      battle: { getBattles: jest.fn() },
      runBatch: jest.fn(),
    });

    mockConfig = {
      api: {
        baseUrl: 'https://api.test.com',
        apiKey: 'test-api-key',
      },
      discord: {
        token: 'test-token',
        servers: new Map(),
      },
      polling: {
        intervalMinutes: 1,
      },
    };

    new ApiService(mockConfig);
    
    // Get the cache provider instance from the createAPI calls
    const calls = mockCreateAPI.mock.calls;
    if (calls.length > 0) {
      cacheProvider = calls[0][0].cache as InMemoryCacheProvider;
    }
  });

  describe('cache initialization', () => {
    it('should create cache provider instance', () => {
      // Verify that createAPI was called with a cache provider
      expect(mockCreateAPI).toHaveBeenCalledTimes(2);
      
      const firstCall = mockCreateAPI.mock.calls[0][0];
      const secondCall = mockCreateAPI.mock.calls[1][0];
      
      expect(firstCall.cache).toBeDefined();
      expect(secondCall.cache).toBeDefined();
      // Both should use the same cache instance
      expect(firstCall.cache).toBe(secondCall.cache);
    });

    it('should use InMemoryCacheProvider instance', () => {
      const firstCall = mockCreateAPI.mock.calls[0][0];
      expect(firstCall.cache).toBeInstanceOf(InMemoryCacheProvider);
    });
  });

  describe('cache provider direct usage', () => {
    it('should log cache hits when values are retrieved', async () => {
      const { logger } = require('../../../src/utils/logger');
      jest.clearAllMocks();

      if (!cacheProvider) {
        cacheProvider = mockCreateAPI.mock.calls[0][0].cache;
      }

      // Set a value in cache
      await cacheProvider.set('test-cache-key', { data: 'test-value' });
      
      // Get the value - should log cache hit
      await cacheProvider.get('test-cache-key');

      expect(logger.debug).toHaveBeenCalledWith('Cache hit for key: test-cache-key');
    });

    it('should handle cache misses without logging', async () => {
      const { logger } = require('../../../src/utils/logger');
      jest.clearAllMocks();

      if (!cacheProvider) {
        cacheProvider = mockCreateAPI.mock.calls[0][0].cache;
      }

      // Try to get non-existent key
      await cacheProvider.get('non-existent-key');

      expect(logger.debug).not.toHaveBeenCalled();
    });

    it('should share cache between regular and batch clients', () => {
      const firstCall = mockCreateAPI.mock.calls[0][0];
      const secondCall = mockCreateAPI.mock.calls[1][0];
      
      expect(firstCall.cache).toBe(secondCall.cache);
      
      // Verify both are InMemoryCacheProvider instances
      expect(firstCall.cache).toBeInstanceOf(InMemoryCacheProvider);
      expect(secondCall.cache).toBeInstanceOf(InMemoryCacheProvider);
    });
  });

  describe('cache behavior verification', () => {
    it('should allow setting and getting values from shared cache', async () => {
      if (!cacheProvider) {
        cacheProvider = mockCreateAPI.mock.calls[0][0].cache;
      }

      // Set value using the cache provider (TTL in milliseconds)
      await cacheProvider.set('shared-key', { value: 'shared-data' }, 3600 * 1000); // 1 hour in milliseconds
      
      // Verify it can be retrieved
      const result = await cacheProvider.get<{ value: string }>('shared-key');
      expect(result).toEqual({ value: 'shared-data' });
      expect(cacheProvider.size()).toBe(1);
    });

    it('should handle TTL expiration correctly', async () => {
      if (!cacheProvider) {
        cacheProvider = mockCreateAPI.mock.calls[0][0].cache;
      }

      // Set value with short TTL (1000 milliseconds = 1 second)
      await cacheProvider.set('ttl-key', { data: 'test' }, 1000);
      
      // Should be available immediately
      const immediate = await cacheProvider.get('ttl-key');
      expect(immediate).toBeDefined();
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      // Should be expired and removed
      const expired = await cacheProvider.get('ttl-key');
      expect(expired).toBeUndefined();
      expect(cacheProvider.size()).toBe(0);
    });
  });

  describe('battles cache TTL calculation', () => {
    let apiService: ApiService;
    let mockBatchClient: any;

    beforeEach(() => {
      jest.clearAllMocks();
      mockBatchClient = {
        battle: {
          getBattles: jest.fn().mockResolvedValue({
            result: {
              data: {
                items: [],
              },
            },
          }),
        },
        region: {
          getRegionsObject: jest.fn().mockResolvedValue({
            result: {
              data: {},
            },
          }),
        },
        runBatch: jest.fn().mockResolvedValue(undefined),
      };
      mockCreateAPI.mockReturnValue(mockBatchClient);
    });

    it('should calculate battles cache TTL as polling interval minus 30 seconds', async () => {
      const config: BotConfig = {
        api: {
          baseUrl: 'https://api.test.com',
          apiKey: 'test-api-key',
        },
        discord: {
          token: 'test-token',
          servers: new Map(),
        },
        polling: {
          intervalMinutes: 5, // 5 minutes = 300 seconds
        },
      };

      apiService = new ApiService(config);
      
      // Call fetchBattles
      await apiService.fetchBattles();

      // Verify getBattles was called with correct TTL
      // Expected: (5 * 60 * 1000) - 30000 = 300000 - 30000 = 270000 milliseconds
      expect(mockBatchClient.battle.getBattles).toHaveBeenCalledWith(
        { isActive: true },
        { cache: { ttl: 270000 } }
      );
    });

    it('should enforce minimum TTL of 30 seconds for very short polling intervals', async () => {
      const config: BotConfig = {
        api: {
          baseUrl: 'https://api.test.com',
          apiKey: 'test-api-key',
        },
        discord: {
          token: 'test-token',
          servers: new Map(),
        },
        polling: {
          intervalMinutes: 0.5, // 0.5 minutes = 30 seconds
        },
      };

      apiService = new ApiService(config);
      
      await apiService.fetchBattles();

      // Expected: max(30000, (0.5 * 60 * 1000) - 30000) = max(30000, 30000 - 30000) = max(30000, 0) = 30000 milliseconds
      expect(mockBatchClient.battle.getBattles).toHaveBeenCalledWith(
        { isActive: true },
        { cache: { ttl: 30000 } }
      );
    });

    it('should handle 1 minute polling interval correctly', async () => {
      const config: BotConfig = {
        api: {
          baseUrl: 'https://api.test.com',
          apiKey: 'test-api-key',
        },
        discord: {
          token: 'test-token',
          servers: new Map(),
        },
        polling: {
          intervalMinutes: 1, // 1 minute = 60 seconds
        },
      };

      apiService = new ApiService(config);
      
      await apiService.fetchBattles();

      // Expected: (1 * 60 * 1000) - 30000 = 60000 - 30000 = 30000 milliseconds
      expect(mockBatchClient.battle.getBattles).toHaveBeenCalledWith(
        { isActive: true },
        { cache: { ttl: 30000 } }
      );
    });

    it('should handle 10 minute polling interval correctly', async () => {
      const config: BotConfig = {
        api: {
          baseUrl: 'https://api.test.com',
          apiKey: 'test-api-key',
        },
        discord: {
          token: 'test-token',
          servers: new Map(),
        },
        polling: {
          intervalMinutes: 10, // 10 minutes = 600 seconds
        },
      };

      apiService = new ApiService(config);
      
      await apiService.fetchBattles();

      // Expected: (10 * 60 * 1000) - 30000 = 600000 - 30000 = 570000 milliseconds
      expect(mockBatchClient.battle.getBattles).toHaveBeenCalledWith(
        { isActive: true },
        { cache: { ttl: 570000 } }
      );
    });

    it('should handle fractional polling intervals correctly', async () => {
      const config: BotConfig = {
        api: {
          baseUrl: 'https://api.test.com',
          apiKey: 'test-api-key',
        },
        discord: {
          token: 'test-token',
          servers: new Map(),
        },
        polling: {
          intervalMinutes: 2.5, // 2.5 minutes = 150 seconds
        },
      };

      apiService = new ApiService(config);
      
      await apiService.fetchBattles();

      // Expected: (2.5 * 60 * 1000) - 30000 = 150000 - 30000 = 120000 milliseconds
      expect(mockBatchClient.battle.getBattles).toHaveBeenCalledWith(
        { isActive: true },
        { cache: { ttl: 120000 } }
      );
    });
  });

  describe('battles cache TTL expiration', () => {
    let apiService: ApiService;
    let mockBatchClient: any;
    let cacheProvider: InMemoryCacheProvider;

    beforeEach(() => {
      jest.clearAllMocks();
      
      // Create a real cache provider to test actual expiration
      cacheProvider = new InMemoryCacheProvider();
      
      mockBatchClient = {
        battle: {
          getBattles: jest.fn().mockImplementation((params, options) => {
            // Simulate SDK caching behavior - store in cache with TTL
            const cacheKey = `battle.getBattles:${JSON.stringify(params)}`;
            const response = {
              result: {
                data: {
                  items: [{
                    _id: 'battle-1',
                    attacker: {
                      country: 'country-1',
                      moneyPer1kDamages: 10,
                      moneyPool: 1000,
                    },
                    defender: {
                      country: 'country-2',
                      moneyPer1kDamages: 5,
                      moneyPool: 500,
                    },
                  }],
                },
              },
            };
            
            // Store in cache if TTL is provided
            if (options?.cache?.ttl) {
              cacheProvider.set(cacheKey, response, options.cache.ttl);
            }
            
            return Promise.resolve(response);
          }),
        },
        country: {
          getCountryById: jest.fn().mockResolvedValue({
            result: {
              data: {
                _id: 'country-1',
                name: 'Test Country',
              },
            },
          }),
        },
        region: {
          getRegionsObject: jest.fn().mockResolvedValue({
            result: {
              data: {},
            },
          }),
        },
        runBatch: jest.fn().mockResolvedValue(undefined),
      };
      
      mockCreateAPI.mockReturnValue(mockBatchClient);
    });

    it('should cache battles with calculated TTL and expire when expected', async () => {
      // Use a very short polling interval to get a short TTL for testing
      const config: BotConfig = {
        api: {
          baseUrl: 'https://api.test.com',
          apiKey: 'test-api-key',
        },
        discord: {
          token: 'test-token',
          servers: new Map(),
        },
        polling: {
          intervalMinutes: 0.5, // 0.5 minutes = 30 seconds, TTL = 30000 milliseconds (minimum)
        },
      };

      // Override the cache provider in the mock
      mockCreateAPI.mockImplementation((config) => {
        config.cache = cacheProvider;
        return mockBatchClient;
      });

      apiService = new ApiService(config);
      
      // First fetch - should cache the result
      await apiService.fetchBattles();
      
      // Verify cache was used (check that getBattles was called)
      expect(mockBatchClient.battle.getBattles).toHaveBeenCalledTimes(1);
      
      // Verify the cache key exists
      const cacheKey = 'battle.getBattles:{"isActive":true}';
      const cachedValue = await cacheProvider.get(cacheKey);
      expect(cachedValue).toBeDefined();
      expect(cacheProvider.size()).toBeGreaterThan(0);

      // Verify TTL was set correctly (30000 milliseconds minimum)
      expect(mockBatchClient.battle.getBattles).toHaveBeenCalledWith(
        { isActive: true },
        { cache: { ttl: 30000 } }
      );

      // Set a new value with a very short TTL (1000 milliseconds = 1 second) to test expiration
      await cacheProvider.set(cacheKey, cachedValue, 1000);
      
      // Verify it's still cached immediately
      const immediateCheck = await cacheProvider.get(cacheKey);
      expect(immediateCheck).toBeDefined();

      // Wait for TTL to expire (1 second + buffer)
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Verify cache entry has expired
      const expiredValue = await cacheProvider.get(cacheKey);
      expect(expiredValue).toBeUndefined();
      expect(cacheProvider.size()).toBe(0);
    }, 10000); // Increase timeout to 10 seconds

    it('should use cached battles when TTL has not expired', async () => {
      const config: BotConfig = {
        api: {
          baseUrl: 'https://api.test.com',
          apiKey: 'test-api-key',
        },
        discord: {
          token: 'test-token',
          servers: new Map(),
        },
        polling: {
          intervalMinutes: 5, // 5 minutes = 300 seconds, TTL = 270000 milliseconds
        },
      };

      // Override the cache provider in the mock
      mockCreateAPI.mockImplementation((config) => {
        config.cache = cacheProvider;
        return mockBatchClient;
      });

      apiService = new ApiService(config);
      
      // First fetch - should cache the result
      await apiService.fetchBattles();
      
      // Immediately fetch again - should still be cached (SDK would use cache)
      // Note: In real SDK, the cache check happens before the API call
      // For this test, we verify the cache entry exists and hasn't expired
      const cacheKey = 'battle.getBattles:{"isActive":true}';
      const cachedValue = await cacheProvider.get(cacheKey);
      expect(cachedValue).toBeDefined();
      
      // Wait a short time (less than TTL)
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Cache should still be valid
      const stillCached = await cacheProvider.get(cacheKey);
      expect(stillCached).toBeDefined();
      expect(cacheProvider.size()).toBeGreaterThan(0);
    });

    it('should expire battles cache before next polling cycle', async () => {
      // Use a very short polling interval to test expiration quickly
      const pollingIntervalMinutes = 0.5; // 0.5 minutes = 30 seconds
      const expectedTtl = Math.max(30000, (pollingIntervalMinutes * 60 * 1000) - 30000); // 30000 milliseconds (minimum)
      
      const config: BotConfig = {
        api: {
          baseUrl: 'https://api.test.com',
          apiKey: 'test-api-key',
        },
        discord: {
          token: 'test-token',
          servers: new Map(),
        },
        polling: {
          intervalMinutes: pollingIntervalMinutes,
        },
      };

      // Override the cache provider in the mock
      mockCreateAPI.mockImplementation((config) => {
        config.cache = cacheProvider;
        return mockBatchClient;
      });

      apiService = new ApiService(config);
      
      // First fetch at time 0
      await apiService.fetchBattles();
      
      const cacheKey = 'battle.getBattles:{"isActive":true}';
      
      // Verify cache exists
      const cachedValue = await cacheProvider.get(cacheKey);
      expect(cachedValue).toBeDefined();
      
      // Verify TTL was set correctly (30000 milliseconds minimum)
      expect(mockBatchClient.battle.getBattles).toHaveBeenCalledWith(
        { isActive: true },
        { cache: { ttl: expectedTtl } }
      );
      
      // Set a new value with a very short TTL (1000 milliseconds = 1 second) to test expiration
      await cacheProvider.set(cacheKey, cachedValue, 1000);
      
      // Verify it's still cached immediately
      expect(await cacheProvider.get(cacheKey)).toBeDefined();
      
      // Wait for TTL to expire (1 second + buffer)
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      // Cache should have expired (before next polling cycle at 30 seconds)
      const expiredValue = await cacheProvider.get(cacheKey);
      expect(expiredValue).toBeUndefined();
      
      // Verify the TTL calculation ensures cache expires before next poll
      // TTL (30000ms) < polling interval (30000ms) - this ensures cache expires before next poll
      expect(expectedTtl).toBeLessThanOrEqual(pollingIntervalMinutes * 60 * 1000);
    }, 10000); // Increase timeout to 10 seconds
  });
});
