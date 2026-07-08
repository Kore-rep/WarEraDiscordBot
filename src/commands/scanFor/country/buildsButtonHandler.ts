import { ButtonInteraction, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { logger } from '../../../utils/logger';
import { ApiService } from '../../../services/api/ApiService';
import { ScanService, ScanUserLite } from '../../../services/scan/ScanService';

type UserDTO = ScanUserLite;
import { groupPlayersByMode, sortUsersByLevel } from './skillAnalyzer';
import { formatUserList, createBuildSummary } from './userStatusFormatter';

/**
 * Handle button interactions for the builds command
 * Custom ID format: builds:{countryId}:{mode}:{pageNumber}:{minLevel}
 */
export async function handleBuildsButtonInteraction(interaction: ButtonInteraction, apiService: ApiService): Promise<void> {
  await interaction.deferReply({ ephemeral: false });

  try {
    // Parse the custom ID
    const [, countryId, mode, pageNumberStr, minLevelStr] = interaction.customId.split(':');
    const pageNumber = parseInt(pageNumberStr) || 0;
    const minLevel = parseInt(minLevelStr) || 1;

    if (!countryId || !mode) {
      await interaction.editReply({
        content: '❌ Invalid button data. Please run the command again.',
      });
      return;
    }

    // Handle "summary" mode (back to main summary)
    if (mode === 'summary') {
      await handleSummaryRequest(interaction, apiService, countryId, minLevel);
      return;
    }

    // Validate mode
    if (!['war', 'eco', 'hybrid'].includes(mode)) {
      await interaction.editReply({
        content: '❌ Invalid mode specified. Please run the command again.',
      });
      return;
    }

    logger.info(`Handling builds button: country=${countryId}, mode=${mode}, page=${pageNumber}`);

    const scan = new ScanService(apiService);

    // Get country name
    const country = await scan.getCountryById(countryId);
    if (!country) {
      await interaction.editReply({
        content: '❌ Could not find the specified country. It may have been deleted.',
      });
      return;
    }
    const countryName = country.name;

    // Show initial loading message
    await interaction.editReply({
      content: `🔄 Loading ${mode} mode players for **${countryName}**...`,
    });

    // Re-fetch user data (no persistent storage, so we rebuild it each time)
    let allUserIds: string[];
    try {
      allUserIds = (await scan.getUserIdsByCountry(countryId)).userIds;
    } catch (error) {
      logger.error('Error fetching users by country in button handler:', error);
      await interaction.editReply({
        content: '❌ Error fetching user list. Please try again.',
      });
      return;
    }

    if (allUserIds.length === 0) {
      await interaction.editReply({
        content: `❌ No citizens found in ${countryName}.`,
      });
      return;
    }

    const users: UserDTO[] = Array.from((await scan.getUsersLiteByIds(allUserIds)).values());

    if (users.length === 0) {
      await interaction.editReply({
        content: `❌ Could not load user data for ${countryName}.`,
      });
      return;
    }

    // Filter by minimum level from the original command
    const filteredUsers = users.filter(user => 
      user && user.leveling && typeof user.leveling.level === 'number' && user.leveling.level >= minLevel
    );

    // Group by mode and get the requested mode
    const groupedUsers = groupPlayersByMode(filteredUsers);
    const modeUsers = groupedUsers[mode as keyof typeof groupedUsers];

    if (modeUsers.length === 0) {
      await interaction.editReply({
        content: `❌ No ${mode} mode players found in ${countryName}.`,
      });
      return;
    }

    // Sort by level
    const sortedUsers = sortUsersByLevel(modeUsers);

    // Format user list with pagination support
    const userListMessages = formatUserList(sortedUsers, mode.charAt(0).toUpperCase() + mode.slice(1), 1800);
    
    if (userListMessages.length === 0) {
      await interaction.editReply({
        content: `❌ No data available for ${mode} mode players.`,
      });
      return;
    }

    // Handle pagination
    const currentPage = Math.max(0, Math.min(pageNumber, userListMessages.length - 1));
    const currentMessage = userListMessages[currentPage];
    
    // Create pagination buttons if needed
    const components: ActionRowBuilder<ButtonBuilder>[] = [];
    
    if (userListMessages.length > 1) {
      const paginationRow = new ActionRowBuilder<ButtonBuilder>();
      
      // Previous page button
      if (currentPage > 0) {
        paginationRow.addComponents(
          new ButtonBuilder()
            .setCustomId(`builds:${countryId}:${mode}:${currentPage - 1}:${minLevel}`)
            .setLabel('◀ Previous')
            .setStyle(ButtonStyle.Secondary)
        );
      }
      
      // Page indicator button (disabled)
      paginationRow.addComponents(
        new ButtonBuilder()
          .setCustomId('page_indicator')
          .setLabel(`Page ${currentPage + 1}/${userListMessages.length}`)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      );
      
      // Next page button
      if (currentPage < userListMessages.length - 1) {
        paginationRow.addComponents(
          new ButtonBuilder()
            .setCustomId(`builds:${countryId}:${mode}:${currentPage + 1}:${minLevel}`)
            .setLabel('Next ▶')
            .setStyle(ButtonStyle.Secondary)
        );
      }
      
      components.push(paginationRow);
    }

    // Back to summary button
    const backRow = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`builds:${countryId}:summary:0:${minLevel}`)
          .setLabel('← Back to Summary')
          .setStyle(ButtonStyle.Primary)
      );
    components.push(backRow);

    // Add header with total count and page info
    let responseContent = currentMessage;
    if (userListMessages.length > 1) {
      responseContent = `**${countryName} - ${mode.charAt(0).toUpperCase() + mode.slice(1)} Mode Players**\n` +
        `Showing ${currentPage + 1} of ${userListMessages.length} pages\n\n` +
        currentMessage;
    }

    await interaction.editReply({
      content: responseContent,
      components: components.length > 0 ? components : undefined,
    });

    logger.info(`Displayed ${mode} mode players for ${countryName}, page ${currentPage + 1}/${userListMessages.length}`);

  } catch (error) {
    logger.error('Error handling builds button interaction:', error);
    
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ An error occurred while processing your request.',
        ephemeral: true,
      });
    } else if (interaction.deferred && !interaction.replied) {
      await interaction.editReply({
        content: '❌ An error occurred while loading the player list. Please try again.',
      });
    }
  }
}

