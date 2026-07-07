import { EmbedBuilder } from 'discord.js';
import {
  LeaderboardRankEntry,
  LeaderboardSnapshot,
  LevelBracket,
} from '../../config/config';
import { countryCodeToFlagEmoji } from '../../utils/countryFlag';

const COLOR_WEEKLY = 0x3498db;
const COLOR_PLAYER_TOTAL = 0xf1c40f;
const COLOR_MU = 0xe74c3c;

export interface LeaderboardDisplayData {
  playerWeeklyByBracket: Record<string, LeaderboardRankEntry[]>;
  playerTotal: LeaderboardRankEntry[];
  muWeekly: LeaderboardRankEntry[];
  muTotal: LeaderboardRankEntry[];
  levelBrackets: LevelBracket[];
  topCount: number;
  lastSnapshot?: LeaderboardSnapshot;
  updatedAt: Date;
  nextRefreshAt: Date;
}

function formatDamage(value: number): string {
  return value.toLocaleString('en-US');
}

function formatRankDelta(
  entityId: string,
  currentRank: number,
  previousList: LeaderboardRankEntry[] | undefined
): string {
  if (!previousList || previousList.length === 0) {
    return 'NEW';
  }

  const prevIndex = previousList.findIndex(entry => entry.id === entityId);
  if (prevIndex === -1) {
    return 'NEW';
  }

  const prevRank = prevIndex + 1;
  const delta = prevRank - currentRank;
  if (delta === 0) {
    return '—';
  }
  if (delta > 0) {
    return `↑${delta}`;
  }
  return `↓${Math.abs(delta)}`;
}

function rankPrefix(rank: number): string {
  if (rank === 1) {
    return '🥇';
  }
  if (rank === 2) {
    return '🥈';
  }
  if (rank === 3) {
    return '🥉';
  }
  return `${rank}.`;
}

function formatPlayerName(entry: LeaderboardRankEntry, rank: number): string {
  const flag = entry.countryCode ? `${countryCodeToFlagEmoji(entry.countryCode)} ` : '';
  const name = `${flag}${entry.name}`;
  return rank === 1 ? `**${name}**` : name;
}

function formatEntryLine(
  entry: LeaderboardRankEntry,
  rank: number,
  previousList: LeaderboardRankEntry[] | undefined,
  options?: { showLevel?: boolean }
): string {
  const prefix = rankPrefix(rank);
  const delta = formatRankDelta(entry.id, rank, previousList);
  const levelPart = options?.showLevel ? `Lv ${entry.level ?? '?'} · ` : '';
  const name = options?.showLevel
    ? formatPlayerName(entry, rank)
    : rank === 1
      ? `**${entry.name}**`
      : entry.name;
  return `${prefix} ${levelPart}${name} — ${formatDamage(entry.value)} dmg · ${delta}`;
}

function buildRankedDescription(
  entries: LeaderboardRankEntry[],
  previousList: LeaderboardRankEntry[] | undefined,
  emptyMessage: string,
  options?: { showLevel?: boolean }
): string {
  if (entries.length === 0) {
    return emptyMessage;
  }

  return entries
    .map((entry, index) => formatEntryLine(entry, index + 1, previousList, options))
    .join('\n');
}

function createEmbed(
  title: string,
  description: string,
  color: number,
  topCount: number
): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .setFooter({ text: `Top ${topCount}` });
}

export function buildLeaderboardPayload(data: LeaderboardDisplayData): {
  content: string;
  embeds: EmbedBuilder[];
} {
  const updatedTs = Math.floor(data.updatedAt.getTime() / 1000);
  const nextTs = Math.floor(data.nextRefreshAt.getTime() / 1000);

  const content =
    `🏆 **War Era Leaderboards** · Updated <t:${updatedTs}:F> · Next refresh <t:${nextTs}:R>`;

  const embeds: EmbedBuilder[] = [];
  const snapshot = data.lastSnapshot;

  for (const bracket of data.levelBrackets) {
    const entries = data.playerWeeklyByBracket[bracket.label] || [];
    const previous = snapshot?.playerWeeklyByBracket[bracket.label];
    embeds.push(
      createEmbed(
        `⚔️ Weekly Player Damage · Lv ${bracket.label}`,
        buildRankedDescription(entries, previous, '_No players in this bracket._', {
          showLevel: true,
        }),
        COLOR_WEEKLY,
        data.topCount
      )
    );
  }

  embeds.push(
    createEmbed(
      '👑 Player Total Damage',
      buildRankedDescription(
        data.playerTotal,
        snapshot?.playerTotal,
        '_No player data available._',
        { showLevel: true }
      ),
      COLOR_PLAYER_TOTAL,
      data.topCount
    )
  );

  embeds.push(
    createEmbed(
      '🛡️ Military Unit Weekly Damage',
      buildRankedDescription(
        data.muWeekly,
        snapshot?.muWeekly,
        '_No military unit data available._'
      ),
      COLOR_MU,
      data.topCount
    )
  );

  embeds.push(
    createEmbed(
      '🛡️ Military Unit Total Damage',
      buildRankedDescription(
        data.muTotal,
        snapshot?.muTotal,
        '_No military unit data available._'
      ),
      COLOR_MU,
      data.topCount
    )
  );

  return { content, embeds: embeds.slice(0, 10) };
}

export function parseLevelBrackets(input: string): LevelBracket[] {
  const parts = input.split(',').map(part => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    throw new Error('At least one level bracket is required.');
  }

  const brackets: LevelBracket[] = [];

  for (const part of parts) {
    if (part.endsWith('+')) {
      const minLevel = parseInt(part.slice(0, -1), 10);
      if (isNaN(minLevel)) {
        throw new Error(`Invalid bracket: ${part}`);
      }
      brackets.push({ minLevel, label: part });
      continue;
    }

    const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (!rangeMatch) {
      throw new Error(`Invalid bracket format: ${part}. Use "20-29" or "40+".`);
    }

    const minLevel = parseInt(rangeMatch[1], 10);
    const maxLevel = parseInt(rangeMatch[2], 10);
    if (minLevel > maxLevel) {
      throw new Error(`Invalid bracket range: ${part}`);
    }

    brackets.push({ minLevel, maxLevel, label: part.replace(/\s/g, '') });
  }

  return brackets;
}

export function userMatchesBracket(level: number, bracket: LevelBracket): boolean {
  if (level < bracket.minLevel) {
    return false;
  }
  if (bracket.maxLevel !== undefined && level > bracket.maxLevel) {
    return false;
  }
  return true;
}
