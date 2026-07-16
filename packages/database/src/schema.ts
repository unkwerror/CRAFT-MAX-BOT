import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export type JsonValue = boolean | null | number | string | JsonValue[] | JsonObject;

export interface JsonObject {
  [key: string]: JsonValue;
}

export const customerRoleEnum = pgEnum('customer_role', [
  'developer',
  'investor',
  'government_customer',
  'property_owner',
  'general_contractor',
  'other',
]);

export const projectScopeEnum = pgEnum('project_scope', ['single_object', 'portfolio']);

export const submissionStatusEnum = pgEnum('submission_status', [
  'received',
  'syncing',
  'synced',
  'sync_failed',
  'cancelled',
]);

export const documentScanStatusEnum = pgEnum('document_scan_status', [
  'pending',
  'scanning',
  'clean',
  'infected',
  'failed',
]);

export const webhookInboxStatusEnum = pgEnum('webhook_inbox_status', [
  'pending',
  'processing',
  'retry',
  'processed',
  'dead_letter',
]);

export const botDialogStatusEnum = pgEnum('bot_dialog_status', ['active', 'stopped']);

export const botInquiryStatusEnum = pgEnum('bot_inquiry_status', [
  'received',
  'forwarded',
  'closed',
]);

export const maxBotOutboxActionEnum = pgEnum('max_bot_outbox_action', [
  'send_message',
  'answer_callback',
]);

export const maxBotOutboxStatusEnum = pgEnum('max_bot_outbox_status', [
  'pending',
  'processing',
  'retry',
  'completed',
  'dead_letter',
]);

export const integrationOperationEnum = pgEnum('integration_operation', [
  'upsert_partner',
  'create_crm',
  'create_docs',
]);

export const integrationOutboxStatusEnum = pgEnum('integration_outbox_status', [
  'pending',
  'processing',
  'retry',
  'completed',
  'dead_letter',
]);

const emptyJsonObject = sql`'{}'::jsonb`;
const emptyTextArray = sql`ARRAY[]::text[]`;

