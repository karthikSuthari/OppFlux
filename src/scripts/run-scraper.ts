// ===========================================
// Standalone Web Scraper Runner for GitHub Actions
// ===========================================

import { config } from '../config/env.js';
import { createServiceLogger } from '../utils/logger.js';
import * as sheetsService from '../services/sheets.service.js';
import { runWebScraper } from '../services/web-scraper.service.js';
import { processScrapedOpportunity } from '../pipeline/runner.js';
import type { PipelineRunSummary } from '../types/index.js';
import { sleep } from '../utils/retry.js';

const log = createServiceLogger('scraper-action');

async function main() {
  log.info('╔═══════════════════════════════════════════════╗');
  log.info('║   Standalone Web Scraper Engine               ║');
  log.info('╚═══════════════════════════════════════════════╝');

  const summary: PipelineRunSummary = {
    startTime: new Date(),
    endTime: new Date(),
    durationMs: 0,
    channelsChecked: 0,
    videosFound: 0,
    videosProcessed: 0,
    opportunitiesCreated: 0,
    contentGenerated: 0,
    imagesGenerated: 0,
    duplicatesSkipped: 0,
    nonOpportunitiesSkipped: 0,
    telegramSent: 0,
    errors: 0,
    errorDetails: [],
  };

  try {
    log.info('Step 1: Connecting to Google Sheets...');
    await sheetsService.initializeSheets();

    log.info('Step 2: Running web scraper...');
    const scrapedOpportunities = await runWebScraper();
    log.info(`Web scraper returned ${scrapedOpportunities.length} opportunities`);

    for (const scraped of scrapedOpportunities) {
      try {
        await processScrapedOpportunity(scraped.extraction, scraped.sourceUrl, scraped.sourceName, summary);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        log.error(`Scraped opportunity processing failed: "${scraped.extraction.opportunity_name}"`, { error: errMsg });
        summary.errors++;
        summary.errorDetails.push(`Scraped "${scraped.extraction.opportunity_name}": ${errMsg}`);
      }
      await sleep(config.geminiRateLimitMs);
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error('Fatal scraper error', { error: errMsg });
    process.exit(1);
  }

  log.info(`✅ Web scraping complete. Found ${summary.opportunitiesCreated} new opportunities.`);
  process.exit(0);
}

main();
