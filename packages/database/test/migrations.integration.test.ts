import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const databaseUrl = process.env.DATABASE_URL;
const destructiveTestEnabled = process.env.MIGRATION_TEST_ALLOW_DESTRUCTIVE === 'true';
const describeWithDatabase =
  databaseUrl !== undefined && destructiveTestEnabled ? describe : describe.skip;
const migrationFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const migrationJournal = JSON.parse(
  readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'),
) as { entries: [{ when: number }] };
const migrationTimestamp = String(migrationJournal.entries[0].when);
const migrationSql = readFileSync(new URL('../drizzle/0000_initial.sql', import.meta.url), 'utf8');
const migrationHash = createHash('sha256').update(migrationSql).digest('hex');
const downMigration = readFileSync(
  new URL('../drizzle/rollback/0000_initial.down.sql', import.meta.url),
  'utf8',
);

describe('migration rollback metadata', () => {
  it('targets the generated initial migration ledger entry', () => {
    expect(downMigration).toContain(`WHERE "created_at" = ${migrationTimestamp}`);
    expect(downMigration).toContain(`AND "hash" = '${migrationHash}'`);
    expect(downMigration).toContain(
      'Initial rollback refused: unexpected migration ledger entries exist',
    );
  });
});

describeWithDatabase('PostgreSQL migrations', () => {
  const pool = new Pool({ connectionString: databaseUrl });

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

  it('applies the Drizzle migration and rolls back schema and ledger atomically', async () => {
    const database = drizzle(pool);

    await migrate(database, { migrationsFolder: migrationFolder });

    const createdTables = await pool.query<{ table_name: string }>(
      `select table_name
         from information_schema.tables
        where table_schema = 'public'
          and table_name = any($1::text[])
        order by table_name`,
      [
        [
          'documents',
          'integration_outbox',
          'lead_drafts',
          'max_users',
          'sessions',
          'submissions',
          'webhook_inbox',
        ],
      ],
    );

    expect(createdTables.rows.map(({ table_name: tableName }) => tableName)).toEqual([
      'documents',
      'integration_outbox',
      'lead_drafts',
      'max_users',
      'sessions',
      'submissions',
      'webhook_inbox',
    ]);

    const appliedLedgerRows = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from "drizzle"."__drizzle_migrations"
        where "created_at" = $1`,
      [migrationTimestamp],
    );
    expect(appliedLedgerRows.rows[0]?.count).toBe('1');

    await pool.query(
      `insert into "drizzle"."__drizzle_migrations" ("hash", "created_at")
       values ($1, $2)`,
      ['future-migration-test-entry', Number(migrationTimestamp) + 1],
    );

    await expect(pool.query(downMigration)).rejects.toThrow(
      /unexpected migration ledger entries exist/,
    );

    const tablesAfterRefusedRollback = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from information_schema.tables
        where table_schema = 'public'
          and table_name = any($1::text[])`,
      [
        [
          'documents',
          'integration_outbox',
          'lead_drafts',
          'max_users',
          'sessions',
          'submissions',
          'webhook_inbox',
        ],
      ],
    );
    expect(tablesAfterRefusedRollback.rows[0]?.count).toBe('7');

    await pool.query(
      `delete from "drizzle"."__drizzle_migrations"
        where "created_at" = $1`,
      [Number(migrationTimestamp) + 1],
    );

    await pool.query(downMigration);

    const remainingTables = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from information_schema.tables
        where table_schema = 'public'
          and table_name = any($1::text[])`,
      [
        [
          'documents',
          'integration_outbox',
          'lead_drafts',
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
        where "created_at" = $1`,
      [migrationTimestamp],
    );
    const remainingEnums = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from pg_type as type
         join pg_namespace as namespace on namespace.oid = type.typnamespace
        where namespace.nspname = 'public'
          and type.typname = any($1::text[])`,
      [
        [
          'customer_role',
          'document_scan_status',
          'integration_operation',
          'integration_outbox_status',
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
