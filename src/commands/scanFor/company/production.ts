import { ChatInputCommandInteraction } from 'discord.js';
import { logger } from '../../../utils/logger';
import { apiClient } from '../../../services/api/ApiService';

/**
 * Handle /scanfor company production
 * Scans all companies to count production by item type
 * Optionally filters by country
 */
export async function handleCompanyProduction(interaction: ChatInputCommandInteraction): Promise<void> {
  // Defer reply since this will take a while
  await interaction.deferReply({ ephemeral: false });

  try {
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

      const [allCountries, regionsData]  = await Promise.all([
        apiClient.country.getAllCountries(),
        apiClient.region.getRegionsObject()
      ]);

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

    const filterText = targetCountryName ? ` in **${targetCountryName}**` : '';
    logger.info(`Phase 1: Fetching all company IDs${filterText}...`);
    await interaction.editReply({
      content: `**Company Production Analysis**\n\n${targetCountryName ? `Country: **${targetCountryName}**\n` : ''}Phase 1: Fetching company IDs...`,
    });

    const allCompanyIds: string[] = [];
    let pageCount = 0;

    const companyPromises: Promise<any>[] = [];
    
    const itemStats = new Map<string, { companyCount: number; workerCount: number }>();
    const itemStatsGlobal = new Map<string, { companyCount: number; workerCount: number }>(); // Track global stats when filtering

    // Step 1: Get all company IDs using pagination
    for await (const companies of apiClient.company.getCompanies({
      perPage: 100,
      autoPaginate: true,
    })) {
      pageCount++;
      
      allCompanyIds.push(...companies.items);

      // Step 2: Get company details for all companies
      // This will trigger the promises and batch it together
      const companyDetails = Promise.all(companies.items.map(companyId =>
        apiClient.company.getById({ companyId })
      ));

      // Push it to the array to await later, but we don't await here to allow batching
      companyPromises.push(companyDetails);
      
      await interaction.editReply({
        content: 
          `**Company Production Analysis**\n\n` +
          `${targetCountryName ? `Country: **${targetCountryName}**\n` : ''}` +
          `Fetching company details...\n` +
          `Pages fetched: ${pageCount}\n` +
          `Companies found so far: ${allCompanyIds.length}` +
          `\nThis may take a while...`,
      });
    }

    // Wait for all promises to resolve
    await Promise.all(companyPromises);


    // TODO: Need to replace all of this and move it into the loop above
    // Batch company detail requests in chunks to avoid 414 URI Too Long error
    const COMPANY_BATCH_SIZE = 100; // Process 10 companies at a time to keep URI length manageable
    let processedCompanies = 0;
    let lastUpdateTime = Date.now();
    const updateIntervalMs = 5000; // Update every 5 seconds

    for (let i = 0; i < allCompanyIds.length; i += COMPANY_BATCH_SIZE) {
      const companyIdChunk = allCompanyIds.slice(i, i + COMPANY_BATCH_SIZE);
      
      // Create a new batch client instance for this command to avoid conflicts
      // Each command execution gets its own isolated queue

      // Queue company detail requests for this chunk
      const detailPromises = companyIdChunk.map(companyId => 
        apiClient.company.getById({ companyId })
      );

      // Get results and count items
      const detailResults = await Promise.all(detailPromises);

      for (const detailResponse of detailResults) {
        if (detailResponse) {
          const company = detailResponse;
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
    }
    // TODO End

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
