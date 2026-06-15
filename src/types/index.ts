// ===========================================
// Opportunity Content Engine - Type Definitions
// ===========================================

/**
 * YouTube channel configuration from the "Channels" sheet tab
 */
export interface Channel {
  channel_name: string;
  channel_id: string;
  active: string; // "TRUE" or "FALSE" from sheets
}

/**
 * Parsed video entry from YouTube RSS feed
 */
export interface VideoEntry {
  videoId: string;
  title: string;
  description: string;
  link: string;
  publishedAt: string;
  channelName: string;
  channelId: string;
}

/**
 * Opportunity record stored in the "Opportunities" sheet tab
 */
export interface Opportunity {
  id: string;
  opportunity_name: string;
  organizer: string;
  registration_link: string;
  deadline: string;
  eligibility: string;
  rewards: string;
  source_video: string;
  source_channel: string;
  status: OpportunityStatus;
  created_at: string;
}

export type OpportunityStatus = 'new' | 'content_generated' | 'image_generated' | 'ready' | 'posted' | 'expired';

/**
 * Content record stored in the "Content" sheet tab
 */
export interface Content {
  opportunity_id: string;
  caption: string;
  hashtags: string;
  image_prompt: string;
  image_url: string;
  content_status: ContentStatus;
}

export type ContentStatus = 'draft' | 'ready' | 'posted';

/**
 * Posted record stored in the "Posted" sheet tab
 */
export interface Posted {
  opportunity_id: string;
  instagram_post_url: string;
  posted_at: string;
}

/**
 * Gemini AI extraction result for opportunity data
 */
export interface GeminiExtraction {
  is_opportunity: boolean;
  opportunity_name: string;
  organizer: string;
  registration_link: string;
  deadline: string;
  eligibility: string;
  benefits: string;
  rewards: string;
}

/**
 * Gemini AI content generation result
 */
export interface GeminiContentResult {
  caption: string;
  hashtags: string[];
  carousel_text: string;
  image_prompt: string;
}

/**
 * Duplicate check result
 */
export interface DuplicateCheckResult {
  isDuplicate: boolean;
  reason: string;
  matchedField?: 'video_id' | 'registration_link' | 'opportunity_name';
}

/**
 * Pipeline run summary statistics
 */
export interface PipelineRunSummary {
  startTime: Date;
  endTime: Date;
  durationMs: number;
  channelsChecked: number;
  videosFound: number;
  videosProcessed: number;
  opportunitiesCreated: number;
  contentGenerated: number;
  imagesGenerated: number;
  duplicatesSkipped: number;
  nonOpportunitiesSkipped: number;
  errors: number;
  errorDetails: string[];
}

/**
 * Application configuration
 */
export interface AppConfig {
  geminiApiKey: string;
  googleSheetsId: string;
  googleServiceAccountEmail: string;
  googlePrivateKey: string;
  imageOutputDir: string;
  logLevel: string;
  pollIntervalMinutes: number;
  dryRun: boolean;
  geminiRateLimitMs: number;
}
