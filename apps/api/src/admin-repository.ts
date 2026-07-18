import { createHmac, randomBytes } from 'node:crypto';

import {
  AdminCaseSchema,
  AdminContentDocumentSchema,
  AdminSubmissionListItemSchema,
  AdminUserListItemSchema,
  CaseCatalogItemSchema,
  LeadFormDataSchema,
  PublicContentResponseSchema,
  type AdminCase,
  type AdminCaseCreateRequest,
  type AdminCaseUpdateRequest,
  type AdminContentCreateRequest,
  type AdminContentDocument,
  type AdminContentUpdateRequest,
  type AdminJsonValue,
  type AdminSubmissionListItem,
  type AdminSubmissionListQuery,
  type AdminSubmissionUpdateRequest,
  type AdminUserListItem,
  type AdminUserListQuery,
  type CaseCatalogItem,
  type MaxUser,
  type PublicContentResponse,
} from '@craft72/contracts';
import {
  adminAuditLog,
  adminSessions,
  botDialogs,
  caseCatalogItems,
  contentDocuments,
  documents,
  leadDrafts,
  maxBotOutbox,
  maxUsers,
  submissions,
  type Database,
  type JsonObject,
} from '@craft72/database';
import { and, asc, desc, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';

export interface AuthenticatedAdmin {
  readonly maxUserId: string;
  readonly sessionId: string;
  readonly user: MaxUser;
  readonly expiresAt: Date;
}

export interface CreatedAdminSession extends AuthenticatedAdmin {
  readonly token: string;
}

export interface AdminPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

export interface AdminStore {
  authenticate(token: string): Promise<AuthenticatedAdmin | null>;
  cleanupExpired(): Promise<void>;
  createSession(user: MaxUser, requestId: string): Promise<CreatedAdminSession>;
  revokeSession(token: string, admin: AuthenticatedAdmin, requestId: string): Promise<void>;
  listUsers(query: AdminUserListQuery): Promise<AdminPage<AdminUserListItem>>;
  listSubmissions(query: AdminSubmissionListQuery): Promise<AdminPage<AdminSubmissionListItem>>;
  getSubmission(submissionId: string): Promise<AdminSubmissionListItem | null>;
  queueContactHandoff(
    submissionId: string,
    admin: AuthenticatedAdmin,
    requestId: string,
  ): Promise<void>;
  updateSubmission(
    submissionId: string,
    update: AdminSubmissionUpdateRequest,
    admin: AuthenticatedAdmin,
    requestId: string,
  ): Promise<AdminSubmissionListItem>;
  listCases(): Promise<readonly AdminCase[]>;
  listPublishedCases(): Promise<readonly CaseCatalogItem[]>;
  createCase(
    input: AdminCaseCreateRequest,
    admin: AuthenticatedAdmin,
    requestId: string,
  ): Promise<AdminCase>;
  updateCase(
    id: string,
    input: AdminCaseUpdateRequest,
    admin: AuthenticatedAdmin,
    requestId: string,
  ): Promise<AdminCase>;
  deleteCase(
    id: string,
    expectedVersion: number,
    admin: AuthenticatedAdmin,
    requestId: string,
  ): Promise<void>;
  listContent(): Promise<readonly AdminContentDocument[]>;
  getContent(key: string): Promise<AdminContentDocument | null>;
  getPublishedContent(key: string): Promise<PublicContentResponse | null>;
  createContent(
    input: AdminContentCreateRequest,
    admin: AuthenticatedAdmin,
    requestId: string,
  ): Promise<AdminContentDocument>;
  updateContent(
    key: string,
    input: AdminContentUpdateRequest,
    admin: AuthenticatedAdmin,
    requestId: string,
  ): Promise<AdminContentDocument>;
  publishContent(
    key: string,
    expectedVersion: number,
    admin: AuthenticatedAdmin,
    requestId: string,
  ): Promise<AdminContentDocument>;
  deleteContent(
    key: string,
    expectedVersion: number,
    admin: AuthenticatedAdmin,
    requestId: string,
  ): Promise<void>;
}

export class AdminStoreConflictError extends Error {
  public constructor(message = 'Admin write conflicts with current state') {
    super(message);
    this.name = 'AdminStoreConflictError';
  }
}

export class AdminStoreNotFoundError extends Error {
  public constructor() {
    super('Admin resource not found');
    this.name = 'AdminStoreNotFoundError';
  }
}

export class InvalidAdminCursorError extends Error {
  public constructor() {
    super('Admin cursor is invalid');
    this.name = 'InvalidAdminCursorError';
  }
}

export class AdminStoreActiveDialogNotFoundError extends Error {
  public constructor() {
    super('The administrator has no active MAX bot dialog');
    this.name = 'AdminStoreActiveDialogNotFoundError';
  }
}

export interface PostgresAdminStoreOptions {
  readonly now?: () => Date;
  readonly sessionTokenHashKey: Buffer;
  readonly sessionTtlSeconds: number;
}

interface CursorPayload {
  readonly kind: 'submission' | 'user';
  readonly createdAt: string;
  readonly tieBreaker: string;
}

type SubmissionRow = typeof submissions.$inferSelect;
type CaseRow = typeof caseCatalogItems.$inferSelect;
type ContentRow = typeof contentDocuments.$inferSelect;

type UnknownRow = Readonly<Record<string, unknown>>;

function validNow(clock: () => Date): Date {
  const now = clock();
  if (Number.isNaN(now.getTime()))
    throw new RangeError('Admin store clock returned an invalid date');
  return now;
}

function hashToken(token: string, key: Buffer): string {
  return createHmac('sha256', key).update(token).digest('hex');
}

function resultRows(result: unknown): readonly UnknownRow[] {
  if (typeof result !== 'object' || result === null || !('rows' in result)) {
    throw new TypeError('PostgreSQL returned an invalid admin directory result');
  }
  const rows = (result as { rows?: unknown }).rows;
  if (
    !Array.isArray(rows) ||
    rows.some((row) => typeof row !== 'object' || row === null || Array.isArray(row))
  ) {
    throw new TypeError('PostgreSQL returned invalid admin directory rows');
  }
  return rows as UnknownRow[];
}

function requiredDate(row: UnknownRow, key: string): Date {
  const value = row[key];
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
  if (date === null || Number.isNaN(date.getTime())) {
    throw new TypeError(`PostgreSQL returned an invalid ${key}`);
  }
  return date;
}

function nullableDate(row: UnknownRow, key: string): Date | null {
  return row[key] === null ? null : requiredDate(row, key);
}

function nullableString(row: UnknownRow, key: string): string | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== 'string') throw new TypeError(`PostgreSQL returned an invalid ${key}`);
  return value;
}

