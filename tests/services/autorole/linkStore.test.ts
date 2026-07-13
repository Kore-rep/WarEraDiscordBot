import { prisma } from '../../../src/persistence/prisma';
import { LinkStore } from '../../../src/services/autorole/linkStore';
import { pushTestSchema, clearTables } from '../../setup/testDb';

jest.mock('../../../src/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

const SERVER = 'link-store-server';
const store = new LinkStore();

describe('LinkStore', () => {
  beforeAll(() => {
    pushTestSchema();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await clearTables();
  });

  it('round-trips a linked user and finds it by either key', async () => {
    await store.upsertLink(SERVER, 'discord-1', 'warera-1');

    expect(await store.getLink(SERVER, 'discord-1')).toMatchObject({
      serverId: SERVER,
      discordUserId: 'discord-1',
      wareraUserId: 'warera-1',
      muNoticeSentAt: null,
    });
    expect(await store.findLinkByWareraId(SERVER, 'warera-1')).toMatchObject({
      discordUserId: 'discord-1',
    });
    expect(await store.findLinkByWareraId('other-server', 'warera-1')).toBeNull();
  });

  it('enforces one WarEra account per server', async () => {
    await store.upsertLink(SERVER, 'discord-1', 'warera-1');
    await expect(store.upsertLink(SERVER, 'discord-2', 'warera-1')).rejects.toThrow();
    // The same WarEra account in a different server is fine.
    await expect(store.upsertLink('other-server', 'discord-2', 'warera-1')).resolves.toBeUndefined();
  });

  it('re-linking the same member replaces their WarEra id', async () => {
    await store.upsertLink(SERVER, 'discord-1', 'warera-1');
    await store.upsertLink(SERVER, 'discord-1', 'warera-2');
    expect((await store.getLink(SERVER, 'discord-1'))?.wareraUserId).toBe('warera-2');
    expect(await store.findLinkByWareraId(SERVER, 'warera-1')).toBeNull();
  });

  it('deletes links and reports whether anything was removed', async () => {
    await store.upsertLink(SERVER, 'discord-1', 'warera-1');
    expect(await store.deleteLink(SERVER, 'discord-1')).toBe(true);
    expect(await store.deleteLink(SERVER, 'discord-1')).toBe(false);
  });

  it('tracks the no-MU notice timestamp', async () => {
    await store.upsertLink(SERVER, 'discord-1', 'warera-1');
    const at = new Date('2026-07-11T10:00:00Z');
    await store.setMuNoticeSentAt(SERVER, 'discord-1', at);
    expect((await store.getLink(SERVER, 'discord-1'))?.muNoticeSentAt).toEqual(at);
  });

  it('round-trips pending links with review message info', async () => {
    await store.upsertPendingLink({
      serverId: SERVER,
      discordUserId: 'discord-1',
      wareraUserId: 'warera-1',
      wareraUsername: 'Player',
      countryId: 'country-1',
    });
    await store.setPendingLinkReviewMessage(SERVER, 'discord-1', 'chan-1', 'msg-1');

    const pending = await store.getPendingLink(SERVER, 'discord-1');
    expect(pending).toMatchObject({
      wareraUsername: 'Player',
      countryId: 'country-1',
      reviewChannelId: 'chan-1',
      reviewMessageId: 'msg-1',
    });
    expect(await store.findPendingLinkByWareraId(SERVER, 'warera-1')).not.toBeNull();
    expect(await store.listPendingLinks(SERVER)).toHaveLength(1);

    expect(await store.deletePendingLink(SERVER, 'discord-1')).toBe(true);
    expect(await store.listPendingLinks(SERVER)).toHaveLength(0);
  });

  it('round-trips verifications and prunes expired ones', async () => {
    const now = new Date('2026-07-11T10:00:00Z');
    await store.upsertVerification({
      serverId: SERVER,
      discordUserId: 'discord-1',
      wareraUserId: 'warera-1',
      wareraUsername: 'Player',
      code: '123456',
      expiresAt: new Date(now.getTime() - 1000),
    });
    await store.upsertVerification({
      serverId: SERVER,
      discordUserId: 'discord-2',
      wareraUserId: 'warera-2',
      wareraUsername: 'Other',
      code: '654321',
      expiresAt: new Date(now.getTime() + 60_000),
    });

    expect(await store.deleteExpiredVerifications(now)).toBe(1);
    expect(await store.getVerification(SERVER, 'discord-1')).toBeNull();
    expect((await store.getVerification(SERVER, 'discord-2'))?.code).toBe('654321');
  });
});
