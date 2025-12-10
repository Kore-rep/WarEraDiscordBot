
// Infer types from SDK method return types
type GetBattlesResponse = Awaited<ReturnType<import('warera-sdk').APIClient['battle']['getBattles']>>;
type BattleDTO = GetBattlesResponse['result']['data']['items'][number];
type GetCountryByIdResponse = Awaited<ReturnType<import('warera-sdk').APIClient['country']['getCountryById']>>;
type CountryDTO = GetCountryByIdResponse['result']['data'];
type GetRegionsObjectResponse = Awaited<ReturnType<import('warera-sdk').APIClient['region']['getRegionsObject']>>;
type RegionDTO = GetRegionsObjectResponse['result']['data'][string];

/**
 * Format a number with thousand separators
 */
function formatNumber(num: number): string {
  return num.toLocaleString('en-US');
}

/**
 * Create a visual damage bar representation with colors
 * Optimized for mobile screens - shorter bar length
 * @param attackerDamage - Attacker damage
 * @param defenderDamage - Defender damage
 * @param barLength - Total length of the bar (default: 28 for mobile)
 * @returns Formatted bar string with ANSI colors and emojis
 */
function createDamageBar(attackerDamage: number, defenderDamage: number, barLength: number = 28): string {
  const totalDamage = attackerDamage + defenderDamage;
  
  if (totalDamage === 0) {
    // Empty bar - equal split with emojis
    const halfLength = Math.floor(barLength / 2);
    return `\x1b[1;31m⚔️${'░'.repeat(halfLength - 1)}\x1b[0m│\x1b[1;34m🛡️${'░'.repeat(barLength - halfLength - 1)}\x1b[0m`;
  }
  
  // Calculate the division point based on damage ratio
  const attackerRatio = attackerDamage / totalDamage;
  const attackerLength = Math.max(1, Math.min(barLength - 1, Math.round(attackerRatio * barLength)));
  const defenderLength = barLength - attackerLength;
  
  // Create bars with constant total length
  // Attacker bar (left side, red) - starts with sword emoji
  const attackerBarChars = attackerLength > 1 ? '█'.repeat(attackerLength - 1) : '';
  const attackerBar = `\x1b[1;31m⚔️${attackerBarChars}\x1b[0m`;
  
  // Defender bar (right side, blue) - starts with shield emoji
  const defenderBarChars = defenderLength > 1 ? '█'.repeat(defenderLength - 1) : '';
  const defenderBar = `\x1b[1;34m🛡️${defenderBarChars}\x1b[0m`;
  
  // Bars meet at the division point
  return `${attackerBar}│${defenderBar}`;
}

/**
 * Get country name from country ID, falling back to ID if not found
 */
function getCountryName(countryId: string, countries: Map<string, CountryDTO>): string {
  const country = countries.get(countryId);
  if (country && country.name) {
    return country.name;
  }
  return `Country ${countryId}`;
}

/**
 * Get region name from region ID, falling back to ID if not found
 */
function getRegionName(regionId: string, regions: Map<string, RegionDTO>): string {
  const region = regions.get(regionId);
  if (region && region.name) {
    return region.name;
  }
  return `Region ${regionId}`;
}

/**
 * Format a single battle into a mobile-friendly vertical display string
 */
function formatSingleBattle(
  battle: BattleDTO,
  countries: Map<string, CountryDTO>,
  regions: Map<string, RegionDTO>
): string {
  const attackerDamage = battle.attacker.damages || 0;
  const defenderDamage = battle.defender.damages || 0;
  const attackerBounty = battle.attacker.moneyPer1kDamages || 0;
  const defenderBounty = battle.defender.moneyPer1kDamages || 0;
  const attackerPool = battle.attacker.moneyPool || 0;
  const defenderPool = battle.defender.moneyPool || 0;

  // Get country names
  const attackerName = getCountryName(battle.attacker.country, countries);
  const defenderName = getCountryName(battle.defender.country, countries);
  
  // Get region name (battles typically occur in the defender's region)
  const regionName = battle.defender.region 
    ? getRegionName(battle.defender.region, regions)
    : battle.attacker.region 
      ? getRegionName(battle.attacker.region, regions)
      : 'Unknown Region';

  // Truncate names for mobile (max 18 chars)
  const maxNameLength = 18;
  const truncatedAttackerName = attackerName.length > maxNameLength 
    ? attackerName.substring(0, maxNameLength - 3) + '...' 
    : attackerName;
  const truncatedDefenderName = defenderName.length > maxNameLength 
    ? defenderName.substring(0, maxNameLength - 3) + '...' 
    : defenderName;
  
  // Truncate region name if needed
  const truncatedRegionName = regionName.length > 22
    ? regionName.substring(0, 22 - 3) + '...'
    : regionName;

  // Create the damage bar
  const damageBar = createDamageBar(attackerDamage, defenderDamage, 28);
  
  // Format the battle UI in mobile-friendly vertical layout
  return [
    '```ansi',
    `\x1b[1;36m📍 ${truncatedRegionName}\x1b[0m`,
    '',
    `\x1b[1;31m⚔️ ${truncatedAttackerName}\x1b[0m`,
    `   ${formatNumber(attackerDamage)} dmg`,
    `   \x1b[1;32m${formatNumber(attackerBounty)}\x1b[0m💰/1k`,
    `   \x1b[0;33m${formatNumber(attackerPool)}\x1b[0m💼`,
    '',
    `   ${damageBar}`,
    '',
    `\x1b[1;34m🛡️  ${truncatedDefenderName}\x1b[0m`,
    `   ${formatNumber(defenderDamage)} dmg`,
    `   \x1b[1;32m${formatNumber(defenderBounty)}\x1b[0m💰/1k`,
    `   \x1b[0;33m${formatNumber(defenderPool)}\x1b[0m💼`,
    '```',
  ].join('\n');
}

/**
 * Format battle details into Discord messages with visual UI
 * Automatically chunks messages to stay under Discord's 2000 character limit
 * @param battles - Array of battles to display
 * @param countries - Map of countryId -> CountryDTO for displaying country names
 * @param regions - Map of regionId -> RegionDTO for displaying region names
 * @returns Array of formatted message strings (one or more chunks)
 */
export function formatBattleMessage(
  battles: BattleDTO[], 
  countries: Map<string, CountryDTO> = new Map(),
  regions: Map<string, RegionDTO> = new Map()
): string[] {
  if (battles.length === 0) {
    return ['No battles found.'];
  }

  const DISCORD_CHAR_LIMIT = 2000;
  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentLength = 0;

  for (const battle of battles) {
    const battleUI = formatSingleBattle(battle, countries, regions);
    const battleLength = battleUI.length + 2; // +2 for \n\n separator

    // If adding this battle would exceed the limit, start a new chunk
    if (currentLength + battleLength > DISCORD_CHAR_LIMIT && currentChunk.length > 0) {
      chunks.push(currentChunk.join('\n\n'));
      currentChunk = [];
      currentLength = 0;
    }

    currentChunk.push(battleUI);
    currentLength += battleLength;
  }

  // Add any remaining battles
  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join('\n\n'));
  }

  return chunks;
}