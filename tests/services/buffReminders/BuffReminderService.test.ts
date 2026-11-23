import {
  BuffReminderService,
  advanceBuffState,
  formatBuffEvent,
  optInBuffReminders,
  wants,
  describeBuffReminderChoices,
} from '../../../src/services/buffReminders/BuffReminderService';
import { ServerConfigManager } from '../../../src/utils/serverConfigManager';

jest.mock('../../../src/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

const at = (hhmm: string) => new Date(`2026-11-18T${hhmm}:00.000Z`);
const iso = (hhmm: string) => at(hhmm).toISOString();

describe('advanceBuffState', () => {
  const buffs = { buffEndAt: iso('13:00'), debuffEndAt: iso('15:00') };

  it('says nothing while the buff has more than 10 minutes left', () => {
    expect(advanceBuffState({}, buffs, true, at('12:49')).events).toEqual([]);
  });

  it('warns once inside the last 10 minutes', () => {
    const first = advanceBuffState({}, buffs, true, at('12:50'));
    expect(first.events).toEqual([{ kind: 'buffEndingSoon', endAt: iso('13:00') }]);
    expect(advanceBuffState(first.state, undefined, false, at('12:51')).events).toEqual([]);
    expect(advanceBuffState(first.state, buffs, true, at('12:55')).events).toEqual([]);
  });

  it('warns immediately when a buff is first seen with under 10 minutes left', () => {
    expect(advanceBuffState({}, buffs, true, at('12:57')).events).toEqual([{ kind: 'buffEndingSoon', endAt: iso('13:00') }]);
  });

  it('announces the end and the debuff end from remembered times without re-fetching', () => {
    const warned = advanceBuffState({}, buffs, true, at('12:50')).state;
    const ended = advanceBuffState(warned, undefined, false, at('13:00'));
    expect(ended.events).toEqual([{ kind: 'buffEnded', debuffEndAt: iso('15:00') }]);
    expect(advanceBuffState(ended.state, {}, true, at('13:05')).events).toEqual([]);
    expect(advanceBuffState(ended.state, {}, true, at('15:01')).events).toEqual([{ kind: 'debuffEnded' }]);
  });

  it('skips the warning but still announces an end first noticed just after it happened', () => {
    expect(advanceBuffState({}, buffs, true, at('13:03')).events).toEqual([{ kind: 'buffEnded', debuffEndAt: iso('15:00') }]);
  });

  it('stays quiet about ends long past when first noticed', () => {
    expect(advanceBuffState({}, buffs, true, at('13:30')).events).toEqual([]);
  });

  it('treats a new pill (new end time) as a fresh buff', () => {
    const done = advanceBuffState(advanceBuffState({}, buffs, true, at('12:50')).state, buffs, true, at('13:00')).state;
    const next = { buffEndAt: iso('18:00'), debuffEndAt: iso('20:00') };
    expect(advanceBuffState(done, next, true, at('17:50')).events).toEqual([{ kind: 'buffEndingSoon', endAt: iso('18:00') }]);
  });
});

describe('formatBuffEvent', () => {
  it('uses Discord timestamps', () => {
    const unix = Math.floor(at('13:00').getTime() / 1000);
    expect(formatBuffEvent({ kind: 'buffEndingSoon', endAt: iso('13:00') })).toBe(`⏳ Your buff ends <t:${unix}:R> (at <t:${unix}:t>).`);
    expect(formatBuffEvent({ kind: 'debuffEnded' })).toBe('✅ Your debuff is over, you can take a pill again.');
    expect(formatBuffEvent({ kind: 'buffEnded', debuffEndAt: iso('11:00') }, at('12:00'))).toBe('💊 Your buff has worn off.');
  });
});

const ALL = { preWarning: true, debuffEnd: true };

describe('choices', () => {
  it('always sends the buff-ended DM and gates the optional ones', () => {
    const none = { preWarning: false, debuffEnd: false };
    expect(wants({ kind: 'buffEnded' }, none)).toBe(true);
    expect(wants({ kind: 'buffEndingSoon', endAt: iso('13:00') }, none)).toBe(false);
    expect(wants({ kind: 'debuffEnded' }, none)).toBe(false);
    expect(wants({ kind: 'debuffEnded' }, ALL)).toBe(true);
  });

  it('describes them in plain English', () => {
    expect(describeBuffReminderChoices(ALL)).toBe('10 minutes before your buff ends, when it ends and when your debuff is over');
    expect(describeBuffReminderChoices({ preWarning: false, debuffEnd: false })).toBe('when it ends');
  });
});

describe('optInBuffReminders', () => {
  const store = { getLink: jest.fn() };
  const discord = { sendDirectMessage: jest.fn() };

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    jest.spyOn(ServerConfigManager, 'getBuffRemindersConfig').mockReturnValue(undefined);
    jest.spyOn(ServerConfigManager, 'updateBuffRemindersConfig').mockImplementation(() => undefined);
  });

  it('requires a link', async () => {
    store.getLink.mockResolvedValue(null);
    expect(await optInBuffReminders('s', 'd', ALL, discord as never, store as never)).toBe('not-linked');
  });

  it('does not sign up a member the bot cannot DM', async () => {
    store.getLink.mockResolvedValue({});
    discord.sendDirectMessage.mockResolvedValue(false);
    expect(await optInBuffReminders('s', 'd', ALL, discord as never, store as never)).toBe('dm-blocked');
    expect(ServerConfigManager.updateBuffRemindersConfig).not.toHaveBeenCalled();
  });

  it('signs up after a confirmation DM, and respects a staff disable', async () => {
    store.getLink.mockResolvedValue({});
    discord.sendDirectMessage.mockResolvedValue(true);
    expect(await optInBuffReminders('s', 'd', ALL, discord as never, store as never)).toBe('ok');
    expect(ServerConfigManager.updateBuffRemindersConfig).toHaveBeenCalledWith('s', { subscribers: [{ discordUserId: 'd', ...ALL }] });

    jest.spyOn(ServerConfigManager, 'getBuffRemindersConfig').mockReturnValue({ enabled: false, subscribers: [] });
    expect(await optInBuffReminders('s', 'd', ALL, discord as never, store as never)).toBe('disabled');
  });

  it('updates an existing member\'s choices without another confirmation DM', async () => {
    store.getLink.mockResolvedValue({});
    jest.spyOn(ServerConfigManager, 'getBuffRemindersConfig').mockReturnValue({
      enabled: true,
      subscribers: [{ discordUserId: 'other', ...ALL }, { discordUserId: 'd', ...ALL }],
    });
    const choices = { preWarning: false, debuffEnd: true };
    expect(await optInBuffReminders('s', 'd', choices, discord as never, store as never)).toBe('updated');
    expect(discord.sendDirectMessage).not.toHaveBeenCalled();
    expect(ServerConfigManager.updateBuffRemindersConfig).toHaveBeenCalledWith('s', {
      subscribers: [{ discordUserId: 'other', ...ALL }, { discordUserId: 'd', ...choices }],
    });
  });
});

