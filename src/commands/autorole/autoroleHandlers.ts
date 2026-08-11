import { ChatInputCommandInteraction, TextChannel } from 'discord.js';
import { AutoroleConfig } from '../../config/config';
import { ServerConfigManager } from '../../utils/serverConfigManager';
import { hasManageRoles, replyUnauthorized } from '../../utils/commandAuth';
import { DiscordService } from '../../services/discord/DiscordService';
import { AutoroleService } from '../../services/autorole';
import { analyzeUserBuild, SkillLevels, ECO_SKILLS, WAR_SKILLS } from '../../services/autorole/build';
import { buildLinkBlockComponents, LINK_BLOCK_CONTENT } from '../../services/autorole/reviewMessages';
import { AUTOROLE_GUIDE, AUTOROLE_TOPIC_HELP } from './autoroleHelp';
import { splitMessage } from '../../services/discord/messageChunker';

const ROLE_LIST_OPTIONS = ['role1', 'role2', 'role3', 'role4', 'role5'] as const;

function getConfig(interaction: ChatInputCommandInteraction): AutoroleConfig | undefined {
  return ServerConfigManager.getAutoroleConfig(interaction.guild!.id);
}

function formatRoles(roleIds: string[]): string {
  return roleIds.length ? roleIds.map(id => `<@&${id}>`).join(', ') : 'None';
}

/** Reply with content of any length, chunking into ephemeral follow-ups. */
async function replyChunked(interaction: ChatInputCommandInteraction, content: string): Promise<void> {
  const chunks = splitMessage(content);
  if (chunks.length === 0) {
    return;
  }
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content: chunks[0] });
  } else {
    await interaction.reply({ content: chunks[0], ephemeral: true });
  }
  for (const chunk of chunks.slice(1)) {
    await interaction.followUp({ content: chunk, ephemeral: true });
  }
}

// --- help ---

export async function handleHelp(interaction: ChatInputCommandInteraction): Promise<void> {
  const topic = interaction.options.getString('topic');
  const text = topic ? AUTOROLE_TOPIC_HELP[topic] : AUTOROLE_GUIDE;
  await replyChunked(interaction, text ?? AUTOROLE_GUIDE);
}

// --- levelrole ---

export async function handleLevelRole(interaction: ChatInputCommandInteraction): Promise<void> {
  const serverId = interaction.guild!.id;
  const sub = interaction.options.getSubcommand();
  const cfg = getConfig(interaction);

  if (sub === 'add') {
    const role = interaction.options.getRole('role', true);
    const minLevel = interaction.options.getInteger('min_level', true);
    const levelRoles = (cfg?.levelRoles ?? []).filter(e => e.roleId !== role.id);
    levelRoles.push({ roleId: role.id, minLevel });
    levelRoles.sort((a, b) => a.minLevel - b.minLevel);
    ServerConfigManager.updateAutoroleConfig(serverId, { levelRoles });
    await interaction.reply({ content: `<@&${role.id}> is now granted at level ${minLevel}+.`, ephemeral: true });
    return;
  }

  if (sub === 'remove') {
    const role = interaction.options.getRole('role', true);
    const levelRoles = (cfg?.levelRoles ?? []).filter(e => e.roleId !== role.id);
    if (levelRoles.length === (cfg?.levelRoles.length ?? 0)) {
      await interaction.reply({ content: 'That role is not a configured level role.', ephemeral: true });
      return;
    }
    ServerConfigManager.updateAutoroleConfig(serverId, { levelRoles });
    await interaction.reply({ content: `Removed <@&${role.id}> from the level roles.`, ephemeral: true });
    return;
  }

  const entries = cfg?.levelRoles ?? [];
  await interaction.reply({
    content: entries.length
      ? '**Level roles**\n' + entries.map(e => `- Level ${e.minLevel}+: <@&${e.roleId}>`).join('\n')
      : 'No level roles configured. Add one with `/autorole levelrole add`.',
    ephemeral: true,
  });
}

// --- timedrole ---

