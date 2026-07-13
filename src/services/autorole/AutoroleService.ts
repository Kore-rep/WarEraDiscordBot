import { Client, Guild, GuildMember } from 'discord.js';
import { AutoroleConfig } from '../../config/config';
import { ServerConfigManager } from '../../utils/serverConfigManager';
import { logger } from '../../utils/logger';
import { ApiService } from '../api/ApiService';
import { DiscordService } from '../discord/DiscordService';
import { ScheduledTask } from '../scheduler/ScheduledTask';
import { AutoroleApi, AutoroleUser } from './autoroleApi';
import { LinkStore } from './linkStore';
import { LinkFlow } from './linkFlow';
import { computeMemberSyncPlan, SyncUserView } from './syncPlan';
import { SkillLevels } from './build';
import { NO_MU_DM_MESSAGE } from './reviewMessages';

const TICK_INTERVAL_MS = 60_000;
const MU_NOTICE_THROTTLE_MS = 24 * 3600 * 1000;

export interface MemberSyncOutcome {
  synced: boolean;
  reason?: 'not-linked' | 'member-left' | 'user-not-found';
}

/**
 * Periodic role/nickname sync for linked members, plus the composition point
 * for the autorole feature (owns the API gateway, link store, and link flow).
 * Ticks every minute and syncs each server on its own configured cadence,
 * like the Python bot's background loop.
 */
export class AutoroleService implements ScheduledTask {
  readonly name = 'autorole-sync';
  readonly intervalMs = TICK_INTERVAL_MS;
  readonly runOnStart = false;

  private readonly api: AutoroleApi;
  private readonly store: LinkStore;
  private readonly linkFlow: LinkFlow;

  constructor(
    private readonly client: Client,
    private readonly discordService: DiscordService,
    apiService: ApiService
  ) {
    this.api = new AutoroleApi(apiService);
    this.store = new LinkStore();
    this.linkFlow = new LinkFlow(this.api, this.store, this.discordService, (serverId, discordUserId) =>
      this.syncMember(serverId, discordUserId).then(() => undefined)
    );
  }

  getApi(): AutoroleApi {
    return this.api;
  }

  getStore(): LinkStore {
    return this.store;
  }

  getLinkFlow(): LinkFlow {
    return this.linkFlow;
  }

  async runCycle(): Promise<void> {
    const now = new Date();
    const pruned = await this.store.deleteExpiredVerifications(now);
    if (pruned > 0) {
      logger.debug(`Autorole: pruned ${pruned} expired verification(s)`);
    }

    for (const [serverId, serverConfig] of ServerConfigManager.readServerConfigs()) {
      const cfg = serverConfig.autorole;
      if (!cfg || cfg.enabled === false) {
        continue;
      }
      const lastSync = cfg.lastSyncAt ? new Date(cfg.lastSyncAt).getTime() : 0;
      if (now.getTime() - lastSync < cfg.checkIntervalSeconds * 1000) {
        continue;
      }
      try {
        await this.syncServer(serverId);
      } catch (error) {
        logger.error(`Autorole: sync failed for server ${serverId}`, error);
      }
      ServerConfigManager.updateAutoroleConfig(serverId, { lastSyncAt: new Date().toISOString() });
    }
  }

  /** Sync every linked member of a server (one batched profile sweep). */
  async syncServer(serverId: string): Promise<{ synced: number; skipped: number }> {
    const cfg = ServerConfigManager.getAutoroleConfig(serverId);
    const links = await this.store.listLinks(serverId);
    if (!cfg || links.length === 0) {
      return { synced: 0, skipped: 0 };
    }

    const guild = await this.fetchGuild(serverId);
    if (!guild) {
      return { synced: 0, skipped: links.length };
    }

    const users = await this.api.getUsersLiteByIds(links.map(l => l.wareraUserId));
    let synced = 0;
    let skipped = 0;
    for (const link of links) {
      const user = users.get(link.wareraUserId);
      if (!user) {
        skipped++;
        continue;
      }
      const member = await this.fetchMember(guild, link.discordUserId);
      if (!member) {
        skipped++;
        continue;
      }
      await this.applySync(serverId, cfg, member, user, link.muNoticeSentAt);
      synced++;
    }
    logger.info(`Autorole: synced ${synced}/${links.length} linked member(s) in server ${serverId}`);
    return { synced, skipped };
  }

