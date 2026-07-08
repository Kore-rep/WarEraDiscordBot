/**
 * One-time migration: import existing JSON/CSV persistence into SQLite.
 *
 *   - config/serverConfig.json           -> Server table (one row per server)
 *   - data/weekly-damage/<id>/<kind>/*.csv -> WeeklyDamageSnapshot table
 *
 * Safe to re-run: rows are upserted. Run once after `prisma migrate deploy`:
 *   npm run db:import                       # local (ts-node)
 *   node dist/scripts/importJsonToSqlite.js # inside the built/production image
 */
import * as fs from 'fs';
import * as path from 'path';
import { prisma } from '../persistence/prisma';
import type { ServerConfig } from '../config/config';

const CONFIG_FILE = path.join(process.cwd(), 'config', 'serverConfig.json');
const WEEKLY_BASE = path.join(process.cwd(), 'data', 'weekly-damage');

function encode(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

async function importServerConfigs(): Promise<number> {
  if (!fs.existsSync(CONFIG_FILE)) {
    console.log(`No ${CONFIG_FILE} found; skipping server config import.`);
    return 0;
  }

  const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) as { servers?: Record<string, ServerConfig> };
  const servers = parsed.servers ?? {};
  let count = 0;

  for (const [id, cfg] of Object.entries(servers)) {
    const data = {
      bountyBattles: encode(cfg.bountyBattles),
      mercenaryContracts: encode(cfg.mercenaryContracts),
      reports: encode(cfg.reports),
      userTracking: encode(cfg.userTracking),
      countryTracking: encode(cfg.countryTracking),
      proxyTracking: encode(cfg.proxyTracking),
      countryGroups: encode(cfg.countryGroups),
      spectre: encode(cfg.spectre),
      leaderboard: encode(cfg.leaderboard),
    };
    await prisma.server.upsert({ where: { id }, create: { id, ...data }, update: data });
    count++;
  }

  console.log(`Imported ${count} server config(s).`);
  return count;
}

async function importWeeklySnapshots(): Promise<number> {
  if (!fs.existsSync(WEEKLY_BASE)) {
    console.log(`No ${WEEKLY_BASE} found; skipping weekly-damage import.`);
    return 0;
  }

  let count = 0;
  for (const serverId of fs.readdirSync(WEEKLY_BASE)) {
    for (const kind of ['users', 'mu'] as const) {
      const dir = path.join(WEEKLY_BASE, serverId, kind);
      if (!fs.existsSync(dir)) {
        continue;
      }
      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith('.csv')) {
          continue;
        }
        const week = file.slice(0, -4);
        const csv = fs.readFileSync(path.join(dir, file), 'utf-8');
        await prisma.weeklyDamageSnapshot.upsert({
          where: { serverId_kind_week: { serverId, kind, week } },
          create: { serverId, kind, week, csv },
          update: { csv },
        });
        count++;
      }
    }
  }

  console.log(`Imported ${count} weekly-damage snapshot(s).`);
  return count;
}

async function main(): Promise<void> {
  await importServerConfigs();
  await importWeeklySnapshots();
  await prisma.$disconnect();
  console.log('Import complete.');
}

main().catch(async (error) => {
  console.error('Import failed:', error);
  await prisma.$disconnect();
  process.exit(1);
});
