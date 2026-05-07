/**
 * @deprecated This is the legacy battle tracker system that has been replaced by SimpleBountyTracker.
 * 
 * This file is preserved for potential rollback purposes. The system was replaced due to complexity:
 * - Complex state tracking for damage/points tracking, change history, and state management
 * - Discord message ID tracking and editing logic
 * - File-based message persistence
 * 
 * The new SimpleBountyTracker uses a fire-and-forget approach with bountyEffectiveAt timestamps
 * for much cleaner and simpler bounty alerts.
 * 
 * DO NOT USE THIS CLASS unless reverting to the legacy system.
 * Use SimpleBountyTracker instead.
 */

import { logger } from '../../utils/logger';

// Infer types from SDK method return types
type GetBattlesResponse = Awaited<ReturnType<import('warera-sdk').APIClient['battle']['getBattles']>>;
type BattleDTO = GetBattlesResponse['result']['data']['items'][number];

/**
 * Change entry in the history log
 */
export interface ChangeEntry {
  timestamp: Date;
  type: 'bounty' | 'pool';
  side: 'attacker' | 'defender';
  oldValue: number;
  newValue: number;
}

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
  changeHistory: ChangeEntry[];
  createdAt: Date;
}

/**
 * Change information for a battle
 */
export interface BattleChange {
  battle: BattleDTO;
  changeType: 'new' | 'bounty_increased' | 'bounty_decreased' | 'pool_increased' | 'pool_decreased';
  changeHistory: ChangeEntry[];
}

/**
 * @deprecated Legacy service for tracking battle states and detecting changes
 * 
 * This has been replaced by SimpleBountyTracker which uses bountyEffectiveAt for simpler tracking.
 * Preserved for rollback purposes only.
 */
export class LegacyBattleTracker {
  private battleStates: Map<string, BattleState> = new Map(); // battleId -> BattleState

