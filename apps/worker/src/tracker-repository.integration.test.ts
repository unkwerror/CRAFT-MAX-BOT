import { fileURLToPath } from 'node:url';

import { createDatabaseClient, maxUsers, submissions } from '@craft72/database';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PostgresTrackerOutboxStore } from './tracker-repository.js';

const databaseUrl = process.env.DATABASE_URL;
const destructiveTestEnabled = process.env.TRACKER_REPOSITORY_TEST_ALLOW_DESTRUCTIVE === 'true';
const describeWithDatabase =
  databaseUrl !== undefined && destructiveTestEnabled ? describe : describe.skip;

describeWithDatabase('PostgresTrackerOutboxStore integration', () => {
  const connectionString =
    databaseUrl ?? 'postgresql://disabled@127.0.0.1/craft72_tracker_repository_disabled_test';
  const databaseName = new URL(connectionString).pathname.slice(1);
  if (!databaseName.endsWith('_test')) {
    throw new Error('Tracker repository integration tests require a database name ending in _test');
  }

  const client = createDatabaseClient({ connectionString, max: 4 });
  const now = new Date('2026-07-16T06:00:00.000Z');

  beforeAll(async () => {
    await migrate(client.db, {
      migrationsFolder: fileURLToPath(
        new URL('../../../packages/database/drizzle', import.meta.url),
      ),
    });
  });

  beforeEach(async () => {
    await client.pool.query('truncate table max_users cascade');
  });

  afterAll(async () => {
    await client.close();
  });

  it('backfills an existing submission exactly once with a valid PART to CRM dependency', async () => {
    const maxUserId = 900000000000000001n;
    await client.db.insert(maxUsers).values({
      maxUserId,
      firstName: 'Tracker integration',
      createdAt: now,
      updatedAt: now,
    });
    const inserted = await client.db
      .insert(submissions)
      .values({
        submissionId: 'CRAFT-20260716-TEST01',
        idempotencyKey: 'tracker-integration-idempotency',
        requestHash: 'a'.repeat(64),
        maxUserId,
        customerRole: 'developer',
        contactName: 'Интеграционный тест',
        organization: 'CRAFT72',
        inn: '7200000000',
        objectType: 'Офис',
        city: 'Тюмень',
        projectScope: 'single_object',
        objectCount: 1,
        projectStage: 'Концепция',
        services: ['Проектирование'],
        description: 'Проверка backfill Tracker outbox',
        materialLinks: [],
        selectedCaseIds: [],
        phone: '+79990000001',
        phoneVerified: true,
        email: 'tracker-integration@example.com',
        consentVersion: 'stage6-v1',
        consentTextHash: 'b'.repeat(64),
        consentedAt: now,
        termsVersion: 'stage6-v1',
        termsTextHash: 'c'.repeat(64),
        termsAcceptedAt: now,
        source: 'direct',
        status: 'received',
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: submissions.id });
    const submission = inserted[0];
    if (submission === undefined) throw new Error('Test submission was not inserted');

    const store = new PostgresTrackerOutboxStore(client.db);
    await expect(store.backfillTrackerOutbox(now)).resolves.toBe(2);
    await expect(store.backfillTrackerOutbox(now)).resolves.toBe(0);

    const outbox = await client.pool.query<{
      depends_on_operation: string | null;
      operation: string;
      status: string;
    }>(
      `select operation::text, depends_on_operation::text, status::text
         from integration_outbox
        where submission_id = $1
        order by case operation when 'upsert_partner' then 1 when 'create_crm' then 2 else 3 end`,
      [submission.id],
    );
    expect(outbox.rows).toEqual([
      { depends_on_operation: null, operation: 'upsert_partner', status: 'pending' },
      {
        depends_on_operation: 'upsert_partner',
        operation: 'create_crm',
        status: 'pending',
      },
    ]);

    await expect(store.previewTrackerOperations(now)).resolves.toHaveLength(2);
    await expect(store.loadTrackerOperationContext(submission.id)).resolves.toMatchObject({
      dependencies: { crmKey: null, partnerKey: null },
      submission: { submissionId: 'CRAFT-20260716-TEST01' },
    });
  });
});
