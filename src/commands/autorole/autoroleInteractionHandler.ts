import {
  ActionRowBuilder,
  ButtonInteraction,
  ModalBuilder,
  ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { logger } from '../../utils/logger';
import { ServerConfigManager } from '../../utils/serverConfigManager';
import { ApiService } from '../../services/api/ApiService';
import { canManageAutorole } from '../../services/autorole/autoroleAuth';
import {
  LINK_MODAL_ACCOUNT_FIELD,
  LINK_MODAL_ID,
  parseAutoroleCustomId,
} from '../../services/autorole/reviewMessages';
import { describeBeginLinkResult, describeVerifyResult } from '../link/link';

/**
 * Handles all `autorole:*` components: the persistent "Link WarEra" button
 * (opens a modal), the modal itself, the verification DM buttons, and the
 * staff review Approve/Deny buttons.
 */
export async function handleAutoroleButton(interaction: ButtonInteraction, apiService: ApiService): Promise<void> {
  const parsed = parseAutoroleCustomId(interaction.customId);
  const service = apiService.getAutoroleService();
  if (!parsed || !service) {
    await interaction.reply({ content: 'This button is no longer supported.', ephemeral: true });
    return;
  }

  switch (parsed.action) {
    case 'linkstart': {
      const modal = new ModalBuilder()
        .setCustomId(LINK_MODAL_ID)
        .setTitle('Link your WarEra account')
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId(LINK_MODAL_ACCOUNT_FIELD)
              .setLabel('WarEra username, id, or profile URL')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          )
        );
      await interaction.showModal(modal);
      return;
    }

    // DM buttons: the interaction has no guild, the serverId travels in the customId.
    case 'verifydm': {
      await interaction.deferReply();
      const result = await service.getLinkFlow().runVerification(parsed.arg!, interaction.user.id);
      await interaction.editReply({ content: describeVerifyResult(result) });
      return;
    }
    case 'cancelverify': {
      await interaction.deferReply();
      const removed = await service.getLinkFlow().cancelVerification(parsed.arg!, interaction.user.id);
      await interaction.editReply({
        content: removed ? 'Verification cancelled.' : 'You have no verification in progress.',
      });
      return;
    }

    case 'approve':
    case 'deny': {
      if (!interaction.guild) {
        await interaction.reply({ content: 'This button only works in a server.', ephemeral: true });
        return;
      }
      const serverId = interaction.guild.id;
      const cfg = ServerConfigManager.getAutoroleConfig(serverId);
      if (!canManageAutorole(interaction, cfg)) {
        await interaction.reply({
          content: 'You do not have permission to review link requests.',
          ephemeral: true,
        });
        return;
      }
      await interaction.deferReply({ ephemeral: true });
      const flow = service.getLinkFlow();
      const result =
        parsed.action === 'approve'
          ? await flow.approvePendingLink(serverId, parsed.arg!, interaction.user.tag)
          : await flow.denyPendingLink(serverId, parsed.arg!, interaction.user.tag);
      const messages: Record<string, string> = {
        'no-pending': 'That request no longer exists.',
        'already-linked-other': 'That WarEra account is already linked to a different member — not approved.',
        approved: `Approved — <@${parsed.arg}> has been DMed a verification code and must rename a company to finish linking.`,
        denied: `Denied the request from <@${parsed.arg}>.`,
        'not-found': `Could not fetch the WarEra profile for <@${parsed.arg}>'s request — they have been notified to contact staff.`,
      };
      await interaction.editReply({ content: messages[result.status] ?? 'Done.' });
      return;
    }

    default:
      await interaction.reply({ content: 'Unknown autorole button.', ephemeral: true });
  }
}

/** The link modal submitted from the persistent "Link WarEra" button. */
export async function handleAutoroleModal(
  interaction: ModalSubmitInteraction,
  apiService: ApiService
): Promise<void> {
  const service = apiService.getAutoroleService();
  if (!service || !interaction.guild) {
    await interaction.reply({ content: 'The linking service is not available.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const memberRoleIds = Array.isArray(interaction.member?.roles)
    ? interaction.member.roles
    : [...(interaction.member?.roles.cache.keys() ?? [])];

  try {
    const result = await service.getLinkFlow().beginLink({
      serverId: interaction.guild.id,
      discordUserId: interaction.user.id,
      memberRoleIds,
      rawInput: interaction.fields.getTextInputValue(LINK_MODAL_ACCOUNT_FIELD),
    });
    await interaction.editReply({ content: describeBeginLinkResult(result) });
  } catch (error) {
    logger.error('Autorole link modal failed', error);
    await interaction.editReply({ content: 'An error occurred while starting your link. Try again later.' });
  }
}
