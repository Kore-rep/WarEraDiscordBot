import { ChatInputCommandInteraction } from 'discord.js';
import { logger } from '../../../utils/logger';
import { GetAllCountriesResponse, GetGovernmentByCountryIdResponse, GetUserLiteResponse } from '../../../services/api/WarEraApiClient';
import { ApiService } from '../../../services/api/ApiService';
import { ServerConfigManager } from '../../../utils/serverConfigManager';

/**
 * Handle /scanfor country nogovernment
 * Scans countries to find those with no government or partial governments approaching inactivity
 */
export async function handleCountryNoGovernment(interaction: ChatInputCommandInteraction, apiService: ApiService): Promise<void> {
  // Defer reply since this will take a while
  await interaction.deferReply({ ephemeral: false });

  try {
    const apiClient = apiService.getClient();
    const groupName = interaction.options.getString('group');
    const serverId = interaction.guildId!;

    // Step 1: Get countries (either all or from a group)
    let countries: any[];
    let scanScope = 'all countries';

    if (groupName) {
      // Get countries from the specified group
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

      // Fetch full country data for countries in the group
      logger.info(`Fetching ${group.countries.length} countries from group "${groupName}"...`);
      const countryIds = group.countries.map(c => c.countryId);
      
      // Batch country requests for better rate limit efficiency
      // Create a new batch client instance for this command to avoid conflicts
      // Each command execution gets its own isolated queue
      const batchClient = apiService.createCommandBatchClient();
      const countryPromises = countryIds.map(id => 
        batchClient.country.getCountryById(id, { cache: { ttl: 86400 } })
      );
      await batchClient.runBatch();
      const countryResponses = await Promise.all(countryPromises);
      
      countries = countryResponses
        .map(response => response?.result?.data)
        .filter(country => country !== null && country !== undefined);
      
      scanScope = `group "${groupName}" (${countries.length} countries)`;
      logger.info(`Scanning ${countries.length} countries from group "${groupName}"`);
    } else {
      // Get all countries
      logger.info('Fetching all countries...');
      const countriesResponse = await apiClient.country.getAllCountries() as GetAllCountriesResponse;
      countries = countriesResponse.result.data;
      logger.info(`Found ${countries.length} total countries to scan`);
    }

    const countryCount = countries.length;

    if (countryCount === 0) {
      await interaction.editReply({
        content: 'No countries found in the system.',
      });
      return;
    }

    logger.info(`Found ${countryCount} countries to scan`);

    // Step 2: Calculate estimated time
    // Phase 1: Scan governments (batched - up to 100 per batch = 1 request)
    // Each batch counts as 1 request, so we need ceil(countries/100) batches
    const governmentBatches = Math.ceil(countryCount / 100);
    const governmentScanSeconds = governmentBatches * 1; // Each batch is ~1 second
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
        `**Country Government Scan Initiated**\n\n` +
        `- Scan scope: ${scanScope}\n` +
        `- Total countries: ${countryCount}\n` +
        `- Estimated time: ~${timeEstimate}\n` +
        `- Status: Scanning governments...\n\n` +
        `This may take a while. Please wait...`,
    });

    // Step 3: Scan all countries for government members
    interface CountryGovernmentData {
      countryId: string;
      countryName: string;
      governmentMemberIds: string[]; // All gov members (president, congress, etc.)
      governmentCount: number;
    }

    const countryGovernmentMap: CountryGovernmentData[] = [];
    let processedCount = 0;
    let lastUpdateTime = Date.now();
    const updateIntervalMs = 5000; // Update every 5 seconds

    // Batch government requests in chunks of up to 100 for better rate limit efficiency
    const GOVERNMENT_BATCH_SIZE = 100;
    
    for (let i = 0; i < countries.length; i += GOVERNMENT_BATCH_SIZE) {
      const countryChunk = countries.slice(i, i + GOVERNMENT_BATCH_SIZE);
      
      // Create a new batch client instance for this command to avoid conflicts
      // Each command execution gets its own isolated queue
      const govBatchClient = apiService.createCommandBatchClient();
      
      // Queue all government requests for this chunk
      const govPromises = countryChunk.map(country => 
        govBatchClient.government.getByCountryId(country._id)
      );
      
      // Execute batch (all requests in chunk count as 1 request toward rate limit)
      await govBatchClient.runBatch();
      
      // Get all results
      const govResults = await Promise.all(govPromises);
      
      // Process results
      for (let j = 0; j < countryChunk.length; j++) {
        const country = countryChunk[j];
        const govResponse = govResults[j] as GetGovernmentByCountryIdResponse | undefined;
        
        try {
          if (!govResponse?.result?.data) {
            throw new Error('Invalid response');
          }
          
          const government = govResponse.result.data;

          // Collect all government member IDs
          const governmentMemberIds: string[] = [];
          
          if (government.president) {
            governmentMemberIds.push(government.president);
          }
          
          if (government.congressMembers && Array.isArray(government.congressMembers)) {
            governmentMemberIds.push(...government.congressMembers);
          }

          // Note: If there are vicePresident or ministers fields in the future, add them here
          if (government.vicePresident) governmentMemberIds.push(government.vicePresident);
          if (government.minOfDefense) governmentMemberIds.push(government.minOfDefense);
          if (government.minOfForeignAffairs) governmentMemberIds.push(government.minOfForeignAffairs);
          if (government.minOfEconomy) governmentMemberIds.push(government.minOfEconomy);
          
          countryGovernmentMap.push({
            countryId: country._id,
            countryName: country.name,
            governmentMemberIds,
            governmentCount: governmentMemberIds.length,
          });
        } catch (error) {
          logger.error(`Failed to fetch government data for country ${country._id} (${country.name})`, error);
          countryGovernmentMap.push({
            countryId: country._id,
            countryName: country.name,
            governmentMemberIds: [],
            governmentCount: 0,
          });
        }
        
        processedCount++;

        // Send progress update every 5 seconds
        const now = Date.now();
        if (now - lastUpdateTime >= updateIntervalMs) {
          const progress = Math.floor((processedCount / countryCount) * 100);
          const withGovernment = countryGovernmentMap.filter(c => c.governmentCount > 0).length;
          await interaction.editReply({
            content:
              `**Country Government Scan In Progress**\n\n` +
              `- Phase 1: Scanning governments\n` +
              `- Processed: ${processedCount}/${countryCount} (${progress}%)\n` +
              `- Countries with government: ${withGovernment}\n` +
              `- Status: Scanning...\n\n` +
              `Please wait...`,
          });
          lastUpdateTime = now;
        }
      }
    }

    // Step 4: Categorize countries - only care about 0 or 1 member governments
    const countriesWithNoGovernment = countryGovernmentMap.filter(c => c.governmentCount === 0);
    const countriesWithOneMember = countryGovernmentMap.filter(c => c.governmentCount === 1);

    logger.info(
      `Categorized: ${countriesWithNoGovernment.length} no gov, ` +
      `${countriesWithOneMember.length} with 1 member, ` +
      `${countryGovernmentMap.length - countriesWithNoGovernment.length - countriesWithOneMember.length} with 2+ members`
    );

    // Step 5: For countries with 1 member, fetch user activity data
    interface OneMemberCountry {
      countryId: string;
      countryName: string;
      memberId: string;
      username: string;
      hoursSinceActive: number;
      hoursUntilInactive: number;
    }

    const countriesWithInactiveMember: OneMemberCountry[] = [];
    const countriesApproachingInactivity: OneMemberCountry[] = [];

    if (countriesWithOneMember.length > 0) {
      await interaction.editReply({
        content: 
          `**Country Government Scan In Progress**\n\n` +
          `- Phase 2: Fetching activity data for single-member governments\n` +
          `- Checking ${countriesWithOneMember.length} countries with 1 government member...\n` +
          `- Status: Please wait...`,
      });

      // Collect all member IDs
      const allMemberIds = new Set<string>();
      for (const country of countriesWithOneMember) {
        country.governmentMemberIds.forEach(id => allMemberIds.add(id));
      }

      logger.info(`Fetching activity data for ${allMemberIds.size} government members...`);

      // Create a new batch client instance for this command to avoid conflicts
      // Each command execution gets its own isolated queue
      const batchClient = apiService.createCommandBatchClient();

      // Queue all user requests
      const memberIdArray = Array.from(allMemberIds);
      const userPromises = memberIdArray.map(memberId => 
        batchClient.user.getUserLite(memberId)
      );

      // Execute batch
      await batchClient.runBatch();

      // Get all results
      const userResults = await Promise.all(userPromises);

      // Create a map of userId -> user data
      const userDataMap = new Map<string, any>();
      for (let i = 0; i < memberIdArray.length; i++) {
        const userResponse = userResults[i] as GetUserLiteResponse;
        if (userResponse?.result?.data) {
          userDataMap.set(memberIdArray[i], userResponse.result.data);
        }
      }

      // Check each country with 1 member
      const now = new Date();
      for (const country of countriesWithOneMember) {
        const memberId = country.governmentMemberIds[0];
        const userData = userDataMap.get(memberId);
        
        if (!userData) {
          logger.warn(`Failed to fetch user data for member ${memberId} of ${country.countryName}`);
          continue;
        }

        const lastConnection = new Date(userData.dates.lastConnectionAt);
        const hoursSinceConnection = (now.getTime() - lastConnection.getTime()) / (1000 * 60 * 60);
        const hoursUntilInactive = Math.ceil(72 - hoursSinceConnection);
        
        const memberData: OneMemberCountry = {
          countryId: country.countryId,
          countryName: country.countryName,
          memberId,
          username: userData.username,
          hoursSinceActive: Math.floor(hoursSinceConnection),
          hoursUntilInactive,
        };

        // Already inactive (>= 72 hours)
        if (hoursSinceConnection >= 72) {
          countriesWithInactiveMember.push(memberData);
        }
        // Approaching inactivity (69-72 hours)
        else if (hoursSinceConnection >= 69) {
          countriesApproachingInactivity.push(memberData);
        }
      }

      logger.info(
        `Found ${countriesWithInactiveMember.length} with inactive member, ` +
        `${countriesApproachingInactivity.length} approaching inactivity`
      );
    }

    // Step 6: Format and send results (split into multiple messages)
    const MAX_MESSAGE_LENGTH = 1950; // Leave some buffer for Discord's 2000 char limit
    
    // Send summary message first
    const summaryMessage = 
      `**Country Government Scan Complete**\n\n` +
      `- Scan scope: ${scanScope}\n` +
      `- Total countries scanned: ${countryCount}\n` +
      `- Countries with no government: ${countriesWithNoGovernment.length}\n` +
      `- Countries with 1 member (inactive): ${countriesWithInactiveMember.length}\n` +
      `- Countries with 1 member (approaching inactivity): ${countriesApproachingInactivity.length}`;

    await interaction.editReply({
      content: summaryMessage,
    });

    // Helper function to split a list into multiple messages
    const sendListInChunks = async (title: string, items: string[]) => {
      if (items.length === 0) return;

      let currentMessage = `**${title}**\n`;
      
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        
        // If adding this item would exceed the limit, send current message and start a new one
        if (currentMessage.length + item.length + 1 > MAX_MESSAGE_LENGTH) {
          await interaction.followUp({ content: currentMessage });
          currentMessage = `**${title} (continued)**\n` + item + '\n';
        } else {
          currentMessage += item + '\n';
        }
      }
      
      // Send any remaining content
      if (currentMessage.length > title.length + 10) {
        await interaction.followUp({ content: currentMessage });
      }
    };

    // Section 1: Countries with NO government
    if (countriesWithNoGovernment.length > 0) {
      const noGovItems = countriesWithNoGovernment.map(c => `- ${c.countryName} (\`${c.countryId}\`)`);
      await sendListInChunks('🚨 Countries With No Government:', noGovItems);
    }

    // Section 2: Countries with 1 member who is INACTIVE
    if (countriesWithInactiveMember.length > 0) {
      const inactiveItems = countriesWithInactiveMember.map(c => 
        `- ${c.countryName} (\`${c.countryId}\`) - ${c.username} - ${c.hoursSinceActive}h ago (INACTIVE)`
      );
      await sendListInChunks('❌ Countries With 1 Inactive Member:', inactiveItems);
    }

    // Section 3: Countries with 1 member APPROACHING inactivity
    if (countriesApproachingInactivity.length > 0) {
      const approachingItems = countriesApproachingInactivity.map(c => 
        `- ${c.countryName} (\`${c.countryId}\`) - ${c.username} - ${c.hoursSinceActive}h ago, inactive in: ~${c.hoursUntilInactive}h`
      );
      await sendListInChunks('⚠️ Countries With 1 Member Approaching Inactivity:', approachingItems);
    }

    logger.info(
      `Scan complete: ${countriesWithNoGovernment.length} no gov, ` +
      `${countriesWithInactiveMember.length} with inactive member, ` +
      `${countriesApproachingInactivity.length} approaching inactivity`
    );
  } catch (error) {
    logger.error('Failed to scan countries for governments', error);
    await interaction.editReply({
      content: 'Failed to complete the scan. Please check the logs for details.',
    });
  }
}