/**
 * Handle request to go back to the main summary
 */
async function handleSummaryRequest(interaction: ButtonInteraction, apiService: ApiService, countryId: string, minLevel: number): Promise<void> {
  try {
    const scan = new ScanService(apiService);

    // Get country name
    const country = await scan.getCountryById(countryId);
    if (!country) {
      await interaction.editReply({
        content: '❌ Could not find the specified country.',
      });
      return;
    }
    const countryName = country.name;

    await interaction.editReply({
      content: `🔄 Regenerating summary for **${countryName}**...`,
    });

    // Re-fetch and analyze users (same logic as in main handler)
    let allUserIds: string[];
    try {
      allUserIds = (await scan.getUserIdsByCountry(countryId)).userIds;
    } catch (error) {
      logger.error('Error fetching users for summary:', error);
      await interaction.editReply({
        content: '❌ Error fetching user data. Please try again.',
      });
      return;
    }

    const users: UserDTO[] = Array.from((await scan.getUsersLiteByIds(allUserIds)).values());

    // Use minimum level from the original command
    const filteredUsers = users.filter(user => 
      user && user.leveling && typeof user.leveling.level === 'number' && user.leveling.level >= minLevel
    );
    const groupedUsers = groupPlayersByMode(filteredUsers);

    // Create summary
    const summary = createBuildSummary(
      countryName,
      allUserIds.length,
      filteredUsers.length,
      minLevel,
      groupedUsers.eco.length,
      groupedUsers.war.length,
      groupedUsers.hybrid.length
    );

    // Create buttons for detailed views
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

  } catch (error) {
    logger.error('Error handling summary request:', error);
    await interaction.editReply({
      content: '❌ Error generating summary. Please try again.',
    });
  }
}