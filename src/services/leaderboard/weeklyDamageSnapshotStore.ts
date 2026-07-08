import { LeaderboardRankEntry } from '../../config/config';
import { prisma } from '../../persistence/prisma';

export type WeeklySnapshotKind = 'users' | 'mu';

/** Sunday 11:02 PM local time — end-of-week snapshot moment */
const SNAPSHOT_HOUR = 23;
const SNAPSHOT_MINUTE = 2;

function isAfterWeekSnapshotMoment(date: Date): boolean {
  return (
    date.getHours() > SNAPSHOT_HOUR ||
    (date.getHours() === SNAPSHOT_HOUR && date.getMinutes() >= SNAPSHOT_MINUTE)
  );
}

/** Week key is the Sunday date (YYYY-MM-DD) when that week ends. */
export function getCurrentWeekEndingDate(from: Date = new Date()): string {
  const date = new Date(from);
  const day = date.getDay();

  if (day === 0 && isAfterWeekSnapshotMoment(from)) {
    date.setDate(date.getDate() + 7);
    return formatWeekEndingDate(date);
  }

  const daysUntilSunday = day === 0 ? 0 : 7 - day;
  date.setDate(date.getDate() + daysUntilSunday);
  return formatWeekEndingDate(date);
}

/** Week key is the Sunday date (YYYY-MM-DD) when the week ends. */
export function formatWeekEndingDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseWeekEndingDate(input: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, SNAPSHOT_HOUR, SNAPSHOT_MINUTE, 0, 0);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function buildUserWeeklyDamageCsv(entries: LeaderboardRankEntry[]): string {
  const lines = ['rank,user_id,username,level,country_code,weekly_damage'];

  entries.forEach((entry, index) => {
    const rank = index + 1;
    const level = entry.level ?? '';
    const countryCode = entry.countryCode ?? '';
    lines.push(
      [
        rank,
        escapeCsvField(entry.id),
        escapeCsvField(entry.name),
        level,
        escapeCsvField(countryCode),
        entry.value,
      ].join(',')
    );
  });

  return lines.join('\n');
}

export function buildMuWeeklyDamageCsv(entries: LeaderboardRankEntry[]): string {
  const lines = ['rank,mu_id,mu_name,weekly_damage'];

  entries.forEach((entry, index) => {
    const rank = index + 1;
    lines.push(
      [rank, escapeCsvField(entry.id), escapeCsvField(entry.name), entry.value].join(',')
    );
  });

  return lines.join('\n');
}

/** @deprecated Use buildUserWeeklyDamageCsv */
export const buildWeeklyDamageCsv = buildUserWeeklyDamageCsv;

export async function writeWeeklySnapshot(
  serverId: string,
  kind: WeeklySnapshotKind,
  weekEnding: string,
  csv: string
): Promise<void> {
  await prisma.weeklyDamageSnapshot.upsert({
    where: { serverId_kind_week: { serverId, kind, week: weekEnding } },
    create: { serverId, kind, week: weekEnding, csv },
    update: { csv },
  });
}

export async function readWeeklySnapshot(
  serverId: string,
  kind: WeeklySnapshotKind,
  weekEnding: string
): Promise<string | null> {
  const row = await prisma.weeklyDamageSnapshot.findUnique({
    where: { serverId_kind_week: { serverId, kind, week: weekEnding } },
  });
  return row?.csv ?? null;
}

export async function listAvailableWeeks(serverId: string): Promise<string[]> {
  const rows = await prisma.weeklyDamageSnapshot.findMany({
    where: { serverId },
    select: { week: true },
  });
  return Array.from(new Set(rows.map(r => r.week))).sort().reverse();
}
