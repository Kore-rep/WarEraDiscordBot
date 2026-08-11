/**
 * One-time migration: import the Python "Autorole" bot's data.json into SQLite.
 *
 *   - guilds.<id> config fields -> Server.autorole JSON block
 *   - guilds.<id>.linked_users + mu_notice_sent -> LinkedUser rows
 *   - guilds.<id>.pending_links -> PendingLink rows (review buttons can't be revived)
 *
 * Dropped on purpose: pending_verifications (15-minute TTL, always stale),
 * bot_channel_ids (obsolete under slash commands), verification_channel_id
 * (was configurable but never read), linkblock_messages (buttons belong to the
 * old bot application — repost with /autorole linkmessage post).
 *
 * Safe to re-run: rows are upserted.
 *   npm run db:import-autorole -- /path/to/data.json              # local (ts-node)
 *   node dist/scripts/importAutoroleJson.js config/autorole-import.json  # inside the docker image
 */
import * as fs from 'fs';
import { prisma } from '../persistence/prisma';
import type { AutoroleConfig, MilitaryUnitEntry } from '../config/config';

// The Python bot hard-coded this role id as never-auto-removed.
const LEGACY_PROTECTED_ROLE_ID = '1442875774829985895';

/**
 * The Python bot stores Discord ids as bare JSON integers, which exceed
 * Number.MAX_SAFE_INTEGER and would silently lose precision in JSON.parse.
 * Quote every long integer literal (in value position) so they parse as strings.
 */
function quoteBigInts(jsonText: string): string {
  return jsonText.replace(/([:[,]\s*)(\d{15,})(?=\s*[,\]}])/g, '$1"$2"');
}

interface LegacyGuildData {
  check_interval?: number;
  level_roles?: { role_id: number | string; min_level: number }[];
  timed_roles?: { role_id: number | string; timeout_days: number }[];
  mu_roles?: { mu_id: string; mu_name?: string; role_id: number | string }[];
  linked_users?: Record<string, { warera_user_id: string }>;
  pending_links?: Record<string, { warera_user_id: string; warera_username?: string; country_id?: string | null }>;
  mu_notice_sent?: Record<string, number>;
  staff_role_ids?: (number | string)[];
  staff_user_ids?: (number | string)[];
  proxy_role_ids?: (number | string)[];
  allowed_country_ids?: string[];
  review_channel_id?: number | string | null;
  skip_company_verification?: boolean;
  eco_role_id?: number | string | null;
  war_role_id?: number | string | null;
  hybrid_role_id?: number | string | null;
  eco_threshold?: number;
  war_threshold?: number;
}

/** Python stores Discord ids as a mix of ints and strings; normalize to strings. */
function asId(value: number | string | null | undefined): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const str = String(value).trim();
  return str.length > 0 ? str : undefined;
}

function asIdList(values: (number | string)[] | undefined): string[] {
  return (values ?? []).map(asId).filter((id): id is string => !!id);
}

function buildAutoroleConfig(guild: LegacyGuildData): AutoroleConfig {
  const roleLists = [
    ...asIdList(guild.staff_role_ids),
    ...asIdList(guild.proxy_role_ids),
    ...(guild.level_roles ?? []).map(e => asId(e.role_id)),
    ...(guild.timed_roles ?? []).map(e => asId(e.role_id)),
    ...(guild.mu_roles ?? []).map(e => asId(e.role_id)),
    asId(guild.eco_role_id),
    asId(guild.war_role_id),
    asId(guild.hybrid_role_id),
  ];
  const usesLegacyProtectedRole = roleLists.includes(LEGACY_PROTECTED_ROLE_ID);

  return {
    enabled: true,
    checkIntervalSeconds: Math.max(60, guild.check_interval ?? 3600),
    levelRoles: (guild.level_roles ?? [])
      .map(e => ({ roleId: asId(e.role_id) ?? '', minLevel: e.min_level }))
      .filter(e => e.roleId)
      .sort((a, b) => a.minLevel - b.minLevel),
    timedRoles: (guild.timed_roles ?? [])
      .map(e => ({ roleId: asId(e.role_id) ?? '', timeoutDays: e.timeout_days }))
      .filter(e => e.roleId),
    ecoRoleId: asId(guild.eco_role_id),
    warRoleId: asId(guild.war_role_id),
    hybridRoleId: asId(guild.hybrid_role_id),
    ecoThreshold: guild.eco_threshold ?? 60,
    warThreshold: guild.war_threshold ?? 60,
    opsecMinLevel: 15,
    opsecInactivityDays: 2,
    manageRoleIds: asIdList(guild.staff_role_ids),
    manageUserIds: asIdList(guild.staff_user_ids),
    proxyRoleIds: asIdList(guild.proxy_role_ids),
    protectedRoleIds: usesLegacyProtectedRole ? [LEGACY_PROTECTED_ROLE_ID] : [],
    allowedCountryIds: (guild.allowed_country_ids ?? []).filter(id => id && id.trim().length > 0),
    reviewChannelId: asId(guild.review_channel_id),
    skipCompanyVerification: guild.skip_company_verification ?? false,
    linkMessages: [],
    syncNicknames: true,
  };
}

