# GitHub Copilot instructions

Canonical guidance is in [`CLAUDE.md`](../CLAUDE.md); this mirrors the essentials for Copilot.

- discord.js v14 bot wrapping the local `warera-sdk` (`../WarEraSDK`). It runs in **many Discord servers** — always scope reads, writes, and messages by `serverId` (guild id).
- **Layering:** `commands → services → ApiService → SDK`. Code under `src/commands/**` must **not** import `warera-sdk` or call `apiService.getClient()`; do API work in a service method instead.
- **ApiService:** always use the singletons `apiService.getClient()` (single) and `apiService.getBatchClient()` (batch); never `createAPI()`. Batch independent requests together — up to 100 sub-requests count as 1 rate-limit request.
- **Scheduling:** implement `ScheduledTask` and register it with `SchedulerService` in `Bot.ts`. Never add your own `setInterval`.
- **Persistence:** go through the config/persistence layer (`ServerConfigManager`, migrating to Prisma/SQLite) with a `serverId`; don't hand-roll `fs`/JSON.
- **Generic helpers only** in `src/utils/`; feature-specific helpers live with their feature.
- Verify with `npm run build` and `npm test`. Requires `../WarEraSDK`.

See [`docs/ONBOARDING.md`](../docs/ONBOARDING.md) for structure and how to add a command.
