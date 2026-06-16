// ===========================================
// Telegram Webhook Status — Utility Script
// ===========================================
// Usage: npm run webhook:status
// ===========================================

import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const log = logger;
const API_BASE = `https://api.telegram.org/bot${config.telegramBotToken}`;

async function checkWebhookStatus(): Promise<void> {
  log.info('═══════════════════════════════════════════');
  log.info('📡 Telegram Webhook Status');
  log.info('═══════════════════════════════════════════');

  try {
    // Get webhook info
    const infoRes = await fetch(`${API_BASE}/getWebhookInfo`);
    const infoData = await infoRes.json() as {
      ok: boolean;
      result?: {
        url: string;
        has_custom_certificate: boolean;
        pending_update_count: number;
        last_error_date?: number;
        last_error_message?: string;
        max_connections?: number;
        allowed_updates?: string[];
      };
    };

    if (!infoData.ok || !infoData.result) {
      log.error('❌ Failed to get webhook info');
      process.exit(1);
    }

    const info = infoData.result;

    log.info('');
    if (info.url) {
      log.info(`  Mode:            WEBHOOK`);
      log.info(`  URL:             ${info.url}`);
    } else {
      log.info(`  Mode:            POLLING (no webhook set)`);
    }

    log.info(`  Pending updates: ${info.pending_update_count}`);
    log.info(`  Custom cert:     ${info.has_custom_certificate ? 'Yes' : 'No'}`);
    log.info(`  Max connections:  ${info.max_connections || 'default (40)'}`);
    log.info(`  Allowed updates: ${info.allowed_updates?.join(', ') || 'all'}`);

    if (info.last_error_message) {
      const errorDate = info.last_error_date
        ? new Date(info.last_error_date * 1000).toLocaleString()
        : 'unknown';
      log.warn('');
      log.warn(`  ⚠️ Last error: ${info.last_error_message}`);
      log.warn(`     At: ${errorDate}`);
    } else {
      log.info('  Last error:      None ✅');
    }

    // Get bot info
    const meRes = await fetch(`${API_BASE}/getMe`);
    const meData = await meRes.json() as {
      ok: boolean;
      result?: { username: string; first_name: string; id: number };
    };

    if (meData.ok && meData.result) {
      log.info('');
      log.info(`  Bot: @${meData.result.username} (${meData.result.first_name})`);
      log.info(`  Bot ID: ${meData.result.id}`);
    }

    log.info('');
    log.info('═══════════════════════════════════════════');
  } catch (error) {
    log.error('❌ Failed to check webhook status', { error: String(error) });
    process.exit(1);
  }

  process.exit(0);
}

checkWebhookStatus();
