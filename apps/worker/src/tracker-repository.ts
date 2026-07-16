import {
  documents,
  integrationOutbox,
  submissions,
  type Database,
  type JsonObject,
} from '@craft72/database';
import { sql } from 'drizzle-orm';

import type {
  TrackerOperation,
  TrackerPlanDependencies,
  TrackerSubmissionSnapshot,
} from './tracker-plan.js';

export interface TrackerOperationCandidate {
  readonly id: string;
  readonly operation: TrackerOperation;
  readonly payload: JsonObject;
  readonly submissionDatabaseId: string;
}

export interface ClaimedTrackerOperation extends TrackerOperationCandidate {
  readonly attempts: number;
  readonly leaseToken: string;
}

export interface TrackerOperationContext {
  readonly dependencies: TrackerPlanDependencies;
  readonly submission: TrackerSubmissionSnapshot;
}

export interface TrackerOutboxStore {
  backfillTrackerOutbox(now: Date): Promise<number>;
  claimTrackerOperation(
    now: Date,
    leaseExpiresAt: Date,
    leaseToken: string,
  ): Promise<ClaimedTrackerOperation | null>;
  completeTrackerOperation(
    claim: ClaimedTrackerOperation,
    resultKey: string,
    now: Date,
  ): Promise<void>;
  failTrackerOperation(
    claim: ClaimedTrackerOperation,
    errorCode: string,
    retryAt: Date | null,
    now: Date,
  ): Promise<void>;
  loadTrackerOperationContext(submissionDatabaseId: string): Promise<TrackerOperationContext>;
  previewTrackerOperations(now: Date): Promise<readonly TrackerOperationCandidate[]>;
}

interface RawTrackerOperationRow {
  readonly attempts?: unknown;
  readonly id: unknown;
  readonly leaseToken?: unknown;
  readonly operation: unknown;
  readonly payload: unknown;
  readonly submissionDatabaseId: unknown;
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

function firstRow(result: unknown): Record<string, unknown> | null {
  return resultRows(result)[0] ?? null;
}

function affectedRows(result: unknown): number {
  if (typeof result !== 'object' || result === null || !('rowCount' in result)) return 0;
  const rowCount = (result as { rowCount?: unknown }).rowCount;
  return typeof rowCount === 'number' ? rowCount : 0;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`PostgreSQL returned an invalid ${name}`);
  }
  return value;
}

function nullableString(value: unknown, name: string): string | null {
  return value === null || value === undefined ? null : requiredString(value, name);
}

function requiredPositiveInteger(value: unknown, name: string): number {
  const integer = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(integer) || integer < 1) {
    throw new TypeError(`PostgreSQL returned an invalid ${name}`);
  }
  return integer;
}

function nullableBoolean(value: unknown, name: string): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'boolean') throw new TypeError(`PostgreSQL returned an invalid ${name}`);
  return value;
}

function requiredStringArray(value: unknown, name: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new TypeError(`PostgreSQL returned an invalid ${name}`);
  }
  return value;
}

function jsonObject(value: unknown): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('PostgreSQL returned an invalid Tracker outbox payload');
  }
  return value as JsonObject;
}

function trackerOperation(value: unknown): TrackerOperation {
  if (value !== 'upsert_partner' && value !== 'create_crm' && value !== 'create_docs') {
    throw new TypeError('PostgreSQL returned an unsupported Tracker operation');
  }
  return value;
}

function trackerCandidate(row: RawTrackerOperationRow): TrackerOperationCandidate {
  return {
    id: requiredString(row.id, 'Tracker outbox ID'),
    operation: trackerOperation(row.operation),
    payload: jsonObject(row.payload),
    submissionDatabaseId: requiredString(row.submissionDatabaseId, 'submission database ID'),
  };
}

function claimedTrackerOperation(row: RawTrackerOperationRow): ClaimedTrackerOperation {
  const candidate = trackerCandidate(row);
  return {
    ...candidate,
    attempts: requiredPositiveInteger(row.attempts, 'Tracker attempts'),
    leaseToken: requiredString(row.leaseToken, 'Tracker lease token'),
  };
}

function safeErrorCode(value: string): string {
  const normalized = value.replaceAll(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 128);
  return normalized.length > 0 ? normalized : 'unknown_error';
}

function requiredIssueKey(value: string): string {
  if (!/^[A-Z][A-Z0-9_]{0,31}-[1-9]\d*$/.test(value)) {
    throw new TypeError('Tracker returned an invalid issue key');
  }
  return value;
}

