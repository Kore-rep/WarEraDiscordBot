# WarEraDiscordBot repository memory

> Deep-scan snapshot: 2026-08-11. This is an additive working memory for Codex,
> not the canonical policy file. Read `CLAUDE.md` first and obey it when this file
> disagrees. Re-run `git status` before every task: this scan was made while a
> substantial user-owned change set was in progress.

## Instruction precedence and trustworthy sources

1. `CLAUDE.md` is the canonical repository instruction file.
2. `AGENTS.md`, `.cursor/rules/API/RULE.md`, and
   `.github/copilot-instructions.md` are intentionally thin mirrors.
3. `docs/ONBOARDING.md` is the best concise architecture guide.
4. Current source, Prisma schema/migrations, and tests are authoritative for
   implemented behavior.
5. `README.md`, `ARCHITECTURE.md`, `TESTING.md`, `tests/README.md`,
   `MIGRATION-GUIDE.md`, and `README-DOCKER.md` contain useful history but also
   stale JSON-persistence, deleted-class, Docker-volume, and test-count details.
   Never implement an old pattern solely because one of these files shows it.

Generated/runtime material is not design guidance. Ignore `dist/`, `coverage/`,
`node_modules/`, SQLite files, journals, legacy `battles.json`, and local config
imports when understanding behavior. `coverage/` is unfortunately tracked but
describes removed classes and is stale. Never read or expose `.env` values.

## Non-negotiable invariants

- The bot serves many Discord guilds. Scope every config/state read, mutation,
  database query, message, cache of server-owned data, and background action by
  `serverId`/guild id. Background tasks iterate every configured server and isolate
  failures so one guild cannot block another.
- Preserve the dependency direction:
  `Discord -> commands/scheduled tasks -> feature services -> ApiService -> warera-sdk`.
- Code under `src/commands/**` must not import `warera-sdk`, call `getClient()`,
  call `getBatchClient()`, or build SDK clients. Commands may receive `ApiService`
  for dependency lookup, but game-data work belongs in a feature service such as
  `ScanService`, `MilitaryUnitService`, `AutoroleService`, or another service API.
- Only `ApiService` owns normal SDK client construction. Use its shared regular
  client, shared polling batch client, or isolated command batch client. A current
  one-off migration script constructs a client directly; treat that as migration
  tooling, not an application pattern.
- Batch independent API requests. A batch has at most 100 subrequests, so dedupe
  identifiers and chunk collections at 100. Cursor-dependent pagination remains
  sequential. Queue promises, run the batch, then await the promises.
- SDK cache TTLs are milliseconds. The shared in-memory cache defaults to the SDK's
  30-second request cache. Only pass custom cache options to SDK resources that
  accept them; otherwise memoize in a service.
- Every recurring job implements `ScheduledTask` and is registered in `Bot.ts`'s
  `SchedulerService` task array. Never add a feature-owned `setInterval`.
- Per-server configuration goes through `ServerConfigManager`; do not add JSON/fs
  persistence in runtime code. Purpose-built stores may use the shared Prisma
  singleton for row-oriented state, but every query remains server-scoped.
- Channel output goes through `DiscordService`. `sendToChannel` owns role mentions
  and 2,000-character splitting; services provide full content. Interaction output
  that can exceed the limit reuses `splitMessage`.
- Keep `src/utils/` generic. Feature-specific parsers, calculations, renderers, and
  stores live beside their feature.
- Preserve user-owned changes. Never assume a clean worktree and never repair or
  revert unrelated diffs as part of a feature task.

## Runtime and composition

- TypeScript, CommonJS, strict compiler settings, ES2022 target, discord.js v14,
  Prisma 5/SQLite, Jest/ts-jest. Node 18+ is declared.
- `src/index.ts` loads config, creates `Bot`, installs signal/error handlers, and
  starts Discord. Graceful shutdown stops scheduling, flushes queued config writes,
  disconnects Prisma, then destroys the Discord client.
