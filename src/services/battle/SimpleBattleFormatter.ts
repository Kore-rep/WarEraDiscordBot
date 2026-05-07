import { NewBounty } from './SimpleBountyTracker';

// Infer types from SDK method return types  
type GetCountryByIdResponse = Awaited<ReturnType<import('../api/WarEraApiClient').APIClient['country']['getCountryById']>>;
type CountryDTO = GetCountryByIdResponse['result']['data'];
type GetRegionsObjectResponse = Awaited<ReturnType<import('../api/WarEraApiClient').APIClient['region']['getRegionsObject']>>;
type RegionDTO = GetRegionsObjectResponse['result']['data'][string];

/**
 * Simple formatter for bounty alert messages
 * Creates clean, minimal notifications without complex formatting
 */
export class SimpleBattleFormatter {
  
  /**
   * Format a simple bounty alert message
   * @param newBounty The new bounty to format
   * @param countries Map of country IDs to country data
   * @param regions Map of region IDs to region data
   * @returns Formatted message string
   */
  static formatBountyAlert(newBounty: NewBounty, countries: Map<string, CountryDTO>, regions: Map<string, RegionDTO>): string {
    const battle = newBounty.battle;
    const battleLink = `https://app.warera.io/battle/${battle._id}`;
    
    // Get battle location (region name)
    const regionName = this.getRegionName(battle.defender.region, regions) || 
                      this.getRegionName(battle.attacker.region, regions) || 
                      'Unknown Region';
    
    // Get attacker and defender names
    const attackerName = this.getCountryName(battle.attacker.country, countries);
    const defenderName = this.getCountryName(battle.defender.country, countries);
    
    // Get bounty creator name
    const bountyCountryName = this.getCountryName(newBounty.country, countries);
    
    // Format numbers with thousand separators
    const moneyPer1k = this.formatNumber(newBounty.moneyPer1kDamages);
    const poolValue = this.formatNumber(newBounty.moneyPool);
    
    // Calculate time until bounty becomes active
    const timeUntilActive = this.calculateTimeUntilActive(newBounty.bountyEffectiveAt);
    
    // Create the message in the requested format
    const message = [
      `🎯 **New Bounty Alert**`,
      ``,
      `**Battle for ${regionName}**`,
      `⚔️ **Attacker**: ${attackerName}`,
      `🛡️ **Defender**: ${defenderName}`,
      ``,
      `**Bounty for ${bountyCountryName}**`,
      `💰 **Rate**: ${moneyPer1k} gold per 1k damage`,
      `💼 **Pool**: ${poolValue} gold`,
      `⏰ **Active**: ${timeUntilActive}`,
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
   * Get region name from regions map, with fallback to ID
   */
  private static getRegionName(regionId: string, regions: Map<string, RegionDTO>): string | null {
    if (!regionId) return null;
    const region = regions.get(regionId);
    return region?.name || regionId;
  }

  /**
   * Format a number with thousand separators
   */
  private static formatNumber(num: number): string {
    return num.toLocaleString('en-US');
  }

  /**
   * Generate Discord timestamp for when bounty becomes active
   * @param bountyEffectiveAt ISO timestamp when bounty becomes effective
   * @returns Discord timestamp format that updates automatically
   */
  private static calculateTimeUntilActive(bountyEffectiveAt: string): string {
    try {
      const effectiveTime = new Date(bountyEffectiveAt);
      const now = new Date();
      
      // If bounty is already active
      if (effectiveTime.getTime() <= now.getTime()) {
        return '**Active now**';
      }
      
      // Convert to Unix timestamp (seconds since epoch)
      const unixTimestamp = Math.floor(effectiveTime.getTime() / 1000);
      
      // Return Discord's relative timestamp format
      return `<t:${unixTimestamp}:R>`;
      
    } catch (error) {
      // If we can't parse the timestamp, just return it as-is
      return bountyEffectiveAt;
    }
  }
}