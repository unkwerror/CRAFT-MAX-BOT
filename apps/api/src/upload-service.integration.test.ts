import { createHash, randomUUID } from 'node:crypto';
import { link, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import type { SubmissionCreateRequest } from '@craft72/contracts';
import { createDatabaseClient } from '@craft72/database';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ClamAvScanner, ClamAvVerdict } from './clamav.js';
import { PrivateFileStorage } from './file-storage.js';
import {
  PostgresStage3Store,
  StoreNotFoundError,
  type AuthenticatedSession,
} from './repository.js';
import {
  SecureUploadService,
  type SecureUploadServiceOptions,
  type UploadServiceError,
} from './upload-service.js';

const databaseUrl = process.env.DATABASE_URL;
const destructiveTestEnabled = process.env.UPLOAD_SERVICE_TEST_ALLOW_DESTRUCTIVE === 'true';
const describeWithDatabase =
  databaseUrl !== undefined && destructiveTestEnabled ? describe : describe.skip;
const MAX_USER_ID = '900000000000000001';
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n');

class StubScanner {
  readonly #outcomes: (ClamAvVerdict | Error)[];

  public constructor(outcomes: readonly (ClamAvVerdict | Error)[] = []) {
    this.#outcomes = [...outcomes];
  }

  public ping(): Promise<void> {
    return Promise.resolve();
  }

  public async scan(_path: string): Promise<ClamAvVerdict> {
    const outcome = this.#outcomes.shift() ?? { kind: 'clean' as const };
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }
}

