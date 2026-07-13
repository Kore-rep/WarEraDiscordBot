import { CommandHandler } from '../../src/commands/CommandHandler';
import { Events } from 'discord.js';
import { bountyBattlesCommand } from '../../src/commands/bountyBattles/bountyBattles';
import { DiscordService } from '../../src/services/discord/DiscordService';
import { ApiService } from '../../src/services/api/ApiService';

// Mock discord.js
jest.mock('discord.js', () => {
  const mockREST = jest.fn().mockImplementation(() => ({
    setToken: jest.fn().mockReturnThis(),
    put: jest.fn().mockResolvedValue(undefined),
  }));

  const mockSlashCommandBuilder = jest.fn().mockImplementation(() => ({
    setName: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    setDefaultMemberPermissions: jest.fn().mockReturnThis(),
    setDMPermission: jest.fn().mockReturnThis(),
    setContexts: jest.fn().mockReturnThis(),
    addSubcommandGroup: jest.fn().mockReturnThis(),
    addSubcommand: jest.fn().mockReturnThis(),
    addStringOption: jest.fn().mockReturnThis(),
    toJSON: jest.fn().mockReturnValue({}),
  }));

  return {
    Client: jest.fn(),
    Events: {
      InteractionCreate: 'interactionCreate',
      ClientReady: 'ready',
    },
    REST: mockREST,
    Routes: {
      applicationCommands: jest.fn((clientId) => `/applications/${clientId}/commands`),
    },
    SlashCommandBuilder: mockSlashCommandBuilder,
    ChannelType: {
      GuildText: 0,
    },
    InteractionContextType: {
      Guild: 0,
      BotDM: 1,
      PrivateChannel: 2,
    },
  };
});

// Mock DiscordService
jest.mock('../../src/services/discord/DiscordService');

// Mock ApiService
jest.mock('../../src/services/api/ApiService');

// Mock the commands
jest.mock('../../src/commands/bountyBattles/bountyBattles', () => ({
  bountyBattlesCommand: {
    data: {
      name: 'bountybattles',
      description: 'Manage bounty battles',
      toJSON: jest.fn().mockReturnValue({
        name: 'bountybattles',
        description: 'Manage bounty battles',
      }),
    },
    execute: jest.fn(),
  },
}));

jest.mock('../../src/commands/userTracking/userTracking', () => ({
  userTrackingCommand: {
    data: {
      name: 'user',
      description: 'Manage user tracking',
      toJSON: jest.fn().mockReturnValue({
        name: 'user',
        description: 'Manage user tracking',
      }),
    },
    execute: jest.fn(),
  },
}));

jest.mock('../../src/commands/scanFor/scanFor', () => ({
  scanForCommand: {
    data: {
      name: 'scanfor',
      description: 'Scan large groups of objects and return results',
      toJSON: jest.fn().mockReturnValue({
        name: 'scanfor',
        description: 'Scan large groups of objects and return results',
      }),
    },
    execute: jest.fn(),
  },
}));

jest.mock('../../src/commands/countryGroup/countryGroup', () => ({
  countryGroupCommand: {
    data: {
      name: 'countrygroup',
      description: 'Manage country groups for filtered scans',
      toJSON: jest.fn().mockReturnValue({
        name: 'countrygroup',
        description: 'Manage country groups for filtered scans',
      }),
    },
    execute: jest.fn(),
  },
  handleCountryGroupModal: jest.fn(),
}));

jest.mock('../../src/commands/spectre/spectre', () => ({
  spectreCommand: {
    data: {
      name: 'spectre',
      description: 'Military monitoring',
      toJSON: jest.fn().mockReturnValue({
        name: 'spectre',
        description: 'Military monitoring',
      }),
    },
    execute: jest.fn(),
  },
}));

jest.mock('../../src/commands/contracts/contracts', () => ({
  contractsCommand: {
    data: { name: 'contracts', description: 'Manage mercenary contracts', toJSON: jest.fn().mockReturnValue({ name: 'contracts' }) },
    execute: jest.fn(),
  },
}));

