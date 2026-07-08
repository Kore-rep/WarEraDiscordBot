import { logger } from '../../../utils/logger';
import { ApiService, BattlePollData } from '../../api/ApiService';
import { BattleService } from '../../battle/BattleService';
import { MercenaryContractService } from '../../mercenary/MercenaryContractService';
import { ScheduledTask } from '../ScheduledTask';

/**
 * Fetches battle data once per cycle and fans it out to bounty-battle and mercenary
 * contract processing (both derived from the same battle poll). Each stage is isolated
 * so one failure doesn't abort the rest.
 */
export class BattlePollTask implements ScheduledTask {
  readonly name = 'battle-poll';
  readonly intervalMs: number;

  constructor(
    intervalMinutes: number,
    private readonly apiService: ApiService,
    private readonly battleService: BattleService,
    private readonly mercenaryContractService: MercenaryContractService
  ) {
    this.intervalMs = intervalMinutes * 60 * 1000;
  }

  async runCycle(): Promise<void> {
    let pollData: BattlePollData | undefined;

    try {
      pollData = await this.apiService.fetchAllBattles();
    } catch (error) {
      logger.error('Battle poll failed to fetch battles', error);
    }

    try {
      await this.battleService.processBattles(pollData);
    } catch (error) {
      logger.error('Battle poll (bounties) failed', error);
    }

    // Reuses the same battle poll data
    try {
      await this.mercenaryContractService.processContracts(pollData);
    } catch (error) {
      logger.error('Battle poll (mercenary contracts) failed', error);
    }
  }
}
