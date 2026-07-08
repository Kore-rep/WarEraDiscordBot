import { logger } from '../../utils/logger';
import { SimpleBountyTracker, NewBounty } from './SimpleBountyTracker';
import { SimpleBattleFormatter } from './SimpleBattleFormatter';
import { DiscordService } from '../discord/DiscordService';
import { ApiService, BattlePollData } from '../api/ApiService';
import { ServerConfigManager } from '../../utils/serverConfigManager';

/**
 * Handles bounty battle notifications: detects new bounties and sends fire-and-forget alerts.
 * Mercenary contracts are handled separately by MercenaryContractService.
 */
export class BattleService {
  private bountyTracker = new SimpleBountyTracker();
  private discordService: DiscordService;
  private apiService: ApiService;

  constructor(discordService: DiscordService, apiService: ApiService) {
    this.discordService = discordService;
    this.apiService = apiService;
  }

  /**
   * Detect new bounties from API data and send alerts.
   * @param pollData Optional pre-fetched battle data from the polling cycle (avoids duplicate API calls)
   */
  async processBattles(pollData?: BattlePollData): Promise<void> {
    try {
      let allBattles: any[];
      let countries: Map<string, unknown>;
      let regions: Map<string, unknown>;

      if (pollData) {
        allBattles = this.apiService.filterBattlesWithBountyRewards(pollData.battles);
        countries = pollData.countries;
        regions = pollData.regions;
      } else {
        const fetched = await this.apiService.fetchBattles();
        allBattles = fetched.battles;
        countries = fetched.countries;
        regions = fetched.regions;
      }

      const newBounties = this.bountyTracker.detectNewBounties(allBattles);

      if (newBounties.length === 0) {
        logger.debug(`No new bounties detected. Total alerted bounties: ${this.bountyTracker.getAlertedBountiesCount()}`);
        return;
      }

      logger.info(`Detected ${newBounties.length} new bounty/bounties to alert for`);
      await this.sendBountyAlerts(newBounties, countries as Map<string, any>, regions as Map<string, any>);
      this.bountyTracker.cleanup();
    } catch (error) {
      logger.error('Failed to process bounties', error);
      throw error;
    }
  }

  /**
   * Send fire-and-forget bounty alerts to all configured servers
   */
  private async sendBountyAlerts(
    newBounties: NewBounty[],
    countries: Map<string, any>,
    regions: Map<string, any>
  ): Promise<void> {
    const configuredServers = this.getConfiguredServers();

    if (configuredServers.length === 0) {
      logger.debug('No servers configured for bounty battle notifications');
      return;
    }

    let alertsSent = 0;

    for (const serverId of configuredServers) {
      try {
        const serverConfig = ServerConfigManager.getServerConfig(serverId);

        if (!serverConfig?.bountyBattles) {
          continue;
        }

        for (const newBounty of newBounties) {
          // Skip bounties below this server's minimum threshold
          const minBountyToSend = serverConfig.bountyBattles.minBountyToSend;
          if (minBountyToSend != null && minBountyToSend > 0 && newBounty.moneyPer1kDamages < minBountyToSend) {
            continue;
          }

          const alertMessage = SimpleBattleFormatter.formatBountyAlert(newBounty, countries, regions);

          // Only mention roles when the bounty clears the mention threshold
          const roleIds = serverConfig.bountyBattles.roleIds || [];
          const bountyThreshold = serverConfig.bountyBattles.bountyThreshold ?? 0;
          const effectiveRoleIds = newBounty.moneyPer1kDamages >= bountyThreshold ? roleIds : [];

          logger.info(
            `Sending bounty alert for ${newBounty.country} in battle ${newBounty.battle._id} to server ${serverId} ` +
            `(bounty: ${newBounty.moneyPer1kDamages}, mentions: ${effectiveRoleIds.length > 0})`
          );

          await this.discordService.sendBountyAlert(serverId, alertMessage, effectiveRoleIds);
          alertsSent++;
        }
      } catch (error) {
        logger.error(`Failed to send bounty alerts for server ${serverId}`, error);
        // Continue with other servers even if one fails
      }
    }

    logger.info(`Sent ${alertsSent} bounty alert(s) across ${configuredServers.length} server(s) for ${newBounties.length} new bounty/bounties`);
  }

  /**
   * Get list of server IDs that have bounty battles configured and enabled
   */
  private getConfiguredServers(): string[] {
    const allConfigs = ServerConfigManager.readServerConfigs();
    return Array.from(allConfigs.keys()).filter(serverId => {
      const config = allConfigs.get(serverId);
      return config?.bountyBattles &&
             config.bountyBattles.enabled !== false &&
             config.bountyBattles.channelId;
    });
  }

  /**
   * Clean up in-memory bounty tracking data
   */
  async cleanupOldBattles(): Promise<void> {
    try {
      this.bountyTracker.cleanup();
    } catch (error) {
      logger.error('Failed to cleanup bounty tracking data', error);
    }
  }

  /**
   * Get the number of bounties currently tracked
   */
  getTrackedBattleCount(): number {
    return this.bountyTracker.getAlertedBountiesCount();
  }
}
