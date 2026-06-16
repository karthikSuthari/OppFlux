// ===========================================
// Register Telegram Webhook — Utility Script
// ===========================================
// Usage: npm run webhook:register
// ===========================================

import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const log = logger;
const API_BASE = `https://api.telegram.org/bot${config.telegramBotToken}`;

async function registerWebhook(): Promise<void> {
  log.info('═══════════════════════════════════════════');
  log.info('🔗 Telegram Webhook Registration');
  log.info('═══════════════════════════════════════════');

  if (!config.webhookUrl) {
    log.error('❌ WEBHOOK_URL is not set in .env');
    log.info('   Set WEBHOOK_URL to your public HTTPS URL and try again.');
    process.exit(1);
  }

  const webhookEndpoint = `${config.webhookUrl}/api/telegram/webhook`;

  // Step 1: Delete existing webhook
  log.info('Step 1: Clearing existing webhook...');
  try {
    const delRes = await fetch(`${API_BASE}/deleteWebhook`, { method: 'POST' });
    const delData = await delRes.json() as { ok: boolean };
    log.info(delData.ok ? '  ✅ Old webhook cleared' : '  ⚠️ Could not clear old webhook');
  } catch (error) {
    log.warn('  ⚠️ Failed to clear webhook', { error: String(error) });
  }

  // Step 2: Register new webhook
  log.info(`Step 2: Registering webhook: ${webhookEndpoint}`);
  try {
    const body: Record<string, unknown> = {
      url: webhookEndpoint,
      allowed_updates: ['callback_query', 'message'],
    };

    if (config.webhookSecret) {
      body.secret_token = config.webhookSecret;
    }

    const setRes = await fetch(`${API_BASE}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const setData = await setRes.json() as { ok: boolean; description?: string };

    if (setData.ok) {
      log.info('  ✅ Webhook registered successfully');
    } else {
      log.error(`  ❌ Failed: ${setData.description}`);
      process.exit(1);
    }
  } catch (error) {
    log.error('  ❌ Failed to register webhook', { error: String(error) });
    process.exit(1);
  }

  // Step 3: Verify
  log.info('Step 3: Verifying webhook...');
  try {
    const infoRes = await fetch(`${API_BASE}/getWebhookInfo`);
    const infoData = await infoRes.json() as {
      ok: boolean;
      result?: {
        url: string;
        pending_update_count: number;
        last_error_date?: number;
        last_error_message?: string;
        allowed_updates?: string[];
      };
    };

    if (infoData.ok && infoData.result) {
      const info = infoData.result;
      log.info('');
      log.info('═══════════════════════════════════════════');
      log.info('📋 Webhook Status');
      log.info('═══════════════════════════════════════════');
      log.info(`  URL:             ${info.url}`);
      log.info(`  Pending updates: ${info.pending_update_count}`);
      log.info(`  Allowed updates: ${info.allowed_updates?.join(', ') || 'all'}`);

      if (info.last_error_message) {
        const errorDate = info.last_error_date
          ? new Date(info.last_error_date * 1000).toLocaleString()
          : 'unknown';
        log.warn(`  Last error:      ${info.last_error_message} (${errorDate})`);
      } else {
        log.info('  Last error:      None');
      }

      log.info('═══════════════════════════════════════════');
      log.info('✅ Webhook is ready!');
    }
  } catch (error) {
    log.warn('Could not verify webhook', { error: String(error) });
  }

  process.exit(0);
}

registerWebhook();
