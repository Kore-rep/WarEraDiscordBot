import { createAPI, APIClient } from 'warera-sdk';
import { logger } from '../../utils/logger';
import { BotConfig } from '../../config/config';
import { ServerConfigManager } from '../../utils/serverConfigManager';

// Infer types from SDK method return types
type GetBattlesResponse = Awaited<ReturnType<APIClient['battle']['getBattles']>>;
type BattleDTO = GetBattlesResponse['result']['data']['items'][number];
type GetCountryByIdResponse = Awaited<ReturnType<APIClient['country']['getCountryById']>>;
type CountryDTO = GetCountryByIdResponse['result']['data'];
type GetRegionsObjectResponse = Awaited<ReturnType<APIClient['region']['getRegionsObject']>>;
type RegionDTO = GetRegionsObjectResponse['result']['data'][string];

/**
 * Service for handling API requests using the WarEra SDK
 * Handles battles.getBattles endpoint calls and response processing
 */
export class ApiService {
  private client: APIClient;
  private config: BotConfig;
  private batchClient: APIClient;

  constructor(config: BotConfig) {
    this.config = config;
    
    // Initialize the SDK client
    // You can customize the config based on your needs
    this.client = createAPI({
      baseUrl: config.api.baseUrl,
      // Add other config options as needed:
      // cache: { ... },
      // rateLimit: { ... },
      // batch: false,
    });
    this.batchClient = createAPI({
        baseUrl: this.config.api.baseUrl,
        batch: true, // Enable batch mode
      });

    logger.info('API Service initialized');
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
      logger.debug(`Fetching country information for ${countryIds.length} country/countries...`);

      // Remove duplicates
      const uniqueCountryIds = [...new Set(countryIds)];

      // Queue all country requests (they return promises that resolve when batch executes)
      const countryPromises = uniqueCountryIds.map((countryId) => {
        return this.batchClient.country.getCountryById(countryId, {cache: {ttl: 86400 }});
      });

      // Execute all queued batch requests at once
      // This will resolve all the promises above
      await this.batchClient.runBatch();

      // Wait for all promises to resolve and map results
      const results = await Promise.all(countryPromises);

      // Map results to country data
      for (let i = 0; i < uniqueCountryIds.length; i++) {
        const countryId = uniqueCountryIds[i];
        const result = results[i] as GetCountryByIdResponse | undefined;
        
        if (result && result.result && result.result.data) {
          countryMap.set(countryId, result.result.data);
        } else {
          logger.warn(`Failed to fetch country ${countryId} - result was invalid`);
        }
      }

      logger.info(`Fetched ${countryMap.size} country/countries out of ${uniqueCountryIds.length} requested`);
      return countryMap;
    } catch (error) {
      logger.error('Failed to fetch countries from API', error);
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
      logger.debug('Fetching regions object from API...');
      
      const response: GetRegionsObjectResponse = await this.client.region.getRegionsObject({cache: {ttl: 86400 }});
      const regionsData = response.result.data;
      
      // Convert Record<string, RegionDTO> to Map
      for (const [regionId, region] of Object.entries(regionsData)) {
        regionMap.set(regionId, region);
      }
      
      logger.info(`Fetched ${regionMap.size} region(s) from API`);
      return regionMap;
    } catch (error) {
      logger.error('Failed to fetch regions from API', error);
      throw error;
    }
  }

  /**
   * Fetch battles data from the API using the battles.getBattles endpoint
   * Filters results client-side where moneyPer1kDamages > 0 and moneyPool > 0
   * Also fetches country and region information for all countries/regions in the battles
   * 
   * @returns Promise with filtered battles array, country map, and regions map
   */
  async fetchBattles(): Promise<{ battles: BattleDTO[]; countries: Map<string, CountryDTO>; regions: Map<string, RegionDTO> }> {
    try {
      logger.debug('Fetching active battles from API...');

      // Call the battles.getBattles endpoint with isActive: true
      const response: GetBattlesResponse = await this.client.battle.getBattles({
        isActive: true,
      });

      const allBattles = response.result.data.items;
      logger.debug(`Fetched ${allBattles.length} active battle(s) from API`);

      // Filter battles where moneyPer1kDamages > 0 and moneyPool > 0
      // Check both attacker and defender sides
      const filteredBattles = allBattles.filter((battle) => {
        const attackerHasRewards =
          (battle.attacker.moneyPer1kDamages ?? 0) > 0 &&
          (battle.attacker.moneyPool ?? 0) > 0;
        
        const defenderHasRewards =
          (battle.defender.moneyPer1kDamages ?? 0) > 0 &&
          (battle.defender.moneyPool ?? 0) > 0;

        return attackerHasRewards || defenderHasRewards;
      });

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
      
      // Fetch regions information (expensive call, but needed for region names)
      const regions = await this.fetchRegions();
      
      return { battles: filteredBattles, countries, regions };
    } catch (error) {
      logger.error('Failed to fetch battles from API', error);
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
    logger.debug(`Processing ${battles.length} battle(s) to extract role IDs per server`);
    
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
}

