import {
  ChatInputCommandInteraction,
  GuildMemberRoleManager,
  PermissionFlagsBits,
} from 'discord.js';

/**
 * Reusable per-server command authorization. A member may manage a feature if they
 * are a guild Administrator, the guild owner, or hold one of the feature's
 * configured `allowedRoleIds`. Intended for commands built with
 * `requireAdmin: false` (visible to everyone) that gate mutations at runtime.
 */

/** Role ids held by the interacting member, tolerating cached and raw members. */
export function getMemberRoleIds(interaction: ChatInputCommandInteraction): string[] {
  const roles = interaction.member?.roles;
  if (!roles) {
    return [];
  }
  if (roles instanceof GuildMemberRoleManager) {
    return [...roles.cache.keys()];
  }
  // APIInteractionGuildMember: roles is a string[] of role ids.
  return Array.isArray(roles) ? roles : [];
}

export function isGuildAdmin(interaction: ChatInputCommandInteraction): boolean {
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
}

export function isGuildOwner(interaction: ChatInputCommandInteraction): boolean {
  return !!interaction.guild && interaction.guild.ownerId === interaction.user.id;
}

/**
 * @returns true if the member may manage the feature: Administrator, guild owner,
 * or holder of any `allowedRoleIds`.
 */
export function canManageFeature(
  interaction: ChatInputCommandInteraction,
  allowedRoleIds: string[]
): boolean {
  if (isGuildAdmin(interaction) || isGuildOwner(interaction)) {
    return true;
  }
  if (allowedRoleIds.length === 0) {
    return false;
  }
  const memberRoles = new Set(getMemberRoleIds(interaction));
  return allowedRoleIds.some(roleId => memberRoles.has(roleId));
}

/** Reply (ephemerally) that the member lacks permission. Safe to await once. */
export async function replyUnauthorized(
  interaction: ChatInputCommandInteraction,
  message = 'You do not have permission to manage this. Ask an admin, or a holder of an allowed role.'
): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content: message });
  } else {
    await interaction.reply({ content: message, ephemeral: true });
  }
}
