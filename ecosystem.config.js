// ===========================================
// PM2 Ecosystem Configuration
// ===========================================
// Run with: pm2 start ecosystem.config.js
// Monitor: pm2 monit
// Logs: pm2 logs

module.exports = {
  apps: [
    // ─── Pipeline (Cron Job: every 1 hour) ───
    {
      name: 'content-engine',
      script: 'dist/index.js',

      // Cron: run every 1 hour
      cron_restart: '0 * * * *',

      // Don't auto-restart between cron runs
      autorestart: false,

      // Resource limits
      max_memory_restart: '512M',

      // Environment
      env: {
        NODE_ENV: 'production',
      },

      // Logging
      log_file: './logs/pm2-pipeline-combined.log',
      out_file: './logs/pm2-pipeline-out.log',
      error_file: './logs/pm2-pipeline-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
      merge_logs: true,

      // Misc
      watch: false,
      instances: 1,
      exec_mode: 'fork',
    },

    // ─── Unified Server (Always Running — Webhook Mode) ───
    {
      name: 'content-server',
      script: 'dist/server.js',

      // Always running — restart on crash
      autorestart: true,

      // Resource limits
      max_memory_restart: '256M',

      // Restart delay on crash
      restart_delay: 5000,
      max_restarts: 10,

      // Graceful shutdown
      kill_timeout: 5000,

      // Environment
      env: {
        NODE_ENV: 'production',
      },

      // Logging
      log_file: './logs/pm2-server-combined.log',
      out_file: './logs/pm2-server-out.log',
      error_file: './logs/pm2-server-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
      merge_logs: true,

      // Misc
      watch: false,
      instances: 1,
      exec_mode: 'fork',
    },
  ],
};
