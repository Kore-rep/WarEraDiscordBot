import { ChatInputCommandInteraction, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { logger } from '../../../utils/logger';
import { ApiService } from '../../../services/api/ApiService';
import { ScanService, ScanUserLite } from '../../../services/scan/ScanService';

type UserDTO = ScanUserLite;
import { groupPlayersByMode, sortUsersByLevel } from './skillAnalyzer';
import { createBuildSummary } from './userStatusFormatter';
import { BUILDS_SWEEP_CACHE_TTL_MS } from './buildsCache';

/**
 * Handle /scanfor country builds
 * Analyzes player builds and modes for a given country
 */
export async function handleCountryBuilds(interaction: ChatInputCommandInteraction, apiService: ApiService): Promise<void> {
  // Defer reply since this will take a while
  await interaction.deferReply({ ephemeral: false });

  try {
    const scan = new ScanService(apiService);
    const countryParam = interaction.options.getString('country', true);
    const minLevel = interaction.options.getInteger('min_level', true);

    // Step 1: Find the country
    logger.info(`Looking for country: ${countryParam}`);
    
    // Try to find country by name or ID
    let countryId: string;
    let countryName: string;
    
    // First try as direct ID
    if (countryParam.match(/^[0-9a-fA-F]{24}$/)) {
      const country = await scan.getCountryById(countryParam);
      if (!country) {
        await interaction.editReply({
          content: `❌ Country with ID "${countryParam}" not found.`,
        });
        return;
      }
      countryId = countryParam;
      countryName = country.name;
    } else {
      // Search by name
      try {
        const countries = await scan.getAllCountries(3_600_000);

        const foundCountry = countries.find(c => 
          c.name.toLowerCase() === countryParam.toLowerCase()
        );
        
        if (!foundCountry) {
          // Try partial match
          const partialMatches = countries.filter(c => 
            c.name.toLowerCase().includes(countryParam.toLowerCase())
          );
          
          if (partialMatches.length === 0) {
            await interaction.editReply({
              content: `❌ No country found matching "${countryParam}".`,
            });
            return;
          } else if (partialMatches.length > 1) {
            const matchList = partialMatches.slice(0, 10).map(c => c.name).join(', ');
            await interaction.editReply({
              content: `❌ Multiple countries found matching "${countryParam}": ${matchList}${partialMatches.length > 10 ? '...' : ''}. Please be more specific.`,
            });
            return;
          } else {
            countryId = partialMatches[0]._id;
            countryName = partialMatches[0].name;
          }
        } else {
          countryId = foundCountry._id;
          countryName = foundCountry.name;
        }
      } catch (error) {
        logger.error('Error finding country:', error);
        await interaction.editReply({
          content: '❌ Error searching for country. Please try again.',
        });
        return;
      }
    }

    logger.info(`Found country: ${countryName} (${countryId})`);

    // Step 2: Get all user IDs for the country
    await interaction.editReply({
      content: `**Country Build Analysis**\n\n` +
        `🔍 **Country:** ${countryName}\n` +
        `📊 **Minimum Level:** ${minLevel}\n\n` +
        `⏳ Fetching user list...`,
    });

    const MAX_PAGES = 1000; // Safety limit to prevent infinite loops
    let allUserIds: string[];
    let totalCitizens: number;
    let hitPageLimit: boolean;
    try {
      const result = await scan.getUserIdsByCountry(
        countryId,
        (total, pages) => {
          if (pages % 5 === 0) {
            void interaction.editReply({
              content: `**Country Build Analysis**\n\n` +
                `🔍 **Country:** ${countryName}\n` +
                `📊 **Minimum Level:** ${minLevel}\n\n` +
                `⏳ Fetching user list... (Page ${pages})\n` +
                `👥 **Users found:** ${total.toLocaleString()}`,
            });
          }
        },
        MAX_PAGES,
        BUILDS_SWEEP_CACHE_TTL_MS
      );
      allUserIds = result.userIds;
      totalCitizens = result.total;
      hitPageLimit = result.hitPageLimit;
    } catch (error) {
      logger.error('Error fetching users by country:', error);
      await interaction.editReply({
        content: '❌ Error fetching user list. The country may not exist or the API may be unavailable.',
      });
      return;
    }

    if (hitPageLimit) {
      logger.warn(`Hit maximum page limit (${MAX_PAGES}) for country ${countryId}`);
      await interaction.editReply({
        content: `⚠️ Large country detected - processed ${MAX_PAGES} pages (${totalCitizens.toLocaleString()} users). Analysis may be incomplete.`,
      });
    }

    if (allUserIds.length === 0) {
      await interaction.editReply({
        content: `❌ No citizens found in ${countryName}.`,
      });
      return;
    }

    // Step 3: Estimate processing time and update status
    const userBatches = Math.ceil(allUserIds.length / 100);
    const estimatedMinutes = Math.max(1, Math.ceil(userBatches * 0.5)); // Rough estimate

    await interaction.editReply({
      content: `**Country Build Analysis**\n\n` +
        `🔍 **Country:** ${countryName}\n` +
        `📊 **Minimum Level:** ${minLevel}\n` +
        `👥 **Total Citizens:** ${totalCitizens.toLocaleString()}\n` +
        `⏳ **Estimated Time:** ~${estimatedMinutes} minute${estimatedMinutes !== 1 ? 's' : ''}\n\n` +
        `📡 Fetching user details (${userBatches} batch${userBatches !== 1 ? 'es' : ''})...`,
    });

    // Step 4: Batch fetch user details (batched inside ScanService)
    const usersById = await scan.getUsersLiteByIds(allUserIds, (loaded, batchesDone) => {
      if (batchesDone % 3 === 0 || batchesDone === userBatches) {
        void interaction.editReply({
          content: `**Country Build Analysis**\n\n` +
            `🔍 **Country:** ${countryName}\n` +
            `📊 **Minimum Level:** ${minLevel}\n` +
            `👥 **Total Citizens:** ${totalCitizens.toLocaleString()}\n\n` +
            `📡 Processing... (${batchesDone}/${userBatches} batches complete)\n` +
            `✅ **Users Loaded:** ${loaded.toLocaleString()}`,
        });
      }
    }, BUILDS_SWEEP_CACHE_TTL_MS);
    const users: UserDTO[] = Array.from(usersById.values());

    if (users.length === 0) {
      await interaction.editReply({
        content: `❌ Could not load any user data for ${countryName}. This may be a temporary API issue.`,
      });
      return;
    }

    // Step 5: Filter by minimum level
    const filteredUsers = users.filter(user => 
      user && user.leveling && typeof user.leveling.level === 'number' && user.leveling.level >= minLevel
    );
    
    if (filteredUsers.length === 0) {
      await interaction.editReply({
        content: `❌ No citizens in ${countryName} meet the minimum level requirement of ${minLevel}.`,
      });
      return;
    }

    logger.info(`Filtered to ${filteredUsers.length} users with level >= ${minLevel}`);

    // Step 6: Analyze builds and group by mode
    await interaction.editReply({
      content: `**Country Build Analysis**\n\n` +
        `🔍 **Country:** ${countryName}\n` +
        `📊 **Minimum Level:** ${minLevel}\n` +
        `👥 **Total Citizens:** ${totalCitizens.toLocaleString()}\n` +
        `✅ **Users Loaded:** ${users.length.toLocaleString()}\n` +
        `🎯 **Qualified Users:** ${filteredUsers.length.toLocaleString()}\n\n` +
        `🧮 Analyzing builds and calculating modes...`,
    });

    const groupedUsers = groupPlayersByMode(filteredUsers);
    
    // Sort each group by level
    groupedUsers.eco = sortUsersByLevel(groupedUsers.eco);
    groupedUsers.war = sortUsersByLevel(groupedUsers.war);
    groupedUsers.hybrid = sortUsersByLevel(groupedUsers.hybrid);

    // Step 7: Create summary and buttons
    const summary = createBuildSummary(
      countryName,
      totalCitizens,
      filteredUsers.length,
      minLevel,
      groupedUsers.eco.length,
      groupedUsers.war.length,
      groupedUsers.hybrid.length
    );

    // Create buttons for detailed views (include minLevel in customId)
    const actionRow = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`builds:${countryId}:war:0:${minLevel}`)
          .setLabel(`War Details (${groupedUsers.war.length})`)
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`builds:${countryId}:hybrid:0:${minLevel}`)
          .setLabel(`Hybrid Details (${groupedUsers.hybrid.length})`)
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`builds:${countryId}:eco:0:${minLevel}`)
          .setLabel(`Eco Details (${groupedUsers.eco.length})`)
          .setStyle(ButtonStyle.Success)
      );

    await interaction.editReply({
      content: summary,
      components: [actionRow],
    });

    logger.info(`Build analysis complete for ${countryName}: ${groupedUsers.war.length} war, ${groupedUsers.hybrid.length} hybrid, ${groupedUsers.eco.length} eco`);

  } catch (error) {
    logger.error('Error executing builds command:', error);
    
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ An error occurred while processing your request.',
        ephemeral: true,
      });
    } else if (interaction.deferred) {
      await interaction.editReply({
        content: '❌ An error occurred while processing the build analysis. Please try again.',
      });
    }
  }
}