import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Readable } from 'node:stream';

import {
  DocumentDownloadLinkResponseSchema,
  DocumentSchema,
  UploadCompleteResponseSchema,
  UploadInitResponseSchema,
  type Document,
  type DocumentDownloadLinkResponse,
  type DocumentDownloadQuery,
  type UploadCompleteRequest,
  type UploadInitRequest,
} from '@craft72/contracts';
import {
  documentAccessGrants,
  documents,
  documentScanJobs,
  integrationOutbox,
  submissions,
  uploadSessions,
  type Database,
} from '@craft72/database';
import { and, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';

import { ClamAvError, type ClamAvScanner, type ClamAvVerdict } from './clamav.js';
import { FileStorageError, type PrivateFileStorage } from './file-storage.js';
import { FileValidationError, validateStoredFile } from './file-validation.js';

const UPLOAD_CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CLEANUP_BATCH_SIZE = 250;

export type UploadServiceErrorCode =
  'conflict' | 'expired' | 'invalid_file' | 'not_clean' | 'not_found' | 'unavailable';

export class UploadServiceError extends Error {
  public readonly code: UploadServiceErrorCode;

  public constructor(code: UploadServiceErrorCode) {
    super(`Secure upload ${code}`);
    this.name = 'UploadServiceError';
    this.code = code;
  }
}

export interface SecureUploadServiceOptions {
  readonly downloadTtlSeconds: number;
  readonly maximumActiveUploadsPerUser: number;
  readonly maximumBytes: number;
  readonly maximumFilesPerUser: number;
  readonly maximumStagedBytesPerUser: number;
  readonly maximumTotalBytesPerUser: number;
  readonly now?: () => Date;
  readonly publicBaseUrl: string;
  readonly scanLeaseSeconds: number;
  readonly scanMaxAttempts: number;
  readonly scanRetryBaseMs: number;
  readonly scanRetryMaximumMs: number;
  readonly scanner: ClamAvScanner;
  readonly signingSecret: string;
  readonly stagingTtlSeconds: number;
  readonly storage: PrivateFileStorage;
  readonly submissionRetentionDays: number;
  readonly uploadLeaseSeconds: number;
}

export interface UploadReceiveInput {
  readonly contentLength: number | null;
  readonly contentType: string | null;
  readonly input: Readable;
  readonly token: string;
  readonly uploadId: string;
}

export interface DownloadFile {
  readonly mimeType: string;
  readonly originalName: string;
  readonly sizeBytes: number;
  readonly storageKey: string;
}

interface ClaimedUpload {
  readonly declaredMimeType: string;
  readonly expectedSizeBytes: number;
  readonly leaseToken: string;
  readonly originalName: string;
  readonly quarantineStorageKey: string;
  readonly uploadId: string;
}

interface ClaimedScan {
  readonly attempts: number;
  readonly documentId: string;
  readonly leaseToken: string;
  readonly storageKey: string;
}

interface CleanupFileTarget {
  readonly id: string;
  readonly storageKey: string;
}

interface CleanupSubmissionTarget {
  readonly documents: readonly CleanupFileTarget[];
  readonly id: string;
}

function validNow(clock: () => Date): Date {
  const now = clock();
  if (Number.isNaN(now.getTime())) throw new RangeError('Upload service clock is invalid');
  return now;
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function firstRow(result: unknown): Record<string, unknown> | null {
  return resultRows(result)[0] ?? null;
}

function resultRows(result: unknown): readonly Record<string, unknown>[] {
  if (typeof result !== 'object' || result === null || !('rows' in result)) return [];
  const rows = (result as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) return [];
  return rows.filter(
    (row): row is Record<string, unknown> =>
      typeof row === 'object' && row !== null && !Array.isArray(row),
  );
}

function requiredString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`PostgreSQL returned an invalid ${key}`);
  }
  return value;
}

function positiveInteger(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new TypeError(`PostgreSQL returned an invalid ${key}`);
  }
  return parsed;
}

function nonnegativeInteger(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError(`PostgreSQL returned an invalid ${key}`);
  }
  return parsed;
}

function cleanupFileTarget(row: Record<string, unknown>): CleanupFileTarget {
  return {
    id: requiredString(row, 'id'),
    storageKey: requiredString(row, 'storageKey'),
  };
}

function affectedRows(result: unknown): number {
  if (typeof result !== 'object' || result === null || !('rowCount' in result)) return 0;
  const rowCount = (result as { rowCount?: unknown }).rowCount;
  return typeof rowCount === 'number' ? rowCount : 0;
}

function documentFromRow(row: typeof documents.$inferSelect): Document {
  return DocumentSchema.parse({
    id: row.id,
    originalName: row.originalName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    scanStatus: row.scanStatus,
    createdAt: row.createdAt.toISOString(),
  });
}

function safeContentType(value: string | null): string | null {
  if (value === null) return null;
  return value.split(';', 1)[0]?.trim().toLowerCase() ?? null;
}

