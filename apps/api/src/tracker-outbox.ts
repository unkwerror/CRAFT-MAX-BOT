import type { integrationOutbox, JsonObject } from '@craft72/database';

type IntegrationOutboxInsert = typeof integrationOutbox.$inferInsert;

export interface TrackerOutboxRowsOptions {
  readonly hasMaterials: boolean;
  readonly now: Date;
  readonly submissionDatabaseId: string;
  readonly submissionId: string;
}

const TRACKER_OUTBOX_SCHEMA_VERSION = 1 as const;

function payload(): JsonObject {
  return { schemaVersion: TRACKER_OUTBOX_SCHEMA_VERSION };
}

/**
 * Builds the ordered rows which the submission repository inserts in its own transaction.
 * The payload intentionally stores only a versioned pointer; the immutable submission snapshot
 * is read by the worker from the same database when the operation is claimed.
 */
export function buildTrackerOutboxRows(
  options: TrackerOutboxRowsOptions,
): readonly IntegrationOutboxInsert[] {
  const prefix = `tracker:${options.submissionId}`;
  const common = {
    attempts: 0,
    createdAt: options.now,
    nextAttemptAt: options.now,
    status: 'pending' as const,
    submissionId: options.submissionDatabaseId,
    updatedAt: options.now,
  };
  const rows: IntegrationOutboxInsert[] = [
    {
      ...common,
      dependsOnOperation: null,
      idempotencyKey: `${prefix}:part:v1`,
      operation: 'upsert_partner',
      payload: payload(),
    },
    {
      ...common,
      dependsOnOperation: 'upsert_partner',
      idempotencyKey: `${prefix}:crm:v1`,
      operation: 'create_crm',
      payload: payload(),
    },
  ];
  if (options.hasMaterials) {
    rows.push({
      ...common,
      dependsOnOperation: 'create_crm',
      idempotencyKey: `${prefix}:docs:v1`,
      operation: 'create_docs',
      payload: payload(),
    });
  }
  return rows;
}
