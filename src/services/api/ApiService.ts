import { createAPI, APIClient } from 'warera-sdk';
import type {
  BattleDTO,
  CountryDTO,
  RegionDTO,
  MercenaryContractAuctionDTO,
  GetBattlesResponse,
  GetCountryByIdResponse,
  GetPaginatedAuctionsParams,
  GetPaginatedAuctionsResponse,
  RegionGetRegionsObjectResponse as GetRegionsObjectResponse,
} from 'warera-sdk';
import { logger } from '../../utils/logger';
import { BotConfig } from '../../config/config';
import { ServerConfigManager } from '../../utils/serverConfigManager';
import { InMemoryCacheProvider } from './InMemoryCacheProvider';
import { SharedRateLimiter } from './SharedRateLimiter';

/** Page size for `battle.getBattles` cursor pagination (matches typical API max page size). */
const BATTLES_PAGE_SIZE = 100;

/** Page size for `mercenaryContractAuction.getPaginatedAuctions` cursor pagination. */
const MERCENARY_CONTRACT_PAGE_SIZE = 50;

export interface BattlePollData {
  battles: BattleDTO[];
  countries: Map<string, CountryDTO>;
  regions: Map<string, RegionDTO>;
}

/**
 * Service for handling API requests using the WarEra SDK
 * Handles battles.getBattles endpoint calls and response processing
 */
export class ApiService {
  private client: APIClient;
  private config: BotConfig;
  private batchClient: APIClient; // For battle polling operations
  private cacheProvider: InMemoryCacheProvider;
  private sharedRateLimiter: SharedRateLimiter;
  private proxyTrackingService?: any; // Will be set after initialization
  private leaderboardService?: import('../leaderboard/LeaderboardService').LeaderboardService;
  private muDirectoryService?: import('../muDirectory/MuDirectoryService').MuDirectoryService;
  private autoroleService?: import('../autorole/AutoroleService').AutoroleService;

  constructor(config: BotConfig) {
    this.config = config;

    // Create a shared cache provider instance for all clients
    this.cacheProvider = new InMemoryCacheProvider();

    // Create a shared rate limiter that will be used by all clients
    // This ensures consistent rate limit tracking across all API clients
    this.sharedRateLimiter = new SharedRateLimiter({
      maxRequests: 300,
      windowMs: 60000,
      backoffThreshold: 0.8,
      maxBackoffMs: 3000,
    });

    // Initialize the SDK client with shared rate limiter
    this.client = createAPI({
      baseUrl: config.api.baseUrl,
      apiKey: config.api.apiKey,
      rateLimiter: this.sharedRateLimiter, // Use shared rate limiter
      cache: this.cacheProvider,
    });
    
    // Initialize batch client for battle polling
    // Each createAPI() call creates a NEW RequestContext instance with its own isolated queue
    // This client will have its own separate queue, preventing conflicts with commands
    this.batchClient = createAPI({
      baseUrl: this.config.api.baseUrl,
      apiKey: this.config.api.apiKey,
      batch: true, // Enable batch mode
      rateLimiter: this.sharedRateLimiter, // Shared rate limiter (shared tracking across all clients)
      cache: this.cacheProvider, // Shared cache (shared data across all clients)
    });

    // Note: We don't create a single commandBatchClient here because each command
    // needs its own isolated batch client instance to prevent conflicts when
    // multiple commands run concurrently. Use createCommandBatchClient() instead.

    logger.info("API Service initialized with shared rate limiter");
  }

  /**
   * Filter battles to those with active bounty rewards on either side
   */
  filterBattlesWithBountyRewards(battles: BattleDTO[]): BattleDTO[] {
    return battles.filter((battle) => {
      const attackerHasRewards =
        (battle.attacker.moneyPer1kDamages ?? 0) > 0 &&
        (battle.attacker.moneyPool ?? 0) > 0;

      const defenderHasRewards =
        (battle.defender.moneyPer1kDamages ?? 0) > 0 &&
        (battle.defender.moneyPool ?? 0) > 0;

      return attackerHasRewards || defenderHasRewards;
    });
  }

