import { parseServerEnvironment } from '@craft72/config';
import { createDatabaseClient } from '@craft72/database';

import { PostgresStage3Store } from './repository.js';
import { buildStage3Api } from './server.js';

export const apiRuntimeName = 'craft72-max-api' as const;

const environment = parseServerEnvironment(process.env);
const databaseClient = createDatabaseClient({
  connectionString: environment.DATABASE_URL,
  max: environment.DB_POOL_MAX,
  connectionTimeoutMillis: environment.DB_CONNECTION_TIMEOUT_MS,
  statement_timeout: environment.DB_STATEMENT_TIMEOUT_MS,
  application_name: apiRuntimeName,
});
const store = new PostgresStage3Store(databaseClient.db, {
  sessionTtlSeconds: environment.SESSION_TTL_SECONDS,
  draftTtlSeconds: environment.DRAFT_TTL_SECONDS,
  submissionRetentionDays: environment.SUBMISSION_RETENTION_DAYS,
});
const app = await buildStage3Api({
  store,
  botToken: environment.MAX_BOT_TOKEN,
  maxWebhookSecret: environment.MAX_WEBHOOK_SECRET,
  consentVersion: environment.CONSENT_VERSION,
  initDataMaxAgeSeconds: environment.MAX_INIT_DATA_MAX_AGE_SECONDS,
  contactMaxAgeSeconds: environment.MAX_CONTACT_MAX_AGE_SECONDS,
  publicBaseUrl: environment.PUBLIC_BASE_URL,
  rateLimitMax: environment.API_RATE_LIMIT_MAX,
  rateLimitWindowSeconds: environment.API_RATE_LIMIT_WINDOW_SECONDS,
  logger: {
    level: environment.LOG_LEVEL,
    redact: {
      censor: '[REDACTED]',
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers.x-max-bot-api-secret',
        'req.body',
        'res.headers.set-cookie',
      ],
    },
  },
});

let shuttingDown = false;
let cleanupTimer: NodeJS.Timeout | undefined;
const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  if (cleanupTimer !== undefined) clearInterval(cleanupTimer);
  app.log.info({ signal }, 'Shutting down API');
  const timeout = setTimeout(() => {
    app.log.error('Graceful shutdown timed out');
    process.exitCode = 1;
  }, environment.SHUTDOWN_GRACE_MS);
  timeout.unref();

  try {
    await app.close();
    await databaseClient.close();
  } finally {
    clearTimeout(timeout);
  }
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await store.cleanupExpired();
  await app.listen({ host: environment.API_HOST, port: environment.API_PORT });
  cleanupTimer = setInterval(() => {
    void store.cleanupExpired().catch((error: unknown) => {
      app.log.error(
        { errorName: error instanceof Error ? error.name : 'UnknownError' },
        'Retention cleanup failed',
      );
    });
  }, environment.RETENTION_CLEANUP_INTERVAL_SECONDS * 1_000);
  cleanupTimer.unref();
} catch (error) {
  app.log.error(
    { errorName: error instanceof Error ? error.name : 'UnknownError' },
    'API startup failed',
  );
  await databaseClient.close();
  process.exitCode = 1;
}
