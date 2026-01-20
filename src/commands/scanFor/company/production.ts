import { ChatInputCommandInteraction } from 'discord.js';
import { logger } from '../../../utils/logger';
import type { CompanyDTO } from 'warera-sdk/dist/DTOs/company.dto';
import { ApiService } from '../../../services/api/ApiService';

/**
 * Handle /scanfor company production
 * Scans all companies to count production by item type
 * Optionally filters by country
 */
export async function handleCompanyProduction(interaction: ChatInputCommandInteraction, apiService: ApiService): Promise<void> {
  // Defer reply since this will take a while
  await interaction.deferReply({ ephemeral: false });

  try {
    const apiClient = apiService.getClient();
    const countryName = interaction.options.getString('country');

    // If country filter is provided, fetch and validate it
    let targetCountryId: string | null = null;
    let targetCountryName: string | null = null;
    let validRegionIds: Set<string> | null = null;

    if (countryName) {
      logger.info(`Country filter provided: ${countryName}`);
      
      // Fetch countries and regions in parallel for efficiency
      await interaction.editReply({
        content: '**Company Production Analysis**\n\nFetching country and region information...',
      });

      const [countriesResponse, regionsResponse] = await Promise.all([
        apiClient.country.getAllCountries({ cache: { ttl: 60000 * 60 } }),
        apiClient.region.getRegionsObject({ cache: { ttl: 86400 } })
      ]);

      const allCountries = countriesResponse.result.data;
      const regionsData = regionsResponse.result.data;

      // Find country by name (case-insensitive)
      const matchingCountry = allCountries.find(
        c => c.name.toLowerCase() === countryName.toLowerCase()
      );

      if (!matchingCountry) {
        await interaction.editReply({
          content: `Country "**${countryName}**" not found. Please check spelling and try again.\n\n📖 Reference: https://warera.wiki/country`,
        });
        return;
      }

      targetCountryId = matchingCountry._id;
      targetCountryName = matchingCountry.name;
      logger.info(`Found country: ${targetCountryName} (${targetCountryId})`);

      // Filter regions owned by the target country
      validRegionIds = new Set<string>();
      for (const [regionId, region] of Object.entries(regionsData)) {
        if (region.country === targetCountryId) {
          validRegionIds.add(regionId);
        }
      }

      logger.info(`Found ${validRegionIds.size} regions owned by ${targetCountryName}`);

      if (validRegionIds.size === 0) {
        await interaction.editReply({
          content: `Country "**${targetCountryName}**" does not own any regions. No companies to analyze.`,
        });
        return;
      }
    }

    // Step 1: Get all company IDs using pagination
    const filterText = targetCountryName ? ` in **${targetCountryName}**` : '';
    logger.info(`Phase 1: Fetching all company IDs${filterText}...`);
    await interaction.editReply({
      content: `**Company Production Analysis**\n\n${targetCountryName ? `Country: **${targetCountryName}**\n` : ''}Phase 1: Fetching company IDs...`,
    });

    const allCompanyIds: string[] = [];
    let currentCursor: string | null = null;
    let pageCount = 0;

    do {
      // Fetch companies with pagination (100 per page - maximum allowed)
      const params: any = { perPage: 100 };
      if (currentCursor) {
        params.cursor = currentCursor;
      }

      const companiesResponse = await apiClient.company.getCompanies(params);
      const companiesData = companiesResponse.result.data;

      // Extract company IDs from this page
      if (companiesData.items && Array.isArray(companiesData.items)) {
        for (const companyId of companiesData.items) {
          if (companyId) {
            allCompanyIds.push(companyId);
          }
        }
      }

      // Update cursor for next page
      currentCursor = companiesData.nextCursor || null;
      pageCount++;

      // Update progress
      await interaction.editReply({
        content: 
          `**Company Production Analysis**\n\n` +
          `${targetCountryName ? `Country: **${targetCountryName}**\n` : ''}` +
          `Phase 1: Fetching company IDs...\n` +
          `Pages fetched: ${pageCount}\n` +
          `Companies found so far: ${allCompanyIds.length}`,
      });

      // Small delay between pages to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (currentCursor);

    const companyCount = allCompanyIds.length;
    logger.info(`Found ${companyCount} total companies across ${pageCount} pages`);

    if (companyCount === 0) {
      await interaction.editReply({
        content: 'No companies found in the system.',
      });
      return;
    }

    // Step 2: Get company details for all companies
    logger.info('Phase 2: Fetching company details...');
    await interaction.editReply({
      content: 
        `**Company Production Analysis**\n\n` +
        `${targetCountryName ? `Country: **${targetCountryName}**\n` : ''}` +
        `Phase 1: ✅ Found ${companyCount} companies\n` +
        `Phase 2: Fetching company details...\n` +
        `Progress: 0/${companyCount}\n\n` +
        `This may take a while...`,
    });

    // Batch company detail requests in chunks to avoid 414 URI Too Long error
    const COMPANY_BATCH_SIZE = 100; // Process 10 companies at a time to keep URI length manageable
    const itemStats = new Map<string, { companyCount: number; workerCount: number }>();
    const itemStatsGlobal = new Map<string, { companyCount: number; workerCount: number }>(); // Track global stats when filtering
    let processedCompanies = 0;
    let lastUpdateTime = Date.now();
    const updateIntervalMs = 5000; // Update every 5 seconds

    for (let i = 0; i < allCompanyIds.length; i += COMPANY_BATCH_SIZE) {
      const companyIdChunk = allCompanyIds.slice(i, i + COMPANY_BATCH_SIZE);
      
      // Create a new batch client instance for this command to avoid conflicts
      // Each command execution gets its own isolated queue
      const detailBatchClient = apiService.createCommandBatchClient();

      // Queue company detail requests for this chunk
      const detailPromises = companyIdChunk.map(companyId => 
        detailBatchClient.company.getById({ companyId })
      );

      // Execute batch
      await detailBatchClient.runBatch();

      // Get results and count items
      const detailResults = await Promise.all(detailPromises);

      for (const detailResponse of detailResults) {
        if (detailResponse?.result?.data) {
          const company: CompanyDTO = detailResponse.result.data;
          const itemCode = company.itemCode;
          const workerCount = company.workers?.length || 0;
          
          // Always track global stats when country filter is active
          if (validRegionIds && itemCode) {
            const globalStats = itemStatsGlobal.get(itemCode) || { companyCount: 0, workerCount: 0 };
            itemStatsGlobal.set(itemCode, {
              companyCount: globalStats.companyCount + 1,
              workerCount: globalStats.workerCount + workerCount,
            });
          }
          
          // If country filter is active, check if company is in valid region
          if (validRegionIds) {
            const companyRegion = company.region;
            if (!companyRegion || !validRegionIds.has(companyRegion)) {
              // Skip this company for country-specific stats
              continue;
            }
          }
          
          // Count in main stats (either filtered or global depending on filter)
          if (itemCode) {
            const currentStats = itemStats.get(itemCode) || { companyCount: 0, workerCount: 0 };
            itemStats.set(itemCode, {
              companyCount: currentStats.companyCount + 1,
              workerCount: currentStats.workerCount + workerCount,
            });
          }
        }
      }

      processedCompanies += companyIdChunk.length;

      // Send progress update every 5 seconds
      const now = Date.now();
      if (now - lastUpdateTime >= updateIntervalMs || processedCompanies === companyCount) {
        const progress = Math.floor((processedCompanies / companyCount) * 100);
        await interaction.editReply({
          content:
            `**Company Production Analysis**\n\n` +
            `${targetCountryName ? `Country: **${targetCountryName}**\n` : ''}` +
            `Phase 1: ✅ Found ${companyCount} companies\n` +
            `Phase 2: Analyzing company details...\n` +
            `Progress: ${processedCompanies}/${companyCount} companies (${progress}%)\n` +
            `Item types found: ${itemStats.size}\n\n` +
            `Please wait...`,
        });
        lastUpdateTime = now;
      }

      // Small delay between chunks
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Step 5: Format and send results
    logger.info('Phase 3: Formatting results...');

    // Calculate total workers (country-specific or global)
    let totalWorkers = 0;
    for (const stats of itemStats.values()) {
      totalWorkers += stats.workerCount;
    }

    // Calculate total companies that matched the filter
    let totalFilteredCompanies = 0;
    for (const stats of itemStats.values()) {
      totalFilteredCompanies += stats.companyCount;
    }

    // Sort items by company count (descending)
    const sortedItems = Array.from(itemStats.entries())
      .sort((a, b) => b[1].companyCount - a[1].companyCount);

    let resultMessage = `**Company Production Analysis Complete**\n\n`;
    
    if (targetCountryName) {
      // Calculate global stats for comparison
      let totalGlobalCompanies = 0;
      let totalGlobalWorkers = 0;
      for (const stats of itemStatsGlobal.values()) {
        totalGlobalCompanies += stats.companyCount;
        totalGlobalWorkers += stats.workerCount;
      }

      resultMessage += `**Country Filter:** ${targetCountryName}\n\n`;
      resultMessage += `**Global Stats:**\n`;
      resultMessage += `- Total companies: ${totalGlobalCompanies}\n`;
      resultMessage += `- Total workers: ${totalGlobalWorkers}\n`;
      resultMessage += `- Item types produced: ${itemStatsGlobal.size}\n\n`;
      resultMessage += `**Country Stats (${targetCountryName}):**\n`;
      resultMessage += `- Companies in country: ${totalFilteredCompanies}\n`;
      resultMessage += `- Workers in country: ${totalWorkers}\n`;
      resultMessage += `- Regions owned: ${validRegionIds?.size || 0}\n`;
      resultMessage += `- Item types produced: ${sortedItems.length}\n\n`;
    } else {
      resultMessage += `- Total companies: ${companyCount}\n`;
      resultMessage += `- Total workers: ${totalWorkers}\n`;
      resultMessage += `- Item types produced: ${sortedItems.length}\n\n`;
    }
    
    // Display production lists
    if (targetCountryName) {
      // When filtering by country, show both country-specific and global lists
      
      // Country-specific production list
      resultMessage += `**Production by Item Type (${targetCountryName}):**\n\n`;
      
      for (const [item, stats] of sortedItems) {
        const line = `${item}: ${stats.companyCount} companies, ${stats.workerCount} workers\n`;
        
        // Check if adding this line would exceed Discord's limit
        if (resultMessage.length + line.length > 1900) {
          // Send current message
          await interaction.editReply({
            content: resultMessage + `\n_...continued in next message..._`,
          });
          
          // Start new message
          resultMessage = `**Production by Item Type (${targetCountryName}) - continued**\n\n`;
        }
        
        resultMessage += line;
      }
      
      // Send country-specific list
      await interaction.editReply({
        content: resultMessage,
      });
      
      // Now display global production list
      const sortedGlobalItems = Array.from(itemStatsGlobal.entries())
        .sort((a, b) => b[1].companyCount - a[1].companyCount);
      
      let globalMessage = `\n**Production by Item Type (Global):**\n\n`;
      
      for (const [item, stats] of sortedGlobalItems) {
        const line = `${item}: ${stats.companyCount} companies, ${stats.workerCount} workers\n`;
        
        // Check if adding this line would exceed Discord's limit
        if (globalMessage.length + line.length > 1900) {
          // Send current message as follow-up
          await interaction.followUp({
            content: globalMessage + `\n_...continued in next message..._`,
          });
          
          // Start new message
          globalMessage = `**Production by Item Type (Global) - continued**\n\n`;
        }
        
        globalMessage += line;
      }
      
      // Send global list as follow-up
      await interaction.followUp({
        content: globalMessage,
      });
      
    } else {
      // No country filter - show only global list
      resultMessage += `**Production by Item Type:**\n\n`;
      
      for (const [item, stats] of sortedItems) {
        const line = `${item}: ${stats.companyCount} companies, ${stats.workerCount} workers\n`;
        
        // Check if adding this line would exceed Discord's limit
        if (resultMessage.length + line.length > 1900) {
          // Send current message
          await interaction.editReply({
            content: resultMessage + `\n_...continued in next message..._`,
          });
          
          // Start new message
          resultMessage = `**Company Production Analysis (continued)**\n\n`;
        }
        
        resultMessage += line;
      }
      
      // Send final message
      await interaction.editReply({
        content: resultMessage,
      });
    }

    if (targetCountryName) {
      let totalGlobalCompanies = 0;
      for (const stats of itemStatsGlobal.values()) {
        totalGlobalCompanies += stats.companyCount;
      }
      logger.info(`Company production scan complete for ${targetCountryName}: ${totalGlobalCompanies} global companies, ${totalFilteredCompanies} in ${targetCountryName}, ${totalWorkers} workers in country, ${sortedItems.length} item types`);
    } else {
      logger.info(`Company production scan complete: ${companyCount} companies scanned, ${totalWorkers} workers, ${sortedItems.length} item types`);
    }
  } catch (error) {
    logger.error('Failed to scan company production', error);
    await interaction.editReply({
      content: 'Failed to complete the scan. Please check the logs for details.',
    });
  }
}