export const maxUsers = pgTable(
  'max_users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    maxUserId: bigint('max_user_id', { mode: 'bigint' }).notNull(),
    firstName: varchar('first_name', { length: 255 }).notNull(),
    lastName: varchar('last_name', { length: 255 }),
    username: varchar('username', { length: 255 }),
    languageCode: varchar('language_code', { length: 35 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique('max_users_max_user_id_unique').on(table.maxUserId),
    check('max_users_max_user_id_positive', sql`${table.maxUserId} > 0`),
    check('max_users_first_name_not_blank', sql`char_length(btrim(${table.firstName})) > 0`),
    check(
      'max_users_optional_names_not_blank',
      sql`(${table.lastName} is null or char_length(btrim(${table.lastName})) > 0)
        and (${table.username} is null or char_length(btrim(${table.username})) > 0)`,
    ),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    maxUserId: bigint('max_user_id', { mode: 'bigint' })
      .notNull()
      .references(() => maxUsers.maxUserId, {
        onDelete: 'cascade',
        onUpdate: 'cascade',
      }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    verifiedPhone: varchar('verified_phone', { length: 16 }),
    phoneVerifiedAt: timestamp('phone_verified_at', { withTimezone: true }),
    startParam: varchar('start_param', { length: 128 }),
    consentVersion: varchar('consent_version', { length: 64 }).notNull(),
    consentTextHash: varchar('consent_text_hash', { length: 64 }).notNull(),
    consentClientAcceptedAt: timestamp('consent_client_accepted_at', {
      withTimezone: true,
    }).notNull(),
    consentedAt: timestamp('consented_at', { withTimezone: true }).notNull(),
    termsVersion: varchar('terms_version', { length: 64 }).notNull(),
    termsTextHash: varchar('terms_text_hash', { length: 64 }).notNull(),
    termsClientAcceptedAt: timestamp('terms_client_accepted_at', { withTimezone: true }).notNull(),
    termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('sessions_token_hash_unique').on(table.tokenHash),
    index('sessions_active_user_expiry_idx')
      .on(table.maxUserId, table.expiresAt)
      .where(sql`${table.revokedAt} is null`),
    index('sessions_expires_at_idx').on(table.expiresAt),
    check('sessions_expiry_after_creation', sql`${table.expiresAt} > ${table.createdAt}`),
    check('sessions_token_hash_format', sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check(
      'sessions_start_param_not_blank',
      sql`${table.startParam} is null or char_length(btrim(${table.startParam})) > 0`,
    ),
    check(
      'sessions_consent_version_format',
      sql`${table.consentVersion} ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'`,
    ),
    check('sessions_consent_text_hash_format', sql`${table.consentTextHash} ~ '^[0-9a-f]{64}$'`),
    check(
      'sessions_terms_version_format',
      sql`${table.termsVersion} ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'`,
    ),
    check('sessions_terms_text_hash_format', sql`${table.termsTextHash} ~ '^[0-9a-f]{64}$'`),
    check(
      'sessions_revocation_after_creation',
      sql`${table.revokedAt} is null or ${table.revokedAt} >= ${table.createdAt}`,
    ),
    check(
      'sessions_verified_phone_format',
      sql`${table.verifiedPhone} is null or ${table.verifiedPhone} ~ '^\\+[1-9][0-9]{7,14}$'`,
    ),
    check(
      'sessions_verified_contact_consistent',
      sql`(${table.verifiedPhone} is null and ${table.phoneVerifiedAt} is null)
        or (${table.verifiedPhone} is not null and ${table.phoneVerifiedAt} is not null)`,
    ),
    check(
      'sessions_phone_verification_within_lifetime',
      sql`${table.phoneVerifiedAt} is null
        or (${table.phoneVerifiedAt} >= ${table.createdAt}
          and ${table.phoneVerifiedAt} < ${table.expiresAt})`,
    ),
  ],
);

export const leadDrafts = pgTable(
  'lead_drafts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    maxUserId: bigint('max_user_id', { mode: 'bigint' })
      .notNull()
      .references(() => maxUsers.maxUserId, {
        onDelete: 'cascade',
        onUpdate: 'cascade',
      }),
    currentStep: integer('current_step').default(1).notNull(),
    payload: jsonb('payload').$type<JsonObject>().default(emptyJsonObject).notNull(),
    source: varchar('source', { length: 128 }).default('direct').notNull(),
    consentVersion: varchar('consent_version', { length: 64 }).notNull(),
    consentTextHash: varchar('consent_text_hash', { length: 64 }).notNull(),
    consentedAt: timestamp('consented_at', { withTimezone: true }).notNull(),
    termsVersion: varchar('terms_version', { length: 64 }).notNull(),
    termsTextHash: varchar('terms_text_hash', { length: 64 }).notNull(),
    termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    unique('lead_drafts_max_user_id_unique').on(table.maxUserId),
    index('lead_drafts_expires_at_idx').on(table.expiresAt),
    check('lead_drafts_current_step_range', sql`${table.currentStep} between 1 and 17`),
    check('lead_drafts_source_not_blank', sql`char_length(btrim(${table.source})) > 0`),
    check(
      'lead_drafts_consent_version_format',
      sql`${table.consentVersion} ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'`,
    ),
    check('lead_drafts_consent_text_hash_format', sql`${table.consentTextHash} ~ '^[0-9a-f]{64}$'`),
    check(
      'lead_drafts_terms_version_format',
      sql`${table.termsVersion} ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'`,
    ),
    check('lead_drafts_terms_text_hash_format', sql`${table.termsTextHash} ~ '^[0-9a-f]{64}$'`),
    check('lead_drafts_expiry_after_creation', sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export const submissions = pgTable(
  'submissions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    submissionId: varchar('submission_id', { length: 64 }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    maxUserId: bigint('max_user_id', { mode: 'bigint' })
      .notNull()
      .references(() => maxUsers.maxUserId, {
        onDelete: 'restrict',
        onUpdate: 'cascade',
      }),
    customerRole: customerRoleEnum('customer_role').notNull(),
    contactName: varchar('contact_name', { length: 255 }).notNull(),
    organization: varchar('organization', { length: 255 }),
    inn: varchar('inn', { length: 12 }),
    objectType: varchar('object_type', { length: 255 }).notNull(),
    city: varchar('city', { length: 255 }),
    region: varchar('region', { length: 255 }),
    projectScope: projectScopeEnum('project_scope').notNull(),
    objectCount: integer('object_count').default(1).notNull(),
    areaSqm: numeric('area_sqm', { precision: 14, scale: 2 }),
    projectStage: varchar('project_stage', { length: 255 }).notNull(),
    services: text('services').array().notNull(),
    needsExpertise: boolean('needs_expertise'),
    isCulturalHeritage: boolean('is_cultural_heritage'),
    desiredStart: varchar('desired_start', { length: 128 }),
    description: text('description').notNull(),
    materialLinks: text('material_links').array().default(emptyTextArray).notNull(),
    selectedCaseIds: text('selected_case_ids').array().default(emptyTextArray).notNull(),
    phone: varchar('phone', { length: 32 }).notNull(),
    phoneVerified: boolean('phone_verified').default(false).notNull(),
    email: varchar('email', { length: 320 }).notNull(),
    consentVersion: varchar('consent_version', { length: 64 }).notNull(),
    consentTextHash: varchar('consent_text_hash', { length: 64 }).notNull(),
    consentedAt: timestamp('consented_at', { withTimezone: true }).notNull(),
    termsVersion: varchar('terms_version', { length: 64 }).notNull(),
    termsTextHash: varchar('terms_text_hash', { length: 64 }).notNull(),
    termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }).notNull(),
    source: varchar('source', { length: 128 }).default('direct').notNull(),
    status: submissionStatusEnum('status').default('received').notNull(),
    trackerCrmKey: varchar('tracker_crm_key', { length: 64 }),
    trackerPartKey: varchar('tracker_part_key', { length: 64 }),
    trackerDocsKey: varchar('tracker_docs_key', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique('submissions_submission_id_unique').on(table.submissionId),
    unique('submissions_id_user_unique').on(table.id, table.maxUserId),
    unique('submissions_user_idempotency_key_unique').on(table.maxUserId, table.idempotencyKey),
    index('submissions_user_created_at_idx').on(table.maxUserId, table.createdAt),
    index('submissions_pending_sync_idx')
      .on(table.status, table.createdAt)
      .where(sql`${table.status} in ('received', 'syncing', 'sync_failed')`),
    uniqueIndex('submissions_tracker_crm_key_uidx')
      .on(table.trackerCrmKey)
      .where(sql`${table.trackerCrmKey} is not null`),
    index('submissions_tracker_part_key_idx')
      .on(table.trackerPartKey)
      .where(sql`${table.trackerPartKey} is not null`),
    uniqueIndex('submissions_tracker_docs_key_uidx')
      .on(table.trackerDocsKey)
      .where(sql`${table.trackerDocsKey} is not null`),
    check(
      'submissions_submission_id_format',
      sql`${table.submissionId} ~ '^[A-Z0-9][A-Z0-9-]{5,63}$'`,
    ),
    check(
      'submissions_idempotency_key_format',
      sql`${table.idempotencyKey} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'`,
    ),
    check('submissions_request_hash_format', sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`),
    check('submissions_consent_text_hash_format', sql`${table.consentTextHash} ~ '^[0-9a-f]{64}$'`),
    check(
      'submissions_terms_version_format',
      sql`${table.termsVersion} ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'`,
    ),
    check('submissions_terms_text_hash_format', sql`${table.termsTextHash} ~ '^[0-9a-f]{64}$'`),
    check('submissions_contact_name_not_blank', sql`char_length(btrim(${table.contactName})) > 0`),
    check(
      'submissions_location_present',
      sql`(${table.city} is null or char_length(btrim(${table.city})) > 0)
        and (${table.region} is null or char_length(btrim(${table.region})) > 0)
        and (${table.city} is not null or ${table.region} is not null)`,
    ),
    check(
      'submissions_inn_format',
      sql`${table.inn} is null or ${table.inn} ~ '^[0-9]{10}([0-9]{2})?$'`,
    ),
    check(
      'submissions_object_count_valid',
      sql`${table.objectCount} >= 1
        and (${table.projectScope} <> 'single_object' or ${table.objectCount} = 1)`,
    ),
    check('submissions_area_positive', sql`${table.areaSqm} is null or ${table.areaSqm} > 0`),
    check('submissions_services_not_empty', sql`cardinality(${table.services}) > 0`),
    check('submissions_selected_cases_limit', sql`cardinality(${table.selectedCaseIds}) <= 10`),
    check('submissions_description_not_blank', sql`char_length(btrim(${table.description})) > 0`),
    check('submissions_phone_not_blank', sql`char_length(btrim(${table.phone})) > 0`),
    check('submissions_email_not_blank', sql`char_length(btrim(${table.email})) > 0`),
    check(
      'submissions_consent_version_not_blank',
      sql`char_length(btrim(${table.consentVersion})) > 0`,
    ),
    check('submissions_source_not_blank', sql`char_length(btrim(${table.source})) > 0`),
  ],
);

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    submissionId: uuid('submission_id'),
    maxUserId: bigint('max_user_id', { mode: 'bigint' })
      .notNull()
      .references(() => maxUsers.maxUserId, {
        onDelete: 'restrict',
        onUpdate: 'cascade',
      }),
    originalName: text('original_name').notNull(),
    storageKey: text('storage_key').notNull(),
    mimeType: varchar('mime_type', { length: 255 }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    scanStatus: documentScanStatusEnum('scan_status').default('pending').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    stagedExpiresAt: timestamp('staged_expires_at', { withTimezone: true }).notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: 'documents_submission_owner_fk',
      columns: [table.submissionId, table.maxUserId],
      foreignColumns: [submissions.id, submissions.maxUserId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),
    unique('documents_storage_key_unique').on(table.storageKey),
    unique('documents_submission_sha256_unique').on(table.submissionId, table.sha256),
    uniqueIndex('documents_staged_user_sha256_uidx')
      .on(table.maxUserId, table.sha256)
      .where(sql`${table.submissionId} is null and ${table.deletedAt} is null`),
    index('documents_active_submission_idx')
      .on(table.submissionId, table.createdAt)
      .where(sql`${table.deletedAt} is null`),
    index('documents_pending_scan_idx')
      .on(table.scanStatus, table.createdAt)
      .where(sql`${table.scanStatus} in ('pending', 'scanning')`),
    index('documents_staged_expiry_idx')
      .on(table.stagedExpiresAt)
      .where(sql`${table.submissionId} is null and ${table.deletedAt} is null`),
    check(
      'documents_original_name_safe',
      sql`char_length(btrim(${table.originalName})) > 0
        and position('/' in ${table.originalName}) = 0
        and position(chr(92) in ${table.originalName}) = 0`,
    ),
    check(
      'documents_storage_key_safe',
      sql`char_length(btrim(${table.storageKey})) > 0
        and left(${table.storageKey}, 1) <> '/'
        and position('..' in ${table.storageKey}) = 0
        and position(chr(92) in ${table.storageKey}) = 0`,
    ),
    check('documents_mime_type_not_blank', sql`char_length(btrim(${table.mimeType})) > 0`),
    check('documents_size_positive', sql`${table.sizeBytes} > 0`),
    check('documents_sha256_format', sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
    check(
      'documents_deletion_after_creation',
      sql`${table.deletedAt} is null or ${table.deletedAt} >= ${table.createdAt}`,
    ),
    check(
      'documents_staged_expiry_after_creation',
      sql`${table.submissionId} is not null or ${table.stagedExpiresAt} > ${table.createdAt}`,
    ),
  ],
);

export const webhookInbox = pgTable(
  'webhook_inbox',
  {
    eventKey: varchar('event_key', { length: 255 }).primaryKey(),
    eventType: varchar('event_type', { length: 128 }).notNull(),
    chatId: bigint('chat_id', { mode: 'bigint' }),
    payload: jsonb('payload').$type<JsonObject>().notNull(),
    status: webhookInboxStatusEnum('status').default('pending').notNull(),
    attempts: integer('attempts').default(0).notNull(),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow().notNull(),
    lastErrorCode: varchar('last_error_code', { length: 128 }),
    receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (table) => [
    index('webhook_inbox_ready_idx')
      .on(table.status, table.nextAttemptAt, table.receivedAt)
      .where(sql`${table.status} in ('pending', 'retry')`),
    index('webhook_inbox_chat_order_idx').on(table.chatId, table.receivedAt),
    check('webhook_inbox_event_key_not_blank', sql`char_length(btrim(${table.eventKey})) > 0`),
    check('webhook_inbox_event_type_not_blank', sql`char_length(btrim(${table.eventType})) > 0`),
    check('webhook_inbox_attempts_nonnegative', sql`${table.attempts} >= 0`),
    check(
      'webhook_inbox_processed_at_matches_status',
      sql`(${table.status} = 'processed' and ${table.processedAt} is not null)
        or (${table.status} <> 'processed' and ${table.processedAt} is null)`,
    ),
  ],
);

export const botDialogs = pgTable(
  'bot_dialogs',
  {
    chatId: bigint('chat_id', { mode: 'bigint' }).primaryKey(),
    maxUserId: bigint('max_user_id', { mode: 'bigint' }),
    status: botDialogStatusEnum('status').default('active').notNull(),
    lastEventAt: timestamp('last_event_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('bot_dialogs_max_user_id_idx')
      .on(table.maxUserId)
      .where(sql`${table.maxUserId} is not null`),
    check('bot_dialogs_chat_id_nonzero', sql`${table.chatId} <> 0`),
    check(
      'bot_dialogs_max_user_id_positive',
      sql`${table.maxUserId} is null or ${table.maxUserId} > 0`,
    ),
  ],
);

export const botInquiries = pgTable(
  'bot_inquiries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventKey: varchar('event_key', { length: 255 }).notNull(),
    chatId: bigint('chat_id', { mode: 'bigint' })
      .notNull()
      .references(() => botDialogs.chatId, { onDelete: 'restrict', onUpdate: 'cascade' }),
    maxUserId: bigint('max_user_id', { mode: 'bigint' }),
    messageId: varchar('message_id', { length: 255 }),
    bodyText: text('body_text').notNull(),
    status: botInquiryStatusEnum('status').default('received').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique('bot_inquiries_event_key_unique').on(table.eventKey),
    uniqueIndex('bot_inquiries_message_id_uidx')
      .on(table.messageId)
      .where(sql`${table.messageId} is not null`),
    index('bot_inquiries_chat_created_at_idx').on(table.chatId, table.createdAt),
    index('bot_inquiries_status_created_at_idx').on(table.status, table.createdAt),
    check('bot_inquiries_event_key_not_blank', sql`char_length(btrim(${table.eventKey})) > 0`),
    check(
      'bot_inquiries_max_user_id_positive',
      sql`${table.maxUserId} is null or ${table.maxUserId} > 0`,
    ),
    check(
      'bot_inquiries_message_id_not_blank',
      sql`${table.messageId} is null or char_length(btrim(${table.messageId})) > 0`,
    ),
    check('bot_inquiries_body_text_not_blank', sql`char_length(btrim(${table.bodyText})) > 0`),
  ],
);

export const maxBotOutbox = pgTable(
  'max_bot_outbox',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventKey: varchar('event_key', { length: 255 }).notNull(),
    actionKey: varchar('action_key', { length: 255 }).notNull(),
    action: maxBotOutboxActionEnum('action').notNull(),
    chatId: bigint('chat_id', { mode: 'bigint' }).references(() => botDialogs.chatId, {
      onDelete: 'restrict',
      onUpdate: 'cascade',
    }),
    payload: jsonb('payload').$type<JsonObject>().default(emptyJsonObject).notNull(),
    providerMessageId: varchar('provider_message_id', { length: 255 }),
    status: maxBotOutboxStatusEnum('status').default('pending').notNull(),
    attempts: integer('attempts').default(0).notNull(),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow().notNull(),
    lastErrorCode: varchar('last_error_code', { length: 128 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    unique('max_bot_outbox_action_key_unique').on(table.actionKey),
    uniqueIndex('max_bot_outbox_provider_message_id_uidx')
      .on(table.providerMessageId)
      .where(sql`${table.providerMessageId} is not null`),
    index('max_bot_outbox_ready_idx')
      .on(table.status, table.nextAttemptAt, table.createdAt)
      .where(sql`${table.status} in ('pending', 'retry')`),
    index('max_bot_outbox_chat_order_idx').on(table.chatId, table.createdAt, table.id),
    check('max_bot_outbox_event_key_not_blank', sql`char_length(btrim(${table.eventKey})) > 0`),
    check('max_bot_outbox_action_key_not_blank', sql`char_length(btrim(${table.actionKey})) > 0`),
    check('max_bot_outbox_payload_object', sql`jsonb_typeof(${table.payload}) = 'object'`),
    check(
      'max_bot_outbox_provider_message_id_not_blank',
      sql`${table.providerMessageId} is null or char_length(btrim(${table.providerMessageId})) > 0`,
    ),
    check('max_bot_outbox_attempts_nonnegative', sql`${table.attempts} >= 0`),
    check(
      'max_bot_outbox_chat_id_matches_action',
      sql`(${table.action} = 'send_message' and ${table.chatId} is not null)
        or ${table.action} = 'answer_callback'`,
    ),
    check(
      'max_bot_outbox_completed_at_matches_status',
      sql`(${table.status} = 'completed' and ${table.completedAt} is not null)
        or (${table.status} <> 'completed' and ${table.completedAt} is null)`,
    ),
  ],
);

export const integrationOutbox = pgTable(
  'integration_outbox',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => submissions.id, { onDelete: 'cascade' }),
    operation: integrationOperationEnum('operation').notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull(),
    payload: jsonb('payload').$type<JsonObject>().default(emptyJsonObject).notNull(),
    status: integrationOutboxStatusEnum('status').default('pending').notNull(),
    attempts: integer('attempts').default(0).notNull(),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow().notNull(),
    lastErrorCode: varchar('last_error_code', { length: 128 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    unique('integration_outbox_idempotency_key_unique').on(table.idempotencyKey),
    unique('integration_outbox_submission_operation_unique').on(
      table.submissionId,
      table.operation,
    ),
    index('integration_outbox_ready_idx')
      .on(table.status, table.nextAttemptAt, table.createdAt)
      .where(sql`${table.status} in ('pending', 'retry')`),
    index('integration_outbox_submission_idx').on(table.submissionId),
    check(
      'integration_outbox_idempotency_key_not_blank',
      sql`char_length(btrim(${table.idempotencyKey})) > 0`,
    ),
    check('integration_outbox_attempts_nonnegative', sql`${table.attempts} >= 0`),
    check(
      'integration_outbox_completed_at_matches_status',
      sql`(${table.status} = 'completed' and ${table.completedAt} is not null)
        or (${table.status} <> 'completed' and ${table.completedAt} is null)`,
    ),
  ],
);

export const maxUsersRelations = relations(maxUsers, ({ many }) => ({
  sessions: many(sessions),
  leadDrafts: many(leadDrafts),
  submissions: many(submissions),
  documents: many(documents),
}));

export const botDialogsRelations = relations(botDialogs, ({ many }) => ({
  inquiries: many(botInquiries),
  outboundActions: many(maxBotOutbox),
}));

export const botInquiriesRelations = relations(botInquiries, ({ one }) => ({
  dialog: one(botDialogs, {
    fields: [botInquiries.chatId],
    references: [botDialogs.chatId],
  }),
}));

export const maxBotOutboxRelations = relations(maxBotOutbox, ({ one }) => ({
  dialog: one(botDialogs, {
    fields: [maxBotOutbox.chatId],
    references: [botDialogs.chatId],
  }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  maxUser: one(maxUsers, {
    fields: [sessions.maxUserId],
    references: [maxUsers.maxUserId],
  }),
}));

export const leadDraftsRelations = relations(leadDrafts, ({ one }) => ({
  maxUser: one(maxUsers, {
    fields: [leadDrafts.maxUserId],
    references: [maxUsers.maxUserId],
  }),
}));

export const submissionsRelations = relations(submissions, ({ many, one }) => ({
  maxUser: one(maxUsers, {
    fields: [submissions.maxUserId],
    references: [maxUsers.maxUserId],
  }),
  documents: many(documents),
  integrationOperations: many(integrationOutbox),
}));

export const documentsRelations = relations(documents, ({ one }) => ({
  maxUser: one(maxUsers, {
    fields: [documents.maxUserId],
    references: [maxUsers.maxUserId],
  }),
  submission: one(submissions, {
    fields: [documents.submissionId],
    references: [submissions.id],
  }),
}));

export const integrationOutboxRelations = relations(integrationOutbox, ({ one }) => ({
  submission: one(submissions, {
    fields: [integrationOutbox.submissionId],
    references: [submissions.id],
  }),
}));
