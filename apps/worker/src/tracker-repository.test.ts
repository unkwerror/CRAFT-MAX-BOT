import type { Database } from '@craft72/database';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { PostgresTrackerOutboxStore, type ClaimedTrackerOperation } from './tracker-repository.js';

const NOW = new Date('2026-07-16T05:00:00.000Z');
const LEASE_EXPIRES_AT = new Date('2026-07-16T05:01:30.000Z');
const LEASE_TOKEN = '10000000-0000-4000-8000-000000000009';

interface FakeResult {
  readonly rowCount: number;
  readonly rows: readonly Record<string, unknown>[];
}

class FakeDatabase {
  public readonly queries: string[] = [];
  public readonly parameters: readonly unknown[][] = [];
  readonly #results: FakeResult[];
  readonly #dialect = new PgDialect();

  public constructor(results: readonly FakeResult[]) {
    this.#results = [...results];
  }

  public async execute(query: SQL): Promise<FakeResult> {
    const rendered = this.#dialect.sqlToQuery(query);
    this.queries.push(rendered.sql);
    (this.parameters as unknown[][]).push(rendered.params);
    const result = this.#results.shift();
    if (result === undefined) throw new Error('Fake database has no queued result');
    return result;
  }

  public async transaction<T>(callback: (transaction: FakeDatabase) => Promise<T>): Promise<T> {
    return callback(this);
  }

  public database(): Database {
    return this as unknown as Database;
  }
}

function claim(): ClaimedTrackerOperation {
  return {
    attempts: 1,
    id: '10000000-0000-4000-8000-000000000001',
    leaseToken: LEASE_TOKEN,
    operation: 'upsert_partner',
    payload: { schemaVersion: 1 },
    submissionDatabaseId: '10000000-0000-4000-8000-000000000002',
  };
}