  /**
   * Fetch ALL open mercenary contract auctions in a single paginated sweep.
   *
   * Omitting `battleId` returns every contract across all battles, so we follow
   * `nextCursor` through the pages instead of issuing one request per battle.
   * Pagination is cursor-dependent (each page needs the previous page's cursor),
   * so it can't be batched — use the non-batched client.
   */
  async fetchAllMercenaryContracts(): Promise<MercenaryContractAuctionDTO[]> {
    const allContracts: MercenaryContractAuctionDTO[] = [];
    let nextCursor: string | undefined;
    let pageCount = 0;

    try {
      logger.debug("Fetching all mercenary contract auctions from API...");

      do {
        const params: GetPaginatedAuctionsParams = {
          limit: MERCENARY_CONTRACT_PAGE_SIZE,
        };
        if (nextCursor) {
          params.cursor = nextCursor;
        }

        const response = (await this.client.mercenaryContractAuction.getPaginatedAuctions(
          params
        )) as GetPaginatedAuctionsResponse;

        const data = response?.result?.data;
        if (data?.items) {
          allContracts.push(...data.items);
        }
        nextCursor = data?.nextCursor;
        pageCount++;
      } while (nextCursor);

      logger.info(
        `Fetched ${allContracts.length} mercenary contract auction(s) across ${pageCount} page(s)`
      );
      return allContracts;
    } catch (error) {
      const rateLimitStatus = this.client.getRateLimitStatus();
      if (rateLimitStatus) {
        logger.error(
          `Failed to fetch mercenary contracts. Rate limit status: ${rateLimitStatus.requestCount}/${rateLimitStatus.maxRequests} requests (${rateLimitStatus.usagePercent}% usage), at limit: ${rateLimitStatus.isAtLimit}, backoff: ${rateLimitStatus.currentBackoffMs}ms`,
          error
        );
      } else {
        logger.error("Failed to fetch mercenary contracts", error);
      }
      throw error;
    }
  }

  /**
   * Fetch country information for given country IDs using batch requests
   *
   * @param countryIds - Array of country IDs to fetch
   * @returns Map of countryId -> CountryDTO
   */
  async fetchCountries(countryIds: string[]): Promise<Map<string, CountryDTO>> {
    const countryMap = new Map<string, CountryDTO>();

    if (countryIds.length === 0) {
      return countryMap;
    }

    try {
      logger.debug(
        `Fetching country information for ${countryIds.length} country/countries...`
      );

      // Log rate limit status before making requests
      const rateLimitStatusBefore = this.batchClient.getRateLimitStatus();
      if (rateLimitStatusBefore) {
        logger.debug(
          `Rate limit status (before): ${rateLimitStatusBefore.requestCount}/${rateLimitStatusBefore.maxRequests} requests (${rateLimitStatusBefore.usagePercent}% usage), at limit: ${rateLimitStatusBefore.isAtLimit}, backoff: ${rateLimitStatusBefore.currentBackoffMs}ms`
        );
      }

      // Remove duplicates
      const uniqueCountryIds = [...new Set(countryIds)];

      // Queue all country requests (they return promises that resolve when batch executes)
      // Note: SDK expects TTL in milliseconds for batch mode
      const countryPromises = uniqueCountryIds.map((countryId) => {
        return this.batchClient.country.getCountryById(countryId, {
          cache: { ttl: 86400 * 1000 }, // 24 hours in milliseconds
        });
      });

      // Execute all queued batch requests at once
      // This will resolve all the promises above
      await this.batchClient.runBatch();

      // Log rate limit status after making requests
      const rateLimitStatusAfter = this.batchClient.getRateLimitStatus();
      if (rateLimitStatusAfter) {
        logger.debug(
          `Rate limit status (after): ${rateLimitStatusAfter.requestCount}/${rateLimitStatusAfter.maxRequests} requests (${rateLimitStatusAfter.usagePercent}% usage), at limit: ${rateLimitStatusAfter.isAtLimit}, backoff: ${rateLimitStatusAfter.currentBackoffMs}ms`
        );
      }

      // Wait for all promises to resolve and map results
      const results = await Promise.all(countryPromises);

      // Map results to country data
      for (let i = 0; i < uniqueCountryIds.length; i++) {
        const countryId = uniqueCountryIds[i];
        const result = results[i] as GetCountryByIdResponse | undefined;

        if (result && result.result && result.result.data) {
          countryMap.set(countryId, result.result.data);
        } else {
          logger.warn(
            `Failed to fetch country ${countryId} - result was invalid`
          );
        }
      }

      logger.info(
        `Fetched ${countryMap.size} country/countries out of ${uniqueCountryIds.length} requested`
      );
      return countryMap;
    } catch (error) {
      // Log error with rate limit status
      const rateLimitStatus = this.batchClient.getRateLimitStatus();
      if (rateLimitStatus) {
        logger.error(
          `Failed to fetch countries from API. Rate limit status: ${rateLimitStatus.requestCount}/${rateLimitStatus.maxRequests} requests (${rateLimitStatus.usagePercent}% usage), at limit: ${rateLimitStatus.isAtLimit}, backoff: ${rateLimitStatus.currentBackoffMs}ms`,
          error
        );
      } else {
        logger.error("Failed to fetch countries from API", error);
      }
      throw error;
    }
  }

