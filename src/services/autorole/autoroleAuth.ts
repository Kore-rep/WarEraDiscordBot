import { GuildMemberRoleManager, PermissionFlagsBits } from 'discord.js';
import { AutoroleConfig } from '../../config/config';
import { isOwnerOverride } from '../../utils/commandAuth';

/**
 * The structural slice of an interaction the checks need, so the same helper
 * works for both slash commands and the review Approve/Deny buttons.
 */
export interface AutoroleInteractionLike {
  user: { id: string };
  guild: { ownerId: string } | null;
  member: { roles: GuildMemberRoleManager | string[] } | null;
  memberPermissions: { has(permission: bigint): boolean } | null;
}

function memberRoleIds(interaction: AutoroleInteractionLike): string[] {
  const roles = interaction.member?.roles;
  if (!roles) {
    return [];
  }
  if (roles instanceof GuildMemberRoleManager) {
    return [...roles.cache.keys()];
  }
  return Array.isArray(roles) ? roles : [];
}

/**
 * Whether the member may act on autorole link reviews: guild Administrator,
 * guild owner, a configured manage role, or a configured manage user.
 */
export function canManageAutorole(
  interaction: AutoroleInteractionLike,
  config: Pick<AutoroleConfig, 'manageRoleIds' | 'manageUserIds'> | undefined
): boolean {
  if (isOwnerOverride(interaction.user.id)) {
    return true;
  }
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return true;
  }
  if (interaction.guild && interaction.guild.ownerId === interaction.user.id) {
    return true;
  }
  if (!config) {
    return false;
  }
  if (config.manageUserIds.includes(interaction.user.id)) {
    return true;
  }
  const held = new Set(memberRoleIds(interaction));
  return config.manageRoleIds.some(roleId => held.has(roleId));
}