function requiredString(row: UnknownRow, key: string): string {
  const value = nullableString(row, key);
  if (value === null) throw new TypeError(`PostgreSQL returned a null ${key}`);
  return value;
}

function nonnegativeInteger(row: UnknownRow, key: string): number {
  const value = Number(row[key]);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`PostgreSQL returned an invalid ${key}`);
  }
  return value;
}

function booleanValue(row: UnknownRow, key: string): boolean {
  const value = row[key];
  if (typeof value !== 'boolean') throw new TypeError(`PostgreSQL returned an invalid ${key}`);
  return value;
}

function adminDirectoryItem(row: UnknownRow): AdminUserListItem {
  const maxUserId = String(row.maxUserId);
  const firstName = nullableString(row, 'firstName');
  const botDialogCount = nonnegativeInteger(row, 'botDialogCount');
  const user =
    firstName === null
      ? null
      : {
          id: maxUserId,
          firstName,
          lastName: nullableString(row, 'lastName'),
          username: nullableString(row, 'username'),
          languageCode: nullableString(row, 'languageCode'),
        };
  const identitySource =
    user === null ? 'bot' : botDialogCount === 0 ? 'miniapp' : 'miniapp_and_bot';

  return AdminUserListItemSchema.parse({
    maxUserId,
    displayName:
      user === null
        ? 'Пользователь MAX'
        : [user.firstName, user.lastName].filter((part) => part !== null).join(' '),
    identitySource,
    user,
    createdAt: requiredDate(row, 'createdAt').toISOString(),
    updatedAt: requiredDate(row, 'updatedAt').toISOString(),
    submissionCount: nonnegativeInteger(row, 'submissionCount'),
    lastSubmissionAt: nullableDate(row, 'lastSubmissionAt')?.toISOString() ?? null,
    hasActiveDraft: booleanValue(row, 'hasActiveDraft'),
    botDialogCount,
    lastBotEventAt: nullableDate(row, 'lastBotEventAt')?.toISOString() ?? null,
  });
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodeCursor(cursor: string, expectedKind: CursorPayload['kind']): CursorPayload {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    const tieBreakerValid =
      typeof parsed === 'object' &&
      parsed !== null &&
      'tieBreaker' in parsed &&
      typeof parsed.tieBreaker === 'string' &&
      (expectedKind === 'user'
        ? /^[1-9]\d{0,18}$/.test(parsed.tieBreaker) &&
          BigInt(parsed.tieBreaker) <= 9_223_372_036_854_775_807n
        : /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            parsed.tieBreaker,
          ));
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('kind' in parsed) ||
      parsed.kind !== expectedKind ||
      !('createdAt' in parsed) ||
      typeof parsed.createdAt !== 'string' ||
      Number.isNaN(new Date(parsed.createdAt).getTime()) ||
      !('tieBreaker' in parsed) ||
      typeof parsed.tieBreaker !== 'string' ||
      !tieBreakerValid
    ) {
      throw new InvalidAdminCursorError();
    }
    return {
      kind: expectedKind,
      createdAt: parsed.createdAt,
      tieBreaker: parsed.tieBreaker,
    };
  } catch (error) {
    if (error instanceof InvalidAdminCursorError) throw error;
    throw new InvalidAdminCursorError();
  }
}

