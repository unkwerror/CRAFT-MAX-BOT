import { describe, expect, it } from 'vitest';

import { buildTrackerOutboxRows } from './tracker-outbox.js';

const NOW = new Date('2026-07-16T05:00:00.000Z');

describe('Tracker transactional outbox rows', () => {
  it('builds the dependency chain with stable idempotency keys', () => {
    const rows = buildTrackerOutboxRows({
      hasMaterials: true,
      now: NOW,
      submissionDatabaseId: '10000000-0000-4000-8000-000000000001',
      submissionId: 'CRAFT72-20260716-0001',
    });

    expect(rows).toMatchObject([
      {
        dependsOnOperation: null,
        idempotencyKey: 'tracker:CRAFT72-20260716-0001:part:v1',
        operation: 'upsert_partner',
        payload: { schemaVersion: 1 },
      },
      {
        dependsOnOperation: 'upsert_partner',
        idempotencyKey: 'tracker:CRAFT72-20260716-0001:crm:v1',
        operation: 'create_crm',
        payload: { schemaVersion: 1 },
      },
      {
        dependsOnOperation: 'create_crm',
        idempotencyKey: 'tracker:CRAFT72-20260716-0001:docs:v1',
        operation: 'create_docs',
        payload: { schemaVersion: 1 },
      },
    ]);
  });

  it('omits DOCS when a submission has neither files nor links', () => {
    const rows = buildTrackerOutboxRows({
      hasMaterials: false,
      now: NOW,
      submissionDatabaseId: '10000000-0000-4000-8000-000000000001',
      submissionId: 'CRAFT72-20260716-0001',
    });

    expect(rows.map(({ operation }) => operation)).toEqual(['upsert_partner', 'create_crm']);
  });
});
