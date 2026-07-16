import { createHmac } from 'node:crypto';

import {
  ApiErrorResponseSchema,
  HealthReadyResponseSchema,
  LeadDraftGetResponseSchema,
  LeadDraftUpsertResponseSchema,
  MaxAuthResponseSchema,
  MaxContactVerifyResponseSchema,
  SubmissionCreateResponseSchema,
  SubmissionReadResponseSchema,
  privacyConsentText,
  termsAcceptanceText,
  type LeadDraft,
  type LeadDraftUpsertRequest,
  type MaxAuthResponse,
  type PrivacyConsentEvidence,
  type Submission,
  type SubmissionCreateRequest,
  type TermsAcceptanceEvidence,
} from '@craft72/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ValidatedMaxInitData, VerifiedMaxContact } from './max-auth.js';
import type { AcceptedMaxWebhook } from './max-webhook.js';
import type { AuthenticatedSession, Stage3Store } from './repository.js';
import { buildStage3Api } from './server.js';

const BOT_TOKEN = 'stage-3-server-test-token-with-enough-entropy';
const WEBHOOK_SECRET = 'stage-4-webhook-secret-with-enough-entropy';
const NOW = new Date('2026-07-15T10:00:00.000Z');
const DRAFT_ID = 'a5fd2117-1821-419f-8ed7-6e9b2b9d4133';

const leadPayload = {
  role: 'developer',
  fullName: 'Иван Петров',
  organization: 'ООО Девелопмент',
  inn: '7707083893',
  objectType: 'office',
  location: { city: 'Тюмень', region: 'Тюменская область' },
  scope: { kind: 'single_object' },
  area: { status: 'known', squareMeters: 12_500 },
  currentStage: 'concept',
  services: ['architecture'],
  expertiseRequired: 'unknown',
  culturalHeritageSite: 'no',
  desiredStart: { status: 'known', date: '2026-09-01' },
  description: 'Нужна концепция и проектная документация.',
  links: ['https://files.example.com/project-brief'],
  documentIds: [],
  selectedCaseIds: [],
  contact: { phone: '+79991234567', email: 'client@example.com' },
  consent: { version: 'personal-data-v1', accepted: true },
} as const;

const draftPayload = {
  ...leadPayload,
  scope: { kind: 'single_object' },
  area: { status: 'known', squareMeters: '12500' },
  desiredStart: { status: 'known', date: '2026-09-01' },
} as const;

interface MutableSession extends AuthenticatedSession {
  phoneVerifiedAt: Date | null;
  verifiedPhone: string | null;
}

class MemoryStage3Store implements Stage3Store {
  public ready = true;
  readonly acceptedWebhooks = new Map<string, AcceptedMaxWebhook>();
  readonly #drafts = new Map<string, LeadDraft>();
  readonly #sessions = new Map<string, MutableSession>();
  readonly #submissions = new Map<string, Submission>();
  #sessionSequence = 0;

  public async acceptMaxWebhook(event: AcceptedMaxWebhook): Promise<boolean> {
    if (this.acceptedWebhooks.has(event.eventKey)) return false;
    this.acceptedWebhooks.set(event.eventKey, event);
    return true;
  }

  public async isReady(): Promise<void> {
    if (!this.ready) throw new Error('database unavailable');
  }

  public async cleanupExpired(): Promise<void> {
    return undefined;
  }