  /**
   * Compare current battles with tracked state and detect changes
   * Reports changes for pool increases, pool depletions (pool goes from > 0 to == 0),
   * and bounty changes. Normal pool decreases trigger message updates but are not logged.
   * 
   * @param currentBattles - Current battles from API
   * @returns Array of battle changes with change type and history
   */
  detectChanges(currentBattles: BattleDTO[]): BattleChange[] {
    const changedBattles: BattleChange[] = [];
    const now = new Date();

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
        
        const changeHistory: ChangeEntry[] = [];
        
        // Store the new state
        this.battleStates.set(battleId, {
          battleId,
          attackerMoneyPool,
          attackerMoneyPer1kDamages,
          defenderMoneyPool,
          defenderMoneyPer1kDamages,
          lastSeen: now,
          changeHistory,
          createdAt: now,
        });
        
        changedBattles.push({
          battle,
          changeType: 'new',
          changeHistory,
        });
      } else {
        // Existing battle - check for changes
        const changeHistory = [...currentState.changeHistory];
        let changeType: BattleChange['changeType'] | null = null;
        let stateNeedsUpdate = false;

        // Check if moneyPool changed (detect all changes, but only log increases and depletions)
        if (attackerMoneyPool !== currentState.attackerMoneyPool) {
          stateNeedsUpdate = true;
          
          if (attackerMoneyPool > currentState.attackerMoneyPool) {
            // Pool increased - add to log
            logger.debug(
              `Battle ${battleId}: Attacker moneyPool increased from ${currentState.attackerMoneyPool} to ${attackerMoneyPool}`
            );
            changeHistory.push({
              timestamp: now,
              type: 'pool',
              side: 'attacker',
              oldValue: currentState.attackerMoneyPool,
              newValue: attackerMoneyPool,
            });
            changeType = 'pool_increased';
          } else if (currentState.attackerMoneyPool > 0 && attackerMoneyPool === 0) {
            // Pool depleted (was > 0, now == 0) - add to log
            logger.debug(
              `Battle ${battleId}: Attacker moneyPool depleted from ${currentState.attackerMoneyPool} to 0`
            );
            changeHistory.push({
              timestamp: now,
              type: 'pool',
              side: 'attacker',
              oldValue: currentState.attackerMoneyPool,
              newValue: attackerMoneyPool,
            });
            if (!changeType) changeType = 'pool_decreased';
          } else {
            // Normal pool decrease (not a depletion) - update state and trigger message update but don't log
            logger.debug(
              `Battle ${battleId}: Attacker moneyPool decreased from ${currentState.attackerMoneyPool} to ${attackerMoneyPool} (state updated, message updated, not logged)`
            );
            if (!changeType) changeType = 'pool_decreased';
          }
        }

        if (defenderMoneyPool !== currentState.defenderMoneyPool) {
          stateNeedsUpdate = true;
          
          if (defenderMoneyPool > currentState.defenderMoneyPool) {
            // Pool increased - add to log
            logger.debug(
              `Battle ${battleId}: Defender moneyPool increased from ${currentState.defenderMoneyPool} to ${defenderMoneyPool}`
            );
            changeHistory.push({
              timestamp: now,
              type: 'pool',
              side: 'defender',
              oldValue: currentState.defenderMoneyPool,
              newValue: defenderMoneyPool,
            });
            if (!changeType) changeType = 'pool_increased';
          } else if (currentState.defenderMoneyPool > 0 && defenderMoneyPool === 0) {
            // Pool depleted (was > 0, now == 0) - add to log
            logger.debug(
              `Battle ${battleId}: Defender moneyPool depleted from ${currentState.defenderMoneyPool} to 0`
            );
            changeHistory.push({
              timestamp: now,
              type: 'pool',
              side: 'defender',
              oldValue: currentState.defenderMoneyPool,
              newValue: defenderMoneyPool,
            });
            if (!changeType) changeType = 'pool_decreased';
          } else {
            // Normal pool decrease (not a depletion) - update state and trigger message update but don't log
            logger.debug(
              `Battle ${battleId}: Defender moneyPool decreased from ${currentState.defenderMoneyPool} to ${defenderMoneyPool} (state updated, message updated, not logged)`
            );
            if (!changeType) changeType = 'pool_decreased';
          }
        }

        // Check if moneyPer1kDamages changed (report both increases and decreases)
        if (attackerMoneyPer1kDamages !== currentState.attackerMoneyPer1kDamages) {
          stateNeedsUpdate = true;
          logger.debug(
            `Battle ${battleId}: Attacker moneyPer1kDamages changed from ${currentState.attackerMoneyPer1kDamages} to ${attackerMoneyPer1kDamages}`
          );
          changeHistory.push({
            timestamp: now,
            type: 'bounty',
            side: 'attacker',
            oldValue: currentState.attackerMoneyPer1kDamages,
            newValue: attackerMoneyPer1kDamages,
          });
          changeType = attackerMoneyPer1kDamages > currentState.attackerMoneyPer1kDamages 
            ? 'bounty_increased' 
            : 'bounty_decreased';
        }

        if (defenderMoneyPer1kDamages !== currentState.defenderMoneyPer1kDamages) {
          stateNeedsUpdate = true;
          logger.debug(
            `Battle ${battleId}: Defender moneyPer1kDamages changed from ${currentState.defenderMoneyPer1kDamages} to ${defenderMoneyPer1kDamages}`
          );
          changeHistory.push({
            timestamp: now,
            type: 'bounty',
            side: 'defender',
            oldValue: currentState.defenderMoneyPer1kDamages,
            newValue: defenderMoneyPer1kDamages,
          });
          if (!changeType) {
            changeType = defenderMoneyPer1kDamages > currentState.defenderMoneyPer1kDamages 
              ? 'bounty_increased' 
              : 'bounty_decreased';
          }
        }

        // Update stored state if there were any changes (pool, bounty, or both)
        if (stateNeedsUpdate) {
          this.battleStates.set(battleId, {
            battleId,
            attackerMoneyPool,
            attackerMoneyPer1kDamages,
            defenderMoneyPool,
            defenderMoneyPer1kDamages,
            lastSeen: now,
            changeHistory,
            createdAt: currentState.createdAt,
          });
        } else {
          // Update lastSeen even if no changes detected
          currentState.lastSeen = now;
        }

        // Only trigger message update if there's a changeType (logged changes)
        if (changeType) {
          changedBattles.push({
            battle,
            changeType,
            changeHistory,
          });
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
   * Get battles that ended more than a day ago (for cleanup)
   */
  getOldBattles(currentBattles: BattleDTO[]): string[] {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const oldBattleIds: string[] = [];
    
    for (const [battleId, state] of this.battleStates.entries()) {
      const stillActive = currentBattles.some(b => b._id === battleId);
      if (!stillActive && state.lastSeen < oneDayAgo) {
        oldBattleIds.push(battleId);
      }
    }
    
    return oldBattleIds;
  }

  /**
   * Get change history for a battle
   */
  getChangeHistory(battleId: string): ChangeEntry[] {
    return this.battleStates.get(battleId)?.changeHistory || [];
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