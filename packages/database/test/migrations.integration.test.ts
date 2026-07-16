import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

interface MigrationJournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface MigrationJournal {
  version: string;
  dialect: string;
  entries: MigrationJournalEntry[];
}

const databaseUrl = process.env.DATABASE_URL;
const destructiveTestEnabled = process.env.MIGRATION_TEST_ALLOW_DESTRUCTIVE === 'true';
const describeWithDatabase =
  databaseUrl !== undefined && destructiveTestEnabled ? describe : describe.skip;
const migrationFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const migrationJournal = JSON.parse(
  readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'),
) as MigrationJournal;

const initialEntry = migrationJournal.entries.find(({ tag }) => tag === '0000_initial');
const runtimeEntry = migrationJournal.entries.find(({ tag }) => tag === '0001_stage3_runtime');
const botWebhookEntry = migrationJournal.entries.find(
  ({ tag }) => tag === '0002_stage4_bot_webhook',
);

if (initialEntry === undefined || runtimeEntry === undefined || botWebhookEntry === undefined) {
  throw new Error(
    'Expected 0000_initial, 0001_stage3_runtime and 0002_stage4_bot_webhook migration journal entries',
  );
}

const initialSqlUrl = new URL('../drizzle/0000_initial.sql', import.meta.url);
const runtimeSqlUrl = new URL('../drizzle/0001_stage3_runtime.sql', import.meta.url);
const botWebhookSqlUrl = new URL('../drizzle/0002_stage4_bot_webhook.sql', import.meta.url);
const initialMigrationSql = readFileSync(initialSqlUrl, 'utf8');
const runtimeMigrationSql = readFileSync(runtimeSqlUrl, 'utf8');
const botWebhookMigrationSql = readFileSync(botWebhookSqlUrl, 'utf8');
const initialMigrationHash = createHash('sha256').update(initialMigrationSql).digest('hex');
const runtimeMigrationHash = createHash('sha256').update(runtimeMigrationSql).digest('hex');
const botWebhookMigrationHash = createHash('sha256').update(botWebhookMigrationSql).digest('hex');
const initialDownMigration = readFileSync(
  new URL('../drizzle/rollback/0000_initial.down.sql', import.meta.url),
  'utf8',
);
const runtimeDownMigration = readFileSync(
  new URL('../drizzle/rollback/0001_stage3_runtime.down.sql', import.meta.url),
  'utf8',
);
const botWebhookDownMigration = readFileSync(
  new URL('../drizzle/rollback/0002_stage4_bot_webhook.down.sql', import.meta.url),
  'utf8',
);
const sessionEvidenceColumns = `
  "consent_version", "consent_text_hash", "consent_client_accepted_at", "consented_at",
  "terms_version", "terms_text_hash", "terms_client_accepted_at", "terms_accepted_at"`;
const sessionEvidenceValues = `
  'test-v1', repeat('e', 64), now(), now(),
  'test-v1', repeat('f', 64), now(), now()`;
const submissionEvidenceColumns = `
  "consent_text_hash", "terms_version", "terms_text_hash", "terms_accepted_at"`;
const submissionEvidenceValues = `
  repeat('a', 64), 'test-v1', repeat('b', 64), now()`;

function makeInitialMigrationFolder(): string {
  const directory = mkdtempSync(join(tmpdir(), 'craft72-initial-migration-'));
  const metaDirectory = join(directory, 'meta');
  mkdirSync(metaDirectory);
  copyFileSync(fileURLToPath(initialSqlUrl), join(directory, '0000_initial.sql'));
  writeFileSync(
    join(metaDirectory, '_journal.json'),
    `${JSON.stringify({ ...migrationJournal, entries: [initialEntry] }, undefined, 2)}\n`,
  );
  return directory;
}