  public async createSession(
    initData: ValidatedMaxInitData,
    consent: PrivacyConsentEvidence,
    terms: TermsAcceptanceEvidence,
  ): Promise<MaxAuthResponse> {
    this.#sessionSequence += 1;
    const token = String.fromCharCode(64 + this.#sessionSequence).repeat(43);
    const expiresAt = new Date(NOW.getTime() + 3_600_000);
    this.#sessions.set(token, {
      consentedAt: NOW,
      consentTextHash: 'a'.repeat(64),
      consentVersion: consent.version,
      sessionId: `00000000-0000-4000-8000-${String(this.#sessionSequence).padStart(12, '0')}`,
      maxUserId: initData.user.id,
      expiresAt,
      startParam: initData.startParam,
      termsVersion: terms.version,
      termsAcceptedAt: NOW,
      termsTextHash: 'b'.repeat(64),
      verifiedPhone: null,
      phoneVerifiedAt: null,
    });
    return {
      authenticated: true,
      user: initData.user,
      session: { token, expiresAt: expiresAt.toISOString(), verifiedContact: null },
      startParam: initData.startParam,
    };
  }

  public async authenticate(token: string): Promise<AuthenticatedSession | null> {
    return this.#sessions.get(token) ?? null;
  }

  public async setVerifiedContact(
    session: AuthenticatedSession,
    contact: VerifiedMaxContact,
  ): Promise<void> {
    const stored = [...this.#sessions.values()].find(
      ({ sessionId }) => sessionId === session.sessionId,
    );
    if (stored === undefined) throw new Error('missing session');
    stored.verifiedPhone = contact.phone;
    stored.phoneVerifiedAt = contact.verifiedAt;
  }

  public async getDraft(session: AuthenticatedSession): Promise<LeadDraft | null> {
    return this.#drafts.get(session.maxUserId) ?? null;
  }

  public async upsertDraft(
    session: AuthenticatedSession,
    request: LeadDraftUpsertRequest,
  ): Promise<LeadDraft> {
    const draft: LeadDraft = {
      id: DRAFT_ID,
      currentStep: request.currentStep,
      payload: request.payload,
      source: session.startParam,
      updatedAt: NOW.toISOString(),
      expiresAt: new Date(NOW.getTime() + 86_400_000).toISOString(),
    };
    this.#drafts.set(session.maxUserId, draft);
    return draft;
  }

  public async createSubmission(
    session: AuthenticatedSession,
    request: SubmissionCreateRequest,
  ): Promise<Submission> {
    const key = `${session.maxUserId}:${request.idempotencyKey}`;
    const existing = this.#submissions.get(key);
    if (existing !== undefined) return existing;
    const submission: Submission = {
      submissionId: `CRAFT-${session.maxUserId.padStart(6, '0')}`,
      status: 'received',
      payload: request.payload,
      phoneVerified: session.verifiedPhone === request.payload.contact.phone,
      materials: [],
      matchedCases: [],
      submittedAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    };
    this.#submissions.set(key, submission);
    this.#submissions.set(`${session.maxUserId}:${submission.submissionId}`, submission);
    return submission;
  }

  public async getSubmission(
    session: AuthenticatedSession,
    submissionId: string,
  ): Promise<Submission | null> {
    return this.#submissions.get(`${session.maxUserId}:${submissionId}`) ?? null;
  }
}

function signInitData(userId: string): string {
  const values = [
    ['auth_date', String(Math.floor(NOW.getTime() / 1_000) - 30)],
    ['query_id', `query-${userId}`],
    ['start_param', 'new_project'],
    [
      'user',
      JSON.stringify({
        id: Number(userId),
        first_name: 'Max',
        last_name: 'User',
        username: null,
        language_code: 'ru',
        photo_url: null,
      }),
    ],
  ] as const;
  const canonical = values.map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const hash = createHmac('sha256', secret).update(canonical).digest('hex');
  return [...values, ['hash', hash] as const]
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
}

async function authenticate(app: Awaited<ReturnType<typeof buildStage3Api>>, userId: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/max',
    headers: { origin: 'https://craft72app.ru' },
    payload: {
      initData: signInitData(userId),
      privacyConsent: {
        accepted: true,
        acceptedAt: NOW.toISOString(),
        text: privacyConsentText(leadPayload.consent.version),
        version: leadPayload.consent.version,
      },
      termsAcceptance: {
        accepted: true,
        acceptedAt: NOW.toISOString(),
        text: termsAcceptanceText(leadPayload.consent.version),
        version: leadPayload.consent.version,
      },
    },
  });
  expect(response.statusCode).toBe(200);
  return MaxAuthResponseSchema.parse(response.json());
}

