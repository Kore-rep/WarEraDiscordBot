
import { ChangeEntry } from './BattleTracker';

// Infer types from SDK method return types
type GetBattlesResponse = Awaited<ReturnType<import('warera-sdk').APIClient['battle']['getBattles']>>;
type BattleDTO = GetBattlesResponse['result']['data']['items'][number];
type GetCountryByIdResponse = Awaited<ReturnType<import('warera-sdk').APIClient['country']['getCountryById']>>;
type CountryDTO = GetCountryByIdResponse['result']['data'];
type GetRegionsObjectResponse = Awaited<ReturnType<import('warera-sdk').APIClient['region']['getRegionsObject']>>;
type RegionDTO = GetRegionsObjectResponse['result']['data'][string];
type ChangeType = 'new' | 'bounty_increased' | 'bounty_decreased' | 'pool_increased' | 'pool_decreased';

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
 * Create a points bar that fills from left (attacker) and right (defender), meeting in the middle
 * Each side fills proportionally based on points/230, where 230 = full bar to the middle
 * @param attackerPoints - Attacker points (0-230)
 * @param defenderPoints - Defender points (0-230)
 * @param maxPoints - Maximum points value (default: 230)
 * @param barLength - Total length of the bar (default: 28 for mobile)
 * @returns Formatted bar string with ANSI colors
 */
