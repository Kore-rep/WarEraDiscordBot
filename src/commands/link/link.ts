import { ChatInputCommandInteraction } from 'discord.js';
import { Command, createCommandBuilder } from '../types';
import { logger } from '../../utils/logger';
import { getMemberRoleIds } from '../../utils/commandAuth';
import { DiscordService } from '../../services/discord/DiscordService';
import { ApiService } from '../../services/api/ApiService';
import { AutoroleService } from '../../services/autorole';
import { LinkResult, VerifyResult } from '../../services/autorole/linkFlow';
import { parseUserInput } from '../../services/autorole/parseUserInput';
import { LINK_HELP } from '../autorole/autoroleHelp';

export const linkCommand: Command = {
  data: createCommandBuilder('link', 'Link your WarEra account to Discord', { requireAdmin: false })
    .addSubcommand(sub =>
      sub
        .setName('start')
        .setDescription('Link your WarEra account')
        .addStringOption(opt =>
          opt
            .setName('account')
            .setDescription('Your WarEra username, user id, or profile URL')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('verify').setDescription("Check your company rename (if the DM button doesn't work)")
    )
    .addSubcommand(sub =>
      sub.setName('unlink').setDescription('Remove your WarEra link or cancel a pending request')
    )
    .addSubcommand(sub => sub.setName('whoami').setDescription('Show your current link status'))
    .addSubcommand(sub =>
      sub
        .setName('whois')
        .setDescription('Look up who a Discord member or WarEra account is linked to')
        .addUserOption(opt =>
          opt.setName('user').setDescription('Discord member to look up').setRequired(false)
        )
        .addStringOption(opt =>
          opt
            .setName('account')
            .setDescription('WarEra username, user id, or profile URL to look up')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub.setName('help').setDescription('How linking works and what each subcommand does')
    ),

  async execute(
    interaction: ChatInputCommandInteraction,
    _discordService?: DiscordService,
    apiService?: ApiService
  ): Promise<void> {
    try {
      if (!interaction.guild) {
        await interaction.reply({ content: 'This command can only be used in a Discord server.', ephemeral: true });
        return;
      }
      const service = apiService?.getAutoroleService();
      if (!service) {
        await interaction.reply({ content: 'The linking service is not available.', ephemeral: true });
        return;
      }

      const subcommand = interaction.options.getSubcommand();
      if (subcommand === 'start') {
        await handleStart(interaction, service);
      } else if (subcommand === 'verify') {
        await handleVerify(interaction, service);
      } else if (subcommand === 'unlink') {
        await handleUnlink(interaction, service);
      } else if (subcommand === 'whoami') {
        await handleWhoami(interaction, service);
      } else if (subcommand === 'whois') {
        await handleWhois(interaction, service);
      } else if (subcommand === 'help') {
        await interaction.reply({ content: LINK_HELP, ephemeral: true });
      } else {
        await interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
      }
    } catch (error) {
      logger.error('Error in link command', error);
      const content = 'An error occurred while processing the command.';
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content, ephemeral: true });
      } else {
        await interaction.reply({ content, ephemeral: true });
      }
    }
  },
};

/** Shared by /link start and the link-button modal. */
export function describeBeginLinkResult(result: LinkResult): string {
  switch (result.status) {
    case 'invalid-input':
      return 'That does not look like a WarEra username, id, or profile URL.';
    case 'not-found':
      return 'No WarEra account matched that input. Check the spelling, or paste your profile URL.';
    case 'already-linked-other':
      return 'That WarEra account is already linked to another Discord user. Ask staff if this is wrong.';
    case 'already-pending-other':
      return 'That WarEra account already has a pending link request from another Discord user.';
    case 'linked':
      return `Linked to **${result.username}**. Your roles will sync shortly.`;
    case 'verification-dm-sent':
      return `Found **${result.username}** — check your DMs for a verification code. Rename one of your WarEra companies to the code, then press the button in the DM (or run \`/link verify\`).`;
    case 'dm-failed':
      return 'I could not DM you the verification code. Enable DMs from server members and try again.';
    case 'pending-review':
      return result.reviewPosted
        ? `Your country is not on this server's allowed list, so a link request for **${result.username}** was sent to staff for review.`
        : `Your country is not on this server's allowed list. Your request for **${result.username}** is pending, but no review channel is configured — ask staff to review it with \`/autorole links pending\`.`;
  }
}

export function describeVerifyResult(result: VerifyResult): string {
  switch (result.status) {
    case 'no-verification':
      return 'You have no verification in progress. Start with `/link start`.';
    case 'expired':
      return 'Your verification code expired. Start again with `/link start`.';
    case 'code-not-found':
      return `I could not find a company named \`${result.code}\` on your account yet. Rename a company to exactly that code and try again.`;
    case 'verified':
      return `Verified — you are now linked to **${result.username}**. Your roles will sync shortly.`;
  }
}