describe('Stage 3 API', () => {
  let store: MemoryStage3Store;
  let app: Awaited<ReturnType<typeof buildStage3Api>>;

  beforeEach(async () => {
    store = new MemoryStage3Store();
    app = await buildStage3Api({
      store,
      botToken: BOT_TOKEN,
      maxWebhookSecret: WEBHOOK_SECRET,
      consentVersion: leadPayload.consent.version,
      initDataMaxAgeSeconds: 3_600,
      contactMaxAgeSeconds: 300,
      publicBaseUrl: 'https://craft72app.ru',
      rateLimitMax: 100,
      rateLimitWindowSeconds: 60,
      now: () => NOW,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('reports liveness and database readiness without configuration', async () => {
    const live = await app.inject({ method: 'GET', url: '/health/live' });
    expect(live.statusCode).toBe(200);
    expect(live.json()).toEqual({ status: 'ok', timestamp: NOW.toISOString() });

    const ready = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(HealthReadyResponseSchema.parse(ready.json()).status).toBe('ok');
    store.ready = false;
    const unavailable = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(unavailable.statusCode).toBe(503);
    expect(HealthReadyResponseSchema.parse(unavailable.json()).status).toBe('unavailable');
    expect(unavailable.body).not.toContain(BOT_TOKEN);
  });

  it('authenticates, validates and deduplicates MAX webhooks before acknowledging them', async () => {
    const payload = {
      update_type: 'bot_started',
      timestamp: 1_784_102_400_000,
      chat_id: 9007199254740991,
      user: { user_id: 101, first_name: 'Иван' },
    };

    const missing = await app.inject({ method: 'POST', url: '/webhooks/max', payload });
    expect(missing.statusCode).toBe(401);
    expect(missing.body).not.toContain(WEBHOOK_SECRET);

    const wrong = await app.inject({
      method: 'POST',
      url: '/webhooks/max',
      headers: { 'x-max-bot-api-secret': `${WEBHOOK_SECRET}-wrong` },
      payload,
    });
    expect(wrong.statusCode).toBe(401);

    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        app.inject({
          method: 'POST',
          url: '/webhooks/max',
          headers: { 'x-max-bot-api-secret': WEBHOOK_SECRET },
          payload,
        }),
      ),
    );
    expect(responses.every(({ statusCode }) => statusCode === 200)).toBe(true);
    expect(responses.filter((response) => response.json().duplicate === false)).toHaveLength(1);
    expect(store.acceptedWebhooks.size).toBe(1);
    expect([...store.acceptedWebhooks.values()][0]?.chatId).toBe(9007199254740991n);
  });

  it('accepts forward-compatible webhook types but rejects malformed envelopes', async () => {
    const unknown = await app.inject({
      method: 'POST',
      url: '/webhooks/max',
      headers: { 'x-max-bot-api-secret': WEBHOOK_SECRET },
      payload: { update_type: 'future_event', timestamp: 1, future_field: { enabled: true } },
    });
    expect(unknown.statusCode).toBe(200);
    expect(store.acceptedWebhooks.size).toBe(1);

    const malformed = await app.inject({
      method: 'POST',
      url: '/webhooks/max',
      headers: { 'x-max-bot-api-secret': WEBHOOK_SECRET },
      payload: { update_type: '', timestamp: 'now' },
    });
    expect(malformed.statusCode).toBe(400);
    expect(ApiErrorResponseSchema.parse(malformed.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects forged and malformed MAX authentication safely', async () => {
    const forged = await app.inject({
      method: 'POST',
      url: '/api/auth/max',
      payload: {
        initData: signInitData('101').replace('Max', 'Mallory'),
        privacyConsent: {
          accepted: true,
          acceptedAt: NOW.toISOString(),
          text: privacyConsentText(leadPayload.consent.version),
          version: leadPayload.consent.version,
        },
        termsAcceptance: {
          accepted: true,
          acceptedAt: NOW.toISOString(),
          text: termsAcceptanceText(leadPayload.consent.version),
          version: leadPayload.consent.version,
        },
      },
    });
    expect(forged.statusCode).toBe(401);
    expect(ApiErrorResponseSchema.parse(forged.json()).error.code).toBe('MAX_AUTH_INVALID');
    expect(forged.body).not.toContain(BOT_TOKEN);

    const malformed = await app.inject({
      method: 'POST',
      url: '/api/auth/max',
      payload: { initDataUnsafe: { user: { id: 101 } } },
    });
    expect(malformed.statusCode).toBe(400);
    expect(ApiErrorResponseSchema.parse(malformed.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('persists a server draft and creates one idempotent submission', async () => {
    const auth = await authenticate(app, '101');
    const headers = { authorization: `Bearer ${auth.session.token}` };
    const initial = await app.inject({ method: 'GET', url: '/api/leads/draft', headers });
    expect(LeadDraftGetResponseSchema.parse(initial.json()).draft).toBeNull();

    const saved = await app.inject({
      method: 'POST',
      url: '/api/leads/draft',
      headers,
      payload: { currentStep: 17, payload: draftPayload },
    });
    expect(LeadDraftUpsertResponseSchema.parse(saved.json()).draft.id).toBe(DRAFT_ID);

    const request = {
      draftId: DRAFT_ID,
      idempotencyKey: `stage3-${DRAFT_ID}`,
      payload: leadPayload,
    };
    const created = await app.inject({
      method: 'POST',
      url: '/api/submissions',
      headers,
      payload: request,
    });
    const submission = SubmissionCreateResponseSchema.parse(created.json()).submission;
    const repeated = await app.inject({
      method: 'POST',
      url: '/api/submissions',
      headers,
      payload: request,
    });
    expect(SubmissionCreateResponseSchema.parse(repeated.json()).submission.submissionId).toBe(
      submission.submissionId,
    );

    const read = await app.inject({
      method: 'GET',
      url: `/api/submissions/${submission.submissionId}`,
      headers,
    });
    expect(SubmissionReadResponseSchema.parse(read.json()).submission).toEqual(submission);
  });

  it('does not reveal another MAX user submission', async () => {
    const first = await authenticate(app, '201');
    const second = await authenticate(app, '202');
    const created = await app.inject({
      method: 'POST',
      url: '/api/submissions',
      headers: { authorization: `Bearer ${first.session.token}` },
      payload: { idempotencyKey: 'stage3-rbac-201', payload: leadPayload },
    });
    const submission = SubmissionCreateResponseSchema.parse(created.json()).submission;
    const foreignRead = await app.inject({
      method: 'GET',
      url: `/api/submissions/${submission.submissionId}`,
      headers: { authorization: `Bearer ${second.session.token}` },
    });
    expect(foreignRead.statusCode).toBe(404);
    expect(ApiErrorResponseSchema.parse(foreignRead.json()).error.code).toBe(
      'SUBMISSION_NOT_FOUND',
    );
  });

  it('verifies a MAX contact against the authenticated user', async () => {
    const auth = await authenticate(app, '301');
    const authDate = String(Math.floor(NOW.getTime() / 1_000) - 10);
    const phone = '+79991234567';
    const hash = createHmac('sha256', BOT_TOKEN)
      .update(`authDate=${authDate}\nphone=79991234567\nuserId=301`)
      .digest('hex');
    const verified = await app.inject({
      method: 'POST',
      url: '/api/contact/verify',
      headers: { authorization: `Bearer ${auth.session.token}` },
      payload: { phone, authDate, hash },
    });
    expect(verified.statusCode).toBe(200);
    expect(MaxContactVerifyResponseSchema.parse(verified.json())).toEqual({
      phone,
      verified: true,
      verifiedAt: NOW.toISOString(),
    });
  });

  it('requires a bearer session for every protected endpoint', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/leads/draft' });
    expect(response.statusCode).toBe(401);
    expect(ApiErrorResponseSchema.parse(response.json()).error.code).toBe('UNAUTHORIZED');
    expect(response.headers['x-request-id']).toMatch(/^[A-Fa-f0-9-]{36}$/);
  });

  it('rejects an obsolete consent version before writing a submission', async () => {
    const auth = await authenticate(app, '401');
    const response = await app.inject({
      method: 'POST',
      url: '/api/submissions',
      headers: { authorization: `Bearer ${auth.session.token}` },
      payload: {
        idempotencyKey: 'stage3-obsolete-consent',
        payload: {
          ...leadPayload,
          consent: { accepted: true, version: 'obsolete-v0' },
        },
      },
    });

    expect(response.statusCode).toBe(400);
    const error = ApiErrorResponseSchema.parse(response.json()).error;
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.issues?.[0]?.path).toEqual(['payload', 'consent', 'version']);
  });
});
