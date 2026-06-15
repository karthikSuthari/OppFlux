// ===========================================
// Pipeline Runner — Main Orchestration
// ===========================================

import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/env.js';
import { createServiceLogger } from '../utils/logger.js';
import { sleep } from '../utils/retry.js';
import * as sheetsService from '../services/sheets.service.js';
import { fetchChannelFeed, extractUrls } from '../services/rss.service.js';
import { extractOpportunity } from '../services/gemini-extract.service.js';
import { generateContent } from '../services/gemini-content.service.js';
import { generateImage } from '../services/gemini-image.service.js';
import { checkDuplicate } from '../services/duplicate.service.js';
import type {
  PipelineRunSummary,
  Opportunity,
  Content,
  VideoEntry,
  GeminiExtraction,
} from '../types/index.js';

const log = createServiceLogger('pipeline');

/**
 * Run the complete opportunity content pipeline:
 *
 * 1. Connect to Google Sheets
 * 2. Fetch active channels
 * 3. For each channel, fetch RSS feed
 * 4. For each video, check duplicates → extract → generate content → generate image → save
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
 * Process a single video through the full pipeline
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

  // ── Step A: Pre-extraction duplicate check (Video ID) ──
  const preCheck = await checkDuplicate(video, null);
  if (preCheck.isDuplicate) {
    log.info(`  ⏭️ Skipping (duplicate): ${preCheck.reason}`);
    summary.duplicatesSkipped++;
    return;
  }

  // ── Step B: Extract opportunity data via Gemini ──
  log.info('  🤖 Extracting opportunity data...');
  await sleep(config.geminiRateLimitMs);
  const extraction = await extractOpportunity(video);

  if (!extraction) {
    log.info(`  ⏭️ Skipping: Not a student opportunity`);
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
    log.info(`  💾 Saving opportunity: "${opportunity.opportunity_name}"`);
    await sheetsService.addOpportunity(opportunity);
    summary.opportunitiesCreated++;
  } else {
    log.info(`  [DRY RUN] Would save opportunity: "${opportunity.opportunity_name}"`);
    summary.opportunitiesCreated++;
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

  // ── Step F: Generate image via Gemini ──
  log.info('  🎨 Generating image...');
  await sleep(config.geminiRateLimitMs);
  const imagePath = await generateImage(contentResult.image_prompt, opportunityId);

  if (imagePath) {
    summary.imagesGenerated++;
  }

  // ── Step G: Save content to Sheets ──
  const hashtags = contentResult.hashtags.map((h) => `#${h}`).join(' ');
  const content: Content = {
    opportunity_id: opportunityId,
    caption: contentResult.caption,
    hashtags,
    image_prompt: contentResult.image_prompt,
    image_url: imagePath,
    content_status: imagePath ? 'ready' : 'draft',
  };

  if (!config.dryRun) {
    log.info(`  💾 Saving content for "${opportunity.opportunity_name}"`);
    await sheetsService.addContent(content);

    // Update opportunity status
    const status = imagePath ? 'ready' : 'content_generated';
    await sheetsService.updateOpportunityStatus(opportunityId, status);
  } else {
    log.info(`  [DRY RUN] Would save content for "${opportunity.opportunity_name}"`);
  }

  log.info(`  ✅ Successfully processed: "${opportunity.opportunity_name}"`);
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
