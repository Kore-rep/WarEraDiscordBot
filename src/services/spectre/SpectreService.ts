import type { APIClient } from 'warera-sdk';
import { ApiError } from 'warera-sdk';
import type { BunkerUpgradeDTO, GetUpgradeByTypeAndEntityResponse } from 'warera-sdk';
import { ApiService } from '../api/ApiService';
import { DiscordService } from '../discord/DiscordService';
import { ServerConfigManager } from '../../utils/serverConfigManager';
import { logger } from '../../utils/logger';
import {
  getSpectreSnapshotState,
  getCountrySnapshots,
  setCountrySnapshots,
  getResistanceCountrySnapshots,
  setResistanceCountrySnapshots,
  type RegionBuildingSnapshot,
  type SpectreStateRoot,
} from '../../utils/spectreBuildingStateStore';
import {
  buildRegionBuildingSnapshot,
  chunkLines,
  diffAllRegions,
  findForeignRegionsNeighboringCountry,
} from './spectreBuildingLogic';
import {
  buildCountryResistanceSnapshots,
  diffResistanceCountry,
} from './spectreResistanceLogic';

type GetRegionsObjectResponse = Awaited<
  ReturnType<APIClient['region']['getRegionsObject']>
>;
type RegionDTO = GetRegionsObjectResponse['result']['data'][string];

const REPORT_TITLE = '**S.P.E.C.T.R.E reports:**';

/**
 * 404 from `upgrade.getUpgradeByTypeAndEntity` means that upgrade is not present for the region
 * (e.g. bunker or base not built). The SDK raises {@link ApiError} with `status === 404`.
 */
function isExpectedMissingUpgradeError(e: unknown): boolean {
  return e instanceof ApiError && e.status === 404;
}

type MonitorTask = {
  serverId: string;
  countryId: string;
  countryName: string;
  channelId: string;
  kind: 'buildings' | 'resistance';
};

/**
 * Spectre military monitoring: same cadence as bounty polling (via PollingService).
 * Fetches region data once per cycle; aggregates Discord output per channel.
 */
export class SpectreService {
  constructor(
    private readonly apiService: ApiService,
    private readonly discordService: DiscordService
  ) {}

  async runSpectreCycle(): Promise<void> {
    const servers = ServerConfigManager.readServerConfigs();
    const tasks: MonitorTask[] = [];

    for (const [serverId, cfg] of servers) {
      const sp = cfg.spectre;
      if (!sp) {
        continue;
      }
      for (const m of sp.buildingMonitors || []) {
        if (m.enabled === false) {
          continue;
        }
        tasks.push({
          serverId,
          countryId: m.countryId,
          countryName: m.countryName,
          channelId: m.channelId,
          kind: 'buildings',
        });
      }
      for (const m of sp.resistanceMonitors || []) {
        if (m.enabled === false) {
          continue;
        }
        tasks.push({
          serverId,
          countryId: m.countryId,
          countryName: m.countryName,
          channelId: m.channelId,
          kind: 'resistance',
        });
      }
    }

    if (tasks.length === 0) {
      return;
    }

    const regions = await this.fetchAllRegionsMap();
    const state = getSpectreSnapshotState();
    const linesByChannel = new Map<string, string[]>();

    const appendSection = (channelId: string, sectionTitle: string, reportLines: string[]): void => {
      if (reportLines.length === 0) {
        return;
      }
      const bucket = linesByChannel.get(channelId) || [];
      if (bucket.length > 0) {
        bucket.push('');
      }
      bucket.push(sectionTitle);
      bucket.push(...reportLines);
      linesByChannel.set(channelId, bucket);
    };

    for (const task of tasks) {
      try {
        if (task.kind === 'buildings') {
          const reportLines = await this.processBuildingMonitor(
            state,
            regions,
            task.serverId,
            task.countryId,
            task.countryName
          );
          const sectionTitle = `**Border buildings** — ${task.countryName} (\`${task.countryId}\`)`;
          appendSection(task.channelId, sectionTitle, reportLines);
        } else {
          const reportLines = this.processResistanceMonitor(
            state,
            regions,
            task.serverId,
            task.countryId,
            task.countryName
          );
          const sectionTitle = `**Resistance** — ${task.countryName} (\`${task.countryId}\`)`;
          appendSection(task.channelId, sectionTitle, reportLines);
        }
      } catch (error) {
        logger.error(
          `Spectre monitor failed (${task.kind}) server ${task.serverId} country ${task.countryId}`,
          error
        );
      }
    }

    for (const [channelId, bodyLines] of linesByChannel) {
      if (bodyLines.length === 0) {
        continue;
      }
      const allLines = [REPORT_TITLE, '', ...bodyLines];
      const chunks = chunkLines(allLines);
      for (let i = 0; i < chunks.length; i++) {
        const part = chunks.length > 1 ? `\n(${i + 1}/${chunks.length})` : '';
        await this.discordService.sendMessageToChannelById(channelId, chunks[i] + part);
      }
    }
  }