  /**
   * Fetch regions data from the API using the region.getRegionsObject endpoint
   * Note: This endpoint is expensive, so it should be called sparingly
   *
   * @returns Promise with regions map (regionId -> RegionDTO)
   */
  async fetchRegions(): Promise<Map<string, RegionDTO>> {
    const regionMap = new Map<string, RegionDTO>();

    try {
      logger.debug("Fetching regions object from API...");

      // Log rate limit status before making request
      const rateLimitStatusBefore = this.client.getRateLimitStatus();
      if (rateLimitStatusBefore) {
        logger.debug(
          `Rate limit status (before): ${rateLimitStatusBefore.requestCount}/${rateLimitStatusBefore.maxRequests} requests (${rateLimitStatusBefore.usagePercent}% usage), at limit: ${rateLimitStatusBefore.isAtLimit}, backoff: ${rateLimitStatusBefore.currentBackoffMs}ms`
        );
      }

      // Note: SDK expects TTL in milliseconds
      const response: GetRegionsObjectResponse =
        await this.client.region.getRegionsObject({ cache: { ttl: 86400 * 1000 } }); // 24 hours in milliseconds

      // Log rate limit status after making request
      const rateLimitStatusAfter = this.client.getRateLimitStatus();
      if (rateLimitStatusAfter) {
        logger.debug(
          `Rate limit status (after): ${rateLimitStatusAfter.requestCount}/${rateLimitStatusAfter.maxRequests} requests (${rateLimitStatusAfter.usagePercent}% usage), at limit: ${rateLimitStatusAfter.isAtLimit}, backoff: ${rateLimitStatusAfter.currentBackoffMs}ms`
        );
      }
      const regionsData = response.result.data;

      // Convert Record<string, RegionDTO> to Map
      for (const [regionId, region] of Object.entries(regionsData)) {
        regionMap.set(regionId, region);
      }

      logger.info(`Fetched ${regionMap.size} region(s) from API`);
      return regionMap;
    } catch (error) {
      // Log error with rate limit status
      const rateLimitStatus = this.client.getRateLimitStatus();
      if (rateLimitStatus) {
        logger.error(
          `Failed to fetch regions from API. Rate limit status: ${rateLimitStatus.requestCount}/${rateLimitStatus.maxRequests} requests (${rateLimitStatus.usagePercent}% usage), at limit: ${rateLimitStatus.isAtLimit}, backoff: ${rateLimitStatus.currentBackoffMs}ms`,
          error
        );
      } else {
        logger.error("Failed to fetch regions from API", error);
      }
      throw error;
    }
  }

