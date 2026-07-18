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
const secureUploadsEntry = migrationJournal.entries.find(
  ({ tag }) => tag === '0003_stage5_secure_uploads',
);
const trackerOutboxEntry = migrationJournal.entries.find(
  ({ tag }) => tag === '0004_stage6_tracker_outbox',
);
const adminFoundationEntry = migrationJournal.entries.find(
  ({ tag }) => tag === '0005_admin_foundation',
);
const caseCatalogSeedEntry = migrationJournal.entries.find(
  ({ tag }) => tag === '0006_seed_case_catalog',
);

if (
  initialEntry === undefined ||
  runtimeEntry === undefined ||
  botWebhookEntry === undefined ||
  secureUploadsEntry === undefined ||
  trackerOutboxEntry === undefined ||
  adminFoundationEntry === undefined ||
  caseCatalogSeedEntry === undefined
) {
  throw new Error(
    'Expected migration journal entries from 0000_initial through 0006_seed_case_catalog',
  );
}

const initialSqlUrl = new URL('../drizzle/0000_initial.sql', import.meta.url);
const runtimeSqlUrl = new URL('../drizzle/0001_stage3_runtime.sql', import.meta.url);
const botWebhookSqlUrl = new URL('../drizzle/0002_stage4_bot_webhook.sql', import.meta.url);
const secureUploadsSqlUrl = new URL('../drizzle/0003_stage5_secure_uploads.sql', import.meta.url);
const trackerOutboxSqlUrl = new URL('../drizzle/0004_stage6_tracker_outbox.sql', import.meta.url);
const adminFoundationSqlUrl = new URL('../drizzle/0005_admin_foundation.sql', import.meta.url);
const caseCatalogSeedSqlUrl = new URL('../drizzle/0006_seed_case_catalog.sql', import.meta.url);
const initialMigrationSql = readFileSync(initialSqlUrl, 'utf8');
const runtimeMigrationSql = readFileSync(runtimeSqlUrl, 'utf8');
const botWebhookMigrationSql = readFileSync(botWebhookSqlUrl, 'utf8');
const secureUploadsMigrationSql = readFileSync(secureUploadsSqlUrl, 'utf8');
const trackerOutboxMigrationSql = readFileSync(trackerOutboxSqlUrl, 'utf8');
const adminFoundationMigrationSql = readFileSync(adminFoundationSqlUrl, 'utf8');
const caseCatalogSeedMigrationSql = readFileSync(caseCatalogSeedSqlUrl, 'utf8');
const secureUploadsPreflightSql = secureUploadsMigrationSql.split('--> statement-breakpoint')[0];
const trackerOutboxPreflightSql = trackerOutboxMigrationSql.split('--> statement-breakpoint')[0];
if (secureUploadsPreflightSql === undefined || trackerOutboxPreflightSql === undefined) {
  throw new Error('Expected Stage 5 and Stage 6 fail-closed migration preflights');
}
const initialMigrationHash = createHash('sha256').update(initialMigrationSql).digest('hex');
const runtimeMigrationHash = createHash('sha256').update(runtimeMigrationSql).digest('hex');
const botWebhookMigrationHash = createHash('sha256').update(botWebhookMigrationSql).digest('hex');
const secureUploadsMigrationHash = createHash('sha256')
  .update(secureUploadsMigrationSql)
  .digest('hex');
const trackerOutboxMigrationHash = createHash('sha256')
  .update(trackerOutboxMigrationSql)
  .digest('hex');
const adminFoundationMigrationHash = createHash('sha256')
  .update(adminFoundationMigrationSql)
  .digest('hex');
