---
globs:
alwaysApply: true
---

# Repository rules

The canonical guidance for this repo lives in `CLAUDE.md` at the repo root — follow it. Highlights:

- discord.js bot wrapping the local `warera-sdk` (`../WarEraSDK`); runs in **many servers** — scope everything by `serverId`.
- Layering: `commands → services → ApiService → SDK`. **Command files (`src/commands/**`) must not use the SDK directly** — go through a service method.
- Always use the singleton `ApiService.getClient()` / `getBatchClient()`; never `createAPI()` / `createBatchClient()`. Batch independent requests together (≤100 sub-requests = 1 rate-limit request); shared cache + rate limiter depend on using the singletons.
- All periodic work goes through `SchedulerService` via the `ScheduledTask` interface — no ad-hoc `setInterval`.
- Persistence is migrating to SQLite/Prisma; go through the persistence layer with a `serverId`.
- Keep `src/utils/` generic; feature-specific helpers live with their feature.

See `docs/ONBOARDING.md` for structure and how to add a command.
