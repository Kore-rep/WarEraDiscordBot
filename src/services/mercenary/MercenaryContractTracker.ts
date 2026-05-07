import { logger } from '../../utils/logger';

// Infer types from SDK method return types
type GetPaginatedAuctionsResponse = Awaited<ReturnType<import('warera-sdk').APIClient['mercenaryContractAuction']['getPaginatedAuctions']>>;
type MercenaryContractAuctionDTO = GetPaginatedAuctionsResponse['result']['data']['items'][number];

/**
 * Represents a new mercenary contract auction that needs to be alerted
 */
export interface NewMercenaryContract {
  auction: MercenaryContractAuctionDTO;
  battleId: string;
  country: string;
  forCountry: string;
  forCountrySide: 'attacker' | 'defender';
  budget: number;
  currentPerK: number;
  minimumDamage: number;
  expiresAt: string;
  professionalsOnly: boolean;
}

/**
 * Simple tracker for mercenary contract auction alerts
 * Uses auction IDs and creation timestamps to track which contracts we've already alerted for
 */
export class MercenaryContractTracker {
  private alertedContracts: Set<string> = new Set(); // Set of auction IDs we've already alerted for

  /**
   * Check mercenary contract auctions for new contracts that haven't been alerted for yet
   * @param auctions Current mercenary contract auctions from API
   * @returns Array of new contracts to alert for
   */
  detectNewContracts(auctions: MercenaryContractAuctionDTO[]): NewMercenaryContract[] {
    const newContracts: NewMercenaryContract[] = [];

    for (const auction of auctions) {
      // Use auction ID as the unique identifier
      const contractKey = auction._id;
      
      if (!this.alertedContracts.has(contractKey)) {
        this.alertedContracts.add(contractKey);
        
        newContracts.push({
          auction,
          battleId: auction.battle,
          country: auction.country,
          forCountry: auction.forCountry,
          forCountrySide: auction.forCountrySide,
          budget: auction.budget,
          currentPerK: auction.currentPerK,
          minimumDamage: auction.minimumDamage,
          expiresAt: auction.expiresAt,
          professionalsOnly: auction.professionalsOnly
        });

        logger.info(`New mercenary contract detected: ${auction.country} seeking mercenaries for ${auction.forCountry} (${auction.forCountrySide}) in battle ${auction.battle}, budget ${auction.budget}, expires at ${auction.expiresAt}`);
      }
    }

    if (newContracts.length > 0) {
      logger.info(`Detected ${newContracts.length} new mercenary contract(s) to alert for`);
    }

    return newContracts;
  }

  /**
   * Get count of total contracts we've alerted for (for debugging/metrics)
   */
  getAlertedContractsCount(): number {
    return this.alertedContracts.size;
  }

  /**
   * Clear old contract tracking data to prevent memory leaks
   * @param olderThanDays Remove contract tracking older than this many days (not used in simple implementation)
   */
  cleanup(_olderThanDays: number = 7): void {
    // Simple size-based cleanup to prevent memory issues
    if (this.alertedContracts.size > 10000) {
      logger.warn(`MercenaryContractTracker has ${this.alertedContracts.size} tracked contracts. Clearing to prevent memory issues.`);
      this.alertedContracts.clear();
    }
  }
}