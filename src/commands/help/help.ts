import { ChatInputCommandInteraction } from 'discord.js';
import { Command, createCommandBuilder } from '../types';
import { HELP_OVERVIEW } from './helpTexts';

export const helpCommand: Command = {
  data: createCommandBuilder('help', 'List every command and what it does', { requireAdmin: false }),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.reply({ content: HELP_OVERVIEW, ephemeral: true });
  },
};
