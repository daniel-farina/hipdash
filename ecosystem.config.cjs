// PM2 ecosystem for hipdash.
//
//   pm2 start ./ecosystem.config.cjs
//   pm2 save
//   pm2 logs mtplx-dashboard
//
// Single Node process serves:
//   - /api/* and /api/history/* (history backend, SQLite at backend/data/history.db)
//   - the built frontend at /
//   - proxies /admin /metrics /health /v1 /system-stats.json /opencode-* to
//     MTPLX (127.0.0.1:8088) and sidecar (127.0.0.1:8002) services.
//
// Listens on :9090 by default; override via the PORT env var.

const path = require('node:path');
const ROOT = __dirname;

module.exports = {
  apps: [
    {
      name: 'mtplx-dashboard',
      cwd: path.join(ROOT, 'backend'),
      script: 'src/server.js',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 50,
      restart_delay: 2000,
      kill_timeout: 5000,
      env: {
        NODE_ENV: 'production',
        PORT: '9090',
        BIND: '0.0.0.0',
        MTPLX_HOST: '127.0.0.1',
        MTPLX_PORT: '8088',
        SIDECAR_HOST: '127.0.0.1',
        SIDECAR_PORT: '8002',
        DATA_DIR: path.join(ROOT, 'backend', 'data'),
      },
      out_file: path.join(ROOT, 'logs', 'dashboard.out.log'),
      error_file: path.join(ROOT, 'logs', 'dashboard.err.log'),
      merge_logs: true,
    },
  ],
};
