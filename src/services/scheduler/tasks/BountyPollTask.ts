import { logger } from '../../../utils/logger';
import { ApiService } from '../../api/ApiService';
import { BattleService } from '../../battle/BattleService';
import { MercenaryContractService } from '../../mercenary/MercenaryContractService';
import { SpectreService } from '../../spectre/SpectreService';
import { ScheduledTask } from '../ScheduledTask';

/**
 * Main poll: fetch battle data once and fan it out to bounty, mercenary contract,
 * and Spectre processing. Each stage is isolated so one failure doesn't abort the rest.
 */
export class BountyPollTask implements ScheduledTask {
  readonly name = 'bounty-poll';
  readonly intervalMs: number;

  constructor(
    intervalMinutes: number,
    private readonly apiService: ApiService,
    private readonly battleService: BattleService,
    private readonly mercenaryContractService: MercenaryContractService,
    private readonly spectreService: SpectreService
  ) {
    this.intervalMs = intervalMinutes * 60 * 1000;
  }

  async runCycle(): Promise<void> {
    let pollData: Awaited<ReturnType<ApiService['fetchAllBattles']>> | undefined;

    try {
      pollData = await this.apiService.fetchAllBattles();
    } catch (error) {
      logger.error('Poll failed to fetch battles', error);
    }

    try {
      await this.battleService.processBattles(pollData);
    } catch (error) {
      logger.error('Poll (battles) failed', error);
    }

    // Reuses the same battle poll data
    try {
      await this.mercenaryContractService.processContracts(pollData);
    } catch (error) {
      logger.error('Poll (mercenary contracts) failed', error);
    }

    // Spectre fetches its own data
    try {
      await this.spectreService.runSpectreCycle();
    } catch (error) {
      logger.error('Poll (Spectre) failed', error);
    }
  }
}
