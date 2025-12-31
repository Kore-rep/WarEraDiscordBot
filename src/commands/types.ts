import { ChatInputCommandInteraction, SlashCommandBuilder, PermissionFlagsBits, SlashCommandOptionsOnlyBuilder, SlashCommandSubcommandsOnlyBuilder, InteractionContextType } from 'discord.js';
import { DiscordService } from '../services/discord/DiscordService';

/**
 * Interface for slash command definitions
 */
export interface Command {
  data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder;
  execute: (interaction: ChatInputCommandInteraction, discordService?: DiscordService) => Promise<void>;
}

/**
 * Helper to create a command builder with common settings
 */
export function createCommandBuilder(name: string, description: string): SlashCommandBuilder {
  return new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setContexts(InteractionContextType.Guild);
}
