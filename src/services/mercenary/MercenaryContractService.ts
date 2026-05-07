import { logger } from '../../utils/logger';
import { MercenaryContractTracker, NewMercenaryContract } from './MercenaryContractTracker';
import { MercenaryContractFormatter } from './MercenaryContractFormatter';
import { DiscordService } from '../discord/DiscordService';
import { ApiService } from '../api/ApiService';
import { ServerConfigManager } from '../../utils/serverConfigManager';

// Infer types from SDK method return types
type GetPaginatedAuctionsResponse = Awaited<ReturnType<import('../api/WarEraApiClient').APIClient['mercenaryContractAuction']['getPaginatedAuctions']>>;
type MercenaryContractAuctionDTO = GetPaginatedAuctionsResponse['result']['data']['items'][number];
type GetBattlesResponse = Awaited<ReturnType<import('../api/WarEraApiClient').APIClient['battle']['getBattles']>>;
type BattleDTO = GetBattlesResponse['result']['data']['items'][number];

/**
 * Service that handles mercenary contract auction tracking and notifications
 * Fetches contract auctions for active battles and sends fire-and-forget alerts for new contracts
 */
export class MercenaryContractService {
  private contractTracker: MercenaryContractTracker;
  private discordService: DiscordService;
  private apiService: ApiService;

  constructor(
    discordService: DiscordService,
    apiService: ApiService
  ) {
    this.discordService = discordService;
    this.apiService = apiService;
    this.contractTracker = new MercenaryContractTracker();
  }

  /**
   * Process mercenary contract auctions - detect new contracts and send fire-and-forget alerts
   * @param battles Optional battles from the API. If not provided, will fetch them internally.
   */
  async processContracts(battles?: BattleDTO[]): Promise<void> {
    try {
      logger.debug('Processing mercenary contract auctions for new contracts...');

      // Fetch battles if not provided
      let currentBattles: BattleDTO[];
      if (battles) {
        currentBattles = battles;
      } else {
        // Use fetchAllBattles to get ALL battles, not just those with bounties
        const { battles: fetchedBattles } = await this.apiService.fetchAllBattles();
        currentBattles = fetchedBattles;
      }

      if (currentBattles.length === 0) {
        logger.debug('No battles available, skipping mercenary contract processing');
        return;
      }

      // Fetch mercenary contract auctions for all active battles
      const allContracts = await this.fetchContractsForBattles(currentBattles);
      logger.debug(`Fetched ${allContracts.length} mercenary contract auction(s) from API`);

      // Detect new contracts that haven't been alerted for yet
      const newContracts = this.contractTracker.detectNewContracts(allContracts);

      if (newContracts.length === 0) {
        logger.debug(`No new mercenary contracts detected. Total alerted contracts: ${this.contractTracker.getAlertedContractsCount()}`);
        return;
      }

      logger.info(`Detected ${newContracts.length} new mercenary contract(s) to alert for`);

      // Fetch country data for formatting
      const { countries } = await this.apiService.fetchAllBattles();

      // Send alerts for each new contract across all configured servers
      await this.sendContractAlerts(newContracts, countries);

      // Cleanup old tracking data periodically
      this.contractTracker.cleanup();

      logger.debug('Mercenary contract processing completed successfully');
    } catch (error) {
      logger.error('Failed to process mercenary contracts', error);
      throw error;
    }
  }

  /**
   * Fetch mercenary contract auctions for multiple battles
   * @param battles Array of battles to fetch contracts for
   * @returns Array of all contract auctions
   */
  private async fetchContractsForBattles(battles: BattleDTO[]): Promise<MercenaryContractAuctionDTO[]> {
    const allContracts: MercenaryContractAuctionDTO[] = [];
    
    // Fetch contracts for each battle individually
    // Note: We could optimize this by batching, but for now we'll keep it simple
    for (const battle of battles) {
      try {
        const response = await this.apiService.getClient().mercenaryContractAuction.getPaginatedAuctions({
          battleId: battle._id,
          limit: 50 // Get up to 50 contracts per battle
        });

        allContracts.push(...response.result.data.items);
        logger.debug(`Fetched ${response.result.data.items.length} contract(s) for battle ${battle._id}`);
      } catch (error) {
        logger.warn(`Failed to fetch mercenary contracts for battle ${battle._id}`, error);
        // Continue with other battles even if one fails
      }
    }

    return allContracts;
  }