  /**
   * Fetch battles with bounty rewards from the API (for bounty tracking).
   * Follows `nextCursor` until all pages are loaded.
   * Filters results client-side where moneyPer1kDamages > 0 and moneyPool > 0
   * Also fetches country and region information for all countries/regions in the battles
   * 
   * Note: For mercenary contracts that should check ALL battles regardless of bounties,
   * use fetchAllBattles() instead.
   *
   * @returns Promise with filtered battles array, country map, and regions map
   */
  async fetchBattles(): Promise<{
    battles: BattleDTO[];
    countries: Map<string, CountryDTO>;
    regions: Map<string, RegionDTO>;
  }> {
    try {
      logger.debug("Fetching active battles from API...");

      // Log rate limit status before making requests
      const rateLimitStatusBefore = this.batchClient.getRateLimitStatus();
      if (rateLimitStatusBefore) {
        logger.debug(
          `Rate limit status (before): ${rateLimitStatusBefore.requestCount}/${rateLimitStatusBefore.maxRequests} requests (${rateLimitStatusBefore.usagePercent}% usage), at limit: ${rateLimitStatusBefore.isAtLimit}, backoff: ${rateLimitStatusBefore.currentBackoffMs}ms`
        );
      }

      // Calculate cache TTL for battles: slightly less than polling interval to ensure
      // cache expires just before the next poll. Convert minutes to milliseconds and subtract 30 seconds buffer.
      // SDK expects TTL in milliseconds and now respects custom TTL in batch mode
      const pollingIntervalMs = this.config.polling.intervalMinutes * 60 * 1000;
      const battlesCacheTtl = Math.max(30000, pollingIntervalMs - 30000); // Minimum 30 seconds (30000ms)

      const allBattles: BattleDTO[] = [];
      let nextCursor: string | undefined;
      let regionsResponse: GetRegionsObjectResponse | undefined;
      let pageCount = 0;

      do {
        const params: { isActive: true; limit: number; cursor?: string } = {
          isActive: true,
          limit: BATTLES_PAGE_SIZE,
        };
        if (nextCursor) {
          params.cursor = nextCursor;
        }

        const battlesPromise = this.batchClient.battle.getBattles(params, {
          cache: { ttl: battlesCacheTtl },
        });

        if (!nextCursor) {
          // First page only: batch getBattles with getRegionsObject (one rate-limit unit)
          const regionsPromise = this.batchClient.region.getRegionsObject({
            cache: { ttl: 86400 * 1000 },
          }); // 24 hours in milliseconds
          await this.batchClient.runBatch();
          const [battlesRes, regionsRes] = (await Promise.all([
            battlesPromise,
            regionsPromise,
          ])) as [GetBattlesResponse, GetRegionsObjectResponse];
          regionsResponse = regionsRes;
          allBattles.push(...battlesRes.result.data.items);
          nextCursor = battlesRes.result.data.nextCursor;
        } else {
          await this.batchClient.runBatch();
          const battlesRes = (await battlesPromise) as GetBattlesResponse;
          allBattles.push(...battlesRes.result.data.items);
          nextCursor = battlesRes.result.data.nextCursor;
        }
        pageCount++;
      } while (nextCursor);

      // Log rate limit status after making requests
      const rateLimitStatusAfter = this.batchClient.getRateLimitStatus();
      if (rateLimitStatusAfter) {
        logger.debug(
          `Rate limit status (after): ${rateLimitStatusAfter.requestCount}/${rateLimitStatusAfter.maxRequests} requests (${rateLimitStatusAfter.usagePercent}% usage), at limit: ${rateLimitStatusAfter.isAtLimit}, backoff: ${rateLimitStatusAfter.currentBackoffMs}ms`
        );
      }

      logger.debug(
        `Fetched ${allBattles.length} active battle(s) from API across ${pageCount} page(s)`
      );

      // Filter battles where moneyPer1kDamages > 0 and moneyPool > 0
      const filteredBattles = this.filterBattlesWithBountyRewards(allBattles);

      logger.info(
        `Filtered to ${filteredBattles.length} battle(s) with rewards (out of ${allBattles.length} total)`
      );

      // Extract unique country IDs from filtered battles
      const countryIds = new Set<string>();
      for (const battle of filteredBattles) {
        if (battle.attacker.country) {
          countryIds.add(battle.attacker.country);
        }
        if (battle.defender.country) {
          countryIds.add(battle.defender.country);
        }
      }

      // Fetch country information using batch requests
      const countries = await this.fetchCountries(Array.from(countryIds));

      // Process regions response (fetched with first battles page only)
      const regionsData = regionsResponse!.result.data;
      const regions = new Map<string, RegionDTO>();
      for (const [regionId, region] of Object.entries(regionsData)) {
        regions.set(regionId, region);
      }
      logger.info(`Fetched ${regions.size} region(s) from API`);

      return { battles: filteredBattles, countries, regions };
    } catch (error) {
      // Log error with rate limit status
      const rateLimitStatus = this.batchClient.getRateLimitStatus();
      if (rateLimitStatus) {
        logger.error(
          `Failed to fetch battles from API. Rate limit status: ${rateLimitStatus.requestCount}/${rateLimitStatus.maxRequests} requests (${rateLimitStatus.usagePercent}% usage), at limit: ${rateLimitStatus.isAtLimit}, backoff: ${rateLimitStatus.currentBackoffMs}ms`,
          error
        );
      } else {
        logger.error("Failed to fetch battles from API", error);
      }
      throw error;
    }
  }

