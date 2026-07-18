import { createHash, randomBytes } from 'node:crypto';

import {
  DocumentSchema,
  LeadDraftSchema,
  MaxAuthResponseSchema,
  SessionTokenSchema,
  StartParamSchema,
  SubmissionSchema,
  type LeadDraft,
  type LeadDraftUpsertRequest,
  type MaxAuthResponse,
  type PrivacyConsentEvidence,
  type TermsAcceptanceEvidence,
  type StartParam,
  type Submission,
  type SubmissionCreateRequest,
} from '@craft72/contracts';
import {
  adminAuditLog,
  adminSessions,
  documents,
  integrationOutbox,
  leadDrafts,
  maxUsers,
  sessions,
  submissions,
  uploadSessions,
  webhookInbox,
  type Database,
  type JsonObject,
} from '@craft72/database';
import { and, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm';

import type { ValidatedMaxInitData, VerifiedMaxContact } from './max-auth.js';
import type { AcceptedMaxWebhook } from './max-webhook.js';
import { buildTrackerOutboxRows } from './tracker-outbox.js';

export interface AuthenticatedSession {
  readonly consentedAt: Date;
  readonly consentTextHash: string;
  readonly consentVersion: string;
  readonly expiresAt: Date;
  readonly maxUserId: string;
  readonly sessionId: string;
  readonly startParam: StartParam | null;
  readonly termsVersion: string;
  readonly termsAcceptedAt: Date;
  readonly termsTextHash: string;
  readonly verifiedPhone: string | null;
  readonly phoneVerifiedAt: Date | null;
}

export interface Stage3Store {
  acceptMaxWebhook(event: AcceptedMaxWebhook): Promise<boolean>;
  authenticate(token: string): Promise<AuthenticatedSession | null>;
  cleanupExpired(): Promise<void>;
  createSession(
    initData: ValidatedMaxInitData,
    consent: PrivacyConsentEvidence,
    terms: TermsAcceptanceEvidence,
  ): Promise<MaxAuthResponse>;
  getDraft(session: AuthenticatedSession): Promise<LeadDraft | null>;
  getSubmission(session: AuthenticatedSession, submissionId: string): Promise<Submission | null>;
  isReady(): Promise<void>;
  setVerifiedContact(session: AuthenticatedSession, contact: VerifiedMaxContact): Promise<void>;
  upsertDraft(session: AuthenticatedSession, request: LeadDraftUpsertRequest): Promise<LeadDraft>;
  createSubmission(
    session: AuthenticatedSession,
    request: SubmissionCreateRequest,
  ): Promise<Submission>;
}

export class StoreConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'StoreConflictError';
  }
}

export class StoreNotFoundError extends Error {
  public readonly resource: 'draft' | 'upload';

  public constructor(resource: 'draft' | 'upload') {
    super(`${resource} was not found for the authenticated user`);
    this.name = 'StoreNotFoundError';
    this.resource = resource;
  }
}

export class StoreUnauthorizedError extends Error {
  public constructor() {
    super('The server session is no longer active');
    this.name = 'StoreUnauthorizedError';
  }
}

export interface PostgresStage3StoreOptions {
  readonly draftTtlSeconds: number;
  readonly now?: () => Date;
  readonly sessionTtlSeconds: number;
  readonly submissionRetentionDays: number;
}

