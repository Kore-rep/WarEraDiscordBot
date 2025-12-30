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
- ✅ **User activity tracking** - Monitor specific users and get notified when inactive
- ✅ Battle state tracking to detect changes
- ✅ Comprehensive error handling and logging
- ✅ Slash commands for configuration and management
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

**Note:** Server configuration is now managed via Discord slash commands (`/bountybattles config set`) for a better user experience. However, you can still manually configure the `config/serverConfig.json` file if needed.

**Option A: Using Slash Commands (Recommended)**

After starting the bot, use the `/bountybattles config set` command in your Discord server:

```
/bountybattles config set channel:#battles role:@Fighters threshold:10.0
```

**Option B: Manual Configuration**

Create `config/serverConfig.json` based on the example:

```bash
mkdir config
copy serverConfig.json.example config\serverConfig.json
```

Edit `config/serverConfig.json`:

```json
{
  "servers": {
    "YOUR_SERVER_ID": {
      "bountyBattles": {
        "channelId": "YOUR_CHANNEL_ID",
        "roleIds": ["ROLE_ID_1"],
        "enabled": true,
        "bountyThreshold": 10.0
      },
      "reports": {
        "channelId": "REPORTS_CHANNEL_ID",
        "enabled": false,
        "schedule": "0 9 */2 * *"
      }
    }
  }
}
```

**Configuration Structure:**
- `bountyBattles` - Settings for bounty battle notifications
  - `channelId` - Channel for battle notifications
  - `roleIds` - Roles to mention (empty array = no mentions)
  - `enabled` - Enable/disable notifications (default: true)
  - `bountyThreshold` - Min total bounty to trigger role mentions (default: 0)
- `reports` - Settings for periodic reports (future feature)
  - `channelId` - Channel for reports
  - `enabled` - Enable/disable reports
  - `schedule` - Cron schedule for reports
- `userTracking` - Settings for user inactivity tracking
  - `enabled` - Enable/disable user tracking (default: true)
  - `users` - Array of tracked users:
    - `userId` - War Era user ID to track
    - `channelId` - Channel for inactivity notifications
    - `inactivityDays` - Days of inactivity before notification (default: 2)

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
│   ├── index.ts                          # Application entry point
│   ├── bot/
│   │   └── Bot.ts                        # Main bot orchestrator
│   ├── config/
│   │   └── config.ts                     # Configuration loading and validation
│   ├── services/
│   │   ├── api/
│   │   │   └── ApiService.ts             # WarEra API interactions
│   │   ├── battle/
│   │   │   ├── BattleService.ts          # Battle processing orchestration
│   │   │   ├── BattleTracker.ts          # State tracking & change detection
│   │   │   └── BattleFormatter.ts        # Message formatting
│   │   ├── discord/
│   │   │   ├── DiscordService.ts         # Discord API interactions
│   │   │   └── MessageTracker.ts         # Message ID tracking
│   │   ├── polling/
│   │   │   └── PollingService.ts         # Periodic polling scheduler
│   │   └── userTracking/
│   │       └── UserTrackingService.ts    # User inactivity tracking
│   └── utils/
│       └── logger.ts                     # Winston logger configuration
├── tests/                                # Test suite (not in Docker)
│   ├── config/                           # Configuration tests
│   ├── services/                         # Service unit tests
│   └── integration/                      # Integration tests
├── dist/                                 # Compiled JavaScript (generated)
├── coverage/                             # Test coverage reports (generated)
├── .env.example                          # Example environment variables
├── serverConfig.json.example             # Example server configuration
├── config/
│   └── serverConfig.json                 # Active server configuration (gitignored)
├── Dockerfile                            # Docker configuration for Azure
├── jest.config.js                        # Jest test configuration
├── ARCHITECTURE.md                       # Detailed architecture documentation
├── package.json                          # Dependencies and scripts
├── tsconfig.json                         # TypeScript configuration
└── README.md                             # This file
```

## Testing

The project includes a comprehensive test suite with 43 tests covering all critical functionality.

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

### Test Coverage

- ✅ **BattleTracker**: Change detection, state management, cleanup
- ✅ **BattleFormatter**: Message formatting, character limits, truncation
- ✅ **MessageTracker**: Message ID storage and retrieval
- ✅ **Config**: Configuration loading and validation
- ✅ **BattleService**: Integration tests for battle processing

**Note:** Tests are automatically excluded from Docker builds.

## Customizing API Calls

The bot includes a placeholder function in `src/services/api/ApiService.ts` that you can customize:

**`extractRoleIdsByServer()`** - Implement logic to extract role IDs per server from battles

Currently, it returns the configured role IDs for all servers when battles are found. You can customize it to map battles to specific servers based on your game logic (e.g., by country, region, etc.).

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
    
    if (relevantBattles.length > 0) {
      roleIdsByServer.set(serverId, serverConfig.roleIds || []);
    }
  }
  
  return roleIdsByServer;
}
```

