import { logger } from '../../utils/logger';
import { MercenaryContractTracker, NewMercenaryContract } from './MercenaryContractTracker';
import { MercenaryContractFormatter } from './MercenaryContractFormatter';
import { DiscordService } from '../discord/DiscordService';
import { ApiService, BattlePollData } from '../api/ApiService';
import { ServerConfigManager } from '../../utils/serverConfigManager';

// Infer types from SDK method return types
type GetPaginatedAuctionsResponse = Awaited<ReturnType<import('warera-sdk').APIClient['mercenaryContractAuction']['getPaginatedAuctions']>>;
type MercenaryContractAuctionDTO = GetPaginatedAuctionsResponse['result']['data']['items'][number];
type GetBattlesResponse = Awaited<ReturnType<import('warera-sdk').APIClient['battle']['getBattles']>>;
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
   * @param pollData Optional pre-fetched battle data from the polling cycle (avoids duplicate API calls)
   */
  async processContracts(pollData?: BattlePollData): Promise<void> {
    try {
      logger.debug('Processing mercenary contract auctions for new contracts...');

      let currentBattles: BattleDTO[];
      let countries: Map<string, unknown>;

      if (pollData) {
        currentBattles = pollData.battles;
        countries = pollData.countries;
      } else {
        const fetched = await this.apiService.fetchAllBattles();
        currentBattles = fetched.battles;
        countries = fetched.countries;
      }

      if (currentBattles.length === 0) {
        logger.debug('No battles available, skipping mercenary contract processing');
        return;
      }

      const allContracts = await this.fetchContractsForBattles(currentBattles);
      logger.debug(`Fetched ${allContracts.length} mercenary contract auction(s) from API`);

      const newContracts = this.contractTracker.detectNewContracts(allContracts);

      if (newContracts.length === 0) {
        logger.debug(`No new mercenary contracts detected. Total alerted contracts: ${this.contractTracker.getAlertedContractsCount()}`);
        return;
      }

      logger.info(`Detected ${newContracts.length} new mercenary contract(s) to alert for`);

      await this.sendContractAlerts(newContracts, countries as Map<string, any>);

      this.contractTracker.cleanup();

      logger.debug('Mercenary contract processing completed successfully');
    } catch (error) {
      logger.error('Failed to process mercenary contracts', error);
      throw error;
    }
  }

  /**
   * Fetch mercenary contract auctions for multiple battles via batch client
   */
  private async fetchContractsForBattles(
    battles: BattleDTO[]
  ): Promise<MercenaryContractAuctionDTO[]> {
    return this.apiService.fetchMercenaryContractsForBattles(battles.map(battle => battle._id));
  }

  /**
   * Send fire-and-forget mercenary contract alerts to all configured servers
   */
  private async sendContractAlerts(
    newContracts: NewMercenaryContract[],
    countries: Map<string, any>
  ): Promise<void> {
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

        for (const newContract of newContracts) {
          const contractConfig = serverConfig.mercenaryContracts;
          const currentPerK = newContract.currentPerK;

          const minContractToSend = contractConfig.minContractToSend;
          if (minContractToSend !== undefined && minContractToSend !== null && currentPerK < minContractToSend) {
            logger.debug(`Skipping contract alert for server ${serverId}: currentPerK (${currentPerK}) below minContractToSend (${minContractToSend})`);
            continue;
          }

          const alertMessage = MercenaryContractFormatter.formatContractAlert(newContract, countries);

          const contractThreshold = contractConfig.contractThreshold ?? 0;
          const shouldMentionRoles = currentPerK >= contractThreshold;
          const effectiveRoleIds = shouldMentionRoles ? (contractConfig.roleIds || []) : [];

          logger.info(
            `Sending mercenary contract alert for ${newContract.country} seeking mercenaries for ${newContract.forCountry} in battle ${newContract.battleId} to server ${serverId} ` +
            `(currentPerK: ${currentPerK}, budget: ${newContract.budget}, mentions: ${effectiveRoleIds.length > 0}, threshold: ${contractThreshold})`
          );

          await this.discordService.sendMercenaryContractAlert(
            serverId,
            alertMessage,
            effectiveRoleIds
          );

          alertsSent++;
        }
      } catch (error) {
        logger.error(`Failed to send mercenary contract alerts for server ${serverId}`, error);
      }
    }

    logger.info(`Sent ${alertsSent} mercenary contract alert(s) across ${configuredServers.length} server(s) for ${newContracts.length} new contract(s)`);
  }

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

  getTrackedContractCount(): number {
    return this.contractTracker.getAlertedContractsCount();
  }

  async cleanup(): Promise<void> {
    try {
      logger.debug('Running cleanup for mercenary contract tracking data...');
      this.contractTracker.cleanup();
      logger.debug('Mercenary contract tracking cleanup completed');
    } catch (error) {
      logger.error('Failed to cleanup mercenary contract tracking data', error);
    }
  }
}