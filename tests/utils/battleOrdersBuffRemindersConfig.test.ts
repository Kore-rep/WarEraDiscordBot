import { ServerConfigManager } from '../../src/utils/serverConfigManager';
import { prisma } from '../../src/persistence/prisma';
import { pushTestSchema, clearTables } from '../setup/testDb';

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

const SERVER = 'orders-buffs-server';

describe('ServerConfigManager battle orders + buff reminders blocks', () => {
  beforeAll(() => {
    pushTestSchema();
  });

  afterAll(async () => {
    ServerConfigManager.clearCache();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await ServerConfigManager.flush();
    await clearTables();
    await prisma.server.create({ data: { id: SERVER } });
    await ServerConfigManager.loadConfigs();
  });

  afterEach(async () => {
    await ServerConfigManager.flush();
    ServerConfigManager.clearCache();
  });

  it('starts battle orders from defaults with every level on', () => {
    ServerConfigManager.updateBattleOrdersConfig(SERVER, { channelId: 'chan' });
    expect(ServerConfigManager.getBattleOrdersConfig(SERVER)).toEqual({
      enabled: true,
      channelId: 'chan',
      roleIds: [],
      priorities: ['low', 'medium', 'high'],
      countries: [],
      mus: [],
    });
  });

  it('merges partial updates without clearing omitted fields', () => {
    ServerConfigManager.updateBattleOrdersConfig(SERVER, {
      channelId: 'chan',
      countries: [{ countryId: 'c1', countryName: 'Ukraine' }],
    });
    ServerConfigManager.updateBattleOrdersConfig(SERVER, { priorities: ['high'], channelId: undefined });
    const cfg = ServerConfigManager.getBattleOrdersConfig(SERVER)!;
    expect(cfg.channelId).toBe('chan');
    expect(cfg.priorities).toEqual(['high']);
    expect(cfg.countries).toEqual([{ countryId: 'c1', countryName: 'Ukraine' }]);
  });

  it('round-trips both blocks through the database and drops bad levels', async () => {
    ServerConfigManager.updateBattleOrdersConfig(SERVER, {
      channelId: 'chan',
      roleIds: ['r1'],
      priorities: ['high', 'bogus' as never],
      mus: [{ muId: 'mu1', muName: 'Impi' }],
    });
    ServerConfigManager.updateBuffRemindersConfig(SERVER, { channelId: 'buffs', optedInDiscordUserIds: ['u1', 'u1', 'u2'] });
    await ServerConfigManager.flush();
    ServerConfigManager.clearCache();
    await ServerConfigManager.loadConfigs();

    expect(ServerConfigManager.getBattleOrdersConfig(SERVER)).toMatchObject({
      channelId: 'chan',
      roleIds: ['r1'],
      priorities: ['high'],
      mus: [{ muId: 'mu1', muName: 'Impi' }],
    });
    expect(ServerConfigManager.getBuffRemindersConfig(SERVER)).toEqual({
      enabled: true,
      channelId: 'buffs',
      optedInDiscordUserIds: ['u1', 'u2'],
    });
  });

  it('returns copies that cannot mutate the cache', () => {
    ServerConfigManager.updateBuffRemindersConfig(SERVER, { channelId: 'buffs', optedInDiscordUserIds: ['u1'] });
    ServerConfigManager.getBuffRemindersConfig(SERVER)!.optedInDiscordUserIds.push('intruder');
    expect(ServerConfigManager.getBuffRemindersConfig(SERVER)!.optedInDiscordUserIds).toEqual(['u1']);
  });
});
