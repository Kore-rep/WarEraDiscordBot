import { GetUserLiteResponse } from '../services/api/WarEraApiClient';
import { analyzePlayerBuild } from './skillAnalyzer';

// Type alias for the actual user data from the API response
type UserDTO = NonNullable<GetUserLiteResponse['result']['data']>;

export interface UserStatus {
  emoji: string;
  statusText: string;
  resetText: string;
  hasActiveBuff: boolean;
  hasActiveDebuff: boolean;
  buffEndTime?: Date;
  debuffEndTime?: Date;
}

/**
 * Status emojis for different user states
 */
export const STATUS_EMOJIS = {
  injured: '🩹', // debuff active
  strong: '💪',   // buff active
  pill: '💊',     // pill available (no active effects)
} as const;

/**
 * Parse date string to Date object, handling various formats
 */
function parseDate(dateString: string): Date | null {
  try {
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

/**
 * Check if a date is in the future
 */
function isFutureDate(date: Date | null): boolean {
  if (!date) return false;
  return date.getTime() > Date.now();
}

/**
 * Format a date for Discord timestamp display (GMT+0)
 */
function formatDiscordTimestamp(date: Date): string {
  const timestamp = Math.floor(date.getTime() / 1000);
  return `<t:${timestamp}:f>`;
}

/**
 * Get user status information including emoji and text
 */
export function getUserStatus(user: UserDTO): UserStatus {
  // Handle nullable buffs object and its properties
  const buffEndDate = user.buffs?.buffEndAt ? parseDate(user.buffs.buffEndAt) : null;
  const debuffEndDate = user.buffs?.debuffEndAt ? parseDate(user.buffs.debuffEndAt) : null;
  
  const hasActiveBuff = isFutureDate(buffEndDate);
  const hasActiveDebuff = isFutureDate(debuffEndDate);
  
  let emoji: string;
  let statusText: string;

  // Determine status emoji and text
  if (hasActiveDebuff) {
    emoji = STATUS_EMOJIS.injured;
    statusText = `until ${formatDiscordTimestamp(debuffEndDate!)}`;
  } else if (hasActiveBuff) {
    emoji = STATUS_EMOJIS.strong;
    statusText = `until ${formatDiscordTimestamp(buffEndDate!)}`;
  } else {
    emoji = STATUS_EMOJIS.pill;
    statusText = '';
  }

  // Determine reset availability text
  const hasReset = user.leveling?.freeReset ? user.leveling.freeReset > 0 : false;
  const resetText = hasReset ? 'Reset available' : 'Reset unavailable';

  return {
    emoji,
    statusText,
    resetText,
    hasActiveBuff,
    hasActiveDebuff,
    buffEndTime: buffEndDate || undefined,
    debuffEndTime: debuffEndDate || undefined,
  };
}

/**
 * Format a single user entry for the detailed list
 */
export function formatUserEntry(user: UserDTO): string {
  const status = getUserStatus(user);
  const level = user.leveling?.level || 0;
  const username = user.username || 'Unknown';
  
  // Get build analysis for percentage display
  const buildAnalysis = analyzePlayerBuild(user);

  let entry = `\`Level ${level}\` ${username}`;
  
  // Add build percentage for eco and hybrid players
  if (buildAnalysis.mode === 'eco') {
    entry += ` (${buildAnalysis.ecoPercentage}% Eco)`;
  } else if (buildAnalysis.mode === 'hybrid') {
    const dominantModeText = buildAnalysis.dominantMode === 'eco' ? 'Eco' : 'War';
    entry += ` (${buildAnalysis.dominantPercentage}% ${dominantModeText})`;
  }
  
  entry += ` ${status.emoji}`;
  
  if (status.statusText) {
    entry += ` ${status.statusText}`;
  }
  
  entry += ` - ${status.resetText}`;

  return entry;
}

/**
 * Format multiple users for display, handling message length limits
 */
export function formatUserList(users: UserDTO[], mode: string, maxLength: number = 1800): string[] {
  const messages: string[] = [];
  let currentMessage = `**${mode} Mode Players (${users.length}):**\n`;
  
  for (const user of users) {
    const userEntry = formatUserEntry(user) + '\n';
    
    // Check if adding this user would exceed the length limit
    if (currentMessage.length + userEntry.length > maxLength) {
      // Push current message and start a new one
      messages.push(currentMessage.trim());
      currentMessage = userEntry;
    } else {
      currentMessage += userEntry;
    }
  }
  
  // Add the final message if it has content
  if (currentMessage.trim()) {
    messages.push(currentMessage.trim());
  }
  
  return messages;
}

/**
 * Create a summary text for build analysis results
 */
export function createBuildSummary(
  countryName: string,
  totalCitizens: number,
  includedCount: number,
  minLevel: number,
  ecoCount: number,
  warCount: number,
  hybridCount: number
): string {
  return [
    `**Country:** ${countryName}`,
    `**Total Citizens:** ${totalCitizens.toLocaleString()}`,
    `**Included (Lvl >= ${minLevel}):** ${includedCount.toLocaleString()}`,
    `**War Mode:** ${warCount.toLocaleString()}`,
    `**Hybrid:** ${hybridCount.toLocaleString()}`,
    `**Eco Mode:** ${ecoCount.toLocaleString()}`,
    '',
    'Click buttons below for detailed player lists:'
  ].join('\n');
}