describe('migration rollback metadata', () => {
  it('anchors the initial rollback to its generated migration ledger entry', () => {
    expect(initialDownMigration).toContain(`WHERE "created_at" = ${initialEntry.when}`);
    expect(initialDownMigration).toContain(`AND "hash" = '${initialMigrationHash}'`);
    expect(initialDownMigration).toContain(
      'Initial rollback refused: unexpected migration ledger entries exist',
    );
  });

  it('anchors the Stage 3 rollback to both known migrations and refuses newer entries', () => {
    expect(runtimeDownMigration).toContain(`WHERE "created_at" = ${initialEntry.when}`);
    expect(runtimeDownMigration).toContain(`AND "hash" = '${initialMigrationHash}'`);
    expect(runtimeDownMigration).toContain(`WHERE "created_at" = ${runtimeEntry.when}`);
    expect(runtimeDownMigration).toContain(`AND "hash" = '${runtimeMigrationHash}'`);
    expect(runtimeDownMigration).toContain(
      'Stage 3 rollback refused: unexpected migration ledger entries exist',
    );
  });

  it('anchors the Stage 4 bot rollback to all known migrations and refuses newer entries', () => {
    expect(botWebhookDownMigration).toContain(`WHERE "created_at" = ${initialEntry.when}`);
    expect(botWebhookDownMigration).toContain(`AND "hash" = '${initialMigrationHash}'`);
    expect(botWebhookDownMigration).toContain(`WHERE "created_at" = ${runtimeEntry.when}`);
    expect(botWebhookDownMigration).toContain(`AND "hash" = '${runtimeMigrationHash}'`);
    expect(botWebhookDownMigration).toContain(`WHERE "created_at" = ${botWebhookEntry.when}`);
    expect(botWebhookDownMigration).toContain(`AND "hash" = '${botWebhookMigrationHash}'`);
    expect(botWebhookDownMigration).toContain(
      'Stage 4 bot rollback refused: unexpected migration ledger entries exist',
    );
  });
});

