import { ButtonInteraction, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { logger } from '../../../utils/logger';
import { GetUserLiteResponse, GetUsersByCountryParams } from 'warera-sdk';
import { ApiService } from '../../../services/api/ApiService';

// Type alias for the actual user data from the API response
type UserDTO = NonNullable<GetUserLiteResponse['result']['data']>;
import { groupPlayersByMode, sortUsersByLevel } from '../../../utils/skillAnalyzer';
import { formatUserList, createBuildSummary } from '../../../utils/userStatusFormatter';

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

    const apiClient = apiService.getClient();

    // Get country name
    let countryName: string;
    try {
      const countryResponse = await apiClient.country.getCountryById(countryId);
      countryName = countryResponse.result.data.name;
    } catch {
      await interaction.editReply({
        content: '❌ Could not find the specified country. It may have been deleted.',
      });
      return;
    }

    // Show initial loading message
    await interaction.editReply({
      content: `🔄 Loading ${mode} mode players for **${countryName}**...`,
    });

    // Re-fetch user data (we need to do this since we don't have persistent storage)
    // In a production app, you might want to cache this data temporarily
    let allUserIds: string[] = [];
    let cursor: string | null = null;

    // Get all user IDs for the country with pagination
    let pageCount = 0;
    const MAX_PAGES = 1000; // Safety limit to prevent infinite loops
    do {
      try {
        // Use updated SDK method with pagination parameters
        const params: GetUsersByCountryParams = { countryId, limit: 100 };
        if (cursor) {
          params.cursor = cursor;
        }
        const usersResponse = await apiClient.user.getUsersByCountry(params);
        const usersData = usersResponse.result.data;
        
        allUserIds.push(...usersData.items.map((item: any) => item._id));
        cursor = usersData.nextCursor;
        pageCount++;
        
        logger.info(`Button handler: Fetched ${usersData.items.length} user IDs (page ${pageCount}), total so far: ${allUserIds.length}`);
        
        // Small delay to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        logger.error('Error fetching users by country in button handler:', error);
        await interaction.editReply({
          content: '❌ Error fetching user list. Please try again.',
        });
        return;
      }
    } while (cursor && pageCount < MAX_PAGES);

    if (pageCount >= MAX_PAGES) {
      logger.warn(`Hit maximum page limit (${MAX_PAGES}) for country ${countryId} in button handler`);
      // Continue processing with the users we have
    }

    if (allUserIds.length === 0) {
      await interaction.editReply({
        content: `❌ No citizens found in ${countryName}.`,
      });
      return;
    }

    // Batch fetch user details
    const USER_BATCH_SIZE = 100;
    const users: UserDTO[] = [];
    
    for (let i = 0; i < allUserIds.length; i += USER_BATCH_SIZE) {
      const userIdChunk = allUserIds.slice(i, i + USER_BATCH_SIZE);
      
      const batchClient = apiService.createCommandBatchClient();
      const userPromises = userIdChunk.map(userId => 
        batchClient.user.getUserLite(userId)
      );
      
      try {
        await batchClient.runBatch();
        const userResults = await Promise.all(userPromises);
        
        for (const result of userResults) {
          if (result?.result?.data) {
            users.push(result.result.data);
          }
        }
        
        // Small delay to be respectful to API
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        logger.error(`Error processing user batch in button handler:`, error);
        // Continue with next batch
      }
    }

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
    const apiClient = apiService.getClient();

    // Get country name
    let countryName: string;
    try {
      const countryResponse = await apiClient.country.getCountryById(countryId);
      countryName = countryResponse.result.data.name;
    } catch {
      await interaction.editReply({
        content: '❌ Could not find the specified country.',
      });
      return;
    }

    await interaction.editReply({
      content: `🔄 Regenerating summary for **${countryName}**...`,
    });

    // Re-fetch and analyze users (same logic as in main handler)
    let allUserIds: string[] = [];
    let cursor: string | null = null;
    let pageCount = 0;
    const MAX_PAGES = 1000; // Safety limit to prevent infinite loops
    do {
      try {
        // Use updated SDK method with pagination parameters
        const params: GetUsersByCountryParams = { countryId, limit: 100 };
        if (cursor) {
          params.cursor = cursor;
        }
        const usersResponse = await apiClient.user.getUsersByCountry(params);
        const usersData = usersResponse.result.data;
        
        allUserIds.push(...usersData.items.map((item: any) => item._id));
        cursor = usersData.nextCursor;
        pageCount++;
        
        logger.info(`Summary: Fetched ${usersData.items.length} user IDs (page ${pageCount}), total so far: ${allUserIds.length}`);
        
        // Small delay to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        logger.error('Error fetching users for summary:', error);
        await interaction.editReply({
          content: '❌ Error fetching user data. Please try again.',
        });
        return;
      }
    } while (cursor && pageCount < MAX_PAGES);

    if (pageCount >= MAX_PAGES) {
      logger.warn(`Hit maximum page limit (${MAX_PAGES}) for country ${countryId} in summary`);
      // Continue processing with the users we have
    }

    // Batch fetch user details
    const USER_BATCH_SIZE = 100;
    const users: UserDTO[] = [];
    
    for (let i = 0; i < allUserIds.length; i += USER_BATCH_SIZE) {
      const userIdChunk = allUserIds.slice(i, i + USER_BATCH_SIZE);
      
      const batchClient = apiService.createCommandBatchClient();
      const userPromises = userIdChunk.map(userId => 
        batchClient.user.getUserLite(userId)
      );
      
      try {
        await batchClient.runBatch();
        const userResults = await Promise.all(userPromises);
        
        for (const result of userResults) {
          if (result?.result?.data) {
            users.push(result.result.data);
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        logger.error(`Error processing user batch for summary:`, error);
      }
    }

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