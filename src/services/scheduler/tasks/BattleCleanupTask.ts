import { logger } from '../../../utils/logger';
import { BattleService } from '../../battle/BattleService';
import { MercenaryContractService } from '../../mercenary/MercenaryContractService';
import { ScheduledTask } from '../ScheduledTask';

/**
 * Hourly cleanup of stale battle and mercenary contract tracking data.
 */
export class BattleCleanupTask implements ScheduledTask {
  readonly name = 'battle-cleanup';
  readonly intervalMs = 60 * 60 * 1000;
  readonly runOnStart = false;

  constructor(
    private readonly battleService: BattleService,
    private readonly mercenaryContractService: MercenaryContractService
  ) {}

  async runCycle(): Promise<void> {
    await Promise.allSettled([
      this.battleService.cleanupOldBattles().catch(error =>
        logger.error('Failed to cleanup old battles', error)
      ),
      this.mercenaryContractService.cleanup().catch(error =>
        logger.error('Failed to cleanup mercenary contracts', error)
      ),
    ]);
  }
}
