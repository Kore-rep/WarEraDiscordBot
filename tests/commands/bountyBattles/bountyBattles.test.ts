/// <reference types="jest" />
import { bountyBattlesCommand } from '../../../src/commands/bountyBattles/bountyBattles';
import { ChatInputCommandInteraction, ChannelType } from 'discord.js';
import { ServerConfigManager } from '../../../src/utils/serverConfigManager';
import { DiscordService } from '../../../src/services/discord/DiscordService';

// Mock dependencies
jest.mock('../../../src/utils/serverConfigManager');
jest.mock('../../../src/services/discord/DiscordService');
jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('bountyBattlesCommand', () => {
  let mockInteraction: any;
  let mockReply: jest.Mock;
  let mockDiscordService: jest.Mocked<DiscordService>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockReply = jest.fn();
    mockInteraction = {
      guildId: 'test-guild-id',
      reply: mockReply,
      options: {
        getSubcommandGroup: jest.fn(),
        getSubcommand: jest.fn(),
        getChannel: jest.fn(),
        getRole: jest.fn(),
        getNumber: jest.fn(),
      },
    };

    mockDiscordService = {
      clearServerTracking: jest.fn(),
    } as any;
  });

  describe('command structure', () => {
    it('should have correct command name', () => {
      expect(bountyBattlesCommand.data.name).toBe('bountybattles');
    });

    it('should have a description', () => {
      expect(bountyBattlesCommand.data.description).toBeTruthy();
    });
  });

  describe('/bountybattles config set', () => {
    beforeEach(() => {
      (mockInteraction.options!.getSubcommandGroup as jest.Mock).mockReturnValue('config');
      (mockInteraction.options!.getSubcommand as jest.Mock).mockReturnValue('set');
    });

    it('should configure server with channel and role', async () => {
      const mockChannel = {
        id: 'channel-123',
        type: ChannelType.GuildText,
      };
      const mockRole = {
        id: 'role-456',
        name: 'Fighters',
      };

      (mockInteraction.options!.getChannel as jest.Mock).mockReturnValue(mockChannel);
      (mockInteraction.options!.getRole as jest.Mock).mockReturnValue(mockRole);
      (mockInteraction.options!.getNumber as jest.Mock).mockReturnValue(null);
      (ServerConfigManager.getServerConfig as jest.Mock).mockReturnValue(null);

      await bountyBattlesCommand.execute(mockInteraction as ChatInputCommandInteraction, mockDiscordService);

      expect(ServerConfigManager.updateBountyBattlesConfig).toHaveBeenCalledWith('test-guild-id', {
        channelId: 'channel-123',
        roleIds: ['role-456'],
        enabled: true,
        bountyThreshold: 0,
      });
      expect(mockReply).toHaveBeenCalledWith({
        content: expect.stringContaining('configured'),
        ephemeral: true,
      });
    });

    it('should configure server with channel only (no role)', async () => {
      const mockChannel = {
        id: 'channel-789',
        type: ChannelType.GuildText,
      };

      (mockInteraction.options!.getChannel as jest.Mock).mockReturnValue(mockChannel);
      (mockInteraction.options!.getRole as jest.Mock).mockReturnValue(null);
      (mockInteraction.options!.getNumber as jest.Mock).mockReturnValue(null);
      (ServerConfigManager.getServerConfig as jest.Mock).mockReturnValue(null);

      await bountyBattlesCommand.execute(mockInteraction as ChatInputCommandInteraction, mockDiscordService);

      expect(ServerConfigManager.updateBountyBattlesConfig).toHaveBeenCalledWith('test-guild-id', {
        channelId: 'channel-789',
        roleIds: [],
        enabled: true,
        bountyThreshold: 0,
      });
    });

    it('should preserve existing roleIds when no role provided', async () => {
      const mockChannel = {
        id: 'channel-new',
        type: ChannelType.GuildText,
      };
      const existingConfig = {
        bountyBattles: {
          channelId: 'old-channel',
          roleIds: ['existing-role-1', 'existing-role-2'],
          enabled: true,
          bountyThreshold: 10,
        },
      };

      (mockInteraction.options!.getChannel as jest.Mock).mockReturnValue(mockChannel);
      (mockInteraction.options!.getRole as jest.Mock).mockReturnValue(null);
      (mockInteraction.options!.getNumber as jest.Mock).mockReturnValue(null);
      (ServerConfigManager.getServerConfig as jest.Mock).mockReturnValue(existingConfig);

      await bountyBattlesCommand.execute(mockInteraction as ChatInputCommandInteraction, mockDiscordService);

      expect(ServerConfigManager.updateBountyBattlesConfig).toHaveBeenCalledWith('test-guild-id', {
        channelId: 'channel-new',
        roleIds: ['existing-role-1', 'existing-role-2'],
        enabled: true,
        bountyThreshold: 10,
      });
    });

    it('should preserve enabled status when updating configuration', async () => {
      const mockChannel = {
        id: 'channel-123',
        type: ChannelType.GuildText,
      };
      const mockRole = {
        id: 'role-456',
        name: 'Fighters',
      };
      const existingConfig = {
        bountyBattles: {
          channelId: 'old-channel',
          roleIds: ['old-role'],
          enabled: false,
          bountyThreshold: 5,
        },
      };

      (mockInteraction.options!.getChannel as jest.Mock).mockReturnValue(mockChannel);
      (mockInteraction.options!.getRole as jest.Mock).mockReturnValue(mockRole);
      (mockInteraction.options!.getNumber as jest.Mock).mockReturnValue(null);
      (ServerConfigManager.getServerConfig as jest.Mock).mockReturnValue(existingConfig);

      await bountyBattlesCommand.execute(mockInteraction as ChatInputCommandInteraction, mockDiscordService);

      expect(ServerConfigManager.updateBountyBattlesConfig).toHaveBeenCalledWith('test-guild-id', {
        channelId: 'channel-123',
        roleIds: ['role-456'],
        enabled: false, // Should preserve disabled status
        bountyThreshold: 5, // Should preserve existing threshold
      });
    });

    it('should reject non-text channels', async () => {
      const mockChannel = {
        id: 'voice-channel',
        type: ChannelType.GuildVoice,
      };

      (mockInteraction.options!.getChannel as jest.Mock).mockReturnValue(mockChannel);

      await bountyBattlesCommand.execute(mockInteraction as ChatInputCommandInteraction);

      expect(ServerConfigManager.updateBountyBattlesConfig).not.toHaveBeenCalled();
      expect(mockReply).toHaveBeenCalledWith({
        content: expect.stringContaining('text channel'),
        ephemeral: true,
      });
    });

    it('should reject if not in a guild', async () => {
      mockInteraction.guildId = null;

      await bountyBattlesCommand.execute(mockInteraction as ChatInputCommandInteraction);

      expect(ServerConfigManager.updateBountyBattlesConfig).not.toHaveBeenCalled();
      expect(mockReply).toHaveBeenCalledWith({
        content: expect.stringContaining('server'),
        ephemeral: true,
      });
    });

    it('should update in-memory cache after updating', async () => {
      const mockChannel = {
        id: 'channel-123',
        type: ChannelType.GuildText,
      };

      (mockInteraction.options!.getChannel as jest.Mock).mockReturnValue(mockChannel);
      (mockInteraction.options!.getRole as jest.Mock).mockReturnValue(null);
      (mockInteraction.options!.getNumber as jest.Mock).mockReturnValue(null);
      (ServerConfigManager.getServerConfig as jest.Mock).mockReturnValue(null);

      await bountyBattlesCommand.execute(mockInteraction as ChatInputCommandInteraction, mockDiscordService);

      // Should update ServerConfigManager (which updates in-memory cache)
      expect(ServerConfigManager.updateBountyBattlesConfig).toHaveBeenCalled();
    });

    it('should clear message tracking when channel changes', async () => {
      const mockChannel = {
        id: 'new-channel-456',
        type: ChannelType.GuildText,
      };
      const existingConfig = {
        bountyBattles: {
          channelId: 'old-channel-123',
          roleIds: ['role-1'],
          enabled: true,
          bountyThreshold: 0,
        },
      };

      (mockInteraction.options!.getChannel as jest.Mock).mockReturnValue(mockChannel);
      (mockInteraction.options!.getRole as jest.Mock).mockReturnValue(null);
      (mockInteraction.options!.getNumber as jest.Mock).mockReturnValue(null);
      (ServerConfigManager.getServerConfig as jest.Mock).mockReturnValue(existingConfig);

      await bountyBattlesCommand.execute(mockInteraction as ChatInputCommandInteraction, mockDiscordService);

      // Should clear message tracking when channel changes
      expect(mockDiscordService.clearServerTracking).toHaveBeenCalledWith('test-guild-id');
    });

    it('should not clear message tracking when channel stays the same', async () => {
      const mockChannel = {
        id: 'same-channel-123',
        type: ChannelType.GuildText,
      };
      const existingConfig = {
        bountyBattles: {
          channelId: 'same-channel-123',
          roleIds: ['role-1'],
          enabled: true,
          bountyThreshold: 0,
        },
      };

      (mockInteraction.options!.getChannel as jest.Mock).mockReturnValue(mockChannel);
      (mockInteraction.options!.getRole as jest.Mock).mockReturnValue(null);
      (ServerConfigManager.getServerConfig as jest.Mock).mockReturnValue(existingConfig);

      await bountyBattlesCommand.execute(mockInteraction as ChatInputCommandInteraction, mockDiscordService);

      // Should NOT clear message tracking when channel stays the same
      expect(mockDiscordService.clearServerTracking).not.toHaveBeenCalled();
    });
  });

  describe('/bountybattles config view', () => {
    beforeEach(() => {
      (mockInteraction.options!.getSubcommandGroup as jest.Mock).mockReturnValue('config');
      (mockInteraction.options!.getSubcommand as jest.Mock).mockReturnValue('view');
    });

    it('should display configuration when it exists', async () => {
      const mockConfig = {
        bountyBattles: {
          channelId: 'channel-123',
          roleIds: ['role-1', 'role-2'],
          enabled: true,
          bountyThreshold: 0,
        },
      };

      (ServerConfigManager.getServerConfig as jest.Mock).mockReturnValue(mockConfig);

      await bountyBattlesCommand.execute(mockInteraction as ChatInputCommandInteraction);

      expect(mockReply).toHaveBeenCalledWith({
        content: expect.stringMatching(/Bounty Battles Configuration/),
        ephemeral: true,
      });
      const callContent = mockReply.mock.calls[0][0].content;
      expect(callContent).toContain('Enabled');
      expect(callContent).toContain('channel-123');
    });

    it('should show enabled status correctly', async () => {
      const mockConfig = {
        bountyBattles: {
          channelId: 'channel-123',
          roleIds: [],
          enabled: true,
          bountyThreshold: 0,
        },
      };

      (ServerConfigManager.getServerConfig as jest.Mock).mockReturnValue(mockConfig);

      await bountyBattlesCommand.execute(mockInteraction as ChatInputCommandInteraction);

      const callContent = mockReply.mock.calls[0][0].content;
      expect(callContent).toContain('Configuration');
      expect(callContent).toContain('Enabled');
    });

    it('should show disabled status correctly', async () => {
      const mockConfig = {
        bountyBattles: {
          channelId: 'channel-123',
          roleIds: [],
          enabled: false,
          bountyThreshold: 0,
        },
      };

      (ServerConfigManager.getServerConfig as jest.Mock).mockReturnValue(mockConfig);

      await bountyBattlesCommand.execute(mockInteraction as ChatInputCommandInteraction);

      const callContent = mockReply.mock.calls[0][0].content;
      expect(callContent).toContain('Configuration');
      expect(callContent).toContain('Disabled');
    });

    it('should default to enabled when status is not set', async () => {
      const mockConfig = {
        bountyBattles: {
          channelId: 'channel-123',
          roleIds: [],
          bountyThreshold: 0,
        },
      };

      (ServerConfigManager.getServerConfig as jest.Mock).mockReturnValue(mockConfig);

      await bountyBattlesCommand.execute(mockInteraction as ChatInputCommandInteraction);

      const callContent = mockReply.mock.calls[0][0].content;
      expect(callContent).toContain('Enabled');
    });

    it('should prompt to configure when no config exists', async () => {
      (ServerConfigManager.getServerConfig as jest.Mock).mockReturnValue(null);

      await bountyBattlesCommand.execute(mockInteraction as ChatInputCommandInteraction);

      expect(mockReply).toHaveBeenCalledWith({
        content: expect.stringContaining('No bounty battles configuration'),
        ephemeral: true,
      });
    });

    it('should reject if not in a guild', async () => {
      mockInteraction.guildId = null;

      await bountyBattlesCommand.execute(mockInteraction as ChatInputCommandInteraction);

      expect(mockReply).toHaveBeenCalledWith({
        content: expect.stringContaining('server'),
        ephemeral: true,
      });
    });
  });

  describe('/bountybattles enable', () => {
    beforeEach(() => {
      (mockInteraction.options!.getSubcommandGroup as jest.Mock).mockReturnValue(null);
      (mockInteraction.options!.getSubcommand as jest.Mock).mockReturnValue('enable');
    });

    it('should enable notifications for configured server', async () => {
      const mockConfig = {
        bountyBattles: {
          channelId: 'channel-123',
          roleIds: ['role-1'],
          enabled: false,
          bountyThreshold: 0,
        },
      };

      (ServerConfigManager.getServerConfig as jest.Mock).mockReturnValue(mockConfig);

      await bountyBattlesCommand.execute(mockInteraction as ChatInputCommandInteraction);

      expect(ServerConfigManager.updateBountyBattlesConfig).toHaveBeenCalledWith('test-guild-id', {
        enabled: true,
      });
      expect(mockReply).toHaveBeenCalledWith({
        content: expect.stringContaining('enabled'),
        ephemeral: true,
      });
    });

    it('should prompt to configure when no config exists', async () => {
      (ServerConfigManager.getServerConfig as jest.Mock).mockReturnValue(null);

      await bountyBattlesCommand.execute(mockInteraction as ChatInputCommandInteraction);

      expect(ServerConfigManager.updateBountyBattlesConfig).not.toHaveBeenCalled();
      expect(mockReply).toHaveBeenCalledWith({
        content: expect.stringContaining('No bounty battles configuration'),
        ephemeral: true,
      });
    });

    it('should update in-memory cache after enabling', async () => {
      const mockConfig = {
        bountyBattles: {
          channelId: 'channel-123',
          roleIds: [],
          enabled: false,
          bountyThreshold: 0,
        },
      };

      (ServerConfigManager.getServerConfig as jest.Mock).mockReturnValue(mockConfig);

      await bountyBattlesCommand.execute(mockInteraction as ChatInputCommandInteraction);

      // Should update ServerConfigManager (which updates in-memory cache)
      expect(ServerConfigManager.updateBountyBattlesConfig).toHaveBeenCalledWith(
        'test-guild-id',
        { enabled: true }
      );
    });

    it('should reject if not in a guild', async () => {
      mockInteraction.guildId = null;

      await bountyBattlesCommand.execute(mockInteraction as ChatInputCommandInteraction);

      expect(mockReply).toHaveBeenCalledWith({
        content: expect.stringContaining('server'),
        ephemeral: true,
      });
    });
  });

  describe('/bountybattles disable', () => {
    beforeEach(() => {
      (mockInteraction.options!.getSubcommandGroup as jest.Mock).mockReturnValue(null);
      (mockInteraction.options!.getSubcommand as jest.Mock).mockReturnValue('disable');
    });

    it('should disable notifications for configured server', async () => {
      const mockConfig = {
        bountyBattles: {
          channelId: 'channel-123',
          roleIds: ['role-1'],
          enabled: true,
          bountyThreshold: 0,
        },
      };

      (ServerConfigManager.getServerConfig as jest.Mock).mockReturnValue(mockConfig);

      await bountyBattlesCommand.execute(mockInteraction as ChatInputCommandInteraction);

      expect(ServerConfigManager.updateBountyBattlesConfig).toHaveBeenCalledWith('test-guild-id', {
        enabled: false,
      });
      expect(mockReply).toHaveBeenCalledWith({
        content: expect.stringContaining('disabled'),
        ephemeral: true,
      });
    });

    it('should prompt to configure when no config exists', async () => {
      (ServerConfigManager.getServerConfig as jest.Mock).mockReturnValue(null);

      await bountyBattlesCommand.execute(mockInteraction as ChatInputCommandInteraction);

      expect(ServerConfigManager.updateBountyBattlesConfig).not.toHaveBeenCalled();
      expect(mockReply).toHaveBeenCalledWith({
        content: expect.stringContaining('No bounty battles configuration'),
        ephemeral: true,
      });
    });

    it('should update in-memory cache after disabling', async () => {
      const mockConfig = {
        bountyBattles: {
          channelId: 'channel-123',
          roleIds: [],
          enabled: true,
          bountyThreshold: 0,
        },
      };

      (ServerConfigManager.getServerConfig as jest.Mock).mockReturnValue(mockConfig);

      await bountyBattlesCommand.execute(mockInteraction as ChatInputCommandInteraction);

      // Should update ServerConfigManager (which updates in-memory cache)
      expect(ServerConfigManager.updateBountyBattlesConfig).toHaveBeenCalledWith(
        'test-guild-id',
        { enabled: false }
      );
    });

    it('should reject if not in a guild', async () => {
      mockInteraction.guildId = null;

      await bountyBattlesCommand.execute(mockInteraction as ChatInputCommandInteraction);

      expect(mockReply).toHaveBeenCalledWith({
        content: expect.stringContaining('server'),
        ephemeral: true,
      });
    });
  });

  describe('error handling', () => {
    it('should handle errors gracefully in config set', async () => {
      (mockInteraction.options!.getSubcommandGroup as jest.Mock).mockReturnValue('config');
      (mockInteraction.options!.getSubcommand as jest.Mock).mockReturnValue('set');
      (mockInteraction.options!.getChannel as jest.Mock).mockImplementation(() => {
        throw new Error('Test error');
      });

      await bountyBattlesCommand.execute(mockInteraction as ChatInputCommandInteraction);

      expect(mockReply).toHaveBeenCalledWith({
        content: expect.stringContaining('error occurred'),
        ephemeral: true,
      });
    });

    it('should handle errors gracefully in config view', async () => {
      (mockInteraction.options!.getSubcommandGroup as jest.Mock).mockReturnValue('config');
      (mockInteraction.options!.getSubcommand as jest.Mock).mockReturnValue('view');
      (ServerConfigManager.getServerConfig as jest.Mock).mockImplementation(() => {
        throw new Error('Test error');
      });

      await bountyBattlesCommand.execute(mockInteraction as ChatInputCommandInteraction);

      expect(mockReply).toHaveBeenCalledWith({
        content: expect.stringContaining('error occurred'),
        ephemeral: true,
      });
    });

    it('should handle errors gracefully in enable', async () => {
      (mockInteraction.options!.getSubcommandGroup as jest.Mock).mockReturnValue(null);
      (mockInteraction.options!.getSubcommand as jest.Mock).mockReturnValue('enable');
      (ServerConfigManager.getServerConfig as jest.Mock).mockImplementation(() => {
        throw new Error('Test error');
      });

      await bountyBattlesCommand.execute(mockInteraction as ChatInputCommandInteraction);

      expect(mockReply).toHaveBeenCalledWith({
        content: expect.stringContaining('error occurred'),
        ephemeral: true,
      });
    });

    it('should handle errors gracefully in disable', async () => {
      (mockInteraction.options!.getSubcommandGroup as jest.Mock).mockReturnValue(null);
      (mockInteraction.options!.getSubcommand as jest.Mock).mockReturnValue('disable');
      (ServerConfigManager.getServerConfig as jest.Mock).mockImplementation(() => {
        throw new Error('Test error');
      });

      await bountyBattlesCommand.execute(mockInteraction as ChatInputCommandInteraction);

      expect(mockReply).toHaveBeenCalledWith({
        content: expect.stringContaining('error occurred'),
        ephemeral: true,
      });
    });
  });
});
