# Repository instructions (Claude, Cursor, Codex, Copilot)

This is the **canonical** guidance file for AI assistants working in this repo. The Cursor rule, `AGENTS.md`, and `.github/copilot-instructions.md` all point here — edit this file and keep the others as thin pointers.

New here? Read [`docs/ONBOARDING.md`](docs/ONBOARDING.md) for the structure and how to add a command.

## What this is

A TypeScript / discord.js v14 bot that wraps the local `warera-sdk` (`../WarEraSDK`) to serve WarEra game data. It responds to slash commands and runs background tasks on timers.

**The bot runs in MANY Discord servers at once.** Everything is keyed by Discord **`serverId`** (guild id). Never assume a single server: always scope reads, writes, and messages by `serverId`, and iterate all configured servers in background tasks.

## Architecture & layering

One-directional flow — keep it that way:

```
Discord → commands / scheduler tasks → services → ApiService → warera-sdk
```

- `src/index.ts` boots the app; `src/bot/Bot.ts` is the composition root (builds services, registers scheduler tasks, wires Discord events).
- `src/commands/**` — Discord layer (one folder per command).
- `src/services/**` — business logic; `services/api/ApiService.ts` and `services/discord/DiscordService.ts` are cross-cutting.
- `src/utils/**` — **generic** helpers only (`logger`, `formatError`, `countryFlag`). Feature-specific helpers live in the feature's folder, not here.

### Layering rule (important)

**Files under `src/commands/**` must NOT use the SDK directly** — no `import 'warera-sdk'`, no `apiService.getClient()` / `createCommandBatchClient()` in a command. Add or call a **service** method that returns plain data; commands only read interaction options, call a service, and reply. The command layer is currently 100% SDK-free — keep it that way. The `/scanfor` and `/spectre` commands read game data via `ScanService` (`src/services/scan/`), which owns country/party/government/user/region lookups and re-exports the domain types (`ScanCountry`, `ScanUserLite`, …) so commands never need the SDK's types either.

## ApiService: singleton clients & batching (CRITICAL)

Always use the singleton clients on `ApiService` — **never** call `createAPI()` yourself:

- `apiService.getClient()` — single, non-batched requests.
- `apiService.getBatchClient()` — batch operations (not a removed `createBatchClient()`).
- `apiService.createCommandBatchClient()` — an isolated batch client for one command execution (avoids cross-command queue conflicts).

Why singletons: shared `InMemoryCacheProvider` (cache hits everywhere), correct shared rate-limit tracking, one source of truth for config. Creating new clients breaks all three.

**Batch to save rate limit.** A batched request of up to 100 sub-requests counts as **1** request. Always batch independent requests together; chunk large collections into batches of ≤100.

```ts
const batch = apiService.getBatchClient();
const promises = items.map(item => batch.someEndpoint.getData(item.id));
await batch.runBatch();               // all queued calls = 1 rate-limit request
const results = await Promise.all(promises);
```

Sequential/dependent requests (request 2 needs request 1's result) can't be batched — use `getClient()`. Cache TTL is per-request: `{ cache: { ttl: 86400 } }`.

## Scheduling (all periodic work)

`SchedulerService` (`src/services/scheduler/`) owns every recurring task. Do **not** add your own `setInterval`. Implement the `ScheduledTask` interface (`name`, `intervalMs`, optional `runOnStart`/`initialDelayMs`, `runCycle()`) and register the instance in the array passed to `SchedulerService` in `Bot.ts`. The scheduler isolates errors so one failing task can't stop the others.

## Persistence

Per-server config and state go through `ServerConfigManager` (`src/utils/serverConfigManager.ts`) — always pass `serverId`. Persistence is migrating from JSON files to **SQLite via Prisma** (repository classes); prefer the persistence layer over hand-rolled `fs`/JSON reads.

## Build / test

```bash
npm run build   # tsc (strict, noUnusedLocals/Parameters)
npm test        # jest
npm run dev     # run from source
```

Requires the WarEra SDK at `../WarEraSDK`. If the build reports missing SDK exports, that sibling SDK is out of date — rebuild it first.

## Don't

- ❌ Create SDK clients with `createAPI()` / `createBatchClient()`.
- ❌ Call the SDK or `getClient()` from a command file.
- ❌ Make independent requests sequentially instead of batching them.
- ❌ Add ad-hoc `setInterval`s outside the scheduler.
- ❌ Put feature-specific code in `src/utils/`, or read/write persistence without a `serverId`.
