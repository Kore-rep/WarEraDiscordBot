import type { BunkerUpgradeDTO } from 'warera-sdk';

/**
 * Serializable subset of `upgrade.getUpgradeByTypeAndEntity` (`BunkerUpgradeDTO`) for bunker/base.
 */
export type MilitaryUpgradeSnapshot = Pick<
  BunkerUpgradeDTO,
  'level' | 'status' | 'investedMoney' | 'lastUpgradeAt' | 'willBeActiveAt' | 'statusChangedAt'
>;

/** Per-region serialized building state for diffing (bunker/base upgrades only; not region baseDevelopment) */
export interface RegionBuildingSnapshot {
  /** From `upgrade.getUpgradeByTypeAndEntity("bunker", regionId)` */
  bunker: MilitaryUpgradeSnapshot | null;
  /** From `upgrade.getUpgradeByTypeAndEntity("base", regionId)` */
  base: MilitaryUpgradeSnapshot | null;
}

/** Per-region resistance snapshot for diffing */
export interface RegionResistanceSnapshot {
  resistance: number;
  resistanceMax: number;
  /** 0..1 */
  ratio: number;
}

/**
 * In-memory only: previous poll snapshots for Spectre (not persisted; config lives in serverConfig.json).
 */
export interface SpectreStateRoot {
  buildings: {
    servers: Record<string, Record<string, Record<string, RegionBuildingSnapshot>>>;
  };
  resistance: {
    servers: Record<string, Record<string, Record<string, RegionResistanceSnapshot>>>;
  };
}

let memoryRoot: SpectreStateRoot | null = null;

function emptyRoot(): SpectreStateRoot {
  return {
    buildings: { servers: {} },
    resistance: { servers: {} },
  };
}

/** Mutable singleton holding last poll snapshots (process lifetime only). */
export function getSpectreSnapshotState(): SpectreStateRoot {
  if (!memoryRoot) {
    memoryRoot = emptyRoot();
  }
  return memoryRoot;
}

export function getCountrySnapshots(
  root: SpectreStateRoot,
  serverId: string,
  countryId: string
): Record<string, RegionBuildingSnapshot> {
  return { ...(root.buildings.servers[serverId]?.[countryId] || {}) };
}

export function setCountrySnapshots(
  root: SpectreStateRoot,
  serverId: string,
  countryId: string,
  snapshots: Record<string, RegionBuildingSnapshot>
): void {
  if (!root.buildings.servers[serverId]) {
    root.buildings.servers[serverId] = {};
  }
  root.buildings.servers[serverId][countryId] = snapshots;
}

export function clearBuildingCountrySnapshots(
  root: SpectreStateRoot,
  serverId: string,
  countryId: string
): void {
  const byServer = root.buildings.servers[serverId];
  if (!byServer) {
    return;
  }
  delete byServer[countryId];
  if (Object.keys(byServer).length === 0) {
    delete root.buildings.servers[serverId];
  }
}

export function getResistanceCountrySnapshots(
  root: SpectreStateRoot,
  serverId: string,
  countryId: string
): Record<string, RegionResistanceSnapshot> {
  return { ...(root.resistance.servers[serverId]?.[countryId] || {}) };
}

export function setResistanceCountrySnapshots(
  root: SpectreStateRoot,
  serverId: string,
  countryId: string,
  snapshots: Record<string, RegionResistanceSnapshot>
): void {
  if (!root.resistance.servers[serverId]) {
    root.resistance.servers[serverId] = {};
  }
  root.resistance.servers[serverId][countryId] = snapshots;
}

export function clearResistanceCountrySnapshots(
  root: SpectreStateRoot,
  serverId: string,
  countryId: string
): void {
  const byServer = root.resistance.servers[serverId];
  if (!byServer) {
    return;
  }
  delete byServer[countryId];
  if (Object.keys(byServer).length === 0) {
    delete root.resistance.servers[serverId];
  }
}

export function clearAllCountrySnapshotsForSpectre(
  root: SpectreStateRoot,
  serverId: string,
  countryId: string
): void {
  clearBuildingCountrySnapshots(root, serverId, countryId);
  clearResistanceCountrySnapshots(root, serverId, countryId);
}
