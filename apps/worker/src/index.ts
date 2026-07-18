import { pathToFileURL } from 'node:url';

import { parseServerEnvironment } from '@craft72/config';
import { createDatabaseClient } from '@craft72/database';

import { MaxApiClient } from './max-api.js';
import { PostgresBotWorkerStore } from './repository.js';
import { runBotWorker, type WorkerLogger } from './runtime.js';
import { TrackerApiClient } from './tracker-api.js';
import { PostgresTrackerOutboxStore } from './tracker-repository.js';
import { runTrackerWorker } from './tracker-runtime.js';

export * from './bot-plan.js';
export * from './max-api.js';
export * from './max-update.js';
export * from './processor.js';
export * from './repository.js';
export * from './retry.js';
export * from './runtime.js';
export * from './tracker-api.js';
export * from './tracker-plan.js';
export * from './tracker-repository.js';
export * from './tracker-runtime.js';

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
  const botStore = new PostgresBotWorkerStore(databaseClient.db);
  const trackerStore = new PostgresTrackerOutboxStore(databaseClient.db);
  const maxApi = new MaxApiClient({
    baseUrl: environment.MAX_API_BASE_URL,
    timeoutMs: environment.MAX_API_TIMEOUT_MS,
    token: environment.MAX_BOT_TOKEN,
  });
  const trackerApi = new TrackerApiClient({
    authType: environment.TRACKER_AUTH_TYPE,
    baseUrl: environment.TRACKER_API_BASE_URL,
    organizationHeader: environment.TRACKER_ORG_HEADER,
    organizationId: environment.TRACKER_ORG_ID,
    timeoutMs: environment.TRACKER_API_TIMEOUT_MS,
    token: environment.TRACKER_TOKEN,
  });
  const trackerProductionWritesApproved = environment.TRACKER_PRODUCTION_WRITES_APPROVED;
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
    await botStore.isReady();
    const trackerBackfilledOperations = await trackerStore.backfillTrackerOutbox(new Date());
    if (trackerBackfilledOperations > 0) {
      log('info', 'tracker_outbox_backfilled', { operations: trackerBackfilledOperations });
    }
    log('info', 'worker_started', {
      trackerDryRun: environment.TRACKER_DRY_RUN,
      trackerWritesEnabled: !environment.TRACKER_DRY_RUN && trackerProductionWritesApproved,
    });
    await Promise.all([
      runBotWorker(
        {
          baseDelayMs: environment.BOT_RETRY_BASE_MS,
          leaseSeconds: environment.BOT_WORKER_LEASE_SECONDS,
          log,
          maxApi,
          managerDisplayName: environment.MAX_MANAGER_DISPLAY_NAME,
          managerUserId: environment.MAX_MANAGER_USER_ID,
          maxAttempts: environment.BOT_WORKER_MAX_ATTEMPTS,
          maximumDelayMs: environment.BOT_RETRY_MAX_MS,
          pollIntervalMs: environment.BOT_WORKER_POLL_INTERVAL_MS,
          store: botStore,
          webApp: environment.MAX_BOT_PUBLIC_NAME,
        },
        shutdownController.signal,
      ),
      runTrackerWorker(
        {
          apiTimeoutMs: environment.TRACKER_API_TIMEOUT_MS,
          assignee: environment.TRACKER_ASSIGNEE.length === 0 ? null : environment.TRACKER_ASSIGNEE,
          baseDelayMs: environment.TRACKER_RETRY_BASE_MS,
          dryRun: environment.TRACKER_DRY_RUN,
          leaseSeconds: environment.TRACKER_WORKER_LEASE_SECONDS,
          log,
          maxAttempts: environment.TRACKER_WORKER_MAX_ATTEMPTS,
          maximumDelayMs: environment.TRACKER_RETRY_MAX_MS,
          pollIntervalMs: environment.TRACKER_WORKER_POLL_INTERVAL_MS,
          productionWritesApproved: trackerProductionWritesApproved,
          store: trackerStore,
          trackerApi,
        },
        shutdownController.signal,
      ),
    ]);
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