export async function handleTimedRole(interaction: ChatInputCommandInteraction): Promise<void> {
  const serverId = interaction.guild!.id;
  const sub = interaction.options.getSubcommand();
  const cfg = getConfig(interaction);

  if (sub === 'add') {
    const role = interaction.options.getRole('role', true);
    const days = interaction.options.getNumber('days', true);
    const timedRoles = (cfg?.timedRoles ?? []).filter(e => e.roleId !== role.id);
    timedRoles.push({ roleId: role.id, timeoutDays: days });
    ServerConfigManager.updateAutoroleConfig(serverId, { timedRoles });
    await interaction.reply({
      content: `<@&${role.id}> will be removed after ${days} day(s) of WarEra inactivity.`,
      ephemeral: true,
    });
    return;
  }

  if (sub === 'remove') {
    const role = interaction.options.getRole('role', true);
    const timedRoles = (cfg?.timedRoles ?? []).filter(e => e.roleId !== role.id);
    if (timedRoles.length === (cfg?.timedRoles.length ?? 0)) {
      await interaction.reply({ content: 'That role has no timed rule.', ephemeral: true });
      return;
    }
    ServerConfigManager.updateAutoroleConfig(serverId, { timedRoles });
    await interaction.reply({ content: `Removed the timed rule for <@&${role.id}>.`, ephemeral: true });
    return;
  }

  const entries = cfg?.timedRoles ?? [];
  await interaction.reply({
    content: entries.length
      ? '**Timed roles**\n' + entries.map(e => `- <@&${e.roleId}>: removed after ${e.timeoutDays} day(s) inactive`).join('\n')
      : 'No timed roles configured.',
    ephemeral: true,
  });
}

// --- buildrole ---

export async function handleBuildRole(interaction: ChatInputCommandInteraction): Promise<void> {
  const serverId = interaction.guild!.id;
  const sub = interaction.options.getSubcommand();
  const cfg = getConfig(interaction);

  if (sub === 'set') {
    const update: Partial<AutoroleConfig> = {};
    const eco = interaction.options.getRole('eco_role');
    const war = interaction.options.getRole('war_role');
    const hybrid = interaction.options.getRole('hybrid_role');
    const ecoThreshold = interaction.options.getNumber('eco_threshold');
    const warThreshold = interaction.options.getNumber('war_threshold');
    if (eco) update.ecoRoleId = eco.id;
    if (war) update.warRoleId = war.id;
    if (hybrid) update.hybridRoleId = hybrid.id;
    if (ecoThreshold !== null) update.ecoThreshold = ecoThreshold;
    if (warThreshold !== null) update.warThreshold = warThreshold;
    if (Object.keys(update).length === 0) {
      await interaction.reply({ content: 'Pass at least one option to change.', ephemeral: true });
      return;
    }
    ServerConfigManager.updateAutoroleConfig(serverId, update);
    await replyBuildRoleView(interaction, 'Build roles updated.\n\n');
    return;
  }

  if (sub === 'clear') {
    const which = interaction.options.getString('which', true);
    // updateAutoroleConfig treats undefined as "keep", so clear with ''
    // (everywhere else treats a blank role id as unset).
    ServerConfigManager.updateAutoroleConfig(serverId, {
      ecoRoleId: which === 'eco' || which === 'all' ? '' : cfg?.ecoRoleId,
      warRoleId: which === 'war' || which === 'all' ? '' : cfg?.warRoleId,
      hybridRoleId: which === 'hybrid' || which === 'all' ? '' : cfg?.hybridRoleId,
    });
    await replyBuildRoleView(interaction, `Cleared the ${which === 'all' ? 'build' : which} role(s).\n\n`);
    return;
  }

  await replyBuildRoleView(interaction, '');
}