## Available Slash Commands

### Bounty Battle Commands

- `/bountybattles config set` - Configure bounty battle notifications
  - `channel` - Channel for battle notifications
  - `role` - Role to mention (optional)
  - `threshold` - Minimum bounty to trigger role mentions (optional)

- `/bountybattles config view` - View current bounty battle configuration

- `/bountybattles enable` - Enable bounty battle notifications

- `/bountybattles disable` - Disable bounty battle notifications

### User Tracking Commands

- `/user tracking add` - Start tracking a user for inactivity
  - `userid` - War Era user ID to track (required)
  - `channel` - Channel for inactivity notifications (required)
  - `inactivitydays` - Days of inactivity before notification (optional, default: 2)

- `/user tracking remove` - Stop tracking a user
  - `userid` - War Era user ID to stop tracking

- `/user tracking list` - List all tracked users and their status

**Example:**
```
/user tracking add userid:12345 channel:#admin-alerts inactivitydays:3
```

This will track user ID 12345 and send a notification to #admin-alerts if they haven't been active for 3 days.

## Available Slash Commands

### Bounty Battles Commands

- `/bountybattles config set` - Configure bounty battle notifications
  - `channel`: Channel for battle notifications
  - `role`: Role to mention (optional)
  - `threshold`: Minimum bounty to trigger mentions (optional)
- `/bountybattles config view` - View current bounty battles configuration
- `/bountybattles enable` - Enable bounty battle notifications
- `/bountybattles disable` - Disable bounty battle notifications

### User Tracking Commands

- `/user tracking add` - Start tracking a user for inactivity
  - `userid`: War Era user ID to track (required)
  - `channel`: Channel for inactivity notifications (required)
  - `mentions`: Users/roles to mention in notifications (optional, space-separated)
  - `inactivitydays`: Days of inactivity before notification (optional, default: 2)
  - **Immediately fetches and reports the user's current status**
- `/user tracking remove` - Stop tracking a user
  - `userid`: War Era user ID **or username** to stop tracking (required)
- `/user tracking list` - List all tracked users with their current status
  - Shows username, last activity, and whether they're currently inactive

**Example usage:**
```
# Track a user with mentions
/user tracking add userid:123456 channel:#alerts mentions:@Admin @Moderators inactivitydays:3

# Track without mentions
/user tracking add userid:789012 channel:#alerts inactivitydays:2

# View all tracked users
/user tracking list

# Remove by user ID or username
/user tracking remove userid:123456
/user tracking remove userid:PlayerName
```

**Features:**
- ✅ Immediate status check when adding a user
- ✅ Mentions specific users/roles when sending notifications
- ✅ Stores username for easy reference
- ✅ Shows active/inactive status in list view
- ✅ Hourly automated checks
- ✅ Smart notification system - only notifies once per inactivity period
- ✅ Automatically resets when user returns online
- ✅ Smart notification system - only notifies once per inactivity period
- ✅ Automatically resets when user returns online

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
   - Upload `config/serverConfig.json` file to your deployment (or use slash commands to configure)

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

**Server Configuration (`config/serverConfig.json`):**

| Field | Description | Required |
|-------|-------------|----------|
| `servers` | Object mapping server IDs to configurations | Yes |
| `servers[serverId].bountyBattles` | Bounty battle notification settings | No |
| `servers[serverId].bountyBattles.channelId` | Channel ID for notifications | Yes (if bountyBattles configured) |
| `servers[serverId].bountyBattles.roleIds` | Array of role IDs to mention | Yes (can be empty) |
| `servers[serverId].bountyBattles.enabled` | Enable/disable notifications | No (default: true) |
| `servers[serverId].bountyBattles.bountyThreshold` | Min bounty for role mentions | No (default: 0) |
| `servers[serverId].reports` | Report settings (future feature) | No |

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
- User activity checks and inactivity notifications
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
- Verify `channelId` in `config/serverConfig.json` is correct for the specific server
- Or use `/bountybattles config view` to check current configuration
- Ensure bot is in the server and has access to the channel
- Check that the server ID in configuration matches the actual Discord server ID

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

