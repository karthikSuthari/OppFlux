// ===========================================
// Pipeline Runner — Main Orchestration
// ===========================================

import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/env.js';
import { createServiceLogger } from '../utils/logger.js';
import { sleep } from '../utils/retry.js';
import * as sheetsService from '../services/sheets.service.js';
import { fetchChannelFeed } from '../services/rss.service.js';
import { extractOpportunity } from '../services/gemini-extract.service.js';
import { generateContent } from '../services/gemini-content.service.js';
import { generateImageLocal } from '../services/gemini-image.service.js';
import { uploadImage } from '../services/cloud-storage.service.js';
import { checkDuplicate, checkScrapedDuplicate } from '../services/duplicate.service.js';
import { sendDiscordMessage, sendDiscordReviewMessage } from '../services/discord.service.js';
import { savePendingOpportunity } from '../services/pending-store.service.js';
import { runWebScraper } from '../services/web-scraper.service.js';
import type {
  PipelineRunSummary,
  Opportunity,
  Content,
  VideoEntry,
  GeminiExtraction,
} from '../types/index.js';

const log = createServiceLogger('pipeline');
const OPPORTUNITY_KEYWORDS = [

  'hackathon',
  'internship',
  'scholarship',
  'fellowship',

  'ambassador',
  'facilitator',

  'stipend',
  'cash prize',
  '5 lakh',
  '1 lakh',

  'competition',
  'contest',
  'challenge',

  'certificate',

  'bootcamp',

  'google arcade',
  'arcade facilitator',

  'gsoc',
  'season of docs',
  'season of ai',

  'grant',
  'funding',

  'career summit',
  'summit',

  'apply now',
  'registrations open',
  'last date',
  'deadline'

];
function mightBeOpportunity(video: VideoEntry): boolean {

  const title = video.title.toLowerCase();
  const description = (video.description || '').toLowerCase();

  const matched = OPPORTUNITY_KEYWORDS.find(
    keyword =>
      title.includes(keyword) ||
      description.includes(keyword)
  );

  if (matched) {

    log.info(
      `🎯 Keyword matched "${matched}" in "${video.title}"`
    );

    return true;
  }

  log.info(
    `⏭️ Keyword skipped "${video.title}"`
  );

  return false;
}


function isSuspiciousVideo(video: VideoEntry): boolean {

  const title = video.title.toLowerCase();

  const blacklist = [

    'live',
    'stream',

    'podcast',

    'q&a',

    'delete youtube',

    'motivation',

    'after 12th',

    'aman jindal live'

  ];


  const matched = blacklist.find(
    k => title.includes(k)
  );

  if (matched) {

    log.info(
      `⏭️ Suspicious skipped because "${matched}"`
    );

    return true;
  }

  return false;

}

function shouldSkipVideo(video: VideoEntry): boolean {

  if (isSuspiciousVideo(video)) {

    log.info(
      `⏭️ Suspicious video skipped: "${video.title}"`
    );

    return true;
  }

  if (!mightBeOpportunity(video)) {
    log.info(`⏭️ Keyword filter skipped: "${video.title}"`);
    return true;
  }

  return false;
}
/**
 * Run the complete opportunity content pipeline:
 *
 * 1. Connect to Google Sheets
 * 2. Fetch active channels
 * 3. For each channel, fetch RSS feed
 * 4. For each video: duplicate check → extract → generate content → generate image → save → send to Telegram
 * 5. Log summary
 */
export async function runPipeline(): Promise<PipelineRunSummary> {
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

  log.info('═══════════════════════════════════════════');
  log.info('🚀 Pipeline run started');
  log.info(`   Mode: ${config.dryRun ? '🔍 DRY RUN (no writes)' : '✅ LIVE'}`);
  log.info('═══════════════════════════════════════════');

  try {
    // Step 1: Initialize Google Sheets
    log.info('Step 1: Connecting to Google Sheets...');
    await sheetsService.initializeSheets();

    // Step 2: Get active channels
    log.info('Step 2: Fetching active channels...');
    const channels = await sheetsService.getActiveChannels();
    summary.channelsChecked = channels.length;

    if (channels.length === 0) {
      log.warn('No active channels found. Add channels to the "Channels" tab.');
      return finalizeSummary(summary);
    }

    log.info(`Found ${channels.length} active channels`);

    // Step 3: Process each channel
    for (const channel of channels) {
      log.info(`\n─── Processing channel: "${channel.channel_name}" ───`);

      try {
        await processChannel(channel.channel_id, channel.channel_name, summary);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        log.error(`Channel processing failed: "${channel.channel_name}"`, { error: errMsg });
        summary.errors++;
        summary.errorDetails.push(`Channel "${channel.channel_name}": ${errMsg}`);
      }

      // Brief pause between channels
      await sleep(500);
    }

    // Step 4: Web Scraping
    log.info('\nStep 4: Web scraper is now handled by GitHub Actions to save memory.');
    /*
    try {
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
      log.error('Web scraping step failed', { error: errMsg });
      summary.errors++;
      summary.errorDetails.push(`Web Scraper: ${errMsg}`);
    }
    */

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error('Pipeline run failed', { error: errMsg });
    summary.errors++;
    summary.errorDetails.push(`Pipeline: ${errMsg}`);
  }

  return finalizeSummary(summary);
}

