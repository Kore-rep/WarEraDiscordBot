import { SlashCommandBuilder, ChatInputCommandInteraction, InteractionContextType } from 'discord.js';
import { logger } from '../../utils/logger';
import { createAPI, GetAllCountriesResponse, GetGovernmentByCountryIdResponse, GetUserLiteResponse } from 'warera-sdk';

/**
 * Command builder for /scanfor
 */
export const scanForCommand = {
  data: new SlashCommandBuilder()
    .setName('scanfor')
    .setDescription('Scan large groups of objects and return results')
    .setContexts(InteractionContextType.Guild)
    .addSubcommandGroup(group =>
      group
        .setName('country')
        .setDescription('Scan countries')
        .addSubcommand(subcommand =>
          subcommand
            .setName('nopresident')
            .setDescription('Find all countries without an active president')
        )
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      // Ensure command is used in a guild
      if (!interaction.guildId) {
        await interaction.reply({
          content: 'This command can only be used in a server.',
          ephemeral: true,
        });
        return;
      }

      const subcommandGroup = interaction.options.getSubcommandGroup();
      const subcommand = interaction.options.getSubcommand();

      if (subcommandGroup === 'country') {
        if (subcommand === 'nopresident') {
          await handleCountryNoPresident(interaction);
        }
      }
    } catch (error) {
      logger.error('Error executing scanfor command', error);
      
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'An error occurred while processing your request.',
          ephemeral: true,
        });
      } else if (interaction.deferred) {
        await interaction.followUp({
          content: 'An error occurred while processing your request.',
          ephemeral: true,
        });
      }
    }
  },
};

/**
 * Handle /scanfor country nopresident
 * Scans all countries to find those without a president
 */
