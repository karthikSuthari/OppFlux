// ===========================================
// Unified Server — Dual-Mode Telegram Bot
// ===========================================
// Development: Telegram long-polling (no webhook needed)
// Production:  Telegram webhooks via HTTPS
// ===========================================

import express from 'express';
import { config } from './config/env.js';
import { logger } from './utils/logger.js';
import { processUpdate } from './services/telegram-callback.service.js';
import * as telegramService from './services/telegram.service.js';
import * as telegramPolling from './services/telegram-polling.service.js';
import * as sheetsService from './services/sheets.service.js';
import type { TelegramUpdate } from './types/index.js';

const log = logger;
const app = express();

// Parse JSON request bodies
app.use(express.json());

// ═══════════════════════════════════════════
// Routes
// ═══════════════════════════════════════════

/**
 * Health check endpoint — always available
 */
app.get('/health', (_req, res) => {
  const mode = isProductionWebhookMode() ? 'webhook' : 'polling';
  res.json({
    status: 'ok',
    service: 'content-engine',
    mode,
    environment: config.nodeEnv,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Telegram webhook endpoint (production only).
 * POST /api/telegram/webhook
 *
 * Receives updates from Telegram when users interact with inline keyboard buttons.
 * Validates the secret token header for security.
 */
app.post('/api/telegram/webhook', async (req, res) => {
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

// ═══════════════════════════════════════════
// Mode Detection
// ═══════════════════════════════════════════

/**
 * Determine if we should run in webhook mode.
 * Webhook mode requires: NODE_ENV=production AND a WEBHOOK_URL.
 */
function isProductionWebhookMode(): boolean {
  return config.nodeEnv === 'production' && !!config.webhookUrl;
}

// ═══════════════════════════════════════════
// Server Startup
// ═══════════════════════════════════════════

async function startServer(): Promise<void> {
  const mode = isProductionWebhookMode() ? 'webhook' : 'polling';

  log.info('╔═══════════════════════════════════════════════╗');
  log.info('║   Content Engine — Unified Server v2.0.0      ║');
  log.info('╚═══════════════════════════════════════════════╝');
  log.info(`   Environment: ${config.nodeEnv}`);
  log.info(`   Telegram mode: ${mode}`);

  // Initialize Google Sheets connection
  log.info('Initializing Google Sheets...');
  await sheetsService.initializeSheets();

  // Start HTTP server (needed for health check + webhook)
  const port = config.webhookPort;
  await new Promise<void>((resolve) => {
    app.listen(port, () => {
      log.info(`🌐 HTTP server listening on port ${port}`);
      log.info(`   Health: http://localhost:${port}/health`);
      if (isProductionWebhookMode()) {
        log.info(`   Webhook: http://localhost:${port}/api/telegram/webhook`);
      }
      resolve();
    });
  });

  if (isProductionWebhookMode()) {
    // ── Production: Webhook Mode ──
    await startWebhookMode();
  } else {
    // ── Development: Polling Mode ──
    await startPollingMode();
  }
}

/**
 * Start webhook mode: register webhook URL with Telegram
 */
async function startWebhookMode(): Promise<void> {
  const webhookEndpoint = `${config.webhookUrl}/api/telegram/webhook`;
  log.info(`Setting Telegram webhook to: ${webhookEndpoint}`);

  const success = await telegramService.setWebhook(webhookEndpoint);

  if (success) {
    log.info('✅ Telegram webhook registered successfully');
    log.info('📡 Waiting for incoming webhook requests...');
  } else {
    log.error('❌ Failed to register Telegram webhook');
    log.info('You can manually register via:');
    log.info(`  npm run webhook:register`);
  }
}

/**
 * Start polling mode: use long-polling to fetch Telegram updates
 */
async function startPollingMode(): Promise<void> {
  log.info('📱 Starting Telegram bot in polling mode...');
  log.info('   No WEBHOOK_URL needed — perfect for local development');

  // Start polling (this runs in the background)
  telegramPolling.startPolling().catch((error) => {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error('Polling loop crashed', { error: errMsg });
  });
}

// ═══════════════════════════════════════════
// Graceful Shutdown
// ═══════════════════════════════════════════

async function gracefulShutdown(signal: string): Promise<void> {
  log.info(`${signal} received — shutting down gracefully...`);

  // Stop polling if running
  telegramPolling.stopPolling();

  // Delete webhook if in production mode (optional, keeps things clean)
  if (isProductionWebhookMode()) {
    try {
      await telegramService.deleteWebhook();
      log.info('Webhook removed');
    } catch {
      // Best effort — don't block shutdown
    }
  }

  log.info('👋 Server shutdown complete');
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  log.error('Uncaught exception in server', {
    error: error.message,
    stack: error.stack,
  });
});

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled promise rejection in server', {
    reason: String(reason),
  });
});

// Start
startServer().catch((error) => {
  log.error('Failed to start server', { error: String(error) });
  process.exit(1);
});
