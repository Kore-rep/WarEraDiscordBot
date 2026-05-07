import { logger } from '../../utils/logger';

// Infer types from SDK method return types
type GetBattlesResponse = Awaited<ReturnType<import('../api/WarEraApiClient').APIClient['battle']['getBattles']>>;
type BattleDTO = GetBattlesResponse['result']['data']['items'][number];

/**
 * Represents a new bounty that needs to be alerted
 */
export interface NewBounty {
  battle: BattleDTO;
  side: 'attacker' | 'defender';
  bountyEffectiveAt: string;
  country: string;
  moneyPer1kDamages: number;
  moneyPool: number;
}

/**
 * Simple tracker for bounty alerts using bountyEffectiveAt timestamps
 * This replaces the complex BattleTracker with a fire-and-forget approach
 * that only tracks which bountyEffectiveAt values we've already alerted for
 */
export class SimpleBountyTracker {
  private alertedBounties: Set<string> = new Set(); // Set of bountyEffectiveAt timestamps we've already alerted for

  /**
   * Check battles for new bounties that haven't been alerted for yet
   * @param battles Current battles from API
   * @returns Array of new bounties to alert for
   */
  detectNewBounties(battles: BattleDTO[]): NewBounty[] {
    const newBounties: NewBounty[] = [];

    for (const battle of battles) {
      // Check attacker side
      if (battle.attacker.bountyEffectiveAt && 
          (battle.attacker.moneyPer1kDamages ?? 0) > 0 && 
          (battle.attacker.moneyPool ?? 0) > 0) {
        
        const bountyKey = `${battle._id}-attacker-${battle.attacker.bountyEffectiveAt}`;
        
        if (!this.alertedBounties.has(bountyKey)) {
          this.alertedBounties.add(bountyKey);
          
          newBounties.push({
            battle,
            side: 'attacker',
            bountyEffectiveAt: battle.attacker.bountyEffectiveAt,
            country: battle.attacker.country,
            moneyPer1kDamages: battle.attacker.moneyPer1kDamages ?? 0,
            moneyPool: battle.attacker.moneyPool ?? 0
          });

          logger.info(`New attacker bounty detected: ${battle.attacker.country} in battle ${battle._id}, effective at ${battle.attacker.bountyEffectiveAt}`);
        }
      }

      // Check defender side
      if (battle.defender.bountyEffectiveAt && 
          (battle.defender.moneyPer1kDamages ?? 0) > 0 && 
          (battle.defender.moneyPool ?? 0) > 0) {
        
        const bountyKey = `${battle._id}-defender-${battle.defender.bountyEffectiveAt}`;
        
        if (!this.alertedBounties.has(bountyKey)) {
          this.alertedBounties.add(bountyKey);
          
          newBounties.push({
            battle,
            side: 'defender',
            bountyEffectiveAt: battle.defender.bountyEffectiveAt,
            country: battle.defender.country,
            moneyPer1kDamages: battle.defender.moneyPer1kDamages ?? 0,
            moneyPool: battle.defender.moneyPool ?? 0
          });

          logger.info(`New defender bounty detected: ${battle.defender.country} in battle ${battle._id}, effective at ${battle.defender.bountyEffectiveAt}`);
        }
      }
    }

    if (newBounties.length > 0) {
      logger.info(`Detected ${newBounties.length} new bounties to alert for`);
    }

    return newBounties;
  }

  /**
   * Get count of total bounties we've alerted for (for debugging/metrics)
   */
  getAlertedBountiesCount(): number {
    return this.alertedBounties.size;
  }

  /**
   * Clear old bounty tracking data to prevent memory leaks
   * This could be called periodically, but given the fire-and-forget nature,
   * we might want to keep some history to prevent re-alerting
   * @param olderThanDays Remove bounty tracking older than this many days
   */
  cleanup(_olderThanDays: number = 7): void {
    // Since we're using bountyEffectiveAt timestamps as keys, we could parse them
    // and remove old ones, but for simplicity we'll just clear everything older than X days
    // For now, we'll implement a simple size-based cleanup
    if (this.alertedBounties.size > 10000) {
      logger.warn(`SimpleBountyTracker has ${this.alertedBounties.size} tracked bounties. Clearing to prevent memory issues.`);
      this.alertedBounties.clear();
    }
  }
}