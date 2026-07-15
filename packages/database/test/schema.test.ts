import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import {
  documents,
  integrationOperationEnum,
  integrationOutbox,
  leadDrafts,
  maxUsers,
  sessions,
  submissions,
  webhookInbox,
} from '../src/schema.js';

describe('database schema', () => {
  it('exports every MVP table', () => {
    const names = [
      maxUsers,
      sessions,
      leadDrafts,
      submissions,
      documents,
      webhookInbox,
      integrationOutbox,
    ].map((table) => getTableConfig(table).name);

    expect(names).toEqual([
      'max_users',
      'sessions',
      'lead_drafts',
      'submissions',
      'documents',
      'webhook_inbox',
      'integration_outbox',
    ]);
  });

  it('uses database constraints for externally supplied idempotency keys', () => {
    const submissionConstraints = getTableConfig(submissions).uniqueConstraints.map(
      ({ name }) => name,
    );
    const outboxConstraints = getTableConfig(integrationOutbox).uniqueConstraints.map(
      ({ name }) => name,
    );

    expect(submissionConstraints).toContain('submissions_user_idempotency_key_unique');
    expect(outboxConstraints).toContain('integration_outbox_idempotency_key_unique');
    expect(outboxConstraints).toContain('integration_outbox_submission_operation_unique');
    expect(getTableConfig(webhookInbox).primaryKeys).toHaveLength(0);
    expect(webhookInbox.eventKey.primary).toBe(true);
  });

  it('limits Tracker operations to the approved transactional outbox set', () => {
    expect(integrationOperationEnum.enumValues).toEqual([
      'upsert_partner',
      'create_crm',
      'create_docs',
    ]);
  });

  it('keeps all required ownership foreign keys in the schema', () => {
    expect(getTableConfig(sessions).foreignKeys).toHaveLength(1);
    expect(getTableConfig(leadDrafts).foreignKeys).toHaveLength(1);
    expect(getTableConfig(submissions).foreignKeys).toHaveLength(1);
    expect(getTableConfig(documents).foreignKeys).toHaveLength(2);
    expect(getTableConfig(integrationOutbox).foreignKeys).toHaveLength(1);
  });

  it('persists a verified contact only as a consistent server session snapshot', () => {
    const checks = getTableConfig(sessions).checks.map(({ name }) => name);

    expect(sessions.verifiedPhone.notNull).toBe(false);
    expect(sessions.phoneVerifiedAt.notNull).toBe(false);
    expect(checks).toContain('sessions_verified_phone_format');
    expect(checks).toContain('sessions_verified_contact_consistent');
    expect(checks).toContain('sessions_phone_verification_within_lifetime');
  });

  it('accepts either a city or a region while rejecting a missing location', () => {
    const checks = getTableConfig(submissions).checks.map(({ name }) => name);

    expect(submissions.city.notNull).toBe(false);
    expect(submissions.region.notNull).toBe(false);
    expect(checks).toContain('submissions_location_present');
  });

  it('supports user-owned staged uploads before a submission exists', () => {
    const config = getTableConfig(documents);

    expect(documents.submissionId.notNull).toBe(false);
    expect(documents.maxUserId.notNull).toBe(true);
    expect(config.indexes.map(({ config: { name } }) => name)).toContain(
      'documents_staged_user_sha256_uidx',
    );
  });
});
