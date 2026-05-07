import { ChatInputCommandInteraction } from 'discord.js';
import { logger } from '../../../utils/logger';
import { GetAllCountriesResponse, GetPartyByIdResponse } from '../../../services/api/WarEraApiClient';
import { ApiService } from '../../../services/api/ApiService';
import { resolveEthicLabel } from './partyEthicsMapping';

type CountryRow = GetAllCountriesResponse['result']['data'][number];

const PARTY_BATCH_SIZE = 100;
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

    const apiClient = apiService.getClient();
    logger.info(`Ethics scan: ethic="${ethicLabel}" (${target.axis}=${target.value})`);

    const countriesResponse = (await apiClient.country.getAllCountries()) as GetAllCountriesResponse;
    const countries = countriesResponse.result.data;

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
    const partyById = new Map<string, GetPartyByIdResponse['result']['data']>();

    for (let i = 0; i < uniquePartyIds.length; i += PARTY_BATCH_SIZE) {
      const chunk = uniquePartyIds.slice(i, i + PARTY_BATCH_SIZE);
      const batchClient = apiService.createCommandBatchClient();
      const partyPromises = chunk.map(id =>
        batchClient.party.getPartyById(id, { cache: { ttl: 86400 } })
      );
      await batchClient.runBatch();
      const partyResults = await Promise.all(partyPromises);

      for (let j = 0; j < chunk.length; j++) {
        const partyId = chunk[j];
        const res = partyResults[j] as GetPartyByIdResponse | undefined;
        const party = res?.result?.data;
        if (party) {
          partyById.set(partyId, party);
        } else {
          logger.warn(`Ethics scan: failed to load party ${partyId}`);
        }
      }
    }

    const matches: { country: CountryRow; partyName: string }[] = [];

    for (const country of countries) {
      const partyId = country.rulingParty?.trim();
      if (!partyId) {
        continue;
      }
      const party = partyById.get(partyId);
      if (!party?.ethics) {
        continue;
      }
      const axisValue = party.ethics[target.axis];
      if (axisValue === target.value) {
        matches.push({ country, partyName: party.name });
      }
    }

    matches.sort((a, b) => a.country.name.localeCompare(b.country.name));

    const axisSummary = `${target.axis} = ${target.value}`;
    const summary =
      `**Country ruling-party ethics scan**\n\n` +
      `- Ethic: **${ethicLabel}** (${axisSummary})\n` +
      `- Countries scanned: **${countries.length}**\n` +
      `- Unique ruling parties fetched: **${uniquePartyIds.length}**\n` +
      `- Matches: **${matches.length}**`;

    await interaction.editReply({ content: summary });

    if (matches.length === 0) {
      return;
    }

    let current = `**Countries (ruling party: ${ethicLabel})**\n`;
    for (const { country, partyName } of matches) {
      const line = `- ${country.name} (\`${country._id}\`) — *${partyName}*\n`;
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