const caseCatalogSeedMigrationHash = createHash('sha256')
  .update(caseCatalogSeedMigrationSql)
  .digest('hex');
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
const secureUploadsDownMigration = readFileSync(
  new URL('../drizzle/rollback/0003_stage5_secure_uploads.down.sql', import.meta.url),
  'utf8',
);
const trackerOutboxDownMigration = readFileSync(
  new URL('../drizzle/rollback/0004_stage6_tracker_outbox.down.sql', import.meta.url),
  'utf8',
);
const adminFoundationDownMigration = readFileSync(
  new URL('../drizzle/rollback/0005_admin_foundation.down.sql', import.meta.url),
  'utf8',
);
const caseCatalogSeedDownMigration = readFileSync(
  new URL('../drizzle/rollback/0006_seed_case_catalog.down.sql', import.meta.url),
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

interface SeededCaseFixture {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly image: string;
  readonly city: string;
  readonly region: string;
  readonly categories: readonly string[];
  readonly services: readonly string[];
  readonly area: number | null;
  readonly scale: string;
  readonly constructionKind: string;
  readonly status: string;
  readonly tags: readonly string[];
  readonly published: boolean;
  readonly sortOrder: number;
  readonly version: number;
}

const seededCaseFixtures: readonly SeededCaseFixture[] = [
  {
    id: 'businesshouse',
    title: 'Бизнес-центр на Герцена',
    url: 'https://craft72.ru/businesshouse',
    image: 'https://static.tildacdn.com/tild6165-3531-4166-a265-656533383936/_-94.jpg',
    city: 'Тюмень',
    region: 'Тюменская область',
    categories: ['office', 'commercial'],
    services: ['urban-planning', 'architecture'],
    area: 42_000,
    scale: 'large-object',
    constructionKind: 'new-construction',
    status: 'Проект',
    tags: ['business-center', 'mixed-use'],
    published: true,
    sortOrder: 0,
    version: 1,
  },
  {
    id: 'sportscentertsimlyanskoe',
    title: 'Многофункциональный спортивный центр оз. Цимлянское',
    url: 'https://craft72.ru/sportscentertsimlyanskoe',
    image: 'https://static.tildacdn.com/tild6162-6234-4263-a333-303736326161/__-76.jpg',
    city: 'Тюмень',
    region: 'Тюменская область',
    categories: ['public-building', 'sports-infrastructure'],
    services: ['urban-planning', 'architecture', 'general-design'],
    area: 800_000,
    scale: 'territory',
    constructionKind: 'new-construction',
    status: 'Согласован',
    tags: ['sports', 'landscape'],
    published: true,
    sortOrder: 1,
    version: 1,
  },
  {
    id: 'childcenter',
    title: 'Детский досуговый центр',
    url: 'https://craft72.ru/childcenter',
    image: 'https://static.tildacdn.com/tild6137-3636-4936-b365-326232316539/__-74.jpg',
    city: 'Тобольск',
    region: 'Тюменская область',
    categories: ['public-building', 'social-infrastructure'],
    services: ['architecture', 'general-design'],
    area: 1_450,
    scale: 'single-object',
    constructionKind: 'new-construction',
    status: 'Согласован',
    tags: ['family', 'public-space'],
    published: true,
    sortOrder: 2,
    version: 1,
  },
  {
    id: 'citypumpingstation',
    title: 'Ансамбль городской насосной станции',
    url: 'https://craft72.ru/citypumpingstation',
    image: 'https://static.tildacdn.com/tild6164-3938-4934-b465-323764656430/__-82.jpg',
    city: 'Тобольск',
    region: 'Тюменская область',
    categories: ['cultural-heritage', 'public-building'],
    services: ['restoration', 'architecture', 'general-design', 'expertise-support'],
    area: 3_500,
    scale: 'single-object',
    constructionKind: 'cultural-heritage',
    status: 'Проектная документация',
    tags: ['heritage', 'adaptation'],
    published: true,
    sortOrder: 3,
    version: 1,
  },
  {
    id: 'gagarinsky',
    title: 'Жилой комплекс «Гагаринский»',
    url: 'https://craft72.ru/gagarinsky',
    image: 'https://static.tildacdn.com/tild3262-3037-4934-b932-353130623935/__-92.jpg',
    city: 'Тюмень',
    region: 'Тюменская область',
    categories: ['residential'],
    services: ['architecture'],
    area: 20_000,
    scale: 'large-object',
    constructionKind: 'new-construction',
    status: 'Согласовано',
    tags: ['residential', 'architectural-lighting'],
    published: true,
    sortOrder: 4,
    version: 1,
  },
  {
    id: 'zemstvoschool',
    title: 'Здание «Земской школы»',
    url: 'https://craft72.ru/zemstvoschool',
    image: 'https://static.tildacdn.com/tild3166-3861-4130-a238-313364653238/__-90.jpg',
    city: 'Екатеринбург',
    region: 'Свердловская область',
    categories: ['cultural-heritage', 'public-building'],
    services: ['restoration', 'architecture'],
    area: null,
    scale: 'single-object',
    constructionKind: 'cultural-heritage',
    status: 'Проект',
    tags: ['heritage', 'school'],
    published: true,
    sortOrder: 5,
    version: 1,
  },
  {
    id: 'industrialpark',
    title: 'Индустриальный парк',
    url: 'https://craft72.ru/industrialpark',
    image: 'https://static.tildacdn.com/tild3332-6236-4564-b261-663036663337/__1-90.jpg',
    city: 'Тюмень',
    region: 'Тюменская область',
    categories: ['industrial'],
    services: ['urban-planning', 'architecture'],
    area: 48_000,
    scale: 'territory',
    constructionKind: 'new-construction',
    status: 'Согласовано',
    tags: ['industrial', 'masterplan'],
    published: true,
    sortOrder: 6,
    version: 1,
  },
  {
    id: 'masterplan',
    title: 'Мастер-план туристического каркаса города',
    url: 'https://craft72.ru/masterplan',
    image: 'https://static.tildacdn.com/tild3930-3737-4466-a663-643430316238/__-27.jpg',
    city: 'Тобольск',
    region: 'Тюменская область',
    categories: ['hospitality', 'urban-development'],
    services: ['urban-planning', 'architecture'],
    area: null,
    scale: 'territory',
    constructionKind: 'new-construction',
    status: 'Согласование проекта',
    tags: ['masterplan', 'tourism'],
    published: true,
    sortOrder: 7,
    version: 1,
  },
];

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlTextArray(values: readonly string[]): string {
  return `ARRAY[${values.map(sqlString).join(', ')}]::text[]`;
}

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

  it('fails Stage 5 closed on legacy documents and anchors its rollback', () => {
    expect(secureUploadsMigrationSql).toContain(
      'Stage 5 secure upload migration refused: documents must be empty',
    );
    expect(
      secureUploadsMigrationSql.indexOf('Stage 5 secure upload migration refused'),
    ).toBeLessThan(secureUploadsMigrationSql.indexOf('CREATE TYPE'));
    for (const [entry, hash] of [
      [initialEntry, initialMigrationHash],
      [runtimeEntry, runtimeMigrationHash],
      [botWebhookEntry, botWebhookMigrationHash],
      [secureUploadsEntry, secureUploadsMigrationHash],
    ] as const) {
      expect(secureUploadsDownMigration).toContain(`WHERE "created_at" = ${entry.when}`);
      expect(secureUploadsDownMigration).toContain(`AND "hash" = '${hash}'`);
    }
    expect(secureUploadsDownMigration).toContain(
      'Stage 5 secure uploads rollback refused: unexpected migration ledger entries exist',
    );
  });

  it('fails Stage 6 closed on queued work and anchors its rollback', () => {
    expect(trackerOutboxMigrationSql).toContain(
      'Stage 6 Tracker outbox migration refused: integration_outbox must be empty',
    );
    expect(
      trackerOutboxMigrationSql.indexOf('Stage 6 Tracker outbox migration refused'),
    ).toBeLessThan(trackerOutboxMigrationSql.indexOf('ALTER TABLE'));
    for (const [entry, hash] of [
      [initialEntry, initialMigrationHash],
      [runtimeEntry, runtimeMigrationHash],
      [botWebhookEntry, botWebhookMigrationHash],
      [secureUploadsEntry, secureUploadsMigrationHash],
      [trackerOutboxEntry, trackerOutboxMigrationHash],
    ] as const) {
      expect(trackerOutboxDownMigration).toContain(`WHERE "created_at" = ${entry.when}`);
      expect(trackerOutboxDownMigration).toContain(`AND "hash" = '${hash}'`);
    }
    expect(trackerOutboxDownMigration).toContain(
      'Stage 6 Tracker outbox rollback refused: unexpected migration ledger entries exist',
    );
  });

  it('anchors the admin rollback and refuses to discard managed data', () => {
    for (const [entry, hash] of [
      [initialEntry, initialMigrationHash],
      [runtimeEntry, runtimeMigrationHash],
      [botWebhookEntry, botWebhookMigrationHash],
      [secureUploadsEntry, secureUploadsMigrationHash],
      [trackerOutboxEntry, trackerOutboxMigrationHash],
      [adminFoundationEntry, adminFoundationMigrationHash],
    ] as const) {
      expect(adminFoundationDownMigration).toContain(`WHERE "created_at" = ${entry.when}`);
      expect(adminFoundationDownMigration).toContain(`AND "hash" = '${hash}'`);
    }
    expect(adminFoundationDownMigration).toContain(
      'Admin foundation rollback refused: admin-managed data exists',
    );
    expect(adminFoundationDownMigration).toContain(
      'Admin foundation rollback refused: unexpected migration ledger entries exist',
    );
  });

  it('seeds the exact curated portfolio without overwriting admin-owned rows', () => {
    expect(seededCaseFixtures).toHaveLength(8);
    expect(caseCatalogSeedMigrationSql).toContain('ON CONFLICT ("id") DO NOTHING;');

    for (const fixture of seededCaseFixtures) {
      const tupleValues = [
        sqlString(fixture.id),
        sqlString(fixture.title),
        sqlString(fixture.url),
        sqlString(fixture.image),
        sqlString(fixture.city),
        sqlString(fixture.region),
        sqlTextArray(fixture.categories),
        sqlTextArray(fixture.services),
        fixture.area === null ? 'NULL' : String(fixture.area),
        sqlString(fixture.scale),
        sqlString(fixture.constructionKind),
        sqlString(fixture.status),
        sqlTextArray(fixture.tags),
        String(fixture.published),
        String(fixture.sortOrder),
        String(fixture.version),
        sqlString('2026-07-18 05:13:36.909+00'),
        sqlString('2026-07-18 05:13:36.909+00'),
      ];
      const tuplePattern = new RegExp(
        `\\(\\s*${tupleValues.map(escapeRegularExpression).join(',\\s*')}\\s*\\)`,
        'u',
      );

      expect(caseCatalogSeedMigrationSql).toMatch(tuplePattern);
    }

    for (const [entry, hash] of [
      [initialEntry, initialMigrationHash],
      [runtimeEntry, runtimeMigrationHash],
      [botWebhookEntry, botWebhookMigrationHash],
      [secureUploadsEntry, secureUploadsMigrationHash],
      [trackerOutboxEntry, trackerOutboxMigrationHash],
      [adminFoundationEntry, adminFoundationMigrationHash],
      [caseCatalogSeedEntry, caseCatalogSeedMigrationHash],
    ] as const) {
      expect(caseCatalogSeedDownMigration).toContain(`WHERE "created_at" = ${entry.when}`);
      expect(caseCatalogSeedDownMigration).toContain(`AND "hash" = '${hash}'`);
    }
    expect(caseCatalogSeedDownMigration).toContain(
      'Case catalog seed rollback refused: seeded cases contain admin-managed changes',
    );
    expect(caseCatalogSeedDownMigration).toContain(
      'Case catalog seed rollback refused: unexpected migration ledger entries exist',
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

  it('upgrades 0000 data through Stage 6, enforces constraints and rolls back safely', async () => {
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
          'admin_audit_log',
          'admin_sessions',
          'bot_dialogs',
          'bot_inquiries',
          'case_catalog_items',
          'content_documents',
          'document_access_grants',
          'document_scan_jobs',
          'documents',
          'integration_outbox',
          'lead_drafts',
          'max_bot_outbox',
          'max_users',
          'sessions',
          'submissions',
          'upload_sessions',
          'webhook_inbox',
        ],
      ],
    );
    expect(createdTables.rows.map(({ table_name: tableName }) => tableName)).toEqual([
      'admin_audit_log',
      'admin_sessions',
      'bot_dialogs',
      'bot_inquiries',
      'case_catalog_items',
      'content_documents',
      'document_access_grants',
      'document_scan_jobs',
      'documents',
      'integration_outbox',
      'lead_drafts',
      'max_bot_outbox',
      'max_users',
      'sessions',
      'submissions',
      'upload_sessions',
      'webhook_inbox',
    ]);

    const seededCases = await pool.query<SeededCaseFixture>(
      `select
         "id",
         "title",
         "url",
         "image",
         "city",
         "region",
         "categories",
         "services",
         "area_sqm"::float8 as "area",
         "scale",
         "construction_kind" as "constructionKind",
         "status",
         "tags",
         "published",
         "sort_order" as "sortOrder",
         "version"
       from "public"."case_catalog_items"
       order by "sort_order", "id"`,
    );
    expect(seededCases.rows).toEqual(seededCaseFixtures);

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

    const uploadSession = await pool.query<{ id: string }>(
      `insert into "public"."upload_sessions" (
         "max_user_id", "capability_hash", "original_name", "declared_mime_type",
         "expected_size_bytes", "expected_sha256", "quarantine_storage_key", "expires_at"
       ) values ($1, $2, 'brief.pdf', 'application/pdf', 1024, $3,
                 'quarantine/stage5-brief', now() + interval '1 hour')
       returning "id"`,
      [maxUserId, '1'.repeat(64), '2'.repeat(64)],
    );
    await expect(
      pool.query(
        `insert into "public"."upload_sessions" (
           "max_user_id", "capability_hash", "original_name", "declared_mime_type",
           "expected_size_bytes", "quarantine_storage_key", "expires_at"
         ) values ($1, $2, 'raw-token.pdf', 'application/pdf', 1024,
                   'quarantine/stage5-raw-token', now() + interval '1 hour')`,
        [maxUserId, 'raw-upload-capability'],
      ),
    ).rejects.toThrow();
    await expect(
      pool.query(
        `insert into "public"."upload_sessions" (
           "max_user_id", "capability_hash", "original_name", "declared_mime_type",
           "expected_size_bytes", "received_size_bytes", "quarantine_storage_key", "expires_at"
         ) values ($1, $2, 'partial.pdf', 'application/pdf', 1024, 1024,
                   'quarantine/stage5-partial', now() + interval '1 hour')`,
        [maxUserId, '4'.repeat(64)],
      ),
    ).rejects.toThrow();
    await expect(
      pool.query(
        `update "public"."upload_sessions"
            set "status" = 'uploading', "attempts" = 1
          where "id" = $1`,
        [uploadSession.rows[0]?.id],
      ),
    ).rejects.toThrow();
    await pool.query(
      `update "public"."upload_sessions"
          set "status" = 'uploading',
              "attempts" = 1,
              "lease_token" = '00000000-0000-4000-8000-000000000001',
              "lease_expires_at" = now() + interval '5 minutes'
        where "id" = $1`,
      [uploadSession.rows[0]?.id],
    );
    await pool.query(
      `update "public"."upload_sessions"
          set "status" = 'uploaded',
              "received_size_bytes" = 1024,
              "received_sha256" = $2,
              "detected_mime_type" = 'application/pdf',
              "detected_file_type" = 'pdf',
              "uploaded_at" = now(),
              "lease_token" = null,
              "lease_expires_at" = null
        where "id" = $1`,
      [uploadSession.rows[0]?.id, '2'.repeat(64)],
    );

    const stagedDocument = await pool.query<{ id: string }>(
      `insert into "public"."documents" (
         "max_user_id", "original_name", "storage_key", "mime_type", "size_bytes", "sha256",
         "detected_mime_type", "detected_file_type", "staged_expires_at"
       ) values ($1, 'brief.pdf', 'private/stage5-brief', 'application/pdf', 1024, $2,
                 'application/pdf', 'pdf', now() + interval '1 hour')
       returning "id"`,
      [maxUserId, '2'.repeat(64)],
    );
    await expect(
      pool.query(
        `update "public"."documents"
            set "scan_status" = 'clean'
          where "id" = $1`,
        [stagedDocument.rows[0]?.id],
      ),
    ).rejects.toThrow();

    const scanJob = await pool.query<{ id: string }>(
      `insert into "public"."document_scan_jobs" ("document_id")
       values ($1)
       returning "id"`,
      [stagedDocument.rows[0]?.id],
    );
    await expect(
      pool.query(
        `update "public"."document_scan_jobs"
            set "status" = 'processing'
          where "id" = $1`,
        [scanJob.rows[0]?.id],
      ),
    ).rejects.toThrow();
    await pool.query(
      `update "public"."document_scan_jobs"
          set "status" = 'processing',
              "attempts" = 1,
              "lease_token" = '00000000-0000-4000-8000-000000000002',
              "lease_expires_at" = now() + interval '5 minutes'
        where "id" = $1`,
      [scanJob.rows[0]?.id],
    );
    await pool.query(
      `update "public"."document_scan_jobs"
          set "status" = 'completed',
              "lease_token" = null,
              "lease_expires_at" = null,
              "finished_at" = now()
        where "id" = $1`,
      [scanJob.rows[0]?.id],
    );
    await pool.query(
      `update "public"."documents"
          set "scan_status" = 'clean',
              "scan_engine" = 'test-scanner',
              "scan_engine_version" = '1',
              "scan_completed_at" = now(),
              "available_at" = now()
        where "id" = $1`,
      [stagedDocument.rows[0]?.id],
    );
    const secondMaxUserId = '900000000000000002';
    await pool.query(
      `insert into "public"."max_users" ("max_user_id", "first_name")
       values ($1, 'Other upload owner')`,
      [secondMaxUserId],
    );
    await expect(
      pool.query(
        `insert into "public"."upload_sessions" (
           "max_user_id", "capability_hash", "original_name", "declared_mime_type",
           "expected_size_bytes", "received_size_bytes", "received_sha256",
           "detected_mime_type", "detected_file_type", "quarantine_storage_key", "status",
           "document_id", "expires_at", "uploaded_at", "completed_at"
         ) values ($1, $2, 'foreign.pdf', 'application/pdf', 1024, 1024, $3,
                   'application/pdf', 'pdf', 'quarantine/stage5-foreign', 'completed', $4,
                   now() + interval '1 hour', now(), now())`,
        [secondMaxUserId, '5'.repeat(64), '2'.repeat(64), stagedDocument.rows[0]?.id],
      ),
    ).rejects.toThrow();
    await pool.query(
      `update "public"."upload_sessions"
          set "status" = 'completed', "document_id" = $2, "completed_at" = now()
        where "id" = $1`,
      [uploadSession.rows[0]?.id, stagedDocument.rows[0]?.id],
    );

    await expect(
      pool.query(
        `insert into "public"."document_access_grants"
           ("document_id", "token_hash", "expires_at")
         values ($1, 'raw-signed-token', now() + interval '5 minutes')`,
        [stagedDocument.rows[0]?.id],
      ),
    ).rejects.toThrow();
    await pool.query(
      `insert into "public"."document_access_grants"
         ("document_id", "token_hash", "expires_at")
       values ($1, $2, now() + interval '5 minutes')`,
      [stagedDocument.rows[0]?.id, '3'.repeat(64)],
    );
    await expect(pool.query(secureUploadsPreflightSql)).rejects.toThrow(/documents must be empty/u);

    const trackerSubmissionId = legacySubmission.rows[0]?.id;
    await pool.query(
      `insert into "public"."integration_outbox"
         ("submission_id", "operation", "idempotency_key")
       values ($1, 'upsert_partner', 'tracker:TEST-0001:part:v1')`,
      [trackerSubmissionId],
    );
    await expect(
      pool.query(
        `insert into "public"."integration_outbox"
           ("submission_id", "operation", "idempotency_key")
         values ($1, 'create_crm', 'tracker:TEST-0001:invalid-crm:v1')`,
        [trackerSubmissionId],
      ),
    ).rejects.toThrow();
    await pool.query(
      `insert into "public"."integration_outbox"
         ("submission_id", "operation", "depends_on_operation", "idempotency_key")
       values ($1, 'create_crm', 'upsert_partner', 'tracker:TEST-0001:crm:v1')`,
      [trackerSubmissionId],
    );
    await pool.query(
      `insert into "public"."integration_outbox"
         ("submission_id", "operation", "depends_on_operation", "idempotency_key")
       values ($1, 'create_docs', 'create_crm', 'tracker:TEST-0001:docs:v1')`,
      [trackerSubmissionId],
    );
    await expect(
      pool.query(
        `update "public"."integration_outbox"
            set "status" = 'processing'
          where "submission_id" = $1 and "operation" = 'upsert_partner'`,
        [trackerSubmissionId],
      ),
    ).rejects.toThrow();
    await pool.query(
      `update "public"."integration_outbox"
          set "status" = 'processing',
              "attempts" = 1,
              "lease_token" = '00000000-0000-4000-8000-000000000003',
              "lease_expires_at" = now() + interval '5 minutes'
        where "submission_id" = $1 and "operation" = 'upsert_partner'`,
      [trackerSubmissionId],
    );
    await expect(
      pool.query(
        `update "public"."integration_outbox"
            set "status" = 'completed',
                "completed_at" = now(),
                "lease_token" = null,
                "lease_expires_at" = null
          where "submission_id" = $1 and "operation" = 'upsert_partner'`,
        [trackerSubmissionId],
      ),
    ).rejects.toThrow();
    await pool.query(
      `update "public"."integration_outbox"
          set "status" = 'completed',
              "result_key" = 'PART-1001',
              "completed_at" = now(),
              "lease_token" = null,
              "lease_expires_at" = null
        where "submission_id" = $1 and "operation" = 'upsert_partner'`,
      [trackerSubmissionId],
    );
    await expect(
      pool.query(
        `update "public"."integration_outbox"
            set "status" = 'retry', "last_error_code" = 'timeout'
          where "submission_id" = $1 and "operation" = 'create_crm'`,
        [trackerSubmissionId],
      ),
    ).rejects.toThrow();
    await pool.query(
      `update "public"."integration_outbox"
          set "status" = 'retry', "last_error_code" = 'timeout', "last_error_at" = now()
        where "submission_id" = $1 and "operation" = 'create_crm'`,
      [trackerSubmissionId],
    );
    await expect(pool.query(trackerOutboxPreflightSql)).rejects.toThrow(
      /integration_outbox must be empty/u,
    );

    const appliedLedgerRows = await pool.query<{ created_at: string; hash: string }>(
      `select "created_at"::text as "created_at", "hash"
         from "drizzle"."__drizzle_migrations"
        order by "created_at"`,
    );
    expect(appliedLedgerRows.rows).toEqual([
      { created_at: String(initialEntry.when), hash: initialMigrationHash },
      { created_at: String(runtimeEntry.when), hash: runtimeMigrationHash },
      { created_at: String(botWebhookEntry.when), hash: botWebhookMigrationHash },
      { created_at: String(secureUploadsEntry.when), hash: secureUploadsMigrationHash },
      { created_at: String(trackerOutboxEntry.when), hash: trackerOutboxMigrationHash },
      { created_at: String(adminFoundationEntry.when), hash: adminFoundationMigrationHash },
      { created_at: String(caseCatalogSeedEntry.when), hash: caseCatalogSeedMigrationHash },
    ]);

    await expect(pool.query(initialDownMigration)).rejects.toThrow(
      /unexpected migration ledger entries exist/u,
    );
    await pool.query('rollback');

    await expect(pool.query(runtimeDownMigration)).rejects.toThrow(
      /unexpected migration ledger entries exist/u,
    );
    await pool.query('rollback');

    await expect(pool.query(botWebhookDownMigration)).rejects.toThrow(
      /unexpected migration ledger entries exist/u,
    );
    await pool.query('rollback');

    await expect(pool.query(secureUploadsDownMigration)).rejects.toThrow(
      /unexpected migration ledger entries exist/u,
    );
    await pool.query('rollback');

    await expect(pool.query(adminFoundationDownMigration)).rejects.toThrow(
      /unexpected migration ledger entries exist/u,
    );
    await pool.query('rollback');

    await pool.query(caseCatalogSeedDownMigration);
    const seededCasesAfterRollback = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from "public"."case_catalog_items"`,
    );
    const seedLedgerAfterRollback = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from "drizzle"."__drizzle_migrations"
        where "created_at" = $1`,
      [caseCatalogSeedEntry.when],
    );
    expect(seededCasesAfterRollback.rows[0]?.count).toBe('0');
    expect(seedLedgerAfterRollback.rows[0]?.count).toBe('0');

    await pool.query(
      `insert into "drizzle"."__drizzle_migrations" ("hash", "created_at")
       values ($1, $2)`,
      ['future-admin-migration-test-entry', adminFoundationEntry.when + 1],
    );
    await expect(pool.query(adminFoundationDownMigration)).rejects.toThrow(
      /unexpected migration ledger entries exist/u,
    );
    await pool.query('rollback');
    await pool.query(
      `delete from "drizzle"."__drizzle_migrations"
        where "created_at" = $1`,
      [adminFoundationEntry.when + 1],
    );

    await pool.query(adminFoundationDownMigration);

    const adminTablesAfterRollback = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from information_schema.tables
        where table_schema = 'public'
          and table_name = any($1::text[])`,
      [['admin_audit_log', 'admin_sessions', 'case_catalog_items', 'content_documents']],
    );
    const adminColumnsAfterRollback = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'submissions'
          and column_name = any($1::text[])`,
      [['review_status', 'admin_note']],
    );
    const adminLedgerAfterRollback = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from "drizzle"."__drizzle_migrations"
        where "created_at" = $1`,
      [adminFoundationEntry.when],
    );
    expect(adminTablesAfterRollback.rows[0]?.count).toBe('0');
    expect(adminColumnsAfterRollback.rows[0]?.count).toBe('0');
    expect(adminLedgerAfterRollback.rows[0]?.count).toBe('0');

    await pool.query(
      `insert into "drizzle"."__drizzle_migrations" ("hash", "created_at")
       values ($1, $2)`,
      ['future-migration-test-entry', trackerOutboxEntry.when + 1],
    );
    await expect(pool.query(trackerOutboxDownMigration)).rejects.toThrow(
      /unexpected migration ledger entries exist/u,
    );
    await pool.query('rollback');
    await pool.query(
      `delete from "drizzle"."__drizzle_migrations"
        where "created_at" = $1`,
      [trackerOutboxEntry.when + 1],
    );

    await pool.query(trackerOutboxDownMigration);

    const trackerColumnsAfterRollback = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'integration_outbox'
          and column_name = any($1::text[])`,
      [['depends_on_operation', 'lease_token', 'lease_expires_at', 'result_key', 'last_error_at']],
    );
    const trackerLedgerAfterRollback = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from "drizzle"."__drizzle_migrations"
        where "created_at" = $1`,
      [trackerOutboxEntry.when],
    );
    expect(trackerColumnsAfterRollback.rows[0]?.count).toBe('0');
    expect(trackerLedgerAfterRollback.rows[0]?.count).toBe('0');

    await pool.query(secureUploadsDownMigration);

    const uploadTablesAfterRollback = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from information_schema.tables
        where table_schema = 'public'
          and table_name = any($1::text[])`,
      [['upload_sessions', 'document_scan_jobs', 'document_access_grants']],
    );
    const documentColumnsAfterRollback = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'documents'
          and column_name = any($1::text[])`,
      [
        [
          'detected_mime_type',
          'detected_file_type',
          'uploaded_at',
          'scan_engine',
          'scan_engine_version',
          'scan_completed_at',
          'available_at',
        ],
      ],
    );
    const uploadEnumsAfterRollback = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from pg_type as type
         join pg_namespace as namespace on namespace.oid = type.typnamespace
        where namespace.nspname = 'public'
          and type.typname = any($1::text[])`,
      [['upload_session_status', 'document_scan_job_status']],
    );
    const uploadLedgerAfterRollback = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from "drizzle"."__drizzle_migrations"
        where "created_at" = $1`,
      [secureUploadsEntry.when],
    );
    expect(uploadTablesAfterRollback.rows[0]?.count).toBe('0');
    expect(documentColumnsAfterRollback.rows[0]?.count).toBe('0');
    expect(uploadEnumsAfterRollback.rows[0]?.count).toBe('0');
    expect(uploadLedgerAfterRollback.rows[0]?.count).toBe('0');

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
          'document_access_grants',
          'document_scan_jobs',
          'documents',
          'integration_outbox',
          'lead_drafts',
          'max_bot_outbox',
          'max_users',
          'sessions',
          'submissions',
          'upload_sessions',
          'webhook_inbox',
        ],
      ],
    );
    const remainingLedgerRows = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from "drizzle"."__drizzle_migrations"
        where "created_at" = any($1::bigint[])`,
      [
        [
          initialEntry.when,
          runtimeEntry.when,
          botWebhookEntry.when,
          secureUploadsEntry.when,
          trackerOutboxEntry.when,
          adminFoundationEntry.when,
          caseCatalogSeedEntry.when,
        ],
      ],
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
          'document_scan_job_status',
          'document_scan_status',
          'integration_operation',
          'integration_outbox_status',
          'max_bot_outbox_action',
          'max_bot_outbox_status',
          'project_scope',
          'submission_status',
          'submission_review_status',
          'content_document_kind',
          'upload_session_status',
          'webhook_inbox_status',
        ],
      ],
    );

    expect(remainingTables.rows[0]?.count).toBe('0');
    expect(remainingLedgerRows.rows[0]?.count).toBe('0');
    expect(remainingEnums.rows[0]?.count).toBe('0');
  });
});
