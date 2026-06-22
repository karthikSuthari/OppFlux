// ===========================================
// Opportunity Content Engine — Entry Point
// ===========================================
// This runs the pipeline ONCE and exits.
// PM2 cron_restart handles scheduling.
// Discord bot runs in server.ts (content-server PM2 app).
// ===========================================

import { runPipeline } from './pipeline/runner.js';
import { logger } from './utils/logger.js';

const log = logger;

/**
 * Main entry point.
 * Runs the opportunity content pipeline once and exits cleanly.
 * PM2 cron_restart will restart this process on schedule.
 */
async function main(): Promise<void> {
  log.info('╔═══════════════════════════════════════════════╗');
  log.info('║   Opportunity Content Engine v2.0.0           ║');
  log.info('║   Student Opportunity Discovery Pipeline      ║');
  log.info('╚═══════════════════════════════════════════════╝');
  log.info('   Scheduling is handled by PM2 cron_restart.');

  const startTime = Date.now();

  try {
    const summary = await runPipeline();

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
    log.info(`Pipeline execution time: ${totalDuration}s`);

    if (summary.errors > 0 && summary.opportunitiesCreated === 0) {
      log.error('Pipeline completed with errors and no opportunities created');
      process.exit(1);
    }

    process.exit(0);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : '';
    log.error('Fatal pipeline error', { error: errMsg, stack });
    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  log.error('Uncaught exception', {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason) => {
  log.error('Unhandled promise rejection', {
    reason: String(reason),
  });
  process.exit(1);
});

// Run
main();
