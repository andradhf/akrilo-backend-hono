/**
 * PM2 Ecosystem Configuration
 * Deploy with: pm2 start ecosystem.config.cjs
 *
 * Two processes are managed:
 *   1. nomorku-api    — The Hono HTTP server
 *   2. nomorku-worker — The BullMQ ERP queue worker
 *
 * They are kept separate so:
 *   - Worker restarts don't affect the HTTP server
 *   - Heavy ERP jobs don't block incoming HTTP requests
 *   - Each can be scaled independently
 */

module.exports = {
  apps: [
    // ─── HTTP API Server ─────────────────────────────────────────────────────
    {
      name: "nomorku-api",
      script: "src/index.ts",
      interpreter: "bun",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
      },
      error_file: "logs/api-error.log",
      out_file: "logs/api-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },

    // ─── BullMQ Worker ───────────────────────────────────────────────────────
    {
      name: "nomorku-worker",
      script: "src/queue/worker.ts",
      interpreter: "bun",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "256M",
      env: {
        NODE_ENV: "production",
      },
      error_file: "logs/worker-error.log",
      out_file: "logs/worker-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
