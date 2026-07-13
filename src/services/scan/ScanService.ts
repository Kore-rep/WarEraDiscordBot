import type {
  CountryDTO,
  PartyDTO,
  GovernmentDTO,
  UserDTO,
  RegionDTO,
  GetAllCountriesResponse,
  GetPartyByIdResponse,
  GetGovernmentByCountryIdResponse,
  GetUserLiteResponse,
  GetUsersByCountryParams,
  RegionGetRegionsObjectResponse as GetRegionsObjectResponse,
} from 'warera-sdk';
import { ApiService } from '../api/ApiService';
import { logger } from '../../utils/logger';

// Domain types re-exported so command handlers never import the SDK directly.
export type ScanCountry = CountryDTO;
export type ScanParty = PartyDTO;
export type ScanGovernment = GovernmentDTO;
export type ScanUserLite = UserDTO;
export type ScanRegion = RegionDTO;

const BATCH_SIZE = 100;

const DEFAULT_RESET_COOLDOWN_DAYS = 7;
const GAME_CONFIG_CACHE_TTL_MS = 3600 * 1000;

/**
 * All WarEra API access used by the `/scanfor` command family. Command handlers
 * call these methods and only handle Discord I/O + formatting.
 */
export class ScanService {
  constructor(private readonly apiService: ApiService) {}

  /** Every country in the game. Pass a cache TTL (ms) to reuse a recent result. */
  async getAllCountries(cacheTtlMs?: number): Promise<ScanCountry[]> {
    const options = cacheTtlMs !== undefined ? { cache: { ttl: cacheTtlMs } } : undefined;
    const res = (await this.apiService.getClient().country.getAllCountries(options)) as GetAllCountriesResponse;
    return res.result.data;
  }

  /** All regions keyed by region id. Pass a cache TTL (ms) to reuse a recent result. */
  async getRegionsObject(cacheTtlMs?: number): Promise<Map<string, ScanRegion>> {
    const batch = this.apiService.getBatchClient();
    const options = cacheTtlMs !== undefined ? { cache: { ttl: cacheTtlMs } } : undefined;
    const regionsPromise = batch.region.getRegionsObject(options);
    await batch.runBatch();
    const res = (await regionsPromise) as GetRegionsObjectResponse;
    return new Map(Object.entries(res.result.data));
  }

  /** A single country by id, or null if not found. */
  async getCountryById(id: string): Promise<ScanCountry | null> {
    const res = await this.apiService.getClient().country.getCountryById(id);
    return (res?.result?.data as ScanCountry) ?? null;
  }

  /** A single lite user record by id, or null if not found. */
  async getUserLite(id: string): Promise<ScanUserLite | null> {
    const res = await this.apiService.getClient().user.getUserLite(id);
    return (res?.result?.data as ScanUserLite) ?? null;
  }

