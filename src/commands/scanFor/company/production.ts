import { ChatInputCommandInteraction } from 'discord.js';
import { logger } from '../../../utils/logger';
import type { CompanyDTO } from 'warera-sdk/dist/DTOs/company.dto';
import { ApiService } from '../../../services/api/ApiService';

/**
 * Handle /scanfor company production
 * Scans all companies to count production by item type
 */
export async function handleCompanyProduction(interaction: ChatInputCommandInteraction, apiService: ApiService): Promise<void> {
  // Defer reply since this will take a while
  await interaction.deferReply({ ephemeral: false });

  try {
    const apiClient = apiService.getClient();

    // Step 1: Get all company IDs using pagination
    logger.info('Phase 1: Fetching all company IDs...');
    await interaction.editReply({
      content: '**Company Production Analysis**\n\nPhase 1: Fetching company IDs...',
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
        `Phase 1: ✅ Found ${companyCount} companies\n` +
        `Phase 2: Fetching company details...\n` +
        `Progress: 0/${companyCount}\n\n` +
        `This may take a while...`,
    });

    // Batch company detail requests in chunks to avoid 414 URI Too Long error
    const COMPANY_BATCH_SIZE = 10; // Process 10 companies at a time to keep URI length manageable
    const itemCounts = new Map<string, number>();
    let processedCompanies = 0;
    let lastUpdateTime = Date.now();
    const updateIntervalMs = 5000; // Update every 5 seconds

    for (let i = 0; i < allCompanyIds.length; i += COMPANY_BATCH_SIZE) {
      const companyIdChunk = allCompanyIds.slice(i, i + COMPANY_BATCH_SIZE);
      
      const detailBatchClient = apiService.createBatchClient();

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
          if (itemCode) {
            const currentCount = itemCounts.get(itemCode) || 0;
            itemCounts.set(itemCode, currentCount + 1);
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
            `Phase 1: ✅ Found ${companyCount} companies\n` +
            `Phase 2: Analyzing company details...\n` +
            `Progress: ${processedCompanies}/${companyCount} companies (${progress}%)\n` +
            `Item types found: ${itemCounts.size}\n\n` +
            `Please wait...`,
        });
        lastUpdateTime = now;
      }

      // Small delay between chunks
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Step 5: Format and send results
    logger.info('Phase 3: Formatting results...');

    // Sort items by count (descending)
    const sortedItems = Array.from(itemCounts.entries())
      .sort((a, b) => b[1] - a[1]);

    let resultMessage = `**Company Production Analysis Complete**\n\n`;
    resultMessage += `- Total companies: ${companyCount}\n`;
    resultMessage += `- Item types produced: ${sortedItems.length}\n\n`;
    resultMessage += `**Companies by Item Type:**\n\n`;

    // Discord has a 2000 character limit, so we may need to split the message
    for (const [item, count] of sortedItems) {
      const line = `${item}: ${count}\n`;
      
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

    logger.info(`Company production scan complete: ${companyCount} companies, ${sortedItems.length} item types`);
  } catch (error) {
    logger.error('Failed to scan company production', error);
    await interaction.editReply({
      content: 'Failed to complete the scan. Please check the logs for details.',
    });
  }
}