/**
 * Process all videos from a single channel
 */
async function processChannel(
  channelId: string,
  channelName: string,
  summary: PipelineRunSummary
): Promise<void> {
  // Fetch RSS feed
  const videos = await fetchChannelFeed(channelId, channelName);
  summary.videosFound += videos.length;

  if (videos.length === 0) {
    log.info(`No videos found for "${channelName}"`);
    return;
  }

  // Process each video
  for (const video of videos) {
    try {
      await processVideo(video, summary);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      log.error(`Video processing failed: "${video.title}"`, {
        videoId: video.videoId,
        error: errMsg,
      });
      summary.errors++;
      summary.errorDetails.push(`Video "${video.title}": ${errMsg}`);
    }

    // Rate limiting between videos
    await sleep(config.geminiRateLimitMs);
  }
}

/**
 * Process a single video through the full pipeline:
 * Duplicate check → Extract → Content → Image → Save → Telegram review
 */
async function processVideo(
  video: VideoEntry,
  summary: PipelineRunSummary
): Promise<void> {
  log.info(`\n  📹 Processing: "${video.title}"`);
  log.debug('Video details', {
    videoId: video.videoId,
    link: video.link,
    publishedAt: video.publishedAt,
    descriptionLength: video.description.length,
  });

  summary.videosProcessed++;
  if (shouldSkipVideo(video)) {
    summary.nonOpportunitiesSkipped++;
    return;
  }

  // ── Step A: Pre-extraction duplicate check (Video ID) ──
  const preCheck = await checkDuplicate(video, null);
  if (preCheck.isDuplicate) {
    log.info(`  ⏭️ Skipping (duplicate): ${preCheck.reason}`);
    summary.duplicatesSkipped++;
    return;
  }

  // ── Step B: Extract opportunity data via Groq ──
  log.info('  🤖 Extracting opportunity data...');
  await sleep(config.geminiRateLimitMs);

  const mustContain = [

    'hackathon',

    'internship',

    'scholarship',
    'fellowship',

    'ambassador',

    'facilitator',

    'stipend',

    'grant',

    'certificate',

    'bootcamp',

    'summit',

    'competition',
    'contest',
    'challenge',

    'gsoc',

    'season of ai',

    'season of docs',

    'google arcade',

    'kaggle'

  ];
  const title = video.title.toLowerCase();

  if (!mustContain.some(
    k => title.includes(k)
  )) {

    summary.nonOpportunitiesSkipped++;

    return;

  }
  let extraction: GeminiExtraction | null = null;


  try {

    extraction = await extractOpportunity(video);

  }
  catch (error) {

    const msg =
      String(error);


    if (
      msg.includes('429')
      ||
      msg.includes('rate_limit_exceeded')
    ) {

      log.warn(
        '🚫 Groq daily quota exhausted'
      );


      summary.nonOpportunitiesSkipped++;

      return;
    }


    throw error;

  }



  if (!extraction) {

    log.info(
      '  ⏭️ Skipping: Not a student opportunity'
    );

    summary.nonOpportunitiesSkipped++;

    return;

  }


  // ── Step C: Post-extraction duplicate check (reg link + name) ──
  const postCheck = await checkDuplicate(video, extraction);
  if (postCheck.isDuplicate) {
    log.info(`  ⏭️ Skipping (duplicate): ${postCheck.reason}`);
    summary.duplicatesSkipped++;
    return;
  }

  // ── Step D: Save opportunity to Sheets ──
  const opportunityId = uuidv4().substring(0, 8);
  const opportunity: Opportunity = {
    id: opportunityId,
    opportunity_name: extraction.opportunity_name,
    organizer: extraction.organizer,
    registration_link: extraction.registration_link,
    deadline: extraction.deadline,
    eligibility: extraction.eligibility,
    rewards: extraction.rewards,
    source_video: video.link,
    source_channel: video.channelName,
    status: 'new',
    created_at: new Date().toISOString(),
  };

  if (!config.dryRun) {
    log.info(`  💾 Skipping immediate Sheets save (waiting for Discord reaction) for "${opportunity.opportunity_name}"`);
  } else {
    log.info(`  [DRY RUN] Would skip immediate Sheets save for "${opportunity.opportunity_name}"`);
  }

  // ── Step E: Generate Instagram content via Gemini ──
  log.info('  ✍️ Generating Instagram content...');
  await sleep(config.geminiRateLimitMs);
  const contentResult = await generateContent(extraction, video.title);

  if (!contentResult) {
    log.warn('  ⚠️ Content generation failed — opportunity saved without content');
    return;
  }
  summary.contentGenerated++;

  // ── Step F: Generate image via Gemini + upload to cloud ──
  log.info('  🎨 Generating image...');
  await sleep(config.geminiRateLimitMs);

  // Generate local image first (we need it for Telegram upload)
  const localImagePath = await generateImageLocal(contentResult.image_prompt, opportunityId);
  let cloudImageUrl = '';

  if (localImagePath) {
    summary.imagesGenerated++;
    // Upload to Google Drive cloud storage
    const fileName = `opp_${opportunityId}_${Date.now()}.png`;
    cloudImageUrl = await uploadImage(localImagePath, fileName);
    log.info(`  ☁️ Image uploaded to cloud: ${cloudImageUrl}`);
  }

  // ── Step G: Initialize content for Sheets ──
  const hashtags = contentResult.hashtags.map((h) => `#${h}`).join(' ');
  const content: Content = {
    opportunity_id: opportunityId,
    caption: contentResult.caption,
    hashtags,
    image_prompt: contentResult.image_prompt,
    image_url: cloudImageUrl,
    content_status: 'pending_review',
    telegram_message_id: '',
    review_status: 'pending',
    reviewed_at: '',
    reviewed_by: '',
  };


  // ── Step H: Send to Discord for review ──
  if (!config.dryRun) {
    log.info('  📢 Sending to Discord for review...');

    try {
      const messageId = await sendDiscordReviewMessage(
        `📋 **${opportunity.opportunity_name}**\n🏢 Organizer: ${opportunity.organizer}\n📅 Deadline: ${opportunity.deadline}\n🎓 Eligibility: ${opportunity.eligibility}\n🏆 Rewards: ${opportunity.rewards}\n\n🔗 Registration: ${opportunity.registration_link}\n📺 Source: ${opportunity.source_video}\n\n━━━━━━━━━━━━━━\n\n${content.caption}`
      );

      if (messageId) {
        savePendingOpportunity(messageId, opportunity, content);
        summary.telegramSent++;
        log.info('  📢 Discord review message sent, awaiting reaction');
      } else {
        log.warn('  ⚠️ Failed to send Discord review message or retrieve message ID');
      }
    } catch (err) {
      log.warn('  ⚠️ Failed to send Discord message');
    }
  }

  log.info(`  ✅ Successfully processed: "${opportunity.opportunity_name}"`);
}

