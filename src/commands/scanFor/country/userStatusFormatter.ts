import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { ScanUserLite } from '../../../services/scan/ScanService';
import { analyzePlayerBuild, type BuildMode, type GroupedUsers } from './skillAnalyzer';

type UserDTO = ScanUserLite;

/** Human-readable label for a build mode (customId keys are lowercase/no-space). */
export function modeLabel(mode: BuildMode): string {
  return { war: 'War', softwar: 'Soft War', hybrid: 'Hybrid', eco: 'Eco' }[mode];
}

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

const DEFAULT_RESET_COOLDOWN_DAYS = 7;
const MS_PER_DAY = 86_400_000;

/**
 * Whether a skill reset is currently available: either a stored bonus reset
 * (`leveling.freeReset`), or the periodic free reset — available once
 * `resetCooldownDays` (game config `user.resetSkillDaysCooldown`) have passed
 * since `dates.lastSkillsResetAt` (never having reset also counts).
 */
export function isSkillResetAvailable(
  user: UserDTO,
  resetCooldownDays: number = DEFAULT_RESET_COOLDOWN_DAYS,
  now: Date = new Date()
): boolean {
  if ((user.leveling?.freeReset ?? 0) > 0) {
    return true;
  }
  const lastReset = user.dates?.lastSkillsResetAt ? parseDate(user.dates.lastSkillsResetAt) : null;
  if (!lastReset) {
    return true;
  }
  return now.getTime() - lastReset.getTime() >= resetCooldownDays * MS_PER_DAY;
}

/**
 * Get user status information including emoji and text
 */
export function getUserStatus(user: UserDTO, resetCooldownDays?: number): UserStatus {
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
  const resetText = isSkillResetAvailable(user, resetCooldownDays)
    ? 'Reset available'
    : 'Reset unavailable';

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
export function formatUserEntry(user: UserDTO, resetCooldownDays?: number): string {
  const status = getUserStatus(user, resetCooldownDays);
  const level = user.leveling?.level || 0;
  const username = user.username || 'Unknown';
  
  // Get build analysis for percentage display
  const buildAnalysis = analyzePlayerBuild(user);

  let entry = `\`Level ${level}\` ${username}`;
  
  // Add build percentage for eco, hybrid, and soft war players
  if (buildAnalysis.mode === 'eco') {
    entry += ` (${buildAnalysis.ecoPercentage}% Eco)`;
  } else if (buildAnalysis.mode === 'softwar') {
    // War-dominant with companies on the side — show the companies split too.
    entry += ` (${buildAnalysis.dominantPercentage}% War, ${buildAnalysis.companiesPercentage}% Companies)`;
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
export function formatUserList(
  users: UserDTO[],
  mode: string,
  maxLength: number = 1800,
  resetCooldownDays?: number
): string[] {
  const messages: string[] = [];
  let currentMessage = `**${mode} Mode Players (${users.length}):**\n`;

  for (const user of users) {
    const userEntry = formatUserEntry(user, resetCooldownDays) + '\n';
    
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
  hybridCount: number,
  softWarCount: number
): string {
  return [
    `**Country:** ${countryName}`,
    `**Total Citizens:** ${totalCitizens.toLocaleString()}`,
    `**Included (Lvl >= ${minLevel}):** ${includedCount.toLocaleString()}`,
    `**War Mode:** ${warCount.toLocaleString()}`,
    `**Soft War:** ${softWarCount.toLocaleString()}`,
    `**Hybrid:** ${hybridCount.toLocaleString()}`,
    `**Eco Mode:** ${ecoCount.toLocaleString()}`,
    '',
    'Click buttons below for detailed player lists:'
  ].join('\n');
}

/**
 * Build the row of per-mode "details" buttons shown under a build summary.
 * customId format: builds:{countryId}:{mode}:{page}:{minLevel} (see buildsButtonHandler).
 */
export function buildDetailButtonRow(
  countryId: string,
  minLevel: number,
  groupedUsers: GroupedUsers
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`builds:${countryId}:war:0:${minLevel}`)
      .setLabel(`War Details (${groupedUsers.war.length})`)
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`builds:${countryId}:softwar:0:${minLevel}`)
      .setLabel(`Soft War Details (${groupedUsers.softwar.length})`)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`builds:${countryId}:hybrid:0:${minLevel}`)
      .setLabel(`Hybrid Details (${groupedUsers.hybrid.length})`)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`builds:${countryId}:eco:0:${minLevel}`)
      .setLabel(`Eco Details (${groupedUsers.eco.length})`)
      .setStyle(ButtonStyle.Success)
  );
}