function triState(value: boolean | null): 'no' | 'unknown' | 'yes' {
  return value === null ? 'unknown' : value ? 'yes' : 'no';
}

function intakeFromRow(row: SubmissionRow, documentIds: readonly string[]) {
  return LeadFormDataSchema.parse({
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
    expertiseRequired: triState(row.needsExpertise),
    culturalHeritageSite: triState(row.isCulturalHeritage),
    desiredStart:
      row.desiredStart === null
        ? { status: 'unknown' }
        : { status: 'known', date: row.desiredStart },
    description: row.description,
    links: row.materialLinks,
    documentIds,
    selectedCaseIds: row.selectedCaseIds,
    contact: { phone: row.phone, email: row.email },
    consent: { accepted: true, version: row.consentVersion },
  });
}

function adminUser(user: typeof maxUsers.$inferSelect): MaxUser {
  return {
    id: String(user.maxUserId),
    firstName: user.firstName,
    lastName: user.lastName,
    username: user.username,
    languageCode: user.languageCode,
    photoUrl: null,
  };
}

function markdownLinkLabel(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('[', '\\[').replaceAll(']', '\\]');
}

export function buildAdminContactHandoffMessage(
  submissionId: string,
  target: Pick<MaxUser, 'firstName' | 'id' | 'lastName'>,
): JsonObject {
  const fullName = [target.firstName, target.lastName].filter(Boolean).join(' ');
  const displayName = markdownLinkLabel(fullName);
  return asJsonObject({
    format: 'markdown',
    notify: true,
    text:
      `Контакт по заявке **${submissionId}**\n\n` +
      `[${displayName}](max://user/${target.id})\n\n` +
      'Нажмите на имя, чтобы открыть профиль и написать пользователю в MAX.',
  });
}

