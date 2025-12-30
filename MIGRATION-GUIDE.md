# Migration Guide: servers.json → serverConfig.json

## Overview

The bot's configuration structure has been refactored to support multiple feature-specific configurations per server. The flat `servers.json` structure has been replaced with a nested `serverConfig.json` structure.

## What Changed

### File Location
- **Old:** `servers.json` (root directory)
- **New:** `config/serverConfig.json` (config directory)

### Configuration Structure

**Old Structure (servers.json):**
```json
{
  "servers": {
    "SERVER_ID": {
      "channelId": "CHANNEL_ID",
      "roleIds": ["ROLE_ID"],
      "enabled": true,
      "bountyThreshold": 10.0
    }
  }
}
```

**New Structure (config/serverConfig.json):**
```json
{
  "servers": {
    "SERVER_ID": {
      "bountyBattles": {
        "channelId": "CHANNEL_ID",
        "roleIds": ["ROLE_ID"],
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

## Migration Steps

### Step 1: Create Config Directory

```bash
mkdir config
```

### Step 2: Migrate Your Configuration

If you have an existing `servers.json`, migrate it manually:

**Old:**
```json
{
  "servers": {
    "1234567890": {
      "channelId": "9876543210",
      "roleIds": ["1111111111"],
      "enabled": true,
      "bountyThreshold": 5.0
    }
  }
}
```

**New:**
```json
{
  "servers": {
    "1234567890": {
      "bountyBattles": {
        "channelId": "9876543210",
        "roleIds": ["1111111111"],
        "enabled": true,
        "bountyThreshold": 5.0
      }
    }
  }
}
```

Simply wrap your existing server configuration in a `"bountyBattles"` object.

### Step 3: Move File to Config Directory

```bash
# Windows
move servers.json config\serverConfig.json

# Unix/Linux/Mac
mv servers.json config/serverConfig.json
```

### Step 4: Update .gitignore (if needed)

The `.gitignore` has been updated to ignore `config/serverConfig.json` instead of `servers.json`.

### Step 5: Update Docker Volumes (if using Docker)

Update your Docker run commands or docker-compose.yml:

**Old:**
```bash
-v $(pwd)/servers.json:/app/servers.json
```

**New:**
```bash
-v $(pwd)/config/serverConfig.json:/app/config/serverConfig.json
```

## Why This Change?

### Benefits

1. **Scalability**: Each feature (bounty battles, reports, etc.) has its own configuration namespace
2. **Clarity**: Feature-specific settings are grouped together
3. **Future-proof**: Easy to add new features without config conflicts
4. **Organization**: Config files are now in a dedicated `config/` directory

### Feature Isolation

With the new structure, you can:
- Enable/disable features independently per server
- Have different channels for different features
- Add new features without breaking existing configs

## API Changes (For Developers)

### Old API
```typescript
// Get config
const config = ServerConfigManager.getServerConfig(serverId);
const channelId = config?.channelId;
const roleIds = config?.roleIds;

// Update config
ServerConfigManager.updateServerConfig(serverId, {
  channelId: 'new-channel',
  roleIds: ['role-1'],
});
```

### New API
```typescript
// Get config
const config = ServerConfigManager.getServerConfig(serverId);
const channelId = config?.bountyBattles?.channelId;
const roleIds = config?.bountyBattles?.roleIds;

// Update bounty battles config
ServerConfigManager.updateBountyBattlesConfig(serverId, {
  channelId: 'new-channel',
  roleIds: ['role-1'],
});

// Legacy method still works (redirects to updateBountyBattlesConfig)
ServerConfigManager.updateServerConfig(serverId, {...});
```

## No Migration Script?

We intentionally didn't create an automated migration script because:
1. The migration is simple (just nest under `bountyBattles`)
2. Most users can use slash commands to reconfigure
3. Manual migration ensures you understand the new structure
4. The legacy `updateServerConfig()` method provides backward compatibility

## Need Help?

If you encounter issues:
1. Check the `serverConfig.json.example` file for reference
2. Use `/bountybattles config view` to see current settings
3. Use `/bountybattles config set` to reconfigure via Discord
4. Check bot logs for detailed error messages

## Rollback (If Needed)

If you need to rollback to the old structure:
1. Check out the previous commit: `git checkout <previous-commit>`
2. Or manually adjust the code to read flat configs again

However, we recommend moving forward with the new structure for better long-term maintainability.