  /**
   * Process battles response to extract role IDs per server that should be mentioned
   *
   * @param battles - The filtered battles array from the API
   * @returns Map of serverId -> roleIds to mention
   */
  extractRoleIdsByServer(battles: BattleDTO[]): Map<string, string[]> {
    logger.debug(
      `Processing ${battles.length} battle(s) to extract role IDs per server`
    );

    const roleIdsByServer = new Map<string, string[]>();

    // Read current server configurations from ServerConfigManager to get latest config
    const servers = ServerConfigManager.readServerConfigs();

    // Iterate over all configured servers
    // Include all servers that have battles to report, even if they have no role IDs configured
    for (const [serverId, serverConfig] of servers.entries()) {
      // TODO: Implement logic to extract role IDs from battles for this specific server
      // This is a placeholder that returns the configured role IDs for each server
      // You should parse the battles array and extract relevant role IDs based on:
      // - Battle data (country, region, etc.)
      // - Server configuration mapping
      // Example:
      //   const relevantBattles = battles.filter(battle =>
      //     battle.attacker.country === serverConfig.countryId ||
      //     battle.defender.country === serverConfig.countryId
      //   );
      //   if (relevantBattles.length > 0) {
      //     roleIdsByServer.set(serverId, serverConfig.roleIds);
      //   }

      // For now, return configured role IDs for all servers (including empty arrays)
      // This means all servers will get notifications if there are any battles
      // Messages will be sent without mentions if roleIds is empty
      // Replace with actual logic based on your battle data structure
      if (battles.length > 0 && serverConfig.bountyBattles) {
        roleIdsByServer.set(serverId, serverConfig.bountyBattles.roleIds || []);
      }
    }

    return roleIdsByServer;
  }

  /**
   * Get the API client instance (useful for direct SDK access)
   */
  getClient(): APIClient {
    return this.client;
  }

  /**
   * The configured tRPC base URL (for the rare raw request the SDK can't make)
   */
  getApiBaseUrl(): string | undefined {
    return this.config.api.baseUrl;
  }


  /**
   * Get the batch-enabled API client for battle polling operations
   * This client has its own isolated queue to prevent conflicts with commands
   * 
   * @returns The APIClient with batch mode enabled for battle polling
   */
  getBatchClient(): APIClient {
    return this.batchClient;
  }

  /**
   * Create a new batch-enabled API client for command operations
   * Each command should call this to get its own isolated batch client instance
   * This prevents conflicts when multiple commands run concurrently
   * 
   * Each call creates a NEW instance with its own isolated queue, so commands
   * don't interfere with each other or with battle polling.
   * 
   * @returns A new APIClient with batch mode enabled for commands
   */
  createCommandBatchClient(): APIClient {
    return createAPI({
      baseUrl: this.config.api.baseUrl,
      apiKey: this.config.api.apiKey,
      batch: true, // Enable batch mode
      rateLimiter: this.sharedRateLimiter, // Shared rate limiter (shared tracking across all clients)
      cache: this.cacheProvider, // Shared cache (shared data across all clients)
    });
  }

