# WarEra Discord Bot - Architecture

## Project Structure

```
src/
├── bot/
│   └── Bot.ts                      # Main bot class, orchestrates all services
├── config/
│   └── config.ts                   # Configuration loading and validation
├── services/
│   ├── api/
│   │   └── ApiService.ts           # WarEra API interactions
│   ├── battle/
│   │   ├── BattleService.ts        # Battle processing orchestration
│   │   ├── BattleTracker.ts        # Battle state tracking and change detection
│   │   └── BattleFormatter.ts      # Battle message formatting
│   ├── discord/
│   │   ├── DiscordService.ts       # Discord API interactions
│   │   └── MessageTracker.ts       # Discord message ID tracking
│   └── polling/
│       └── PollingService.ts       # Periodic polling scheduler
├── utils/
│   └── logger.ts                   # Logging utility
└── index.ts                        # Application entry point
```

## Service Responsibilities

### Bot (bot/Bot.ts)
- **Purpose**: Main orchestrator for the entire application
- **Responsibilities**:
  - Initialize Discord client
  - Create and wire up all services
  - Handle Discord events (ready, error, disconnect)
  - Manage bot lifecycle (start/stop)
- **Dependencies**: All services

### Config (config/config.ts)
- **Purpose**: Configuration management
- **Responsibilities**:
  - Load environment variables
  - Parse config/serverConfig.json
  - Validate configuration
  - Provide typed configuration object
- **Dependencies**: None

### ApiService (services/api/ApiService.ts)
- **Purpose**: WarEra API interactions
- **Responsibilities**:
  - Fetch battles from API
  - Fetch country information (batch requests)
  - Fetch region information
  - Extract role IDs per server
  - Client-side filtering of battles
- **Dependencies**: WarEra SDK, Config

### BattleService (services/battle/BattleService.ts)
- **Purpose**: Battle processing orchestration
- **Responsibilities**:
  - Process battles (detect changes, format, update Discord)
  - Coordinate between BattleTracker, BattleFormatter, and DiscordService
  - Clean up old battle messages
- **Dependencies**: ApiService, DiscordService, BattleTracker, BattleFormatter

### BattleTracker (services/battle/BattleTracker.ts)
- **Purpose**: Battle state management and change detection
- **Responsibilities**:
  - Track battle states (money pool, bounty, last seen)
  - Detect changes (new battles, pool increases, bounty changes)
  - Maintain change history
  - Identify old battles for cleanup
  - **Does NOT report pool decreases**
- **Dependencies**: None (pure logic)

### BattleFormatter (services/battle/BattleFormatter.ts)
- **Purpose**: Format battle data for Discord
- **Responsibilities**:
  - Format battle messages with ANSI colors
  - Create damage bars and points bars
  - Format change history log
  - Trim logs to fit Discord's 2000 char limit
  - Add battle links
- **Dependencies**: BattleTracker (for ChangeEntry type)

### DiscordService (services/discord/DiscordService.ts)
- **Purpose**: Discord API interactions
- **Responsibilities**:
  - Initialize Discord channels
  - Update or create battle messages
  - Delete old battle messages
  - Manage role mentions
- **Dependencies**: Discord.js, Config, MessageTracker

### MessageTracker (services/discord/MessageTracker.ts)
- **Purpose**: Track Discord message IDs
- **Responsibilities**:
  - Store message ID per battle per server
  - Retrieve message IDs for updates
  - Remove tracking for deleted battles
- **Dependencies**: None (pure data structure)

### PollingService (services/polling/PollingService.ts)
- **Purpose**: Periodic polling scheduler
- **Responsibilities**:
  - Schedule periodic battle processing
  - Schedule periodic cleanup
  - Manage polling intervals
  - **Delegates all battle logic to BattleService**
- **Dependencies**: Config, BattleService

## Data Flow

### Battle Processing Flow
```
PollingService (timer)
  ↓
BattleService.processBattles()
  ↓
ApiService.fetchBattles() → Returns battles, countries, regions
  ↓
BattleTracker.detectChanges() → Returns changed battles with change type
  ↓
BattleFormatter.formatBattleMessage() → Returns formatted message
  ↓
DiscordService.updateBattleMessage() → Updates or creates Discord message
  ↓
MessageTracker → Stores message ID
```

### Cleanup Flow
```
PollingService (hourly timer)
  ↓
BattleService.cleanupOldBattles()
  ↓
ApiService.fetchBattles() → Get current battles
  ↓
BattleTracker.getOldBattles() → Identify battles ended >1 day ago
  ↓
DiscordService.deleteBattleMessage() → Delete messages
  ↓
MessageTracker → Remove tracking
```

## Key Design Principles

### Separation of Concerns
- Each service has a single, well-defined responsibility
- Battle logic is isolated in the `battle/` folder
- Discord logic is isolated in the `discord/` folder
- API logic is isolated in the `api/` folder

### Dependency Injection
- Services receive dependencies through constructors
- Makes testing easier
- Reduces coupling

### Single Responsibility
- **PollingService**: Only handles scheduling
- **BattleService**: Only orchestrates battle processing
- **BattleTracker**: Only tracks state and detects changes
- **BattleFormatter**: Only formats messages
- **DiscordService**: Only interacts with Discord API

### Modularity
- Easy to add new features:
  - New battle features → Add to `services/battle/`
  - New Discord features → Add to `services/discord/`
  - New API features → Add to `services/api/`
- Each module can be tested independently

## Adding New Features

### Example: Add a new battle filter
1. Add logic to `ApiService.fetchBattles()`
2. No other services need to change

### Example: Add a new Discord command
1. Create new service in `services/discord/`
2. Wire it up in `Bot.ts`
3. No impact on battle processing

### Example: Add a new data source
1. Create new service in `services/api/`
2. Inject into `BattleService`
3. Use in `BattleService.processBattles()`

## Configuration

### Environment Variables (.env)
- `DISCORD_TOKEN`: Bot token
- `POLLING_INTERVAL_MINUTES`: Polling frequency
- `API_BASE_URL`: WarEra API base URL

### Server Configuration (config/serverConfig.json)
```json
{
  "servers": {
    "SERVER_ID": {
      "bountyBattles": {
        "channelId": "CHANNEL_ID",
        "roleIds": ["ROLE_ID_1", "ROLE_ID_2"],
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

**Feature-based Configuration:**
- Each feature (bountyBattles, reports, etc.) has its own config namespace
- Features can be independently enabled/disabled per server
- Features can use different channels

## Message Management

### One Message Per Battle
- Each battle has exactly one Discord message per server
- Messages are updated in place (not recreated)
- Message IDs are tracked in `MessageTracker`

### Change Detection
- Only sends updates when:
  - New battle appears
  - Money pool increases (not decreases)
  - Bounty (moneyPer1kDamages) changes
- Change history is maintained and displayed in messages

### Automatic Cleanup
- Messages for battles ended >1 day ago are deleted
- Cleanup runs every hour
- Prevents channel clutter

## Error Handling

- Each service logs errors independently
- Polling continues even if one cycle fails
- Server failures don't affect other servers
- Message update failures fall back to creating new messages

