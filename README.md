# WarEra Discord Bot

A TypeScript Discord bot that performs periodic API requests using the WarEra SDK and mentions roles in designated Discord channels when battle changes are detected. Supports multiple Discord servers with per-server configuration.

## Features

- ✅ Persistent Discord connection
- ✅ Periodic API polling with configurable intervals
- ✅ **Change detection** - Only sends notifications when:
  - New battles appear that haven't been seen before
  - Battle moneyPool is replenished (increases)
  - Battle moneyPer1kDamages value changes
- ✅ **Multi-server support** with per-server configuration
- ✅ Battle state tracking to detect changes
- ✅ Comprehensive error handling and logging
- ✅ Modular structure ready for slash commands
- ✅ Docker support for Azure deployment

## Prerequisites

- Node.js 18+ 
- npm or yarn
- Discord Bot Token (from [Discord Developer Portal](https://discord.com/developers/applications))
- Access to the WarEra SDK (located at `../WarEraSDK`)

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

This will install:
- `discord.js` - Discord API library
- `dotenv` - Environment variable management
- `warera-sdk` - Local SDK dependency
- TypeScript and development dependencies

### 2. Configure Environment Variables

Copy the example environment file:

```bash
copy .env.example .env
```

Edit `.env` and fill in your configuration:

```env
DISCORD_TOKEN=your_discord_bot_token_here
POLLING_INTERVAL_MINUTES=5
API_BASE_URL=https://api.example.com
```

**Getting Discord Credentials:**

1. **Bot Token and Intents:**
   - Go to [Discord Developer Portal](https://discord.com/developers/applications)
   - Create a new application or select an existing one
   - Go to "Bot" section
   - Click "Reset Token" or "Copy" to get your bot token
   - **Enable the following Privileged Gateway Intents:**
     - ✅ **MESSAGE CONTENT INTENT** (Required - allows bot to read message content)
     - The bot also uses SERVER MEMBERS INTENT and PRESENCE INTENT if needed
   - Scroll down to "Privileged Gateway Intents" and enable "Message Content Intent"
   - Invite the bot to your servers with appropriate permissions:
     - Send Messages
     - View Channels
     - Read Message History

2. **Server ID:**
   - Enable Developer Mode in Discord (User Settings → Advanced → Developer Mode)
   - Right-click on your server name/icon
   - Select "Copy ID"

3. **Channel ID:**
   - With Developer Mode enabled, right-click on the target channel
   - Select "Copy ID"

4. **Role IDs:**
   - With Developer Mode enabled, right-click on a role in the server
   - Select "Copy ID"
   - Or go to Server Settings → Roles → right-click on a role → Copy ID

### 3. Configure Server Settings

Copy the example servers configuration file:

```bash
copy servers.json.example servers.json
```

Edit `servers.json` and configure each Discord server:

```json
{
  "servers": {
    "YOUR_SERVER_ID_1": {
      "channelId": "YOUR_CHANNEL_ID_1",
      "roleIds": ["ROLE_ID_1", "ROLE_ID_2"]
    },
    "YOUR_SERVER_ID_2": {
      "channelId": "YOUR_CHANNEL_ID_2",
      "roleIds": ["ROLE_ID_3"]
    }
  }
}
```

**Configuration Notes:**
- Each server entry requires:
  - **Server ID**: The Discord server (guild) ID
  - **channelId**: The channel ID where the bot will send messages
  - **roleIds**: Array of role IDs to mention (can be empty `[]` if you want to extract from battle data)
- You can add as many servers as needed
- The bot will poll the API once and send messages to all configured servers that have relevant battles

### 4. Build the Project

```bash
npm run build
```

### 5. Run the Bot

**Development mode (with auto-reload):**
```bash
npm run dev
```

**Production mode:**
```bash
npm start
```

## Project Structure

```
├── src/
│   ├── index.ts              # Main entry point
│   ├── bot.ts                # Bot class with Discord connection and polling logic
│   ├── config.ts             # Configuration loading and validation
│   ├── services/
│   │   ├── apiService.ts     # API service using WarEra SDK
│   │   └── discordService.ts # Discord message handling
│   └── utils/
│       └── logger.ts         # Logging utility
├── dist/                     # Compiled JavaScript (generated)
├── .env.example             # Example environment variables
├── Dockerfile               # Docker configuration for Azure
├── package.json             # Dependencies and scripts
├── tsconfig.json            # TypeScript configuration
└── README.md                # This file
```

## Customizing API Calls

The bot includes a placeholder function in `src/services/apiService.ts` that you need to customize:

**`extractRoleIdsByServer()`** - Implement logic to extract role IDs per server from battles

Currently, it returns the configured role IDs for all servers when battles are found. You should customize it to map battles to specific servers based on your game logic (e.g., by country, region, etc.).

Example customization:

```typescript
extractRoleIdsByServer(battles: BattleDTO[]): Map<string, string[]> {
  const roleIdsByServer = new Map<string, string[]>();
  
  for (const [serverId, serverConfig] of this.config.discord.servers.entries()) {
    // Example: Filter battles relevant to this server
    const relevantBattles = battles.filter(battle => {
      // Example: Match by country ID or region
      return battle.attacker.country === serverConfig.countryId ||
             battle.defender.country === serverConfig.countryId;
    });
    
    if (relevantBattles.length > 0 && serverConfig.roleIds.length > 0) {
      roleIdsByServer.set(serverId, serverConfig.roleIds);
    }
  }
  
  return roleIdsByServer;
}
```

## Adding Slash Commands

The bot is structured to easily add slash commands. Here's a basic example:

1. Create `src/commands/ping.ts`:
```typescript
import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('ping')
  .setDescription('Replies with Pong!');

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.reply('Pong!');
}
```

2. Register commands in `src/bot.ts`:
```typescript
import { Collection } from 'discord.js';
import * as pingCommand from './commands/ping';

// In Bot class constructor or setup:
this.client.commands = new Collection();
this.client.commands.set(pingCommand.data.name, pingCommand);
```

## Deployment to Azure

### Option 1: Azure App Service

1. Build the Docker image:
   **Important:** Build from the parent directory (one level up from WarEraBot) to include the SDK:
   ```bash
   cd ..
   docker build -f WarEraBot/Dockerfile -t warera-discord-bot .
   ```
   Or from the WarEraBot directory:
   ```bash
   docker build -f Dockerfile -t warera-discord-bot ..
   ```

2. Push to Azure Container Registry or use Azure Container Instances

3. Configure environment variables in Azure Portal:
   - Go to your App Service → Configuration → Application Settings
   - Add all variables from `.env`
   - Upload `servers.json` file to your deployment (or configure via environment variables)

### Option 2: Azure Container Instances

1. Build and push image to Azure Container Registry
2. Create container instance with environment variables
3. Ensure the SDK is available (may need to include it in the image or use a different deployment strategy)

### Important Notes for Azure Deployment

- The SDK is installed as a local dependency (`file:../WarEraSDK`)
- You may need to:
  - Copy the SDK into the Docker image during build
  - Or publish the SDK to a private npm registry
  - Or include the SDK in the same repository

Update the Dockerfile if needed to include the SDK:

```dockerfile
# Copy SDK if it's in a sibling directory
COPY ../WarEraSDK ./sdk
RUN npm install ./sdk
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DISCORD_TOKEN` | Discord bot token | Yes |
| `POLLING_INTERVAL_MINUTES` | Minutes between API requests | Yes |
| `API_BASE_URL` | Base URL for API (optional) | No |

**Server Configuration (`servers.json`):**

| Field | Description | Required |
|-------|-------------|----------|
| `servers` | Object mapping server IDs to configurations | Yes |
| `servers[serverId].channelId` | Channel ID for this server | Yes |
| `servers[serverId].roleIds` | Array of role IDs to mention | Yes (can be empty) |

## Logging

The bot includes comprehensive logging:
- **DEBUG**: Detailed information for debugging (including battle change detection)
- **INFO**: General information about bot operations (including notifications sent)
- **WARN**: Warning messages for non-critical issues
- **ERROR**: Error messages with stack traces

Logs are output to the console with timestamps and log levels. The bot logs:
- When battles are fetched from the API
- When changes are detected (new battles, replenished moneyPool, changed moneyPer1kDamages)
- When notifications are sent to Discord servers
- Battle tracking statistics

## Error Handling

The bot includes error handling for:
- Discord connection issues (automatic reconnection)
- API request failures (logged, bot continues)
- Configuration errors (fails fast with clear messages)
- Uncaught exceptions (graceful shutdown)

## Troubleshooting

**Bot doesn't connect / "Used disallowed intents" error:**
- Verify `DISCORD_TOKEN` is correct
- **CRITICAL:** Enable "Message Content Intent" in Discord Developer Portal:
  - Go to https://discord.com/developers/applications
  - Select your application → "Bot" section
  - Scroll down to "Privileged Gateway Intents"
  - Enable **"MESSAGE CONTENT INTENT"** toggle
  - Click "Save Changes"
  - Restart your bot/container
- Ensure bot has been invited to your servers with appropriate permissions
- Check bot has permission to access the channels

**Channel not found:**
- Verify `channelId` in `servers.json` is correct for the specific server
- Ensure bot is in the server and has access to the channel
- Check that the server ID in `servers.json` matches the actual Discord server ID

**API calls fail:**
- Check `API_BASE_URL` if required
- Verify SDK is properly installed
- Check network connectivity

**SDK not found:**
- Ensure WarEraSDK is at `../WarEraSDK`
- Run `npm install` again
- Check `package.json` has correct path

## License

MIT

