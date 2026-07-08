# Agent instructions

The canonical guidance for this repo lives in [`CLAUDE.md`](CLAUDE.md) — read it first. This file exists so Codex and other agents that look for `AGENTS.md` find the same rules.

Key points (see `CLAUDE.md` for detail):

- discord.js bot wrapping `warera-sdk` (a public git dependency fetched from GitHub; no local checkout needed); runs in **many servers** — scope everything by `serverId`.
- Layering: `commands → services → ApiService → SDK`. **Command files must not touch the SDK directly.**
- Use the singleton `ApiService.getClient()` / `getBatchClient()`; never `createAPI()`. Batch independent requests (≤100 = 1 rate-limit request).
- All periodic work goes through `SchedulerService` via the `ScheduledTask` interface — no ad-hoc `setInterval`.
- Persistence is migrating to SQLite/Prisma; go through the persistence layer with a `serverId`.
- `npm run build` (tsc) and `npm test` (jest) must pass. `npm install` fetches the `warera-sdk` git dependency (needs `git` + GitHub access).

New contributors: [`docs/ONBOARDING.md`](docs/ONBOARDING.md).