  /**
   * Send fire-and-forget mercenary contract alerts to all configured servers
   */
  private async sendContractAlerts(
    newContracts: NewMercenaryContract[],
    countries: Map<string, any>
  ): Promise<void> {
    // Get all configured servers that have mercenary contract notifications enabled
    const configuredServers = this.getConfiguredServers();
    
    if (configuredServers.length === 0) {
      logger.debug('No servers configured for mercenary contract notifications');
      return;
    }

    let alertsSent = 0;

    for (const serverId of configuredServers) {
      try {
        const serverConfig = ServerConfigManager.getServerConfig(serverId);
        
        if (!serverConfig?.mercenaryContracts) {
          continue;
        }

        // Send alert for each new contract
        for (const newContract of newContracts) {
          const contractConfig = serverConfig.mercenaryContracts;
          const currentPerK = newContract.currentPerK;
          
          // Check minimum threshold to send any message at all
          const minContractToSend = contractConfig.minContractToSend;
          if (minContractToSend !== undefined && minContractToSend !== null && currentPerK < minContractToSend) {
            logger.debug(`Skipping contract alert for server ${serverId}: currentPerK (${currentPerK}) below minContractToSend (${minContractToSend})`);
            continue;
          }

          // Format the contract alert message
          const alertMessage = MercenaryContractFormatter.formatContractAlert(newContract, countries);

          // Check contract threshold to determine if roles should be mentioned
          const contractThreshold = contractConfig.contractThreshold ?? 0;
          const shouldMentionRoles = currentPerK >= contractThreshold;
          
          // Only mention roles if threshold is met
          const effectiveRoleIds = shouldMentionRoles ? (contractConfig.roleIds || []) : [];

          logger.info(
            `Sending mercenary contract alert for ${newContract.country} seeking mercenaries for ${newContract.forCountry} in battle ${newContract.battleId} to server ${serverId} ` +
            `(currentPerK: ${currentPerK}, budget: ${newContract.budget}, mentions: ${effectiveRoleIds.length > 0}, threshold: ${contractThreshold})`
          );

          // Send the alert message (fire-and-forget, no tracking)
          await this.discordService.sendMercenaryContractAlert(
            serverId,
            alertMessage,
            effectiveRoleIds
          );

          alertsSent++;
        }
      } catch (error) {
        logger.error(`Failed to send mercenary contract alerts for server ${serverId}`, error);
        // Continue with other servers even if one fails
      }
    }

    logger.info(`Sent ${alertsSent} mercenary contract alert(s) across ${configuredServers.length} server(s) for ${newContracts.length} new contract(s)`);
  }

  /**
   * Get list of server IDs that have mercenary contract notifications configured and enabled
   */
  private getConfiguredServers(): string[] {
    const allConfigs = ServerConfigManager.readServerConfigs();
    logger.debug(`Checking ${allConfigs.size} server(s) for mercenary contract configuration`);
    
    const configuredServers = Array.from(allConfigs.keys()).filter(serverId => {
      const config = allConfigs.get(serverId);
      const hasMercenaryConfig = !!config?.mercenaryContracts;
      const isEnabled = config?.mercenaryContracts?.enabled !== false;
      const hasChannelId = !!config?.mercenaryContracts?.channelId;
      const contractThreshold = config?.mercenaryContracts?.contractThreshold ?? 0;
      const minContractToSend = config?.mercenaryContracts?.minContractToSend;
      
      logger.debug(`Server ${serverId}: hasMercenaryConfig=${hasMercenaryConfig}, isEnabled=${isEnabled}, hasChannelId=${hasChannelId}, contractThreshold=${contractThreshold}, minContractToSend=${minContractToSend}`);
      
      return hasMercenaryConfig && isEnabled && hasChannelId;
    });
    
    logger.debug(`Found ${configuredServers.length} configured server(s) for mercenary contracts: [${configuredServers.join(', ')}]`);
    return configuredServers;
  }

  /**
   * Get the number of alerted contracts (for monitoring/debugging)
   */
  getTrackedContractCount(): number {
    return this.contractTracker.getAlertedContractsCount();
  }

  /**
   * Clean up old contract tracking data
   */
  async cleanup(): Promise<void> {
    try {
      logger.debug('Running cleanup for mercenary contract tracking data...');
      
      // Simple cleanup of in-memory contract tracking
      this.contractTracker.cleanup();
      
      logger.debug('Mercenary contract tracking cleanup completed');
    } catch (error) {
      logger.error('Failed to cleanup mercenary contract tracking data', error);
    }
  }
}