  /** Sync a single linked member (post-link and `/autorole sync now user:`). */
  async syncMember(serverId: string, discordUserId: string): Promise<MemberSyncOutcome> {
    const cfg = ServerConfigManager.getAutoroleConfig(serverId);
    const link = await this.store.getLink(serverId, discordUserId);
    if (!cfg || !link) {
      return { synced: false, reason: 'not-linked' };
    }
    const guild = await this.fetchGuild(serverId);
    const member = guild ? await this.fetchMember(guild, discordUserId) : null;
    if (!member) {
      return { synced: false, reason: 'member-left' };
    }
    const user = await this.api.getUserLite(link.wareraUserId);
    if (!user) {
      return { synced: false, reason: 'user-not-found' };
    }
    await this.applySync(serverId, cfg, member, user, link.muNoticeSentAt);
    return { synced: true };
  }

  private async applySync(
    serverId: string,
    cfg: AutoroleConfig,
    member: GuildMember,
    user: AutoroleUser,
    muNoticeSentAt: Date | null
  ): Promise<void> {
    const view = toSyncUserView(user);
    const plan = computeMemberSyncPlan(view, [...member.roles.cache.keys()], member.nickname, cfg, new Date());

    for (const roleId of plan.rolesToAdd) {
      try {
        await member.roles.add(roleId);
      } catch (error) {
        logger.warn(`Autorole: could not add role ${roleId} to ${member.id} in ${serverId}`, error);
      }
    }
    for (const roleId of plan.rolesToRemove) {
      try {
        await member.roles.remove(roleId);
      } catch (error) {
        logger.warn(`Autorole: could not remove role ${roleId} from ${member.id} in ${serverId}`, error);
      }
    }

    if (plan.desiredNickname !== undefined) {
      try {
        await member.setNickname(plan.desiredNickname);
      } catch (error) {
        logger.debug(`Autorole: could not set nickname for ${member.id} in ${serverId}`, error);
      }
    }

    if (plan.needsMuNotice) {
      const throttled = muNoticeSentAt && Date.now() - muNoticeSentAt.getTime() < MU_NOTICE_THROTTLE_MS;
      if (!throttled) {
        const delivered = await this.discordService.sendDirectMessage(member.id, NO_MU_DM_MESSAGE);
        if (delivered) {
          await this.store.setMuNoticeSentAt(serverId, member.id, new Date());
        }
      }
    }
  }

  private async fetchGuild(serverId: string): Promise<Guild | null> {
    try {
      return await this.client.guilds.fetch(serverId);
    } catch (error) {
      logger.warn(`Autorole: could not fetch guild ${serverId}`, error);
      return null;
    }
  }

  private async fetchMember(guild: Guild, discordUserId: string): Promise<GuildMember | null> {
    try {
      return await guild.members.fetch(discordUserId);
    } catch {
      return null;
    }
  }
}

/** Project a full user profile onto the slice the sync plan needs. */
export function toSyncUserView(user: AutoroleUser): SyncUserView {
  const lastConnection = user.dates?.lastConnectionAt ? new Date(user.dates.lastConnectionAt) : undefined;
  return {
    username: user.username,
    level: user.leveling?.level ?? 0,
    muId: user.mu || undefined,
    skills: (user.skills ?? {}) as SkillLevels,
    lastConnectionAt: lastConnection && !isNaN(lastConnection.getTime()) ? lastConnection : undefined,
  };
}