  /** Full country data for a set of ids, batched (≤100 per request). Pass a cache TTL (ms) to reuse recent results. */
  async getCountriesByIds(ids: string[], cacheTtlMs?: number): Promise<ScanCountry[]> {
    const options = cacheTtlMs !== undefined ? { cache: { ttl: cacheTtlMs } } : undefined;
    const out: ScanCountry[] = [];
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const chunk = ids.slice(i, i + BATCH_SIZE);
      const batch = this.apiService.createCommandBatchClient();
      const promises = chunk.map(id => batch.country.getCountryById(id, options));
      await batch.runBatch();
      for (const r of await Promise.all(promises)) {
        const c = r?.result?.data;
        if (c) out.push(c as ScanCountry);
      }
    }
    return out;
  }

  /** Ruling/other parties by id, batched. Returns a map keyed by party id. Cache TTL is in ms (default 24h — party names/ethics change rarely). */
  async getPartiesByIds(ids: string[], cacheTtlMs = 86_400_000): Promise<Map<string, ScanParty>> {
    const map = new Map<string, ScanParty>();
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const chunk = ids.slice(i, i + BATCH_SIZE);
      const batch = this.apiService.createCommandBatchClient();
      const promises = chunk.map(id => batch.party.getPartyById(id, { cache: { ttl: cacheTtlMs } }));
      await batch.runBatch();
      const results = await Promise.all(promises);
      for (let j = 0; j < chunk.length; j++) {
        const data = (results[j] as GetPartyByIdResponse | undefined)?.result?.data;
        if (data) {
          map.set(chunk[j], data);
        } else {
          logger.warn(`ScanService: failed to load party ${chunk[j]}`);
        }
      }
    }
    return map;
  }

  /**
   * Government for each country id, batched. `onProgress(processed, total)` fires
   * after each chunk so callers can post progress updates. Missing governments are
   * simply absent from the returned map.
   */
  async getGovernmentsByCountryIds(
    ids: string[],
    onProgress?: (processed: number, total: number) => void
  ): Promise<Map<string, ScanGovernment>> {
    const map = new Map<string, ScanGovernment>();
    let processed = 0;
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const chunk = ids.slice(i, i + BATCH_SIZE);
      const batch = this.apiService.createCommandBatchClient();
      const promises = chunk.map(id => batch.government.getByCountryId(id));
      await batch.runBatch();
      const results = await Promise.all(promises);
      for (let j = 0; j < chunk.length; j++) {
        const data = (results[j] as GetGovernmentByCountryIdResponse | undefined)?.result?.data;
        if (data) {
          map.set(chunk[j], data);
        }
      }
      processed += chunk.length;
      onProgress?.(processed, ids.length);
    }
    return map;
  }

  /** Lite user records for a set of ids, batched. Returns a map keyed by user id. Pass a cache TTL (ms) to reuse recent results. */
  async getUsersLiteByIds(
    ids: string[],
    onBatch?: (loaded: number, batchesDone: number, totalBatches: number) => void,
    cacheTtlMs?: number
  ): Promise<Map<string, ScanUserLite>> {
    const options = cacheTtlMs !== undefined ? { cache: { ttl: cacheTtlMs } } : undefined;
    const map = new Map<string, ScanUserLite>();
    const totalBatches = Math.ceil(ids.length / BATCH_SIZE);
    let batchesDone = 0;
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const chunk = ids.slice(i, i + BATCH_SIZE);
      const batch = this.apiService.createCommandBatchClient();
      const promises = chunk.map(id => batch.user.getUserLite(id, options));
      try {
        await batch.runBatch();
        const results = await Promise.all(promises);
        for (let j = 0; j < chunk.length; j++) {
          const data = (results[j] as GetUserLiteResponse | undefined)?.result?.data;
          if (data) {
            map.set(chunk[j], data);
          }
        }
      } catch (error) {
        logger.error(`ScanService: failed user-lite batch ${batchesDone + 1}`, error);
      }
      batchesDone++;
      onBatch?.(map.size, batchesDone, totalBatches);
    }
    return map;
  }

  /**
   * All citizen user ids for a country, following pagination. `onPage(total, pages)`
   * fires after each page. Stops at `maxPages` as a safety limit. Pass a cache
   * TTL (ms) to reuse recently fetched pages (each page caches under its cursor).
   */
  async getUserIdsByCountry(
    countryId: string,
    onPage?: (total: number, pages: number) => void,
    maxPages = 1000,
    cacheTtlMs?: number
  ): Promise<{ userIds: string[]; total: number; hitPageLimit: boolean }> {
    const options = cacheTtlMs !== undefined ? { cache: { ttl: cacheTtlMs } } : undefined;
    const userIds: string[] = [];
    let cursor: string | null = null;
    let pages = 0;

    do {
      const params: GetUsersByCountryParams = { countryId, limit: 100 };
      if (cursor) {
        params.cursor = cursor;
      }
      const res = await this.apiService.getClient().user.getUsersByCountry(params, options);
      const data = res.result.data;
      userIds.push(...data.items.map((item: { _id: string }) => item._id));
      cursor = data.nextCursor;
      pages++;
      onPage?.(userIds.length, pages);
      // Small delay to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (cursor && pages < maxPages);

    return { userIds, total: userIds.length, hitPageLimit: pages >= maxPages };
  }

  /**
   * Days between free skill resets (`user.resetSkillDaysCooldown` in the game
   * config, cached 1h); falls back to the known default on failure.
   */
  async getSkillResetCooldownDays(): Promise<number> {
    try {
      const res = (await this.apiService
        .getClient()
        .gameConfig.getGameConfig({ cache: { ttl: GAME_CONFIG_CACHE_TTL_MS } })) as {
        result?: { data?: { user?: { resetSkillDaysCooldown?: number } } };
      };
      const days = res?.result?.data?.user?.resetSkillDaysCooldown;
      if (typeof days === 'number' && days > 0) {
        return days;
      }
    } catch (error) {
      logger.warn('Failed to fetch game config for skill-reset cooldown', error);
    }
    return DEFAULT_RESET_COOLDOWN_DAYS;
  }
}
