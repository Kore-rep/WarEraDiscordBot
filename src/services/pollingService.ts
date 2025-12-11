import { logger } from '../utils/logger';
import { BotConfig } from '../config';
import { ApiService } from './apiService';
import { DiscordService } from './discordService';
import { BattleTracker } from './battleTracker';
import { MessageTracker } from './messageTracker';

/**
 * Service that handles periodic API polling and Discord notifications
 * Updates existing messages instead of creating new ones
 * Only sends messages when battles change (new battles, replenished moneyPool, or changed moneyPer1kDamages)
 * Does not send messages when pool decreases
 */
export class PollingService {
  private config: BotConfig;
  private apiService: ApiService;
  private discordService: DiscordService;
  private battleTracker: BattleTracker;
  private messageTracker: MessageTracker;
  private pollingInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    config: BotConfig,
    apiService: ApiService,
    discordService: DiscordService,
    messageTracker: MessageTracker
  ) {
    this.config = config;
    this.apiService = apiService;
    this.discordService = discordService;
    this.messageTracker = messageTracker;
    this.battleTracker = new BattleTracker();
  }

  /**
   * Start periodic API polling and cleanup
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('Polling service is already running');
      return;
    }

    const intervalMs = this.config.polling.intervalMinutes * 60 * 1000;

    logger.info(
      `Starting periodic polling every ${this.config.polling.intervalMinutes} minute(s)`
    );

    // Execute immediately on start, then at intervals
    this.executePollingCycle();

    this.pollingInterval = setInterval(() => {
      this.executePollingCycle();
    }, intervalMs);

    // Run cleanup every hour
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldBattles();
    }, 60 * 60 * 1000);

    this.isRunning = true;
  }

  /**
   * Stop periodic polling and cleanup
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    logger.info('Polling stopped');
    this.isRunning = false;
  }

  /**
   * Execute a single polling cycle: fetch API data and send mentions only when changes are detected
   */
  private async executePollingCycle(): Promise<void> {
    try {
      logger.debug('Starting polling cycle...');

      // Fetch data from API (battles, countries, and regions)
      const { battles: allBattles, countries, regions } = await this.apiService.fetchBattles();
      logger.debug(`Fetched ${allBattles.length} battle(s) from API`);

      // Detect changes (new battles, replenished moneyPool, or changed moneyPer1kDamages)
      // Note: pool decreases are not reported
      const battleChanges = this.battleTracker.detectChanges(allBattles);

      if (battleChanges.length === 0) {
        logger.debug(`No changes detected. Tracking ${this.battleTracker.getTrackedBattleCount()} battle(s)`);
        return;
      }

      logger.info(
        `Detected ${battleChanges.length} changed battle(s) ` +
        `(new, replenished moneyPool, or changed moneyPer1kDamages)`
      );

      // Extract role IDs per server from changed battles only
      const roleIdsByServer = this.apiService.extractRoleIdsByServer(battleChanges.map(bc => bc.battle));

      // Update battle messages for each configured server
      // Update even if no roles are configured (message will be updated without mentions)
      let serversUpdated = 0;
      for (const [serverId, roleIds] of roleIdsByServer.entries()) {
        try {
          // Update each changed battle
          for (const battleChange of battleChanges) {
            logger.info(`Updating battle message for battle ${battleChange.battle._id} in server ${serverId}`);
            await this.discordService.updateBattleMessage(
              serverId,
              roleIds,
              battleChange,
              countries,
              regions
            );
          }
          serversUpdated++;
        } catch (error) {
          logger.error(`Failed to update battle message for server ${serverId}`, error);
          // Continue with other servers even if one fails
        }
      }

      if (serversUpdated === 0) {
        logger.debug('No servers configured for battle notifications');
      } else {
        logger.info(`Updated battle messages for ${serversUpdated} server(s) for ${battleChanges.length} changed battle(s)`);
      }

      logger.debug('Polling cycle completed successfully');
    } catch (error) {
      logger.error('Polling cycle failed', error);
      // Don't throw - allow the bot to continue and try again next interval
    }
  }

  /**
   * Clean up messages for battles that ended more than a day ago
   */
  private async cleanupOldBattles(): Promise<void> {
    try {
      logger.debug('Running cleanup for old battles...');
      
      // Get all current battles to check which ones are still active
      const { battles: allBattles } = await this.apiService.fetchBattles();
      
      // Get battles that ended more than a day ago
      const oldBattleIds = this.battleTracker.getOldBattles(allBattles);
      
      if (oldBattleIds.length === 0) {
        logger.debug('No old battles to clean up');
        return;
      }

      logger.info(`Cleaning up ${oldBattleIds.length} old battle(s)...`);

      // Delete messages for old battles in all servers
      const serverIds = this.discordService.getServerIds();
      for (const serverId of serverIds) {
        for (const battleId of oldBattleIds) {
          try {
            await this.discordService.deleteBattleMessage(serverId, battleId);
          } catch (error) {
            logger.warn(`Failed to delete message for battle ${battleId} in server ${serverId}`, error);
          }
        }
      }

      logger.info(`Cleanup completed for ${oldBattleIds.length} old battle(s)`);
    } catch (error) {
      logger.error('Failed to cleanup old battles', error);
    }
  }

  /**
   * Check if polling is currently running
   */
  isPolling(): boolean {
    return this.isRunning;
  }
}