async function handleCountryNoPresident(interaction: ChatInputCommandInteraction): Promise<void> {
  // Defer reply since this will take a while
  await interaction.deferReply({ ephemeral: false });

  try {
    const apiClient = createAPI({ baseUrl: process.env.API_BASE_URL });

    // Step 1: Get all countries
    logger.info('Fetching all countries...');
    const countriesResponse = await apiClient.country.getAllCountries() as GetAllCountriesResponse;
    const countries = countriesResponse.result.data;
    const countryCount = countries.length;

    if (countryCount === 0) {
      await interaction.editReply({
        content: 'No countries found in the system.',
      });
      return;
    }

    logger.info(`Found ${countryCount} countries to scan`);

    // Step 2: Calculate estimated time
    // Phase 1: Scan governments (10 req/sec)
    const governmentScanSeconds = Math.ceil(countryCount / 10);
    // Phase 2: Batch request for users (nearly instant)
    const batchRequestSeconds = 2;
    const totalSeconds = governmentScanSeconds + batchRequestSeconds;
    const estimatedMinutes = Math.floor(totalSeconds / 60);
    const remainingSeconds = totalSeconds % 60;

    let timeEstimate = '';
    if (estimatedMinutes > 0) {
      timeEstimate = `${estimatedMinutes} minute${estimatedMinutes !== 1 ? 's' : ''}`;
      if (remainingSeconds > 0) {
        timeEstimate += ` and ${remainingSeconds} second${remainingSeconds !== 1 ? 's' : ''}`;
      }
    } else {
      timeEstimate = `${totalSeconds} second${totalSeconds !== 1 ? 's' : ''}`;
    }

    // Send initial status
    await interaction.editReply({
      content: 
        `**Country President Activity Scan Initiated**\n\n` +
        `- Total countries: ${countryCount}\n` +
        `- Estimated time: ~${timeEstimate}\n` +
        `- Status: Scanning governments...\n\n` +
        `This may take a while. Please wait...`,
    });

    // Step 3: Scan all countries for government/president info
    interface CountryPresidentData {
      countryId: string;
      countryName: string;
      presidentId: string | null;
    }

    const countryPresidentMap: CountryPresidentData[] = [];
    let processedCount = 0;
    let lastUpdateTime = Date.now();
    const updateIntervalMs = 5000; // Update every 5 seconds

    for (const country of countries) {
      try {
        // Fetch government data for this country
        const govResponse = await apiClient.government.getByCountryId(country._id) as GetGovernmentByCountryIdResponse;
        const government = govResponse.result.data;

        countryPresidentMap.push({
          countryId: country._id,
          countryName: country.name,
          presidentId: government.president || null,
        });

        processedCount++;

        // Send progress update every 5 seconds
        const now = Date.now();
        if (now - lastUpdateTime >= updateIntervalMs) {
          const progress = Math.floor((processedCount / countryCount) * 100);
          const withPresidents = countryPresidentMap.filter(c => c.presidentId !== null).length;
          await interaction.editReply({
            content:
              `**Country President Activity Scan In Progress**\n\n` +
              `- Phase 1: Scanning governments\n` +
              `- Processed: ${processedCount}/${countryCount} (${progress}%)\n` +
              `- Countries with presidents: ${withPresidents}\n` +
              `- Status: Scanning...\n\n` +
              `Please wait...`,
          });
          lastUpdateTime = now;
        }

        // Add a small delay to respect rate limits (100ms between requests = 10 req/sec)
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        logger.error(`Failed to fetch government data for country ${country._id} (${country.name})`, error);
        countryPresidentMap.push({
          countryId: country._id,
          countryName: country.name,
          presidentId: null,
        });
        processedCount++;
      }
    }

    // Step 4: Filter countries with presidents and fetch user data via batch
    const countriesWithPresidents = countryPresidentMap.filter(c => c.presidentId !== null);

    if (countriesWithPresidents.length === 0) {
      await interaction.editReply({
        content: 
          `**Country President Activity Scan Complete**\n\n` +
          `- Total countries scanned: ${countryCount}\n` +
          `- Countries with presidents: 0\n\n` +
          `No countries have presidents to check for activity.`,
      });
      return;
    }

    logger.info(`Found ${countriesWithPresidents.length} countries with presidents, fetching user activity data...`);

    // Update user with batch fetch status
    await interaction.editReply({
      content: 
        `**Country President Activity Scan In Progress**\n\n` +
        `- Phase 2: Fetching president activity data\n` +
        `- Fetching data for ${countriesWithPresidents.length} presidents using batch request...\n` +
        `- Status: Please wait...`,
    });

    // Create batch client for fetching user data
    const batchClient = createAPI({ 
      baseUrl: process.env.API_BASE_URL, 
      batch: true 
    });

    // Queue all user requests
    const userPromises = countriesWithPresidents.map(country => 
      batchClient.user.getUserLite(country.presidentId!)
    );

    // Execute batch
    await batchClient.runBatch();

    // Get all results
    const userResults = await Promise.all(userPromises);

    // Step 5: Analyze results for presidents nearing inactivity
    interface WarningCountry {
      countryId: string;
      countryName: string;
      presidentId: string;
      presidentUsername: string;
      hoursSinceActive: number;
      hoursUntilInactive: number;
    }

    const warningCountries: WarningCountry[] = [];
    const now = new Date();

    for (let i = 0; i < countriesWithPresidents.length; i++) {
      const countryData = countriesWithPresidents[i];
      const userResponse = userResults[i] as GetUserLiteResponse;
      
      if (!userResponse?.result?.data) {
        logger.warn(`Failed to fetch user data for president ${countryData.presidentId} of ${countryData.countryName}`);
        continue;
      }
      
      const userData = userResponse.result.data;
      const lastConnection = new Date(userData.dates.lastConnectionAt);
      const hoursSinceConnection = (now.getTime() - lastConnection.getTime()) / (1000 * 60 * 60);
      
      // Check if within 3 hours of 2-day inactivity (45-48 hours)
      if (hoursSinceConnection >= 45 && hoursSinceConnection < 48) {
        warningCountries.push({
          countryId: countryData.countryId,
          countryName: countryData.countryName,
          presidentId: countryData.presidentId!,
          presidentUsername: userData.username,
          hoursSinceActive: Math.floor(hoursSinceConnection),
          hoursUntilInactive: Math.ceil(48 - hoursSinceConnection),
        });
      }
    }

    logger.info(`Found ${warningCountries.length} presidents nearing 2-day inactivity`)

    // Get countries without presidents
    const countriesWithoutPresidents = countryPresidentMap.filter(c => c.presidentId === null);

    // Step 6: Format and send results
    let resultMessage = `**Country President Activity Scan Complete**\n\n`;
    resultMessage += `- Total countries scanned: ${countryCount}\n`;
    resultMessage += `- Countries with presidents: ${countriesWithPresidents.length}\n`;
    resultMessage += `- Countries without presidents: ${countriesWithoutPresidents.length}\n`;
    resultMessage += `- Presidents nearing 2-day inactivity (45-48h): ${warningCountries.length}\n\n`;

    // Show countries without presidents
    if (countriesWithoutPresidents.length > 0) {
      resultMessage += `**Countries Without Presidents:**\n\n`;

      // Discord has a 2000 character limit, so limit the list
      const maxCountriesToShow = 15;
      const countriesToShow = countriesWithoutPresidents.slice(0, maxCountriesToShow);

      for (const country of countriesToShow) {
        resultMessage += `- **${country.countryName}** (ID: \`${country.countryId}\`)\n`;
      }

      if (countriesWithoutPresidents.length > maxCountriesToShow) {
        resultMessage += `_...and ${countriesWithoutPresidents.length - maxCountriesToShow} more._\n`;
      }
      resultMessage += `\n`;
    }

    // Show presidents nearing inactivity
    if (warningCountries.length === 0) {
      resultMessage += `**✅ No presidents are within 3 hours of reaching 2-day inactivity.**`;
    } else {
      resultMessage += `**⚠️ Presidents Approaching Inactivity (45-48 hours):**\n\n`;

      // Discord has a 2000 character limit, so we need to handle long lists
      const maxToShow = 15;
      const presidentsToShow = warningCountries.slice(0, maxToShow);

      for (const country of presidentsToShow) {
        resultMessage += `**${country.countryName}** (ID: \`${country.countryId}\`)\n`;
        resultMessage += `└─ President: **${country.presidentUsername}** (\`${country.presidentId}\`)\n`;
        resultMessage += `└─ Last active: ${country.hoursSinceActive} hours ago\n`;
        resultMessage += `└─ Inactive in: ~${country.hoursUntilInactive} hour(s)\n\n`;
      }

      if (warningCountries.length > maxToShow) {
        resultMessage += `_...and ${warningCountries.length - maxToShow} more._`;
      }
    }

    await interaction.editReply({
      content: resultMessage,
    });

    logger.info(
      `Scan complete: ${warningCountries.length} presidents nearing inactivity out of ${countriesWithPresidents.length} with presidents`
    );
  } catch (error) {
    logger.error('Failed to scan countries for presidents', error);
    await interaction.editReply({
      content: 'Failed to complete the scan. Please check the logs for details.',
    });
  }
}

