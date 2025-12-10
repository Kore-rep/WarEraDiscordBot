import { logger } from '../utils/logger';
import { BotConfig } from '../config';
import { ApiService } from './apiService';
import { DiscordService } from './discordService';
import { BattleTracker } from './battleTracker';

/**
 * Service that handles periodic API polling and Discord notifications
 * Only sends messages when battles change (new battles, replenished moneyPool, or changed moneyPer1kDamages)
 */
export class PollingService {
  private config: BotConfig;
  private apiService: ApiService;
  private discordService: DiscordService;
  private battleTracker: BattleTracker;
  private pollingInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    config: BotConfig,
    apiService: ApiService,
    discordService: DiscordService
  ) {
    this.config = config;
    this.apiService = apiService;
    this.discordService = discordService;
    this.battleTracker = new BattleTracker();
  }

  /**
   * Start periodic API polling
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

    this.isRunning = true;
  }

  /**
   * Stop periodic polling
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      logger.info('Polling stopped');
    }

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
      const changedBattles = this.battleTracker.detectChanges(allBattles);

      if (changedBattles.length === 0) {
        logger.debug(`No changes detected. Tracking ${this.battleTracker.getTrackedBattleCount()} battle(s)`);
        return;
      }

      logger.info(
        `Detected ${changedBattles.length} changed battle(s) ` +
        `(new, replenished moneyPool, or changed moneyPer1kDamages)`
      );

      // Extract role IDs per server from changed battles only
      const roleIdsByServer = this.apiService.extractRoleIdsByServer(changedBattles);

      // Send battle notifications to each server that has roles to mention
      let serversNotified = 0;
      for (const [serverId, roleIds] of roleIdsByServer.entries()) {
        if (roleIds.length > 0) {
          try {
            logger.info(`Sending notification for ${changedBattles.length} changed battle(s) to server ${serverId}`);
            await this.discordService.sendBattleNotification(serverId, roleIds, changedBattles, countries, regions);
            serversNotified++;
          } catch (error) {
            logger.error(`Failed to send battle notification to server ${serverId}`, error);
            // Continue with other servers even if one fails
          }
        }
      }

      if (serversNotified === 0) {
        logger.debug('No roles configured for servers with changed battles');
      } else {
        logger.info(`Sent notification messages to ${serversNotified} server(s) for ${changedBattles.length} changed battle(s)`);
      }

      logger.debug('Polling cycle completed successfully');
    } catch (error) {
      logger.error('Polling cycle failed', error);
      // Don't throw - allow the bot to continue and try again next interval
    }
  }

  /**
   * Check if polling is currently running
   */
  isPolling(): boolean {
    return this.isRunning;
  }
}