describeWithDatabase('SecureUploadService integration', () => {
  const connectionString =
    databaseUrl ?? 'postgresql://disabled@127.0.0.1/craft72_upload_service_disabled_test';
  const databaseName = new URL(connectionString).pathname.slice(1);
  if (!databaseName.endsWith('_test')) {
    throw new Error('Upload service integration tests require a database name ending in _test');
  }

  const client = createDatabaseClient({ connectionString, max: 8 });
  let releaseIsolationLock: (() => Promise<void>) | null = null;
  const temporaryDirectories: string[] = [];
  let now = new Date('2026-07-16T06:00:00.000Z');

  beforeAll(async () => {
    const isolationConnection = await client.pool.connect();
    await isolationConnection.query('select pg_advisory_lock(724256)');
    releaseIsolationLock = async () => {
      await isolationConnection.query('select pg_advisory_unlock(724256)');
      isolationConnection.release();
    };
    await migrate(client.db, {
      migrationsFolder: fileURLToPath(
        new URL('../../../packages/database/drizzle', import.meta.url),
      ),
    });
  });

  beforeEach(async () => {
    now = new Date('2026-07-16T06:00:00.000Z');
    await client.pool.query('truncate table max_users cascade');
    await client.pool.query(
      `insert into max_users (max_user_id, first_name, created_at, updated_at)
       values ($1, $2, $3, $3)`,
      [MAX_USER_ID, 'Upload integration', now],
    );
  });

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
    );
  });

  afterAll(async () => {
    if (releaseIsolationLock !== null) {
      await releaseIsolationLock();
    }
    await client.close();
  });

  async function fixture(
    outcomes: readonly (ClamAvVerdict | Error)[] = [],
    overrides: Partial<SecureUploadServiceOptions> = {},
  ): Promise<{
    readonly scanner: StubScanner;
    readonly storage: PrivateFileStorage;
    readonly uploads: SecureUploadService;
  }> {
    const root = await mkdtemp(join(tmpdir(), 'craft72-upload-service-test-'));
    temporaryDirectories.push(root);
    const storage = new PrivateFileStorage({ maximumBytes: 1_048_576, root });
    const scanner = new StubScanner(outcomes);
    const uploads = new SecureUploadService(client.db, {
      downloadTtlSeconds: 600,
      maximumActiveUploadsPerUser: 5,
      maximumBytes: 1_048_576,
      maximumFilesPerUser: 100,
      maximumStagedBytesPerUser: 262_144_000,
      maximumTotalBytesPerUser: 1_073_741_824,
      now: () => now,
      publicBaseUrl: 'https://craft72app.ru',
      scanLeaseSeconds: 180,
      scanMaxAttempts: 3,
      scanRetryBaseMs: 1_000,
      scanRetryMaximumMs: 10_000,
      scanner: scanner as unknown as ClamAvScanner,
      signingSecret: 's'.repeat(64),
      stagingTtlSeconds: 3_600,
      storage,
      submissionRetentionDays: 30,
      uploadLeaseSeconds: 900,
      ...overrides,
    });
    await uploads.initialize();
    return { scanner, storage, uploads };
  }

  async function uploadAndComplete(
    uploads: SecureUploadService,
    content = PDF,
  ): Promise<{ readonly id: string; readonly token: string }> {
    const initialized = await uploads.initializeUpload(MAX_USER_ID, {
      fileName: 'brief.pdf',
      mimeType: 'application/pdf',
      sizeBytes: content.length,
    });
    const token = initialized.headers['X-Craft72-Upload-Token'];
    await uploads.receiveUpload({
      contentLength: content.length,
      contentType: 'application/pdf',
      input: Readable.from([content]),
      token,
      uploadId: initialized.uploadId,
    });
    await uploads.completeUpload(MAX_USER_ID, initialized.uploadId, { sizeBytes: content.length });
    return { id: initialized.uploadId, token };
  }

  function session(): AuthenticatedSession {
    return {
      consentedAt: now,
      consentTextHash: 'c'.repeat(64),
      consentVersion: 'stage6-v1',
      expiresAt: new Date(now.getTime() + 3_600_000),
      maxUserId: MAX_USER_ID,
      phoneVerifiedAt: now,
      sessionId: '42372638-ea36-4264-839d-1c74054761c6',
      startParam: null,
      termsVersion: 'stage6-v1',
      termsAcceptedAt: now,
      termsTextHash: 'd'.repeat(64),
      verifiedPhone: '+79990000001',
    };
  }

  function submissionRequest(documentIds: readonly string[]): SubmissionCreateRequest {
    return {
      idempotencyKey: `upload-integration-${randomUUID()}`,
      payload: {
        role: 'developer',
        fullName: 'Upload Integration',
        organization: 'CRAFT72',
        inn: null,
        objectType: 'office',
        location: { city: 'Тюмень' },
        scope: { kind: 'single_object' },
        area: { status: 'unknown' },
        currentStage: 'concept',
        services: ['design'],
        expertiseRequired: 'unknown',
        culturalHeritageSite: 'no',
        desiredStart: { status: 'unknown' },
        description: 'Интеграционная проверка загрузки',
        links: [],
        documentIds: [...documentIds],
        selectedCaseIds: [],
        contact: { phone: '+79990000001', email: 'upload@example.com' },
        consent: { accepted: true, version: 'stage6-v1' },
      },
    };
  }

  function store(): PostgresStage3Store {
    return new PostgresStage3Store(client.db, {
      draftTtlSeconds: 3_600,
      now: () => now,
      sessionTtlSeconds: 3_600,
      submissionRetentionDays: 30,
    });
  }

  it('serializes concurrent initialization and enforces active-upload quota', async () => {
    const { uploads } = await fixture([], { maximumActiveUploadsPerUser: 1 });
    const request = {
      fileName: 'brief.pdf' as const,
      mimeType: 'application/pdf' as const,
      sizeBytes: PDF.length,
    };
    const results = await Promise.allSettled([
      uploads.initializeUpload(MAX_USER_ID, request),
      uploads.initializeUpload(MAX_USER_ID, request),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(({ status }) => status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: { code: 'conflict' } satisfies Partial<UploadServiceError>,
    });
  });

  it.each([
    { quota: 'file count', overrides: { maximumFilesPerUser: 1 } },
    { quota: 'staged bytes', overrides: { maximumStagedBytesPerUser: PDF.length } },
    { quota: 'total bytes', overrides: { maximumTotalBytesPerUser: PDF.length } },
  ])('accounts for retained documents when enforcing the $quota quota', async ({ overrides }) => {
    const { uploads } = await fixture([], overrides);
    await uploadAndComplete(uploads);
    await expect(
      uploads.initializeUpload(MAX_USER_ID, {
        fileName: 'second.pdf',
        mimeType: 'application/pdf',
        sizeBytes: PDF.length,
      }),
    ).rejects.toMatchObject({ code: 'conflict' } satisfies Partial<UploadServiceError>);
  });

  it('removes partial bytes, rejects the session, and releases active quota', async () => {
    const { storage, uploads } = await fixture([], { maximumActiveUploadsPerUser: 1 });
    const initialized = await uploads.initializeUpload(MAX_USER_ID, {
      fileName: 'brief.pdf',
      mimeType: 'application/pdf',
      sizeBytes: PDF.length,
    });
    await expect(
      uploads.receiveUpload({
        contentLength: null,
        contentType: 'application/pdf',
        input: Readable.from([PDF.subarray(0, 5)]),
        token: initialized.headers['X-Craft72-Upload-Token'],
        uploadId: initialized.uploadId,
      }),
    ).rejects.toMatchObject({ code: 'invalid_file' } satisfies Partial<UploadServiceError>);
    await expect(
      stat(storage.pathFor(storage.quarantineKey(initialized.uploadId))),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    const status = await client.pool.query<{ status: string }>(
      'select status::text from upload_sessions where id = $1',
      [initialized.uploadId],
    );
    expect(status.rows[0]?.status).toBe('rejected');
    await expect(
      uploads.initializeUpload(MAX_USER_ID, {
        fileName: 'retry.pdf',
        mimeType: 'application/pdf',
        sizeBytes: PDF.length,
      }),
    ).resolves.toBeDefined();
  });

  it('never reclaims an uploading session and leaves its partial object untouched', async () => {
    const { storage, uploads } = await fixture();
    const initialized = await uploads.initializeUpload(MAX_USER_ID, {
      fileName: 'brief.pdf',
      mimeType: 'application/pdf',
      sizeBytes: PDF.length,
    });
    const storageKey = storage.quarantineKey(initialized.uploadId);
    const partial = PDF.subarray(0, 8);
    await writeFile(storage.pathFor(storageKey), partial, { mode: 0o600 });
    await client.pool.query(
      `update upload_sessions
       set status = 'uploading', lease_token = $2, lease_expires_at = $3
       where id = $1`,
      [initialized.uploadId, randomUUID(), new Date(now.getTime() - 1_000)],
    );
    await expect(
      uploads.receiveUpload({
        contentLength: PDF.length,
        contentType: 'application/pdf',
        input: Readable.from([PDF]),
        token: initialized.headers['X-Craft72-Upload-Token'],
        uploadId: initialized.uploadId,
      }),
    ).rejects.toMatchObject({ code: 'not_found' } satisfies Partial<UploadServiceError>);
    expect(await readFile(storage.pathFor(storageKey))).toEqual(partial);
  });

  it('marks a clean object in place without promoting the private quarantine key', async () => {
    const { storage, uploads } = await fixture([{ kind: 'clean' }]);
    const uploaded = await uploadAndComplete(uploads);
    await expect(uploads.processNextScan()).resolves.toBe(true);
    const document = await uploads.getDocument(MAX_USER_ID, uploaded.id);
    expect(document).toMatchObject({
      id: uploaded.id,
      scanStatus: 'clean',
      sha256: createHash('sha256').update(PDF).digest('hex'),
    });
    const databaseDocument = await client.pool.query<{ storage_key: string }>(
      'select storage_key from documents where id = $1',
      [uploaded.id],
    );
    expect(databaseDocument.rows[0]?.storage_key).toBe(storage.quarantineKey(uploaded.id));
    await expect(stat(storage.pathFor(storage.documentKey(uploaded.id)))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('fences a stale infected scanner before it can remove a newer clean result', async () => {
    let scanCalls = 0;
    let markFirstScanStarted: () => void = () => undefined;
    let releaseFirstScan: (verdict: ClamAvVerdict) => void = () => undefined;
    const firstScanStarted = new Promise<void>((resolve) => {
      markFirstScanStarted = resolve;
    });
    const firstScanVerdict = new Promise<ClamAvVerdict>((resolve) => {
      releaseFirstScan = resolve;
    });
    const scanner = {
      ping: () => Promise.resolve(),
      async scan() {
        scanCalls += 1;
        if (scanCalls === 1) {
          markFirstScanStarted();
          return firstScanVerdict;
        }
        return { kind: 'clean' };
      },
    } as unknown as ClamAvScanner;
    const { storage, uploads } = await fixture([], { scanLeaseSeconds: 1, scanner });
    const uploaded = await uploadAndComplete(uploads);

    const staleWork = uploads.processNextScan();
    await firstScanStarted;
    now = new Date(now.getTime() + 1_001);
    await expect(uploads.processNextScan()).resolves.toBe(true);
    releaseFirstScan({ kind: 'infected', signature: 'stale-verdict' });
    await expect(staleWork).rejects.toThrow('Document scan lease was lost');

    await expect(uploads.getDocument(MAX_USER_ID, uploaded.id)).resolves.toMatchObject({
      scanStatus: 'clean',
    });
    expect(await readFile(storage.pathFor(storage.quarantineKey(uploaded.id)))).toEqual(PDF);
  });

  it.each([
    { name: 'infected', outcome: { kind: 'infected', signature: 'Eicar-Test' } as const },
    { name: 'failed', outcome: new Error('scanner unavailable') },
  ])(
    'keeps $name terminal metadata visible and permits same-content reupload',
    async ({ name, outcome }) => {
      const { storage, uploads } = await fixture([outcome], {
        scanMaxAttempts: 1,
      });
      const uploaded = await uploadAndComplete(uploads);
      await expect(uploads.processNextScan()).resolves.toBe(true);
      await expect(uploads.getDocument(MAX_USER_ID, uploaded.id)).resolves.toMatchObject({
        scanStatus: name,
      });
      await expect(uploads.createDownloadLink(MAX_USER_ID, uploaded.id)).rejects.toMatchObject({
        code: 'not_clean',
      } satisfies Partial<UploadServiceError>);
      await expect(
        store().createSubmission(session(), submissionRequest([uploaded.id])),
      ).rejects.toBeInstanceOf(StoreNotFoundError);
      await expect(stat(storage.pathFor(storage.quarantineKey(uploaded.id)))).rejects.toMatchObject(
        {
          code: 'ENOENT',
        },
      );
      await expect(uploadAndComplete(uploads)).resolves.toBeDefined();
    },
  );

  it('removes both legacy storage links after an infected verdict', async () => {
    const { storage, uploads } = await fixture([{ kind: 'infected', signature: 'Eicar-Test' }]);
    const uploaded = await uploadAndComplete(uploads);
    const quarantinePath = storage.pathFor(storage.quarantineKey(uploaded.id));
    const legacyDocumentPath = storage.pathFor(storage.documentKey(uploaded.id));
    await link(quarantinePath, legacyDocumentPath);

    await expect(uploads.processNextScan()).resolves.toBe(true);
    await expect(stat(quarantinePath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(legacyDocumentPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('enforces hard staging expiry for polling, grants, attachment, and cleanup', async () => {
    const { storage, uploads } = await fixture([{ kind: 'clean' }], {
      stagingTtlSeconds: 60,
    });
    const uploaded = await uploadAndComplete(uploads);
    await uploads.processNextScan();
    const link = await uploads.createDownloadLink(MAX_USER_ID, uploaded.id);
    const downloadUrl = new URL(link.downloadUrl);
    now = new Date(now.getTime() + 60_001);
    await expect(uploads.getDocument(MAX_USER_ID, uploaded.id)).rejects.toMatchObject({
      code: 'not_found',
    } satisfies Partial<UploadServiceError>);
    await expect(uploads.createDownloadLink(MAX_USER_ID, uploaded.id)).rejects.toMatchObject({
      code: 'not_clean',
    } satisfies Partial<UploadServiceError>);
    await expect(
      uploads.resolveDownload(uploaded.id, {
        grant: downloadUrl.searchParams.get('grant') ?? '',
        expires: Number(downloadUrl.searchParams.get('expires')),
        signature: downloadUrl.searchParams.get('signature') ?? '',
      }),
    ).rejects.toMatchObject({ code: 'not_found' } satisfies Partial<UploadServiceError>);
    await expect(
      store().createSubmission(session(), submissionRequest([uploaded.id])),
    ).rejects.toBeInstanceOf(StoreNotFoundError);
    await uploads.cleanupExpired();
    const counts = await client.pool.query<{ documents: string; uploads: string }>(
      `select (select count(*) from documents)::text as documents,
              (select count(*) from upload_sessions)::text as uploads`,
    );
    expect(counts.rows[0]).toEqual({ documents: '0', uploads: '0' });
    await expect(stat(storage.pathFor(storage.quarantineKey(uploaded.id)))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('retains an expired submission while Tracker outbox is active', async () => {
    const { storage, uploads } = await fixture([{ kind: 'clean' }]);
    const uploaded = await uploadAndComplete(uploads);
    await uploads.processNextScan();
    const submission = await store().createSubmission(session(), submissionRequest([uploaded.id]));
    const expiredAt = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1_000);
    await client.pool.query('update submissions set created_at = $1 where submission_id = $2', [
      expiredAt,
      submission.submissionId,
    ]);
    await uploads.cleanupExpired();
    const retained = await client.pool.query<{ count: string }>(
      'select count(*)::text as count from submissions where submission_id = $1',
      [submission.submissionId],
    );
    expect(retained.rows[0]?.count).toBe('1');
    expect(await readFile(storage.pathFor(storage.quarantineKey(uploaded.id)))).toEqual(PDF);

    await client.pool.query(
      `update integration_outbox
       set status = 'completed', result_key = 'TEST-1', completed_at = $1,
           lease_token = null, lease_expires_at = null
       where submission_id = (select id from submissions where submission_id = $2)`,
      [now, submission.submissionId],
    );
    await uploads.cleanupExpired();
    const removed = await client.pool.query<{ documents: string; submissions: string }>(
      `select (select count(*) from submissions)::text as submissions,
              (select count(*) from documents)::text as documents`,
    );
    expect(removed.rows[0]).toEqual({ documents: '0', submissions: '0' });
    await expect(stat(storage.pathFor(storage.quarantineKey(uploaded.id)))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('waits for concurrent Tracker backfill before tombstoning submission documents', async () => {
    const { storage, uploads } = await fixture([{ kind: 'clean' }]);
    const uploaded = await uploadAndComplete(uploads);
    await uploads.processNextScan();
    const submission = await store().createSubmission(session(), submissionRequest([uploaded.id]));
    const expiredAt = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1_000);
    const submissionRow = await client.pool.query<{ id: string }>(
      `update submissions
       set created_at = $1
       where submission_id = $2
       returning id`,
      [expiredAt, submission.submissionId],
    );
    const submissionDatabaseId = submissionRow.rows[0]?.id;
    if (submissionDatabaseId === undefined) throw new Error('Submission fixture is unavailable');
    await client.pool.query(
      `update integration_outbox
       set status = 'completed', result_key = 'TEST-1', completed_at = $1,
           lease_token = null, lease_expires_at = null
       where submission_id = $2`,
      [now, submissionDatabaseId],
    );
    await client.pool.query(
      `delete from integration_outbox
       where submission_id = $1 and operation = 'create_docs'`,
      [submissionDatabaseId],
    );

    const backfillConnection = await client.pool.connect();
    let backfillTransactionOpen = false;
    let cleanup: Promise<void> | null = null;
    try {
      await backfillConnection.query('begin');
      backfillTransactionOpen = true;
      await backfillConnection.query(
        `insert into integration_outbox (
           submission_id, operation, depends_on_operation, idempotency_key, payload,
           status, attempts, next_attempt_at, created_at, updated_at
         ) values ($1, 'create_docs', 'create_crm', $2, '{"schemaVersion":1}'::jsonb,
                   'pending', 0, $3, $3, $3)`,
        [submissionDatabaseId, `tracker:${submission.submissionId}:docs:race`, now],
      );

      cleanup = uploads.cleanupExpired();
      let retentionIsWaiting = false;
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const locks = await client.pool.query<{ waiting: boolean }>(
          `select exists (
             select 1
             from pg_locks as current_lock
             inner join pg_class as locked_relation
               on locked_relation.oid = current_lock.relation
             where locked_relation.relname = 'integration_outbox'
               and current_lock.mode = 'ShareLock'
               and not current_lock.granted
           ) as waiting`,
        );
        if (locks.rows[0]?.waiting === true) {
          retentionIsWaiting = true;
          break;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
      expect(retentionIsWaiting).toBe(true);

      await backfillConnection.query('commit');
      backfillTransactionOpen = false;
      await cleanup;
      cleanup = null;
    } finally {
      if (backfillTransactionOpen) await backfillConnection.query('rollback');
      backfillConnection.release();
      if (cleanup !== null) await cleanup.catch(() => undefined);
    }

    const retained = await client.pool.query<{
      deleted_at: Date | null;
      outbox_status: string;
      submission_status: string;
    }>(
      `select source_submission.status::text as submission_status,
              source_document.deleted_at,
              tracker_operation.status::text as outbox_status
       from submissions as source_submission
       inner join documents as source_document
         on source_document.submission_id = source_submission.id
       inner join integration_outbox as tracker_operation
         on tracker_operation.submission_id = source_submission.id
        and tracker_operation.operation = 'create_docs'
       where source_submission.id = $1`,
      [submissionDatabaseId],
    );
    expect(retained.rows[0]).toMatchObject({
      deleted_at: null,
      outbox_status: 'pending',
    });
    expect(retained.rows[0]?.submission_status).not.toBe('cancelled');
    expect(await readFile(storage.pathFor(storage.quarantineKey(uploaded.id)))).toEqual(PDF);
  });
});
