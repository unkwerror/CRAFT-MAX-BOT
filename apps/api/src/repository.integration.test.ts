import { fileURLToPath } from 'node:url';

import { privacyConsentText, termsAcceptanceText } from '@craft72/contracts';
import { createDatabaseClient } from '@craft72/database';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresStage3Store } from './repository.js';

const databaseUrl = process.env.DATABASE_URL;
const destructiveTestEnabled = process.env.REPOSITORY_TEST_ALLOW_DESTRUCTIVE === 'true';
const describeWithDatabase =
  databaseUrl !== undefined && destructiveTestEnabled ? describe : describe.skip;

describeWithDatabase('PostgresStage3Store integration', () => {
  const connectionString =
    databaseUrl ?? 'postgresql://disabled@127.0.0.1/craft72_repository_disabled_test';
  const databaseName = new URL(connectionString).pathname.slice(1);
  if (!databaseName.endsWith('_test')) {
    throw new Error('Repository integration tests require a database name ending in _test');
  }

  const client = createDatabaseClient({ connectionString, max: 2 });
  let releaseIsolationLock: (() => Promise<void>) | null = null;
  let now = new Date('2026-07-15T10:00:00.000Z');
  const store = new PostgresStage3Store(client.db, {
    draftTtlSeconds: 60,
    now: () => now,
    sessionTtlSeconds: 60,
    submissionRetentionDays: 30,
  });
  const version = 'miniapp-2026-07-15';

  beforeAll(async () => {
    const isolationConnection = await client.pool.connect();
    await isolationConnection.query('select pg_advisory_lock(724256)');
    releaseIsolationLock = async () => {
      await isolationConnection.query('select pg_advisory_unlock(724256)');
      isolationConnection.release();
    };
    await migrate(client.db, {
      migrationsFolder: fileURLToPath(
        new URL('../../../packages/database/drizzle', import.meta.url),
      ),
    });
  });

  afterAll(async () => {
    if (releaseIsolationLock !== null) {
      await releaseIsolationLock();
    }
    await client.close();
  });

  it('persists separate consent evidence and removes expired orphaned data', async () => {
    const authentication = await store.createSession(
      {
        authDate: new Date(now.getTime() - 1_000),
        queryId: 'repository-integration',
        startParam: 'new_project',
        user: {
          id: '900000000000000001',
          firstName: 'Integration',
          lastName: 'Test',
          username: null,
          languageCode: 'ru',
          photoUrl: null,
        },
      },
      {
        accepted: true,
        acceptedAt: now.toISOString(),
        text: privacyConsentText(version),
        version,
      },
      {
        accepted: true,
        acceptedAt: now.toISOString(),
        text: termsAcceptanceText(version),
        version,
      },
    );

    const session = await store.authenticate(authentication.session.token);
    expect(session).toMatchObject({ consentVersion: version, termsVersion: version });
    if (session === null) throw new Error('Expected an active session');

    await store.upsertDraft(session, {
      currentStep: 1,
      payload: { fullName: 'Integration Test' },
    });

    const evidence = await client.pool.query<{
      consent_text_hash: string;
      terms_text_hash: string;
    }>(
      `select consent_text_hash, terms_text_hash
         from sessions
        where id = $1`,
      [session.sessionId],
    );
    expect(evidence.rows[0]?.consent_text_hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(evidence.rows[0]?.terms_text_hash).toMatch(/^[0-9a-f]{64}$/u);

    const draftEvidence = await client.pool.query<{
      consent_text_hash: string;
      consent_version: string;
      terms_text_hash: string;
      terms_version: string;
    }>(
      `select consent_version, consent_text_hash, terms_version, terms_text_hash
         from lead_drafts
        where max_user_id = $1`,
      ['900000000000000001'],
    );
    expect(draftEvidence.rows[0]).toEqual({
      consent_text_hash: evidence.rows[0]?.consent_text_hash,
      consent_version: version,
      terms_text_hash: evidence.rows[0]?.terms_text_hash,
      terms_version: version,
    });

    now = new Date(now.getTime() + 61_000);
    await store.cleanupExpired();

    const counts = await client.pool.query<{
      drafts: string;
      sessions: string;
      users: string;
    }>(
      `select
         (select count(*) from lead_drafts)::text as drafts,
         (select count(*) from sessions)::text as sessions,
         (select count(*) from max_users)::text as users`,
    );
    expect(counts.rows[0]).toEqual({ drafts: '0', sessions: '0', users: '0' });
  });
});
