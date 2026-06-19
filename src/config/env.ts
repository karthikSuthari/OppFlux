// ===========================================
// Environment Configuration Loader
// ===========================================

import dotenv from 'dotenv';
import path from 'path';
import type { AppConfig } from '../types/index.js';

// Load .env
const envPath = path.resolve(process.cwd(), '.env');

console.log('Loading env from:', envPath);

const result = dotenv.config({
  path: envPath,
});

console.log('Dotenv result:', result.error ? result.error : 'Loaded');
console.log('GROQ =', process.env.GROQ_API_KEY);
console.log('NODE_ENV =', process.env.NODE_ENV);

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
    groqApiKey: requireEnv('GROQ_API_KEY'),
    geminiApiKey: requireEnv('GEMINI_API_KEY'),

    googleSheetsId: requireEnv('GOOGLE_SHEETS_ID'),
    googleServiceAccountEmail: requireEnv(
      'GOOGLE_SERVICE_ACCOUNT_EMAIL'
    ),
    googlePrivateKey: requireEnv(
      'GOOGLE_PRIVATE_KEY'
    ),

    imageOutputDir: optionalEnv(
      'IMAGE_OUTPUT_DIR',
      './images'
    ),

    logLevel: optionalEnv(
      'LOG_LEVEL',
      'info'
    ),

    pollIntervalMinutes: parseInt(
      optionalEnv(
        'POLL_INTERVAL_MINUTES',
        '30'
      ),
      10
    ),

    dryRun:
      optionalEnv('DRY_RUN', 'false')
        .toLowerCase() === 'true',

    geminiRateLimitMs: parseInt(
      optionalEnv(
        'GEMINI_RATE_LIMIT_MS',
        '1500'
      ),
      10
    ),

    telegramBotToken: optionalEnv(
      'TELEGRAM_BOT_TOKEN',
      ''
    ),

    telegramChatId: optionalEnv(
      'TELEGRAM_CHAT_ID',
      ''
    ),

    discordWebhookUrl: optionalEnv(
      'DISCORD_WEBHOOK_URL',
      ''
    ),

    discordBotToken:
      optionalEnv(
        'DISCORD_BOT_TOKEN',
        ''
      ),

    discordChannelId:
      optionalEnv(
        'DISCORD_CHANNEL_ID',
        ''
      ),

    webhookPort: parseInt(
      optionalEnv(
        'WEBHOOK_PORT',
        '3000'
      ),
      10
    ),

    webhookUrl: optionalEnv(
      'WEBHOOK_URL',
      ''
    ),

    webhookSecret: optionalEnv(
      'WEBHOOK_SECRET',
      ''
    ),

    nodeEnv: optionalEnv(
      'NODE_ENV',
      'development'
    ),
  };

  if (missing.length > 0) {
    console.log('MISSING =', missing);
    console.log('GROQ =', process.env.GROQ_API_KEY);
    console.log('NODE_ENV =', process.env.NODE_ENV);

    process.exit(1);
  }

  config.googlePrivateKey =
    config.googlePrivateKey.replace(
      /\\n/g,
      '\n'
    );

  return config;
}

export const config = loadConfig();