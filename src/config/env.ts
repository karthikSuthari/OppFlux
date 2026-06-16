// ===========================================
// Environment Configuration Loader
// ===========================================

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import type { AppConfig } from '../types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Validates and loads all required environment variables.
 * Fails fast with descriptive errors if any are missing.
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

  function optionalEnv(key: string, defaultValue: string): string {
    const value = process.env[key];
    return value && value.trim() !== '' ? value.trim() : defaultValue;
  }

  const config: AppConfig = {
    geminiApiKey: requireEnv('GEMINI_API_KEY'),
    googleSheetsId: requireEnv('GOOGLE_SHEETS_ID'),
    googleServiceAccountEmail: requireEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
    googlePrivateKey: requireEnv('GOOGLE_PRIVATE_KEY'),
    imageOutputDir: optionalEnv('IMAGE_OUTPUT_DIR', './images'),
    logLevel: optionalEnv('LOG_LEVEL', 'info'),
    pollIntervalMinutes: parseInt(optionalEnv('POLL_INTERVAL_MINUTES', '30'), 10),
    dryRun: optionalEnv('DRY_RUN', 'false').toLowerCase() === 'true',
    geminiRateLimitMs: parseInt(optionalEnv('GEMINI_RATE_LIMIT_MS', '1500'), 10),
    telegramBotToken: requireEnv('TELEGRAM_BOT_TOKEN'),
    telegramChatId: requireEnv('TELEGRAM_CHAT_ID'),
    webhookPort: parseInt(optionalEnv('WEBHOOK_PORT', '3000'), 10),
    webhookUrl: optionalEnv('WEBHOOK_URL', ''),
    webhookSecret: optionalEnv('WEBHOOK_SECRET', ''),
    nodeEnv: optionalEnv('NODE_ENV', 'development'),
  };

  if (missing.length > 0) {
    console.error('\n❌ Missing required environment variables:');
    missing.forEach((key) => console.error(`   - ${key}`));
    console.error('\nCopy .env.example to .env and fill in the values:');
    console.error('  cp .env.example .env\n');
    process.exit(1);
  }

  // Fix escaped newlines in private key (common issue with .env files)
  config.googlePrivateKey = config.googlePrivateKey.replace(/\\n/g, '\n');

  return config;
}

export const config = loadConfig();