- `src/bot/Bot.ts` is the sole composition root. It constructs one shared
  `ApiService`, `DiscordService`, all feature services, `CommandHandler`, and one
  `SchedulerService`. Cross-feature services exposed through `ApiService` are wired
  there to avoid circular constructor dependencies.
- Required Discord gateway intents are Guilds, GuildMessages, MessageContent, and
  privileged GuildMembers (needed for unlinked-role behavior).
- Slash commands register globally at ready time. Interaction routing covers chat
  commands, `countrygroup-*` modals, `autorole:*` modals/buttons, and `builds:*`
  buttons. Component custom IDs must contain enough state to survive restarts.

## Commands and interaction conventions

Current top-level commands registered in `CommandHandler` are:

- `/bountybattles`: alert configuration and enable/disable.
- `/contracts`: mercenary-contract alert configuration and enable/disable.
- `/user`: inactivity tracking.
- `/proxy`: citizenship/proxy tracking.
- `/leaderboard`: hourly leaderboard configuration, refresh, weekly CSV access.
- `/scanfor`: country government, low-population, ethics, and build scans.
- `/countrygroup`: per-server named country groups via modals.
- `/spectre`: building, resistance, and population monitors/snapshots.
- `/mudirectory`: living MU directory configuration and refresh.
- `/mu`: shared military-unit list and role mappings (present in the scanned dirty
  worktree; verify it is still present/committed before relying on it).
- `/link`: self-service WarEra account linking/status.
- `/autorole`: account-link review, role policies, and sync administration.
- `/help`: generated human-facing command overview.

Command implementation checklist:

- Use `Command` plus the shared `createCommandBuilder` where possible. It is
  guild-only and defaults to Administrator. Pass `{ requireAdmin: false }` only
  when ordinary members should see the command, or explicit permission bits for
  commands such as role management.
- A public command with mutating subcommands must enforce runtime authorization
  with `commandAuth`/feature-specific checks. Do not copy the older local command
  builders in `userTracking` and `proxyTracking`; they set guild context but no
  default permissions or mutation authorization.
- Guard `interaction.guildId`/`interaction.guild` before using a non-null assertion.
- Defer before slow API/database/Discord work. After deferral use `editReply` or
  `followUp`; otherwise use `reply`. Handle both states in the outer error path.
- Keep commands to option parsing, authorization, service calls, and response
  formatting. Put reusable pure calculations/rendering in the feature service.
- Register a new command in the `commandList`, add its barrel export, update help
  text, route any modal/button IDs, and update the exact command-count test.

Authorization is deliberately layered. The shared builder controls Discord command
visibility; runtime checks include Administrator, guild owner, Manage Roles, or
configured feature roles/users as appropriate. `commandAuth.ts` and autorole auth
also contain an existing bot-owner override; do not duplicate or expand hardcoded
identity exceptions.

## API, batching, caching, and rate limiting

`ApiService` creates and shares:

- a normal client for single/dependent calls;
- a batch-enabled client used by polling/shared operations;
- a shared `InMemoryCacheProvider`;
- a shared sliding-window `SharedRateLimiter` configured for 300 requests/minute;
- isolated batch clients from `createCommandBatchClient()` for concurrent commands
  and service sweeps, sharing only cache and rate-limit state.

Important patterns:

```ts
for (let i = 0; i < ids.length; i += 100) {
  const chunk = ids.slice(i, i + 100);
  const batch = apiService.createCommandBatchClient();
  const promises = chunk.map(id => batch.resource.get(id));
  await batch.runBatch();
  const results = await Promise.all(promises);
}
```

- Use an isolated batch for request-scoped work. A shared batch queue can conflict
  if multiple callers queue concurrently.
- Batch calls may reject individually (404/missing data) even if `runBatch()`
  succeeds; handle expected absence per promise and unexpected failures explicitly.
