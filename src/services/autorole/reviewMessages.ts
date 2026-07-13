import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

/**
 * CustomId scheme for all autorole components. Everything is prefixed
 * `autorole:` so CommandHandler can route by prefix, and each id carries the
 * state its handler needs, so buttons keep working across restarts.
 */
export const AUTOROLE_CUSTOM_ID_PREFIX = 'autorole:';

export const LINK_START_ID = 'autorole:linkstart';
export const LINK_MODAL_ID = 'autorole:linkmodal';
export const LINK_MODAL_ACCOUNT_FIELD = 'account';

export function verifyDmId(serverId: string): string {
  return `autorole:verifydm:${serverId}`;
}

export function cancelVerifyId(serverId: string): string {
  return `autorole:cancelverify:${serverId}`;
}

export function approveId(discordUserId: string): string {
  return `autorole:approve:${discordUserId}`;
}

export function denyId(discordUserId: string): string {
  return `autorole:deny:${discordUserId}`;
}

export interface ParsedAutoroleCustomId {
  action: 'linkstart' | 'linkmodal' | 'verifydm' | 'cancelverify' | 'approve' | 'deny';
  /** serverId for DM buttons, discordUserId for review buttons. */
  arg?: string;
}

export function parseAutoroleCustomId(customId: string): ParsedAutoroleCustomId | null {
  if (!customId.startsWith(AUTOROLE_CUSTOM_ID_PREFIX)) {
    return null;
  }
  const [, action, arg] = customId.split(':');
  switch (action) {
    case 'linkstart':
    case 'linkmodal':
      return { action };
    case 'verifydm':
    case 'cancelverify':
    case 'approve':
    case 'deny':
      return arg ? { action, arg } : null;
    default:
      return null;
  }
}

export const NO_MU_DM_MESSAGE =
  "Hey, it looks like you're not in one of our official MUs. Please look in #mu-directory in the main South African WarEra discord server, and pick any available MU to join.";

export const LINK_BLOCK_CONTENT =
  '**WarEra Linking**\nClick the button below to link your WarEra account to Discord.';

export function buildLinkBlockComponents(): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(LINK_START_ID).setLabel('Link WarEra').setStyle(ButtonStyle.Primary)
    ),
  ];
}

export function buildVerificationDmContent(code: string, expiresAt: Date): string {
  const ts = Math.floor(expiresAt.getTime() / 1000);
  return [
    `Your WarEra verification code is: **${code}**`,
    '',
    'To prove you own this account, rename one of your WarEra companies to exactly this code, then press the button below.',
    `This code expires <t:${ts}:R>.`,
  ].join('\n');
}

export function buildVerificationDmComponents(serverId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(verifyDmId(serverId))
        .setLabel("I've renamed my company")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(cancelVerifyId(serverId)).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
    ),
  ];
}

export function buildReviewRequestContent(params: {
  discordUserId: string;
  wareraUsername: string;
  wareraUserId: string;
  countryId?: string;
}): string {
  return [
    '**WarEra link request**',
    `Discord: <@${params.discordUserId}>`,
    `WarEra: **${params.wareraUsername}** (\`https://app.warera.io/user/${params.wareraUserId}\`)`,
    `Country: \`${params.countryId ?? 'unknown'}\` (not in the allowed list)`,
    '',
    'Approve to link this account, or deny to reject the request.',
  ].join('\n');
}

export function buildReviewComponents(discordUserId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(approveId(discordUserId)).setLabel('Approve').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(denyId(discordUserId)).setLabel('Deny').setStyle(ButtonStyle.Danger)
    ),
  ];
}