function createPointsBar(attackerPoints: number, defenderPoints: number, maxPoints: number = 230, barLength: number = 28): string {
  // Use the same barLength as damage bar (28 chars total including separator)
  // Middle separator takes 1 character
  const middleSeparatorLength = 1;
  const availableBarLength = barLength - middleSeparatorLength;
  const halfLength = Math.floor(availableBarLength / 2);
  
  // Calculate fill ratio for each side (0 to 1, where 1 = full bar to middle)
  const attackerRatio = Math.min(1, Math.max(0, attackerPoints / maxPoints));
  const defenderRatio = Math.min(1, Math.max(0, defenderPoints / maxPoints));
  
  // Calculate how many characters each side should fill (from their side toward the middle)
  const attackerFillLength = Math.round(attackerRatio * halfLength);
  const defenderFillLength = Math.round(defenderRatio * halfLength);
  
  // Create the bars
  // Attacker side: fills from left toward middle (red)
  const attackerBar = attackerFillLength > 0 
    ? `\x1b[1;31m${'█'.repeat(attackerFillLength)}${'░'.repeat(halfLength - attackerFillLength)}\x1b[0m`
    : '░'.repeat(halfLength);
  
  // Defender side: fills from right toward middle (blue)
  const defenderBar = defenderFillLength > 0
    ? `\x1b[1;34m${'░'.repeat(halfLength - defenderFillLength)}${'█'.repeat(defenderFillLength)}\x1b[0m`
    : '░'.repeat(halfLength);
  
  // Combine with middle separator (same total length as damage bar)
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
 * Format a timestamp for the change log
 */
function formatTimestamp(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const ampm = date.getHours() >= 12 ? 'pm' : 'am';
  const displayHours = date.getHours() % 12 || 12;
  
  return `${day}/${month}/${year} - ${displayHours}:${minutes} ${ampm}`;
}

/**
 * Format change log entries, trimming if necessary to fit within character limit
 */
function formatChangeLog(changeHistory: ChangeEntry[], maxLength: number = Infinity): { log: string; entriesUsed: number } {
  if (changeHistory.length === 0) return { log: '', entriesUsed: 0 };
  
  const logEntries: string[] = [];
  let currentLength = 0;
  
  // Start from most recent entries and work backwards
  for (let i = changeHistory.length - 1; i >= 0; i--) {
    const entry = changeHistory[i];
    const timestamp = formatTimestamp(entry.timestamp);
    const sideLabel = entry.side === 'attacker' ? 'Attacker' : 'Defender';
    const typeLabel = entry.type === 'bounty' ? 'Bounty' : 'Pool';
    const change = entry.newValue - entry.oldValue;
    const changeStr = change > 0 
      ? `\x1b[1;32m+${change.toFixed(entry.type === 'bounty' ? 1 : 0)}\x1b[0m`
      : `\x1b[1;31m${change.toFixed(entry.type === 'bounty' ? 1 : 0)}\x1b[0m`;
    
    let entryText: string;
    if (entry.type === 'bounty') {
      entryText = `${timestamp} - ${sideLabel} ${typeLabel} changed to ${entry.newValue.toFixed(1)} from ${entry.oldValue.toFixed(1)} (${changeStr})`;
    } else {
      entryText = `${timestamp} - ${sideLabel} ${typeLabel} increased to ${formatNumber(entry.newValue)} from ${formatNumber(entry.oldValue)}`;
    }
    
    // Check if adding this entry would exceed the limit
    const entryLength = entryText.length + 1; // +1 for newline
    if (currentLength + entryLength > maxLength) {
      break;
    }
    
    logEntries.unshift(entryText); // Add to beginning to maintain chronological order
    currentLength += entryLength;
  }
  
  return {
    log: logEntries.join('\n'),
    entriesUsed: logEntries.length
  };
}

/**
 * Get change indicator text
 */
function getChangeIndicator(changeType: ChangeType): string {
  switch (changeType) {
    case 'new':
      return '\x1b[1;33m🆕 New Battle\x1b[0m';
    case 'pool_increased':
      return '\x1b[1;32m💰 Pool Increased\x1b[0m';
    case 'bounty_increased':
      return '\x1b[1;32m📈 Bounty Increased\x1b[0m';
    case 'bounty_decreased':
      return '\x1b[1;31m📉 Bounty Decreased\x1b[0m';
    default:
      return '';
  }
}

/**
 * Format a single battle into a mobile-friendly vertical display string
 */
function formatSingleBattle(
  battle: BattleDTO,
  countries: Map<string, CountryDTO>,
  regions: Map<string, RegionDTO>,
  changeType?: ChangeType,
  changeHistory?: ChangeEntry[]
): string {
  // Use currentRound damage values if available, otherwise fall back to battle totals
  const attackerDamage = battle.currentRound?.attacker.damages ?? battle.attacker.damages ?? 0;
  const defenderDamage = battle.currentRound?.defender.damages ?? battle.defender.damages ?? 0;
  
  // Get points from currentRound if available
  const attackerPoints = battle.currentRound?.attacker.points ?? 0;
  const defenderPoints = battle.currentRound?.defender.points ?? 0;
  
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

  // Create the damage bar (28 chars total)
  const damageBar = createDamageBar(attackerDamage, defenderDamage, 28);
  
  // Create the points bar (same length as damage bar - 28 chars total)
  const pointsBar = createPointsBar(attackerPoints, defenderPoints, 230, 28);
  
  // Build the battle UI
  const battleLines: string[] = [
    '```ansi',
    `\x1b[1;36m📍 ${truncatedRegionName}\x1b[0m`,
  ];

  // Add change indicator if provided
  if (changeType) {
    const indicator = getChangeIndicator(changeType);
    if (indicator) {
      battleLines.push('');
      battleLines.push(indicator);
    }
  }

  battleLines.push(
    '',
    `\x1b[1;31m⚔️ ${truncatedAttackerName}\x1b[0m`,
    `   ${formatNumber(attackerDamage)} dmg`,
    `   \x1b[1;32m${formatNumber(attackerBounty)}\x1b[0m💰/1k`,
    `   \x1b[0;33m${formatNumber(attackerPool)}\x1b[0m💼`,
    '',
    `   ${damageBar}`,
    '',
    `   ${pointsBar}`,
    '',
    `\x1b[1;34m🛡️  ${truncatedDefenderName}\x1b[0m`,
    `   ${formatNumber(defenderDamage)} dmg`,
    `   \x1b[1;32m${formatNumber(defenderBounty)}\x1b[0m💰/1k`,
    `   \x1b[0;33m${formatNumber(defenderPool)}\x1b[0m💼`,
  );

  // Build base message without change log to check length
  const baseMessage = battleLines.join('\n') + '\n```';
  const baseLength = baseMessage.length;
  const DISCORD_CHAR_LIMIT = 2000;
  
  // Calculate available space for change log
  // Account for separator, "Change History:" label, and battle link
  const separatorLine = '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  const historyLabel = '\nChange History:';
  const battleLink = `\n\n🔗 https://app.warera.io/battle/${battle._id}`;
  const overhead = separatorLine.length + historyLabel.length + battleLink.length;
  const availableForLog = DISCORD_CHAR_LIMIT - baseLength - overhead;

  // Add change log if available and there's space
  if (changeHistory && changeHistory.length > 0 && availableForLog > 50) {
    // Format change log with character limit
    const { log } = formatChangeLog(changeHistory, availableForLog);
    if (log) {
      battleLines.push('');
      battleLines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      battleLines.push('Change History:');
      battleLines.push(log);
    }
  }

  // Add battle link
  battleLines.push('');
  battleLines.push(`🔗 https://app.warera.io/battle/${battle._id}`);
  battleLines.push('```');

  const finalMessage = battleLines.join('\n');
  
  // Final safety check - if still too long, remove change log entirely
  if (finalMessage.length > DISCORD_CHAR_LIMIT) {
    // Rebuild without change log
    const minimalLines = [
      '```ansi',
      `\x1b[1;36m📍 ${truncatedRegionName}\x1b[0m`,
    ];
    
    if (changeType) {
      const indicator = getChangeIndicator(changeType);
      if (indicator) {
        minimalLines.push('');
        minimalLines.push(indicator);
      }
    }
    
    minimalLines.push(
      '',
      `\x1b[1;31m⚔️ ${truncatedAttackerName}\x1b[0m`,
      `   ${formatNumber(attackerDamage)} dmg`,
      `   \x1b[1;32m${formatNumber(attackerBounty)}\x1b[0m💰/1k`,
      `   \x1b[0;33m${formatNumber(attackerPool)}\x1b[0m💼`,
      '',
      `   ${damageBar}`,
      '',
      `   ${pointsBar}`,
      '',
      `\x1b[1;34m🛡️  ${truncatedDefenderName}\x1b[0m`,
      `   ${formatNumber(defenderDamage)} dmg`,
      `   \x1b[1;32m${formatNumber(defenderBounty)}\x1b[0m💰/1k`,
      `   \x1b[0;33m${formatNumber(defenderPool)}\x1b[0m💼`,
      '',
      `🔗 https://app.warera.io/battle/${battle._id}`,
      '```'
    );
    
    return minimalLines.join('\n');
  }

  return finalMessage;
}

/**
 * BattleFormatter class for formatting battle messages
 */
export class BattleFormatter {
  /**
   * Format battle details into a single Discord message
   * Automatically trims change history if message exceeds 2000 characters
   * @param battle - Battle to display
   * @param countries - Map of countryId -> CountryDTO for displaying country names
   * @param regions - Map of regionId -> RegionDTO for displaying region names
   * @param changeType - Optional change type
   * @param changeHistory - Optional change history
   * @returns Single formatted message string (guaranteed under 2000 characters)
   */
  formatBattleMessage(
    battle: BattleDTO,
    countries: Map<string, unknown> = new Map(),
    regions: Map<string, unknown> = new Map(),
    changeType?: ChangeType,
    changeHistory?: ChangeEntry[]
  ): string {
    return formatSingleBattle(
      battle,
      countries as Map<string, CountryDTO>,
      regions as Map<string, RegionDTO>,
      changeType,
      changeHistory
    );
  }
}