// ===========================================
// Opportunity Content Engine — Entry Point
// ===========================================
import cron from 'node-cron';
import './services/discord-bot.js';
import { runPipeline } from './pipeline/runner.js';
import { logger } from './utils/logger.js';

const log = logger;

/**
 * Main entry point.
 * Runs the opportunity content pipeline and exits with appropriate code.
 */
async function main(): Promise<void> {
  log.info('╔═══════════════════════════════════════════════╗');
  log.info('║   Opportunity Content Engine v1.0.0           ║');
  log.info('║   Student Opportunity Discovery Pipeline      ║');
  log.info('╚═══════════════════════════════════════════════╝');

  // Schedule the pipeline to run every 6 hours
  cron.schedule('0 */6 * * *', async () => {
    log.info('⏰ Running scheduled pipeline task...');
    const startTime = Date.now();
    try {
      const summary = await runPipeline();
      const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
      log.info(`Scheduled pipeline execution time: ${totalDuration}s`);
      
      if (summary.errors > 0 && summary.opportunitiesCreated === 0) {
        log.error('Scheduled pipeline completed with errors and no opportunities created');
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : '';
      log.error('Fatal scheduled pipeline error', { error: errMsg, stack });
    }
  });
  
  log.info('✅ node-cron scheduler started. Pipeline will run every 6 hours.');

  // Run immediately on startup once
  const startTime = Date.now();

  try {
    const summary = await runPipeline();

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
    log.info(`Initial execution time: ${totalDuration}s`);

    // Exit with error code if there were critical failures
    if (summary.errors > 0 && summary.opportunitiesCreated === 0) {
      log.error('Pipeline completed with errors and no opportunities created');
      process.exit(1);
    }

    // process.exit(0); // Removed to keep Discord bot alive for reactions
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

