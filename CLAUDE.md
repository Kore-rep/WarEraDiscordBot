# Repository instructions (Claude, Cursor, Codex, Copilot)

This is the **canonical** guidance file for AI assistants working in this repo. The Cursor rule, `AGENTS.md`, and `.github/copilot-instructions.md` all point here — edit this file and keep the others as thin pointers.

New here? Read [`docs/ONBOARDING.md`](docs/ONBOARDING.md) for the structure and how to add a command.

Codex also maintains a deeper, non-canonical repository map and change checklist in
[`.codex/REPOSITORY_MEMORY.md`](.codex/REPOSITORY_MEMORY.md); use it as working context after reading this file.

## What this is

A TypeScript / discord.js v14 bot that wraps the `warera-sdk` package to serve WarEra game data. The SDK is a public git dependency fetched from GitHub (`git+https://github.com/Kore-rep/WarEraSDK.git`, pinned to a commit in `package.json`) — no local checkout is required. It responds to slash commands and runs background tasks on timers.

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

Sequential/dependent requests (request 2 needs request 1's result) can't be batched — use `getClient()`. **Every request is cached for 30s by default** (shared cache across all clients; batches pre-check it per sub-call). Override per request with a TTL in **milliseconds**: `{ cache: { ttl: 86400 * 1000 } }` — never pass seconds. Only some SDK resources accept the options param (country, battle, region, party, mercenaryContractAuction); for the rest (user, mu, company, government, search, gameConfig, …) the 30s default always applies — memoize in the service if you need longer (see `AutoroleApi`'s MU cache or `ScanService.getSkillResetCooldownDays`).

## Scheduling (all periodic work)

`SchedulerService` (`src/services/scheduler/`) owns every recurring task. Do **not** add your own `setInterval`. Implement the `ScheduledTask` interface (`name`, `intervalMs`, optional `runOnStart`/`initialDelayMs`, `runCycle()`) and register the instance in the array passed to `SchedulerService` in `Bot.ts`. The scheduler isolates errors so one failing task can't stop the others.

## Discord output

All channel sends go through **`DiscordService.sendToChannel(channelId, content, { roleIds })`** — a single method that optionally mentions roles (first chunk only) and automatically splits content over Discord's 2000-char limit into multiple messages. Do **not** add separate mention/no-mention send methods, and do **not** chunk messages inside feature services — send the full content and let `DiscordService` chunk. The one chunking implementation lives in `src/services/discord/messageChunker.ts` (`splitMessage`); reuse it (e.g. for interaction replies) rather than writing another.

## Persistence

Per-server config and state go through `ServerConfigManager` (`src/utils/serverConfigManager.ts`) — always pass `serverId`; never hand-roll `fs`/JSON reads. Backing store is **SQLite via Prisma**:

- An in-memory cache (`Map<serverId, ServerConfig>`) is the runtime source of truth. **Reads are synchronous** (from cache); mutators update the cache and schedule an async persist. `loadConfigs()` is awaited once at startup (`loadConfig()` in `src/config/config.ts`).
- Schema: `prisma/schema.prisma` — a `Server` table with one JSON-encoded column per feature block, plus `WeeklyDamageSnapshot`. The Prisma client singleton is `src/persistence/prisma.ts`.
- `DATABASE_URL` (in `.env`) points at `data/bot.db`. Apply schema with `npx prisma migrate deploy` (runtime) / `migrate dev` (local); `npm run db:import` migrates an existing `config/serverConfig.json` + weekly CSVs into SQLite once.
- After a schema change: edit `prisma/schema.prisma`, run `npx prisma migrate dev --name <change>`, then `npx prisma generate` (the `build` script also generates).

## Build / test

```bash
npm run build   # tsc (strict, noUnusedLocals/Parameters)
npm test        # jest
npm run dev     # run from source
```

ESLint and Prettier are wired together via `eslint-config-prettier` (Prettier owns formatting, ESLint owns correctness). Config lives in `eslint.config.js` and `.prettierrc.json`.

The WarEra SDK is a git dependency (`warera-sdk` in `package.json`), fetched from GitHub and built automatically via its `prepare` script on `npm install`. If the build reports missing SDK exports, bump the pinned commit to a newer SDK revision (`npm install warera-sdk@github:Kore-rep/WarEraSDK#<ref>`), then rebuild. Working on the SDK itself? Point the dependency at a local checkout with `npm install ../WarEraSDK` temporarily, but don't commit that `file:` reference.

## Don't

- ❌ Create SDK clients with `createAPI()` / `createBatchClient()`.
- ❌ Call the SDK or `getClient()` from a command file.
- ❌ Make independent requests sequentially instead of batching them.
- ❌ Add ad-hoc `setInterval`s outside the scheduler.
- ❌ Add mention/no-mention send variants, or chunk messages inside a feature service — use `DiscordService.sendToChannel` + `splitMessage`.
- ❌ Put feature-specific code in `src/utils/`, or read/write persistence without a `serverId`.