function submissionItem(
  row: SubmissionRow,
  user: typeof maxUsers.$inferSelect,
  documentIds: readonly string[],
): AdminSubmissionListItem {
  return AdminSubmissionListItemSchema.parse({
    submissionId: row.submissionId,
    maxUserId: String(row.maxUserId),
    user: {
      id: String(user.maxUserId),
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      languageCode: user.languageCode,
    },
    intake: intakeFromRow(row, documentIds),
    phoneVerified: row.phoneVerified,
    integrationStatus: row.status,
    reviewStatus: row.reviewStatus,
    adminNote: row.adminNote,
    submittedAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function caseFromRow(row: CaseRow): AdminCase {
  return AdminCaseSchema.parse({
    id: row.id,
    title: row.title,
    url: row.url,
    image: row.image,
    city: row.city,
    region: row.region,
    categories: row.categories,
    services: row.services,
    area: row.areaSqm === null ? null : Number(row.areaSqm),
    scale: row.scale,
    constructionKind: row.constructionKind,
    status: row.status,
    tags: row.tags,
    published: row.published,
    sortOrder: row.sortOrder,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function asJsonObject(value: Record<string, AdminJsonValue>): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function contentFromRow(row: ContentRow): AdminContentDocument {
  return AdminContentDocumentSchema.parse({
    key: row.key,
    kind: row.kind,
    draft: row.draft,
    published: row.published,
    version: row.version,
    publishedVersion: row.publishedVersion,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

export class PostgresAdminStore implements AdminStore {
  readonly #database: Database;
  readonly #now: () => Date;
  readonly #sessionTokenHashKey: Buffer;
  readonly #sessionTtlSeconds: number;

  public constructor(database: Database, options: PostgresAdminStoreOptions) {
    if (!Number.isSafeInteger(options.sessionTtlSeconds) || options.sessionTtlSeconds <= 0) {
      throw new RangeError('Admin session TTL must be a positive integer');
    }
    if (options.sessionTokenHashKey.length < 32) {
      throw new RangeError('Admin session token hash key must contain at least 32 bytes');
    }
    this.#database = database;
    this.#now = options.now ?? (() => new Date());
    this.#sessionTokenHashKey = Buffer.from(options.sessionTokenHashKey);
    this.#sessionTtlSeconds = options.sessionTtlSeconds;
  }

  public async cleanupExpired(): Promise<void> {
    const now = validNow(this.#now);
    await this.#database.delete(adminSessions).where(lt(adminSessions.expiresAt, now));
  }

  public async createSession(user: MaxUser, requestId: string): Promise<CreatedAdminSession> {
    const now = validNow(this.#now);
    const expiresAt = new Date(now.getTime() + this.#sessionTtlSeconds * 1_000);
    const token = randomBytes(32).toString('base64url');
    const sessionId = await this.#database.transaction(async (transaction) => {
      await transaction
        .insert(maxUsers)
        .values({
          maxUserId: BigInt(user.id),
          firstName: user.firstName,
          lastName: user.lastName,
          username: user.username,
          languageCode: user.languageCode,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: maxUsers.maxUserId,
          set: {
            firstName: user.firstName,
            lastName: user.lastName,
            username: user.username,
            languageCode: user.languageCode,
            updatedAt: now,
          },
        });
      await transaction
        .update(adminSessions)
        .set({ revokedAt: now })
        .where(and(eq(adminSessions.maxUserId, BigInt(user.id)), isNull(adminSessions.revokedAt)));
      const [session] = await transaction
        .insert(adminSessions)
        .values({
          tokenHash: hashToken(token, this.#sessionTokenHashKey),
          maxUserId: BigInt(user.id),
          expiresAt,
          createdAt: now,
        })
        .returning({ id: adminSessions.id });
      if (session === undefined) throw new Error('Admin session insert returned no row');
      await transaction.insert(adminAuditLog).values({
        actorMaxUserId: BigInt(user.id),
        action: 'admin.session.created',
        targetType: 'admin_session',
        targetId: session.id,
        requestId,
        metadata: {},
        createdAt: now,
      });
      return session.id;
    });

    return { token, sessionId, maxUserId: user.id, user, expiresAt };
  }

  public async authenticate(token: string): Promise<AuthenticatedAdmin | null> {
    const now = validNow(this.#now);
    const [result] = await this.#database
      .select({ session: adminSessions, user: maxUsers })
      .from(adminSessions)
      .innerJoin(maxUsers, eq(maxUsers.maxUserId, adminSessions.maxUserId))
      .where(
        and(
          eq(adminSessions.tokenHash, hashToken(token, this.#sessionTokenHashKey)),
          isNull(adminSessions.revokedAt),
          gt(adminSessions.expiresAt, now),
        ),
      )
      .limit(1);
    if (result === undefined) return null;
    return {
      sessionId: result.session.id,
      maxUserId: String(result.session.maxUserId),
      user: adminUser(result.user),
      expiresAt: result.session.expiresAt,
    };
  }

  public async revokeSession(
    token: string,
    admin: AuthenticatedAdmin,
    requestId: string,
  ): Promise<void> {
    const now = validNow(this.#now);
    await this.#database.transaction(async (transaction) => {
      await transaction
        .update(adminSessions)
        .set({ revokedAt: now })
        .where(
          and(
            eq(adminSessions.id, admin.sessionId),
            eq(adminSessions.tokenHash, hashToken(token, this.#sessionTokenHashKey)),
            isNull(adminSessions.revokedAt),
          ),
        );
      await transaction.insert(adminAuditLog).values({
        actorMaxUserId: BigInt(admin.maxUserId),
        action: 'admin.session.revoked',
        targetType: 'admin_session',
        targetId: admin.sessionId,
        requestId,
        metadata: {},
        createdAt: now,
      });
    });
  }

  public async listUsers(query: AdminUserListQuery): Promise<AdminPage<AdminUserListItem>> {
    const now = validNow(this.#now);
    const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor, 'user');
    const cursorClause =
      cursor === undefined
        ? sql``
        : sql`where (
            directory.created_at < ${cursor.createdAt}::timestamptz
            or (
              directory.created_at = ${cursor.createdAt}::timestamptz
              and directory.max_user_id < ${BigInt(cursor.tieBreaker)}
            )
          )`;
    const result = await this.#database.execute(sql`
      with bot_identity as (
        select current_dialog.max_user_id,
               count(*)::int as dialog_count,
               min(current_dialog.created_at) as first_dialog_at,
               max(current_dialog.updated_at) as last_dialog_updated_at,
               max(current_dialog.last_event_at) as last_bot_event_at
        from ${botDialogs} as current_dialog
        where current_dialog.max_user_id is not null
        group by current_dialog.max_user_id
      ), directory as (
        select coalesce(profile.max_user_id, bot_identity.max_user_id) as max_user_id,
               profile.first_name,
               profile.last_name,
               profile.username,
               profile.language_code,
               coalesce(bot_identity.dialog_count, 0)::int as bot_dialog_count,
               coalesce(
                 least(profile.created_at, bot_identity.first_dialog_at),
                 profile.created_at,
                 bot_identity.first_dialog_at
               ) as created_at,
               coalesce(
                 greatest(
                   profile.updated_at,
                   bot_identity.last_dialog_updated_at,
                   bot_identity.last_bot_event_at
                 ),
                 profile.updated_at,
                 bot_identity.last_dialog_updated_at,
                 bot_identity.last_bot_event_at
               ) as updated_at,
               bot_identity.last_bot_event_at
        from ${maxUsers} as profile
        full outer join bot_identity
          on bot_identity.max_user_id = profile.max_user_id
      )
      select directory.max_user_id::text as "maxUserId",
             directory.first_name as "firstName",
             directory.last_name as "lastName",
             directory.username as "username",
             directory.language_code as "languageCode",
             directory.bot_dialog_count as "botDialogCount",
             directory.created_at as "createdAt",
             to_char(
               directory.created_at at time zone 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
             ) as "cursorCreatedAt",
             directory.updated_at as "updatedAt",
             directory.last_bot_event_at as "lastBotEventAt",
             (
               select count(*)::int
               from ${submissions} as current_submission
               where current_submission.max_user_id = directory.max_user_id
             ) as "submissionCount",
             (
               select max(current_submission.created_at)
               from ${submissions} as current_submission
               where current_submission.max_user_id = directory.max_user_id
             ) as "lastSubmissionAt",
             exists (
               select 1
               from ${leadDrafts} as current_draft
               where current_draft.max_user_id = directory.max_user_id
                 and current_draft.expires_at > ${now}
             ) as "hasActiveDraft"
      from directory
      ${cursorClause}
      order by directory.created_at desc, directory.max_user_id desc
      limit ${query.limit + 1}
    `);
    const rows = resultRows(result).map((row) => ({
      cursorCreatedAt: requiredString(row, 'cursorCreatedAt'),
      item: adminDirectoryItem(row),
    }));
    const visible = rows.slice(0, query.limit);
    const last = visible.at(-1);
    return {
      items: visible.map(({ item }) => item),
      nextCursor:
        rows.length > query.limit && last !== undefined
          ? encodeCursor({
              kind: 'user',
              createdAt: last.cursorCreatedAt,
              tieBreaker: last.item.maxUserId,
            })
          : null,
    };
  }

  public async listSubmissions(
    query: AdminSubmissionListQuery,
  ): Promise<AdminPage<AdminSubmissionListItem>> {
    const cursor =
      query.cursor === undefined ? undefined : decodeCursor(query.cursor, 'submission');
    const predicates = [
      query.maxUserId === undefined
        ? undefined
        : eq(submissions.maxUserId, BigInt(query.maxUserId)),
      query.integrationStatus === undefined
        ? undefined
        : eq(submissions.status, query.integrationStatus),
      query.reviewStatus === undefined
        ? undefined
        : eq(submissions.reviewStatus, query.reviewStatus),
      cursor === undefined
        ? undefined
        : or(
            lt(submissions.createdAt, new Date(cursor.createdAt)),
            and(
              eq(submissions.createdAt, new Date(cursor.createdAt)),
              lt(submissions.id, cursor.tieBreaker),
            ),
          ),
    ].filter((value) => value !== undefined);
    const rows = await this.#database
      .select({ submission: submissions, user: maxUsers })
      .from(submissions)
      .innerJoin(maxUsers, eq(maxUsers.maxUserId, submissions.maxUserId))
      .where(predicates.length === 0 ? undefined : and(...predicates))
      .orderBy(desc(submissions.createdAt), desc(submissions.id))
      .limit(query.limit + 1);
    const visible = rows.slice(0, query.limit);
    const documentIds = await this.#documentIdsBySubmission(
      visible.map(({ submission }) => submission.id),
    );
    const items = visible.map(({ submission, user }) =>
      submissionItem(submission, user, documentIds.get(submission.id) ?? []),
    );
    const last = visible.at(-1);
    return {
      items,
      nextCursor:
        rows.length > query.limit && last !== undefined
          ? encodeCursor({
              kind: 'submission',
              createdAt: last.submission.createdAt.toISOString(),
              tieBreaker: last.submission.id,
            })
          : null,
    };
  }

  public async getSubmission(submissionId: string): Promise<AdminSubmissionListItem | null> {
    const [result] = await this.#database
      .select({ submission: submissions, user: maxUsers })
      .from(submissions)
      .innerJoin(maxUsers, eq(maxUsers.maxUserId, submissions.maxUserId))
      .where(eq(submissions.submissionId, submissionId))
      .limit(1);
    if (result === undefined) return null;
    const documentIds = await this.#documentIdsBySubmission([result.submission.id]);
    return submissionItem(
      result.submission,
      result.user,
      documentIds.get(result.submission.id) ?? [],
    );
  }

  public async queueContactHandoff(
    submissionId: string,
    admin: AuthenticatedAdmin,
    requestId: string,
  ): Promise<void> {
    const now = validNow(this.#now);
    await this.#database.transaction(async (transaction) => {
      const [target] = await transaction
        .select({ submission: submissions, user: maxUsers })
        .from(submissions)
        .innerJoin(maxUsers, eq(maxUsers.maxUserId, submissions.maxUserId))
        .where(eq(submissions.submissionId, submissionId))
        .limit(1);
      if (target === undefined) throw new AdminStoreNotFoundError();

      const [dialog] = await transaction
        .select({ chatId: botDialogs.chatId })
        .from(botDialogs)
        .where(
          and(
            eq(botDialogs.maxUserId, BigInt(admin.maxUserId)),
            eq(botDialogs.status, 'active'),
            // Direct MAX dialogs use positive IDs; never expose a lead profile in a group chat.
            gt(botDialogs.chatId, 0n),
          ),
        )
        .orderBy(desc(botDialogs.lastEventAt), desc(botDialogs.chatId))
        .limit(1);
      if (dialog === undefined) throw new AdminStoreActiveDialogNotFoundError();

      const eventKey = `admin:contact-handoff:${requestId}`;
      const actionKey = `${eventKey}:${admin.sessionId}`;
      await transaction.insert(maxBotOutbox).values({
        eventKey,
        actionKey,
        action: 'send_message',
        chatId: dialog.chatId,
        payload: buildAdminContactHandoffMessage(submissionId, adminUser(target.user)),
        status: 'pending',
        attempts: 0,
        nextAttemptAt: now,
        createdAt: now,
        updatedAt: now,
      });
      await transaction.insert(adminAuditLog).values({
        actorMaxUserId: BigInt(admin.maxUserId),
        action: 'submission.contact_handoff.queued',
        targetType: 'submission',
        targetId: submissionId,
        requestId,
        metadata: {
          adminChatId: String(dialog.chatId),
          targetMaxUserId: String(target.user.maxUserId),
        },
        createdAt: now,
      });
    });
  }

  public async updateSubmission(
    submissionId: string,
    update: AdminSubmissionUpdateRequest,
    admin: AuthenticatedAdmin,
    requestId: string,
  ): Promise<AdminSubmissionListItem> {
    const now = validNow(this.#now);
    await this.#database.transaction(async (transaction) => {
      const set = {
        ...(update.reviewStatus === undefined ? {} : { reviewStatus: update.reviewStatus }),
        ...(update.adminNote === undefined ? {} : { adminNote: update.adminNote }),
        updatedAt: now,
      };
      const [updated] = await transaction
        .update(submissions)
        .set(set)
        .where(
          and(
            eq(submissions.submissionId, submissionId),
            eq(submissions.updatedAt, new Date(update.expectedUpdatedAt)),
          ),
        )
        .returning({ id: submissions.id });
      if (updated === undefined) {
        const [existing] = await transaction
          .select({ id: submissions.id })
          .from(submissions)
          .where(eq(submissions.submissionId, submissionId))
          .limit(1);
        if (existing === undefined) throw new AdminStoreNotFoundError();
        throw new AdminStoreConflictError();
      }
      await transaction.insert(adminAuditLog).values({
        actorMaxUserId: BigInt(admin.maxUserId),
        action: 'submission.review.updated',
        targetType: 'submission',
        targetId: submissionId,
        requestId,
        metadata: {
          changedFields: [
            ...(update.reviewStatus === undefined ? [] : ['reviewStatus']),
            ...(update.adminNote === undefined ? [] : ['adminNote']),
          ],
          notePresent: update.adminNote === undefined ? null : update.adminNote !== null,
        },
        createdAt: now,
      });
    });
    const item = await this.getSubmission(submissionId);
    if (item === null) throw new AdminStoreNotFoundError();
    return item;
  }

  public async listCases(): Promise<readonly AdminCase[]> {
    const rows = await this.#database
      .select()
      .from(caseCatalogItems)
      .orderBy(asc(caseCatalogItems.sortOrder), asc(caseCatalogItems.id))
      .limit(1_000);
    return rows.map(caseFromRow);
  }

  public async listPublishedCases(): Promise<readonly CaseCatalogItem[]> {
    const rows = await this.#database
      .select()
      .from(caseCatalogItems)
      .where(eq(caseCatalogItems.published, true))
      .orderBy(asc(caseCatalogItems.sortOrder), asc(caseCatalogItems.id));
    return rows.map((row) => {
      const item = caseFromRow(row);
      return CaseCatalogItemSchema.parse({
        id: item.id,
        title: item.title,
        url: item.url,
        image: item.image,
        city: item.city,
        region: item.region,
        categories: item.categories,
        services: item.services,
        area: item.area,
        scale: item.scale,
        constructionKind: item.constructionKind,
        status: item.status,
        tags: item.tags,
        published: true,
      });
    });
  }

  public async createCase(
    input: AdminCaseCreateRequest,
    admin: AuthenticatedAdmin,
    requestId: string,
  ): Promise<AdminCase> {
    const now = validNow(this.#now);
    try {
      return await this.#database.transaction(async (transaction) => {
        const [created] = await transaction
          .insert(caseCatalogItems)
          .values({
            id: input.id,
            title: input.title,
            url: input.url,
            image: input.image,
            city: input.city,
            region: input.region,
            categories: input.categories,
            services: input.services,
            areaSqm: input.area === null ? null : String(input.area),
            scale: input.scale,
            constructionKind: input.constructionKind,
            status: input.status,
            tags: input.tags,
            published: input.published,
            sortOrder: input.sortOrder,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (created === undefined) throw new Error('Case insert returned no row');
        await transaction.insert(adminAuditLog).values({
          actorMaxUserId: BigInt(admin.maxUserId),
          action: 'case.created',
          targetType: 'case',
          targetId: input.id,
          requestId,
          metadata: { published: input.published, version: 1 },
          createdAt: now,
        });
        return caseFromRow(created);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new AdminStoreConflictError();
      throw error;
    }
  }

  public async updateCase(
    id: string,
    input: AdminCaseUpdateRequest,
    admin: AuthenticatedAdmin,
    requestId: string,
  ): Promise<AdminCase> {
    const now = validNow(this.#now);
    return this.#database.transaction(async (transaction) => {
      const [updated] = await transaction
        .update(caseCatalogItems)
        .set({
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.url === undefined ? {} : { url: input.url }),
          ...(input.image === undefined ? {} : { image: input.image }),
          ...(input.city === undefined ? {} : { city: input.city }),
          ...(input.region === undefined ? {} : { region: input.region }),
          ...(input.categories === undefined ? {} : { categories: input.categories }),
          ...(input.services === undefined ? {} : { services: input.services }),
          ...(input.area === undefined
            ? {}
            : { areaSqm: input.area === null ? null : String(input.area) }),
          ...(input.scale === undefined ? {} : { scale: input.scale }),
          ...(input.constructionKind === undefined
            ? {}
            : { constructionKind: input.constructionKind }),
          ...(input.status === undefined ? {} : { status: input.status }),
          ...(input.tags === undefined ? {} : { tags: input.tags }),
          ...(input.published === undefined ? {} : { published: input.published }),
          ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
          version: sql`${caseCatalogItems.version} + 1`,
          updatedAt: now,
        })
        .where(
          and(eq(caseCatalogItems.id, id), eq(caseCatalogItems.version, input.expectedVersion)),
        )
        .returning();
      if (updated === undefined) {
        const [existing] = await transaction
          .select({ id: caseCatalogItems.id })
          .from(caseCatalogItems)
          .where(eq(caseCatalogItems.id, id))
          .limit(1);
        if (existing === undefined) throw new AdminStoreNotFoundError();
        throw new AdminStoreConflictError();
      }
      await transaction.insert(adminAuditLog).values({
        actorMaxUserId: BigInt(admin.maxUserId),
        action: 'case.updated',
        targetType: 'case',
        targetId: id,
        requestId,
        metadata: {
          changedFields: Object.keys(input).filter((key) => key !== 'expectedVersion'),
          version: updated.version,
        },
        createdAt: now,
      });
      return caseFromRow(updated);
    });
  }

  public async deleteCase(
    id: string,
    expectedVersion: number,
    admin: AuthenticatedAdmin,
    requestId: string,
  ): Promise<void> {
    const now = validNow(this.#now);
    await this.#database.transaction(async (transaction) => {
      const [deleted] = await transaction
        .delete(caseCatalogItems)
        .where(and(eq(caseCatalogItems.id, id), eq(caseCatalogItems.version, expectedVersion)))
        .returning({ id: caseCatalogItems.id });
      if (deleted === undefined) {
        const [existing] = await transaction
          .select({ id: caseCatalogItems.id })
          .from(caseCatalogItems)
          .where(eq(caseCatalogItems.id, id))
          .limit(1);
        if (existing === undefined) throw new AdminStoreNotFoundError();
        throw new AdminStoreConflictError();
      }
      await transaction.insert(adminAuditLog).values({
        actorMaxUserId: BigInt(admin.maxUserId),
        action: 'case.deleted',
        targetType: 'case',
        targetId: id,
        requestId,
        metadata: { version: expectedVersion },
        createdAt: now,
      });
    });
  }

  public async listContent(): Promise<readonly AdminContentDocument[]> {
    const rows = await this.#database
      .select()
      .from(contentDocuments)
      .orderBy(asc(contentDocuments.kind), asc(contentDocuments.key))
      .limit(1_000);
    return rows.map(contentFromRow);
  }

  public async getContent(key: string): Promise<AdminContentDocument | null> {
    const [row] = await this.#database
      .select()
      .from(contentDocuments)
      .where(eq(contentDocuments.key, key))
      .limit(1);
    return row === undefined ? null : contentFromRow(row);
  }

  public async getPublishedContent(key: string): Promise<PublicContentResponse | null> {
    const [row] = await this.#database
      .select()
      .from(contentDocuments)
      .where(
        and(
          eq(contentDocuments.key, key),
          sql`${contentDocuments.published} is not null`,
          sql`${contentDocuments.publishedAt} is not null`,
          sql`${contentDocuments.publishedVersion} is not null`,
        ),
      )
      .limit(1);
    if (
      row === undefined ||
      row.published === null ||
      row.publishedAt === null ||
      row.publishedVersion === null
    ) {
      return null;
    }
    return PublicContentResponseSchema.parse({
      key: row.key,
      kind: row.kind,
      content: row.published,
      version: row.publishedVersion,
      publishedAt: row.publishedAt.toISOString(),
    });
  }

  public async createContent(
    input: AdminContentCreateRequest,
    admin: AuthenticatedAdmin,
    requestId: string,
  ): Promise<AdminContentDocument> {
    const now = validNow(this.#now);
    try {
      return await this.#database.transaction(async (transaction) => {
        const [created] = await transaction
          .insert(contentDocuments)
          .values({
            key: input.key,
            kind: input.kind,
            draft: asJsonObject(input.draft),
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (created === undefined) throw new Error('Content insert returned no row');
        await transaction.insert(adminAuditLog).values({
          actorMaxUserId: BigInt(admin.maxUserId),
          action: 'content.created',
          targetType: 'content',
          targetId: input.key,
          requestId,
          metadata: { kind: input.kind, version: 1 },
          createdAt: now,
        });
        return contentFromRow(created);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new AdminStoreConflictError();
      throw error;
    }
  }

  public async updateContent(
    key: string,
    input: AdminContentUpdateRequest,
    admin: AuthenticatedAdmin,
    requestId: string,
  ): Promise<AdminContentDocument> {
    const now = validNow(this.#now);
    return this.#database.transaction(async (transaction) => {
      const [updated] = await transaction
        .update(contentDocuments)
        .set({
          draft: asJsonObject(input.draft),
          version: sql`${contentDocuments.version} + 1`,
          updatedAt: now,
        })
        .where(
          and(eq(contentDocuments.key, key), eq(contentDocuments.version, input.expectedVersion)),
        )
        .returning();
      if (updated === undefined) {
        const [existing] = await transaction
          .select({ key: contentDocuments.key })
          .from(contentDocuments)
          .where(eq(contentDocuments.key, key))
          .limit(1);
        if (existing === undefined) throw new AdminStoreNotFoundError();
        throw new AdminStoreConflictError();
      }
      await transaction.insert(adminAuditLog).values({
        actorMaxUserId: BigInt(admin.maxUserId),
        action: 'content.draft.updated',
        targetType: 'content',
        targetId: key,
        requestId,
        metadata: { version: updated.version },
        createdAt: now,
      });
      return contentFromRow(updated);
    });
  }

  public async publishContent(
    key: string,
    expectedVersion: number,
    admin: AuthenticatedAdmin,
    requestId: string,
  ): Promise<AdminContentDocument> {
    const now = validNow(this.#now);
    return this.#database.transaction(async (transaction) => {
      const [updated] = await transaction
        .update(contentDocuments)
        .set({
          published: sql`${contentDocuments.draft}`,
          publishedVersion: expectedVersion,
          publishedAt: now,
          updatedAt: now,
        })
        .where(and(eq(contentDocuments.key, key), eq(contentDocuments.version, expectedVersion)))
        .returning();
      if (updated === undefined) {
        const [existing] = await transaction
          .select({ key: contentDocuments.key })
          .from(contentDocuments)
          .where(eq(contentDocuments.key, key))
          .limit(1);
        if (existing === undefined) throw new AdminStoreNotFoundError();
        throw new AdminStoreConflictError();
      }
      await transaction.insert(adminAuditLog).values({
        actorMaxUserId: BigInt(admin.maxUserId),
        action: 'content.published',
        targetType: 'content',
        targetId: key,
        requestId,
        metadata: { version: expectedVersion },
        createdAt: now,
      });
      return contentFromRow(updated);
    });
  }

  public async deleteContent(
    key: string,
    expectedVersion: number,
    admin: AuthenticatedAdmin,
    requestId: string,
  ): Promise<void> {
    const now = validNow(this.#now);
    await this.#database.transaction(async (transaction) => {
      const [deleted] = await transaction
        .delete(contentDocuments)
        .where(and(eq(contentDocuments.key, key), eq(contentDocuments.version, expectedVersion)))
        .returning({ key: contentDocuments.key });
      if (deleted === undefined) {
        const [existing] = await transaction
          .select({ key: contentDocuments.key })
          .from(contentDocuments)
          .where(eq(contentDocuments.key, key))
          .limit(1);
        if (existing === undefined) throw new AdminStoreNotFoundError();
        throw new AdminStoreConflictError();
      }
      await transaction.insert(adminAuditLog).values({
        actorMaxUserId: BigInt(admin.maxUserId),
        action: 'content.deleted',
        targetType: 'content',
        targetId: key,
        requestId,
        metadata: { version: expectedVersion },
        createdAt: now,
      });
    });
  }

  async #documentIdsBySubmission(submissionIds: readonly string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    if (submissionIds.length === 0) return result;
    const rows = await this.#database
      .select({ id: documents.id, submissionId: documents.submissionId })
      .from(documents)
      .where(and(inArray(documents.submissionId, submissionIds), isNull(documents.deletedAt)));
    for (const row of rows) {
      if (row.submissionId === null) continue;
      const values = result.get(row.submissionId) ?? [];
      values.push(row.id);
      result.set(row.submissionId, values);
    }
    return result;
  }
}
