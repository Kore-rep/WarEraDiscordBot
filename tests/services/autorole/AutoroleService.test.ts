import { Client, Guild, GuildMember } from 'discord.js';
import { ApiService } from '../../../src/services/api/ApiService';
import { DiscordService } from '../../../src/services/discord/DiscordService';
import { AutoroleService } from '../../../src/services/autorole/AutoroleService';
import { ServerConfigManager } from '../../../src/utils/serverConfigManager';

describe('AutoroleService unlink', () => {
  it('removes every configured Prestige tier when a member unlinks', async () => {
    const held = new Set(['prestige1', 'prestige2']);
    const remove = jest.fn().mockResolvedValue(undefined);
    const member = {
      id: 'member-1',
      user: { bot: false },
      guild: { id: 'server-1' },
      roles: { cache: { has: (id: string) => held.has(id) }, remove },
    } as unknown as GuildMember;
    const guild = {
      members: { fetch: jest.fn().mockResolvedValue(member) },
    } as unknown as Guild;
    const client = {
      guilds: { fetch: jest.fn().mockResolvedValue(guild) },
    } as unknown as Client;
    const config = jest.spyOn(ServerConfigManager, 'getAutoroleConfig').mockReturnValue({
      prestigeRoles: [
        { roleId: 'prestige1', minLevel: 1 },
        { roleId: 'prestige2', minLevel: 2 },
      ],
    } as never);
    try {
      const service = new AutoroleService(client, {} as DiscordService, {} as ApiService);
      await service.onUnlinked('server-1', 'member-1');
      expect(remove.mock.calls.map(call => call[0])).toEqual(['prestige1', 'prestige2']);
    } finally {
      config.mockRestore();
    }
  });
});
