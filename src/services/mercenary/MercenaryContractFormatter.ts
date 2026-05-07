import { NewMercenaryContract } from './MercenaryContractTracker';

// Infer types from SDK method return types  
type GetCountryByIdResponse = Awaited<ReturnType<import('warera-sdk').APIClient['country']['getCountryById']>>;
type CountryDTO = GetCountryByIdResponse['result']['data'];

/**
 * Formatter for mercenary contract auction alert messages
 * Creates clean, minimal notifications for new mercenary contract auctions
 */
export class MercenaryContractFormatter {
  
  /**
   * Format a simple mercenary contract alert message
   * @param newContract The new mercenary contract to format
   * @param countries Map of country IDs to country data
   * @returns Formatted message string
   */
  static formatContractAlert(newContract: NewMercenaryContract, countries: Map<string, CountryDTO>): string {
    const contractorCountryName = this.getCountryName(newContract.country, countries);
    const targetCountryName = this.getCountryName(newContract.forCountry, countries);
    const battleLink = `https://app.warera.io/battle/${newContract.battleId}`;
    
    // Format numbers with thousand separators
    const budget = this.formatNumber(newContract.budget);
    const currentPerK = this.formatNumber(newContract.currentPerK);
    const minimumDamage = this.formatNumber(newContract.minimumDamage);
    
    // Calculate time until contract expires
    const timeUntilExpiry = this.calculateTimeUntilExpiry(newContract.expiresAt);
    
    // Determine side emoji and text
    const sideEmoji = newContract.forCountrySide === 'attacker' ? '⚔️' : '🛡️';
    const sideText = newContract.forCountrySide === 'attacker' ? 'attacking' : 'defending';
    
    // Professional requirement
    const professionalsText = newContract.professionalsOnly ? ' (Professionals only)' : '';
    
    // Create simple message
    const message = [
      `💼 **New Mercenary Contract**`,
      ``,
      `**Contractor**: ${contractorCountryName}`,
      `**Seeking mercenaries for**: ${sideEmoji} ${targetCountryName} (${sideText})${professionalsText}`,
      `**Budget**: ${budget} gold`,
      `**Current rate**: ${currentPerK} gold per 1k damage`,
      `**Minimum damage**: ${minimumDamage}`,
      `**Expires**: ${timeUntilExpiry}`,
      ``,
      `🔗 ${battleLink}`
    ].join('\n');
    
    return message;
  }

  /**
   * Get country name from countries map, with fallback to ID
   */
  private static getCountryName(countryId: string, countries: Map<string, CountryDTO>): string {
    const country = countries.get(countryId);
    return country?.name || countryId;
  }

  /**
   * Format a number with thousand separators
   */
  private static formatNumber(num: number): string {
    return num.toLocaleString('en-US');
  }

  /**
   * Generate Discord timestamp for when contract expires
   * @param expiresAt ISO timestamp when contract expires
   * @returns Discord timestamp format that updates automatically
   */
  private static calculateTimeUntilExpiry(expiresAt: string): string {
    try {
      const expiryTime = new Date(expiresAt);
      const now = new Date();
      
      // If contract has already expired
      if (expiryTime.getTime() <= now.getTime()) {
        return '**Expired**';
      }
      
      // Convert to Unix timestamp (seconds since epoch)
      const unixTimestamp = Math.floor(expiryTime.getTime() / 1000);
      
      // Return Discord's relative timestamp format
      return `<t:${unixTimestamp}:R>`;
      
    } catch (error) {
      // If we can't parse the timestamp, just return it as-is
      return expiresAt;
    }
  }
}