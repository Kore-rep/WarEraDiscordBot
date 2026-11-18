import type { UserDTO } from 'warera-sdk';
import { ApiService } from '../api/ApiService';
import { DiscordService } from '../discord/DiscordService';
import { ScheduledTask } from '../scheduler/ScheduledTask';
import { LinkStore } from '../autorole/linkStore';
import { ServerConfigManager } from '../../utils/serverConfigManager';
import { logger } from '../../utils/logger';

const INTERVAL_MS = 5 * 60 * 1000;

export type BuffEventKind = 'buffEnded' | 'debuffEnded';

export interface BuffEvent {
  kind: BuffEventKind;
  /** When the debuff that follows a buff ends, if already known. */
  debuffEndAt?: string;
}

/** End times last seen in the future, per WarEra user, so expiry is noticed even if the API drops the field. */
export interface PendingEnds {
  buffEndAt?: string;
  debuffEndAt?: string;
}

const ms = (iso: string | undefined) => (iso ? new Date(iso).getTime() : NaN);

/**
 * Work out which buff / debuff ends fell in `(since, now]` for one user, from the
 * current profile plus the end times remembered from earlier cycles. Returns the
 * events and the end times still in the future to remember for next cycle.
 */
export function detectBuffEvents(
  buffs: UserDTO['buffs'],
  pending: PendingEnds | undefined,
  since: Date,
  now: Date
): { events: BuffEvent[]; pending: PendingEnds } {
  const events: BuffEvent[] = [];
  const next: PendingEnds = {};
  const check = (kind: BuffEventKind, key: keyof PendingEnds) => {
    const candidates = [...new Set([buffs?.[key], pending?.[key]].filter((v): v is string => !!v))];
    for (const iso of candidates) {
      const at = ms(iso);
      if (Number.isNaN(at)) {
        continue;
      }
      if (at > now.getTime()) {
        next[key] = iso;
      } else if (at > since.getTime() && !events.some(e => e.kind === kind)) {
        events.push(kind === 'buffEnded' ? { kind, debuffEndAt: buffs?.debuffEndAt } : { kind });
      }
    }
  };
  check('buffEnded', 'buffEndAt');
  check('debuffEnded', 'debuffEndAt');
  return { events, pending: next };
}

export function formatBuffEvent(discordUserId: string, event: BuffEvent): string {
  if (event.kind === 'buffEnded') {
    const debuff = event.debuffEndAt && ms(event.debuffEndAt) > Date.now()
      ? ` Debuff ends <t:${Math.floor(ms(event.debuffEndAt) / 1000)}:R>.`
      : '';
    return `💊 <@${discordUserId}> your buff has worn off.${debuff}`;
  }
  return `✅ <@${discordUserId}> your debuff is over, you can take a pill again.`;
}

export type OptInResult = 'ok' | 'not-setup' | 'not-linked';

/** Opt a member in. Requires the server to have a reminder channel and the member to be linked. */
export async function optInBuffReminders(
  serverId: string,
  discordUserId: string,
  store: LinkStore = new LinkStore()
): Promise<OptInResult> {
  const cfg = ServerConfigManager.getBuffRemindersConfig(serverId);
  if (!cfg?.enabled || !cfg.channelId) {
    return 'not-setup';
  }
  if (!(await store.getLink(serverId, discordUserId))) {
    return 'not-linked';
  }
  ServerConfigManager.updateBuffRemindersConfig(serverId, {
    optedInDiscordUserIds: [...cfg.optedInDiscordUserIds, discordUserId],
  });
  return 'ok';
}

/** Opt a member out. Returns false if they were not opted in. */
export function optOutBuffReminders(serverId: string, discordUserId: string): boolean {
  const cfg = ServerConfigManager.getBuffRemindersConfig(serverId);
  if (!cfg?.optedInDiscordUserIds.includes(discordUserId)) {
    return false;
  }
  ServerConfigManager.updateBuffRemindersConfig(serverId, {
    optedInDiscordUserIds: cfg.optedInDiscordUserIds.filter(id => id !== discordUserId),
  });
  return true;
}

/**
 * Pings opted-in linked members in the server's reminder channel when their buff
 * (pill) wears off and when the debuff after it ends. One lite-profile sweep per
 * cycle covers every server; each WarEra user is fetched once even if linked in
 * several servers. Reminders are at most one cycle (5 min) late.
 */
export class BuffReminderService implements ScheduledTask {
  readonly name = 'buff-reminders';
  readonly intervalMs = INTERVAL_MS;

  private lastCycleAt = new Date();
  private pending = new Map<string, PendingEnds>();

  constructor(
    private readonly apiService: ApiService,
    private readonly discordService: DiscordService,
    private readonly store: LinkStore = new LinkStore()
  ) {}

  async runCycle(): Promise<void> {
    const now = new Date();
    const since = this.lastCycleAt;
    this.lastCycleAt = now;

    // serverId -> [discordUserId, wareraUserId][]
    const recipients = new Map<string, { channelId: string; members: Array<[string, string]> }>();
    for (const [serverId, config] of ServerConfigManager.readServerConfigs()) {
      const cfg = config.buffReminders;
      if (!cfg?.enabled || !cfg.channelId || cfg.optedInDiscordUserIds.length === 0) {
        continue;
      }
      const opted = new Set(cfg.optedInDiscordUserIds);
      const links = (await this.store.listLinks(serverId)).filter(l => opted.has(l.discordUserId));
      if (links.length > 0) {
        recipients.set(serverId, {
          channelId: cfg.channelId,
          members: links.map(l => [l.discordUserId, l.wareraUserId] as [string, string]),
        });
      }
    }

    const wareraIds = [...new Set([...recipients.values()].flatMap(r => r.members.map(([, w]) => w)))];
    if (wareraIds.length === 0) {
      this.pending.clear();
      return;
    }
    const users = await this.apiService.fetchUsersLite(wareraIds);

    const eventsByUser = new Map<string, BuffEvent[]>();
    const nextPending = new Map<string, PendingEnds>();
    for (const id of wareraIds) {
      const user = users.get(id);
      if (!user) {
        // Fetch failed: keep what we knew so the expiry is still caught next cycle.
        const kept = this.pending.get(id);
        if (kept) {
          nextPending.set(id, kept);
        }
        continue;
      }
      const { events, pending } = detectBuffEvents(user.buffs, this.pending.get(id), since, now);
      eventsByUser.set(id, events);
      if (pending.buffEndAt || pending.debuffEndAt) {
        nextPending.set(id, pending);
      }
    }
    this.pending = nextPending;

    for (const [serverId, { channelId, members }] of recipients) {
      const lines = members.flatMap(([discordId, wareraId]) =>
        (eventsByUser.get(wareraId) ?? []).map(e => formatBuffEvent(discordId, e))
      );
      if (lines.length === 0) {
        continue;
      }
      const sent = await this.discordService.sendToChannel(channelId, lines.join('\n'));
      if (!sent) {
        logger.warn(`Buff reminders: failed to post ${lines.length} reminder(s) for server ${serverId}`);
      }
    }
  }
}