- Cursor pagination cannot be pre-batched. `fetchAllBattles`, mercenary auction
  fetching, and country-user sweeps show the sequential-page pattern.
- Battle pages use 100 items; mercenary pages use 50. Battle + region first-page
  calls are combined. Country/region metadata uses a 24-hour TTL; battle TTL is
  `max(30s, polling interval - 30s)`.
- `ScanService` is the command-facing game-data gateway and re-exports plain domain
  types so command files stay SDK-free. `AutoroleApi` similarly owns autorole API
  lookups and bypasses caching for company-rename verification.
- Avoid sequential independent per-user/per-country calls. Several older tracking
  paths still do this; improve them through services/batches rather than copying.

## Persistence model

`DATABASE_URL` points to SQLite and is resolved relative to `prisma/schema.prisma`;
the example targets `data/bot.db`. `src/persistence/prisma.ts` exports the only
process-wide Prisma client.

`ServerConfigManager` behavior matters:

- `loadConfigs()` is awaited once during `loadConfig()` before normal reads.
- The in-memory `Map<serverId, ServerConfig>` is runtime truth. Reads are
  synchronous and return defensive/deep copies.
- Mutators update memory synchronously, then enqueue a serialized fire-and-forget
  full-table transaction. `flush()` must be awaited at shutdown and in persistence
  tests before cache/database resets.
- SQLite has no native JSON in this setup, so each optional `Server` feature block
  is JSON encoded in a nullable `String` column. Whenever a feature block is added,
  update all of: config types/default normalization/deep copy/mutator, Prisma schema,
  migration SQL, import scripts where applicable, examples/docs, and round-trip tests.
- `persistAll()` mirrors the full cache, including deleting database server rows not
  present in memory. Never clear/reload the cache casually in application code.

Row-oriented tables are used where data grows independently:

- `LinkedUser`: composite server/member key, unique WarEra account per server,
  link time, MU-notice throttle, and scanned-worktree OPSEC revocation flag.
- `PendingLink`: staff-review state and durable review message identifiers.
- `PendingVerification`: expiring six-digit company-rename verification.
- `WeeklyDamageSnapshot`: server/kind/week unique CSV snapshots.

All compound Prisma calls use `serverId`. `LinkStore` is the persistence boundary
for linking; weekly snapshot helpers are the boundary for leaderboard history.

## Scheduled work and feature state

Tasks registered in the composition root:

- `battle-poll`: configured polling interval; fetches battles once for bounties,
  then independently processes mercenary contracts.
- `battle-cleanup`: hourly, not on start.
- `spectre`: configured polling interval; one region fetch per cycle, output
  aggregated per channel.
- `user-tracking`: hourly.
- `country-tracking`: every 5 minutes.
- `proxy-tracking`: every 5 minutes.
- `leaderboard`: hourly, first run aligned to local `:01`.
- `mu-directory`: daily, first run aligned to 12:00 UTC.
- `autorole-sync`: ticks every minute but respects each server's configured cadence;
  not run immediately on start.

`SchedulerService` catches task errors, but each multi-server task should also catch
per-server/per-monitor failures. `initialDelayMs` takes precedence over `runOnStart`.
The scheduler currently does not prevent overlap if a cycle runs longer than its
interval, so new long tasks should be designed for idempotence or add an explicit
in-flight guard within the task if needed.

In-memory state that resets on process restart includes bounty/contract alert sets,
SDK cache/rate-limit windows, failed-channel suppression, and Spectre diff baselines.
The first Spectre cycle establishes a baseline without alerting. Do not accidentally
describe this state as durable.

## Discord output patterns

- `DiscordService.sendToChannel(channelId, content, { roleIds })` fetches the
  channel, mentions roles on the first chunk, splits at line boundaries, and returns
  the first message ID or `null`.
