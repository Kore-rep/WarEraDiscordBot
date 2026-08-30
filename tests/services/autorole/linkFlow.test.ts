import { prisma } from '../../../src/persistence/prisma';
import { ServerConfigManager } from '../../../src/utils/serverConfigManager';
import { LinkFlow } from '../../../src/services/autorole/linkFlow';
import { LinkStore } from '../../../src/services/autorole/linkStore';
import { AutoroleApi, AutoroleUser } from '../../../src/services/autorole/autoroleApi';
import { DiscordService } from '../../../src/services/discord/DiscordService';
import { pushTestSchema, clearTables } from '../../setup/testDb';

jest.mock('../../../src/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

const SERVER = 'link-flow-server';
const ALLOWED_COUNTRY = 'country-allowed';

const wareraUser = (overrides: Partial<AutoroleUser> = {}): AutoroleUser =>
  ({
    _id: 'warera-1',
    username: 'Player',
    country: ALLOWED_COUNTRY,
    ...overrides,
  }) as AutoroleUser;

describe('LinkFlow', () => {
  const store = new LinkStore();
  let api: jest.Mocked<Pick<AutoroleApi, 'getUserLite' | 'resolveUserByUsername' | 'getCompanyNamesForUser'>>;
  let discord: jest.Mocked<
    Pick<DiscordService, 'sendDirectMessage' | 'sendToChannelWithComponents' | 'editMessage'>
  >;
  let onLinked: jest.Mock;
  let flow: LinkFlow;

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
    ServerConfigManager.updateAutoroleConfig(SERVER, {
      allowedCountryIds: [ALLOWED_COUNTRY],
      proxyRoleIds: ['proxy-role'],
      reviewChannelId: 'review-chan',
    });

    api = {
      getUserLite: jest.fn().mockResolvedValue(wareraUser()),
      resolveUserByUsername: jest.fn().mockResolvedValue(wareraUser()),
      getCompanyNamesForUser: jest.fn().mockResolvedValue([]),
    };
    discord = {
      sendDirectMessage: jest.fn().mockResolvedValue(true),
      sendToChannelWithComponents: jest.fn().mockResolvedValue('review-msg-1'),
      editMessage: jest.fn().mockResolvedValue(true),
    };
    onLinked = jest.fn().mockResolvedValue(undefined);
    flow = new LinkFlow(
      api as unknown as AutoroleApi,
      store,
      discord as unknown as DiscordService,
      onLinked
    );
  });

  afterEach(async () => {
    await ServerConfigManager.flush();
    ServerConfigManager.clearCache();
  });

  const begin = (overrides: Partial<Parameters<LinkFlow['beginLink']>[0]> = {}) =>
    flow.beginLink({
      serverId: SERVER,
      discordUserId: 'discord-1',
      memberRoleIds: [],
      rawInput: 'aaaaaaaaaaaaaaaaaaaaaaaa',
      ...overrides,
    });

  it('rejects empty input', async () => {
    expect((await begin({ rawInput: '  ' })).status).toBe('invalid-input');
  });

  it('reports unknown accounts', async () => {
    api.getUserLite.mockResolvedValue(null);
    expect((await begin()).status).toBe('not-found');
  });

  it('starts a DM verification for an allowed-country user', async () => {
    const result = await begin();
    expect(result.status).toBe('verification-dm-sent');
    expect(discord.sendDirectMessage).toHaveBeenCalledTimes(1);
    const verification = await store.getVerification(SERVER, 'discord-1');
    expect(verification?.code).toMatch(/^\d{6}$/);
    expect(await store.getLink(SERVER, 'discord-1')).toBeNull();
  });

  it('links immediately when verification is bypassed', async () => {
    ServerConfigManager.updateAutoroleConfig(SERVER, { skipCompanyVerification: true });
    const result = await begin();
    expect(result).toEqual({ status: 'linked', username: 'Player' });
    expect((await store.getLink(SERVER, 'discord-1'))?.wareraUserId).toBe('warera-1');
    expect(onLinked).toHaveBeenCalledWith(SERVER, 'discord-1');
    expect(discord.sendDirectMessage).not.toHaveBeenCalled();
  });

  it('sends the configured welcome DM after an immediate link', async () => {
    ServerConfigManager.updateAutoroleConfig(SERVER, {
      skipCompanyVerification: true,
      welcomeMessage: 'Welcome to the server!',
    });

    expect((await begin()).status).toBe('linked');
    expect(discord.sendDirectMessage).toHaveBeenCalledWith('discord-1', 'Welcome to the server!');
  });

  it('keeps a completed link when the welcome DM cannot be delivered', async () => {
    ServerConfigManager.updateAutoroleConfig(SERVER, {
      skipCompanyVerification: true,
      welcomeMessage: 'Welcome to the server!',
    });
    discord.sendDirectMessage.mockResolvedValue(false);

    expect((await begin()).status).toBe('linked');
    expect((await store.getLink(SERVER, 'discord-1'))?.wareraUserId).toBe('warera-1');
    expect(onLinked).toHaveBeenCalledWith(SERVER, 'discord-1');
  });

  it('rolls back the verification when the DM fails', async () => {
    discord.sendDirectMessage.mockResolvedValue(false);
    const result = await begin();
    expect(result.status).toBe('dm-failed');
    expect(await store.getVerification(SERVER, 'discord-1')).toBeNull();
  });

  it('routes disallowed countries to staff review', async () => {
    api.getUserLite.mockResolvedValue(wareraUser({ country: 'country-other' }));
    const result = await begin();
    expect(result).toEqual({ status: 'pending-review', username: 'Player', reviewPosted: true });
    expect(discord.sendToChannelWithComponents).toHaveBeenCalledWith(
      'review-chan',
      expect.stringContaining('<@discord-1>'),
      expect.anything()
    );
    const pending = await store.getPendingLink(SERVER, 'discord-1');
    expect(pending?.reviewMessageId).toBe('review-msg-1');
  });

  it('lets a proxy role bypass the country gate', async () => {
    api.getUserLite.mockResolvedValue(wareraUser({ country: 'country-other' }));
    const result = await begin({ memberRoleIds: ['proxy-role'] });
    expect(result.status).toBe('verification-dm-sent');
  });

  it('rejects a WarEra account already linked to someone else', async () => {
    await store.upsertLink(SERVER, 'discord-2', 'warera-1');
    expect((await begin()).status).toBe('already-linked-other');
  });

  it('rejects a WarEra account already pending for someone else', async () => {
    api.getUserLite.mockResolvedValue(wareraUser({ country: 'country-other' }));
    await begin({ discordUserId: 'discord-2' });
    expect((await begin()).status).toBe('already-pending-other');
  });

  describe('manualLink', () => {
    const manualLink = (overrides: Partial<Parameters<LinkFlow['manualLink']>[0]> = {}) =>
      flow.manualLink({
        serverId: SERVER,
        discordUserId: 'discord-1',
        rawInput: 'aaaaaaaaaaaaaaaaaaaaaaaa',
        reviewerLabel: 'Staffer',
        ...overrides,
      });

    it('links directly without country review or company verification', async () => {
      api.getUserLite.mockResolvedValue(wareraUser({ country: 'country-other' }));

      expect(await manualLink()).toEqual({
        status: 'linked',
        username: 'Player',
        wareraUserId: 'warera-1',
      });
      expect((await store.getLink(SERVER, 'discord-1'))?.wareraUserId).toBe('warera-1');
      expect(await store.getPendingLink(SERVER, 'discord-1')).toBeNull();
      expect(await store.getVerification(SERVER, 'discord-1')).toBeNull();
      expect(onLinked).toHaveBeenCalledWith(SERVER, 'discord-1');
      expect(discord.sendDirectMessage).not.toHaveBeenCalled();
    });

    it('clears pending state and resolves its review message', async () => {
      api.getUserLite.mockResolvedValue(wareraUser({ country: 'country-other' }));
      await begin();

      expect((await manualLink()).status).toBe('linked');
      expect(await store.getPendingLink(SERVER, 'discord-1')).toBeNull();
      expect(discord.editMessage).toHaveBeenLastCalledWith(
        'review-chan',
        'review-msg-1',
        expect.objectContaining({
          content: expect.stringContaining('Linked manually'),
          components: [],
        })
      );
    });

    it('refuses a WarEra account linked to another Discord member', async () => {
      await store.upsertLink(SERVER, 'discord-2', 'warera-1');
      expect(await manualLink()).toEqual({
        status: 'already-linked-other',
        discordUserId: 'discord-2',
      });
    });

    it('requires an existing different link to be removed first', async () => {
      await store.upsertLink(SERVER, 'discord-1', 'warera-old');
      expect((await manualLink()).status).toBe('target-linked-other');
      expect((await store.getLink(SERVER, 'discord-1'))?.wareraUserId).toBe('warera-old');
    });

    it('is scoped to the current server', async () => {
      await store.upsertLink('other-server', 'discord-2', 'warera-1');
      expect((await manualLink()).status).toBe('linked');
    });
  });

  describe('runVerification', () => {
    beforeEach(async () => {
      await begin();
    });

    it('reports a missing verification', async () => {
      expect((await flow.runVerification(SERVER, 'other-user')).status).toBe('no-verification');
    });

    it('links when a company carries the code', async () => {
      ServerConfigManager.updateAutoroleConfig(SERVER, { welcomeMessage: 'Verification complete—welcome!' });
      const verification = await store.getVerification(SERVER, 'discord-1');
      api.getCompanyNamesForUser.mockResolvedValue(['Some Co', verification!.code]);

      const result = await flow.runVerification(SERVER, 'discord-1');
      expect(result).toEqual({ status: 'verified', username: 'Player' });
      expect((await store.getLink(SERVER, 'discord-1'))?.wareraUserId).toBe('warera-1');
      expect(await store.getVerification(SERVER, 'discord-1')).toBeNull();
      expect(onLinked).toHaveBeenCalled();
      expect(discord.sendDirectMessage).toHaveBeenLastCalledWith(
        'discord-1',
        'Verification complete—welcome!'
      );
    });

    it('keeps the verification when the code is not found', async () => {
      api.getCompanyNamesForUser.mockResolvedValue(['Unrelated']);
      const result = await flow.runVerification(SERVER, 'discord-1');
      expect(result.status).toBe('code-not-found');
      expect(await store.getVerification(SERVER, 'discord-1')).not.toBeNull();
    });

    it('expires stale verifications', async () => {
      await prisma.pendingVerification.updateMany({
        where: { serverId: SERVER },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect((await flow.runVerification(SERVER, 'discord-1')).status).toBe('expired');
      expect(await store.getVerification(SERVER, 'discord-1')).toBeNull();
    });
  });

  describe('review decisions', () => {
    beforeEach(async () => {
      api.getUserLite.mockResolvedValue(wareraUser({ country: 'country-other' }));
      await begin();
    });

    it('approve starts company verification, resolves the review message, and DMs the user', async () => {
      const result = await flow.approvePendingLink(SERVER, 'discord-1', 'Staffer');
      expect(result).toEqual({ status: 'approved', username: 'Player', discordUserId: 'discord-1' });
      // Approval does not link yet — the member must still verify via company rename.
      expect(await store.getLink(SERVER, 'discord-1')).toBeNull();
      expect((await store.getVerification(SERVER, 'discord-1'))?.code).toMatch(/^\d{6}$/);
      expect(discord.editMessage).toHaveBeenCalledWith(
        'review-chan',
        'review-msg-1',
        expect.objectContaining({ components: [] })
      );
      expect(discord.sendDirectMessage).toHaveBeenCalledWith('discord-1', expect.stringContaining('approved'));

      // Completing the verification finishes the link and clears the pending request.
      const verification = await store.getVerification(SERVER, 'discord-1');
      api.getCompanyNamesForUser.mockResolvedValue([verification!.code]);
      expect((await flow.runVerification(SERVER, 'discord-1')).status).toBe('verified');
      expect((await store.getLink(SERVER, 'discord-1'))?.wareraUserId).toBe('warera-1');
      expect(await store.getPendingLink(SERVER, 'discord-1')).toBeNull();
    });

    it('approve reports a vanished WarEra profile and notifies the user', async () => {
      api.getUserLite.mockResolvedValue(null);
      const result = await flow.approvePendingLink(SERVER, 'discord-1', 'Staffer');
      expect(result.status).toBe('not-found');
      expect(await store.getLink(SERVER, 'discord-1')).toBeNull();
      expect(discord.sendDirectMessage).toHaveBeenCalledWith(
        'discord-1',
        expect.stringContaining('Something went wrong')
      );
    });

    it('approve refuses when the account got linked to someone else meanwhile', async () => {
      await store.upsertLink(SERVER, 'discord-9', 'warera-1');
      expect((await flow.approvePendingLink(SERVER, 'discord-1', 'Staffer')).status).toBe(
        'already-linked-other'
      );
    });

    it('deny clears the pending link and DMs the reason', async () => {
      const result = await flow.denyPendingLink(SERVER, 'discord-1', 'Staffer', 'not a citizen');
      expect(result.status).toBe('denied');
      expect(await store.getPendingLink(SERVER, 'discord-1')).toBeNull();
      expect(discord.sendDirectMessage).toHaveBeenCalledWith(
        'discord-1',
        expect.stringContaining('not a citizen')
      );
    });
  });

  it('unlink removes link, pending, and verification state', async () => {
    await begin();
    const result = await flow.unlink(SERVER, 'discord-1');
    expect(result).toEqual({ removedLink: false, removedPending: false, removedVerification: true });
    expect(await store.getVerification(SERVER, 'discord-1')).toBeNull();
  });
});