describeWithDatabase('PostgreSQL migrations', () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });

  beforeAll(async () => {
    if (databaseUrl === undefined) {
      throw new Error('DATABASE_URL is required for migration integration tests');
    }

    const databaseName = new URL(databaseUrl).pathname.slice(1);
    if (!databaseName.endsWith('_test')) {
      throw new Error('Migration integration tests require a database name ending in _test');
    }

    await pool.query('select 1');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('upgrades 0000 data through Stage 4, enforces constraints and rolls back safely', async () => {
    const database = drizzle(pool);
    const initialMigrationFolder = makeInitialMigrationFolder();

    try {
      await migrate(database, { migrationsFolder: initialMigrationFolder });
    } finally {
      rmSync(initialMigrationFolder, { force: true, recursive: true });
    }

    const maxUserId = '900000000000000001';
    await pool.query(
      `insert into "public"."max_users" ("max_user_id", "first_name")
       values ($1, $2)`,
      [maxUserId, 'Migration test user'],
    );
    const legacySession = await pool.query<{ id: string }>(
      `insert into "public"."sessions" ("max_user_id", "expires_at")
       values ($1, now() + interval '1 hour')
       returning "id"`,
      [maxUserId],
    );
    const legacySubmission = await pool.query<{ id: string }>(
      `insert into "public"."submissions" (
         "submission_id", "idempotency_key", "max_user_id", "customer_role",
         "contact_name", "object_type", "city", "project_scope", "object_count",
         "project_stage", "services", "description", "phone", "email",
         "consent_version", "consented_at"
       ) values (
         'TEST-0001', 'request:0001', $1, 'developer',
         'Migration test user', 'Office', 'Tyumen', 'single_object', 1,
         'Concept', ARRAY['design'], 'Legacy submission', '+79991234567',
         'migration@example.test', 'test-v1', now()
       )
       returning "id"`,
      [maxUserId],
    );

    await migrate(database, { migrationsFolder: migrationFolder });

    const createdTables = await pool.query<{ table_name: string }>(
      `select table_name
         from information_schema.tables
        where table_schema = 'public'
          and table_name = any($1::text[])
        order by table_name`,
      [
        [
          'bot_dialogs',
          'bot_inquiries',
          'documents',
          'integration_outbox',
          'lead_drafts',
          'max_bot_outbox',
          'max_users',
          'sessions',
          'submissions',
          'webhook_inbox',
        ],
      ],
    );
    expect(createdTables.rows.map(({ table_name: tableName }) => tableName)).toEqual([
      'bot_dialogs',
      'bot_inquiries',
      'documents',
      'integration_outbox',
      'lead_drafts',
      'max_bot_outbox',
      'max_users',
      'sessions',
      'submissions',
      'webhook_inbox',
    ]);

    const stageThreeColumns = await pool.query<{
      table_name: string;
      column_name: string;
      is_nullable: 'NO' | 'YES';
      character_maximum_length: number;
    }>(
      `select table_name, column_name, is_nullable, character_maximum_length
         from information_schema.columns
        where table_schema = 'public'
          and (table_name, column_name) in (
            ('sessions', 'token_hash'),
            ('sessions', 'start_param'),
            ('submissions', 'request_hash')
          )
        order by table_name, ordinal_position`,
    );
    expect(stageThreeColumns.rows).toEqual([
      {
        table_name: 'sessions',
        column_name: 'token_hash',
        is_nullable: 'NO',
        character_maximum_length: 64,
      },
      {
        table_name: 'sessions',
        column_name: 'start_param',
        is_nullable: 'YES',
        character_maximum_length: 128,
      },
      {
        table_name: 'submissions',
        column_name: 'request_hash',
        is_nullable: 'NO',
        character_maximum_length: 64,
      },
    ]);

    const consentColumns = await pool.query<{
      column_name: string;
      is_nullable: 'NO' | 'YES';
    }>(
      `select column_name, is_nullable
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'sessions'
          and column_name = any($1::text[])
        order by ordinal_position`,
      [
        [
          'consent_version',
          'consent_text_hash',
          'consent_client_accepted_at',
          'consented_at',
          'terms_version',
          'terms_text_hash',
          'terms_client_accepted_at',
          'terms_accepted_at',
        ],
      ],
    );
    expect(consentColumns.rows).toEqual([
      { column_name: 'consent_version', is_nullable: 'NO' },
      { column_name: 'consent_text_hash', is_nullable: 'NO' },
      { column_name: 'consent_client_accepted_at', is_nullable: 'NO' },
      { column_name: 'consented_at', is_nullable: 'NO' },
      { column_name: 'terms_version', is_nullable: 'NO' },
      { column_name: 'terms_text_hash', is_nullable: 'NO' },
      { column_name: 'terms_client_accepted_at', is_nullable: 'NO' },
      { column_name: 'terms_accepted_at', is_nullable: 'NO' },
    ]);

    const stageThreeConstraints = await pool.query<{ conname: string }>(
      `select constraint_definition.conname
         from pg_constraint as constraint_definition
         join pg_class as relation on relation.oid = constraint_definition.conrelid
         join pg_namespace as namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'public'
          and relation.relname = any($1::text[])
          and constraint_definition.conname = any($2::text[])
        order by constraint_definition.conname`,
      [
        ['lead_drafts', 'sessions', 'submissions'],
        [
          'lead_drafts_consent_text_hash_format',
          'lead_drafts_consent_version_format',
          'lead_drafts_terms_text_hash_format',
          'lead_drafts_terms_version_format',
          'sessions_start_param_not_blank',
          'sessions_consent_text_hash_format',
          'sessions_consent_version_format',
          'sessions_terms_text_hash_format',
          'sessions_terms_version_format',
          'sessions_token_hash_format',
          'sessions_token_hash_unique',
          'submissions_request_hash_format',
          'submissions_consent_text_hash_format',
          'submissions_terms_text_hash_format',
          'submissions_terms_version_format',
        ],
      ],
    );
    expect(stageThreeConstraints.rows.map(({ conname }) => conname)).toEqual([
      'lead_drafts_consent_text_hash_format',
      'lead_drafts_consent_version_format',
      'lead_drafts_terms_text_hash_format',
      'lead_drafts_terms_version_format',
      'sessions_consent_text_hash_format',
      'sessions_consent_version_format',
      'sessions_start_param_not_blank',
      'sessions_terms_text_hash_format',
      'sessions_terms_version_format',
      'sessions_token_hash_format',
      'sessions_token_hash_unique',
      'submissions_consent_text_hash_format',
      'submissions_request_hash_format',
      'submissions_terms_text_hash_format',
      'submissions_terms_version_format',
    ]);

    const backfilledSession = await pool.query<{ consent_version: string; token_hash: string }>(
      `select "token_hash", "consent_version"
         from "public"."sessions"
        where "id" = $1`,
      [legacySession.rows[0]?.id],
    );
    const backfilledSubmission = await pool.query<{ request_hash: string }>(
      `select "request_hash"
         from "public"."submissions"
        where "id" = $1`,
      [legacySubmission.rows[0]?.id],
    );
    expect(backfilledSession.rows[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(backfilledSession.rows[0]?.consent_version).toBe('legacy-session-without-consent');
    expect(backfilledSubmission.rows[0]?.request_hash).toMatch(/^[0-9a-f]{64}$/u);

    await expect(
      pool.query(
        `insert into "public"."sessions"
           ("token_hash", "max_user_id", "expires_at", "verified_phone", ${sessionEvidenceColumns})
         values ($1, $2, now() + interval '1 hour', $3, ${sessionEvidenceValues})`,
        ['a'.repeat(64), maxUserId, '+79991234567'],
      ),
    ).rejects.toThrow();
    const verifiedSession = await pool.query<{ verified_phone: string }>(
      `insert into "public"."sessions"
         ("token_hash", "max_user_id", "expires_at", "verified_phone", "phone_verified_at",
          ${sessionEvidenceColumns})
       values ($1, $2, now() + interval '1 hour', $3, now(), ${sessionEvidenceValues})
       returning "verified_phone"`,
      ['b'.repeat(64), maxUserId, '+79991234567'],
    );
    expect(verifiedSession.rows[0]?.verified_phone).toBe('+79991234567');
    await expect(
      pool.query(
        `insert into "public"."sessions"
           ("token_hash", "max_user_id", "expires_at", ${sessionEvidenceColumns})
         values ($1, $2, now() + interval '1 hour', ${sessionEvidenceValues})`,
        ['b'.repeat(64), maxUserId],
      ),
    ).rejects.toThrow();
    await expect(
      pool.query(
        `insert into "public"."sessions"
           ("token_hash", "max_user_id", "expires_at", "start_param", ${sessionEvidenceColumns})
         values ($1, $2, now() + interval '1 hour', '   ', ${sessionEvidenceValues})`,
        ['c'.repeat(64), maxUserId],
      ),
    ).rejects.toThrow();
    await expect(
      pool.query(
        `insert into "public"."sessions"
           ("token_hash", "max_user_id", "expires_at", ${sessionEvidenceColumns})
         values ('not-a-sha256', $1, now() + interval '1 hour', ${sessionEvidenceValues})`,
        [maxUserId],
      ),
    ).rejects.toThrow();

    await expect(
      pool.query(
        `insert into "public"."submissions" (
           "submission_id", "idempotency_key", "request_hash", "max_user_id",
           "customer_role", "contact_name", "object_type", "city", "project_scope",
           "object_count", "project_stage", "services", "description", "phone",
           "email", "consent_version", "consented_at", ${submissionEvidenceColumns}
         ) values (
           'TEST-0002', 'request:0002', 'not-a-sha256', $1,
           'developer', 'Migration test user', 'Office', 'Tyumen', 'single_object',
           1, 'Concept', ARRAY['design'], 'Invalid hash submission', '+79991234567',
           'migration@example.test', 'test-v1', now(), ${submissionEvidenceValues}
         )`,
        [maxUserId],
      ),
    ).rejects.toThrow();
    const validSubmission = await pool.query<{ request_hash: string }>(
      `insert into "public"."submissions" (
         "submission_id", "idempotency_key", "request_hash", "max_user_id",
         "customer_role", "contact_name", "object_type", "city", "project_scope",
         "object_count", "project_stage", "services", "description", "phone",
         "email", "consent_version", "consented_at", ${submissionEvidenceColumns}
       ) values (
         'TEST-0003', 'request:0003', $1, $2,
         'developer', 'Migration test user', 'Office', 'Tyumen', 'single_object',
         1, 'Concept', ARRAY['design'], 'Valid hash submission', '+79991234567',
         'migration@example.test', 'test-v1', now(), ${submissionEvidenceValues}
       )
       returning "request_hash"`,
      ['d'.repeat(64), maxUserId],
    );
    expect(validSubmission.rows[0]?.request_hash).toBe('d'.repeat(64));

    const stageFourColumns = await pool.query<{
      column_name: string;
      is_nullable: 'NO' | 'YES';
      table_name: string;
    }>(
      `select table_name, column_name, is_nullable
         from information_schema.columns
        where table_schema = 'public'
          and (table_name, column_name) in (
            ('bot_dialogs', 'chat_id'),
            ('bot_dialogs', 'max_user_id'),
            ('bot_dialogs', 'last_event_at'),
            ('bot_inquiries', 'event_key'),
            ('bot_inquiries', 'chat_id'),
            ('bot_inquiries', 'max_user_id'),
            ('bot_inquiries', 'message_id'),
            ('bot_inquiries', 'body_text'),
            ('max_bot_outbox', 'event_key'),
            ('max_bot_outbox', 'action_key'),
            ('max_bot_outbox', 'chat_id'),
            ('max_bot_outbox', 'payload'),
            ('max_bot_outbox', 'provider_message_id'),
            ('max_bot_outbox', 'attempts'),
            ('max_bot_outbox', 'next_attempt_at'),
            ('max_bot_outbox', 'completed_at')
          )
        order by table_name, ordinal_position`,
    );
    expect(stageFourColumns.rows).toEqual([
      { table_name: 'bot_dialogs', column_name: 'chat_id', is_nullable: 'NO' },
      { table_name: 'bot_dialogs', column_name: 'max_user_id', is_nullable: 'YES' },
      { table_name: 'bot_dialogs', column_name: 'last_event_at', is_nullable: 'NO' },
      { table_name: 'bot_inquiries', column_name: 'event_key', is_nullable: 'NO' },
      { table_name: 'bot_inquiries', column_name: 'chat_id', is_nullable: 'NO' },
      { table_name: 'bot_inquiries', column_name: 'max_user_id', is_nullable: 'YES' },
      { table_name: 'bot_inquiries', column_name: 'message_id', is_nullable: 'YES' },
      { table_name: 'bot_inquiries', column_name: 'body_text', is_nullable: 'NO' },
      { table_name: 'max_bot_outbox', column_name: 'event_key', is_nullable: 'NO' },
      { table_name: 'max_bot_outbox', column_name: 'action_key', is_nullable: 'NO' },
      { table_name: 'max_bot_outbox', column_name: 'chat_id', is_nullable: 'YES' },
      { table_name: 'max_bot_outbox', column_name: 'payload', is_nullable: 'NO' },
      { table_name: 'max_bot_outbox', column_name: 'provider_message_id', is_nullable: 'YES' },
      { table_name: 'max_bot_outbox', column_name: 'attempts', is_nullable: 'NO' },
      { table_name: 'max_bot_outbox', column_name: 'next_attempt_at', is_nullable: 'NO' },
      { table_name: 'max_bot_outbox', column_name: 'completed_at', is_nullable: 'YES' },
    ]);

    const stageFourConstraints = await pool.query<{ conname: string }>(
      `select constraint_definition.conname
         from pg_constraint as constraint_definition
         join pg_class as relation on relation.oid = constraint_definition.conrelid
         join pg_namespace as namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'public'
          and relation.relname = any($1::text[])
          and constraint_definition.conname = any($2::text[])
        order by constraint_definition.conname`,
      [
        ['bot_dialogs', 'bot_inquiries', 'max_bot_outbox'],
        [
          'bot_dialogs_chat_id_nonzero',
          'bot_inquiries_body_text_not_blank',
          'bot_inquiries_event_key_not_blank',
          'bot_inquiries_event_key_unique',
          'max_bot_outbox_action_key_not_blank',
          'max_bot_outbox_action_key_unique',
          'max_bot_outbox_attempts_nonnegative',
          'max_bot_outbox_chat_id_matches_action',
          'max_bot_outbox_completed_at_matches_status',
          'max_bot_outbox_event_key_not_blank',
          'max_bot_outbox_payload_object',
          'max_bot_outbox_provider_message_id_not_blank',
        ],
      ],
    );
    expect(stageFourConstraints.rows.map(({ conname }) => conname)).toEqual([
      'bot_dialogs_chat_id_nonzero',
      'bot_inquiries_body_text_not_blank',
      'bot_inquiries_event_key_not_blank',
      'bot_inquiries_event_key_unique',
      'max_bot_outbox_action_key_not_blank',
      'max_bot_outbox_action_key_unique',
      'max_bot_outbox_attempts_nonnegative',
      'max_bot_outbox_chat_id_matches_action',
      'max_bot_outbox_completed_at_matches_status',
      'max_bot_outbox_event_key_not_blank',
      'max_bot_outbox_payload_object',
      'max_bot_outbox_provider_message_id_not_blank',
    ]);

    const webhookForeignKeys = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from pg_constraint as constraint_definition
        where constraint_definition.contype = 'f'
          and constraint_definition.conrelid in (
            'public.bot_inquiries'::regclass,
            'public.max_bot_outbox'::regclass
          )
          and constraint_definition.confrelid = 'public.webhook_inbox'::regclass`,
    );
    expect(webhookForeignKeys.rows[0]?.count).toBe('0');

    const stageFourIndexes = await pool.query<{ indexname: string }>(
      `select indexname
         from pg_indexes
        where schemaname = 'public'
          and indexname = any($1::text[])
        order by indexname`,
      [
        [
          'bot_inquiries_message_id_uidx',
          'max_bot_outbox_chat_order_idx',
          'max_bot_outbox_provider_message_id_uidx',
          'max_bot_outbox_ready_idx',
        ],
      ],
    );
    expect(stageFourIndexes.rows.map(({ indexname }) => indexname)).toEqual([
      'bot_inquiries_message_id_uidx',
      'max_bot_outbox_chat_order_idx',
      'max_bot_outbox_provider_message_id_uidx',
      'max_bot_outbox_ready_idx',
    ]);

    await pool.query(
      `insert into "public"."bot_dialogs" ("chat_id", "max_user_id")
       values ($1, null)`,
      ['700000000000000001'],
    );
    await pool.query(`insert into "public"."bot_dialogs" ("chat_id") values (-7001)`);
    await expect(
      pool.query(`insert into "public"."bot_dialogs" ("chat_id") values (0)`),
    ).rejects.toThrow();
    await pool.query(
      `insert into "public"."webhook_inbox" ("event_key", "event_type", "chat_id", "payload")
       values ('max:event:001', 'message_created', $1, '{}'::jsonb)`,
      ['700000000000000001'],
    );
    await expect(
      pool.query(
        `insert into "public"."bot_inquiries"
           ("event_key", "chat_id", "body_text")
         values ('max:event:missing-dialog', $1, 'Inquiry')`,
        ['700000000000000002'],
      ),
    ).rejects.toThrow();
    await expect(
      pool.query(
        `insert into "public"."max_bot_outbox"
           ("event_key", "action_key", "action", "payload")
         values ('max:event:null-send-chat', 'max:action:null-send-chat', 'send_message',
                 '{"text":"Missing chat"}'::jsonb)`,
      ),
    ).rejects.toThrow();
    await pool.query(
      `insert into "public"."max_bot_outbox"
         ("event_key", "action_key", "action", "payload")
       values ('max:event:callback-no-message', 'max:action:callback-no-message',
               'answer_callback', '{"callbackId":"callback-removed","body":{"notification":"OK"}}'::jsonb)`,
    );
    await expect(
      pool.query(
        `insert into "public"."bot_inquiries"
           ("event_key", "chat_id", "body_text")
         values ('   ', $1, 'Inquiry')`,
        ['700000000000000001'],
      ),
    ).rejects.toThrow();
    await expect(
      pool.query(
        `insert into "public"."bot_inquiries"
           ("event_key", "chat_id", "body_text")
         values ('max:event:blank-body', $1, '   ')`,
        ['700000000000000001'],
      ),
    ).rejects.toThrow();
    await pool.query(
      `insert into "public"."bot_inquiries"
         ("event_key", "chat_id", "max_user_id", "message_id", "body_text")
       values ('max:event:001', $1, null, 'mid-inquiry-001', 'Please contact me')`,
      ['700000000000000001'],
    );
    await expect(
      pool.query(
        `insert into "public"."bot_inquiries"
           ("event_key", "chat_id", "body_text")
         values ('max:event:001', $1, 'Duplicate')`,
        ['700000000000000001'],
      ),
    ).rejects.toThrow();
    await expect(
      pool.query(
        `insert into "public"."bot_inquiries"
           ("event_key", "chat_id", "message_id", "body_text")
         values ('max:event:duplicate-message', $1, 'mid-inquiry-001', 'Duplicate message')`,
        ['700000000000000001'],
      ),
    ).rejects.toThrow();

    await expect(
      pool.query(
        `insert into "public"."max_bot_outbox"
           ("event_key", "action_key", "action", "chat_id", "payload", "attempts")
         values ('max:event:001', 'max:action:negative', 'send_message', $1, '{}'::jsonb, -1)`,
        ['700000000000000001'],
      ),
    ).rejects.toThrow();
    await expect(
      pool.query(
        `insert into "public"."max_bot_outbox"
           ("event_key", "action_key", "action", "chat_id", "payload", "provider_message_id")
         values ('max:event:001', 'max:action:blank-provider', 'send_message', $1,
                 '{}'::jsonb, '   ')`,
        ['700000000000000001'],
      ),
    ).rejects.toThrow();
    await expect(
      pool.query(
        `insert into "public"."max_bot_outbox"
           ("event_key", "action_key", "action", "chat_id", "payload")
         values ('max:event:001', 'max:action:array', 'send_message', $1, '[]'::jsonb)`,
        ['700000000000000001'],
      ),
    ).rejects.toThrow();
    await expect(
      pool.query(
        `insert into "public"."max_bot_outbox"
           ("event_key", "action_key", "action", "chat_id", "payload", "status")
         values ('max:event:001', 'max:action:inconsistent', 'send_message', $1, '{}'::jsonb,
                 'completed')`,
        ['700000000000000001'],
      ),
    ).rejects.toThrow();
    await pool.query(
      `insert into "public"."max_bot_outbox"
         ("event_key", "action_key", "action", "chat_id", "payload")
       values ('max:event:001', 'max:action:001', 'send_message', $1,
               '{"text":"Welcome"}'::jsonb)`,
      ['700000000000000001'],
    );
    await expect(
      pool.query(
        `insert into "public"."max_bot_outbox"
           ("event_key", "action_key", "action", "chat_id", "payload")
         values ('max:event:another', 'max:action:001', 'answer_callback', $1, '{}'::jsonb)`,
        ['700000000000000001'],
      ),
    ).rejects.toThrow();
    await pool.query(
      `update "public"."max_bot_outbox"
          set "status" = 'completed',
              "provider_message_id" = 'mid-provider-001',
              "completed_at" = now(),
              "updated_at" = now()
        where "action_key" = 'max:action:001'`,
    );
    await expect(
      pool.query(
        `insert into "public"."max_bot_outbox"
           ("event_key", "action_key", "action", "chat_id", "payload", "provider_message_id",
            "status", "completed_at")
         values ('max:event:provider-duplicate', 'max:action:provider-duplicate', 'send_message', $1,
                 '{}'::jsonb, 'mid-provider-001', 'completed', now())`,
        ['700000000000000001'],
      ),
    ).rejects.toThrow();

    await pool.query(`delete from "public"."webhook_inbox" where "event_key" = 'max:event:001'`);
    const durableBotRows = await pool.query<{ inquiries: string; outbound: string }>(
      `select
         (select count(*) from "public"."bot_inquiries")::text as inquiries,
         (select count(*) from "public"."max_bot_outbox")::text as outbound`,
    );
    expect(durableBotRows.rows[0]).toEqual({ inquiries: '1', outbound: '2' });

    const appliedLedgerRows = await pool.query<{ created_at: string; hash: string }>(
      `select "created_at"::text as "created_at", "hash"
         from "drizzle"."__drizzle_migrations"
        order by "created_at"`,
    );
    expect(appliedLedgerRows.rows).toEqual([
      { created_at: String(initialEntry.when), hash: initialMigrationHash },
      { created_at: String(runtimeEntry.when), hash: runtimeMigrationHash },
      { created_at: String(botWebhookEntry.when), hash: botWebhookMigrationHash },
    ]);

    await expect(pool.query(initialDownMigration)).rejects.toThrow(
      /unexpected migration ledger entries exist/u,
    );
    await pool.query('rollback');

    await expect(pool.query(runtimeDownMigration)).rejects.toThrow(
      /unexpected migration ledger entries exist/u,
    );
    await pool.query('rollback');

    await pool.query(
      `insert into "drizzle"."__drizzle_migrations" ("hash", "created_at")
       values ($1, $2)`,
      ['future-migration-test-entry', botWebhookEntry.when + 1],
    );
    await expect(pool.query(botWebhookDownMigration)).rejects.toThrow(
      /unexpected migration ledger entries exist/u,
    );
    await pool.query('rollback');
    await pool.query(
      `delete from "drizzle"."__drizzle_migrations"
        where "created_at" = $1`,
      [botWebhookEntry.when + 1],
    );

    await pool.query(botWebhookDownMigration);

    const botTablesAfterRollback = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from information_schema.tables
        where table_schema = 'public'
          and table_name = any($1::text[])`,
      [['bot_dialogs', 'bot_inquiries', 'max_bot_outbox']],
    );
    const botEnumsAfterRollback = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from pg_type as type
         join pg_namespace as namespace on namespace.oid = type.typnamespace
        where namespace.nspname = 'public'
          and type.typname = any($1::text[])`,
      [
        [
          'bot_dialog_status',
          'bot_inquiry_status',
          'max_bot_outbox_action',
          'max_bot_outbox_status',
        ],
      ],
    );
    const botLedgerAfterRollback = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from "drizzle"."__drizzle_migrations"
        where "created_at" = $1`,
      [botWebhookEntry.when],
    );
    const olderLedgerAfterBotRollback = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from "drizzle"."__drizzle_migrations"
        where "created_at" = any($1::bigint[])`,
      [[initialEntry.when, runtimeEntry.when]],
    );
    expect(botTablesAfterRollback.rows[0]?.count).toBe('0');
    expect(botEnumsAfterRollback.rows[0]?.count).toBe('0');
    expect(botLedgerAfterRollback.rows[0]?.count).toBe('0');
    expect(olderLedgerAfterBotRollback.rows[0]?.count).toBe('2');

    await pool.query(runtimeDownMigration);

    const runtimeColumnsAfterRollback = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from information_schema.columns
        where table_schema = 'public'
          and (table_name, column_name) in (
            ('sessions', 'token_hash'),
            ('sessions', 'start_param'),
            ('submissions', 'request_hash')
          )`,
    );
    const runtimeLedgerAfterRollback = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from "drizzle"."__drizzle_migrations"
        where "created_at" = $1`,
      [runtimeEntry.when],
    );
    const initialLedgerAfterRuntimeRollback = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from "drizzle"."__drizzle_migrations"
        where "created_at" = $1`,
      [initialEntry.when],
    );
    expect(runtimeColumnsAfterRollback.rows[0]?.count).toBe('0');
    expect(runtimeLedgerAfterRollback.rows[0]?.count).toBe('0');
    expect(initialLedgerAfterRuntimeRollback.rows[0]?.count).toBe('1');

    await pool.query(initialDownMigration);

    const remainingTables = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from information_schema.tables
        where table_schema = 'public'
          and table_name = any($1::text[])`,
      [
        [
          'bot_dialogs',
          'bot_inquiries',
          'documents',
          'integration_outbox',
          'lead_drafts',
          'max_bot_outbox',
          'max_users',
          'sessions',
          'submissions',
          'webhook_inbox',
        ],
      ],
    );
    const remainingLedgerRows = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from "drizzle"."__drizzle_migrations"
        where "created_at" = any($1::bigint[])`,
      [[initialEntry.when, runtimeEntry.when, botWebhookEntry.when]],
    );
    const remainingEnums = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from pg_type as type
         join pg_namespace as namespace on namespace.oid = type.typnamespace
        where namespace.nspname = 'public'
          and type.typname = any($1::text[])`,
      [
        [
          'bot_dialog_status',
          'bot_inquiry_status',
          'customer_role',
          'document_scan_status',
          'integration_operation',
          'integration_outbox_status',
          'max_bot_outbox_action',
          'max_bot_outbox_status',
          'project_scope',
          'submission_status',
          'webhook_inbox_status',
        ],
      ],
    );

    expect(remainingTables.rows[0]?.count).toBe('0');
    expect(remainingLedgerRows.rows[0]?.count).toBe('0');
    expect(remainingEnums.rows[0]?.count).toBe('0');
  });
});