async function handleStart(interaction: ChatInputCommandInteraction, service: AutoroleService): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const result = await service.getLinkFlow().beginLink({
    serverId: interaction.guild!.id,
    discordUserId: interaction.user.id,
    memberRoleIds: getMemberRoleIds(interaction),
    rawInput: interaction.options.getString('account', true),
  });
  await interaction.editReply({ content: describeBeginLinkResult(result) });
}

async function handleVerify(interaction: ChatInputCommandInteraction, service: AutoroleService): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const result = await service.getLinkFlow().runVerification(interaction.guild!.id, interaction.user.id);
  await interaction.editReply({ content: describeVerifyResult(result) });
}

async function handleUnlink(interaction: ChatInputCommandInteraction, service: AutoroleService): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const result = await service.getLinkFlow().unlink(interaction.guild!.id, interaction.user.id);
  if (result.removedLink) {
    await service.onUnlinked(interaction.guild!.id, interaction.user.id);
  }
  const removed: string[] = [];
  if (result.removedLink) removed.push('your account link');
  if (result.removedPending) removed.push('your pending review request');
  if (result.removedVerification) removed.push('your in-progress verification');
  await interaction.editReply({
    content: removed.length > 0 ? `Removed ${removed.join(', ')}.` : 'You have nothing linked or pending on this server.',
  });
}

async function handleWhoami(interaction: ChatInputCommandInteraction, service: AutoroleService): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const serverId = interaction.guild!.id;
  const discordUserId = interaction.user.id;
  const store = service.getStore();

  const link = await store.getLink(serverId, discordUserId);
  if (link) {
    await interaction.editReply({
      content: `You are linked to WarEra account \`${link.wareraUserId}\` (since <t:${Math.floor(link.linkedAt.getTime() / 1000)}:D>).`,
    });
    return;
  }

  const verification = await store.getVerification(serverId, discordUserId);
  if (verification) {
    await interaction.editReply({
      content: `You have a verification in progress for **${verification.wareraUsername}** — code \`${verification.code}\`, expires <t:${Math.floor(verification.expiresAt.getTime() / 1000)}:R>. Rename a company to the code, then press the DM button or run \`/link verify\`.`,
    });
    return;
  }

  const pending = await store.getPendingLink(serverId, discordUserId);
  if (pending) {
    await interaction.editReply({
      content: `Your link request for **${pending.wareraUsername}** is awaiting staff review.`,
    });
    return;
  }

  await interaction.editReply({ content: 'You are not linked on this server. Start with `/link start`.' });
}

async function handleWhois(interaction: ChatInputCommandInteraction, service: AutoroleService): Promise<void> {
  const target = interaction.options.getUser('user');
  const account = interaction.options.getString('account');
  if ((target && account) || (!target && !account)) {
    await interaction.reply({
      content: 'Pass exactly one of **user** (a Discord member) or **account** (a WarEra username/id/URL).',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const serverId = interaction.guild!.id;
  const store = service.getStore();
  const api = service.getApi();

  // Discord member -> WarEra account
  if (target) {
    const link = await store.getLink(serverId, target.id);
    if (link) {
      const user = await api.getUserLite(link.wareraUserId);
      const name = user ? `**${user.username}**` : '(profile unavailable)';
      await interaction.editReply({
        content:
          `<@${target.id}> is linked to ${name} — <https://app.warera.io/user/${link.wareraUserId}>\n` +
          `Linked since <t:${Math.floor(link.linkedAt.getTime() / 1000)}:D>.`,
      });
      return;
    }
    const pending = await store.getPendingLink(serverId, target.id);
    await interaction.editReply({
      content: pending
        ? `<@${target.id}> is not linked yet — their request for **${pending.wareraUsername}** is awaiting staff review.`
        : `<@${target.id}> is not linked on this server.`,
    });
    return;
  }

  // WarEra account -> Discord member
  const parsed = parseUserInput(account!);
  if (!parsed) {
    await interaction.editReply({ content: 'That does not look like a WarEra username, id, or profile URL.' });
    return;
  }
  const user =
    parsed.kind === 'id' ? await api.getUserLite(parsed.value) : await api.resolveUserByUsername(parsed.value);
  // An id can still be looked up in the store even if the profile fetch failed.
  const wareraUserId = user?._id ?? (parsed.kind === 'id' ? parsed.value : undefined);
  if (!wareraUserId) {
    await interaction.editReply({ content: `No WarEra account matched \`${account}\`.` });
    return;
  }
  const label = user ? `**${user.username}**` : `\`${wareraUserId}\``;

  const link = await store.findLinkByWareraId(serverId, wareraUserId);
  if (link) {
    await interaction.editReply({
      content:
        `${label} (<https://app.warera.io/user/${wareraUserId}>) is linked to <@${link.discordUserId}>.\n` +
        `Linked since <t:${Math.floor(link.linkedAt.getTime() / 1000)}:D>.`,
    });
    return;
  }
  const pending = await store.findPendingLinkByWareraId(serverId, wareraUserId);
  await interaction.editReply({
    content: pending
      ? `${label} is not linked yet — a request from <@${pending.discordUserId}> is awaiting staff review.`
      : `${label} is not linked to anyone on this server.`,
  });
}
