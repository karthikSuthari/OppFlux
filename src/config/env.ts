// ===========================================
// Environment Configuration Loader
// ===========================================

import dotenv from 'dotenv';
import path from 'path';
import type { AppConfig } from '../types/index.js';

// Load .env
const envPath = path.resolve(process.cwd(), '.env');

const result = dotenv.config({
  path: envPath,
});

if (result.error) {
  console.error('Failed to load .env file:', result.error.message);
}

/**
 * Validates and loads all required environment variables.
 */
function loadConfig(): AppConfig {
  const missing: string[] = [];

  function requireEnv(key: string): string {
    const value = process.env[key];

    if (!value || value.trim() === '') {
      missing.push(key);
      return '';
    }

    return value.trim();
  }

  function optionalEnv(
    key: string,
    defaultValue: string
  ): string {
    const value = process.env[key];

    return value && value.trim() !== ''
      ? value.trim()
      : defaultValue;
  }

  const config: AppConfig = {
    // AI
    groqApiKey: requireEnv('GROQ_API_KEY'),
    geminiApiKey: requireEnv('GEMINI_API_KEY'),

    // Google Sheets
    googleSheetsId: requireEnv('GOOGLE_SHEETS_ID'),
    googleServiceAccountEmail: requireEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
    googlePrivateKey: requireEnv('GOOGLE_PRIVATE_KEY'),

    // Discord
    discordBotToken: requireEnv('DISCORD_BOT_TOKEN'),
    discordChannelId: requireEnv('DISCORD_CHANNEL_ID'),
    discordWebhookUrl: optionalEnv('DISCORD_WEBHOOK_URL', ''),

    // Storage
    imageOutputDir: optionalEnv('IMAGE_OUTPUT_DIR', './images'),

    // Logging
    logLevel: optionalEnv('LOG_LEVEL', 'info'),

    // Pipeline
    pollIntervalMinutes: parseInt(
      optionalEnv('POLL_INTERVAL_MINUTES', '30'),
      10
    ),
    dryRun: optionalEnv('DRY_RUN', 'false').toLowerCase() === 'true',
    geminiRateLimitMs: parseInt(
      optionalEnv('GEMINI_RATE_LIMIT_MS', '1500'),
      10
    ),

    // Server
    webhookPort: parseInt(optionalEnv('WEBHOOK_PORT', '3000'), 10),
    nodeEnv: optionalEnv('NODE_ENV', 'development'),
  };

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    console.error('Copy .env.example to .env and fill in all required values.');
    process.exit(1);
  }

  // Force perfectly formatted PEM key by reconstructing it from scratch
  // This solves the issue where GitHub Secrets collapses the key into a single line with spaces
  let keyBody = config.googlePrivateKey
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\\n/g, '')
    .replace(/"/g, '')
    .replace(/\s+/g, ''); // Remove all spaces and newlines

  // Re-split the body into 64-character chunks which OpenSSL requires
  const chunks = [];
  for (let i = 0; i < keyBody.length; i += 64) {
    chunks.push(keyBody.substring(i, i + 64));
  }

  // Reconstruct the perfect PEM format
  config.googlePrivateKey = `-----BEGIN PRIVATE KEY-----\n${chunks.join('\n')}\n-----END PRIVATE KEY-----\n`;

  return config;
}

export const config = loadConfig();