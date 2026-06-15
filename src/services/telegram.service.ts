// ===========================================
// Telegram Bot Service
// ===========================================

import { config } from '../config/env.js';
import { createServiceLogger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import fs from 'fs';
import type { Opportunity, Content } from '../types/index.js';

const log = createServiceLogger('telegram');

const API_BASE = `https://api.telegram.org/bot${config.telegramBotToken}`;

/**
 * Build the inline keyboard for a review message.
 * Includes: Approve, Reject, Regenerate Caption, Regenerate Image, Regenerate Both, View Source
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
 * Format the review message body with opportunity details and generated caption
 */
function formatReviewMessage(opportunity: Opportunity, content: Content): string {
  const lines = [
    `📋 *${escapeMarkdown(opportunity.opportunity_name)}*`,
    '',
    `🏢 *Organizer:* ${escapeMarkdown(opportunity.organizer)}`,
    `📅 *Deadline:* ${escapeMarkdown(opportunity.deadline)}`,
    `🎓 *Eligibility:* ${escapeMarkdown(opportunity.eligibility)}`,
    `🏆 *Rewards:* ${escapeMarkdown(opportunity.rewards)}`,
    `📺 *Source:* ${escapeMarkdown(opportunity.source_channel)}`,
    `🔗 *Video:* ${opportunity.source_video}`,
    '',
    '━━━━━━━━━━━━━━━━━━━━━━',
    '✍️ *Generated Caption:*',
    '',
    escapeMarkdown(content.caption),
    '',
    `🏷️ ${escapeMarkdown(content.hashtags)}`,
    '',
    '━━━━━━━━━━━━━━━━━━━━━━',
    '⏳ *Status:* Pending Review',
  ];

  return lines.join('\n');
}

/**
 * Escape special characters for Telegram MarkdownV2
 */
function escapeMarkdown(text: string): string {
  if (!text) return 'Not specified';
  return text.replace(/([_\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

/**
 * Send a review message with image and inline keyboard to the configured Telegram chat.
 *
 * @param opportunity - Opportunity data
 * @param content - Generated content data
 * @param localImagePath - Path to the local image file (if available)
 * @returns The message_id of the sent Telegram message, or null on failure
 */
export async function sendReviewMessage(
  opportunity: Opportunity,
  content: Content,
  localImagePath?: string
): Promise<number | null> {
  log.info(`Sending review message for: "${opportunity.opportunity_name}"`);

  const caption = formatReviewMessage(opportunity, content);
  const keyboard = buildReviewKeyboard(opportunity.id, opportunity.source_video);

  try {
    let result: any;

    if (localImagePath && fs.existsSync(localImagePath)) {
      // Send photo with caption
      result = await sendPhoto(localImagePath, caption, keyboard);
    } else if (content.image_url && content.image_url.startsWith('http')) {
      // Send photo by URL
      result = await sendPhotoByUrl(content.image_url, caption, keyboard);
    } else {
      // Send text-only message (no image available)
      result = await sendMessage(caption, keyboard);
    }

    if (result && result.ok && result.result) {
      const messageId = result.result.message_id;
      log.info(`Review message sent: message_id=${messageId}`);
      return messageId;
    }

    log.warn('Telegram API returned unexpected response', { result });
    return null;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error('Failed to send Telegram review message', { error: errMsg });
    return null;
  }
}

/**
 * Send a photo with caption to the Telegram chat
 */
async function sendPhoto(localPath: string, caption: string, replyMarkup: any): Promise<any> {
  const imageBuffer = fs.readFileSync(localPath);
  const blob = new Blob([imageBuffer], { type: 'image/png' });

  const form = new FormData();
  form.append('chat_id', config.telegramChatId);
  form.append('photo', blob, 'opportunity.png');
  form.append('caption', truncateCaption(caption));
  form.append('parse_mode', 'Markdown');
  form.append('reply_markup', JSON.stringify(replyMarkup));

  return withRetry(
    async () => {
      const res = await fetch(`${API_BASE}/sendPhoto`, { method: 'POST', body: form });
      const data = await res.json() as { ok: boolean; result?: { message_id: number } };
      if (!data.ok) throw new Error(`Telegram sendPhoto failed: ${JSON.stringify(data)}`);
      return data;
    },
    { operationName: 'telegram.sendPhoto', maxRetries: 2 }
  );
}

/**
 * Send a photo by URL to the Telegram chat
 */
async function sendPhotoByUrl(photoUrl: string, caption: string, replyMarkup: any): Promise<any> {
  const body = {
    chat_id: config.telegramChatId,
    photo: photoUrl,
    caption: truncateCaption(caption),
    parse_mode: 'Markdown',
    reply_markup: replyMarkup,
  };

  return withRetry(
    async () => {
      const res = await fetch(`${API_BASE}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json() as { ok: boolean; result?: { message_id: number } };
      if (!data.ok) throw new Error(`Telegram sendPhoto URL failed: ${JSON.stringify(data)}`);
      return data;
    },
    { operationName: 'telegram.sendPhotoByUrl', maxRetries: 2 }
  );
}

/**
 * Send a text message to the Telegram chat
 */
async function sendMessage(text: string, replyMarkup?: any): Promise<any> {
  const body: any = {
    chat_id: config.telegramChatId,
    text: truncateCaption(text),
    parse_mode: 'Markdown',
  };
  if (replyMarkup) body.reply_markup = replyMarkup;

  return withRetry(
    async () => {
      const res = await fetch(`${API_BASE}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json() as { ok: boolean; result?: { message_id: number } };
      if (!data.ok) throw new Error(`Telegram sendMessage failed: ${JSON.stringify(data)}`);
      return data;
    },
    { operationName: 'telegram.sendMessage', maxRetries: 2 }
  );
}

/**
 * Edit the caption of an existing photo message
 */
export async function editMessageCaption(
  messageId: number,
  caption: string,
  replyMarkup?: any
): Promise<boolean> {
  const body: any = {
    chat_id: config.telegramChatId,
    message_id: messageId,
    caption: truncateCaption(caption),
    parse_mode: 'Markdown',
  };
  if (replyMarkup) body.reply_markup = replyMarkup;

  try {
    const res = await fetch(`${API_BASE}/editMessageCaption`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json() as { ok: boolean };
    return data.ok;
  } catch (error) {
    log.error('Failed to edit message caption', { messageId, error });
    return false;
  }
}

/**
 * Edit the text of an existing text message
 */
export async function editMessageText(
  messageId: number,
  text: string,
  replyMarkup?: any
): Promise<boolean> {
  const body: any = {
    chat_id: config.telegramChatId,
    message_id: messageId,
    text: truncateCaption(text),
    parse_mode: 'Markdown',
  };
  if (replyMarkup) body.reply_markup = replyMarkup;

  try {
    const res = await fetch(`${API_BASE}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json() as { ok: boolean };
    return data.ok;
  } catch (error) {
    log.error('Failed to edit message text', { messageId, error });
    return false;
  }
}

/**
 * Delete a message from the chat
 */
export async function deleteMessage(messageId: number): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/deleteMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.telegramChatId,
        message_id: messageId,
      }),
    });
    const data = await res.json() as { ok: boolean };
    return data.ok;
  } catch (error) {
    log.error('Failed to delete message', { messageId, error });
    return false;
  }
}

/**
 * Answer a callback query (removes the loading indicator on the button)
 */
export async function answerCallbackQuery(
  callbackQueryId: string,
  text: string,
  showAlert = false
): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text,
        show_alert: showAlert,
      }),
    });
    const data = await res.json() as { ok: boolean };
    return data.ok;
  } catch (error) {
    log.error('Failed to answer callback query', { callbackQueryId, error });
    return false;
  }
}

/**
 * Send a simple notification message (for confirmations)
 */
export async function sendNotification(text: string): Promise<void> {
  try {
    await sendMessage(text);
  } catch (error) {
    log.error('Failed to send notification', { error });
  }
}

/**
 * Set webhook URL for Telegram bot
 */
export async function setWebhook(url: string): Promise<boolean> {
  log.info(`Setting Telegram webhook: ${url}`);

  try {
    const body: any = {
      url,
      allowed_updates: ['callback_query'],
      secret_token: config.webhookSecret,
    };

    const res = await fetch(`${API_BASE}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json() as { ok: boolean; description?: string };

    if (data.ok) {
      log.info('Webhook set successfully');
    } else {
      log.error('Failed to set webhook', { description: data.description });
    }

    return data.ok;
  } catch (error) {
    log.error('Failed to set webhook', { error });
    return false;
  }
}

/**
 * Remove webhook (switch back to no webhook)
 */
export async function deleteWebhook(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/deleteWebhook`, { method: 'POST' });
    const data = await res.json() as { ok: boolean };
    return data.ok;
  } catch (error) {
    log.error('Failed to delete webhook', { error });
    return false;
  }
}

/**
 * Telegram captions are limited to 1024 chars. Truncate if needed.
 */
function truncateCaption(text: string): string {
  const MAX = 1024;
  if (text.length <= MAX) return text;
  return text.substring(0, MAX - 20) + '\n\n…(truncated)';
}
