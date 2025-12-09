import { createAPI, APIClient } from 'warera-sdk';
import { logger } from '../utils/logger';
import { BotConfig } from '../config';

// Infer types from SDK method return types
type GetBattlesResponse = Awaited<ReturnType<APIClient['battle']['getBattles']>>;
type BattleDTO = GetBattlesResponse['result']['data']['items'][number];

/**
 * Service for handling API requests using the WarEra SDK
 * Handles battles.getBattles endpoint calls and response processing
 */
export class ApiService {
  private client: APIClient;
  private config: BotConfig;

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

    logger.info('API Service initialized');
  }

  /**
   * Fetch battles data from the API using the battles.getBattles endpoint
   * Filters results client-side where moneyPer1kDamages > 0 and moneyPool > 0
   * 
   * @returns Promise with filtered battles array
   */
  async fetchBattles(): Promise<BattleDTO[]> {
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
      
      return filteredBattles;
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
    
    // Iterate over all configured servers
    for (const [serverId, serverConfig] of this.config.discord.servers.entries()) {
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
      
      // For now, return configured role IDs for all servers
      // This means all servers will get mentioned if there are any battles
      // Replace with actual logic based on your battle data structure
      if (battles.length > 0 && serverConfig.roleIds.length > 0) {
        roleIdsByServer.set(serverId, serverConfig.roleIds);
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

