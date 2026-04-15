import { logger } from '../../utils/logger';
import { BotConfig } from '../../config/config';
import { BattleService } from '../battle/BattleService';
import { SpectreService } from '../spectre/SpectreService';

/**
 * Service that handles periodic polling
 * Delegates battle processing to BattleService
 */
export class PollingService {
  private config: BotConfig;
  private battleService: BattleService;
  private spectreService: SpectreService;
  private pollingInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    config: BotConfig,
    battleService: BattleService,
    spectreService: SpectreService
  ) {
    this.config = config;
    this.battleService = battleService;
    this.spectreService = spectreService;
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
   * Execute a single polling cycle: process battles through BattleService
   */
  private async executePollingCycle(): Promise<void> {
    try {
      logger.debug('Starting polling cycle...');

      await this.battleService.processBattles();
    } catch (error) {
      logger.error('Polling cycle (battles) failed', error);
    }

    try {
      await this.spectreService.runSpectreCycle();
    } catch (error) {
      logger.error('Polling cycle (Spectre) failed', error);
    }

    logger.debug('Polling cycle completed');
  }

  /**
   * Clean up messages for battles that ended more than a day ago
   */
  private async cleanupOldBattles(): Promise<void> {
    try {
      // Delegate cleanup to BattleService
      await this.battleService.cleanupOldBattles();
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
