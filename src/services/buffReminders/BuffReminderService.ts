import type { UserDTO } from 'warera-sdk';
import { ApiService } from '../api/ApiService';
import { DiscordService } from '../discord/DiscordService';
import { ScheduledTask } from '../scheduler/ScheduledTask';
import { LinkStore } from '../autorole/linkStore';
import { ServerConfigManager } from '../../utils/serverConfigManager';
import { logger } from '../../utils/logger';
import { BuffReminderSubscriber } from '../../config/config';

/** Reminders are checked every minute against known end times... */
const TICK_MS = 60 * 1000;
/** ...while each member's profile is re-fetched at most this often. */
const REFRESH_MS = 5 * 60 * 1000;
/** How long before a buff ends the warning is sent. */
export const WARN_BEFORE_MS = 10 * 60 * 1000;
/** Ends further in the past than this when first noticed are not worth a DM. */
const STALE_AFTER_MS = 15 * 60 * 1000;

export type BuffEvent =
  | { kind: 'buffEndingSoon'; endAt: string }
  | { kind: 'buffEnded'; debuffEndAt?: string }
  | { kind: 'debuffEnded' };

/** One known end time and what has already been sent for it. */
export interface TrackedEnd {
  at: string;
  warned: boolean;
  notified: boolean;
}

export interface BuffState {
  buff?: TrackedEnd;
  debuff?: TrackedEnd;
}

const ms = (iso: string) => new Date(iso).getTime();

/** Adopt an end time reported by the API; a new value resets what was sent. */
function track(current: TrackedEnd | undefined, reported: string | undefined): TrackedEnd | undefined {
  if (!reported || Number.isNaN(ms(reported))) {
    // Field gone: keep an end we still owe a DM for, drop one already handled.
    return current && !current.notified ? current : undefined;
  }
  return current?.at === reported ? current : { at: reported, warned: false, notified: false };
}

/**
 * Advance one member's state to `now`. `buffs` is the freshly fetched profile
 * block, or undefined when the profile was not re-fetched this tick (the known
 * end times are still checked). Each end time triggers each DM at most once.
 */
export function advanceBuffState(
  prev: BuffState,
  buffs: UserDTO['buffs'] | undefined,
  fetched: boolean,
  now: Date
): { state: BuffState; events: BuffEvent[] } {
  const state: BuffState = fetched
    ? { buff: track(prev.buff, buffs?.buffEndAt), debuff: track(prev.debuff, buffs?.debuffEndAt) }
    : { buff: prev.buff && { ...prev.buff }, debuff: prev.debuff && { ...prev.debuff } };
  const events: BuffEvent[] = [];
  const t = now.getTime();

  if (state.buff) {
    const end = ms(state.buff.at);
    if (!state.buff.warned && t < end && t >= end - WARN_BEFORE_MS) {
      state.buff.warned = true;
      events.push({ kind: 'buffEndingSoon', endAt: state.buff.at });
    }
    if (!state.buff.notified && t >= end) {
      state.buff.notified = true;
      state.buff.warned = true;
      if (t - end <= STALE_AFTER_MS) {
        events.push({ kind: 'buffEnded', debuffEndAt: state.debuff?.at });
      }
    }
  }
  if (state.debuff && !state.debuff.notified && t >= ms(state.debuff.at)) {
    state.debuff.notified = true;
    if (t - ms(state.debuff.at) <= STALE_AFTER_MS) {
      events.push({ kind: 'debuffEnded' });
    }
  }
  return { state, events };
}

const unix = (iso: string) => Math.floor(ms(iso) / 1000);

export function formatBuffEvent(event: BuffEvent, now: Date = new Date()): string {
  switch (event.kind) {
    case 'buffEndingSoon':
      return `⏳ Your buff ends <t:${unix(event.endAt)}:R> (at <t:${unix(event.endAt)}:t>).`;
    case 'buffEnded': {
      const debuff =
        event.debuffEndAt && ms(event.debuffEndAt) > now.getTime() ? ` Debuff ends <t:${unix(event.debuffEndAt)}:R>.` : '';
      return `💊 Your buff has worn off.${debuff}`;
    }
    case 'debuffEnded':
      return '✅ Your debuff is over, you can take a pill again.';
  }
}

/** Whether a member's choices include this DM (the buff-ended DM is always sent). */
export function wants(event: BuffEvent, choices: BuffReminderChoices): boolean {
  if (event.kind === 'buffEndingSoon') return choices.preWarning;
  if (event.kind === 'debuffEnded') return choices.debuffEnd;
  return true;
}

const FOOTER = '\n-# Stop these with `/buffreminders off`.';

export type OptInResult = 'ok' | 'updated' | 'disabled' | 'not-linked' | 'dm-blocked';

export type BuffReminderChoices = Pick<BuffReminderSubscriber, 'preWarning' | 'debuffEnd'>;

/** Plain-English list of the DMs a member will get, e.g. for status replies. */
export function describeBuffReminderChoices({ preWarning, debuffEnd }: BuffReminderChoices): string {
  const parts = [preWarning && '10 minutes before your buff ends', 'when it ends', debuffEnd && 'when your debuff is over'];
  const list = parts.filter((p): p is string => !!p);
  return list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0];
}

