import * as fs from 'fs';
import * as path from 'path';
import { LeaderboardRankEntry } from '../../config/config';

const SNAPSHOT_BASE_DIR = path.join(process.cwd(), 'data', 'weekly-damage');

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

function getServerSnapshotDir(serverId: string): string {
  return path.join(SNAPSHOT_BASE_DIR, serverId);
}

function getSnapshotFilePath(
  serverId: string,
  kind: WeeklySnapshotKind,
  weekEnding: string
): string {
  return path.join(getServerSnapshotDir(serverId), kind, `${weekEnding}.csv`);
}

export function writeWeeklySnapshot(
  serverId: string,
  kind: WeeklySnapshotKind,
  weekEnding: string,
  csv: string
): void {
  const filePath = getSnapshotFilePath(serverId, kind, weekEnding);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, csv, 'utf-8');
}

export function readWeeklySnapshot(
  serverId: string,
  kind: WeeklySnapshotKind,
  weekEnding: string
): string | null {
  const filePath = getSnapshotFilePath(serverId, kind, weekEnding);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return fs.readFileSync(filePath, 'utf-8');
}

function listWeeksInDir(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs
    .readdirSync(dir)
    .filter(name => name.endsWith('.csv'))
    .map(name => name.slice(0, -4));
}

export function listAvailableWeeks(serverId: string): string[] {
  const serverDir = getServerSnapshotDir(serverId);
  const weeks = new Set([
    ...listWeeksInDir(path.join(serverDir, 'users')),
    ...listWeeksInDir(path.join(serverDir, 'mu')),
    // Legacy flat files from before users/mu split
    ...listWeeksInDir(serverDir),
  ]);

  return Array.from(weeks).sort().reverse();
}
