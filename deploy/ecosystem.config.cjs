'use strict';

const path = require('node:path');

const deployRoot = process.env.CRAFT72_DEPLOY_ROOT || '/home/mun/apps/craft72-max-app';
const releaseRoot = path.resolve(__dirname, '..');

module.exports = {
  apps: [
    {
      name: 'craft72-max-api',
      script: path.join(__dirname, 'start-api.sh'),
      interpreter: 'none',
      cwd: path.join(releaseRoot, 'api'),
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      restart_delay: 2_000,
      max_restarts: 10,
      min_uptime: '10s',
      kill_timeout: 75_000,
      listen_timeout: 15_000,
      out_file: path.join(deployRoot, 'shared/logs/api.log'),
      error_file: path.join(deployRoot, 'shared/logs/api-error.log'),
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
        CRAFT72_DEPLOY_ROOT: deployRoot,
        CRAFT72_ENV_FILE: process.env.CRAFT72_ENV_FILE || path.join(deployRoot, 'shared/.env'),
        CRAFT72_API_ENTRYPOINT: path.join(releaseRoot, 'api/dist/index.js'),
      },
    },
    {
      name: 'craft72-max-worker',
      script: path.join(__dirname, 'start-worker.sh'),
      interpreter: 'none',
      cwd: path.join(releaseRoot, 'worker'),
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      restart_delay: 2_000,
      max_restarts: 10,
      min_uptime: '10s',
      // MAX (30s maximum) plus a final database write (60s maximum) must finish before SIGKILL.
      kill_timeout: 100_000,
      out_file: path.join(deployRoot, 'shared/logs/worker.log'),
      error_file: path.join(deployRoot, 'shared/logs/worker-error.log'),
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
        CRAFT72_DEPLOY_ROOT: deployRoot,
        CRAFT72_ENV_FILE: process.env.CRAFT72_ENV_FILE || path.join(deployRoot, 'shared/.env'),
        CRAFT72_WORKER_ENTRYPOINT: path.join(releaseRoot, 'worker/dist/index.js'),
      },
    },
  ],
};
