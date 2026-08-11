import { MilitaryUnitEntry } from '../../config/config';
import { ServerConfigManager } from '../../utils/serverConfigManager';
import { logger } from '../../utils/logger';
import { ApiService } from '../api/ApiService';

// MU names change rarely, so resolve them through the SDK's cache with a long TTL.
const MU_CACHE_TTL_MS = 6 * 3600 * 1000;

/**
 * Owns the shared per-server military-unit directory that the leaderboard, the
 * MU directory, and autorole all draw from. Resolves MU names via the SDK (so
 * command handlers stay SDK-free) and mutates the list through
 * `ServerConfigManager`.
 */
export class MilitaryUnitService {
  constructor(private readonly apiService: ApiService) {}

  /** The server's shared MU list (deep copy). */
  getUnits(serverId: string): MilitaryUnitEntry[] {
    return ServerConfigManager.getMilitaryUnits(serverId);
  }

  /** Resolve an MU's display name, or null if the id is unknown. */
  async resolveMuName(muId: string): Promise<string | null> {
    try {
      const res = await this.apiService.getClient().mu.getById(muId, { cache: { ttl: MU_CACHE_TTL_MS } });
      return res?.result?.data?.name ?? null;
    } catch (error) {
      logger.debug(`MilitaryUnits: resolveMuName(${muId}) failed`, error);
      return null;
    }
  }

  /**
   * Add an MU to the shared list (or refresh its stored name). Returns the entry
   * and whether it was newly created, or null if the id could not be resolved.
   * An existing role mapping is preserved.
   */
  async addUnit(serverId: string, muId: string): Promise<{ entry: MilitaryUnitEntry; created: boolean } | null> {
    const name = await this.resolveMuName(muId);
    if (!name) {
      return null;
    }
    const units = this.getUnits(serverId);
    const existing = units.find(u => u.muId === muId);
    const entry: MilitaryUnitEntry = {
      muId,
      muName: name,
      ...(existing?.roleId ? { roleId: existing.roleId } : {}),
    };
    const next = existing ? units.map(u => (u.muId === muId ? entry : u)) : [...units, entry];
    ServerConfigManager.updateMilitaryUnits(serverId, next);
    return { entry, created: !existing };
  }

  /** Remove an MU from the shared list. Returns false if it was not present. */
  removeUnit(serverId: string, muId: string): boolean {
    const units = this.getUnits(serverId);
    const next = units.filter(u => u.muId !== muId);
    if (next.length === units.length) {
      return false;
    }
    ServerConfigManager.updateMilitaryUnits(serverId, next);
    return true;
  }

  /**
   * Map an MU to a Discord role, adding the MU to the list first if needed
   * (resolving its name). Returns the resulting entry, or null if the id could
   * not be resolved for a not-yet-listed MU.
   */
  async setRole(serverId: string, muId: string, roleId: string): Promise<MilitaryUnitEntry | null> {
    const units = this.getUnits(serverId);
    const existing = units.find(u => u.muId === muId);
    const name = existing?.muName ?? (await this.resolveMuName(muId));
    if (!name) {
      return null;
    }
    const entry: MilitaryUnitEntry = { muId, muName: name, roleId };
    const next = existing ? units.map(u => (u.muId === muId ? entry : u)) : [...units, entry];
    ServerConfigManager.updateMilitaryUnits(serverId, next);
    return entry;
  }

  /** Clear an MU's role mapping (the MU stays in the list). Returns false if absent or already unmapped. */
  clearRole(serverId: string, muId: string): boolean {
    const units = this.getUnits(serverId);
    const existing = units.find(u => u.muId === muId);
    if (!existing || !existing.roleId) {
      return false;
    }
    const next = units.map(u => (u.muId === muId ? { muId: u.muId, muName: u.muName } : u));
    ServerConfigManager.updateMilitaryUnits(serverId, next);
    return true;
  }
}
