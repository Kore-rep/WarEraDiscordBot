import {
  BuffReminderService,
  detectBuffEvents,
  formatBuffEvent,
} from '../../../src/services/buffReminders/BuffReminderService';
import { ServerConfigManager } from '../../../src/utils/serverConfigManager';

jest.mock('../../../src/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

const since = new Date('2026-11-18T12:00:00.000Z');
const now = new Date('2026-11-18T12:05:00.000Z');

describe('detectBuffEvents', () => {
  it('fires when a buff ends inside the window and remembers the debuff', () => {
    const result = detectBuffEvents(
      { buffEndAt: '2026-11-18T12:03:00.000Z', debuffEndAt: '2026-11-19T00:00:00.000Z' },
      undefined,
      since,
      now
    );
    expect(result.events).toEqual([{ kind: 'buffEnded', debuffEndAt: '2026-11-19T00:00:00.000Z' }]);
    expect(result.pending).toEqual({ debuffEndAt: '2026-11-19T00:00:00.000Z' });
  });

  it('uses a remembered end time when the API has dropped the field', () => {
    const result = detectBuffEvents({}, { debuffEndAt: '2026-11-18T12:04:00.000Z' }, since, now);
    expect(result.events).toEqual([{ kind: 'debuffEnded' }]);
    expect(result.pending).toEqual({});
  });

  it('ignores ends outside the window and future ones', () => {
    const result = detectBuffEvents({ buffEndAt: '2026-11-18T11:00:00.000Z', debuffEndAt: '2026-11-18T13:00:00.000Z' }, undefined, since, now);
    expect(result.events).toEqual([]);
    expect(result.pending).toEqual({ debuffEndAt: '2026-11-18T13:00:00.000Z' });
  });

  it('fires once even when the API and memory agree', () => {
    const end = '2026-11-18T12:01:00.000Z';
    expect(detectBuffEvents({ buffEndAt: end }, { buffEndAt: end }, since, now).events).toHaveLength(1);
  });
});

describe('formatBuffEvent', () => {
  it('mentions the member', () => {
    expect(formatBuffEvent('123', { kind: 'debuffEnded' })).toBe('✅ <@123> your debuff is over, you can take a pill again.');
    expect(formatBuffEvent('123', { kind: 'buffEnded' })).toBe('💊 <@123> your buff has worn off.');
  });
});

describe('BuffReminderService cycle', () => {
  it('pings opted-in linked members only, one fetch per WarEra user across servers', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-18T12:00:00.000Z'));
    const sendToChannel = jest.fn().mockResolvedValue('msg');
    const fetchUsersLite = jest.fn(async () =>
      new Map([['w1', { buffs: { buffEndAt: '2026-11-18T12:02:00.000Z' } }]])
    );
    const store = {
      listLinks: jest.fn(async (serverId: string) => [
        { discordUserId: serverId === 's1' ? 'd1' : 'd9', wareraUserId: 'w1' },
        { discordUserId: 'd2', wareraUserId: 'w2' },
      ]),
    };
    jest.spyOn(ServerConfigManager, 'readServerConfigs').mockReturnValue(
      new Map([
        ['s1', { buffReminders: { enabled: true, channelId: 'c-s1', optedInDiscordUserIds: ['d1'] } }],
        ['s2', { buffReminders: { enabled: true, channelId: 'c-s2', optedInDiscordUserIds: ['d9'] } }],
        ['s3', { buffReminders: { enabled: false, channelId: 'c-s3', optedInDiscordUserIds: ['d1'] } }],
      ])
    );
    const service = new BuffReminderService({ fetchUsersLite } as never, { sendToChannel } as never, store as never);

    jest.setSystemTime(new Date('2026-11-18T12:05:00.000Z'));
    await service.runCycle();

    expect(fetchUsersLite).toHaveBeenCalledWith(['w1']);
    expect(sendToChannel.mock.calls).toEqual([
      ['c-s1', '💊 <@d1> your buff has worn off.'],
      ['c-s2', '💊 <@d9> your buff has worn off.'],
    ]);

    jest.setSystemTime(new Date('2026-11-18T12:10:00.000Z'));
    await service.runCycle();
    expect(sendToChannel).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });
});
