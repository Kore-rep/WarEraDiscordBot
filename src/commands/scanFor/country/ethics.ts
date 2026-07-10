import { ChatInputCommandInteraction } from 'discord.js';
import { logger } from '../../../utils/logger';
import { ApiService } from '../../../services/api/ApiService';
import { ScanService, ScanCountry } from '../../../services/scan/ScanService';
import { resolveEthicLabel } from './partyEthicsMapping';

type CountryRow = ScanCountry;

const MAX_MESSAGE_LENGTH = 1950;

/**
 * Handle /scanfor country ethics
 * Countries whose ruling party matches the selected ethic label on the corresponding axis.
 */
export async function handleCountryEthicsScan(
  interaction: ChatInputCommandInteraction,
  apiService: ApiService
): Promise<void> {
  await interaction.deferReply({ ephemeral: false });

  try {
    const ethicLabel = interaction.options.getString('ethic', true);
    const target = resolveEthicLabel(ethicLabel);

    if (!target) {
      await interaction.editReply({
        content: `Unknown ethic **${ethicLabel}**.`,
      });
      return;
    }

    const scan = new ScanService(apiService);
    const targetSummary =
      target.kind === 'axis' ? `${target.axis} = ${target.value}` : `unethical = ${target.value}`;
    logger.info(`Ethics scan: ethic="${ethicLabel}" (${targetSummary})`);

    const countries = await scan.getAllCountries();

    if (countries.length === 0) {
      await interaction.editReply({ content: 'No countries found in the system.' });
      return;
    }

    const uniquePartyIds = [
      ...new Set(
        countries
          .map(c => c.rulingParty?.trim())
          .filter((id): id is string => Boolean(id))
      ),
    ];
    const partyById = await scan.getPartiesByIds(uniquePartyIds);

    const matches: { country: CountryRow; partyName: string; unethical: boolean }[] = [];

    for (const country of countries) {
      const partyId = country.rulingParty?.trim();
      if (!partyId) {
        continue;
      }
      const party = partyById.get(partyId);
      if (!party?.ethics) {
        continue;
      }
      const isMatch =
        target.kind === 'axis'
          ? party.ethics[target.axis] === target.value
          : Boolean(party.ethics.unethical) === target.value;
      if (isMatch) {
        matches.push({
          country,
          partyName: party.name,
          unethical: Boolean(party.ethics.unethical),
        });
      }
    }

    matches.sort((a, b) => a.country.name.localeCompare(b.country.name));

    const summary =
      `**Country ruling-party ethics scan**\n\n` +
      `- Ethic: **${ethicLabel}** (${targetSummary})\n` +
      `- Countries scanned: **${countries.length}**\n` +
      `- Unique ruling parties fetched: **${uniquePartyIds.length}**\n` +
      `- Matches: **${matches.length}**`;

    await interaction.editReply({ content: summary });

    if (matches.length === 0) {
      return;
    }

    // Flag unethical ruling parties, except when the scan itself is the unethical
    // filter (every match would carry the same marker then).
    const showUnethicalMarker = target.kind !== 'unethical';

    let current = `**Countries (ruling party: ${ethicLabel})**\n`;
    for (const { country, partyName, unethical } of matches) {
      const marker = showUnethicalMarker && unethical ? ' ⚠️ unethical' : '';
      const line = `- ${country.name} (\`${country._id}\`) — *${partyName}*${marker}\n`;
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

    logger.info(`Ethics scan complete: ${matches.length} matches for "${ethicLabel}"`);
  } catch (error) {
    logger.error('Failed country ethics scan', error);
    await interaction.editReply({
      content: 'Failed to complete the scan. Please check the logs for details.',
    });
  }
}
