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

  it('stores only hashed session credentials and an optional non-blank MAX start parameter', () => {
    const config = getTableConfig(sessions);
    const checks = config.checks.map(({ name }) => name);
    const uniqueConstraints = config.uniqueConstraints.map(({ name }) => name);

    expect(sessions.tokenHash.name).toBe('token_hash');
    expect(sessions.tokenHash.notNull).toBe(true);
    expect(sessions.tokenHash.getSQLType()).toBe('varchar(64)');
    expect(sessions.startParam.name).toBe('start_param');
    expect(sessions.startParam.notNull).toBe(false);
    expect(sessions.startParam.getSQLType()).toBe('varchar(128)');
    expect(uniqueConstraints).toContain('sessions_token_hash_unique');
    expect(checks).toContain('sessions_token_hash_format');
    expect(checks).toContain('sessions_start_param_not_blank');
  });

  it('stores separate, timestamped evidence for privacy consent and terms acceptance', () => {
    const sessionChecks = getTableConfig(sessions).checks.map(({ name }) => name);
    const draftChecks = getTableConfig(leadDrafts).checks.map(({ name }) => name);
    const submissionChecks = getTableConfig(submissions).checks.map(({ name }) => name);

    expect(sessions.consentVersion.notNull).toBe(true);
    expect(sessions.consentTextHash.notNull).toBe(true);
    expect(sessions.consentClientAcceptedAt.notNull).toBe(true);
    expect(sessions.consentedAt.notNull).toBe(true);
    expect(sessions.termsVersion.notNull).toBe(true);
    expect(sessions.termsTextHash.notNull).toBe(true);
    expect(sessions.termsClientAcceptedAt.notNull).toBe(true);
    expect(sessions.termsAcceptedAt.notNull).toBe(true);
    expect(sessionChecks).toContain('sessions_consent_version_format');
    expect(sessionChecks).toContain('sessions_consent_text_hash_format');
    expect(sessionChecks).toContain('sessions_terms_version_format');
    expect(sessionChecks).toContain('sessions_terms_text_hash_format');

    for (const column of [
      leadDrafts.consentVersion,
      leadDrafts.consentTextHash,
      leadDrafts.consentedAt,
      leadDrafts.termsVersion,
      leadDrafts.termsTextHash,
      leadDrafts.termsAcceptedAt,
      submissions.consentTextHash,
      submissions.termsVersion,
      submissions.termsTextHash,
      submissions.termsAcceptedAt,
    ]) {
      expect(column.notNull).toBe(true);
    }
    expect(draftChecks).toContain('lead_drafts_consent_version_format');
    expect(draftChecks).toContain('lead_drafts_consent_text_hash_format');
    expect(draftChecks).toContain('lead_drafts_terms_version_format');
    expect(draftChecks).toContain('lead_drafts_terms_text_hash_format');
    expect(submissionChecks).toContain('submissions_consent_text_hash_format');
    expect(submissionChecks).toContain('submissions_terms_version_format');
    expect(submissionChecks).toContain('submissions_terms_text_hash_format');
  });

  it('persists a mandatory request fingerprint for submission idempotency', () => {
    const checks = getTableConfig(submissions).checks.map(({ name }) => name);

    expect(submissions.requestHash.name).toBe('request_hash');
    expect(submissions.requestHash.notNull).toBe(true);
    expect(submissions.requestHash.getSQLType()).toBe('varchar(64)');
    expect(checks).toContain('submissions_request_hash_format');
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
