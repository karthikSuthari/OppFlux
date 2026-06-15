// ===========================================
// PM2 Ecosystem Configuration
// ===========================================
// Run with: pm2 start ecosystem.config.js
// Monitor: pm2 monit
// Logs: pm2 logs content-engine

module.exports = {
  apps: [
    {
      name: 'content-engine',
      script: 'dist/index.js',

      // Cron-based scheduling: run every 30 minutes
      cron_restart: '*/30 * * * *',

      // Don't auto-restart between cron runs
      autorestart: false,

      // Node.js ES modules support
      node_args: '--experimental-specifier-resolution=node',

      // Resource limits
      max_memory_restart: '512M',

      // Environment
      env: {
        NODE_ENV: 'production',
      },

      // Logging
      log_file: './logs/pm2-combined.log',
      out_file: './logs/pm2-out.log',
      error_file: './logs/pm2-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
      merge_logs: true,

      // Misc
      watch: false,
      instances: 1,
      exec_mode: 'fork',
    },
  ],
};
