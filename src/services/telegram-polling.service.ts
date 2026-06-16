// ===========================================
// Telegram Long-Polling Service
// ===========================================
// Used in development mode to receive updates
// without requiring a public HTTPS webhook URL.
// ===========================================

import { config } from '../config/env.js';
import { createServiceLogger } from '../utils/logger.js';
import { processUpdate } from './telegram-callback.service.js';
import { sleep } from '../utils/retry.js';
import type { TelegramUpdate } from '../types/index.js';

const log = createServiceLogger('telegram-polling');

const API_BASE = `https://api.telegram.org/bot${config.telegramBotToken}`;

/** Polling state */
let isPolling = false;
let pollAbortController: AbortController | null = null;

/** Polling configuration */
const POLL_TIMEOUT_SEC = 30;      // Long-poll timeout (Telegram holds connection)
const POLL_INTERVAL_MS = 500;     // Delay between poll cycles
const ERROR_BACKOFF_MS = 5000;    // Delay after an error before retrying
const MAX_ERROR_BACKOFF_MS = 60000;

/**
 * Delete any existing webhook so Telegram switches to getUpdates mode.
 * Telegram does not allow both webhook and polling simultaneously.
 */
async function deleteWebhookForPolling(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/deleteWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ drop_pending_updates: false }),
    });
    const data = await res.json() as { ok: boolean; description?: string };

    if (data.ok) {
      log.info('Cleared existing webhook for polling mode');
    } else {
      log.warn('Failed to clear webhook', { description: data.description });
    }

    return data.ok;
  } catch (error) {
    log.error('Error clearing webhook', { error: String(error) });
    return false;
  }
}

/**
 * Fetch updates from Telegram using long-polling (getUpdates).
 *
 * @param offset - The update_id offset to avoid re-processing
 * @returns Array of TelegramUpdate objects
 */
async function getUpdates(offset: number): Promise<TelegramUpdate[]> {
  pollAbortController = new AbortController();

  const body = {
    offset,
    timeout: POLL_TIMEOUT_SEC,
    allowed_updates: ['callback_query', 'message'],
  };

  const res = await fetch(`${API_BASE}/getUpdates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: pollAbortController.signal,
  });

  const data = await res.json() as { ok: boolean; result?: TelegramUpdate[] };

  if (!data.ok || !data.result) {
    throw new Error(`getUpdates failed: ${JSON.stringify(data)}`);
  }

  return data.result;
}

/**
 * Start the Telegram long-polling loop.
 * Continuously fetches updates from Telegram and processes them.
 *
 * This function blocks until `stopPolling()` is called.
 */
export async function startPolling(): Promise<void> {
  if (isPolling) {
    log.warn('Polling is already running');
    return;
  }

  // Must delete webhook first — Telegram doesn't allow both
  await deleteWebhookForPolling();

  isPolling = true;
  let offset = 0;
  let consecutiveErrors = 0;

  log.info('🔄 Starting Telegram long-polling...');
  log.info(`   Poll timeout: ${POLL_TIMEOUT_SEC}s`);
  log.info(`   Listening for: callback_query, message`);

  while (isPolling) {
    try {
      const updates = await getUpdates(offset);
      consecutiveErrors = 0; // Reset on success

      if (updates.length > 0) {
        log.debug(`Received ${updates.length} update(s)`);

        for (const update of updates) {
          // Move offset past this update to acknowledge it
          offset = update.update_id + 1;

          try {
            await processUpdate(update);
          } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            log.error('Error processing polled update', {
              updateId: update.update_id,
              error: errMsg,
            });
          }
        }
      }

      // Brief pause between poll cycles
      await sleep(POLL_INTERVAL_MS);
    } catch (error) {
      // Don't log abort errors (happens during graceful shutdown)
      if (error instanceof Error && error.name === 'AbortError') {
        log.info('Polling aborted (shutdown)');
        break;
      }

      consecutiveErrors++;
      const backoff = Math.min(ERROR_BACKOFF_MS * consecutiveErrors, MAX_ERROR_BACKOFF_MS);
      const errMsg = error instanceof Error ? error.message : String(error);

      log.error(`Polling error (attempt ${consecutiveErrors}), retrying in ${backoff}ms`, {
        error: errMsg,
      });

      await sleep(backoff);
    }
  }

  log.info('🛑 Telegram polling stopped');
}

/**
 * Gracefully stop the polling loop.
 */
export function stopPolling(): void {
  if (!isPolling) return;

  log.info('Stopping Telegram polling...');
  isPolling = false;

  // Abort any in-flight getUpdates request
  if (pollAbortController) {
    pollAbortController.abort();
    pollAbortController = null;
  }
}