describe('BuffReminderService cycle', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('DMs each signed-up member once, refetching profiles only every 5 minutes', async () => {
    jest.useFakeTimers().setSystemTime(at('12:45'));
    const sendDirectMessage = jest.fn().mockResolvedValue(true);
    const fetchUsersLite = jest.fn(async (ids: string[]) =>
      new Map(ids.map(id => [id, { buffs: { buffEndAt: iso('12:56') } }]))
    );
    const store = {
      listLinks: jest.fn(async (serverId: string) =>
        serverId === 's3'
          ? [{ discordUserId: 'd3', wareraUserId: 'w3' }]
          : [
              { discordUserId: 'd1', wareraUserId: 'w1' },
              { discordUserId: 'd2', wareraUserId: 'w2' },
            ]
      ),
    };
    jest.spyOn(ServerConfigManager, 'readServerConfigs').mockReturnValue(
      new Map([
        ['s1', { buffReminders: { enabled: true, subscribers: [{ discordUserId: 'd1', preWarning: false, debuffEnd: false }] } }],
        // same member, second server: its pre-warning choice wins (choices are merged)
        ['s2', { buffReminders: { enabled: true, subscribers: [{ discordUserId: 'd1', preWarning: true, debuffEnd: false }] } }],
        ['s3', { buffReminders: { enabled: false, subscribers: [{ discordUserId: 'd3', ...ALL }] } }],
      ])
    );
    const service = new BuffReminderService({ fetchUsersLite } as never, { sendDirectMessage } as never, store as never);

    await service.runCycle(); // 12:45 — fetch, 11 min left: nothing
    expect(fetchUsersLite).toHaveBeenCalledWith(['w1']);
    expect(sendDirectMessage).not.toHaveBeenCalled();

    jest.setSystemTime(at('12:46'));
    await service.runCycle(); // 10 min left: warn from memory, no refetch
    expect(fetchUsersLite).toHaveBeenCalledTimes(1);
    expect(sendDirectMessage).toHaveBeenCalledTimes(1);
    expect(sendDirectMessage.mock.calls[0][0]).toBe('d1');
    expect(sendDirectMessage.mock.calls[0][1]).toMatch(/^⏳ Your buff ends/);

    jest.setSystemTime(at('12:50'));
    await service.runCycle(); // 5 min since fetch: refetch, no repeat
    expect(fetchUsersLite).toHaveBeenCalledTimes(2);
    expect(sendDirectMessage).toHaveBeenCalledTimes(1);

    jest.setSystemTime(at('12:56'));
    await service.runCycle();
    expect(sendDirectMessage).toHaveBeenCalledTimes(2);
    expect(sendDirectMessage.mock.calls[1][1]).toMatch(/^💊 Your buff has worn off\./);
  });

  it('skips the optional DMs a member turned off', async () => {
    jest.useFakeTimers().setSystemTime(at('12:55'));
    const sendDirectMessage = jest.fn().mockResolvedValue(true);
    const fetchUsersLite = jest.fn(async () => new Map([['w1', { buffs: { buffEndAt: iso('12:56'), debuffEndAt: iso('12:58') } }]]));
    const store = { listLinks: jest.fn(async () => [{ discordUserId: 'd1', wareraUserId: 'w1' }]) };
    jest.spyOn(ServerConfigManager, 'readServerConfigs').mockReturnValue(
      new Map([['s1', { buffReminders: { enabled: true, subscribers: [{ discordUserId: 'd1', preWarning: false, debuffEnd: false }] } }]])
    );
    const service = new BuffReminderService({ fetchUsersLite } as never, { sendDirectMessage } as never, store as never);
    for (const t of ['12:55', '12:56', '12:58']) {
      jest.setSystemTime(at(t));
      await service.runCycle();
    }
    expect(sendDirectMessage.mock.calls.map(c => c[1].split('\n')[0])).toEqual(['💊 Your buff has worn off. Debuff ends <t:' + Math.floor(at('12:58').getTime() / 1000) + ':R>.']);
  });
});
