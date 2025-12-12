import { DiscordService } from '../../../src/services/discord/DiscordService';
import { MessageTracker } from '../../../src/services/discord/MessageTracker';
import { Client, TextChannel, Message } from 'discord.js';

// Mock dependencies
jest.mock('discord.js');
jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));
jest.mock('../../../src/utils/serverConfigManager', () => ({
  ServerConfigManager: {
    getServerConfig: jest.fn(),
    readServerConfigs: jest.fn().mockReturnValue(new Map()),
  },
}));

describe('DiscordService', () => {
  let discordService: DiscordService;
  let mockClient: jest.Mocked<Client>;
  let mockMessageTracker: jest.Mocked<MessageTracker>;
  let mockChannel: jest.Mocked<TextChannel>;
  let mockMessage: jest.Mocked<Message>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockMessage = {
      id: 'message-123',
      edit: jest.fn().mockResolvedValue(undefined),
    } as any;

    mockChannel = {
      id: 'channel-123',
      name: 'bounty-battles',
      type: 0, // GuildText
      isTextBased: jest.fn().mockReturnValue(true),
      send: jest.fn().mockResolvedValue(mockMessage),
      messages: {
        fetch: jest.fn().mockResolvedValue(mockMessage),
      },
    } as any;

    mockClient = {
      channels: {
        fetch: jest.fn().mockResolvedValue(mockChannel),
      },
    } as any;

    mockMessageTracker = {
      getMessageId: jest.fn(),
      setMessageId: jest.fn(),
      removeBattle: jest.fn(),
      clearServer: jest.fn(),
      getTrackedBattles: jest.fn().mockReturnValue([]),
    } as any;

    discordService = new DiscordService(mockClient, mockMessageTracker);
  });

  describe('updateBattleMessage', () => {
    const serverId = 'server-123';
    const battleId = 'battle-456';
    const battleMessage = '```Battle details here```';
    const roleIds = ['role-1', 'role-2'];

    beforeEach(async () => {
      // Set up the channel in the service's internal map
      (discordService as any).channels.set(serverId, mockChannel);
    });

    it('should create new message with role mentions when no existing message', async () => {
      mockMessageTracker.getMessageId.mockReturnValue(undefined);

      await discordService.updateBattleMessage(serverId, roleIds, battleId, battleMessage);

      expect(mockChannel.send).toHaveBeenCalledWith(
        expect.stringContaining('<@&role-1>')
      );
      expect(mockChannel.send).toHaveBeenCalledWith(
        expect.stringContaining('<@&role-2>')
      );
      expect(mockChannel.send).toHaveBeenCalledWith(
        expect.stringContaining(battleMessage)
      );
    });

    it('should preserve role mentions when updating existing message', async () => {
      mockMessageTracker.getMessageId.mockReturnValue('existing-message-id');

      await discordService.updateBattleMessage(serverId, roleIds, battleId, battleMessage);

      expect(mockChannel.messages.fetch).toHaveBeenCalledWith('existing-message-id');
      expect(mockMessage.edit).toHaveBeenCalledWith(
        expect.stringContaining('<@&role-1>')
      );
      expect(mockMessage.edit).toHaveBeenCalledWith(
        expect.stringContaining('<@&role-2>')
      );
      expect(mockMessage.edit).toHaveBeenCalledWith(
        expect.stringContaining(battleMessage)
      );
    });

    it('should include all role mentions in correct format when updating', async () => {
      mockMessageTracker.getMessageId.mockReturnValue('existing-message-id');

      await discordService.updateBattleMessage(serverId, roleIds, battleId, battleMessage);

      const expectedContent = `<@&role-1> <@&role-2>\n\n${battleMessage}`;
      expect(mockMessage.edit).toHaveBeenCalledWith(expectedContent);
    });

    it('should update message without mentions when no roles configured', async () => {
      mockMessageTracker.getMessageId.mockReturnValue('existing-message-id');

      await discordService.updateBattleMessage(serverId, [], battleId, battleMessage);

      expect(mockMessage.edit).toHaveBeenCalledWith(battleMessage);
      expect(mockMessage.edit).not.toHaveBeenCalledWith(
        expect.stringContaining('<@&')
      );
    });

    it('should create new message if update fails (message deleted)', async () => {
      mockMessageTracker.getMessageId.mockReturnValue('existing-message-id');
      (mockChannel.messages.fetch as jest.Mock).mockRejectedValueOnce(new Error('Unknown Message'));

      await discordService.updateBattleMessage(serverId, roleIds, battleId, battleMessage);

      expect(mockChannel.send).toHaveBeenCalledWith(
        expect.stringContaining('<@&role-1>')
      );
      expect(mockChannel.send).toHaveBeenCalledWith(
        expect.stringContaining(battleMessage)
      );
    });
  });

  describe('clearServerTracking', () => {
    it('should call messageTracker.clearServer', () => {
      const serverId = 'server-123';
      
      discordService.clearServerTracking(serverId);

      expect(mockMessageTracker.clearServer).toHaveBeenCalledWith(serverId);
    });
  });
});
