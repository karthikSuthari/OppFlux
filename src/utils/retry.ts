// ===========================================
// Retry with Exponential Backoff
// ===========================================

import { createServiceLogger } from './logger.js';

const log = createServiceLogger('retry');

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  operationName?: string;
}

/**
 * Wraps an async function with retry logic using exponential backoff.
 * 
 * @param fn - The async function to retry
 * @param options - Retry configuration
 * @returns The result of the function call
 * @throws The last error if all retries are exhausted
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    operationName = 'operation',
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === maxRetries) {
        log.error(`${operationName} failed after ${maxRetries + 1} attempts`, {
          error: lastError.message,
          attempts: attempt + 1,
        });
        throw lastError;
      }

      // Exponential backoff with jitter
      const delay = Math.min(
        baseDelayMs * Math.pow(2, attempt) + Math.random() * 500,
        maxDelayMs
      );

      log.warn(`${operationName} attempt ${attempt + 1} failed, retrying in ${Math.round(delay)}ms`, {
        error: lastError.message,
        nextAttempt: attempt + 2,
        maxAttempts: maxRetries + 1,
      });

      await sleep(delay);
    }
  }

  // TypeScript exhaustiveness — should never reach here
  throw lastError;
}

/**
 * Sleep for a specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
