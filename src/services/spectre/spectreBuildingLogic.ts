import type { APIClient } from 'warera-sdk';
import type { BunkerUpgradeDTO } from 'warera-sdk';
import type { MilitaryUpgradeSnapshot, RegionBuildingSnapshot } from '../../utils/spectreBuildingStateStore';

type RegionDTO = Awaited<
  ReturnType<APIClient['region']['getRegionsObject']>
>['result']['data'][string];

export function upgradeDtoToSnapshot(dto: BunkerUpgradeDTO): MilitaryUpgradeSnapshot {
  return {
    level: dto.level,
    status: dto.status,
    investedMoney: dto.investedMoney,
    lastUpgradeAt: dto.lastUpgradeAt,
    willBeActiveAt: dto.willBeActiveAt,
    statusChangedAt: dto.statusChangedAt,
  };
}

/**
 * Build per-region snapshot from bunker + base upgrade API results (not region `baseDevelopment`).
 */
export function buildRegionBuildingSnapshot(
  bunker: BunkerUpgradeDTO | null,
  base: BunkerUpgradeDTO | null
): RegionBuildingSnapshot {
  return {
    bunker: bunker ? upgradeDtoToSnapshot(bunker) : null,
    base: base ? upgradeDtoToSnapshot(base) : null,
  };
}

/**
 * Region IDs **not** in `countryId` that share a map edge with at least one region owned by `countryId`
 * (foreign regions adjacent to the monitored country's territory).
 */
export function findForeignRegionsNeighboringCountry(
  regions: Map<string, RegionDTO>,
  countryId: string
): string[] {
  const foreign = new Set<string>();
  for (const [, region] of regions) {
    if (region.country !== countryId) {
      continue;
    }
    for (const nid of region.neighbors || []) {
      const neighbor = regions.get(nid);
      if (neighbor && neighbor.country !== countryId) {
        foreign.add(nid);
      }
    }
  }
  return [...foreign];
}

function diffMilitarySlot(
  prev: MilitaryUpgradeSnapshot | null,
  next: MilitaryUpgradeSnapshot | null,
  slotLabel: 'bunker' | 'base',
  header: string
): string[] {
  const lines: string[] = [];

  if (!prev && !next) {
    return lines;
  }
  if (!prev && next) {
    lines.push(
      `${header} — **${slotLabel}** present (level ${next.level}, status ${next.status})`
    );
    return lines;
  }
  if (prev && !next) {
    lines.push(`${header} — **${slotLabel}** no longer returned by API`);
    return lines;
  }
  if (!prev || !next) {
    return lines;
  }

  if (prev.level !== next.level) {
    lines.push(`${header} — **${slotLabel}** level: ${prev.level} → ${next.level}`);
  }
  if (prev.status !== next.status) {
    lines.push(`${header} — **${slotLabel}** status: ${prev.status} → ${next.status}`);
  }
  if (prev.investedMoney !== next.investedMoney) {
    lines.push(
      `${header} — **${slotLabel}** investedMoney: ${prev.investedMoney} → ${next.investedMoney}`
    );
  }
  if (prev.lastUpgradeAt !== next.lastUpgradeAt) {
    lines.push(`${header} — **${slotLabel}** lastUpgradeAt: ${prev.lastUpgradeAt} → ${next.lastUpgradeAt}`);
  }
  if (prev.willBeActiveAt !== next.willBeActiveAt) {
    lines.push(`${header} — **${slotLabel}** willBeActiveAt: ${prev.willBeActiveAt} → ${next.willBeActiveAt}`);
  }
  if (prev.statusChangedAt !== next.statusChangedAt) {
    lines.push(`${header} — **${slotLabel}** statusChangedAt: ${prev.statusChangedAt} → ${next.statusChangedAt}`);
  }

  return lines;
}

/**
 * Human-readable diff lines for one region (empty if no changes).
 */
export function diffRegionSnapshots(
  prev: RegionBuildingSnapshot | undefined,
  next: RegionBuildingSnapshot,
  regionDisplayName: string,
  regionId: string
): string[] {
  const lines: string[] = [];
  const header = `**${regionDisplayName}** (\`${regionId}\`)`;

  if (!prev) {
    lines.push(`${header} — now tracked (neighbors monitored country; bunker/base upgrade API).`);
    return lines;
  }

  lines.push(...diffMilitarySlot(prev.bunker, next.bunker, 'bunker', header));
  lines.push(...diffMilitarySlot(prev.base, next.base, 'base', header));

  return lines;
}

export function diffAllRegions(
  prevByRegion: Record<string, RegionBuildingSnapshot>,
  nextByRegion: Record<string, RegionBuildingSnapshot>,
  regionNames: Map<string, string>
): string[] {
  const lines: string[] = [];
  const allIds = new Set([...Object.keys(prevByRegion), ...Object.keys(nextByRegion)]);

  for (const rid of [...allIds].sort()) {
    const prev = prevByRegion[rid];
    const next = nextByRegion[rid];
    const name = regionNames.get(rid) || rid;
    if (!next) {
      lines.push(
        `**${name}** (\`${rid}\`) — no longer neighbors monitored country (neighbor/ownership changed).`
      );
      continue;
    }
    lines.push(...diffRegionSnapshots(prev, next, name, rid));
  }

  return lines;
}

const DEFAULT_CHUNK = 1950;

function formatMilitarySlotSummary(
  slot: MilitaryUpgradeSnapshot | null,
  label: 'bunker' | 'base',
  header: string
): string {
  if (!slot) {
    return `${header} — **${label}:** none`;
  }
  return `${header} — **${label}:** level ${slot.level}, status ${slot.status}, invested ${slot.investedMoney}`;
}

/**
 * Human-readable lines for `/spectre snapshot buildings` (latest stored poll per foreign neighbor region).
 */
export function formatBuildingSnapshotLines(
  snapshots: Record<string, RegionBuildingSnapshot>,
  regionNames: Map<string, string>
): string[] {
  const lines: string[] = [];
  for (const rid of Object.keys(snapshots).sort()) {
    const snap = snapshots[rid];
    const name = regionNames.get(rid) || rid;
    const header = `**${name}** (\`${rid}\`)`;
    lines.push(formatMilitarySlotSummary(snap.bunker, 'bunker', header));
    lines.push(formatMilitarySlotSummary(snap.base, 'base', header));
  }
  return lines;
}

export function chunkLines(lines: string[], maxLen: number = DEFAULT_CHUNK): string[] {
  if (lines.length === 0) {
    return [];
  }
  const chunks: string[] = [];
  let current = '';

  for (const line of lines) {
    const piece = (current ? '\n' : '') + line;
    if (current.length + piece.length > maxLen && current.length > 0) {
      chunks.push(current);
      current = line;
    } else {
      current += piece;
    }
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}