async function replyBuildRoleView(interaction: ChatInputCommandInteraction, prefix: string): Promise<void> {
  const cfg = getConfig(interaction);
  const roleLine = (label: string, id?: string) => `**${label}:** ${id ? `<@&${id}>` : 'None'}`;
  await interaction.reply({
    content:
      prefix +
      '**Build roles**\n' +
      `${roleLine('Eco', cfg?.ecoRoleId)} (threshold ${cfg?.ecoThreshold ?? 60}%)\n` +
      `${roleLine('War', cfg?.warRoleId)} (threshold ${cfg?.warThreshold ?? 60}%)\n` +
      `${roleLine('Hybrid', cfg?.hybridRoleId)}\n\n` +
      `Eco skills: ${ECO_SKILLS.join(', ')}\n` +
      `War skills: ${WAR_SKILLS.join(', ')}`,
    ephemeral: true,
  });
}

// --- opsec ---

export async function handleOpsec(
  interaction: ChatInputCommandInteraction,
  service: AutoroleService
): Promise<void> {
  if (!hasManageRoles(interaction)) {
    await replyUnauthorized(interaction, 'You need the Manage Roles permission to manage the OPSEC role.');
    return;
  }
  const serverId = interaction.guild!.id;
  const sub = interaction.options.getSubcommand();
  const cfg = getConfig(interaction);

  if (sub === 'purge-unlinked') {
    if (!cfg?.opsecRoleId) {
      await interaction.reply({ content: 'No OPSEC role is configured. Set one with `/autorole config set opsec_role:`.', ephemeral: true });
      return;
    }
    if (!cfg.unlinkedRoleId) {
      await interaction.reply({ content: 'No unlinked role is configured, so there is nothing to purge.', ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    const { removed, scanned } = await service.purgeOpsecFromUnlinked(serverId);
    await interaction.editReply({
      content: `Removed the OPSEC role from ${removed} member(s) holding the unlinked role (scanned ${scanned}).`,
    });
    return;
  }

  await interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
}

// --- country ---

export async function handleCountry(interaction: ChatInputCommandInteraction): Promise<void> {
  const serverId = interaction.guild!.id;
  const sub = interaction.options.getSubcommand();
  const cfg = getConfig(interaction);
  const current = cfg?.allowedCountryIds ?? [];

  if (sub === 'add') {
    const id = interaction.options.getString('id', true).trim();
    if (current.includes(id)) {
      await interaction.reply({ content: 'That country is already allowed.', ephemeral: true });
      return;
    }
    ServerConfigManager.updateAutoroleConfig(serverId, { allowedCountryIds: [...current, id] });
    await interaction.reply({ content: `Citizens of country \`${id}\` may now link without review.`, ephemeral: true });
    return;
  }

  if (sub === 'remove') {
    const id = interaction.options.getString('id', true).trim();
    if (!current.includes(id)) {
      await interaction.reply({ content: 'That country is not in the allowed list.', ephemeral: true });
      return;
    }
    ServerConfigManager.updateAutoroleConfig(serverId, {
      allowedCountryIds: current.filter(c => c !== id),
    });
    await interaction.reply({ content: `Removed country \`${id}\` from the allowed list.`, ephemeral: true });
    return;
  }

  await interaction.reply({
    content: current.length
      ? '**Allowed countries**\n' + current.map(id => `- \`${id}\``).join('\n')
      : 'No allowed countries configured — every link request goes to staff review.',
    ephemeral: true,
  });
}

// --- links ---

export async function handleLinks(
  interaction: ChatInputCommandInteraction,
  service: AutoroleService
): Promise<void> {
  const serverId = interaction.guild!.id;
  const sub = interaction.options.getSubcommand();
  const store = service.getStore();

  if (sub === 'list') {
    await interaction.deferReply({ ephemeral: true });
    const links = await store.listLinks(serverId);
    if (links.length === 0) {
      await interaction.editReply({ content: 'No members are linked on this server.' });
      return;
    }
    const lines = links.map(l => `- <@${l.discordUserId}> → \`${l.wareraUserId}\``);
    await replyChunked(interaction, `**Linked members (${links.length})**\n${lines.join('\n')}`);
    return;
  }

  if (sub === 'full') {
    await interaction.deferReply({ ephemeral: true });
    const links = await store.listLinks(serverId);
    if (links.length === 0) {
      await interaction.editReply({ content: 'No members are linked on this server.' });
      return;
    }
    const users = await service.getApi().getUsersLiteByIds(links.map(l => l.wareraUserId));
    const lines = links.map(l => {
      const user = users.get(l.wareraUserId);
      if (!user) {
        return `- <@${l.discordUserId}> → \`${l.wareraUserId}\` (profile unavailable)`;
      }
      const build = analyzeUserBuild((user.skills ?? {}) as SkillLevels);
      return (
        `- <@${l.discordUserId}> → **${user.username}** — level ${user.leveling?.level ?? '?'}, ` +
        `country \`${user.country ?? '?'}\`, eco ${build.ecoPct.toFixed(0)}% / war ${build.warPct.toFixed(0)}% — ` +
        `<https://app.warera.io/user/${user._id}>`
      );
    });
    await replyChunked(interaction, `**Linked members (${links.length})**\n${lines.join('\n')}`);
    return;
  }

  if (sub === 'pending') {
    await interaction.deferReply({ ephemeral: true });
    const pending = await store.listPendingLinks(serverId);
    if (pending.length === 0) {
      await interaction.editReply({ content: 'No link requests are awaiting review.' });
      return;
    }
    const lines = pending.map(
      p =>
        `- <@${p.discordUserId}> → **${p.wareraUsername}** (\`${p.wareraUserId}\`), country \`${p.countryId ?? '?'}\`, requested <t:${Math.floor(p.createdAt.getTime() / 1000)}:R>`
    );
    await replyChunked(interaction, `**Pending link requests (${pending.length})**\n${lines.join('\n')}`);
    return;
  }

  const target = interaction.options.getUser('user', true);

  if (sub === 'unlink') {
    await interaction.deferReply({ ephemeral: true });
    const result = await service.getLinkFlow().unlink(serverId, target.id);
    if (result.removedLink) {
      await service.onUnlinked(serverId, target.id);
    }
    await interaction.editReply({
      content:
        result.removedLink || result.removedPending || result.removedVerification
          ? `Removed link state for <@${target.id}>.`
          : `<@${target.id}> has nothing linked or pending.`,
    });
    return;
  }

  if (sub === 'approve') {
    await interaction.deferReply({ ephemeral: true });
    const result = await service.getLinkFlow().approvePendingLink(serverId, target.id, interaction.user.tag);
    await interaction.editReply({ content: describeReviewOutcome(result.status, target.id) });
    return;
  }

  if (sub === 'deny') {
    await interaction.deferReply({ ephemeral: true });
    const reason = interaction.options.getString('reason') ?? undefined;
    const result = await service.getLinkFlow().denyPendingLink(serverId, target.id, interaction.user.tag, reason);
    await interaction.editReply({ content: describeReviewOutcome(result.status, target.id) });
    return;
  }
}

function describeReviewOutcome(status: string, discordUserId: string): string {
  switch (status) {
    case 'no-pending':
      return `<@${discordUserId}> has no pending link request.`;
    case 'already-linked-other':
      return 'That WarEra account is already linked to a different member — request not approved.';
    case 'approved':
      return `Approved — <@${discordUserId}> has been DMed a verification code and must rename a company to finish linking.`;
    case 'denied':
      return `Denied the request from <@${discordUserId}>.`;
    case 'not-found':
      return `Could not fetch the WarEra profile for <@${discordUserId}>'s request — they have been notified to contact staff.`;
    default:
      return 'Done.';
  }
}

// --- config ---

export async function handleConfig(
  interaction: ChatInputCommandInteraction,
  discordService: DiscordService
): Promise<void> {
  const serverId = interaction.guild!.id;
  const sub = interaction.options.getSubcommand();

  if (sub === 'view') {
    const cfg = getConfig(interaction);
    if (!cfg) {
      await interaction.reply({
        content: 'Autorole is not configured yet. Any `/autorole` change creates the config.',
        ephemeral: true,
      });
      return;
    }
    const lastSync = cfg.lastSyncAt ? `<t:${Math.floor(new Date(cfg.lastSyncAt).getTime() / 1000)}:R>` : 'Never';
    const muRoleCount = ServerConfigManager.getMilitaryUnits(serverId).filter(u => u.roleId).length;
    await replyChunked(
      interaction,
      '**Autorole configuration**\n' +
        `**Enabled:** ${cfg.enabled !== false ? 'Yes' : 'No'}\n` +
        `**Sync interval:** ${cfg.checkIntervalSeconds}s (last sync: ${lastSync})\n` +
        `**Review channel:** ${cfg.reviewChannelId ? `<#${cfg.reviewChannelId}>` : 'None'}\n` +
        `**Skip company verification:** ${cfg.skipCompanyVerification ? 'Yes' : 'No'}\n` +
        `**Sync nicknames:** ${cfg.syncNicknames !== false ? 'Yes' : 'No'}\n` +
        `**Staff roles:** ${formatRoles(cfg.manageRoleIds)}\n` +
        `**Staff users:** ${cfg.manageUserIds.length ? cfg.manageUserIds.map(id => `<@${id}>`).join(', ') : 'None'}\n` +
        `**Proxy roles:** ${formatRoles(cfg.proxyRoleIds)}\n` +
        `**Protected roles:** ${formatRoles(cfg.protectedRoleIds)}\n` +
        `**Allowed countries:** ${cfg.allowedCountryIds.map(id => `\`${id}\``).join(', ') || 'None'}\n` +
        `**Level roles:** ${cfg.levelRoles.length}\n` +
        `**Timed roles:** ${cfg.timedRoles.length}\n` +
        `**MU roles:** ${muRoleCount} (manage with \`/mu\`)\n` +
        `**Build roles:** eco ${cfg.ecoRoleId ? `<@&${cfg.ecoRoleId}>` : 'None'} (${cfg.ecoThreshold}%), war ${cfg.warRoleId ? `<@&${cfg.warRoleId}>` : 'None'} (${cfg.warThreshold}%), hybrid ${cfg.hybridRoleId ? `<@&${cfg.hybridRoleId}>` : 'None'}\n` +
        `**Linked role:** ${cfg.linkedRoleId ? `<@&${cfg.linkedRoleId}>` : 'None'}\n` +
        `**Unlinked role:** ${cfg.unlinkedRoleId ? `<@&${cfg.unlinkedRoleId}>` : 'None'}\n` +
        `**OPSEC role:** ${cfg.opsecRoleId ? `<@&${cfg.opsecRoleId}>` : 'None'} (granted at level ${cfg.opsecMinLevel}, revoked after ${cfg.opsecInactivityDays}d inactive, auto-apply ${cfg.opsecAutoApply === false ? 'off' : 'on'})\n` +
        `**OPSEC exception role:** ${cfg.opsecExceptionRoleId ? `<@&${cfg.opsecExceptionRoleId}>` : 'None'}\n` +
        `**Link messages:** ${cfg.linkMessages.map(m => `<#${m.channelId}>`).join(', ') || 'None'}`
    );
    return;
  }

  // Every other config subcommand changes privileges or global behavior.
  if (!hasManageRoles(interaction)) {
    await replyUnauthorized(interaction, 'You need the Manage Roles permission to change autorole configuration.');
    return;
  }

  if (sub === 'set') {
    const update: Partial<AutoroleConfig> = {};
    const reviewChannel = interaction.options.getChannel('review_channel');
    const skipVerification = interaction.options.getBoolean('skip_verification');
    const intervalSeconds = interaction.options.getInteger('interval_seconds');
    const enabled = interaction.options.getBoolean('enabled');
    const syncNicknames = interaction.options.getBoolean('sync_nicknames');
    const unlinkedRole = interaction.options.getRole('unlinked_role');
    const clearUnlinkedRole = interaction.options.getBoolean('clear_unlinked_role');
    const linkedRole = interaction.options.getRole('linked_role');
    const clearLinkedRole = interaction.options.getBoolean('clear_linked_role');
    const opsecRole = interaction.options.getRole('opsec_role');
    const clearOpsecRole = interaction.options.getBoolean('clear_opsec_role');
    const opsecExceptionRole = interaction.options.getRole('opsec_exception_role');
    const clearOpsecExceptionRole = interaction.options.getBoolean('clear_opsec_exception_role');
    const opsecMinLevel = interaction.options.getInteger('opsec_min_level');
    const opsecInactivityDays = interaction.options.getNumber('opsec_inactivity_days');
    const opsecAutoApply = interaction.options.getBoolean('opsec_auto_apply');
    if (reviewChannel) update.reviewChannelId = reviewChannel.id;
    if (skipVerification !== null) update.skipCompanyVerification = skipVerification;
    if (intervalSeconds !== null) update.checkIntervalSeconds = intervalSeconds;
    if (enabled !== null) update.enabled = enabled;
    if (syncNicknames !== null) update.syncNicknames = syncNicknames;
    if (clearUnlinkedRole) {
      update.unlinkedRoleId = '';
    } else if (unlinkedRole) {
      update.unlinkedRoleId = unlinkedRole.id;
      // Re-run the one-time backfill for the newly chosen role.
      update.unlinkedBackfillAt = '';
    }
    if (clearLinkedRole) {
      update.linkedRoleId = '';
    } else if (linkedRole) {
      update.linkedRoleId = linkedRole.id;
    }
    if (clearOpsecRole) {
      update.opsecRoleId = '';
    } else if (opsecRole) {
      update.opsecRoleId = opsecRole.id;
    }
    if (clearOpsecExceptionRole) {
      update.opsecExceptionRoleId = '';
    } else if (opsecExceptionRole) {
      update.opsecExceptionRoleId = opsecExceptionRole.id;
    }
    if (opsecMinLevel !== null) update.opsecMinLevel = opsecMinLevel;
    if (opsecInactivityDays !== null) update.opsecInactivityDays = opsecInactivityDays;
    if (opsecAutoApply !== null) update.opsecAutoApply = opsecAutoApply;
    if (Object.keys(update).length === 0) {
      await interaction.reply({ content: 'Pass at least one option to change.', ephemeral: true });
      return;
    }
    ServerConfigManager.updateAutoroleConfig(serverId, update);
    if (reviewChannel) {
      await discordService.initializeServerChannel(serverId, reviewChannel.id);
    }
    await interaction.reply({ content: 'Autorole configuration updated. Use `/autorole config view` to inspect it.', ephemeral: true });
    return;
  }

  if (sub === 'staffusers') {
    const raw = interaction.options.getString('users') ?? '';
    const manageUserIds = [...new Set(raw.match(/\d{5,}/g) ?? [])];
    ServerConfigManager.updateAutoroleConfig(serverId, { manageUserIds });
    await interaction.reply({
      content: manageUserIds.length
        ? `Staff users set: ${manageUserIds.map(id => `<@${id}>`).join(', ')}`
        : 'Staff user list cleared.',
      ephemeral: true,
    });
    return;
  }

  const roleIds: string[] = [];
  for (const name of ROLE_LIST_OPTIONS) {
    const role = interaction.options.getRole(name);
    if (role && !roleIds.includes(role.id)) {
      roleIds.push(role.id);
    }
  }
  const field =
    sub === 'staffroles' ? 'manageRoleIds' : sub === 'proxyroles' ? 'proxyRoleIds' : 'protectedRoleIds';
  ServerConfigManager.updateAutoroleConfig(serverId, { [field]: roleIds });
  await interaction.reply({
    content: roleIds.length ? `${sub} set: ${formatRoles(roleIds)}` : `${sub} cleared.`,
    ephemeral: true,
  });
}

// --- sync ---

export async function handleSync(
  interaction: ChatInputCommandInteraction,
  service: AutoroleService
): Promise<void> {
  const serverId = interaction.guild!.id;
  const sub = interaction.options.getSubcommand();

  if (sub === 'now') {
    const target = interaction.options.getUser('user');
    await interaction.deferReply({ ephemeral: true });
    if (target) {
      const outcome = await service.syncMember(serverId, target.id);
      await interaction.editReply({
        content: outcome.synced
          ? `Synced <@${target.id}>.`
          : `Could not sync <@${target.id}>: ${outcome.reason === 'not-linked' ? 'they are not linked' : outcome.reason === 'member-left' ? 'they are not in this server' : 'their WarEra profile could not be fetched'}.`,
      });
      return;
    }
    const { synced, skipped } = await service.syncServer(serverId);
    ServerConfigManager.updateAutoroleConfig(serverId, { lastSyncAt: new Date().toISOString() });
    await interaction.editReply({ content: `Sync complete: ${synced} member(s) synced, ${skipped} skipped.` });
    return;
  }

  // status
  await interaction.deferReply({ ephemeral: true });
  const cfg = getConfig(interaction);
  const store = service.getStore();
  const [links, pending] = await Promise.all([store.listLinks(serverId), store.listPendingLinks(serverId)]);
  const lastSync = cfg?.lastSyncAt ? `<t:${Math.floor(new Date(cfg.lastSyncAt).getTime() / 1000)}:R>` : 'Never';
  await interaction.editReply({
    content:
      '**Autorole status**\n' +
      `**Enabled:** ${cfg?.enabled !== false ? 'Yes' : 'No'}\n` +
      `**Linked members:** ${links.length}\n` +
      `**Pending reviews:** ${pending.length}\n` +
      `**Sync interval:** ${cfg?.checkIntervalSeconds ?? 3600}s\n` +
      `**Last sync:** ${lastSync}\n` +
      `**Level roles:** ${cfg?.levelRoles.length ?? 0} · **Timed roles:** ${cfg?.timedRoles.length ?? 0} · **MU roles:** ${ServerConfigManager.getMilitaryUnits(serverId).filter(u => u.roleId).length}`,
  });
}

// --- linkmessage ---

export async function handleLinkMessage(
  interaction: ChatInputCommandInteraction,
  discordService: DiscordService
): Promise<void> {
  const serverId = interaction.guild!.id;
  const sub = interaction.options.getSubcommand();
  const cfg = getConfig(interaction);
  const channelId =
    interaction.options.getChannel('channel')?.id ??
    (interaction.channel?.isTextBased() ? interaction.channelId : undefined);

  if (!channelId) {
    await interaction.reply({ content: 'Specify a **channel**, or run this from a text channel.', ephemeral: true });
    return;
  }

  if (sub === 'post') {
    await interaction.deferReply({ ephemeral: true });
    const messageId = await discordService.sendToChannelWithComponents(
      channelId,
      LINK_BLOCK_CONTENT,
      buildLinkBlockComponents()
    );
    if (!messageId) {
      await interaction.editReply({ content: `Could not post in <#${channelId}> — check my permissions there.` });
      return;
    }
    const linkMessages = (cfg?.linkMessages ?? []).filter(m => m.channelId !== channelId);
    linkMessages.push({ channelId, messageId });
    ServerConfigManager.updateAutoroleConfig(serverId, { linkMessages });
    await interaction.editReply({ content: `Posted a link button in <#${channelId}>.` });
    return;
  }

  // remove
  const entry = cfg?.linkMessages.find(m => m.channelId === channelId);
  if (!entry) {
    await interaction.reply({ content: `No link message is recorded for <#${channelId}>.`, ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
  if (channel?.isTextBased()) {
    await (channel as TextChannel).messages
      .fetch(entry.messageId)
      .then(m => m.delete())
      .catch(() => undefined);
  }
  ServerConfigManager.updateAutoroleConfig(serverId, {
    linkMessages: (cfg?.linkMessages ?? []).filter(m => m.channelId !== channelId),
  });
  await interaction.editReply({ content: `Removed the link message for <#${channelId}>.` });
}