function dependencyIssueKey(value: unknown, name: string): string | null {
  const key = nullableString(value, name);
  if (key === null) return null;
  if (!/^[A-Z][A-Z0-9_]{0,31}-[1-9]\d*$/.test(key)) {
    throw new TypeError(`PostgreSQL returned an invalid ${name}`);
  }
  return key;
}

function decimalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const rendered = typeof value === 'number' || typeof value === 'string' ? String(value) : '';
  if (!/^\d+(?:[.]\d+)?$/.test(rendered)) {
    throw new TypeError('PostgreSQL returned an invalid area');
  }
  return rendered;
}

function maxUserId(value: unknown): string {
  const rendered =
    typeof value === 'bigint' || typeof value === 'number' || typeof value === 'string'
      ? String(value)
      : '';
  if (!/^[1-9]\d*$/.test(rendered)) {
    throw new TypeError('PostgreSQL returned an invalid MAX user ID');
  }
  return rendered;
}

function projectScope(value: unknown): 'portfolio' | 'single_object' {
  if (value !== 'portfolio' && value !== 'single_object') {
    throw new TypeError('PostgreSQL returned an invalid project scope');
  }
  return value;
}

function validDate(value: Date, name: string): void {
  if (Number.isNaN(value.getTime())) throw new RangeError(`${name} is invalid`);
}

export class PostgresTrackerOutboxStore implements TrackerOutboxStore {
  readonly #database: Database;

  public constructor(database: Database) {
    this.#database = database;
  }

