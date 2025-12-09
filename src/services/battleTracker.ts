import { logger } from '../utils/logger';

// Infer types from SDK method return types
type GetBattlesResponse = Awaited<ReturnType<import('warera-sdk').APIClient['battle']['getBattles']>>;
type BattleDTO = GetBattlesResponse['result']['data']['items'][number];

/**
 * Stored state of a battle for change detection
 */
interface BattleState {
  battleId: string;
  attackerMoneyPool: number;
  attackerMoneyPer1kDamages: number;
  defenderMoneyPool: number;
  defenderMoneyPer1kDamages: number;
  lastSeen: Date;
}

/**
 * Service for tracking battle states and detecting changes
 */
export class BattleTracker {
  private battleStates: Map<string, BattleState> = new Map(); // battleId -> BattleState

  /**
   * Compare current battles with tracked state and detect changes
   * 
   * @param currentBattles - Current battles from API
   * @returns Array of battles that have changed (new, replenished moneyPool, or changed moneyPer1kDamages)
   */
  detectChanges(currentBattles: BattleDTO[]): BattleDTO[] {
    const changedBattles: BattleDTO[] = [];

    for (const battle of currentBattles) {
      const battleId = battle._id;
      const currentState = this.battleStates.get(battleId);

      // Extract current values (default to 0 if undefined)
      const attackerMoneyPool = battle.attacker.moneyPool ?? 0;
      const attackerMoneyPer1kDamages = battle.attacker.moneyPer1kDamages ?? 0;
      const defenderMoneyPool = battle.defender.moneyPool ?? 0;
      const defenderMoneyPer1kDamages = battle.defender.moneyPer1kDamages ?? 0;

      if (!currentState) {
        // New battle - hasn't been seen before
        logger.debug(`New battle detected: ${battleId}`);
        changedBattles.push(battle);
        
        // Store the new state
        this.battleStates.set(battleId, {
          battleId,
          attackerMoneyPool,
          attackerMoneyPer1kDamages,
          defenderMoneyPool,
          defenderMoneyPer1kDamages,
          lastSeen: new Date(),
        });
      } else {
        // Existing battle - check for changes
        let hasChanged = false;

        // Check if moneyPool was replenished (increased)
        if (attackerMoneyPool > currentState.attackerMoneyPool) {
          logger.debug(
            `Battle ${battleId}: Attacker moneyPool replenished from ${currentState.attackerMoneyPool} to ${attackerMoneyPool}`
          );
          hasChanged = true;
        }

        if (defenderMoneyPool > currentState.defenderMoneyPool) {
          logger.debug(
            `Battle ${battleId}: Defender moneyPool replenished from ${currentState.defenderMoneyPool} to ${defenderMoneyPool}`
          );
          hasChanged = true;
        }

        // Check if moneyPer1kDamages changed
        if (attackerMoneyPer1kDamages !== currentState.attackerMoneyPer1kDamages) {
          logger.debug(
            `Battle ${battleId}: Attacker moneyPer1kDamages changed from ${currentState.attackerMoneyPer1kDamages} to ${attackerMoneyPer1kDamages}`
          );
          hasChanged = true;
        }

        if (defenderMoneyPer1kDamages !== currentState.defenderMoneyPer1kDamages) {
          logger.debug(
            `Battle ${battleId}: Defender moneyPer1kDamages changed from ${currentState.defenderMoneyPer1kDamages} to ${defenderMoneyPer1kDamages}`
          );
          hasChanged = true;
        }

        if (hasChanged) {
          changedBattles.push(battle);
          
          // Update stored state
          this.battleStates.set(battleId, {
            battleId,
            attackerMoneyPool,
            attackerMoneyPer1kDamages,
            defenderMoneyPool,
            defenderMoneyPer1kDamages,
            lastSeen: new Date(),
          });
        } else {
          // Update lastSeen even if no changes detected
          currentState.lastSeen = new Date();
        }
      }
    }

    // Clean up battles that are no longer active (optional - prevents memory growth)
    // Only keep battles seen in the last hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    for (const [battleId, state] of this.battleStates.entries()) {
      if (state.lastSeen < oneHourAgo) {
        const stillActive = currentBattles.some(b => b._id === battleId);
        if (!stillActive) {
          logger.debug(`Removing inactive battle from tracking: ${battleId}`);
          this.battleStates.delete(battleId);
        }
      }
    }

    return changedBattles;
  }

  /**
   * Get the number of tracked battles
   */
  getTrackedBattleCount(): number {
    return this.battleStates.size;
  }

  /**
   * Clear all tracked battle states (useful for testing or reset)
   */
  clear(): void {
    this.battleStates.clear();
    logger.info('Cleared all tracked battle states');
  }
}