/** The Python bot's mu_roles become the shared military-unit list (with role mappings). */
function buildMilitaryUnits(guild: LegacyGuildData): MilitaryUnitEntry[] {
  return (guild.mu_roles ?? [])
    .filter(e => e.mu_id && asId(e.role_id))
    .map(e => ({ muId: e.mu_id, muName: e.mu_name ?? e.mu_id, roleId: asId(e.role_id) as string }));
}

async function importGuild(serverId: string, guild: LegacyGuildData): Promise<void> {
  const autorole = JSON.stringify(buildAutoroleConfig(guild));
  const units = buildMilitaryUnits(guild);
  const militaryUnits = units.length ? JSON.stringify(units) : null;
  await prisma.server.upsert({
    where: { id: serverId },
    create: { id: serverId, autorole, militaryUnits },
    update: { autorole, militaryUnits },
  });

  let links = 0;
  for (const [discordUserId, entry] of Object.entries(guild.linked_users ?? {})) {
    const wareraUserId = entry?.warera_user_id;
    if (!wareraUserId) {
      continue;
    }
    const noticeTs = guild.mu_notice_sent?.[discordUserId];
    const muNoticeSentAt = noticeTs ? new Date(noticeTs * 1000) : null;
    await prisma.linkedUser.upsert({
      where: { serverId_discordUserId: { serverId, discordUserId } },
      create: { serverId, discordUserId, wareraUserId, muNoticeSentAt },
      update: { wareraUserId, muNoticeSentAt },
    });
    links++;
  }

  let pendings = 0;
  for (const [discordUserId, entry] of Object.entries(guild.pending_links ?? {})) {
    if (!entry?.warera_user_id) {
      continue;
    }
    const data = {
      wareraUserId: entry.warera_user_id,
      wareraUsername: entry.warera_username ?? entry.warera_user_id,
      countryId: entry.country_id ?? null,
    };
    await prisma.pendingLink.upsert({
      where: { serverId_discordUserId: { serverId, discordUserId } },
      create: { serverId, discordUserId, ...data },
      update: data,
    });
    pendings++;
  }

  const dropped: string[] = [];
  if (Object.keys((guild as Record<string, unknown>).linkblock_messages ?? {}).length > 0) {
    dropped.push('linkblock_messages (repost with /autorole linkmessage post)');
  }
  if (Object.keys((guild as Record<string, unknown>).pending_verifications ?? {}).length > 0) {
    dropped.push('pending_verifications (expired; users restart with /link start)');
  }

  console.log(
    `Guild ${serverId}: imported config, ${links} link(s), ${pendings} pending link(s).` +
      (dropped.length ? ` Dropped: ${dropped.join('; ')}.` : '')
  );
}

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: npm run db:import-autorole -- /path/to/data.json');
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error(`File not found: ${file}`);
    process.exit(1);
  }

  const parsed = JSON.parse(quoteBigInts(fs.readFileSync(file, 'utf-8'))) as {
    guilds?: Record<string, LegacyGuildData>;
  };
  const guilds = Object.entries(parsed.guilds ?? {});
  if (guilds.length === 0) {
    console.log('No guilds found in the data file; nothing to import.');
  }
  for (const [serverId, guild] of guilds) {
    await importGuild(serverId, guild);
  }
  await prisma.$disconnect();
  console.log('Autorole import complete.');
}

main().catch(async error => {
  console.error('Autorole import failed:', error);
  await prisma.$disconnect();
  process.exit(1);
});