- `updateLeaderboardMessage` maintains one living message with embeds.
- `updateDirectoryMessages` positionally edits/sends/deletes only recorded directory
  message IDs.
- Component messages, edits, DMs, and user lookup also live in `DiscordService`.
- Unknown/missing-access channels are suppressed after unrecoverable failures to
  avoid hammering Discord every scheduler cycle.
- Existing direct `channel.send` calls in the user-tracking add path and Spectre
  population snapshot path are debt/legacy exceptions. Do not copy them; route
  future channel output through `DiscordService` and central chunking.

## Feature-specific logic worth preserving

- Bounty identity is battle + side + `bountyEffectiveAt`; alerts are fire-and-forget
  and in-memory deduplicated. Per-server minimum send thresholds are separate from
  mention thresholds.
- Mercenary contracts deduplicate by auction ID and use separate minimum rate/payout
  filters versus mention threshold.
- User inactivity uses `dates.lastConnectionAt`; missing/invalid activity never
  triggers action, and thresholds are inclusive.
- Country population warning is once-until-recovery; critical alerts repeat.
- Shared build analysis converts each skill level to triangular spent points
  `L*(L+1)/2`; never compare builds by raw summed levels. It is shared by scan and
  autorole.
- The shared per-server military-unit list is intended to feed leaderboard, MU
  directory, and autorole mappings. A role-less MU remains visible and maps to TBD.
- Autorole's sync plan is pure and test-heavy: highest qualifying level role,
  eco/war/hybrid role, one MU role, linked/unlinked inverse roles, timed removals,
  protected roles, nickname, and no-MU notice. OPSEC in the scanned worktree is a
  one-way auto-revocation: once marked revoked it is manual-only and never re-added
  or re-stripped by sync.
- Link verification codes are six digits with a 15-minute TTL. Company lookup is
  uncached and has a 30-second timeout. Review/link/verification rows are all
  server-scoped and component IDs are restart-safe.
- Leaderboards refresh living embeds, preserve prior ranks for deltas, and store
  user/MU weekly CSV snapshots. Week keys are Sunday dates; cutover is Sunday 23:02
  in the process's local timezone.
- MU damage and scoring functions are ports from the prior Python bot. Preserve
  documented magic constants and regression fixtures unless intentionally changing
  game mechanics.
- Spectre building/resistance snapshots are process-memory only, keyed by server and
  country. Resistance alerts at/crossing 90%, changes while high, drops below 90%,
  or moves greater than 10 percentage points.

## Tests and validation