  /**
   * Repairs submissions created before Stage 6. The three inserts are ordered to satisfy the
   * dependency FK, share one transaction, and are safe to repeat because both outbox uniqueness
   * constraints are guarded by ON CONFLICT DO NOTHING.
   */
  public async backfillTrackerOutbox(now: Date): Promise<number> {
    validDate(now, 'Tracker backfill time');
    return this.#database.transaction(async (transaction) => {
      const partnerRows = await transaction.execute(sql`
        insert into ${integrationOutbox} (
          submission_id,
          operation,
          depends_on_operation,
          idempotency_key,
          payload,
          status,
          attempts,
          next_attempt_at,
          created_at,
          updated_at,
          result_key,
          completed_at
        )
        select source_submission.id,
               'upsert_partner',
               null,
               concat('tracker:', source_submission.submission_id, ':part:v1'),
               jsonb_build_object('schemaVersion', 1),
               case
                 when source_submission.tracker_part_key is null
                   then 'pending'::integration_outbox_status
                 else 'completed'::integration_outbox_status
               end,
               0,
               ${now},
               ${now},
               ${now},
               source_submission.tracker_part_key,
               case
                 when source_submission.tracker_part_key is null then null::timestamptz
                 else ${now}::timestamptz
               end
        from ${submissions} as source_submission
        where source_submission.status <> 'cancelled'
          and not exists (
            select 1 from ${integrationOutbox} as existing_operation
            where existing_operation.submission_id = source_submission.id
              and existing_operation.operation = 'upsert_partner'
          )
        on conflict do nothing
      `);

      const crmRows = await transaction.execute(sql`
        insert into ${integrationOutbox} (
          submission_id,
          operation,
          depends_on_operation,
          idempotency_key,
          payload,
          status,
          attempts,
          next_attempt_at,
          created_at,
          updated_at,
          result_key,
          completed_at
        )
        select source_submission.id,
               'create_crm',
               'upsert_partner',
               concat('tracker:', source_submission.submission_id, ':crm:v1'),
               jsonb_build_object('schemaVersion', 1),
               case
                 when source_submission.tracker_crm_key is null
                   then 'pending'::integration_outbox_status
                 else 'completed'::integration_outbox_status
               end,
               0,
               ${now},
               ${now},
               ${now},
               source_submission.tracker_crm_key,
               case
                 when source_submission.tracker_crm_key is null then null::timestamptz
                 else ${now}::timestamptz
               end
        from ${submissions} as source_submission
        where source_submission.status <> 'cancelled'
          and exists (
            select 1 from ${integrationOutbox} as partner_operation
            where partner_operation.submission_id = source_submission.id
              and partner_operation.operation = 'upsert_partner'
          )
          and not exists (
            select 1 from ${integrationOutbox} as existing_operation
            where existing_operation.submission_id = source_submission.id
              and existing_operation.operation = 'create_crm'
          )
        on conflict do nothing
      `);

      const docsRows = await transaction.execute(sql`
        insert into ${integrationOutbox} (
          submission_id,
          operation,
          depends_on_operation,
          idempotency_key,
          payload,
          status,
          attempts,
          next_attempt_at,
          created_at,
          updated_at,
          result_key,
          completed_at
        )
        select source_submission.id,
               'create_docs',
               'create_crm',
               concat('tracker:', source_submission.submission_id, ':docs:v1'),
               jsonb_build_object('schemaVersion', 1),
               case
                 when source_submission.tracker_docs_key is null
                   then 'pending'::integration_outbox_status
                 else 'completed'::integration_outbox_status
               end,
               0,
               ${now},
               ${now},
               ${now},
               source_submission.tracker_docs_key,
               case
                 when source_submission.tracker_docs_key is null then null::timestamptz
                 else ${now}::timestamptz
               end
        from ${submissions} as source_submission
        where source_submission.status <> 'cancelled'
          and (
            source_submission.tracker_docs_key is not null
            or cardinality(source_submission.material_links) > 0
            or exists (
              select 1 from ${documents} as source_document
              where source_document.submission_id = source_submission.id
                and source_document.scan_status = 'clean'
                and source_document.deleted_at is null
            )
          )
          and exists (
            select 1 from ${integrationOutbox} as crm_operation
            where crm_operation.submission_id = source_submission.id
              and crm_operation.operation = 'create_crm'
          )
          and not exists (
            select 1 from ${integrationOutbox} as existing_operation
            where existing_operation.submission_id = source_submission.id
              and existing_operation.operation = 'create_docs'
          )
        on conflict do nothing
      `);

      return affectedRows(partnerRows) + affectedRows(crmRows) + affectedRows(docsRows);
    });
  }

  public async claimTrackerOperation(
    now: Date,
    leaseExpiresAt: Date,
    leaseToken: string,
  ): Promise<ClaimedTrackerOperation | null> {
    validDate(now, 'Tracker claim time');
    validDate(leaseExpiresAt, 'Tracker lease expiry');
    if (leaseExpiresAt <= now) throw new RangeError('Tracker lease expiry must be in the future');

    const result = await this.#database.execute(sql`
      with candidate as (
        select current_operation.id
        from ${integrationOutbox} as current_operation
        inner join ${submissions} as source_submission
          on source_submission.id = current_operation.submission_id
        where source_submission.status <> 'cancelled'
          and (
            (current_operation.status in ('pending', 'retry')
              and current_operation.next_attempt_at <= ${now})
            or (current_operation.status = 'processing'
              and current_operation.lease_expires_at <= ${now})
          )
          and (
            current_operation.depends_on_operation is null
            or exists (
              select 1
              from ${integrationOutbox} as dependency
              where dependency.submission_id = current_operation.submission_id
                and dependency.operation = current_operation.depends_on_operation
                and dependency.status = 'completed'
                and dependency.result_key is not null
            )
          )
        order by current_operation.created_at,
          case current_operation.operation
            when 'upsert_partner' then 1
            when 'create_crm' then 2
            when 'create_docs' then 3
          end,
          current_operation.id
        for update of current_operation skip locked
        limit 1
      ), claimed as (
        update ${integrationOutbox} as claimed_operation
        set status = 'processing',
            attempts = claimed_operation.attempts + 1,
            lease_token = ${leaseToken},
            lease_expires_at = ${leaseExpiresAt},
            result_key = null,
            last_error_code = null,
            last_error_at = null,
            completed_at = null,
            updated_at = ${now}
        from candidate
        where claimed_operation.id = candidate.id
        returning claimed_operation.id,
                  claimed_operation.submission_id,
                  claimed_operation.operation,
                  claimed_operation.payload,
                  claimed_operation.attempts,
                  claimed_operation.lease_token
      ), marked_submission as (
        update ${submissions} as marked
        set status = 'syncing', updated_at = ${now}
        from claimed
        where marked.id = claimed.submission_id
          and marked.status <> 'cancelled'
        returning marked.id
      )
      select claimed.id as "id",
             claimed.submission_id as "submissionDatabaseId",
             claimed.operation as "operation",
             claimed.payload as "payload",
             claimed.attempts as "attempts",
             claimed.lease_token as "leaseToken"
      from claimed
    `);
    const row = firstRow(result) as RawTrackerOperationRow | null;
    return row === null ? null : claimedTrackerOperation(row);
  }

  public async previewTrackerOperations(now: Date): Promise<readonly TrackerOperationCandidate[]> {
    validDate(now, 'Tracker preview time');
    const result = await this.#database.execute(sql`
      select current_operation.id as "id",
             current_operation.submission_id as "submissionDatabaseId",
             current_operation.operation as "operation",
             current_operation.payload as "payload"
      from ${integrationOutbox} as current_operation
      inner join ${submissions} as source_submission
        on source_submission.id = current_operation.submission_id
      where source_submission.status <> 'cancelled'
        and (
          (current_operation.status in ('pending', 'retry')
            and current_operation.next_attempt_at <= ${now})
          or (current_operation.status = 'processing'
            and current_operation.lease_expires_at <= ${now})
        )
      order by current_operation.created_at,
        case current_operation.operation
          when 'upsert_partner' then 1
          when 'create_crm' then 2
          when 'create_docs' then 3
        end,
        current_operation.id
    `);
    return resultRows(result).map((row) =>
      trackerCandidate(row as unknown as RawTrackerOperationRow),
    );
  }

  public async loadTrackerOperationContext(
    submissionDatabaseId: string,
  ): Promise<TrackerOperationContext> {
    const submissionResult = await this.#database.execute(sql`
      select source_submission.submission_id as "submissionId",
             source_submission.max_user_id as "maxUserId",
             source_submission.customer_role as "role",
             source_submission.contact_name as "contactName",
             source_submission.organization as "organization",
             source_submission.inn as "inn",
             source_submission.object_type as "objectType",
             source_submission.city as "city",
             source_submission.region as "region",
             source_submission.project_scope as "projectScope",
             source_submission.object_count as "objectCount",
             source_submission.area_sqm as "areaSquareMeters",
             source_submission.project_stage as "projectStage",
             source_submission.services as "services",
             source_submission.needs_expertise as "expertiseRequired",
             source_submission.is_cultural_heritage as "culturalHeritage",
             source_submission.desired_start as "desiredStart",
             source_submission.description as "description",
             source_submission.material_links as "materialLinks",
             source_submission.selected_case_ids as "selectedCaseIds",
             source_submission.phone as "contactPhone",
             source_submission.email as "contactEmail",
             source_submission.tracker_part_key as "partnerKey",
             source_submission.tracker_crm_key as "crmKey"
      from ${submissions} as source_submission
      where source_submission.id = ${submissionDatabaseId}
        and source_submission.status <> 'cancelled'
      limit 1
    `);
    const row = firstRow(submissionResult);
    if (row === null) throw new TypeError('Tracker submission snapshot is unavailable');

    const documentResult = await this.#database.execute(sql`
      select source_document.id as "id",
             source_document.original_name as "originalName",
             source_document.mime_type as "mimeType",
             source_document.size_bytes as "sizeBytes",
             source_document.sha256 as "sha256"
      from ${documents} as source_document
      where source_document.submission_id = ${submissionDatabaseId}
        and source_document.scan_status = 'clean'
        and source_document.deleted_at is null
      order by source_document.created_at, source_document.id
    `);

    const snapshot: TrackerSubmissionSnapshot = {
      areaSquareMeters: decimalString(row.areaSquareMeters),
      city: nullableString(row.city, 'city'),
      contactEmail: requiredString(row.contactEmail, 'contact email'),
      contactName: requiredString(row.contactName, 'contact name'),
      contactPhone: requiredString(row.contactPhone, 'contact phone'),
      culturalHeritage: nullableBoolean(row.culturalHeritage, 'cultural heritage flag'),
      description: requiredString(row.description, 'submission description'),
      desiredStart: nullableString(row.desiredStart, 'desired start'),
      documents: resultRows(documentResult).map((document) => ({
        id: requiredString(document.id, 'document ID'),
        mimeType: requiredString(document.mimeType, 'document MIME type'),
        originalName: requiredString(document.originalName, 'document name'),
        sha256: requiredString(document.sha256, 'document SHA-256'),
        sizeBytes: requiredPositiveInteger(document.sizeBytes, 'document size'),
      })),
      expertiseRequired: nullableBoolean(row.expertiseRequired, 'expertise flag'),
      inn: nullableString(row.inn, 'INN'),
      materialLinks: requiredStringArray(row.materialLinks, 'material links'),
      maxUserId: maxUserId(row.maxUserId),
      objectCount: requiredPositiveInteger(row.objectCount, 'object count'),
      objectType: requiredString(row.objectType, 'object type'),
      organization: nullableString(row.organization, 'organization'),
      projectScope: projectScope(row.projectScope),
      projectStage: requiredString(row.projectStage, 'project stage'),
      region: nullableString(row.region, 'region'),
      role: requiredString(row.role, 'customer role'),
      selectedCaseIds: requiredStringArray(row.selectedCaseIds, 'selected case IDs'),
      services: requiredStringArray(row.services, 'services'),
      submissionId: requiredString(row.submissionId, 'submission ID'),
    };

    return {
      dependencies: {
        crmKey: dependencyIssueKey(row.crmKey, 'CRM key'),
        partnerKey: dependencyIssueKey(row.partnerKey, 'PART key'),
      },
      submission: snapshot,
    };
  }

  public async completeTrackerOperation(
    claim: ClaimedTrackerOperation,
    resultKey: string,
    now: Date,
  ): Promise<void> {
    validDate(now, 'Tracker completion time');
    const issueKey = requiredIssueKey(resultKey);
    await this.#database.transaction(async (transaction) => {
      const completed = await transaction.execute(sql`
        update ${integrationOutbox}
        set status = 'completed',
            lease_token = null,
            lease_expires_at = null,
            result_key = ${issueKey},
            last_error_code = null,
            last_error_at = null,
            completed_at = ${now},
            updated_at = ${now}
        where id = ${claim.id}
          and status = 'processing'
          and attempts = ${claim.attempts}
          and lease_token = ${claim.leaseToken}
      `);
      if (affectedRows(completed) !== 1) throw new Error('Tracker operation claim lease was lost');

      const trackerKeyUpdate =
        claim.operation === 'upsert_partner'
          ? sql`tracker_part_key = ${issueKey}`
          : claim.operation === 'create_crm'
            ? sql`tracker_crm_key = ${issueKey}`
            : sql`tracker_docs_key = ${issueKey}`;
      const updatedSubmission = await transaction.execute(sql`
        update ${submissions} as synchronized_submission
        set ${trackerKeyUpdate},
            status = case
              when exists (
                select 1 from ${integrationOutbox} as failed_operation
                where failed_operation.submission_id = synchronized_submission.id
                  and failed_operation.status = 'dead_letter'
              ) then 'sync_failed'::submission_status
              when exists (
                select 1 from ${integrationOutbox} as remaining_operation
                where remaining_operation.submission_id = synchronized_submission.id
                  and remaining_operation.status <> 'completed'
              ) then 'syncing'::submission_status
              else 'synced'::submission_status
            end,
            updated_at = ${now}
        where synchronized_submission.id = ${claim.submissionDatabaseId}
          and synchronized_submission.status <> 'cancelled'
      `);
      if (affectedRows(updatedSubmission) !== 1) {
        throw new Error('Tracker submission status update was lost');
      }
    });
  }

  public async failTrackerOperation(
    claim: ClaimedTrackerOperation,
    errorCode: string,
    retryAt: Date | null,
    now: Date,
  ): Promise<void> {
    validDate(now, 'Tracker failure time');
    if (retryAt !== null) validDate(retryAt, 'Tracker retry time');
    const normalizedErrorCode = safeErrorCode(errorCode);
    const nextStatus = retryAt === null ? 'dead_letter' : 'retry';
    const nextAttemptAt = retryAt ?? now;

    await this.#database.transaction(async (transaction) => {
      const failed = await transaction.execute(sql`
        update ${integrationOutbox}
        set status = ${nextStatus}::integration_outbox_status,
            next_attempt_at = ${nextAttemptAt},
            lease_token = null,
            lease_expires_at = null,
            result_key = null,
            last_error_code = ${normalizedErrorCode},
            last_error_at = ${now},
            completed_at = null,
            updated_at = ${now}
        where id = ${claim.id}
          and status = 'processing'
          and attempts = ${claim.attempts}
          and lease_token = ${claim.leaseToken}
      `);
      if (affectedRows(failed) !== 1) throw new Error('Tracker operation claim lease was lost');

      if (retryAt === null) {
        await transaction.execute(sql`
          update ${integrationOutbox}
          set status = 'dead_letter',
              next_attempt_at = ${now},
              lease_token = null,
              lease_expires_at = null,
              result_key = null,
              last_error_code = 'tracker_dependency_failed',
              last_error_at = ${now},
              completed_at = null,
              updated_at = ${now}
          where submission_id = ${claim.submissionDatabaseId}
            and id <> ${claim.id}
            and status in ('pending', 'retry')
        `);
      }

      const submissionStatus = retryAt === null ? 'sync_failed' : 'syncing';
      const updatedSubmission = await transaction.execute(sql`
        update ${submissions}
        set status = ${submissionStatus}::submission_status, updated_at = ${now}
        where id = ${claim.submissionDatabaseId}
          and status <> 'cancelled'
      `);
      if (affectedRows(updatedSubmission) !== 1) {
        throw new Error('Tracker submission status update was lost');
      }
    });
  }
}
