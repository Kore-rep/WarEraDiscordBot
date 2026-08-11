/**
 * One-time migration: merge the three legacy per-feature MU lists into the
 * single shared `Server.militaryUnits` list.
 *
 *   - leaderboard.militaryUnitIds  (ids only)
 *   - muDirectory.militaryUnitIds  (ids only)
 *   - autorole.muRoles[]           ({ muId, muName, roleId })
 *
 * Role mappings are carried over from autorole.muRoles; names are taken from
 * there when known and otherwise resolved from the WarEra API. The now-unused
 * `militaryUnitIds` / `muRoles` fields are stripped from the feature blobs.
 *
 * Safe to re-run: existing `militaryUnits` entries are merged, not clobbered.
 *   npm run db:merge-mu            # local (ts-node)
 *   node dist/scripts/mergeMilitaryUnits.js   # inside the docker image
 */
import dotenv from 'dotenv';
import { createAPI } from 'warera-sdk';
import { prisma } from '../persistence/prisma';
import type { MilitaryUnitEntry } from '../config/config';

dotenv.config();

const BATCH_SIZE = 100;

interface LegacyMuRole {
  muId: string;
  muName?: string;
  roleId?: string;
}

function parse<T>(value: string | null): T | undefined {
  if (value == null) {
    return undefined;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

/** Collect the merged {muId -> {muName?, roleId?}} for one server. */
function collectUnits(
  existing: MilitaryUnitEntry[] | undefined,
  leaderboardIds: string[],
  directoryIds: string[],
  muRoles: LegacyMuRole[]
): Map<string, { muName?: string; roleId?: string }> {
  const merged = new Map<string, { muName?: string; roleId?: string }>();
  const put = (muId: string, name?: string, roleId?: string) => {
    const id = muId?.trim();
    if (!id) {
      return;
    }
    const current = merged.get(id) ?? {};
    if (name && name.trim() && name.trim() !== `MU ${id}`) {
      current.muName = name.trim();
    }
    if (roleId && roleId.trim()) {
      current.roleId = roleId.trim();
    }
    merged.set(id, current);
  };

  for (const e of existing ?? []) {
    put(e.muId, e.muName, e.roleId);
  }
  for (const e of muRoles) {
    put(e.muId, e.muName, e.roleId);
  }
  for (const id of [...leaderboardIds, ...directoryIds]) {
    put(id, undefined, undefined);
  }
  return merged;
}

async function resolveNames(muIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (muIds.length === 0) {
    return names;
  }
  const client = createAPI({
    baseUrl: process.env.API_BASE_URL,
    apiKey: process.env.WARERA_API_KEY,
    batch: true,
  });
  for (let i = 0; i < muIds.length; i += BATCH_SIZE) {
    const chunk = muIds.slice(i, i + BATCH_SIZE);
    const promises = chunk.map(id => client.mu.getById(id).catch(() => null));
    await client.runBatch();
    const results = await Promise.all(promises);
    for (let j = 0; j < results.length; j++) {
      const name = results[j]?.result?.data?.name;
      if (name) {
        names.set(chunk[j], name);
      }
    }
  }
  return names;
}

async function main(): Promise<void> {
  const rows = await prisma.server.findMany();
  let migrated = 0;

  for (const row of rows) {
    const leaderboard = parse<{ militaryUnitIds?: string[] } & Record<string, unknown>>(row.leaderboard);
    const muDirectory = parse<{ militaryUnitIds?: string[] } & Record<string, unknown>>(row.muDirectory);
    const autorole = parse<{ muRoles?: LegacyMuRole[] } & Record<string, unknown>>(row.autorole);
    const existing = parse<MilitaryUnitEntry[]>(row.militaryUnits);

    const merged = collectUnits(
      existing,
      leaderboard?.militaryUnitIds ?? [],
      muDirectory?.militaryUnitIds ?? [],
      autorole?.muRoles ?? []
    );

    if (merged.size === 0) {
      continue;
    }

    // Resolve any names we still don't have.
    const unnamed = [...merged.entries()].filter(([, v]) => !v.muName).map(([id]) => id);
    const resolved = await resolveNames(unnamed);

    const units: MilitaryUnitEntry[] = [...merged.entries()].map(([muId, v]) => ({
      muId,
      muName: v.muName ?? resolved.get(muId) ?? `MU ${muId}`,
      ...(v.roleId ? { roleId: v.roleId } : {}),
    }));

    // Strip the retired fields from the feature blobs.
    const data: Record<string, string | null> = { militaryUnits: JSON.stringify(units) };
    if (leaderboard && 'militaryUnitIds' in leaderboard) {
      delete leaderboard.militaryUnitIds;
      data.leaderboard = JSON.stringify(leaderboard);
    }
    if (muDirectory && 'militaryUnitIds' in muDirectory) {
      delete muDirectory.militaryUnitIds;
      data.muDirectory = JSON.stringify(muDirectory);
    }
    if (autorole && 'muRoles' in autorole) {
      delete autorole.muRoles;
      data.autorole = JSON.stringify(autorole);
    }

    await prisma.server.update({ where: { id: row.id }, data });
    migrated++;
    const withRoles = units.filter(u => u.roleId).length;
    console.log(`Server ${row.id}: ${units.length} MU(s) (${withRoles} role-mapped).`);
  }

  await prisma.$disconnect();
  console.log(`Military-unit merge complete: ${migrated} server(s) updated.`);
}

main().catch(async error => {
  console.error('Military-unit merge failed:', error);
  await prisma.$disconnect();
  process.exit(1);
});