At scan time the tree contained 38 Jest test files and 306 `it`/`test` cases (the
old docs' “43 tests” is stale). Tests cover command routing/config, API caching and
pagination, scheduler timing, message chunking, Prisma round trips, autorole link and
sync logic, scan classification, Spectre diffs, leaderboard CSVs, and MU calculations.

- Jest setup assigns each worker `data/test-<worker>.db` before Prisma imports.
- Database suites call `pushTestSchema()` once, clear tables between tests, flush
  `ServerConfigManager`, clear its cache, and disconnect Prisma after the suite.
- External Discord/SDK behavior is mocked; pure calculation tests favor boundary
  cases and exact port parity.
- Use fake timers for scheduler/cache/TTL behavior and restore real timers.
- Add success, boundary, failure, missing-data, server-isolation, and no-duplicate
  cases for new behavior.

Required verification after changes:

```bash
npm run build
npm test
git diff --check
```

The build runs `prisma generate && tsc`; TypeScript enables strictness,
`noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, and switch fallthrough
checks. This scan could run `git diff --check`, but could not execute build/tests
because the current execution environment had no `node`, `npm`, or `npx` binary.
Do not treat that as a passing baseline.

There is currently no tracked ESLint config, Prettier config, lint script, or format
script even though canonical/docs mention them. Match local style and rely on strict
TypeScript/tests until tooling is actually restored; do not invent a formatting
command.

## Database and deployment changes

- Normal local/runtime schema application: `npx prisma migrate deploy`.
- Schema development: edit `prisma/schema.prisma`, create a named migration, generate
  the client, then build/test. Never edit an already-applied migration casually.
- One-time import scripts are idempotent upserts. `db:import` migrates legacy
  serverConfig JSON and weekly CSVs; `db:import-autorole` imports the prior Python
  bot; the scanned dirty worktree adds `db:merge-mu` for legacy MU-list convergence.
- Docker uses Node 18 Alpine, installs OpenSSL/git, installs dev dependencies to
  build, prunes production dependencies, runs non-root, and starts with migration
  deploy followed by compiled Node. SDK installation requires GitHub/git access.
- `package.json` currently references `warera-sdk#main`; `package-lock.json` resolves
  a concrete commit. Therefore reproducibility depends on keeping the lockfile and
  using `npm ci`; do not claim the manifest itself is commit-pinned.

## Known inconsistencies and debt: notice, do not silently expand scope

- The scanned worktree was dirty across commands, config, services, schema, tests,
  and a new migration. The uncommitted themes were shared military units, OPSEC,
  activity/build changes, and bounty/contract thresholds. Recheck status rather
  than assuming these are committed or safe to rewrite.
- Older docs describe `PollingService`, `BattleTracker`, `BattleFormatter`,
  `MessageTracker`, JSON config as active persistence, two JSON Docker volumes,
  and only five test suites. Those are historical, not current architecture.
- Some comments/log messages still say “disk” or `serverConfig.json` although normal
  runtime persistence is SQLite.
- Some older commands use local builders and lack consistent authorization; audit
  permissions whenever touching them.
- `ApiService.extractRoleIdsByServer` is a placeholder and should not be treated as
  feature-complete routing logic.
- Some batch implementations do not yet chunk every potentially-large ID set.
  Enforce the 100-item cap when modifying those paths.
- Tracker cleanup is size-based and in-memory rather than age-based despite method
  parameters/comments mentioning days.
- Broad `any`, `@ts-ignore`, direct SDK-typed service constructors, and direct channel
  sends exist in legacy paths. Prefer typed service boundaries in new/refactored code.
- `ROADMAP.md` remains the source for explicitly deferred work; notably, rejecting a
  new link attempt from a Discord member who is already linked is still listed as
  unfinished. Do not smuggle roadmap work into unrelated fixes.

## Practical change checklists

New command or command subcommand:

1. Decide public visibility and runtime mutation authorization.
2. Add a service method returning plain data; keep the command SDK-free.
3. Guard guild context, defer slow work, and use correct interaction reply state.
4. Register/export/help-route the command or route its component IDs.
5. Scope all state by guild id and use shared chunking.
6. Add routing/count tests plus behavior and failure tests.

New periodic feature:

1. Implement `ScheduledTask` with a stable name and explicit interval/start policy.
2. Iterate all server configs, skip absent/disabled blocks, and isolate per-server
   errors.
3. Batch/dedupe/chunk API work and fetch shared global data once per cycle.
4. Send full messages through `DiscordService`.
5. Register the task in `Bot.ts` and test timer/error behavior.

New persisted config/state:

1. Add typed config and normalization/default/deep-copy behavior.
2. Add a server-scoped manager/store API; do not expose mutable cache objects.
3. Update schema plus migration and all encode/decode/import paths.
4. Update examples/help only after code behavior is settled.
5. Test partial updates, defaults, deep-copy isolation, DB round trip, server
   isolation, and queued-write flushing.

API-heavy change:

1. Separate dependent pagination from independent calls.
2. Dedupe IDs, chunk at 100, and use an isolated batch for request-scoped work.
3. Confirm the SDK endpoint's cache-options signature and use millisecond TTLs.
4. Handle partial/missing responses without discarding unrelated successes.
5. Add cache, pagination, batch-size, error, and concurrency-oriented tests.