/**
 * Process a single scraped opportunity through the same pipeline as YouTube:
 * Duplicate check → Content generation → Image generation → Discord review
 */
export async function processScrapedOpportunity(
  extraction: GeminiExtraction,
  sourceUrl: string,
  sourceName: string,
  summary: PipelineRunSummary
): Promise<void> {
  log.info(`\n  🌐 Processing scraped: "${extraction.opportunity_name}"`);

  // ── Step A: Duplicate check ──
  const dupCheck = await checkScrapedDuplicate(extraction, sourceUrl);
  if (dupCheck.isDuplicate) {
    log.info(`  ⏭️ Skipping (duplicate): ${dupCheck.reason}`);
    summary.duplicatesSkipped++;
    return;
  }

  // ── Step B: Build opportunity object ──
  const opportunityId = uuidv4().substring(0, 8);
  const opportunity: Opportunity = {
    id: opportunityId,
    opportunity_name: extraction.opportunity_name,
    organizer: extraction.organizer,
    registration_link: extraction.registration_link,
    deadline: extraction.deadline,
    eligibility: extraction.eligibility,
    rewards: extraction.rewards,
    source_video: sourceUrl,
    source_channel: sourceName,
    status: 'new',
    created_at: new Date().toISOString(),
  };

  if (!config.dryRun) {
    log.info(`  💾 Skipping immediate Sheets save (waiting for Discord reaction) for "${opportunity.opportunity_name}"`);
  }

  // ── Step C: Generate Instagram content ──
  log.info('  ✍️ Generating Instagram content...');
  await sleep(config.geminiRateLimitMs);
  const contentResult = await generateContent(extraction, extraction.opportunity_name);

  if (!contentResult) {
    log.warn('  ⚠️ Content generation failed — skipping');
    return;
  }
  summary.contentGenerated++;

  // ── Step D: Skip image generation for web-scraped opportunities ──
  log.info('  🖼️ Skipping image generation (not needed for web-scraped)');
  const cloudImageUrl = '';

  // ── Step E: Build content object ──
  const hashtags = contentResult.hashtags.map((h) => `#${h}`).join(' ');
  const content: Content = {
    opportunity_id: opportunityId,
    caption: contentResult.caption,
    hashtags,
    image_prompt: contentResult.image_prompt,
    image_url: cloudImageUrl,
    content_status: 'pending_review',
    telegram_message_id: '',
    review_status: 'pending',
    reviewed_at: '',
    reviewed_by: '',
  };

  // ── Step F: Send to Discord for review ──
  if (!config.dryRun) {
    log.info('  📢 Sending to Discord for review...');
    try {
      const messageId = await sendDiscordReviewMessage(
        `🌐 **[WEB] ${opportunity.opportunity_name}**\n🏢 Organizer: ${opportunity.organizer}\n📅 Deadline: ${opportunity.deadline}\n🎓 Eligibility: ${opportunity.eligibility}\n🏆 Rewards: ${opportunity.rewards}\n\n🔗 Registration: ${opportunity.registration_link}\n📺 Source: ${opportunity.source_video}\n\n━━━━━━━━━━━━━━\n\n${content.caption}`
      );

      if (messageId) {
        // Immediately save to Sheets as pending so the Oracle server can find it
        opportunity.status = 'pending_review';
        content.telegram_message_id = messageId;
        content.content_status = 'pending_review';
        
        await sheetsService.addOpportunity(opportunity);
        await sheetsService.addContent(content);
        
        // Save locally just in case
        savePendingOpportunity(messageId, opportunity, content);
        summary.telegramSent++;
        log.info('  📢 Discord review message sent & saved to Sheets as pending');
      } else {
        log.warn('  ⚠️ Failed to send Discord review message');
      }
    } catch (err) {
      log.warn('  ⚠️ Failed to send Discord message');
    }
  }

  summary.opportunitiesCreated++;
  log.info(`  ✅ Successfully processed scraped: "${opportunity.opportunity_name}"`);
}

