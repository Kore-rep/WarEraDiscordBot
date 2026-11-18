import { ChannelType, ChatInputCommandInteraction } from 'discord.js';
import { Command, createCommandBuilder } from '../types';
import { logger } from '../../utils/logger';
import { COMMAND_HELP } from '../help/helpTexts';
import { DiscordService } from '../../services/discord/DiscordService';
import { ApiService } from '../../services/api/ApiService';
import { ScanService } from '../../services/scan/ScanService';
import { MilitaryUnitService } from '../../services/militaryUnits/MilitaryUnitService';
import { parseMuInput } from '../../services/muDirectory/muLink';
import { ServerConfigManager } from '../../utils/serverConfigManager';
import { BATTLE_ORDER_PRIORITIES, BattleOrderPriority, BattleOrdersConfig } from '../../config/config';

const COUNTRY_CACHE_TTL_MS = 3600 * 1000;

/**
 * `/battleorders` — post battle orders placed by chosen countries / MUs to a
 * channel, filtered to the priority levels the server cares about.
 */
export const battleOrdersCommand: Command = {
  data: createCommandBuilder('battleorders', 'Post battle orders from chosen countries / MUs to a channel')
    .addSubcommand(sub =>
      sub
        .setName('setup')
        .setDescription('Set the channel for the battle orders feed and enable it')
        .addChannelOption(opt =>
          opt
            .setName('channel')
            .setDescription('Channel to post orders in')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
        .addRoleOption(opt => opt.setName('role').setDescription('Role to ping on each post (optional)'))
    )
    .addSubcommand(sub =>
      sub
        .setName('levels')
        .setDescription('Choose which order priority levels are posted')
        .addBooleanOption(opt => opt.setName('high').setDescription('Post high priority orders'))
        .addBooleanOption(opt => opt.setName('medium').setDescription('Post medium priority orders'))
        .addBooleanOption(opt => opt.setName('low').setDescription('Post low priority orders'))
    )
    .addSubcommand(sub =>
      sub
        .setName('add-country')
        .setDescription('Track orders placed by a country')
        .addStringOption(opt => opt.setName('country').setDescription('Country name').setRequired(true))
    )
    .addSubcommand(sub =>
      sub
        .setName('remove-country')
        .setDescription('Stop tracking a country\'s orders')
        .addStringOption(opt => opt.setName('country').setDescription('Country name or id').setRequired(true))
    )
    .addSubcommand(sub =>
      sub
        .setName('add-mu')
        .setDescription('Track orders placed by a military unit')
        .addStringOption(opt => opt.setName('mu').setDescription('MU id or app.warera.io/mu/... link').setRequired(true))
    )
    .addSubcommand(sub =>
      sub
        .setName('remove-mu')
        .setDescription('Stop tracking an MU\'s orders')
        .addStringOption(opt => opt.setName('mu').setDescription('MU id or link').setRequired(true))
    )
    .addSubcommand(sub => sub.setName('help').setDescription('How the battle order feed works'))
    .addSubcommand(sub => sub.setName('status').setDescription('Show the battle orders feed settings'))
    .addSubcommand(sub => sub.setName('disable').setDescription('Stop posting battle orders')),

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
      const serverId = interaction.guild.id;
      const sub = interaction.options.getSubcommand();
      if (sub === 'help') {
        await interaction.reply({ content: COMMAND_HELP.battleorders, ephemeral: true });
        return;
      }
      const cfg = ServerConfigManager.getBattleOrdersConfig(serverId);

      if (sub === 'setup') {
        const channel = interaction.options.getChannel('channel', true);
        const role = interaction.options.getRole('role');
        ServerConfigManager.updateBattleOrdersConfig(serverId, {
          enabled: true,
          channelId: channel.id,
          roleIds: role ? [role.id] : [],
        });
        const tracked = (cfg?.countries.length ?? 0) + (cfg?.mus.length ?? 0);
        await interaction.reply({
          content:
            `Battle orders will be posted in <#${channel.id}>${role ? ` pinging <@&${role.id}>` : ''}.` +
            (tracked === 0 ? '\nAdd orderers with `/battleorders add-country` or `/battleorders add-mu`.' : ''),
          ephemeral: true,
        });
        return;
      }

      if (sub === 'levels') {
        const current = new Set(cfg?.priorities ?? BATTLE_ORDER_PRIORITIES);
        for (const level of BATTLE_ORDER_PRIORITIES) {
          const value = interaction.options.getBoolean(level);
          if (value === true) current.add(level);
          if (value === false) current.delete(level);
        }
        const priorities = BATTLE_ORDER_PRIORITIES.filter(p => current.has(p));
        if (priorities.length === 0) {
          await interaction.reply({
            content: 'At least one level must stay on. Use `/battleorders disable` to stop the feed.',
            ephemeral: true,
          });
          return;
        }
        ServerConfigManager.updateBattleOrdersConfig(serverId, { priorities });
        await interaction.reply({ content: `Posting orders at: **${formatLevels(priorities)}**.`, ephemeral: true });
        return;
      }

      if (sub === 'status') {
        await interaction.reply({ content: formatStatus(cfg), ephemeral: true });
        return;
      }

      if (sub === 'disable') {
        if (!cfg?.enabled) {
          await interaction.reply({ content: 'The battle orders feed is not enabled.', ephemeral: true });
          return;
        }
        ServerConfigManager.updateBattleOrdersConfig(serverId, { enabled: false });
        await interaction.reply({ content: 'Battle orders feed disabled. Settings are kept; run `/battleorders setup` to re-enable.', ephemeral: true });
        return;
      }

      if (sub === 'remove-country') {
        const input = interaction.options.getString('country', true).trim().toLowerCase();
        const match = cfg?.countries.find(c => c.countryId === input || c.countryName.toLowerCase() === input);
        if (!cfg || !match) {
          await interaction.reply({ content: 'That country is not tracked.', ephemeral: true });
          return;
        }
        ServerConfigManager.updateBattleOrdersConfig(serverId, {
          countries: cfg.countries.filter(c => c.countryId !== match.countryId),
        });
        await interaction.reply({ content: `Stopped tracking **${match.countryName}**.`, ephemeral: true });
        return;
      }

      if (sub === 'remove-mu' || sub === 'add-mu') {
        let muId: string;
        try {
          muId = parseMuInput(interaction.options.getString('mu', true)).id;
        } catch (error) {
          await interaction.reply({ content: (error as Error).message, ephemeral: true });
          return;
        }
        if (sub === 'remove-mu') {
          const match = cfg?.mus.find(m => m.muId === muId);
          if (!cfg || !match) {
            await interaction.reply({ content: `MU \`${muId}\` is not tracked.`, ephemeral: true });
            return;
          }
          ServerConfigManager.updateBattleOrdersConfig(serverId, { mus: cfg.mus.filter(m => m.muId !== muId) });
          await interaction.reply({ content: `Stopped tracking **${match.muName}**.`, ephemeral: true });
          return;
        }
        if (!apiService) {
          await interaction.reply({ content: 'The API service is not available.', ephemeral: true });
          return;
        }
        await interaction.deferReply({ ephemeral: true });
        const muName = await new MilitaryUnitService(apiService).resolveMuName(muId);
        if (!muName) {
          await interaction.editReply({ content: `No military unit found for id \`${muId}\`.` });
          return;
        }
        const mus = (cfg?.mus ?? []).filter(m => m.muId !== muId);
        ServerConfigManager.updateBattleOrdersConfig(serverId, { mus: [...mus, { muId, muName }] });
        await interaction.editReply({ content: `Tracking battle orders from **${muName}**.${setupHint(cfg)}` });
        return;
      }

      if (sub === 'add-country') {
        if (!apiService) {
          await interaction.reply({ content: 'The API service is not available.', ephemeral: true });
          return;
        }
        const input = interaction.options.getString('country', true).trim().toLowerCase();
        await interaction.deferReply({ ephemeral: true });
        const countries = await new ScanService(apiService).getAllCountries(COUNTRY_CACHE_TTL_MS);
        const country = countries.find(c => c.name.toLowerCase() === input || c._id === input);
        if (!country) {
          await interaction.editReply({ content: `No country named \`${input}\` found.` });
          return;
        }
        const rest = (cfg?.countries ?? []).filter(c => c.countryId !== country._id);
        ServerConfigManager.updateBattleOrdersConfig(serverId, {
          countries: [...rest, { countryId: country._id, countryName: country.name }],
        });
        await interaction.editReply({ content: `Tracking battle orders from **${country.name}**.${setupHint(cfg)}` });
        return;
      }

      await interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
    } catch (error) {
      logger.error('Error in battleorders command', error);
      const content = 'An error occurred while processing the command.';
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content, ephemeral: true });
      } else {
        await interaction.reply({ content, ephemeral: true });
      }
    }
  },
};

const formatLevels = (levels: BattleOrderPriority[]) => levels.map(l => l[0].toUpperCase() + l.slice(1)).join(', ');

const setupHint = (cfg: BattleOrdersConfig | undefined) =>
  cfg?.channelId ? '' : '\nSet a channel with `/battleorders setup` to start posting.';

function formatStatus(cfg: BattleOrdersConfig | undefined): string {
  if (!cfg) {
    return 'The battle orders feed is not set up. Start with `/battleorders setup`.';
  }
  const lines = [
    `**Battle orders feed** — ${cfg.enabled ? 'enabled' : 'disabled'}`,
    `Channel: ${cfg.channelId ? `<#${cfg.channelId}>` : '*not set*'}`,
    `Ping: ${cfg.roleIds.length ? cfg.roleIds.map(id => `<@&${id}>`).join(' ') : '*none*'}`,
    `Levels: ${formatLevels(cfg.priorities)}`,
    `Countries: ${cfg.countries.length ? cfg.countries.map(c => c.countryName).join(', ') : '*none*'}`,
    `MUs: ${cfg.mus.length ? cfg.mus.map(m => m.muName).join(', ') : '*none*'}`,
  ];
  return lines.join('\n');
}