function validNow(clock: () => Date): Date {
  const now = clock();
  if (Number.isNaN(now.getTime())) {
    throw new RangeError('Stage 3 store clock returned an invalid date');
  }
  return now;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function asJsonObject(value: object): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function sourceFromDatabase(value: string): StartParam | null {
  if (value === 'direct') return null;
  const result = StartParamSchema.safeParse(value);
  return result.success ? result.data : null;
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;

  return `{${Object.entries(value)
    .filter(([, child]) => child !== undefined)
    .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(',')}}`;
}

function requestHash(request: SubmissionCreateRequest): string {
  return createHash('sha256')
    .update(
      canonicalJson({
        draftId: request.draftId ?? null,
        payload: request.payload,
      }),
    )
    .digest('hex');
}

function triStateFromDatabase(value: boolean | null): 'no' | 'unknown' | 'yes' {
  return value === null ? 'unknown' : value ? 'yes' : 'no';
}

function triStateToDatabase(value: 'no' | 'unknown' | 'yes'): boolean | null {
  return value === 'unknown' ? null : value === 'yes';
}

function createSubmissionId(now: Date): string {
  const date = now.toISOString().slice(0, 10).replaceAll('-', '');
  return `CRAFT-${date}-${randomBytes(6).toString('hex').toUpperCase()}`;
}

function isPostgresUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

type SubmissionRow = typeof submissions.$inferSelect;

function submissionFromRow(row: SubmissionRow, materialRows: readonly unknown[] = []): Submission {
  const materials = materialRows.map((document) => DocumentSchema.parse(document));
  return SubmissionSchema.parse({
    submissionId: row.submissionId,
    status: row.status,
    payload: {
      role: row.customerRole,
      fullName: row.contactName,
      organization: row.organization ?? 'Не указано',
      inn: row.inn,
      objectType: row.objectType,
      location: {
        ...(row.city === null ? {} : { city: row.city }),
        ...(row.region === null ? {} : { region: row.region }),
      },
      scope:
        row.projectScope === 'single_object'
          ? { kind: 'single_object' }
          : { kind: 'portfolio', objectCount: row.objectCount },
      area:
        row.areaSqm === null
          ? { status: 'unknown' }
          : { status: 'known', squareMeters: Number(row.areaSqm) },
      currentStage: row.projectStage,
      services: row.services,
      expertiseRequired: triStateFromDatabase(row.needsExpertise),
      culturalHeritageSite: triStateFromDatabase(row.isCulturalHeritage),
      desiredStart:
        row.desiredStart === null
          ? { status: 'unknown' }
          : { status: 'known', date: row.desiredStart },
      description: row.description,
      links: row.materialLinks,
      documentIds: materials.map(({ id }) => id),
      selectedCaseIds: row.selectedCaseIds,
      contact: { phone: row.phone, email: row.email },
      consent: { accepted: true, version: row.consentVersion },
    },
    phoneVerified: row.phoneVerified,
    materials,
    matchedCases: [],
    submittedAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function draftFromRow(row: typeof leadDrafts.$inferSelect): LeadDraft {
  return LeadDraftSchema.parse({
    id: row.id,
    currentStep: row.currentStep,
    payload: row.payload,
    source: sourceFromDatabase(row.source),
    updatedAt: row.updatedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  });
}

export class PostgresStage3Store implements Stage3Store {
  readonly #database: Database;
  readonly #draftTtlSeconds: number;
  readonly #now: () => Date;
  readonly #sessionTtlSeconds: number;

  public constructor(database: Database, options: PostgresStage3StoreOptions) {
    if (!Number.isSafeInteger(options.sessionTtlSeconds) || options.sessionTtlSeconds <= 0) {
      throw new RangeError('Session TTL must be a positive integer');
    }
    if (!Number.isSafeInteger(options.draftTtlSeconds) || options.draftTtlSeconds <= 0) {
      throw new RangeError('Draft TTL must be a positive integer');
    }
    if (
      !Number.isSafeInteger(options.submissionRetentionDays) ||
      options.submissionRetentionDays <= 0
    ) {
      throw new RangeError('Submission retention must be a positive number of days');
    }

    this.#database = database;
    this.#sessionTtlSeconds = options.sessionTtlSeconds;
    this.#draftTtlSeconds = options.draftTtlSeconds;
    this.#now = options.now ?? (() => new Date());
  }

  public async isReady(): Promise<void> {
    await this.#database.execute(sql`select 1`);
  }

  public async acceptMaxWebhook(event: AcceptedMaxWebhook): Promise<boolean> {
    const now = validNow(this.#now);
    const inserted = await this.#database
      .insert(webhookInbox)
      .values({
        eventKey: event.eventKey,
        eventType: event.eventType,
        chatId: event.chatId,
        payload: asJsonObject(event.payload),
        status: 'pending',
        attempts: 0,
        nextAttemptAt: now,
        receivedAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: webhookInbox.eventKey })
      .returning({ eventKey: webhookInbox.eventKey });

    return inserted.length === 1;
  }

  public async cleanupExpired(): Promise<void> {
    const now = validNow(this.#now);
    await this.#database.transaction(async (transaction) => {
      await transaction.delete(sessions).where(lte(sessions.expiresAt, now));
      await transaction.delete(leadDrafts).where(lte(leadDrafts.expiresAt, now));
      await transaction.execute(sql`
        delete from ${maxUsers} as candidate
        where not exists (
          select 1 from ${sessions}
          where ${sessions.maxUserId} = candidate.max_user_id
        )
          and not exists (
            select 1 from ${leadDrafts}
            where ${leadDrafts.maxUserId} = candidate.max_user_id
          )
          and not exists (
            select 1 from ${submissions}
            where ${submissions.maxUserId} = candidate.max_user_id
          )
          and not exists (
            select 1 from ${documents}
            where ${documents.maxUserId} = candidate.max_user_id
          )
          and not exists (
            select 1 from ${uploadSessions}
            where ${uploadSessions.maxUserId} = candidate.max_user_id
          )
          and not exists (
            select 1 from ${adminSessions}
            where ${adminSessions.maxUserId} = candidate.max_user_id
          )
          and not exists (
            select 1 from ${adminAuditLog}
            where ${adminAuditLog.actorMaxUserId} = candidate.max_user_id
          )
      `);
    });
  }

  public async createSession(
    initData: ValidatedMaxInitData,
    consent: PrivacyConsentEvidence,
    terms: TermsAcceptanceEvidence,
  ): Promise<MaxAuthResponse> {
    const now = validNow(this.#now);
    const expiresAt = new Date(now.getTime() + this.#sessionTtlSeconds * 1_000);
    const token = SessionTokenSchema.parse(randomBytes(32).toString('base64url'));
    const tokenHash = hashToken(token);
    const maxUserId = BigInt(initData.user.id);

    await this.#database.transaction(async (transaction) => {
      await transaction
        .insert(maxUsers)
        .values({
          maxUserId,
          firstName: initData.user.firstName,
          lastName: initData.user.lastName,
          username: initData.user.username,
          languageCode: initData.user.languageCode,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: maxUsers.maxUserId,
          set: {
            firstName: initData.user.firstName,
            lastName: initData.user.lastName,
            username: initData.user.username,
            languageCode: initData.user.languageCode,
            updatedAt: now,
          },
        });

      await transaction.delete(sessions).where(lte(sessions.expiresAt, now));
      await transaction.insert(sessions).values({
        tokenHash,
        maxUserId,
        consentVersion: consent.version,
        consentTextHash: createHash('sha256').update(consent.text).digest('hex'),
        consentClientAcceptedAt: new Date(consent.acceptedAt),
        consentedAt: now,
        termsVersion: terms.version,
        termsTextHash: createHash('sha256').update(terms.text).digest('hex'),
        termsClientAcceptedAt: new Date(terms.acceptedAt),
        termsAcceptedAt: now,
        expiresAt,
        startParam: initData.startParam,
        createdAt: now,
      });
    });

    return MaxAuthResponseSchema.parse({
      authenticated: true,
      user: initData.user,
      session: { token, expiresAt: expiresAt.toISOString(), verifiedContact: null },
      startParam: initData.startParam,
    });
  }

  public async authenticate(tokenInput: string): Promise<AuthenticatedSession | null> {
    const token = SessionTokenSchema.safeParse(tokenInput);
    if (!token.success) return null;

    const now = validNow(this.#now);
    const rows = await this.#database
      .select({
        consentedAt: sessions.consentedAt,
        consentTextHash: sessions.consentTextHash,
        consentVersion: sessions.consentVersion,
        expiresAt: sessions.expiresAt,
        maxUserId: sessions.maxUserId,
        phoneVerifiedAt: sessions.phoneVerifiedAt,
        sessionId: sessions.id,
        startParam: sessions.startParam,
        termsVersion: sessions.termsVersion,
        termsAcceptedAt: sessions.termsAcceptedAt,
        termsTextHash: sessions.termsTextHash,
        verifiedPhone: sessions.verifiedPhone,
      })
      .from(sessions)
      .where(
        and(
          eq(sessions.tokenHash, hashToken(token.data)),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, now),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;

    return {
      consentedAt: row.consentedAt,
      consentTextHash: row.consentTextHash,
      consentVersion: row.consentVersion,
      expiresAt: row.expiresAt,
      maxUserId: row.maxUserId.toString(),
      sessionId: row.sessionId,
      startParam: row.startParam === null ? null : sourceFromDatabase(row.startParam),
      termsVersion: row.termsVersion,
      termsAcceptedAt: row.termsAcceptedAt,
      termsTextHash: row.termsTextHash,
      verifiedPhone: row.verifiedPhone,
      phoneVerifiedAt: row.phoneVerifiedAt,
    };
  }

  public async setVerifiedContact(
    session: AuthenticatedSession,
    contact: VerifiedMaxContact,
  ): Promise<void> {
    const now = validNow(this.#now);
    const updated = await this.#database
      .update(sessions)
      .set({ verifiedPhone: contact.phone, phoneVerifiedAt: contact.verifiedAt })
      .where(
        and(
          eq(sessions.id, session.sessionId),
          eq(sessions.maxUserId, BigInt(session.maxUserId)),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, now),
        ),
      )
      .returning({ id: sessions.id });
    if (updated.length !== 1) throw new StoreUnauthorizedError();
  }

  public async getDraft(session: AuthenticatedSession): Promise<LeadDraft | null> {
    const now = validNow(this.#now);
    const rows = await this.#database
      .select()
      .from(leadDrafts)
      .where(
        and(eq(leadDrafts.maxUserId, BigInt(session.maxUserId)), gt(leadDrafts.expiresAt, now)),
      )
      .limit(1);
    return rows[0] === undefined ? null : draftFromRow(rows[0]);
  }

  public async upsertDraft(
    session: AuthenticatedSession,
    request: LeadDraftUpsertRequest,
  ): Promise<LeadDraft> {
    const now = validNow(this.#now);
    const expiresAt = new Date(now.getTime() + this.#draftTtlSeconds * 1_000);
    const maxUserId = BigInt(session.maxUserId);

    const row = await this.#database.transaction(async (transaction) => {
      await transaction
        .delete(leadDrafts)
        .where(and(eq(leadDrafts.maxUserId, maxUserId), lte(leadDrafts.expiresAt, now)));
      const rows = await transaction
        .insert(leadDrafts)
        .values({
          maxUserId,
          currentStep: request.currentStep,
          payload: asJsonObject(request.payload),
          source: session.startParam ?? 'direct',
          consentVersion: session.consentVersion,
          consentTextHash: session.consentTextHash,
          consentedAt: session.consentedAt,
          termsVersion: session.termsVersion,
          termsTextHash: session.termsTextHash,
          termsAcceptedAt: session.termsAcceptedAt,
          createdAt: now,
          updatedAt: now,
          expiresAt,
        })
        .onConflictDoUpdate({
          target: leadDrafts.maxUserId,
          set: {
            currentStep: request.currentStep,
            payload: asJsonObject(request.payload),
            consentVersion: session.consentVersion,
            consentTextHash: session.consentTextHash,
            consentedAt: session.consentedAt,
            termsVersion: session.termsVersion,
            termsTextHash: session.termsTextHash,
            termsAcceptedAt: session.termsAcceptedAt,
            updatedAt: now,
            expiresAt,
          },
        })
        .returning();
      const stored = rows[0];
      if (stored === undefined) throw new Error('PostgreSQL did not return the saved draft');
      return stored;
    });

    return draftFromRow(row);
  }

  public async createSubmission(
    session: AuthenticatedSession,
    request: SubmissionCreateRequest,
  ): Promise<Submission> {
    const now = validNow(this.#now);
    const maxUserId = BigInt(session.maxUserId);
    const fingerprint = requestHash(request);
    let row: SubmissionRow;
    try {
      row = await this.#database.transaction(async (transaction) => {
        const existingRows = await transaction
          .select()
          .from(submissions)
          .where(
            and(
              eq(submissions.maxUserId, maxUserId),
              eq(submissions.idempotencyKey, request.idempotencyKey),
            ),
          )
          .limit(1);
        const existing = existingRows[0];
        if (existing !== undefined) {
          if (existing.requestHash !== fingerprint) {
            throw new StoreConflictError('Idempotency key was reused for another submission');
          }
          return existing;
        }

        if (request.draftId !== undefined) {
          const draftRows = await transaction
            .select({ id: leadDrafts.id })
            .from(leadDrafts)
            .where(
              and(
                eq(leadDrafts.id, request.draftId),
                eq(leadDrafts.maxUserId, maxUserId),
                gt(leadDrafts.expiresAt, now),
              ),
            )
            .limit(1);
          if (draftRows.length !== 1) throw new StoreNotFoundError('draft');
        }

        const payload = request.payload;
        if (payload.documentIds.length > 0) {
          const materialRows = await transaction
            .select({ id: documents.id })
            .from(documents)
            .where(
              and(
                inArray(documents.id, payload.documentIds),
                eq(documents.maxUserId, maxUserId),
                isNull(documents.submissionId),
                eq(documents.scanStatus, 'clean'),
                isNull(documents.deletedAt),
                gt(documents.stagedExpiresAt, now),
              ),
            )
            .for('update');
          if (materialRows.length !== new Set(payload.documentIds).size) {
            throw new StoreNotFoundError('upload');
          }
        }
        const createdRows = await transaction
          .insert(submissions)
          .values({
            submissionId: createSubmissionId(now),
            idempotencyKey: request.idempotencyKey,
            requestHash: fingerprint,
            maxUserId,
            customerRole: payload.role,
            contactName: payload.fullName,
            organization: payload.organization,
            inn: payload.inn,
            objectType: payload.objectType,
            ...(payload.location.city === undefined ? {} : { city: payload.location.city }),
            ...(payload.location.region === undefined ? {} : { region: payload.location.region }),
            projectScope: payload.scope.kind,
            objectCount: payload.scope.kind === 'portfolio' ? payload.scope.objectCount : 1,
            areaSqm: payload.area.status === 'known' ? String(payload.area.squareMeters) : null,
            projectStage: payload.currentStage,
            services: payload.services,
            needsExpertise: triStateToDatabase(payload.expertiseRequired),
            isCulturalHeritage: triStateToDatabase(payload.culturalHeritageSite),
            desiredStart:
              payload.desiredStart.status === 'known' ? payload.desiredStart.date : null,
            description: payload.description,
            materialLinks: payload.links,
            selectedCaseIds: payload.selectedCaseIds,
            phone: payload.contact.phone,
            phoneVerified: session.verifiedPhone === payload.contact.phone,
            email: payload.contact.email,
            consentVersion: payload.consent.version,
            consentTextHash: session.consentTextHash,
            consentedAt: now,
            termsVersion: session.termsVersion,
            termsTextHash: session.termsTextHash,
            termsAcceptedAt: session.termsAcceptedAt,
            source: session.startParam ?? 'direct',
            status: 'received',
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        const created = createdRows[0];
        if (created === undefined) throw new Error('PostgreSQL did not return the submission');

        if (payload.documentIds.length > 0) {
          const attached = await transaction
            .update(documents)
            .set({ submissionId: created.id })
            .where(
              and(
                inArray(documents.id, payload.documentIds),
                eq(documents.maxUserId, maxUserId),
                isNull(documents.submissionId),
                eq(documents.scanStatus, 'clean'),
                isNull(documents.deletedAt),
                gt(documents.stagedExpiresAt, now),
              ),
            )
            .returning({ id: documents.id });
          if (attached.length !== new Set(payload.documentIds).size) {
            throw new StoreConflictError('Uploaded materials changed during submission');
          }
        }

        await transaction.insert(integrationOutbox).values([
          ...buildTrackerOutboxRows({
            hasMaterials: payload.links.length > 0 || payload.documentIds.length > 0,
            now,
            submissionDatabaseId: created.id,
            submissionId: created.submissionId,
          }),
        ]);

        if (request.draftId !== undefined) {
          await transaction
            .delete(leadDrafts)
            .where(and(eq(leadDrafts.id, request.draftId), eq(leadDrafts.maxUserId, maxUserId)));
        }
        return created;
      });
    } catch (error) {
      if (!isPostgresUniqueViolation(error)) throw error;
      const concurrentRows = await this.#database
        .select()
        .from(submissions)
        .where(
          and(
            eq(submissions.maxUserId, maxUserId),
            eq(submissions.idempotencyKey, request.idempotencyKey),
          ),
        )
        .limit(1);
      const concurrent = concurrentRows[0];
      if (concurrent === undefined) throw error;
      if (concurrent.requestHash !== fingerprint) {
        throw new StoreConflictError('Idempotency key was reused for another submission');
      }
      row = concurrent;
    }

    const materialRows = await this.#database
      .select({
        id: documents.id,
        originalName: documents.originalName,
        mimeType: documents.mimeType,
        sizeBytes: documents.sizeBytes,
        sha256: documents.sha256,
        scanStatus: documents.scanStatus,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .where(
        and(
          eq(documents.submissionId, row.id),
          eq(documents.maxUserId, maxUserId),
          isNull(documents.deletedAt),
        ),
      );
    return submissionFromRow(
      row,
      materialRows.map((document) => ({
        ...document,
        createdAt: document.createdAt.toISOString(),
      })),
    );
  }

  public async getSubmission(
    session: AuthenticatedSession,
    submissionId: string,
  ): Promise<Submission | null> {
    const rows = await this.#database
      .select()
      .from(submissions)
      .where(
        and(
          eq(submissions.submissionId, submissionId),
          eq(submissions.maxUserId, BigInt(session.maxUserId)),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;

    const materialRows = await this.#database
      .select({
        id: documents.id,
        originalName: documents.originalName,
        mimeType: documents.mimeType,
        sizeBytes: documents.sizeBytes,
        sha256: documents.sha256,
        scanStatus: documents.scanStatus,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .where(
        and(
          eq(documents.submissionId, row.id),
          eq(documents.maxUserId, BigInt(session.maxUserId)),
          isNull(documents.deletedAt),
        ),
      );
    return submissionFromRow(
      row,
      materialRows.map((document) => ({
        ...document,
        createdAt: document.createdAt.toISOString(),
      })),
    );
  }
}
