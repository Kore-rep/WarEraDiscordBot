# Onboarding — WarEra Discord Bot

A short guide to how this repo is put together and how to make common changes. Written for people new to the codebase (and to TypeScript bots in general).

## What the bot does

It is a [discord.js](https://discord.js.org/) bot that talks to the WarEra game API (through a local SDK) and:

- responds to **slash commands** people type in Discord (e.g. `/scanfor`, `/leaderboard`), and
- runs **background tasks** on timers (polling for bounty battles, tracking users/countries, refreshing leaderboards).

> **The bot runs in many Discord servers at once.** Almost everything is keyed by a Discord **server id** (also called "guild id"). Whenever you read or write settings or send a message, you are doing it *for one specific server*. Never assume there is only one server.

## The big picture — layers

Requests flow in one direction. Keep them that way:

```
Discord  →  Commands / Scheduler tasks  →  Services  →  ApiService  →  WarEra SDK
(user)      (src/commands, src/services/scheduler)   (business logic)   (HTTP)
```

- **`src/index.ts`** — starts the app: loads config, creates the `Bot`, handles shutdown signals.
- **`src/bot/Bot.ts`** — the composition root. It builds every service once and wires them together, registers the scheduler tasks, and hooks up Discord events.
- **`src/commands/`** — the **Discord layer**. One folder per command. These handle the interaction (reading options, replying) and nothing else — see the rule below.
- **`src/services/`** — the **logic layer**. Each feature has a service (`battle/`, `mercenary/`, `spectre/`, `leaderboard/`, `userTracking/`, `countryTracking/`, `proxyTracking/`). Two cross-cutting ones:
  - **`services/api/ApiService.ts`** — the only place allowed to create and drive the WarEra SDK. It exposes friendly methods like `fetchAllBattles()` and shares one cache + rate limiter.
  - **`services/discord/DiscordService.ts`** — sending messages/embeds to channels.
  - **`services/scheduler/`** — the `SchedulerService` that runs all the background tasks (see below).
- **`src/utils/`** — small, **generic** helpers only (`logger`, `formatError`, `countryFlag`). If a helper is really about one feature, it belongs in that feature's folder, not here.
- **`src/config/config.ts`** — loads environment variables and defines the shared TypeScript types for per-server settings.

### The one layering rule to remember

> **Command files (`src/commands/**`) must not talk to the WarEra SDK directly.** Do not `import 'warera-sdk'` and do not call `apiService.getClient()` there. Instead, add or call a method on a service, and let the service do the API work. Commands should only: read interaction options, call a service, and reply to the user.

This keeps API logic testable and in one place. Every command currently follows this rule — the `/scanfor` and `/spectre` commands read game data through `ScanService` (`src/services/scan/`), which wraps the SDK and hands back plain data.

## How to add a new slash command

Say you want `/hello`.

1. **Create a folder:** `src/commands/hello/`.
2. **Write the command** in `src/commands/hello/hello.ts`:

   ```ts
   import { ChatInputCommandInteraction } from 'discord.js';
   import { Command, createCommandBuilder } from '../types';
   import { ApiService } from '../../services/api/ApiService';

   export const helloCommand: Command = {
     // createCommandBuilder makes it guild-only. Pass { requireAdmin: false }
     // to let any member use it; the default requires Administrator.
     data: createCommandBuilder('hello', 'Say hello', { requireAdmin: false }),

     async execute(interaction: ChatInputCommandInteraction, _discordService, apiService?: ApiService) {
       // Do API work through a service method, never the SDK directly.
       await interaction.reply({ content: 'Hello!', ephemeral: true });
     },
   };
   ```

3. **Re-export it** from `src/commands/hello/index.ts`:

   ```ts
   export { helloCommand } from './hello';
   ```

4. **Register it** in `src/commands/CommandHandler.ts`: import it at the top and add it to the `commandList` array in `loadCommands()`.

That's it — `CommandHandler` registers every command in that list with Discord on startup and routes interactions to your `execute`.

**If your command needs game data:** add a method to `ApiService` (or the relevant feature service) that returns plain data, and call that from `execute`. Remember to scope anything you store/read by `interaction.guildId` (the server id).

## How background (periodic) tasks work

All recurring work is owned by **`SchedulerService`** (`src/services/scheduler/`). You don't write your own `setInterval`.

A periodic task implements the **`ScheduledTask`** interface:

```ts
export interface ScheduledTask {
  readonly name: string;          // shown in logs
  readonly intervalMs: number;    // how often runCycle() runs
  readonly runOnStart?: boolean;  // run once immediately? (default true)
  initialDelayMs?(now: Date): number; // optional: delay/align the first run
  runCycle(): Promise<void>;      // do one cycle of work
}
```

To add one: make your service implement `ScheduledTask` (or write a small task class), then add an instance to the array passed to `new SchedulerService([...])` in `Bot.ts`. The scheduler runs each task on its own interval and catches errors so one failing task never stops the others.

Existing examples: `SpectreService`, `UserTrackingService`, `CountryTrackingService`, `ProxyTrackingService`, and `LeaderboardService` all implement `ScheduledTask` directly; `BattlePollTask` and `BattleCleanupTask` (in `scheduler/tasks/`) group the battle-bounty and mercenary-contract work that shares a single battle fetch per cycle.

## Where settings and state live

Per-server settings and state are read/written through **`ServerConfigManager`** (`src/utils/serverConfigManager.ts`). Always go through it rather than reading files yourself, and always pass the `serverId`.

> The project is migrating this persistence from JSON files to **SQLite via Prisma**. When that lands, you'll read/write through repository classes instead — but the "always scope by server id" rule stays the same.

## Running and testing

```bash
npm run dev      # run the bot from source (needs a .env — see .env.example)
npm run build    # type-check + compile to dist/
npm start        # run the compiled bot
npm test         # run the Jest test suite
```

The bot depends on the WarEra SDK living next to this repo at `../WarEraSDK`. If the build complains about missing SDK exports, that sibling SDK is probably out of date — rebuild it first.