/**
 * Finalize and log the pipeline run summary
 */
function finalizeSummary(summary: PipelineRunSummary): PipelineRunSummary {
  summary.endTime = new Date();
  summary.durationMs = summary.endTime.getTime() - summary.startTime.getTime();

  const durationSec = (summary.durationMs / 1000).toFixed(1);

  log.info('\n═══════════════════════════════════════════');
  log.info('📊 Pipeline Run Summary');
  log.info('═══════════════════════════════════════════');
  log.info(`  Duration:              ${durationSec}s`);
  log.info(`  Channels checked:      ${summary.channelsChecked}`);
  log.info(`  Videos found:          ${summary.videosFound}`);
  log.info(`  Videos processed:      ${summary.videosProcessed}`);
  log.info(`  Opportunities created: ${summary.opportunitiesCreated}`);
  log.info(`  Content generated:     ${summary.contentGenerated}`);
  log.info(`  Images generated:      ${summary.imagesGenerated}`);
  log.info(`  Telegram sent:         ${summary.telegramSent}`);
  log.info(`  Duplicates skipped:    ${summary.duplicatesSkipped}`);
  log.info(`  Non-opportunities:     ${summary.nonOpportunitiesSkipped}`);
  log.info(`  Errors:                ${summary.errors}`);

  if (summary.errorDetails.length > 0) {
    log.warn('  Error details:');
    summary.errorDetails.forEach((err) => log.warn(`    - ${err}`));
  }

  log.info('═══════════════════════════════════════════');
  log.info('🏁 Pipeline run completed');
  log.info('═══════════════════════════════════════════\n');

  return summary;
}
