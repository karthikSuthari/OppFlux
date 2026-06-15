// ===========================================
// Telegram Callback Handler
// ===========================================

import { createServiceLogger } from '../utils/logger.js';
import * as telegramService from './telegram.service.js';
import * as sheetsService from './sheets.service.js';
import { generateContent } from './gemini-content.service.js';
import { generateImage } from './gemini-image.service.js';
import { uploadImage } from './cloud-storage.service.js';
import { sleep } from '../utils/retry.js';
import { config } from '../config/env.js';
import type {
  TelegramUpdate,
  TelegramCallbackQuery,
  TelegramCallbackData,
  TelegramAction,
  GeminiExtraction,
  Opportunity,
  Content,
} from '../types/index.js';

const log = createServiceLogger('telegram-callback');

// Valid actions
const VALID_ACTIONS: TelegramAction[] = ['approve', 'reject', 'regen_cap', 'regen_img', 'regen_all'];

/**
 * Process a Telegram update (webhook payload).
 * Routes callback_query actions to the appropriate handler.
 */
export async function processUpdate(update: TelegramUpdate): Promise<void> {
  if (!update.callback_query) {
    log.debug('Ignoring non-callback update', { updateId: update.update_id });
    return;
  }

  const callback = update.callback_query;
  const parsed = parseCallbackData(callback.data);

  if (!parsed) {
    await telegramService.answerCallbackQuery(callback.id, '❌ Invalid action', true);
    return;
  }

  log.info(`Callback received: ${parsed.action} for opportunity ${parsed.opportunityId}`, {
    from: callback.from.username || callback.from.first_name,
    messageId: callback.message?.message_id,
  });

  try {
    // Initialize sheets if not already done
    await sheetsService.initializeSheets();

    switch (parsed.action) {
      case 'approve':
        await handleApprove(callback, parsed.opportunityId);
        break;
      case 'reject':
        await handleReject(callback, parsed.opportunityId);
        break;
      case 'regen_cap':
        await handleRegenerateCaption(callback, parsed.opportunityId);
        break;
      case 'regen_img':
        await handleRegenerateImage(callback, parsed.opportunityId);
        break;
      case 'regen_all':
        await handleRegenerateBoth(callback, parsed.opportunityId);
        break;
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error('Callback processing failed', { action: parsed.action, error: errMsg });
    await telegramService.answerCallbackQuery(callback.id, '❌ Error processing request', true);
  }
}

/**
 * Parse callback_data string into action and opportunity ID.
 * Format: "action:opportunityId"
 */
function parseCallbackData(data?: string): TelegramCallbackData | null {
  if (!data) return null;

  const parts = data.split(':');
  if (parts.length !== 2) return null;

  const action = parts[0] as TelegramAction;
  const opportunityId = parts[1];

  if (!VALID_ACTIONS.includes(action) || !opportunityId) return null;

  return { action, opportunityId };
}

/**
 * Get user display name from callback query
 */
function getUserName(callback: TelegramCallbackQuery): string {
  const user = callback.from;
  return user.username ? `@${user.username}` : `${user.first_name}${user.last_name ? ' ' + user.last_name : ''}`;
}

// ═══════════════════════════════════════════
// Action Handlers
// ═══════════════════════════════════════════

/**
 * APPROVE: Mark opportunity as approved, update Sheets, send confirmation
 */
async function handleApprove(
  callback: TelegramCallbackQuery,
  opportunityId: string
): Promise<void> {
  const userName = getUserName(callback);
  const messageId = callback.message?.message_id;

  // Check for duplicate approval
  const content = await sheetsService.getContentByOpportunityId(opportunityId);
  if (content && content.review_status === 'approved') {
    await telegramService.answerCallbackQuery(callback.id, '⚠️ Already approved', true);
    return;
  }

  // Update Sheets
  await sheetsService.updateContentReview(opportunityId, {
    review_status: 'approved',
    reviewed_at: new Date().toISOString(),
    reviewed_by: userName,
    content_status: 'approved',
  });
  await sheetsService.updateOpportunityStatus(opportunityId, 'approved');

  // Update Telegram message
  if (messageId) {
    const opportunity = await sheetsService.getOpportunityById(opportunityId);
    const oppName = opportunity?.opportunity_name || opportunityId;

    // Edit the caption to show approved status
    if (callback.message?.caption) {
      const updatedCaption = callback.message.caption.replace(
        /⏳ \*?Status:?\*? ?.*/,
        `✅ *Status:* APPROVED\n👤 *By:* ${userName}\n🕐 *At:* ${new Date().toLocaleString()}`
      );
      await telegramService.editMessageCaption(messageId, updatedCaption);
    } else if (callback.message?.text) {
      const updatedText = callback.message.text.replace(
        /⏳ \*?Status:?\*? ?.*/,
        `✅ *Status:* APPROVED\n👤 *By:* ${userName}\n🕐 *At:* ${new Date().toLocaleString()}`
      );
      await telegramService.editMessageText(messageId, updatedText);
    }
  }

  await telegramService.answerCallbackQuery(callback.id, '✅ Approved!');
  await telegramService.sendNotification(`✅ *Approved:* ${opportunityId}\nBy: ${userName}`);
  log.info(`Opportunity ${opportunityId} APPROVED by ${userName}`);
}

/**
 * REJECT: Mark opportunity as rejected, update Sheets, send confirmation
 */
async function handleReject(
  callback: TelegramCallbackQuery,
  opportunityId: string
): Promise<void> {
  const userName = getUserName(callback);
  const messageId = callback.message?.message_id;

  // Check for duplicate rejection
  const content = await sheetsService.getContentByOpportunityId(opportunityId);
  if (content && content.review_status === 'rejected') {
    await telegramService.answerCallbackQuery(callback.id, '⚠️ Already rejected', true);
    return;
  }

  // Update Sheets
  await sheetsService.updateContentReview(opportunityId, {
    review_status: 'rejected',
    reviewed_at: new Date().toISOString(),
    reviewed_by: userName,
    content_status: 'rejected',
  });
  await sheetsService.updateOpportunityStatus(opportunityId, 'rejected');

  // Update Telegram message
  if (messageId) {
    if (callback.message?.caption) {
      const updatedCaption = callback.message.caption.replace(
        /⏳ \*?Status:?\*? ?.*/,
        `❌ *Status:* REJECTED\n👤 *By:* ${userName}\n🕐 *At:* ${new Date().toLocaleString()}`
      );
      await telegramService.editMessageCaption(messageId, updatedCaption);
    } else if (callback.message?.text) {
      const updatedText = callback.message.text.replace(
        /⏳ \*?Status:?\*? ?.*/,
        `❌ *Status:* REJECTED\n👤 *By:* ${userName}\n🕐 *At:* ${new Date().toLocaleString()}`
      );
      await telegramService.editMessageText(messageId, updatedText);
    }
  }

  await telegramService.answerCallbackQuery(callback.id, '❌ Rejected');
  await telegramService.sendNotification(`❌ *Rejected:* ${opportunityId}\nBy: ${userName}`);
  log.info(`Opportunity ${opportunityId} REJECTED by ${userName}`);
}

/**
 * REGENERATE CAPTION: Generate new caption and hashtags, update message
 */
async function handleRegenerateCaption(
  callback: TelegramCallbackQuery,
  opportunityId: string
): Promise<void> {
  await telegramService.answerCallbackQuery(callback.id, '🔄 Regenerating caption...');
  const messageId = callback.message?.message_id;

  // Get opportunity data for regeneration
  const opportunity = await sheetsService.getOpportunityById(opportunityId);
  if (!opportunity) {
    await telegramService.sendNotification(`⚠️ Opportunity ${opportunityId} not found`);
    return;
  }

  // Build extraction from opportunity data
  const extraction = opportunityToExtraction(opportunity);

  // Call Gemini for new content
  await sleep(config.geminiRateLimitMs);
  const newContent = await generateContent(extraction, `[Regenerated] ${opportunity.opportunity_name}`);

  if (!newContent) {
    await telegramService.sendNotification('⚠️ Caption regeneration failed');
    return;
  }

  const hashtags = newContent.hashtags.map((h) => `#${h}`).join(' ');

  // Update Sheets
  await sheetsService.updateContentCaption(opportunityId, newContent.caption, hashtags);

  // Rebuild and edit message
  if (messageId) {
    const content = await sheetsService.getContentByOpportunityId(opportunityId);
    if (content) {
      content.caption = newContent.caption;
      content.hashtags = hashtags;

      const updatedCaption = formatUpdatedReviewMessage(opportunity, content, '🔄 Caption regenerated');
      const keyboard = buildReviewKeyboard(opportunityId, opportunity.source_video);

      if (callback.message?.caption) {
        await telegramService.editMessageCaption(messageId, updatedCaption, keyboard);
      } else {
        await telegramService.editMessageText(messageId, updatedCaption, keyboard);
      }
    }
  }

  await telegramService.sendNotification(`🔄 Caption regenerated for: ${opportunity.opportunity_name}`);
  log.info(`Caption regenerated for ${opportunityId}`);
}

/**
 * REGENERATE IMAGE: Generate new image, upload, update message
 */
async function handleRegenerateImage(
  callback: TelegramCallbackQuery,
  opportunityId: string
): Promise<void> {
  await telegramService.answerCallbackQuery(callback.id, '🎨 Regenerating image...');
  const oldMessageId = callback.message?.message_id;

  const opportunity = await sheetsService.getOpportunityById(opportunityId);
  if (!opportunity) {
    await telegramService.sendNotification(`⚠️ Opportunity ${opportunityId} not found`);
    return;
  }

  const content = await sheetsService.getContentByOpportunityId(opportunityId);
  if (!content) {
    await telegramService.sendNotification(`⚠️ Content for ${opportunityId} not found`);
    return;
  }

  // Generate new image
  await sleep(config.geminiRateLimitMs);
  const localImagePath = await generateImage(content.image_prompt, opportunityId);

  if (!localImagePath) {
    await telegramService.sendNotification('⚠️ Image regeneration failed');
    return;
  }

  // Upload to cloud storage
  const imageUrl = await uploadImage(localImagePath, `opp_${opportunityId}_regen.png`);

  // Update Sheets
  await sheetsService.updateContentImage(opportunityId, imageUrl);

  // Delete old message and send new one with updated image
  if (oldMessageId) {
    await telegramService.deleteMessage(oldMessageId);
  }

  // Send fresh review message with new image
  const updatedContent = { ...content, image_url: imageUrl };
  const newMessageId = await telegramService.sendReviewMessage(
    opportunity, updatedContent, localImagePath
  );

  if (newMessageId) {
    await sheetsService.updateContentTelegramMessageId(opportunityId, String(newMessageId));
  }

  log.info(`Image regenerated for ${opportunityId}`);
}

/**
 * REGENERATE BOTH: Generate new caption + image, update message
 */
async function handleRegenerateBoth(
  callback: TelegramCallbackQuery,
  opportunityId: string
): Promise<void> {
  await telegramService.answerCallbackQuery(callback.id, '🔄 Regenerating caption & image...');
  const oldMessageId = callback.message?.message_id;

  const opportunity = await sheetsService.getOpportunityById(opportunityId);
  if (!opportunity) {
    await telegramService.sendNotification(`⚠️ Opportunity ${opportunityId} not found`);
    return;
  }

  // Regenerate caption
  const extraction = opportunityToExtraction(opportunity);
  await sleep(config.geminiRateLimitMs);
  const newContent = await generateContent(extraction, `[Regenerated] ${opportunity.opportunity_name}`);

  if (!newContent) {
    await telegramService.sendNotification('⚠️ Content regeneration failed');
    return;
  }

  const hashtags = newContent.hashtags.map((h) => `#${h}`).join(' ');

  // Regenerate image
  await sleep(config.geminiRateLimitMs);
  const localImagePath = await generateImage(newContent.image_prompt, opportunityId);
  let imageUrl = '';

  if (localImagePath) {
    imageUrl = await uploadImage(localImagePath, `opp_${opportunityId}_regen_both.png`);
  }

  // Update Sheets
  await sheetsService.updateContentCaption(opportunityId, newContent.caption, hashtags);
  if (imageUrl) {
    await sheetsService.updateContentImage(opportunityId, imageUrl);
  }

  // Delete old message
  if (oldMessageId) {
    await telegramService.deleteMessage(oldMessageId);
  }

  // Send new review message
  const updatedContent: Content = {
    opportunity_id: opportunityId,
    caption: newContent.caption,
    hashtags,
    image_prompt: newContent.image_prompt,
    image_url: imageUrl,
    content_status: 'pending_review',
    telegram_message_id: '',
    review_status: 'pending',
    reviewed_at: '',
    reviewed_by: '',
  };

  const newMessageId = await telegramService.sendReviewMessage(
    opportunity, updatedContent, localImagePath
  );

  if (newMessageId) {
    await sheetsService.updateContentTelegramMessageId(opportunityId, String(newMessageId));
  }

  await telegramService.sendNotification(`🔄 Caption & image regenerated for: ${opportunity.opportunity_name}`);
  log.info(`Both regenerated for ${opportunityId}`);
}

// ═══════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════

/**
 * Convert an Opportunity record back to a GeminiExtraction for re-prompting
 */
function opportunityToExtraction(opp: Opportunity): GeminiExtraction {
  return {
    is_opportunity: true,
    opportunity_name: opp.opportunity_name,
    organizer: opp.organizer,
    registration_link: opp.registration_link,
    deadline: opp.deadline,
    eligibility: opp.eligibility,
    benefits: '', // Not stored in Sheets
    rewards: opp.rewards,
  };
}

/**
 * Build inline keyboard (same as in telegram.service but needed here for edits)
 */
function buildReviewKeyboard(opportunityId: string, sourceVideoUrl: string) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Approve', callback_data: `approve:${opportunityId}` },
        { text: '❌ Reject', callback_data: `reject:${opportunityId}` },
      ],
      [
        { text: '🔄 Regen Caption', callback_data: `regen_cap:${opportunityId}` },
        { text: '🎨 Regen Image', callback_data: `regen_img:${opportunityId}` },
      ],
      [
        { text: '🔄 Regen Both', callback_data: `regen_all:${opportunityId}` },
        { text: '🔗 View Source', url: sourceVideoUrl },
      ],
    ],
  };
}

/**
 * Format an updated review message after regeneration
 */
function formatUpdatedReviewMessage(opp: Opportunity, content: Content, statusNote: string): string {
  const esc = (t: string) => t ? t.replace(/([_\[\]()~`>#+\-=|{}.!\\])/g, '\\$1') : 'Not specified';

  return [
    `📋 *${esc(opp.opportunity_name)}*`,
    '',
    `🏢 *Organizer:* ${esc(opp.organizer)}`,
    `📅 *Deadline:* ${esc(opp.deadline)}`,
    `🎓 *Eligibility:* ${esc(opp.eligibility)}`,
    `🏆 *Rewards:* ${esc(opp.rewards)}`,
    `📺 *Source:* ${esc(opp.source_channel)}`,
    '',
    '━━━━━━━━━━━━━━━━━━━━━━',
    '✍️ *Generated Caption:*',
    '',
    esc(content.caption),
    '',
    `🏷️ ${esc(content.hashtags)}`,
    '',
    '━━━━━━━━━━━━━━━━━━━━━━',
    `⏳ *Status:* ${statusNote}`,
  ].join('\n');
}