  private async fetchAllRegionsMap(): Promise<Map<string, RegionDTO>> {
    const batch = this.apiService.getBatchClient();
    const regionsPromise = batch.region.getRegionsObject({
      cache: { ttl: 86400 * 1000 },
    });
    await batch.runBatch();
    const regionsResponse = (await regionsPromise) as GetRegionsObjectResponse;
    const regionsData = regionsResponse.result.data;
    const map = new Map<string, RegionDTO>();
    for (const [id, r] of Object.entries(regionsData)) {
      map.set(id, r);
    }
    logger.debug(`Spectre: loaded ${map.size} region(s)`);
    return map;
  }

  /**
   * Foreign regions adjacent to the monitored country use `upgrade.getUpgradeByTypeAndEntity("bunker"|"base", regionId)` (batched).
   * @returns Lines to report (empty if baseline or no changes).
   */
  private async processBuildingMonitor(
    state: SpectreStateRoot,
    regions: Map<string, RegionDTO>,
    serverId: string,
    countryId: string,
    countryName: string
  ): Promise<string[]> {
    const foreignNeighborIds = findForeignRegionsNeighboringCountry(regions, countryId);
    const upgradeByRegion = await this.fetchBunkerBaseUpgradesForRegions(foreignNeighborIds);

    const nextByRegion: Record<string, RegionBuildingSnapshot> = {};
    const regionNames = new Map<string, string>();

    for (const rid of foreignNeighborIds) {
      const region = regions.get(rid);
      if (!region) {
        continue;
      }
      const pair = upgradeByRegion.get(rid) ?? { bunker: null, base: null };
      nextByRegion[rid] = buildRegionBuildingSnapshot(pair.bunker, pair.base);
      regionNames.set(rid, region.name || rid);
    }

    const prev = getCountrySnapshots(state, serverId, countryId);
    const isBaseline = Object.keys(prev).length === 0;

    if (isBaseline) {
      setCountrySnapshots(state, serverId, countryId, nextByRegion);
      logger.info(
        `Spectre: buildings baseline for **${countryName}** (${countryId}): ${foreignNeighborIds.length} foreign neighbor region(s)`
      );
      return [];
    }

    const lines = diffAllRegions(prev, nextByRegion, regionNames);
    setCountrySnapshots(state, serverId, countryId, nextByRegion);
    return lines;
  }

  /**
   * Queue bunker + base upgrade fetches per region; one batch execution.
   */
  private async fetchBunkerBaseUpgradesForRegions(
    regionIds: string[]
  ): Promise<Map<string, { bunker: BunkerUpgradeDTO | null; base: BunkerUpgradeDTO | null }>> {
    const batch = this.apiService.createCommandBatchClient();
    const queued: {
      regionId: string;
      bunkerP: Promise<GetUpgradeByTypeAndEntityResponse>;
      baseP: Promise<GetUpgradeByTypeAndEntityResponse>;
    }[] = [];

    for (const regionId of regionIds) {
      queued.push({
        regionId,
        bunkerP: batch.upgrade.getUpgradeByTypeAndEntity('bunker', regionId),
        baseP: batch.upgrade.getUpgradeByTypeAndEntity('base', regionId),
      });
    }

    await batch.runBatch();

    const out = new Map<string, { bunker: BunkerUpgradeDTO | null; base: BunkerUpgradeDTO | null }>();

    for (const q of queued) {
      let bunker: BunkerUpgradeDTO | null = null;
      let base: BunkerUpgradeDTO | null = null;
      try {
        const res = await q.bunkerP;
        bunker = res.result.data;
      } catch (e) {
        if (!isExpectedMissingUpgradeError(e)) {
          logger.warn(`Spectre: bunker upgrade fetch failed for region ${q.regionId}`, e);
        }
      }
      try {
        const res = await q.baseP;
        base = res.result.data;
      } catch (e) {
        if (!isExpectedMissingUpgradeError(e)) {
          logger.warn(`Spectre: base upgrade fetch failed for region ${q.regionId}`, e);
        }
      }
      out.set(q.regionId, { bunker, base });
    }

    return out;
  }

  private processResistanceMonitor(
    state: SpectreStateRoot,
    regions: Map<string, RegionDTO>,
    serverId: string,
    countryId: string,
    countryName: string
  ): string[] {
    const next = buildCountryResistanceSnapshots(regions, countryId);
    const regionNames = new Map<string, string>();
    for (const rid of Object.keys(next)) {
      const r = regions.get(rid);
      if (r) {
        regionNames.set(rid, r.name || rid);
      }
    }

    const prev = getResistanceCountrySnapshots(state, serverId, countryId);
    const isBaseline = Object.keys(prev).length === 0;

    if (isBaseline) {
      setResistanceCountrySnapshots(state, serverId, countryId, next);
      logger.info(
        `Spectre: resistance baseline for **${countryName}** (${countryId}): ${Object.keys(next).length} region(s)`
      );
      return [];
    }

    const lines = diffResistanceCountry(prev, next, regionNames);
    setResistanceCountrySnapshots(state, serverId, countryId, next);
    return lines;
  }
}