/**
 * Opt a member in (or change their choices). They must be linked and reminders
 * must not be disabled on the server. A new sign-up is confirmed by DM, and the
 * member is only added if that DM arrives.
 */
export async function optInBuffReminders(
  serverId: string,
  discordUserId: string,
  choices: BuffReminderChoices,
  discordService: DiscordService,
  store: LinkStore = new LinkStore()
): Promise<OptInResult> {
  const cfg = ServerConfigManager.getBuffRemindersConfig(serverId);
  if (cfg && !cfg.enabled) {
    return 'disabled';
  }
  if (!(await store.getLink(serverId, discordUserId))) {
    return 'not-linked';
  }
  const others = (cfg?.subscribers ?? []).filter(s => s.discordUserId !== discordUserId);
  const existing = others.length !== (cfg?.subscribers.length ?? 0);
  if (!existing) {
    const delivered = await discordService.sendDirectMessage(
      discordUserId,
      `💊 Buff reminders are on. I'll DM you ${describeBuffReminderChoices(choices)}.` + FOOTER
    );
    if (!delivered) {
      return 'dm-blocked';
    }
  }
  ServerConfigManager.updateBuffRemindersConfig(serverId, {
    subscribers: [...others, { discordUserId, ...choices }],
  });
  return existing ? 'updated' : 'ok';
}


/** Opt a member out. Returns false if they were not opted in. */
export function optOutBuffReminders(serverId: string, discordUserId: string): boolean {
  const cfg = ServerConfigManager.getBuffRemindersConfig(serverId);
  if (!cfg?.subscribers.some(s => s.discordUserId === discordUserId)) {
    return false;
  }
  ServerConfigManager.updateBuffRemindersConfig(serverId, {
    subscribers: cfg.subscribers.filter(s => s.discordUserId !== discordUserId),
  });
  return true;
}

/**
 * DMs opted-in linked members 10 minutes before their buff (pill) ends, when it
 * ends, and when the debuff after it ends. Ticks every minute against known end
 * times; each member's profile is re-fetched at most every 5 minutes (batched,
 * once per WarEra account across servers). A member signed up in several
 * servers gets one DM per event, with the optional DMs enabled if any of those
 * servers' sign-ups enable them. State is in memory.
 */
export class BuffReminderService implements ScheduledTask {
  readonly name = 'buff-reminders';
  readonly intervalMs = TICK_MS;

  private states = new Map<string, BuffState>();
  private fetchedAt = new Map<string, number>();

  constructor(
    private readonly apiService: ApiService,
    private readonly discordService: DiscordService,
    private readonly store: LinkStore = new LinkStore()
  ) {}

  async runCycle(): Promise<void> {
    const now = new Date();

    // wareraUserId -> discordUserId -> choices (merged across servers)
    const recipients = new Map<string, Map<string, BuffReminderChoices>>();
    for (const [serverId, config] of ServerConfigManager.readServerConfigs()) {
      const cfg = config.buffReminders;
      if (!cfg?.enabled || cfg.subscribers.length === 0) {
        continue;
      }
      const subs = new Map(cfg.subscribers.map(s => [s.discordUserId, s]));
      for (const link of await this.store.listLinks(serverId)) {
        const sub = subs.get(link.discordUserId);
        if (!sub) {
          continue;
        }
        const byDiscord = recipients.get(link.wareraUserId) ?? new Map<string, BuffReminderChoices>();
        const prev = byDiscord.get(link.discordUserId);
        byDiscord.set(link.discordUserId, {
          preWarning: sub.preWarning || !!prev?.preWarning,
          debuffEnd: sub.debuffEnd || !!prev?.debuffEnd,
        });
        recipients.set(link.wareraUserId, byDiscord);
      }
    }

    // Forget members who are no longer signed up anywhere.
    for (const id of [...this.states.keys(), ...this.fetchedAt.keys()]) {
      if (!recipients.has(id)) {
        this.states.delete(id);
        this.fetchedAt.delete(id);
      }
    }
    if (recipients.size === 0) {
      return;
    }

    const due = [...recipients.keys()].filter(id => now.getTime() - (this.fetchedAt.get(id) ?? 0) >= REFRESH_MS);
    const users = due.length > 0 ? await this.apiService.fetchUsersLite(due) : new Map<string, UserDTO>();

    const dms: Array<[string, string]> = [];
    for (const [wareraId, discordIds] of recipients) {
      const user = users.get(wareraId);
      if (user) {
        this.fetchedAt.set(wareraId, now.getTime());
      }
      const { state, events } = advanceBuffState(this.states.get(wareraId) ?? {}, user?.buffs, !!user, now);
      this.states.set(wareraId, state);
      for (const event of events) {
        const text = formatBuffEvent(event, now) + FOOTER;
        for (const [discordId, choices] of discordIds) {
          if (wants(event, choices)) {
            dms.push([discordId, text]);
          }
        }
      }
    }

    for (const [discordId, text] of dms) {
      if (!(await this.discordService.sendDirectMessage(discordId, text))) {
        logger.debug(`Buff reminders: could not DM ${discordId}`);
      }
    }
  }
}
