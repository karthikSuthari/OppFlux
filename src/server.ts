// ===========================================
// Webhook Server — Express HTTP for Telegram
// ===========================================

import express from 'express';
import { config } from './config/env.js';
import { logger } from './utils/logger.js';
import { processUpdate } from './services/telegram-callback.service.js';
import * as telegramService from './services/telegram.service.js';
import * as sheetsService from './services/sheets.service.js';
import type { TelegramUpdate } from './types/index.js';

const log = logger;
const app = express();

// Parse JSON request bodies
app.use(express.json());

/**
 * Health check endpoint
 */
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'content-engine-webhook',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Telegram webhook endpoint.
 * Receives updates from Telegram when users interact with inline keyboard buttons.
 * Validates the secret token header for security.
 */
app.post('/webhook', async (req, res) => {
  // Validate secret token
  const secretToken = req.headers['x-telegram-bot-api-secret-token'];
  if (config.webhookSecret && secretToken !== config.webhookSecret) {
    log.warn('Webhook request with invalid secret token');
    res.sendStatus(403);
    return;
  }

  // Always respond 200 immediately to Telegram
  res.sendStatus(200);

  // Process the update asynchronously
  const update = req.body as TelegramUpdate;

  try {
    await processUpdate(update);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error('Error processing webhook update', { error: errMsg, updateId: update.update_id });
  }
});

/**
 * Start the webhook server
 */
async function startServer(): Promise<void> {
  log.info('╔═══════════════════════════════════════════════╗');
  log.info('║   Content Engine — Webhook Server v1.0.0      ║');
  log.info('╚═══════════════════════════════════════════════╝');

  // Initialize Google Sheets connection
  log.info('Initializing Google Sheets...');
  await sheetsService.initializeSheets();

  // Start HTTP server
  const port = config.webhookPort;
  app.listen(port, () => {
    log.info(`🌐 Webhook server listening on port ${port}`);
    log.info(`   Health: http://localhost:${port}/health`);
    log.info(`   Webhook: http://localhost:${port}/webhook`);
  });

  // Set up Telegram webhook if URL is configured
  if (config.webhookUrl) {
    const webhookEndpoint = `${config.webhookUrl}/webhook`;
    log.info(`Setting Telegram webhook to: ${webhookEndpoint}`);
    const success = await telegramService.setWebhook(webhookEndpoint);

    if (success) {
      log.info('✅ Telegram webhook registered successfully');
    } else {
      log.error('❌ Failed to register Telegram webhook');
      log.info('You can manually set it via:');
      log.info(`  curl -X POST "https://api.telegram.org/bot${config.telegramBotToken}/setWebhook" \\`);
      log.info(`    -H "Content-Type: application/json" \\`);
      log.info(`    -d '{"url": "${webhookEndpoint}", "secret_token": "${config.webhookSecret}"}'`);
    }
  } else {
    log.warn('⚠️ WEBHOOK_URL not configured — set it in .env to register the webhook');
    log.info('The server is running but Telegram won\'t send updates until webhook is set.');
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  log.error('Uncaught exception in webhook server', {
    error: error.message,
    stack: error.stack,
  });
});

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled promise rejection in webhook server', {
    reason: String(reason),
  });
});

// Start
startServer().catch((error) => {
  log.error('Failed to start webhook server', { error: String(error) });
  process.exit(1);
});