  /**
   * Fetch ALL active battles without any filtering (for mercenary contracts)
   * Unlike fetchBattles(), this method doesn't filter by bounty rewards
   * @returns Promise resolving to all active battles and country data
   */
  async fetchAllBattles(): Promise<BattlePollData> {
    try {
      logger.debug("Fetching ALL active battles from API (unfiltered)...");

      // Log rate limit status before making requests
      const rateLimitStatusBefore = this.batchClient.getRateLimitStatus();
      if (rateLimitStatusBefore) {
        logger.debug(
          `Rate limit status (before): ${rateLimitStatusBefore.requestCount}/${rateLimitStatusBefore.maxRequests} requests (${rateLimitStatusBefore.usagePercent}% usage), at limit: ${rateLimitStatusBefore.isAtLimit}, backoff: ${rateLimitStatusBefore.currentBackoffMs}ms`
        );
      }

      // Calculate cache TTL for battles
      const pollingIntervalMs = this.config.polling.intervalMinutes * 60 * 1000;
      const battlesCacheTtl = Math.max(30000, pollingIntervalMs - 30000); // Minimum 30 seconds

      const allBattles: BattleDTO[] = [];
      let nextCursor: string | undefined;
      let regionsResponse: GetRegionsObjectResponse | undefined;
      let pageCount = 0;

      do {
        const params: { isActive: true; limit: number; cursor?: string } = {
          isActive: true,
          limit: BATTLES_PAGE_SIZE,
        };
        if (nextCursor) {
          params.cursor = nextCursor;
        }

        const battlesPromise = this.batchClient.battle.getBattles(params, {
          cache: { ttl: battlesCacheTtl },
        });

        if (!nextCursor) {
          // First page only: batch getBattles with getRegionsObject
          const regionsPromise = this.batchClient.region.getRegionsObject({
            cache: { ttl: 86400 * 1000 },
          }); // 24 hours in milliseconds
          await this.batchClient.runBatch();
          const [battlesRes, regionsRes] = (await Promise.all([
            battlesPromise,
            regionsPromise,
          ])) as [GetBattlesResponse, GetRegionsObjectResponse];
          regionsResponse = regionsRes;
          allBattles.push(...battlesRes.result.data.items);
          nextCursor = battlesRes.result.data.nextCursor;
        } else {
          await this.batchClient.runBatch();
          const battlesRes = (await battlesPromise) as GetBattlesResponse;
          allBattles.push(...battlesRes.result.data.items);
          nextCursor = battlesRes.result.data.nextCursor;
        }
        pageCount++;
      } while (nextCursor);

      logger.debug(
        `Fetched ${allBattles.length} active battle(s) from API across ${pageCount} page(s) (unfiltered)`
      );

      // Extract unique country IDs from ALL battles (no filtering)
      const countryIds = new Set<string>();
      for (const battle of allBattles) {
        if (battle.attacker.country) {
          countryIds.add(battle.attacker.country);
        }
        if (battle.defender.country) {
          countryIds.add(battle.defender.country);
        }
      }

      // Fetch country information using batch requests
      const countryMap = await this.fetchCountries(Array.from(countryIds));

      // Process regions data
      const regionsMap = new Map<string, RegionDTO>();
      if (regionsResponse?.result?.data) {
        for (const [regionId, regionData] of Object.entries(regionsResponse.result.data)) {
          regionsMap.set(regionId, regionData);
        }
      }

      logger.info(`Returning ${allBattles.length} unfiltered battle(s) and ${countryMap.size} country/countries`);

      return {
        battles: allBattles,
        countries: countryMap,
        regions: regionsMap,
      };
    } catch (error) {
      logger.error("Failed to fetch all battles", error);
      throw error;
    }
  }

  /**
   * Get the shared rate limiter instance
   * Useful for monitoring rate limit status across all clients
   * 
   * @returns The shared rate limiter instance
   */
  getSharedRateLimiter(): SharedRateLimiter {
    return this.sharedRateLimiter;
  }

  /**
   * Set the ProxyTrackingService instance (called after initialization to avoid circular dependency)
   */
  setProxyTrackingService(service: any): void {
    this.proxyTrackingService = service;
  }

  /**
   * Get the ProxyTrackingService instance
   */
  getProxyTrackingService(): any | undefined {
    return this.proxyTrackingService;
  }

  /**
   * Set the LeaderboardService instance (called after initialization to avoid circular dependency)
   */
  setLeaderboardService(service: import('../leaderboard/LeaderboardService').LeaderboardService): void {
    this.leaderboardService = service;
  }

  /**
   * Get the LeaderboardService instance
   */
  getLeaderboardService(): import('../leaderboard/LeaderboardService').LeaderboardService | undefined {
    return this.leaderboardService;
  }

  /**
   * Set the MuDirectoryService instance (called after initialization to avoid circular dependency)
   */
  setMuDirectoryService(service: import('../muDirectory/MuDirectoryService').MuDirectoryService): void {
    this.muDirectoryService = service;
  }

  /**
   * Get the MuDirectoryService instance
   */
  getMuDirectoryService(): import('../muDirectory/MuDirectoryService').MuDirectoryService | undefined {
    return this.muDirectoryService;
  }

  /**
   * Set the AutoroleService instance (called after initialization to avoid circular dependency)
   */
  setAutoroleService(service: import('../autorole/AutoroleService').AutoroleService): void {
    this.autoroleService = service;
  }

  /**
   * Get the AutoroleService instance
   */
  getAutoroleService(): import('../autorole/AutoroleService').AutoroleService | undefined {
    return this.autoroleService;
  }
}
