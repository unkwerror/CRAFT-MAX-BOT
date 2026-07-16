import { pathToFileURL } from 'node:url';

import { parseServerEnvironment } from '@craft72/config';
import { createDatabaseClient } from '@craft72/database';

import { MaxApiClient } from './max-api.js';
import { PostgresBotWorkerStore } from './repository.js';
import { runBotWorker, type WorkerLogger } from './runtime.js';

export * from './bot-plan.js';
export * from './max-api.js';
export * from './max-update.js';
export * from './processor.js';
export * from './repository.js';
export * from './retry.js';
export * from './runtime.js';

/** Process name consumed by the Stage 4 PM2 runtime. */
export const workerRuntimeName = 'craft72-max-worker' as const;

const log: WorkerLogger = (level, event, fields = {}) => {
  const line = `${JSON.stringify({ event, fields, level, timestamp: new Date().toISOString() })}\n`;
  (level === 'error' ? process.stderr : process.stdout).write(line);
};

async function main(): Promise<void> {
  const environment = parseServerEnvironment(process.env);
  const databaseClient = createDatabaseClient({
    connectionString: environment.DATABASE_URL,
    max: environment.DB_POOL_MAX,
    connectionTimeoutMillis: environment.DB_CONNECTION_TIMEOUT_MS,
    statement_timeout: environment.DB_STATEMENT_TIMEOUT_MS,
    application_name: workerRuntimeName,
  });
  const store = new PostgresBotWorkerStore(databaseClient.db);
  const maxApi = new MaxApiClient({
    baseUrl: environment.MAX_API_BASE_URL,
    timeoutMs: environment.MAX_API_TIMEOUT_MS,
    token: environment.MAX_BOT_TOKEN,
  });
  const shutdownController = new AbortController();
  let signalReceived: NodeJS.Signals | null = null;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (signalReceived !== null) return;
    signalReceived = signal;
    log('info', 'worker_shutdown_started', { signal });
    shutdownController.abort();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  try {
    await store.isReady();
    log('info', 'worker_started');
    await runBotWorker(
      {
        baseDelayMs: environment.BOT_RETRY_BASE_MS,
        leaseSeconds: environment.BOT_WORKER_LEASE_SECONDS,
        log,
        maxApi,
        maxAttempts: environment.BOT_WORKER_MAX_ATTEMPTS,
        maximumDelayMs: environment.BOT_RETRY_MAX_MS,
        pollIntervalMs: environment.BOT_WORKER_POLL_INTERVAL_MS,
        store,
        webApp: environment.MAX_BOT_PUBLIC_NAME,
      },
      shutdownController.signal,
    );
  } finally {
    await databaseClient.close();
    log('info', 'worker_stopped', { signal: signalReceived });
  }
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  void main().catch((error: unknown) => {
    log('error', 'worker_startup_failed', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    process.exitCode = 1;
  });
}