jest.mock('../../src/commands/proxyTracking/proxyTracking', () => ({
  proxyTrackingCommand: {
    data: { name: 'proxytracking', description: 'Manage proxy tracking', toJSON: jest.fn().mockReturnValue({ name: 'proxytracking' }) },
    execute: jest.fn(),
  },
}));

jest.mock('../../src/commands/leaderboard/leaderboard', () => ({
  leaderboardCommand: {
    data: { name: 'leaderboard', description: 'Manage leaderboards', toJSON: jest.fn().mockReturnValue({ name: 'leaderboard' }) },
    execute: jest.fn(),
  },
}));

jest.mock('../../src/commands/muDirectory', () => ({
  muDirectoryCommand: {
    data: { name: 'mudirectory', description: 'Maintain an MU directory', toJSON: jest.fn().mockReturnValue({ name: 'mudirectory' }) },
    execute: jest.fn(),
  },
}));

jest.mock('../../src/commands/link', () => ({
  linkCommand: {
    data: { name: 'link', description: 'Link your WarEra account', toJSON: jest.fn().mockReturnValue({ name: 'link' }) },
    execute: jest.fn(),
  },
}));

jest.mock('../../src/commands/autorole', () => ({
  autoroleCommand: {
    data: { name: 'autorole', description: 'Configure account linking and role sync', toJSON: jest.fn().mockReturnValue({ name: 'autorole' }) },
    execute: jest.fn(),
  },
}));

jest.mock('../../src/commands/help', () => ({
  helpCommand: {
    data: { name: 'help', description: 'List every command', toJSON: jest.fn().mockReturnValue({ name: 'help' }) },
    execute: jest.fn(),
  },
}));

