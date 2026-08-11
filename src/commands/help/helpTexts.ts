/**
 * Help texts for every command tree (except /link and /autorole, whose texts
 * live in ../autorole/autoroleHelp.ts), plus the /help overview. Each command's
 * `help` subcommand replies with its entry from COMMAND_HELP.
 */

/** Few-word description per command tree, in /help display order. */
export const COMMAND_SUMMARIES: [name: string, summary: string][] = [
  ['link', 'Link your WarEra account'],
  ['autorole', 'WarEra-driven roles & nicknames'],
  ['mudirectory', 'Military-unit directory channel'],
  ['leaderboard', 'Hourly damage leaderboards'],
  ['bountybattles', 'Bounty battle alerts'],
  ['contracts', 'Mercenary contract alerts'],
  ['scanfor', 'Bulk country/player scans'],
  ['countrygroup', 'Country groups for scans'],
  ['spectre', 'Military monitoring & alerts'],
  ['user', 'User inactivity tracking'],
  ['proxy', 'Proxy citizen tracking'],
];

export const HELP_OVERVIEW = [
  '# WarEra bot — commands',
  '',
  ...COMMAND_SUMMARIES.map(([name, summary]) => `- **/${name}** — ${summary}`),
  '',
  'Every command has its own `help` subcommand (e.g. `/autorole help`, `/spectre help`) explaining how it works in detail.',
].join('\n');

export const COMMAND_HELP: Record<string, string> = {
  bountybattles: [
    '# /bountybattles — bounty battle alerts',
    '',
    'Watches active WarEra battles and posts an alert in a configured channel when a battle carries bounty rewards (money pools paying per 1k damage). Battles are polled on the bot-wide interval; each battle is announced once.',
    '',
    '- `config set channel:<#channel> [role] [threshold] [min] [minpool]` — where to post; `role` is mentioned when the total bounty reaches `threshold`; below `min` (gold per 1k) or `minpool` (total pool) nothing is sent at all',
    '- `config view` — current settings',
    '- `enable` / `disable` — turn notifications on or off',
  ].join('\n'),

  contracts: [
    '# /contracts — mercenary contract alerts',
    '',
    'Watches open mercenary contract auctions and posts alerts in a configured channel. Contracts are rated by gold per 1k damage; each auction is announced once.',
    '',
    '- `config set channel:<#channel> [role] [threshold] [min] [minpayout]` — where to post; `role` is mentioned at or above `threshold` gold/1k; below `min` (gold per 1k) or `minpayout` (total payout) nothing is sent',
    '- `config view` — current settings',
    '- `enable` / `disable` — turn notifications on or off',
  ].join('\n'),

  user: [
    '# /user tracking — inactivity watch',
    '',
    "Tracks individual WarEra players and posts a notification when they haven't been active in-game for a number of days. Each tracked user has their own channel and optional mentions; the alert fires once and re-arms when they become active again.",
    '',
    '- `tracking add userid:<id> channel:<#channel> [mentions] [inactivitydays]` — start tracking (default threshold 2 days)',
    '- `tracking remove userid:<id>` — stop tracking',
    '- `tracking list` — all tracked users with their last-active status',
  ].join('\n'),

  proxy: [
    '# /proxy tracking — citizenship movement watch',
    '',
    'Watches countries for players who move their citizenship away (proxies) and reports the movement, including the citizenship-change cooldown. Useful for spotting population manipulation.',
    '',
    '- `tracking toggle countryid:<id> channel:<#channel> [mentions] [enabled]` — watch/unwatch a country',
    '- `tracking add userid:<id> [originalcountryid]` — manually record a proxy (current country auto-detected)',
    '- `tracking remove userid:<id>` — forget a proxy',
    '- `tracking list` — all known proxies with cooldown and population info',
    '- `tracking status` — which countries are being watched',
  ].join('\n'),

  leaderboard: [
    '# /leaderboard — hourly damage leaderboards',
    '',
    'Maintains a living leaderboard message (edited in place every hour) showing player and military-unit damage rankings for the configured countries/MUs: all-time and weekly, with players split into level brackets. Weekly standings are also snapshotted to CSV at the end of each week.',
    '',
    '- `config set [mus] [topcount] [brackets] [channel]` — what to rank and where; `brackets` like `20-29,30-39,40+`',
    '- `config view` — current settings',
    '- `enable` / `disable` — pause or resume hourly updates',
    '- `refresh` — update the leaderboard now',
    '- `weekly get week:<YYYY-MM-DD>` — download the player + MU damage CSVs for a week',
    '- `weekly list` — which weekly snapshots exist',
  ].join('\n'),

  scanfor: [
    '# /scanfor — bulk scans of game data',
    '',
    'Sweeps large sets of countries or players and reports the matches. Country scans can be limited to a saved country group (see `/countrygroup`).',
    '',
    '- `country nogovernment [group]` — countries with missing/partial governments approaching inactivity',
    '- `country lowpop [max_citizens] [group]` — countries with active population below a threshold',
    '- `country ethics ethic:<label>` — countries whose ruling party matches an ethic',
    '- `country builds country:<name> [min_level]` — player build breakdown (war/soft war/hybrid/eco, where soft war is war + companies for income) with per-player detail buttons, pill/buff status, and skill-reset availability',
  ].join('\n'),

  countrygroup: [
    '# /countrygroup — saved country lists',
    '',
    'Named groups of countries used to filter `/scanfor country` scans (e.g. an "allies" group). Creating or adding opens a form to paste country names/ids.',
    '',
    '- `create name:<name>` — create a group (opens a form)',
    '- `add name:<name>` / `remove name:<name>` — edit membership',
    '- `view name:<name>` — show a group',
    '- `list` — all groups',
    '- `delete name:<name>` — remove a group',
  ].join('\n'),

  spectre: [
    '# /spectre — military monitoring',
    '',
    'Polls the map on the bot-wide interval and raises alerts in the configured channels:',
    '- **buildings** — bunker/base construction changes in foreign regions bordering the monitored country',
    '- **resistance** — regions at 90%+ resistance, or a >10% ratio swing between polls',
    '- **population** — population dropping past warn (one-time) and critical (repeating) thresholds',
    '',
    '**monitor** group: `buildings country:<name> [channel]`, `resistance country:<name> [channel]`, `population country:<name> [warnthreshold] [criticalthreshold] [channel] [mentions]`, `stop country:<name>` (stops all three).',
    '**snapshot** group: `buildings` / `resistance` / `population` — show the latest polled data without waiting for an alert.',
  ].join('\n'),

  mudirectory: [
    '# /mudirectory — military-unit directory',
    '',
    'Maintains a curated list of military units as a living set of messages in one channel: member counts, damage and activity scores, join links. Refreshed daily at 12:00 UTC and editable in place (no repost spam).',
    '',
    '- `config set mus:<ids or links> [channel] [role1..role5]` — which MUs, where, and which roles may manage (requires Manage Roles)',
    '- `config view` — current settings',
    '- `enable` / `disable` — daily updates on/off (requires Manage Roles)',
    '- `refresh` — update the directory now (admins, owner, or a configured manage role)',
  ].join('\n'),
};
