import { parseServerEnvironment } from '@craft72/config';
import { createDatabaseClient } from '@craft72/database';

import { buildAdminApiModule } from './admin-api.js';
import { AdminPasswordVerifier } from './admin-password.js';
import { PostgresAdminStore } from './admin-repository.js';
import { ClamAvScanner } from './clamav.js';
import { PrivateFileStorage } from './file-storage.js';
import { PostgresStage3Store } from './repository.js';
import { buildStage3Api } from './server.js';
import { SecureUploadService } from './upload-service.js';

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
const adminPasswordVerifier = new AdminPasswordVerifier(environment.ADMIN_PASSWORD_SCRYPT_HASH);
const adminStore = new PostgresAdminStore(databaseClient.db, {
  sessionTokenHashKey: adminPasswordVerifier.sessionTokenHashKey,
  sessionTtlSeconds: environment.ADMIN_SESSION_TTL_SECONDS,
});
const fileStorage = new PrivateFileStorage({
  maximumBytes: environment.UPLOAD_MAX_BYTES,
  root: environment.UPLOAD_STORAGE_PATH,
});
const uploads = new SecureUploadService(databaseClient.db, {
  downloadTtlSeconds: environment.UPLOAD_DOWNLOAD_TTL_SECONDS,
  maximumActiveUploadsPerUser: environment.UPLOAD_MAX_ACTIVE_PER_USER,
  maximumBytes: environment.UPLOAD_MAX_BYTES,
  maximumFilesPerUser: environment.UPLOAD_MAX_FILES_PER_USER,
  maximumStagedBytesPerUser: environment.UPLOAD_MAX_STAGED_BYTES_PER_USER,
  maximumTotalBytesPerUser: environment.UPLOAD_MAX_TOTAL_BYTES_PER_USER,
  publicBaseUrl: environment.PUBLIC_BASE_URL,
  scanLeaseSeconds: environment.FILE_SCAN_LEASE_SECONDS,
  scanMaxAttempts: environment.FILE_SCAN_MAX_ATTEMPTS,
  scanRetryBaseMs: environment.FILE_SCAN_RETRY_BASE_MS,
  scanRetryMaximumMs: environment.FILE_SCAN_RETRY_MAX_MS,
  scanner: new ClamAvScanner({
    socketPath: environment.CLAMAV_SOCKET_PATH,
    timeoutMs: environment.CLAMAV_SCAN_TIMEOUT_MS,
  }),
  signingSecret: environment.UPLOAD_SIGNING_SECRET,
  stagingTtlSeconds: environment.UPLOAD_STAGING_TTL_SECONDS,
  storage: fileStorage,
  submissionRetentionDays: environment.SUBMISSION_RETENTION_DAYS,
  uploadLeaseSeconds: environment.UPLOAD_LEASE_SECONDS,
});
const app = await buildStage3Api({
  admin: buildAdminApiModule({
    botToken: environment.MAX_BOT_TOKEN,
    initDataMaxAgeSeconds: environment.MAX_INIT_DATA_MAX_AGE_SECONDS,
    passwordVerifier: adminPasswordVerifier,
    publicBaseUrl: environment.PUBLIC_BASE_URL,
    store: adminStore,
  }),
  store,
  uploads,
  botToken: environment.MAX_BOT_TOKEN,
  maxWebhookSecret: environment.MAX_WEBHOOK_SECRET,
  consentVersion: environment.CONSENT_VERSION,
  initDataMaxAgeSeconds: environment.MAX_INIT_DATA_MAX_AGE_SECONDS,
  ipRateLimitMax: environment.API_IP_RATE_LIMIT_MAX,
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
        'req.headers.x-craft72-upload-token',
        'req.query.signature',
        'req.body',
        'res.headers.set-cookie',
      ],
    },
  },
});

let shuttingDown = false;
let cleanupTimer: NodeJS.Timeout | undefined;
let scanTimer: NodeJS.Timeout | undefined;
let activeScanCycle: Promise<void> | null = null;

const startScanCycle = (): void => {
  if (activeScanCycle !== null || shuttingDown) return;
  activeScanCycle = (async () => {
    while (!shuttingDown && (await uploads.processNextScan())) {
      // Drain ready jobs serially to keep antivirus resource use bounded.
    }
  })()
    .catch((error: unknown) => {
      app.log.error(
        { errorName: error instanceof Error ? error.name : 'UnknownError' },
        'File scan worker cycle failed',
      );
    })
    .finally(() => {
      activeScanCycle = null;
    });
};

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  if (cleanupTimer !== undefined) clearInterval(cleanupTimer);
  if (scanTimer !== undefined) clearInterval(scanTimer);
  app.log.info({ signal }, 'Shutting down API');
  const timeout = setTimeout(() => {
    app.log.error('Graceful shutdown timed out');
    process.exitCode = 1;
  }, environment.SHUTDOWN_GRACE_MS);
  timeout.unref();

  try {
    await app.close();
    await activeScanCycle;
    await databaseClient.close();
  } finally {
    clearTimeout(timeout);
  }
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await uploads.initialize();
  await uploads.cleanupExpired();
  await store.cleanupExpired();
  await adminStore.cleanupExpired();
  await app.listen({ host: environment.API_HOST, port: environment.API_PORT });
  cleanupTimer = setInterval(() => {
    void (async () => {
      await uploads.cleanupExpired();
      await store.cleanupExpired();
      await adminStore.cleanupExpired();
    })().catch((error: unknown) => {
      app.log.error(
        { errorName: error instanceof Error ? error.name : 'UnknownError' },
        'Retention cleanup failed',
      );
    });
  }, environment.RETENTION_CLEANUP_INTERVAL_SECONDS * 1_000);
  cleanupTimer.unref();
  startScanCycle();
  scanTimer = setInterval(startScanCycle, environment.FILE_SCAN_POLL_INTERVAL_MS);
  scanTimer.unref();
} catch (error) {
  app.log.error(
    { errorName: error instanceof Error ? error.name : 'UnknownError' },
    'API startup failed',
  );
  await databaseClient.close();
  process.exitCode = 1;
}
