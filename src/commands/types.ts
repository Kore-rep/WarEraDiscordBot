import { ChatInputCommandInteraction, SlashCommandBuilder, PermissionFlagsBits, SlashCommandOptionsOnlyBuilder, SlashCommandSubcommandsOnlyBuilder, InteractionContextType } from 'discord.js';
import { DiscordService } from '../services/discord/DiscordService';
import { ApiService } from '../services/api/ApiService';

/**
 * Interface for slash command definitions
 */
export interface Command {
  data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder;
  execute: (interaction: ChatInputCommandInteraction, discordService?: DiscordService, apiService?: ApiService) => Promise<void>;
}

export type CreateCommandBuilderOptions = {
  /** When false, any member who can use slash commands may run it (still subject to channel overwrites). Default true. */
  requireAdmin?: boolean;
};

/**
 * Helper to create a command builder with common settings
 */
export function createCommandBuilder(
  name: string,
  description: string,
  options?: CreateCommandBuilderOptions
): SlashCommandBuilder {
  const builder = new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .setContexts(InteractionContextType.Guild);

  if (options?.requireAdmin === false) {
    builder.setDefaultMemberPermissions(null);
  } else {
    builder.setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
  }

  return builder;
}
