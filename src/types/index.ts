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

export type OpportunityStatus =
  | 'new'
  | 'content_generated'
  | 'image_generated'
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'ready'
  | 'posted'
  | 'expired';

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
  telegram_message_id: string;
  review_status: string;
  reviewed_at: string;
  reviewed_by: string;
}

export type ContentStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'ready' | 'posted';

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
  telegramSent: number;
  duplicatesSkipped: number;
  nonOpportunitiesSkipped: number;
  errors: number;
  errorDetails: string[];
}

/**
 * Application configuration
 */
export interface AppConfig {
  discordBotToken: string;
  discordChannelId: string;
  groqApiKey: string;
  geminiApiKey: string;
  googleSheetsId: string;
  googleServiceAccountEmail: string;
  googlePrivateKey: string;
  imageOutputDir: string;
  logLevel: string;
  pollIntervalMinutes: number;
  dryRun: boolean;
  geminiRateLimitMs: number;
  telegramBotToken: string;
  telegramChatId: string;
  discordWebhookUrl: string;
  webhookPort: number;
  webhookUrl: string;
  webhookSecret: string;
  nodeEnv: string;
}

// ===========================================
// Telegram Types
// ===========================================

/**
 * Telegram user object
 */
export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

/**
 * Telegram chat object
 */
export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

/**
 * Telegram message object
 */
export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  caption?: string;
  photo?: Array<{ file_id: string; width: number; height: number }>;
  reply_markup?: {
    inline_keyboard: Array<Array<{
      text: string;
      callback_data?: string;
      url?: string;
    }>>;
  };
}

/**
 * Telegram callback query from inline keyboard button presses
 */
export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
  chat_instance: string;
}

/**
 * Telegram update — the top-level object received from Telegram
 */
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

/**
 * Parsed callback data from inline keyboard buttons
 */
export interface TelegramCallbackData {
  action: TelegramAction;
  opportunityId: string;
}

/**
 * Valid Telegram callback actions
 */
export type TelegramAction = 'approve' | 'reject' | 'regen_cap' | 'regen_img' | 'regen_all' | 'post_now';

/**
 * Telegram webhook info response
 */
export interface TelegramWebhookInfo {
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
  max_connections?: number;
  allowed_updates?: string[];
}
