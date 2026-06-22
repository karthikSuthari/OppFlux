// ===========================================
// Content Engine — Server (Discord Bot + Health Check)
// ===========================================
// This is the always-running PM2 process.
// It runs the Discord bot for opportunity review reactions.
// ===========================================

import express from 'express';
import { config } from './config/env.js';
import { logger } from './utils/logger.js';
import * as sheetsService from './services/sheets.service.js';
import './services/discord-bot.js'; // Side-effect: starts the Discord bot

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
  res.json({
    status: 'ok',
    service: 'content-engine',
    environment: config.nodeEnv,
    timestamp: new Date().toISOString(),
  });
});

// ═══════════════════════════════════════════
// Server Startup
// ═══════════════════════════════════════════

async function startServer(): Promise<void> {
  log.info('╔═══════════════════════════════════════════════╗');
  log.info('║   Content Engine — Server v2.0.0              ║');
  log.info('║   Discord Bot + Health Check                  ║');
  log.info('╚═══════════════════════════════════════════════╝');
  log.info(`   Environment: ${config.nodeEnv}`);

  // Initialize Google Sheets connection
  log.info('Initializing Google Sheets...');
  await sheetsService.initializeSheets();

  // Start HTTP server (needed for health check)
  const port = config.webhookPort;
  await new Promise<void>((resolve) => {
    app.listen(port, () => {
      log.info(`🌐 HTTP server listening on port ${port}`);
      log.info(`   Health: http://localhost:${port}/health`);
      resolve();
    });
  });

  log.info('✅ Server ready — Discord bot is running, waiting for reactions...');
}

// ═══════════════════════════════════════════
// Graceful Shutdown
// ═══════════════════════════════════════════

async function gracefulShutdown(signal: string): Promise<void> {
  log.info(`${signal} received — shutting down gracefully...`);
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
