import type { GetCompaniesResponse, GetCompanyByIdResponse, GetUserLiteResponse, MuDTO, UserDTO } from 'warera-sdk';
import { ApiService } from '../api/ApiService';
import { logger } from '../../utils/logger';

// Domain types re-exported so autorole code outside this gateway never
// imports the SDK directly.
export type AutoroleUser = UserDTO;
export type AutoroleMu = MuDTO;

const BATCH_SIZE = 100;
const MU_CACHE_TTL_MS = 6 * 3600 * 1000;
// Verification must see company renames immediately, so those requests bypass
// the SDK's default 30s cache entirely.
const NO_CACHE = { cache: { enabled: false } } as const;

/**
 * All WarEra API access for the autorole feature: user profiles (single and
 * batched), MU lookups, company-name verification, and username resolution.
 */
export class AutoroleApi {
  constructor(private readonly apiService: ApiService) {}

  /** A single lite user record by id, or null if not found. */
  async getUserLite(id: string): Promise<AutoroleUser | null> {
    try {
      const res = (await this.apiService.getClient().user.getUserLite(id)) as GetUserLiteResponse;
      return res?.result?.data ?? null;
    } catch (error) {
      logger.debug(`Autorole: getUserLite(${id}) failed`, error);
      return null;
    }
  }

  /** Lite user records for a set of ids, batched (≤100 per request). */
  async getUsersLiteByIds(ids: string[]): Promise<Map<string, AutoroleUser>> {
    const out = new Map<string, AutoroleUser>();
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const chunk = ids.slice(i, i + BATCH_SIZE);
      const batch = this.apiService.createCommandBatchClient();
      const promises = chunk.map(id =>
        batch.user.getUserLite(id).catch(() => null)
      );
      await batch.runBatch();
      for (const r of await Promise.all(promises)) {
        const user = (r as GetUserLiteResponse | null)?.result?.data;
        if (user) {
          out.set(user._id, user);
        }
      }
    }
    return out;
  }

  /** MU details by id (cached 6h — MU names change rarely), or null. */
  async getMuById(muId: string): Promise<AutoroleMu | null> {
    try {
      const res = await this.apiService.getClient().mu.getById(muId, { cache: { ttl: MU_CACHE_TTL_MS } });
      return (res?.result?.data as AutoroleMu) ?? null;
    } catch (error) {
      logger.debug(`Autorole: getMuById(${muId}) failed`, error);
      return null;
    }
  }

  /**
   * Names of all companies owned by a user (for code verification). Uncached:
   * a member renames a company and immediately presses the verify button, so
   * a 30s-stale list would wrongly report the code as missing.
   */
  async getCompanyNamesForUser(userId: string): Promise<string[]> {
    const listRes = (await this.apiService
      .getClient()
      .company.getCompanies({ userId, perPage: 100 }, NO_CACHE)) as GetCompaniesResponse;
    const companyIds = listRes?.result?.data?.items ?? [];
    if (companyIds.length === 0) {
      return [];
    }

    const names: string[] = [];
    for (let i = 0; i < companyIds.length; i += BATCH_SIZE) {
      const chunk = companyIds.slice(i, i + BATCH_SIZE);
      const batch = this.apiService.createCommandBatchClient();
      const promises = chunk.map(companyId =>
        batch.company.getById({ companyId }, NO_CACHE).catch(() => null)
      );
      await batch.runBatch();
      for (const r of await Promise.all(promises)) {
        const name = (r as GetCompanyByIdResponse | null)?.result?.data?.name;
        if (name) {
          names.push(name.trim());
        }
      }
    }
    return names;
  }

  /** User ids matching a search string. */
  async searchUserIdsByName(searchText: string): Promise<string[]> {
    try {
      const res = (await this.apiService.getClient().search.searchAnything(searchText)) as unknown as {
        result?: { data?: { userIds?: string[] } };
      };
      return res?.result?.data?.userIds ?? [];
    } catch (error) {
      logger.error('Autorole: search.searchAnything request failed', error);
      return [];
    }
  }

  /** Resolve a username to its user record via search + exact (case-insensitive) match. */
  async resolveUserByUsername(username: string): Promise<AutoroleUser | null> {
    const candidateIds = await this.searchUserIdsByName(username);
    if (candidateIds.length === 0) {
      return null;
    }
    const users = await this.getUsersLiteByIds(candidateIds);
    const wanted = username.toLowerCase();
    for (const user of users.values()) {
      if (user.username.toLowerCase() === wanted) {
        return user;
      }
    }
    return null;
  }
}
