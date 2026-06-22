// ===========================================
// Google Sheets CRUD Service
// ===========================================

import { GoogleSpreadsheet, GoogleSpreadsheetRow } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { config } from '../config/env.js';
import { createServiceLogger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import type { Channel, ScrapingSource, Opportunity, Content, Posted } from '../types/index.js';

const log = createServiceLogger('sheets');

// Sheet tab names
const TABS = {
  CHANNELS: 'Channels',
  SCRAPING_SOURCES: 'ScrapingSources',
  OPPORTUNITIES: 'Opportunities',
  CONTENT: 'Content',
  POSTED: 'Posted',
} as const;

// Column headers for each tab (used for initialization)
const HEADERS = {
  [TABS.CHANNELS]: ['channel_name', 'channel_id', 'active'],
  [TABS.SCRAPING_SOURCES]: ['source_name', 'source_url', 'filter', 'active'],
  [TABS.OPPORTUNITIES]: [
    'id', 'opportunity_name', 'organizer', 'registration_link',
    'deadline', 'eligibility', 'rewards', 'mode', 'location', 'fees', 'source_video',
    'source_channel', 'status', 'created_at',
  ],
  [TABS.CONTENT]: [
    'opportunity_id', 'caption', 'hashtags', 'image_prompt',
    'image_url', 'content_status', 'telegram_message_id',
    'review_status', 'reviewed_at', 'reviewed_by',
  ],
  [TABS.POSTED]: ['opportunity_id', 'instagram_post_url', 'posted_at'],
} as const;

let doc: GoogleSpreadsheet | null = null;

/**
 * Initialize Google Sheets connection and ensure all tabs exist with headers
 */
export async function initializeSheets(): Promise<GoogleSpreadsheet> {
  if (doc) return doc;

  log.info('Connecting to Google Sheets...');

  const auth = new JWT({
    email: config.googleServiceAccountEmail,
    key: config.googlePrivateKey.replace(/\\n/g,'\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  doc = new GoogleSpreadsheet(config.googleSheetsId, auth);

  await withRetry(
    () => doc!.loadInfo(),
    { operationName: 'sheets.loadInfo', maxRetries: 3 }
  );

  log.info(`Connected to spreadsheet: "${doc.title}"`);

  // Ensure all required tabs exist
  await ensureTabsExist();

  return doc;
}

/**
 * Create missing tabs with proper headers
 */
async function ensureTabsExist(): Promise<void> {
  if (!doc) throw new Error('Sheets not initialized');

  for (const [tabName, headers] of Object.entries(HEADERS)) {
    const existingSheet = doc.sheetsByTitle[tabName];
    if (!existingSheet) {
      log.info(`Creating missing tab: "${tabName}"`);
      await doc.addSheet({
        title: tabName,
        headerValues: headers as unknown as string[],
      });
      log.info(`Created tab: "${tabName}" with ${headers.length} columns`);
    } else {
      log.debug(`Tab exists: "${tabName}"`);
    }
  }
}

/**
 * Get all active channels from the Channels tab
 */
export async function getActiveChannels(): Promise<Channel[]> {
  if (!doc) throw new Error('Sheets not initialized');

  const sheet = doc.sheetsByTitle[TABS.CHANNELS];
  if (!sheet) throw new Error(`Tab "${TABS.CHANNELS}" not found`);

  const rows = await withRetry(
    () => sheet.getRows(),
    { operationName: 'sheets.getActiveChannels' }
  );

  const channels: Channel[] = rows
    .map((row: GoogleSpreadsheetRow) => ({
      channel_name: row.get('channel_name') || '',
      channel_id: row.get('channel_id') || '',
      active: row.get('active') || 'FALSE',
    }))
    .filter((ch: Channel) => ch.active.toUpperCase() === 'TRUE' && ch.channel_id);

  log.info(`Found ${channels.length} active channels out of ${rows.length} total`);
  return channels;
}

/**
 * Get all active scraping sources from the ScrapingSources tab
 */
export async function getActiveScrapingSources(): Promise<ScrapingSource[]> {
  if (!doc) throw new Error('Sheets not initialized');

  const sheet = doc.sheetsByTitle[TABS.SCRAPING_SOURCES];
  if (!sheet) {
    log.warn(`Tab "${TABS.SCRAPING_SOURCES}" not found — no scraping sources configured`);
    return [];
  }

  const rows = await withRetry(
    () => sheet.getRows(),
    { operationName: 'sheets.getActiveScrapingSources' }
  );

  const sources: ScrapingSource[] = rows
    .map((row: GoogleSpreadsheetRow) => ({
      source_name: row.get('source_name') || '',
      source_url: row.get('source_url') || '',
      filter: row.get('filter') || '',
      active: row.get('active') || 'FALSE',
    }))
    .filter((s: ScrapingSource) => s.active.toUpperCase() === 'TRUE' && s.source_url);

  log.info(`Found ${sources.length} active scraping sources out of ${rows.length} total`);
  return sources;
}

/**
 * Get all existing opportunities (for duplicate detection)
 */
export async function getExistingOpportunities(): Promise<Opportunity[]> {
  if (!doc) throw new Error('Sheets not initialized');

  const sheet = doc.sheetsByTitle[TABS.OPPORTUNITIES];
  if (!sheet) throw new Error(`Tab "${TABS.OPPORTUNITIES}" not found`);

  const rows = await withRetry(
    () => sheet.getRows(),
    { operationName: 'sheets.getExistingOpportunities' }
  );

  return rows.map((row: GoogleSpreadsheetRow) => ({
    id: row.get('id') || '',
    opportunity_name: row.get('opportunity_name') || '',
    organizer: row.get('organizer') || '',
    registration_link: row.get('registration_link') || '',
    deadline: row.get('deadline') || '',
    eligibility: row.get('eligibility') || '',
    rewards: row.get('rewards') || '',
    mode: row.get('mode') || '',
    location: row.get('location') || '',
    fees: row.get('fees') || '',
    source_video: row.get('source_video') || '',
    source_channel: row.get('source_channel') || '',
    status: row.get('status') || 'new',
    created_at: row.get('created_at') || '',
  }));
}

/**
 * Get a single opportunity by ID
 */
export async function getOpportunityById(opportunityId: string): Promise<Opportunity | null> {
  const opportunities = await getExistingOpportunities();
  return opportunities.find((opp) => opp.id === opportunityId) || null;
}

/**
 * Add a new opportunity to the Opportunities tab
 */
export async function addOpportunity(opportunity: Opportunity): Promise<void> {
  if (!doc) throw new Error('Sheets not initialized');

  const sheet = doc.sheetsByTitle[TABS.OPPORTUNITIES];
  if (!sheet) throw new Error(`Tab "${TABS.OPPORTUNITIES}" not found`);

  await withRetry(
    () => sheet.addRow({
      id: opportunity.id,
      opportunity_name: opportunity.opportunity_name,
      organizer: opportunity.organizer,
      registration_link: opportunity.registration_link,
      deadline: opportunity.deadline,
      eligibility: opportunity.eligibility,
      rewards: opportunity.rewards,
      mode: opportunity.mode,
      location: opportunity.location,
      fees: opportunity.fees,
      source_video: opportunity.source_video,
      source_channel: opportunity.source_channel,
      status: opportunity.status,
      created_at: opportunity.created_at,
    }),
    { operationName: 'sheets.addOpportunity' }
  );

  log.info(`Added opportunity: "${opportunity.opportunity_name}" (${opportunity.id})`);
}

/**
 * Add content for an opportunity to the Content tab (with review fields)
 */
export async function addContent(content: Content): Promise<void> {
  if (!doc) throw new Error('Sheets not initialized');

  const sheet = doc.sheetsByTitle[TABS.CONTENT];
  if (!sheet) throw new Error(`Tab "${TABS.CONTENT}" not found`);

  await withRetry(
    () => sheet.addRow({
      opportunity_id: content.opportunity_id,
      caption: content.caption,
      hashtags: content.hashtags,
      image_prompt: content.image_prompt,
      image_url: content.image_url,
      content_status: content.content_status,
      telegram_message_id: content.discord_message_id || '',
      review_status: content.review_status || 'pending',
      reviewed_at: content.reviewed_at || '',
      reviewed_by: content.reviewed_by || '',
    }),
    { operationName: 'sheets.addContent' }
  );

  log.info(`Added content for opportunity: ${content.opportunity_id}`);
}

/**
 * Update opportunity status
 */
export async function updateOpportunityStatus(
  opportunityId: string,
  status: string
): Promise<void> {
  if (!doc) throw new Error('Sheets not initialized');

  const sheet = doc.sheetsByTitle[TABS.OPPORTUNITIES];
  if (!sheet) throw new Error(`Tab "${TABS.OPPORTUNITIES}" not found`);

  const rows = await sheet.getRows();
  const row = rows.find((r: GoogleSpreadsheetRow) => r.get('id') === opportunityId);

  if (row) {
    row.set('status', status);
    await row.save();
    log.debug(`Updated opportunity ${opportunityId} status to "${status}"`);
  } else {
    log.warn(`Opportunity ${opportunityId} not found for status update`);
  }
}

// ═══════════════════════════════════════════
// Content Review Methods (Discord integration)
// ═══════════════════════════════════════════

/**
 * Get content row by opportunity_id
 */
export async function getContentByOpportunityId(opportunityId: string): Promise<Content | null> {
  if (!doc) throw new Error('Sheets not initialized');

  const sheet = doc.sheetsByTitle[TABS.CONTENT];
  if (!sheet) throw new Error(`Tab "${TABS.CONTENT}" not found`);

  const rows = await sheet.getRows();
  const row = rows.find((r: GoogleSpreadsheetRow) => r.get('opportunity_id') === opportunityId);

  if (!row) return null;

  return {
    opportunity_id: row.get('opportunity_id') || '',
    caption: row.get('caption') || '',
    hashtags: row.get('hashtags') || '',
    image_prompt: row.get('image_prompt') || '',
    image_url: row.get('image_url') || '',
    content_status: row.get('content_status') || 'draft',
    discord_message_id: row.get('telegram_message_id') || '',
    review_status: row.get('review_status') || '',
    reviewed_at: row.get('reviewed_at') || '',
    reviewed_by: row.get('reviewed_by') || '',
  };
}

/**
 * Get content row by discord message ID (stored in telegram_message_id column for backwards compat)
 */
export async function getContentByDiscordMessageId(messageId: string): Promise<Content | null> {
  if (!doc) throw new Error('Sheets not initialized');

  const sheet = doc.sheetsByTitle[TABS.CONTENT];
  if (!sheet) throw new Error(`Tab "${TABS.CONTENT}" not found`);

  const rows = await sheet.getRows();
  const row = rows.find((r: GoogleSpreadsheetRow) => r.get('telegram_message_id') === messageId);

  if (!row) return null;

  return {
    opportunity_id: row.get('opportunity_id') || '',
    caption: row.get('caption') || '',
    hashtags: row.get('hashtags') || '',
    image_prompt: row.get('image_prompt') || '',
    image_url: row.get('image_url') || '',
    content_status: row.get('content_status') || 'draft',
    discord_message_id: row.get('telegram_message_id') || '',
    review_status: row.get('review_status') || '',
    reviewed_at: row.get('reviewed_at') || '',
    reviewed_by: row.get('reviewed_by') || '',
  };
}

/**
 * Update content review fields (status, timestamp, reviewer)
 */
export async function updateContentReview(
  opportunityId: string,
  fields: {
    review_status: string;
    reviewed_at: string;
    reviewed_by: string;
    content_status: string;
  }
): Promise<void> {
  if (!doc) throw new Error('Sheets not initialized');

  const sheet = doc.sheetsByTitle[TABS.CONTENT];
  if (!sheet) throw new Error(`Tab "${TABS.CONTENT}" not found`);

  const rows = await sheet.getRows();
  const row = rows.find((r: GoogleSpreadsheetRow) => r.get('opportunity_id') === opportunityId);

  if (row) {
    row.set('review_status', fields.review_status);
    row.set('reviewed_at', fields.reviewed_at);
    row.set('reviewed_by', fields.reviewed_by);
    row.set('content_status', fields.content_status);
    await row.save();
    log.info(`Updated review for ${opportunityId}: ${fields.review_status}`);
  } else {
    log.warn(`Content for ${opportunityId} not found for review update`);
  }
}

/**
 * Update the caption and hashtags for a content row (regeneration)
 */
export async function updateContentCaption(
  opportunityId: string,
  caption: string,
  hashtags: string
): Promise<void> {
  if (!doc) throw new Error('Sheets not initialized');

  const sheet = doc.sheetsByTitle[TABS.CONTENT];
  if (!sheet) throw new Error(`Tab "${TABS.CONTENT}" not found`);

  const rows = await sheet.getRows();
  const row = rows.find((r: GoogleSpreadsheetRow) => r.get('opportunity_id') === opportunityId);

  if (row) {
    row.set('caption', caption);
    row.set('hashtags', hashtags);
    await row.save();
    log.info(`Updated caption for ${opportunityId}`);
  } else {
    log.warn(`Content for ${opportunityId} not found for caption update`);
  }
}

/**
 * Update the image URL for a content row (regeneration)
 */
export async function updateContentImage(
  opportunityId: string,
  imageUrl: string
): Promise<void> {
  if (!doc) throw new Error('Sheets not initialized');

  const sheet = doc.sheetsByTitle[TABS.CONTENT];
  if (!sheet) throw new Error(`Tab "${TABS.CONTENT}" not found`);

  const rows = await sheet.getRows();
  const row = rows.find((r: GoogleSpreadsheetRow) => r.get('opportunity_id') === opportunityId);

  if (row) {
    row.set('image_url', imageUrl);
    await row.save();
    log.info(`Updated image URL for ${opportunityId}`);
  } else {
    log.warn(`Content for ${opportunityId} not found for image update`);
  }
}

/**
 * Update the Discord message ID for a content row (stored in telegram_message_id column for backwards compat)
 */
export async function updateContentDiscordMessageId(
  opportunityId: string,
  discordMessageId: string
): Promise<void> {
  if (!doc) throw new Error('Sheets not initialized');

  const sheet = doc.sheetsByTitle[TABS.CONTENT];
  if (!sheet) throw new Error(`Tab "${TABS.CONTENT}" not found`);

  const rows = await sheet.getRows();
  const row = rows.find((r: GoogleSpreadsheetRow) => r.get('opportunity_id') === opportunityId);

  if (row) {
    row.set('telegram_message_id', discordMessageId);
    await row.save();
    log.debug(`Updated discord_message_id for ${opportunityId}: ${discordMessageId}`);
  }
}

/**
 * Check if a video ID has already been processed
 */
export async function isVideoProcessed(videoId: string): Promise<boolean> {
  const opportunities = await getExistingOpportunities();
  return opportunities.some((opp) => opp.source_video.includes(videoId));
}

/**
 * Find opportunity by registration link
 */
export async function findByRegistrationLink(link: string): Promise<Opportunity | null> {
  if (!link) return null;
  const opportunities = await getExistingOpportunities();
  return opportunities.find((opp) => opp.registration_link === link) || null;
}

/**
 * Find opportunity by name (case-insensitive)
 */
export async function findByOpportunityName(name: string): Promise<Opportunity | null> {
  if (!name) return null;
  const opportunities = await getExistingOpportunities();
  const normalizedName = name.toLowerCase().trim();
  return opportunities.find(
    (opp) => opp.opportunity_name.toLowerCase().trim() === normalizedName
  ) || null;
}

/**
 * Add a posted record
 */
export async function addPostedRecord(posted: Posted): Promise<void> {
  if (!doc) throw new Error('Sheets not initialized');

  const sheet = doc.sheetsByTitle[TABS.POSTED];
  if (!sheet) throw new Error(`Tab "${TABS.POSTED}" not found`);

  await withRetry(
    () => sheet.addRow({
      opportunity_id: posted.opportunity_id,
      instagram_post_url: posted.instagram_post_url,
      posted_at: posted.posted_at,
    }),
    { operationName: 'sheets.addPostedRecord' }
  );

  log.info(`Added posted record for opportunity: ${posted.opportunity_id}`);
}
