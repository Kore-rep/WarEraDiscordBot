import { ChatInputCommandInteraction } from 'discord.js';
import { logger } from '../../../utils/logger';
import { ApiService } from '../../../services/api/ApiService';
import { ScanService, ScanCountry } from '../../../services/scan/ScanService';
import { ServerConfigManager } from '../../../utils/serverConfigManager';

type CountryRow = ScanCountry;

function getActivePopulation(country: CountryRow): number {
  return country.rankings?.countryActivePopulation?.value ?? 0;
}

/**
 * Handle /scanfor country lowpop
 * Lists countries whose active population is strictly less than the given maximum.
 */
export async function handleCountryLowPop(
  interaction: ChatInputCommandInteraction,
  apiService: ApiService
): Promise<void> {
  await interaction.deferReply({ ephemeral: false });

  try {
    const scan = new ScanService(apiService);
    const maxCitizens = interaction.options.getInteger('max_citizens', true);
    const groupName = interaction.options.getString('group');
    const serverId = interaction.guildId!;

    if (maxCitizens < 0) {
      await interaction.editReply({
        content: '**Max citizens** must be zero or greater.',
      });
      return;
    }

    let countries: CountryRow[];
    let scanScope = 'all countries';

    if (groupName) {
      const group = ServerConfigManager.getCountryGroup(serverId, groupName);

      if (!group) {
        await interaction.editReply({
          content: `Country group "**${groupName}**" not found. Use \`/countrygroup list\` to see available groups.`,
        });
        return;
      }

      if (group.countries.length === 0) {
        await interaction.editReply({
          content: `Country group "**${groupName}**" has no countries. Use \`/countrygroup add ${groupName}\` to add countries.`,
        });
        return;
      }

      logger.info(`Lowpop: fetching ${group.countries.length} countries from group "${groupName}"...`);
      const countryIds = group.countries.map(c => c.countryId);
      countries = await scan.getCountriesByIds(countryIds, 10_000);

      scanScope = `group "${groupName}" (${countries.length} countries)`;
    } else {
      logger.info('Lowpop: fetching all countries...');
      countries = await scan.getAllCountries();
    }

    const below = countries
      .map(c => ({
        country: c,
        activePop: getActivePopulation(c),
      }))
      .filter(({ activePop }) => activePop < maxCitizens)
      .sort((a, b) => a.activePop - b.activePop);

    const MAX_MESSAGE_LENGTH = 1950;

    const summary =
      `**Low population scan**\n\n` +
      `- Scan scope: ${scanScope}\n` +
      `- Threshold: active population **< ${maxCitizens}**\n` +
      `- Matches: **${below.length}**`;

    await interaction.editReply({ content: summary });

    if (below.length === 0) {
      return;
    }

    let current = `**Countries (active pop < ${maxCitizens})**\n`;
    for (const { country, activePop } of below) {
      const line = `- ${country.name} (\`${country._id}\`) — **${activePop}** active\n`;
      if (current.length + line.length > MAX_MESSAGE_LENGTH) {
        await interaction.followUp({ content: current });
        current = `**(continued)**\n` + line;
      } else {
        current += line;
      }
    }
    if (current.length > 0) {
      await interaction.followUp({ content: current });
    }

    logger.info(`Lowpop complete: ${below.length} countries below ${maxCitizens}`);
  } catch (error) {
    logger.error('Failed low population country scan', error);
    await interaction.editReply({
      content: 'Failed to complete the scan. Please check the logs for details.',
    });
  }
}