// Mock logger
jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('CommandHandler', () => {
  let mockClient: any;
  let mockDiscordService: jest.Mocked<DiscordService>;
  let mockApiService: jest.Mocked<ApiService>;
  let commandHandler: CommandHandler;
  const mockToken = 'test-token';

  beforeEach(() => {
    jest.clearAllMocks();

    mockClient = {
      user: { id: 'test-client-id' },
      on: jest.fn(),
    };

    mockDiscordService = {} as any;

    mockApiService = {
      getClient: jest.fn(),
      getBatchClient: jest.fn(),
    } as any;

    commandHandler = new CommandHandler(mockClient, mockToken, mockDiscordService, mockApiService);
  });

  describe('initialization', () => {
    it('should load commands on initialization', () => {
      expect(commandHandler.getCommandCount()).toBeGreaterThan(0);
    });

    it('should load all twelve top-level commands', () => {
      expect(commandHandler.getCommandCount()).toBe(12);
    });
  });

  describe('registerCommands', () => {
    it('should register commands with Discord', async () => {
      const { REST } = require('discord.js');
      
      await commandHandler.registerCommands();

      expect(REST).toHaveBeenCalled();
      const restInstance = REST.mock.results[0].value;
      expect(restInstance.setToken).toHaveBeenCalledWith(mockToken);
      expect(restInstance.put).toHaveBeenCalled();
    });

    it('should convert command data to JSON before registering', async () => {
      await commandHandler.registerCommands();

      expect(bountyBattlesCommand.data.toJSON).toHaveBeenCalled();
    });

    it('should throw error if registration fails', async () => {
      const { REST } = require('discord.js');
      const mockPutError = new Error('Registration failed');
      
      REST.mockImplementationOnce(() => ({
        setToken: jest.fn().mockReturnThis(),
        put: jest.fn().mockRejectedValue(mockPutError),
      }));

      const newHandler = new CommandHandler(mockClient, mockToken, mockDiscordService, mockApiService);

      await expect(newHandler.registerCommands()).rejects.toThrow('Registration failed');
    });
  });

  describe('setupInteractionHandler', () => {
    it('should set up interaction event listener', () => {
      commandHandler.setupInteractionHandler();

      expect(mockClient.on).toHaveBeenCalledWith(
        Events.InteractionCreate,
        expect.any(Function)
      );
    });

    it('should handle chat input command interactions', async () => {
      commandHandler.setupInteractionHandler();

      const interactionHandler = mockClient.on.mock.calls[0][1];
      const mockInteraction = {
        isChatInputCommand: jest.fn().mockReturnValue(true),
        commandName: 'bountybattles',
        user: { tag: 'TestUser#1234' },
        guildId: 'test-guild',
        reply: jest.fn(),
      };

      await interactionHandler(mockInteraction);

      expect(bountyBattlesCommand.execute).toHaveBeenCalledWith(mockInteraction, mockDiscordService, mockApiService);
    });

    it('should ignore non-chat-input interactions', async () => {
      commandHandler.setupInteractionHandler();

      const interactionHandler = mockClient.on.mock.calls[0][1];
      const mockInteraction = {
        isChatInputCommand: jest.fn().mockReturnValue(false),
        isModalSubmit: jest.fn().mockReturnValue(false),
        isButton: jest.fn().mockReturnValue(false),
      };

      await interactionHandler(mockInteraction);

      expect(bountyBattlesCommand.execute).not.toHaveBeenCalled();
    });

    it('should handle unknown commands', async () => {
      commandHandler.setupInteractionHandler();

      const interactionHandler = mockClient.on.mock.calls[0][1];
      const mockInteraction = {
        isChatInputCommand: jest.fn().mockReturnValue(true),
        commandName: 'unknowncommand',
        user: { tag: 'TestUser#1234' },
        guildId: 'test-guild',
        reply: jest.fn(),
      };

      await interactionHandler(mockInteraction);

      expect(mockInteraction.reply).toHaveBeenCalledWith({
        content: 'Unknown command.',
        ephemeral: true,
      });
    });

    it('should handle command execution errors', async () => {
      commandHandler.setupInteractionHandler();

      const interactionHandler = mockClient.on.mock.calls[0][1];
      const mockInteraction = {
        isChatInputCommand: jest.fn().mockReturnValue(true),
        commandName: 'bountybattles',
        user: { tag: 'TestUser#1234' },
        guildId: 'test-guild',
        reply: jest.fn(),
        replied: false,
        deferred: false,
      };

      (bountyBattlesCommand.execute as jest.Mock).mockRejectedValueOnce(
        new Error('Execution failed')
      );

      await interactionHandler(mockInteraction);

      expect(mockInteraction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining('error'),
        ephemeral: true,
      });
    });

    it('should use followUp if interaction was deferred', async () => {
      commandHandler.setupInteractionHandler();

      const interactionHandler = mockClient.on.mock.calls[0][1];
      const mockInteraction = {
        isChatInputCommand: jest.fn().mockReturnValue(true),
        commandName: 'bountybattles',
        user: { tag: 'TestUser#1234' },
        guildId: 'test-guild',
        reply: jest.fn(),
        followUp: jest.fn(),
        replied: false,
        deferred: true,
      };

      (bountyBattlesCommand.execute as jest.Mock).mockRejectedValueOnce(
        new Error('Execution failed')
      );

      await interactionHandler(mockInteraction);

      expect(mockInteraction.followUp).toHaveBeenCalledWith({
        content: expect.stringContaining('error'),
        ephemeral: true,
      });
      expect(mockInteraction.reply).not.toHaveBeenCalled();
    });

    it('should not reply if interaction already replied', async () => {
      commandHandler.setupInteractionHandler();

      const interactionHandler = mockClient.on.mock.calls[0][1];
      const mockInteraction = {
        isChatInputCommand: jest.fn().mockReturnValue(true),
        commandName: 'bountybattles',
        user: { tag: 'TestUser#1234' },
        guildId: 'test-guild',
        reply: jest.fn(),
        followUp: jest.fn(),
        replied: true,
        deferred: false,
      };

      (bountyBattlesCommand.execute as jest.Mock).mockRejectedValueOnce(
        new Error('Execution failed')
      );

      await interactionHandler(mockInteraction);

      expect(mockInteraction.reply).not.toHaveBeenCalled();
      expect(mockInteraction.followUp).not.toHaveBeenCalled();
    });
  });

  describe('getCommandCount', () => {
    it('should return the correct number of loaded commands', () => {
      expect(commandHandler.getCommandCount()).toBe(12);
    });
  });
});