function constantTimeHexEqual(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function scanRetryAt(now: Date, attempts: number, baseMs: number, maximumMs: number): Date {
  const delay = Math.min(maximumMs, baseMs * 2 ** Math.max(0, attempts - 1));
  return new Date(now.getTime() + delay);
}

function safeErrorCode(error: unknown): string {
  if (error instanceof ClamAvError) return `clamav_${error.code}`;
  if (error instanceof FileStorageError) return `storage_${error.code}`;
  return 'scan_failed';
}

export class SecureUploadService {
  readonly #database: Database;
  readonly #downloadTtlSeconds: number;
  readonly #maximumActiveUploadsPerUser: number;
  readonly #maximumBytes: number;
  readonly #maximumFilesPerUser: number;
  readonly #maximumStagedBytesPerUser: number;
  readonly #maximumTotalBytesPerUser: number;
  readonly #now: () => Date;
  readonly #publicBaseUrl: string;
  readonly #scanLeaseSeconds: number;
  readonly #scanMaxAttempts: number;
  readonly #scanRetryBaseMs: number;
  readonly #scanRetryMaximumMs: number;
  readonly #scanner: ClamAvScanner;
  readonly #signingSecret: string;
  readonly #stagingTtlSeconds: number;
  readonly #storage: PrivateFileStorage;
  readonly #submissionRetentionDays: number;
  readonly #uploadLeaseSeconds: number;

  public constructor(database: Database, options: SecureUploadServiceOptions) {
    this.#database = database;
    this.#downloadTtlSeconds = options.downloadTtlSeconds;
    this.#maximumActiveUploadsPerUser = options.maximumActiveUploadsPerUser;
    this.#maximumBytes = options.maximumBytes;
    this.#maximumFilesPerUser = options.maximumFilesPerUser;
    this.#maximumStagedBytesPerUser = options.maximumStagedBytesPerUser;
    this.#maximumTotalBytesPerUser = options.maximumTotalBytesPerUser;
    this.#now = options.now ?? (() => new Date());
    this.#publicBaseUrl = options.publicBaseUrl;
    this.#scanLeaseSeconds = options.scanLeaseSeconds;
    this.#scanMaxAttempts = options.scanMaxAttempts;
    this.#scanRetryBaseMs = options.scanRetryBaseMs;
    this.#scanRetryMaximumMs = options.scanRetryMaximumMs;
    this.#scanner = options.scanner;
    this.#signingSecret = options.signingSecret;
    this.#stagingTtlSeconds = options.stagingTtlSeconds;
    this.#storage = options.storage;
    this.#submissionRetentionDays = options.submissionRetentionDays;
    this.#uploadLeaseSeconds = options.uploadLeaseSeconds;

    for (const value of [
      this.#downloadTtlSeconds,
      this.#maximumActiveUploadsPerUser,
      this.#maximumBytes,
      this.#maximumFilesPerUser,
      this.#maximumStagedBytesPerUser,
      this.#maximumTotalBytesPerUser,
      this.#scanLeaseSeconds,
      this.#scanMaxAttempts,
      this.#scanRetryBaseMs,
      this.#scanRetryMaximumMs,
      this.#stagingTtlSeconds,
      this.#submissionRetentionDays,
      this.#uploadLeaseSeconds,
    ]) {
      if (!Number.isSafeInteger(value) || value < 1) {
        throw new RangeError('Secure upload numeric option is invalid');
      }
    }
    if (this.#signingSecret.length < 32) throw new RangeError('Upload signing secret is too short');
  }

  public async initialize(): Promise<void> {
    await this.#storage.initialize();
  }

  public async isReady(): Promise<void> {
    await this.#scanner.ping();
  }

  public async initializeUpload(
    maxUserId: string,
    request: UploadInitRequest,
  ): Promise<ReturnType<typeof UploadInitResponseSchema.parse>> {
    if (request.sizeBytes > this.#maximumBytes) {
      throw new UploadServiceError('invalid_file');
    }
    const now = validNow(this.#now);
    const uploadId = randomUUID();
    const capability = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + this.#stagingTtlSeconds * 1_000);
    const quarantineStorageKey = this.#storage.quarantineKey(uploadId);
    const ownerId = BigInt(maxUserId);
    await this.#database.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(${ownerId})`);
      const usageResult = await transaction.execute(sql`
        select
          (
            select count(*)
            from ${uploadSessions} as active_upload
            where active_upload.max_user_id = ${ownerId}
              and active_upload.expires_at > ${now}
              and active_upload.status in ('initialized', 'uploading', 'uploaded')
          ) as "activeUploads",
          (
            select coalesce(sum(active_upload.expected_size_bytes), 0)
            from ${uploadSessions} as active_upload
            where active_upload.max_user_id = ${ownerId}
              and active_upload.expires_at > ${now}
              and active_upload.status in ('initialized', 'uploading', 'uploaded')
          ) as "activeUploadBytes",
          (
            select count(*)
            from ${documents} as retained_document
            where retained_document.max_user_id = ${ownerId}
              and retained_document.deleted_at is null
              and (
                retained_document.submission_id is not null
                or retained_document.staged_expires_at > ${now}
              )
          ) as "documentCount",
          (
            select coalesce(sum(retained_document.size_bytes), 0)
            from ${documents} as retained_document
            where retained_document.max_user_id = ${ownerId}
              and retained_document.deleted_at is null
              and (
                retained_document.submission_id is not null
                or retained_document.staged_expires_at > ${now}
              )
          ) as "documentBytes",
          (
            select coalesce(sum(staged_document.size_bytes), 0)
            from ${documents} as staged_document
            where staged_document.max_user_id = ${ownerId}
              and staged_document.submission_id is null
              and staged_document.deleted_at is null
              and staged_document.staged_expires_at > ${now}
          ) as "stagedDocumentBytes"
      `);
      const usage = firstRow(usageResult);
      if (usage === null) throw new Error('PostgreSQL did not return upload quota usage');
      const activeUploads = nonnegativeInteger(usage, 'activeUploads');
      const activeUploadBytes = nonnegativeInteger(usage, 'activeUploadBytes');
      const documentCount = nonnegativeInteger(usage, 'documentCount');
      const documentBytes = nonnegativeInteger(usage, 'documentBytes');
      const stagedDocumentBytes = nonnegativeInteger(usage, 'stagedDocumentBytes');
      if (
        activeUploads >= this.#maximumActiveUploadsPerUser ||
        activeUploads + documentCount >= this.#maximumFilesPerUser ||
        activeUploadBytes + stagedDocumentBytes + request.sizeBytes >
          this.#maximumStagedBytesPerUser ||
        activeUploadBytes + documentBytes + request.sizeBytes > this.#maximumTotalBytesPerUser
      ) {
        throw new UploadServiceError('conflict');
      }

      await transaction.insert(uploadSessions).values({
        id: uploadId,
        maxUserId: ownerId,
        capabilityHash: tokenHash(capability),
        originalName: request.fileName,
        declaredMimeType: request.mimeType,
        expectedSizeBytes: request.sizeBytes,
        quarantineStorageKey,
        status: 'initialized',
        attempts: 0,
        createdAt: now,
        updatedAt: now,
        expiresAt,
      });
    });

    return UploadInitResponseSchema.parse({
      uploadId,
      uploadUrl: new URL(`/api/uploads/${uploadId}/content`, this.#publicBaseUrl).toString(),
      method: 'PUT',
      headers: {
        'Content-Type': request.mimeType,
        'X-Craft72-Upload-Token': capability,
      },
      expiresAt: expiresAt.toISOString(),
      maxBytes: this.#maximumBytes,
    });
  }

  async #claimUpload(input: UploadReceiveInput, now: Date): Promise<ClaimedUpload> {
    if (!UPLOAD_CAPABILITY_PATTERN.test(input.token)) throw new UploadServiceError('not_found');
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + this.#uploadLeaseSeconds * 1_000);
    const result = await this.#database.execute(sql`
      with candidate as (
        select current_upload.id
        from ${uploadSessions} as current_upload
        where current_upload.id = ${input.uploadId}::uuid
          and current_upload.capability_hash = ${tokenHash(input.token)}
          and current_upload.expires_at > ${now}
          and current_upload.status = 'initialized'
        for update skip locked
        limit 1
      )
      update ${uploadSessions} as claimed
      set status = 'uploading',
          attempts = claimed.attempts + 1,
          lease_token = ${leaseToken}::uuid,
          lease_expires_at = ${leaseExpiresAt},
          last_error_code = null,
          updated_at = ${now}
      from candidate
      where claimed.id = candidate.id
      returning claimed.id as "uploadId",
                claimed.original_name as "originalName",
                claimed.declared_mime_type as "declaredMimeType",
                claimed.expected_size_bytes as "expectedSizeBytes",
                claimed.quarantine_storage_key as "quarantineStorageKey"
    `);
    const row = firstRow(result);
    if (row === null) throw new UploadServiceError('not_found');
    return {
      uploadId: requiredString(row, 'uploadId'),
      originalName: requiredString(row, 'originalName'),
      declaredMimeType: requiredString(row, 'declaredMimeType'),
      expectedSizeBytes: positiveInteger(row, 'expectedSizeBytes'),
      quarantineStorageKey: requiredString(row, 'quarantineStorageKey'),
      leaseToken,
    };
  }

  public async receiveUpload(input: UploadReceiveInput): Promise<void> {
    const now = validNow(this.#now);
    const claim = await this.#claimUpload(input, now);
    try {
      if (
        input.contentLength !== null &&
        (!Number.isSafeInteger(input.contentLength) ||
          input.contentLength !== claim.expectedSizeBytes)
      ) {
        throw new UploadServiceError('invalid_file');
      }
      if (safeContentType(input.contentType) !== claim.declaredMimeType) {
        throw new UploadServiceError('invalid_file');
      }
      const stored = await this.#storage.receive(
        claim.quarantineStorageKey,
        input.input,
        claim.expectedSizeBytes,
      );
      const detected = await validateStoredFile(
        this.#storage.pathFor(claim.quarantineStorageKey),
        claim.originalName as UploadInitRequest['fileName'],
        claim.declaredMimeType as UploadInitRequest['mimeType'],
      );
      const uploadedAt = validNow(this.#now);
      const updated = await this.#database
        .update(uploadSessions)
        .set({
          status: 'uploaded',
          receivedSizeBytes: stored.sizeBytes,
          receivedSha256: stored.sha256,
          detectedMimeType: detected.detectedMimeType,
          detectedFileType: detected.detectedFileType,
          uploadedAt,
          updatedAt: uploadedAt,
          leaseToken: null,
          leaseExpiresAt: null,
          lastErrorCode: null,
        })
        .where(
          and(
            eq(uploadSessions.id, claim.uploadId),
            eq(uploadSessions.status, 'uploading'),
            eq(uploadSessions.leaseToken, claim.leaseToken),
          ),
        );
      if (affectedRows(updated) !== 1) throw new UploadServiceError('conflict');
    } catch (error) {
      await this.#storage.remove(claim.quarantineStorageKey).catch(() => undefined);
      const failedAt = validNow(this.#now);
      await this.#database
        .update(uploadSessions)
        .set({
          status: 'rejected',
          leaseToken: null,
          leaseExpiresAt: null,
          lastErrorCode:
            error instanceof FileValidationError
              ? error.code
              : error instanceof FileStorageError
                ? error.code
                : error instanceof UploadServiceError
                  ? error.code
                  : 'receive_failed',
          updatedAt: failedAt,
        })
        .where(
          and(
            eq(uploadSessions.id, claim.uploadId),
            eq(uploadSessions.status, 'uploading'),
            eq(uploadSessions.leaseToken, claim.leaseToken),
          ),
        );
      if (
        error instanceof FileValidationError ||
        error instanceof FileStorageError ||
        error instanceof UploadServiceError
      ) {
        throw new UploadServiceError(
          error instanceof UploadServiceError && error.code === 'conflict'
            ? 'conflict'
            : 'invalid_file',
        );
      }
      throw new UploadServiceError('unavailable');
    }
  }

  public async completeUpload(
    maxUserId: string,
    uploadId: string,
    request: UploadCompleteRequest,
  ): Promise<ReturnType<typeof UploadCompleteResponseSchema.parse>> {
    const now = validNow(this.#now);
    let document: Document;
    try {
      document = await this.#database.transaction(async (transaction) => {
        await transaction.execute(sql`
          select id from ${uploadSessions}
          where id = ${uploadId}::uuid and max_user_id = ${BigInt(maxUserId)}
          for update
        `);
        const rows = await transaction
          .select()
          .from(uploadSessions)
          .where(
            and(eq(uploadSessions.id, uploadId), eq(uploadSessions.maxUserId, BigInt(maxUserId))),
          )
          .limit(1);
        const upload = rows[0];
        if (upload === undefined) throw new UploadServiceError('not_found');
        if (upload.status === 'completed' && upload.documentId !== null) {
          const existing = await transaction
            .select()
            .from(documents)
            .where(
              and(eq(documents.id, upload.documentId), eq(documents.maxUserId, BigInt(maxUserId))),
            )
            .limit(1);
          if (existing[0] === undefined) throw new UploadServiceError('not_found');
          return documentFromRow(existing[0]);
        }
        if (upload.expiresAt <= now) throw new UploadServiceError('expired');
        if (
          upload.status !== 'uploaded' ||
          upload.receivedSizeBytes !== request.sizeBytes ||
          upload.receivedSha256 === null ||
          upload.detectedMimeType === null ||
          upload.detectedFileType === null ||
          upload.uploadedAt === null
        ) {
          throw new UploadServiceError('conflict');
        }

        const inserted = await transaction
          .insert(documents)
          .values({
            id: uploadId,
            maxUserId: BigInt(maxUserId),
            originalName: upload.originalName,
            storageKey: upload.quarantineStorageKey,
            mimeType: upload.declaredMimeType,
            sizeBytes: upload.receivedSizeBytes,
            sha256: upload.receivedSha256,
            detectedMimeType: upload.detectedMimeType,
            detectedFileType: upload.detectedFileType,
            scanStatus: 'pending',
            createdAt: upload.uploadedAt,
            uploadedAt: upload.uploadedAt,
            stagedExpiresAt: upload.expiresAt,
          })
          .returning();
        const row = inserted[0];
        if (row === undefined) throw new Error('PostgreSQL did not return the uploaded document');
        await transaction.insert(documentScanJobs).values({
          documentId: row.id,
          status: 'pending',
          attempts: 0,
          nextAttemptAt: now,
          createdAt: now,
          updatedAt: now,
        });
        await transaction
          .update(uploadSessions)
          .set({ status: 'completed', documentId: row.id, completedAt: now, updatedAt: now })
          .where(and(eq(uploadSessions.id, upload.id), eq(uploadSessions.status, 'uploaded')));
        return documentFromRow(row);
      });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23505'
      ) {
        throw new UploadServiceError('conflict');
      }
      throw error;
    }
    return UploadCompleteResponseSchema.parse({ document });
  }

  public async getDocument(maxUserId: string, documentId: string): Promise<Document> {
    const now = validNow(this.#now);
    const rows = await this.#database
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.maxUserId, BigInt(maxUserId)),
          or(isNotNull(documents.submissionId), gt(documents.stagedExpiresAt, now)),
          or(
            isNull(documents.deletedAt),
            eq(documents.scanStatus, 'infected'),
            eq(documents.scanStatus, 'failed'),
          ),
        ),
      )
      .limit(1);
    if (rows[0] === undefined) throw new UploadServiceError('not_found');
    return documentFromRow(rows[0]);
  }

  #downloadSignature(grantId: string, documentId: string, expires: number): string {
    return createHmac('sha256', this.#signingSecret)
      .update(`${grantId}\0${documentId}\0${String(expires)}`)
      .digest('hex');
  }

  public async createDownloadLink(
    maxUserId: string,
    documentId: string,
  ): Promise<DocumentDownloadLinkResponse> {
    const now = validNow(this.#now);
    const grantId = randomUUID();
    const expiresAt = new Date(now.getTime() + this.#downloadTtlSeconds * 1_000);
    const expires = Math.floor(expiresAt.getTime() / 1_000);
    const signature = this.#downloadSignature(grantId, documentId, expires);
    await this.#database.transaction(async (transaction) => {
      const rows = await transaction
        .select({ id: documents.id })
        .from(documents)
        .where(
          and(
            eq(documents.id, documentId),
            eq(documents.maxUserId, BigInt(maxUserId)),
            eq(documents.scanStatus, 'clean'),
            isNull(documents.deletedAt),
            or(isNotNull(documents.submissionId), gt(documents.stagedExpiresAt, now)),
          ),
        )
        .limit(1)
        .for('update');
      if (rows[0] === undefined) throw new UploadServiceError('not_clean');
      await transaction.insert(documentAccessGrants).values({
        id: grantId,
        documentId,
        tokenHash: tokenHash(signature),
        audience: 'max_user',
        createdAt: now,
        expiresAt,
      });
    });
    const url = new URL(`/files/${documentId}`, this.#publicBaseUrl);
    url.searchParams.set('grant', grantId);
    url.searchParams.set('expires', String(expires));
    url.searchParams.set('signature', signature);
    return DocumentDownloadLinkResponseSchema.parse({
      downloadUrl: url.toString(),
      expiresAt: expiresAt.toISOString(),
    });
  }

  public async resolveDownload(
    documentId: string,
    query: DocumentDownloadQuery,
  ): Promise<DownloadFile> {
    const now = validNow(this.#now);
    if (query.expires <= Math.floor(now.getTime() / 1_000)) {
      throw new UploadServiceError('expired');
    }
    const expectedSignature = this.#downloadSignature(query.grant, documentId, query.expires);
    if (!constantTimeHexEqual(query.signature, expectedSignature)) {
      throw new UploadServiceError('not_found');
    }
    const rows = await this.#database
      .select({
        grantTokenHash: documentAccessGrants.tokenHash,
        grantExpiresAt: documentAccessGrants.expiresAt,
        mimeType: documents.mimeType,
        originalName: documents.originalName,
        sizeBytes: documents.sizeBytes,
        storageKey: documents.storageKey,
      })
      .from(documentAccessGrants)
      .innerJoin(documents, eq(documents.id, documentAccessGrants.documentId))
      .where(
        and(
          eq(documentAccessGrants.id, query.grant),
          eq(documentAccessGrants.documentId, documentId),
          isNull(documentAccessGrants.revokedAt),
          eq(documents.scanStatus, 'clean'),
          isNull(documents.deletedAt),
          or(isNotNull(documents.submissionId), gt(documents.stagedExpiresAt, now)),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (
      row === undefined ||
      row.grantExpiresAt <= now ||
      Math.floor(row.grantExpiresAt.getTime() / 1_000) !== query.expires ||
      !constantTimeHexEqual(row.grantTokenHash, tokenHash(query.signature))
    ) {
      throw new UploadServiceError('not_found');
    }
    const accessed = await this.#database
      .update(documentAccessGrants)
      .set({
        accessCount: sql`${documentAccessGrants.accessCount} + 1`,
        lastAccessedAt: now,
      })
      .where(
        and(
          eq(documentAccessGrants.id, query.grant),
          isNull(documentAccessGrants.revokedAt),
          gt(documentAccessGrants.expiresAt, now),
        ),
      );
    if (affectedRows(accessed) !== 1) throw new UploadServiceError('not_found');
    return {
      mimeType: row.mimeType,
      originalName: row.originalName,
      sizeBytes: row.sizeBytes,
      storageKey: row.storageKey,
    };
  }

  public open(storageKey: string): Readable {
    return this.#storage.open(storageKey);
  }

  async #claimScan(now: Date): Promise<ClaimedScan | null> {
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + this.#scanLeaseSeconds * 1_000);
    return this.#database.transaction(async (transaction) => {
      const result = await transaction.execute(sql`
        with candidate as (
          select current_job.id
          from ${documentScanJobs} as current_job
          inner join ${documents} as current_document
            on current_document.id = current_job.document_id
          where (
            (current_job.status in ('pending', 'retry') and current_job.next_attempt_at <= ${now})
            or (current_job.status = 'processing' and current_job.lease_expires_at <= ${now})
          )
            and current_document.deleted_at is null
            and (
              current_document.submission_id is not null
              or current_document.staged_expires_at > ${now}
            )
          order by current_job.created_at, current_job.id
          for update of current_job skip locked
          limit 1
        )
        update ${documentScanJobs} as claimed
        set status = 'processing',
            attempts = claimed.attempts + 1,
            lease_token = ${leaseToken}::uuid,
            lease_expires_at = ${leaseExpiresAt},
            last_error_code = null,
            updated_at = ${now},
            finished_at = null
        from candidate
        where claimed.id = candidate.id
        returning claimed.document_id as "documentId", claimed.attempts as "attempts"
      `);
      const row = firstRow(result);
      if (row === null) return null;
      const documentId = requiredString(row, 'documentId');
      const documentRows = await transaction
        .update(documents)
        .set({ scanStatus: 'scanning' })
        .where(
          and(
            eq(documents.id, documentId),
            or(eq(documents.scanStatus, 'pending'), eq(documents.scanStatus, 'scanning')),
            isNull(documents.deletedAt),
            or(isNotNull(documents.submissionId), gt(documents.stagedExpiresAt, now)),
          ),
        )
        .returning({ storageKey: documents.storageKey });
      if (documentRows[0] === undefined) throw new Error('Document scan target is unavailable');
      return {
        attempts: positiveInteger(row, 'attempts'),
        documentId,
        leaseToken,
        storageKey: documentRows[0].storageKey,
      };
    });
  }

  public async processNextScan(): Promise<boolean> {
    const claim = await this.#claimScan(validNow(this.#now));
    if (claim === null) return false;
    const documentKey = this.#storage.documentKey(claim.documentId);
    let scanKey: string | null = null;
    let verdict: ClamAvVerdict;
    try {
      scanKey = await this.#storage.existingKey(claim.storageKey, documentKey);
      verdict = await this.#scanner.scan(this.#storage.pathFor(scanKey));
    } catch (error) {
      const failedAt = validNow(this.#now);
      const retrying = claim.attempts < this.#scanMaxAttempts;
      await this.#database.transaction(async (transaction) => {
        const failed = await transaction
          .update(documentScanJobs)
          .set({
            status: retrying ? 'retry' : 'dead_letter',
            nextAttemptAt: retrying
              ? scanRetryAt(
                  failedAt,
                  claim.attempts,
                  this.#scanRetryBaseMs,
                  this.#scanRetryMaximumMs,
                )
              : failedAt,
            leaseToken: null,
            leaseExpiresAt: null,
            lastErrorCode: safeErrorCode(error),
            finishedAt: retrying ? null : failedAt,
            updatedAt: failedAt,
          })
          .where(
            and(
              eq(documentScanJobs.documentId, claim.documentId),
              eq(documentScanJobs.status, 'processing'),
              eq(documentScanJobs.leaseToken, claim.leaseToken),
            ),
          );
        if (affectedRows(failed) !== 1) throw new Error('Document scan lease was lost');
        const documentRows = await transaction
          .update(documents)
          .set({
            scanStatus: retrying ? 'pending' : 'failed',
            ...(retrying
              ? { scanCompletedAt: null, availableAt: null }
              : { scanCompletedAt: failedAt, availableAt: null, deletedAt: failedAt }),
          })
          .where(
            and(
              eq(documents.id, claim.documentId),
              eq(documents.scanStatus, 'scanning'),
              isNull(documents.deletedAt),
              or(isNotNull(documents.submissionId), gt(documents.stagedExpiresAt, failedAt)),
            ),
          )
          .returning({ id: documents.id });
        if (documentRows.length !== 1) throw new Error('Document scan target was lost');
      });
      if (!retrying) {
        const cleanupKeys = [
          ...new Set([scanKey, claim.storageKey, documentKey].filter((key) => key !== null)),
        ];
        await Promise.all(
          cleanupKeys.map((storageKey) => this.#storage.remove(storageKey).catch(() => undefined)),
        );
      }
      return true;
    }

    if (scanKey === null) throw new Error('Document scan storage target was lost');
    const completedAt = validNow(this.#now);
    await this.#database.transaction(async (transaction) => {
      const completed = await transaction
        .update(documentScanJobs)
        .set({
          status: 'completed',
          leaseToken: null,
          leaseExpiresAt: null,
          finishedAt: completedAt,
          updatedAt: completedAt,
        })
        .where(
          and(
            eq(documentScanJobs.documentId, claim.documentId),
            eq(documentScanJobs.status, 'processing'),
            eq(documentScanJobs.leaseToken, claim.leaseToken),
          ),
        );
      if (affectedRows(completed) !== 1) throw new Error('Document scan lease was lost');

      const documentRows = await transaction
        .update(documents)
        .set(
          verdict.kind === 'infected'
            ? {
                scanStatus: 'infected',
                scanEngine: 'clamav',
                scanCompletedAt: completedAt,
                availableAt: null,
                deletedAt: completedAt,
              }
            : {
                storageKey: scanKey,
                scanStatus: 'clean',
                scanEngine: 'clamav',
                scanCompletedAt: completedAt,
                availableAt: completedAt,
              },
        )
        .where(
          and(
            eq(documents.id, claim.documentId),
            eq(documents.scanStatus, 'scanning'),
            isNull(documents.deletedAt),
            or(isNotNull(documents.submissionId), gt(documents.stagedExpiresAt, completedAt)),
          ),
        )
        .returning({ id: documents.id });
      if (documentRows.length !== 1) throw new Error('Document scan target was lost');
    });
    if (verdict.kind === 'infected') {
      const cleanupKeys = [...new Set([scanKey, claim.storageKey, documentKey])];
      await Promise.all(
        cleanupKeys.map((storageKey) => this.#storage.remove(storageKey).catch(() => undefined)),
      );
    }
    return true;
  }

  async #claimExpiredUploads(now: Date): Promise<readonly CleanupFileTarget[]> {
    const result = await this.#database.execute(sql`
      with candidate as (
        select expired_upload.id
        from ${uploadSessions} as expired_upload
        where expired_upload.expires_at <= ${now}
          and expired_upload.status <> 'completed'
        order by expired_upload.expires_at, expired_upload.id
        for update skip locked
        limit ${CLEANUP_BATCH_SIZE}
      )
      update ${uploadSessions} as tombstoned_upload
      set status = 'expired',
          lease_token = null,
          lease_expires_at = null,
          last_error_code = 'expired',
          updated_at = ${now}
      from candidate
      where tombstoned_upload.id = candidate.id
        and tombstoned_upload.expires_at <= ${now}
        and tombstoned_upload.status <> 'completed'
      returning tombstoned_upload.id as "id",
                tombstoned_upload.quarantine_storage_key as "storageKey"
    `);
    return resultRows(result).map(cleanupFileTarget);
  }

  async #claimExpiredDocuments(now: Date): Promise<readonly CleanupFileTarget[]> {
    return this.#database.transaction(async (transaction) => {
      const candidateResult = await transaction.execute(sql`
        select current_job.document_id as "id"
        from ${documentScanJobs} as current_job
        inner join ${documents} as expired_document
          on expired_document.id = current_job.document_id
        where expired_document.submission_id is null
          and expired_document.staged_expires_at <= ${now}
        order by expired_document.staged_expires_at, expired_document.id
        for update of current_job skip locked
        limit ${CLEANUP_BATCH_SIZE}
      `);
      const candidateIds = resultRows(candidateResult).map((row) => requiredString(row, 'id'));
      if (candidateIds.length === 0) return [];

      const tombstoned = await transaction
        .update(documents)
        .set({ deletedAt: sql`coalesce(${documents.deletedAt}, ${now})` })
        .where(
          and(
            inArray(documents.id, candidateIds),
            isNull(documents.submissionId),
            lte(documents.stagedExpiresAt, now),
          ),
        )
        .returning({ id: documents.id, storageKey: documents.storageKey });
      if (tombstoned.length === 0) return [];

      const tombstonedIds = tombstoned.map(({ id }) => id);
      await transaction
        .update(documentScanJobs)
        .set({
          status: 'dead_letter',
          leaseToken: null,
          leaseExpiresAt: null,
          nextAttemptAt: now,
          lastErrorCode: 'staging_expired',
          finishedAt: now,
          updatedAt: now,
        })
        .where(inArray(documentScanJobs.documentId, tombstonedIds));
      return tombstoned;
    });
  }

  async #claimExpiredSubmissions(
    now: Date,
    cutoff: Date,
  ): Promise<readonly CleanupSubmissionTarget[]> {
    return this.#database.transaction(async (transaction) => {
      // Tracker backfill uses INSERT ... SELECT over submissions. Without a table-level barrier it
      // can read a submission before this transaction marks it cancelled, wait on the submission
      // row lock, and insert a pending operation immediately after the retention claim commits.
      // SHARE conflicts with outbox writers but remains compatible across cleanup workers; taking
      // it before any submission row lock also preserves the Tracker worker's lock order.
      await transaction.execute(sql`lock table ${integrationOutbox} in share mode`);
      const result = await transaction.execute(sql`
        with candidate as (
          select expired_submission.id
          from ${submissions} as expired_submission
          where expired_submission.created_at <= ${cutoff}
            and not exists (
              select 1
              from ${integrationOutbox} as active_operation
              where active_operation.submission_id = expired_submission.id
                and active_operation.status in ('pending', 'processing', 'retry')
            )
          order by expired_submission.created_at, expired_submission.id
          for update of expired_submission skip locked
          limit ${CLEANUP_BATCH_SIZE}
        )
        update ${submissions} as tombstoned_submission
        set status = 'cancelled', updated_at = ${now}
        from candidate
        where tombstoned_submission.id = candidate.id
          and tombstoned_submission.created_at <= ${cutoff}
          and not exists (
            select 1
            from ${integrationOutbox} as active_operation
            where active_operation.submission_id = tombstoned_submission.id
              and active_operation.status in ('pending', 'processing', 'retry')
          )
        returning tombstoned_submission.id as "id"
      `);
      const submissionIds = resultRows(result).map((row) => requiredString(row, 'id'));
      if (submissionIds.length === 0) return [];

      const tombstonedDocuments = await transaction
        .update(documents)
        .set({ deletedAt: sql`coalesce(${documents.deletedAt}, ${now})` })
        .where(inArray(documents.submissionId, submissionIds))
        .returning({
          id: documents.id,
          storageKey: documents.storageKey,
          submissionId: documents.submissionId,
        });
      return submissionIds.map((id) => ({
        id,
        documents: tombstonedDocuments
          .filter((document) => document.submissionId === id)
          .map(({ id: documentId, storageKey }) => ({ id: documentId, storageKey })),
      }));
    });
  }

  async #removeFiles(targets: readonly CleanupFileTarget[]): Promise<{
    readonly errors: readonly unknown[];
    readonly removed: readonly CleanupFileTarget[];
  }> {
    const results = await Promise.all(
      targets.map(async (target) => {
        try {
          await this.#storage.remove(target.storageKey);
          return { error: null, target } as const;
        } catch (error) {
          return { error, target: null } as const;
        }
      }),
    );
    return {
      errors: results.flatMap(({ error }) => (error === null ? [] : [error])),
      removed: results.flatMap(({ target }) => (target === null ? [] : [target])),
    };
  }

  public async cleanupExpired(): Promise<void> {
    const now = validNow(this.#now);
    const submissionCutoff = new Date(
      now.getTime() - this.#submissionRetentionDays * 24 * 60 * 60 * 1_000,
    );
    await this.#database
      .delete(documentAccessGrants)
      .where(lte(documentAccessGrants.expiresAt, now));

    const [expiredUploads, expiredDocuments, expiredSubmissions] = await Promise.all([
      this.#claimExpiredUploads(now),
      this.#claimExpiredDocuments(now),
      this.#claimExpiredSubmissions(now, submissionCutoff),
    ]);
    const uploadRemoval = await this.#removeFiles(expiredUploads);
    const documentRemoval = await this.#removeFiles(expiredDocuments);
    const submissionRemovalResults = await Promise.all(
      expiredSubmissions.map(async (submission) => {
        const removal = await this.#removeFiles(submission.documents);
        return { removal, submission };
      }),
    );
    const removableSubmissions = submissionRemovalResults
      .filter(({ removal }) => removal.errors.length === 0)
      .map(({ submission }) => submission);

    await this.#database.transaction(async (transaction) => {
      const uploadIds = uploadRemoval.removed.map(({ id }) => id);
      if (uploadIds.length > 0) {
        await transaction
          .delete(uploadSessions)
          .where(and(inArray(uploadSessions.id, uploadIds), eq(uploadSessions.status, 'expired')));
      }

      const documentIds = documentRemoval.removed.map(({ id }) => id);
      if (documentIds.length > 0) {
        await transaction
          .delete(uploadSessions)
          .where(inArray(uploadSessions.documentId, documentIds));
        await transaction
          .delete(documents)
          .where(
            and(
              inArray(documents.id, documentIds),
              isNull(documents.submissionId),
              isNotNull(documents.deletedAt),
              lte(documents.stagedExpiresAt, now),
            ),
          );
      }

      const submissionIds = removableSubmissions.map(({ id }) => id);
      const submissionDocumentIds = removableSubmissions.flatMap(({ documents }) =>
        documents.map(({ id }) => id),
      );
      if (submissionDocumentIds.length > 0) {
        await transaction
          .delete(uploadSessions)
          .where(inArray(uploadSessions.documentId, submissionDocumentIds));
      }
      if (submissionIds.length > 0) {
        await transaction.delete(submissions).where(
          and(
            inArray(submissions.id, submissionIds),
            eq(submissions.status, 'cancelled'),
            lte(submissions.createdAt, submissionCutoff),
            sql`not exists (
              select 1
              from ${integrationOutbox} as active_operation
              where active_operation.submission_id = ${submissions.id}
                and active_operation.status in ('pending', 'processing', 'retry')
              )`,
          ),
        );
      }
    });

    const cleanupErrors = [
      ...uploadRemoval.errors,
      ...documentRemoval.errors,
      ...submissionRemovalResults.flatMap(({ removal }) => removal.errors),
    ];
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, 'Private file retention cleanup was incomplete');
    }
  }
}
