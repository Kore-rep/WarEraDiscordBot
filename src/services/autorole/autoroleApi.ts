import type { GetCompaniesResponse, GetCompanyByIdResponse, GetUserLiteResponse, MuDTO, UserDTO } from 'warera-sdk';
import { ApiService } from '../api/ApiService';
import { logger } from '../../utils/logger';

// Domain types re-exported so autorole code outside this gateway never
// imports the SDK directly.
export type AutoroleUser = UserDTO;
export type AutoroleMu = MuDTO;

const BATCH_SIZE = 100;
const MU_CACHE_TTL_MS = 6 * 3600 * 1000;
const DEFAULT_TRPC_BASE_URL = 'https://api2.warera.io/trpc';

/**
 * All WarEra API access for the autorole feature: user profiles (single and
 * batched), MU lookups, company-name verification, and username resolution.
 */
export class AutoroleApi {
  // mu.getById takes no cache options in the SDK, so memoize locally.
  private muCache = new Map<string, { mu: AutoroleMu | null; fetchedAt: number }>();

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

  /** MU details by id (cached — MU names change rarely), or null. */
  async getMuById(muId: string): Promise<AutoroleMu | null> {
    const cached = this.muCache.get(muId);
    if (cached && Date.now() - cached.fetchedAt < MU_CACHE_TTL_MS) {
      return cached.mu;
    }
    try {
      const res = await this.apiService.getClient().mu.getById(muId);
      const mu = (res?.result?.data as AutoroleMu) ?? null;
      this.muCache.set(muId, { mu, fetchedAt: Date.now() });
      return mu;
    } catch (error) {
      logger.debug(`Autorole: getMuById(${muId}) failed`, error);
      return null;
    }
  }

  /** Names of all companies owned by a user (for code verification). */
  async getCompanyNamesForUser(userId: string): Promise<string[]> {
    const listRes = (await this.apiService
      .getClient()
      .company.getCompanies({ userId, perPage: 100 })) as GetCompaniesResponse;
    const companyIds = listRes?.result?.data?.items ?? [];
    if (companyIds.length === 0) {
      return [];
    }

    const names: string[] = [];
    for (let i = 0; i < companyIds.length; i += BATCH_SIZE) {
      const chunk = companyIds.slice(i, i + BATCH_SIZE);
      const batch = this.apiService.createCommandBatchClient();
      const promises = chunk.map(companyId =>
        batch.company.getById({ companyId }).catch(() => null)
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

  /**
   * User ids matching a search string. Raw tRPC GET rather than the SDK:
   * the SDK's search.searchAnything sends `{query}` but the live API requires
   * `{searchText}` (upstream bug in Kore-rep/WarEraSDK). One request per
   * username link attempt, so bypassing the shared rate limiter is acceptable.
   */
  async searchUserIdsByName(searchText: string): Promise<string[]> {
    const baseUrl = this.apiService.getApiBaseUrl() ?? DEFAULT_TRPC_BASE_URL;
    const url = `${baseUrl}/search.searchAnything?input=${encodeURIComponent(JSON.stringify({ searchText }))}`;
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) {
        logger.warn(`Autorole: search.searchAnything returned ${res.status}`);
        return [];
      }
      const payload = (await res.json()) as { result?: { data?: { userIds?: string[] } } };
      return payload?.result?.data?.userIds ?? [];
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