describe('PostgreSQL Tracker outbox repository', () => {
  it('claims a dependency-ready operation with SKIP LOCKED and a fresh fenced lease', async () => {
    const database = new FakeDatabase([
      {
        rowCount: 1,
        rows: [
          {
            attempts: 1,
            id: claim().id,
            leaseToken: LEASE_TOKEN,
            operation: 'upsert_partner',
            payload: { schemaVersion: 1 },
            submissionDatabaseId: claim().submissionDatabaseId,
          },
        ],
      },
    ]);
    const store = new PostgresTrackerOutboxStore(database.database());

    await expect(store.claimTrackerOperation(NOW, LEASE_EXPIRES_AT, LEASE_TOKEN)).resolves.toEqual(
      claim(),
    );

    expect(database.queries[0]).toContain('for update of current_operation skip locked');
    expect(database.queries[0]).toContain("dependency.status = 'completed'");
    expect(database.queries[0]).toContain('lease_token = $');
    expect(database.queries[0]).toContain('attempts = claimed_operation.attempts + 1');
    expect(database.parameters[0]).toEqual(
      expect.arrayContaining([NOW, LEASE_TOKEN, LEASE_EXPIRES_AT]),
    );
  });

  it('previews with a SELECT only, leaving outbox state and HTTP delivery untouched', async () => {
    const database = new FakeDatabase([
      {
        rowCount: 1,
        rows: [
          {
            id: claim().id,
            operation: 'upsert_partner',
            payload: { schemaVersion: 1 },
            submissionDatabaseId: claim().submissionDatabaseId,
          },
        ],
      },
    ]);
    const store = new PostgresTrackerOutboxStore(database.database());

    await expect(store.previewTrackerOperations(NOW)).resolves.toEqual([
      expect.objectContaining({ id: claim().id, operation: 'upsert_partner' }),
    ]);
    expect(database.queries[0]?.trimStart().startsWith('select')).toBe(true);
    expect(database.queries[0]).not.toContain('for update');
    expect(database.queries[0]).not.toContain('set status');
    expect(database.queries[0]).not.toContain("dependency.status = 'completed'");
    expect(database.queries[0]).not.toContain('limit 1');
  });

  it('idempotently backfills ordered PART, CRM and material DOCS rows in one transaction', async () => {
    const database = new FakeDatabase([
      { rowCount: 2, rows: [] },
      { rowCount: 2, rows: [] },
      { rowCount: 1, rows: [] },
    ]);
    const store = new PostgresTrackerOutboxStore(database.database());

    await expect(store.backfillTrackerOutbox(NOW)).resolves.toBe(5);

    expect(database.queries).toHaveLength(3);
    expect(database.queries[0]).toContain("'upsert_partner'");
    expect(database.queries[1]).toContain("'create_crm'");
    expect(database.queries[1]).toContain("'upsert_partner'");
    expect(database.queries[2]).toContain("'create_docs'");
    expect(database.queries[2]).toContain('cardinality(source_submission.material_links) > 0');
    expect(database.queries[2]).toContain("source_document.scan_status = 'clean'");
    expect(database.queries[2]?.match(/:docs:v1/g)).toHaveLength(1);
    expect(database.queries[2]).toMatch(/:docs:v1'\),\s+jsonb_build_object\('schemaVersion', 1\)/);
    for (const query of database.queries) expect(query).toContain('on conflict do nothing');
  });

  it('completes only with matching ID, attempt and lease token, then advances submission state', async () => {
    const database = new FakeDatabase([
      { rowCount: 1, rows: [] },
      { rowCount: 1, rows: [] },
    ]);
    const store = new PostgresTrackerOutboxStore(database.database());

    await expect(store.completeTrackerOperation(claim(), 'PART-10', NOW)).resolves.toBeUndefined();

    expect(database.queries[0]).toContain("status = 'processing'");
    expect(database.queries[0]).toContain('attempts = $');
    expect(database.queries[0]).toContain('lease_token = $');
    expect(database.parameters[0]).toEqual(
      expect.arrayContaining([claim().id, claim().attempts, LEASE_TOKEN, 'PART-10']),
    );
    expect(database.queries[1]).toContain('tracker_part_key = $');
    expect(database.queries[1]).toContain("then 'sync_failed'");
    expect(database.queries[1]).toContain("then 'syncing'");
    expect(database.queries[1]).toContain("else 'synced'");
  });

  it('rejects a stale completion when fencing no longer matches', async () => {
    const database = new FakeDatabase([{ rowCount: 0, rows: [] }]);
    const store = new PostgresTrackerOutboxStore(database.database());

    await expect(store.completeTrackerOperation(claim(), 'PART-10', NOW)).rejects.toThrow(
      'claim lease was lost',
    );
    expect(database.queries).toHaveLength(1);
  });

  it('dead-letters blocked dependants after a permanent fenced failure', async () => {
    const database = new FakeDatabase([
      { rowCount: 1, rows: [] },
      { rowCount: 2, rows: [] },
      { rowCount: 1, rows: [] },
    ]);
    const store = new PostgresTrackerOutboxStore(database.database());

    await expect(
      store.failTrackerOperation(claim(), 'tracker_http_400', null, NOW),
    ).resolves.toBeUndefined();

    expect(database.queries[0]).toContain('status = $');
    expect(database.queries[0]).toContain('attempts = $');
    expect(database.queries[0]).toContain('lease_token = $');
    expect(database.parameters[0]).toEqual(
      expect.arrayContaining(['dead_letter', 'tracker_http_400', LEASE_TOKEN]),
    );
    expect(database.queries[1]).toContain("last_error_code = 'tracker_dependency_failed'");
    expect(database.queries[1]).toContain("status in ('pending', 'retry')");
    expect(database.parameters[2]).toContain('sync_failed');
  });

  it('loads a submission snapshot and only clean active document metadata', async () => {
    const database = new FakeDatabase([
      {
        rowCount: 1,
        rows: [
          {
            areaSquareMeters: '12500.00',
            city: 'Тюмень',
            contactEmail: 'client@example.com',
            contactName: 'Иван Петров',
            contactPhone: '+79991234567',
            crmKey: 'CRM-20',
            culturalHeritage: false,
            description: 'Нужна концепция',
            desiredStart: null,
            expertiseRequired: null,
            inn: '7707083893',
            materialLinks: [],
            maxUserId: '123456789',
            objectCount: 1,
            objectType: 'office',
            organization: 'ООО Девелопмент',
            partnerKey: 'PART-10',
            projectScope: 'single_object',
            projectStage: 'concept',
            region: 'Тюменская область',
            role: 'developer',
            selectedCaseIds: [],
            services: ['architecture'],
            submissionId: 'CRAFT-20260716-ABCDEF',
          },
        ],
      },
      {
        rowCount: 1,
        rows: [
          {
            id: '10000000-0000-4000-8000-000000000003',
            mimeType: 'application/pdf',
            originalName: 'brief.pdf',
            sha256: 'a'.repeat(64),
            sizeBytes: '1024',
          },
        ],
      },
    ]);
    const store = new PostgresTrackerOutboxStore(database.database());

    await expect(store.loadTrackerOperationContext(claim().submissionDatabaseId)).resolves.toEqual({
      dependencies: { crmKey: 'CRM-20', partnerKey: 'PART-10' },
      submission: expect.objectContaining({
        documents: [expect.objectContaining({ originalName: 'brief.pdf', sizeBytes: 1_024 })],
        maxUserId: '123456789',
        submissionId: 'CRAFT-20260716-ABCDEF',
      }),
    });
    expect(database.queries[1]).toContain("source_document.scan_status = 'clean'");
    expect(database.queries[1]).toContain('source_document.deleted_at is null');
  });
});
