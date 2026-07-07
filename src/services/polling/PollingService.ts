import { logger } from '../../utils/logger';
import { BotConfig } from '../../config/config';
import { BattleService } from '../battle/BattleService';
import { MercenaryContractService } from '../mercenary/MercenaryContractService';
import { SpectreService } from '../spectre/SpectreService';
import { ApiService } from '../api/ApiService';

/**
 * Service that handles periodic polling
 * Runs separate cycles for battles, mercenary contracts, and Spectre operations
 */
export class PollingService {
  private config: BotConfig;
  private apiService: ApiService;
  private battleService: BattleService;
  private mercenaryContractService: MercenaryContractService;
  private spectreService: SpectreService;
  private pollingInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    config: BotConfig,
    apiService: ApiService,
    battleService: BattleService,
    mercenaryContractService: MercenaryContractService,
    spectreService: SpectreService
  ) {
    this.config = config;
    this.apiService = apiService;
    this.battleService = battleService;
    this.mercenaryContractService = mercenaryContractService;
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
   * Execute a single polling cycle: fetch battles once, then process bounties and contracts
   */
  private async executePollingCycle(): Promise<void> {
    logger.debug('Starting polling cycle...');

    let pollData: Awaited<ReturnType<ApiService['fetchAllBattles']>> | undefined;

    try {
      pollData = await this.apiService.fetchAllBattles();
    } catch (error) {
      logger.error('Polling cycle failed to fetch battles', error);
    }

    // 1. Battle cycle - process bounties
    try {
      await this.battleService.processBattles(pollData);
    } catch (error) {
      logger.error('Polling cycle (battles) failed', error);
    }

    // 2. Mercenary contract cycle - process contract auctions (reuses battle poll data)
    try {
      await this.mercenaryContractService.processContracts(pollData);
    } catch (error) {
      logger.error('Polling cycle (mercenary contracts) failed', error);
    }

    // 3. Spectre cycle - process Spectre operations
    try {
      await this.spectreService.runSpectreCycle();
    } catch (error) {
      logger.error('Polling cycle (Spectre) failed', error);
    }

    logger.debug('Polling cycle completed');
  }

  /**
   * Clean up old data for battles and mercenary contracts
   */
  private async cleanupOldBattles(): Promise<void> {
    const cleanupTasks = [
      this.battleService.cleanupOldBattles().catch(error =>
        logger.error('Failed to cleanup old battles', error)
      ),
      this.mercenaryContractService.cleanup().catch(error =>
        logger.error('Failed to cleanup mercenary contracts', error)
      ),
    ];

    await Promise.allSettled(cleanupTasks);
  }

  /**
   * Check if polling is currently running
   */
  isPolling(): boolean {
    return this.isRunning;
  }
}
