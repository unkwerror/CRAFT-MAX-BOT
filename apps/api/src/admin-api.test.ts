import { createHmac } from 'node:crypto';

import {
  AdminAuthResponseSchema,
  ApiErrorResponseSchema,
  type AdminCase,
  type AdminCaseCreateRequest,
  type AdminCaseUpdateRequest,
  type AdminContentCreateRequest,
  type AdminContentDocument,
  type AdminContentUpdateRequest,
  type AdminSubmissionListItem,
  type AdminSubmissionListQuery,
  type AdminSubmissionUpdateRequest,
  type AdminUserListItem,
  type AdminUserListQuery,
  type CaseCatalogItem,
  type LeadDraft,
  type LeadDraftUpsertRequest,
  type LeadFormData,
  type MaxAuthResponse,
  type PrivacyConsentEvidence,
  type PublicContentResponse,
  type Submission,
  type SubmissionCreateRequest,
  type TermsAcceptanceEvidence,
} from '@craft72/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ADMIN_SESSION_COOKIE, buildAdminApiModule } from './admin-api.js';
import type {
  AdminPage,
  AdminStore,
  AuthenticatedAdmin,
  CreatedAdminSession,
} from './admin-repository.js';
import {
  AdminStoreActiveDialogNotFoundError,
  AdminStoreNotFoundError,
} from './admin-repository.js';
import type { ValidatedMaxInitData, VerifiedMaxContact } from './max-auth.js';
import type { AcceptedMaxWebhook } from './max-webhook.js';
import type { AuthenticatedSession, Stage3Store } from './repository.js';
import { buildStage3Api } from './server.js';

const BOT_TOKEN = 'admin-api-test-token-with-enough-entropy';
const WEBHOOK_SECRET = 'admin-api-webhook-secret-with-enough-entropy';
const ADMIN_ID = '61096226';
const NOW = new Date('2026-07-18T08:00:00.000Z');
const EXPIRES = new Date('2026-07-18T16:00:00.000Z');
const TOKEN = 'A'.repeat(43);
const ORIGIN = 'https://craft72app.ru';
const PASSWORD = 'correct horse battery staple';
const verifyAdminPassword = vi.fn(async (password: string) => password === PASSWORD);

const adminUser = {
  id: ADMIN_ID,
  firstName: 'Анна',
  lastName: 'Администратор',
  username: 'craft_admin',
  languageCode: 'ru',
  photoUrl: null,
} as const;

const intake: LeadFormData = {
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
  links: [],
  documentIds: [],
  selectedCaseIds: [],
  contact: { phone: '+79991234567', email: 'client@example.com' },
  consent: { accepted: true, version: 'personal-data-v1' },
};

const submission: AdminSubmissionListItem = {
  submissionId: 'CRAFT-20260718-ABCDEF',
  maxUserId: '70000001',
  user: {
    id: '70000001',
    firstName: 'Иван',
    lastName: 'Петров',
    username: null,
    languageCode: 'ru',
  },
  intake,
  phoneVerified: true,
  integrationStatus: 'received',
  reviewStatus: 'new',
  adminNote: null,
  submittedAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
};

const botOnlyUser: AdminUserListItem = {
  maxUserId: '70000002',
  displayName: 'Пользователь MAX',
  identitySource: 'bot',
  user: null,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  submissionCount: 0,
  lastSubmissionAt: null,
  hasActiveDraft: false,
  botDialogCount: 2,
  lastBotEventAt: NOW.toISOString(),
};

class StageStoreStub implements Stage3Store {
  public async acceptMaxWebhook(_event: AcceptedMaxWebhook): Promise<boolean> {
    return true;
  }
  public async authenticate(_token: string): Promise<AuthenticatedSession | null> {
    return null;
  }
  public async cleanupExpired(): Promise<void> {
    return undefined;
  }
  public async createSession(
    _initData: ValidatedMaxInitData,
    _consent: PrivacyConsentEvidence,
    _terms: TermsAcceptanceEvidence,
  ): Promise<MaxAuthResponse> {
    throw new Error('not used');
  }
  public async getDraft(_session: AuthenticatedSession): Promise<LeadDraft | null> {
    return null;
  }
  public async getSubmission(
    _session: AuthenticatedSession,
    _submissionId: string,
  ): Promise<Submission | null> {
    return null;
  }
  public async isReady(): Promise<void> {
    return undefined;
  }
  public async setVerifiedContact(
    _session: AuthenticatedSession,
    _contact: VerifiedMaxContact,
  ): Promise<void> {
    return undefined;
  }
  public async upsertDraft(
    _session: AuthenticatedSession,
    _request: LeadDraftUpsertRequest,
  ): Promise<LeadDraft> {
    throw new Error('not used');
  }
  public async createSubmission(
    _session: AuthenticatedSession,
    _request: SubmissionCreateRequest,
  ): Promise<Submission> {
    throw new Error('not used');
  }
}

class MemoryAdminStore implements AdminStore {
  public readonly createSessionSpy = vi.fn();
  public readonly queueContactHandoffSpy = vi.fn();
  public readonly updateSubmissionSpy = vi.fn();
  public active = false;
  public contactHandoffError: Error | null = null;
  public currentSubmission = submission;
  public content: AdminContentDocument | null = null;
  public users: readonly AdminUserListItem[] = [];

  public async authenticate(token: string): Promise<AuthenticatedAdmin | null> {
    return this.active && token === TOKEN
      ? {
          maxUserId: ADMIN_ID,
          sessionId: 'a5fd2117-1821-419f-8ed7-6e9b2b9d4133',
          user: adminUser,
          expiresAt: EXPIRES,
        }
      : null;
  }
  public async cleanupExpired(): Promise<void> {
    return undefined;
  }
  public async createSession(
    user: typeof adminUser,
    requestId: string,
  ): Promise<CreatedAdminSession> {
    this.createSessionSpy(user, requestId);
    this.active = true;
    return {
      token: TOKEN,
      maxUserId: ADMIN_ID,
      sessionId: 'a5fd2117-1821-419f-8ed7-6e9b2b9d4133',
      user,
      expiresAt: EXPIRES,
    };
  }
  public async revokeSession(): Promise<void> {
    this.active = false;
  }
  public async listUsers(_query: AdminUserListQuery): Promise<AdminPage<AdminUserListItem>> {
    return { items: this.users, nextCursor: null };
  }
  public async listSubmissions(
    _query: AdminSubmissionListQuery,
  ): Promise<AdminPage<AdminSubmissionListItem>> {
    return { items: [this.currentSubmission], nextCursor: null };
  }
  public async getSubmission(id: string): Promise<AdminSubmissionListItem | null> {
    return id === this.currentSubmission.submissionId ? this.currentSubmission : null;
  }
  public async queueContactHandoff(
    submissionId: string,
    admin: AuthenticatedAdmin,
    requestId: string,
  ): Promise<void> {
    this.queueContactHandoffSpy(submissionId, admin, requestId);
    if (this.contactHandoffError !== null) throw this.contactHandoffError;
  }
  public async updateSubmission(
    id: string,
    update: AdminSubmissionUpdateRequest,
  ): Promise<AdminSubmissionListItem> {
    this.updateSubmissionSpy(id, update);
    this.currentSubmission = {
      ...this.currentSubmission,
      ...(update.reviewStatus === undefined ? {} : { reviewStatus: update.reviewStatus }),
      ...(update.adminNote === undefined ? {} : { adminNote: update.adminNote }),
      updatedAt: new Date(NOW.getTime() + 1_000).toISOString(),
    };
    return this.currentSubmission;
  }
  public async listCases(): Promise<readonly AdminCase[]> {
    return [];
  }
  public async listPublishedCases(): Promise<readonly CaseCatalogItem[]> {
    return [];
  }
  public async createCase(
    _input: AdminCaseCreateRequest,
    _admin: AuthenticatedAdmin,
    _requestId: string,
  ): Promise<AdminCase> {
    throw new Error('not used');
  }
  public async updateCase(
    _id: string,
    _input: AdminCaseUpdateRequest,
    _admin: AuthenticatedAdmin,
    _requestId: string,
  ): Promise<AdminCase> {
    throw new Error('not used');
  }
  public async deleteCase(): Promise<void> {
    return undefined;
  }
  public async listContent(): Promise<readonly AdminContentDocument[]> {
    return this.content === null ? [] : [this.content];
  }
  public async getContent(key: string): Promise<AdminContentDocument | null> {
    return this.content?.key === key ? this.content : null;
  }
  public async getPublishedContent(key: string): Promise<PublicContentResponse | null> {
    if (
      this.content?.key !== key ||
      this.content.published === null ||
      this.content.publishedAt === null ||
      this.content.publishedVersion === null
    ) {
      return null;
    }
    return {
      key,
      kind: this.content.kind,
      content: this.content.published,
      version: this.content.publishedVersion,
      publishedAt: this.content.publishedAt,
    };
  }
  public async createContent(input: AdminContentCreateRequest): Promise<AdminContentDocument> {
    this.content = {
      ...input,
      published: null,
      version: 1,
      publishedVersion: null,
      publishedAt: null,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    };
    return this.content;
  }
  public async updateContent(
    key: string,
    input: AdminContentUpdateRequest,
  ): Promise<AdminContentDocument> {
    if (this.content === null) throw new Error('not used');
    this.content = {
      ...this.content,
      key,
      draft: input.draft,
      version: input.expectedVersion + 1,
    };
    return this.content;
  }
  public async publishContent(
    _key: string,
    expectedVersion: number,
  ): Promise<AdminContentDocument> {
    if (this.content === null) throw new Error('not used');
    this.content = {
      ...this.content,
      published: this.content.draft,
      publishedVersion: expectedVersion,
      publishedAt: NOW.toISOString(),
    };
    return this.content;
  }
  public async deleteContent(): Promise<void> {
    this.content = null;
  }
}

function signInitData(userId: string, startParam = 'admin'): string {
  const values = [
    ['auth_date', String(Math.floor(NOW.getTime() / 1_000) - 30)],
    ['query_id', `admin-${userId}`],
    ['start_param', startParam],
    [
      'user',
      JSON.stringify({
        id: Number(userId),
        first_name: adminUser.firstName,
        last_name: adminUser.lastName,
        username: adminUser.username,
        language_code: adminUser.languageCode,
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

describe('admin API foundation', () => {
  let store: MemoryAdminStore;
  let app: Awaited<ReturnType<typeof buildStage3Api>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    store = new MemoryAdminStore();
    app = await buildStage3Api({
      admin: buildAdminApiModule({
        botToken: BOT_TOKEN,
        initDataMaxAgeSeconds: 3_600,
        now: () => NOW,
        passwordVerifier: { verify: verifyAdminPassword },
        publicBaseUrl: ORIGIN,
        store,
      }),
      store: new StageStoreStub(),
      botToken: BOT_TOKEN,
      maxWebhookSecret: WEBHOOK_SECRET,
      consentVersion: 'personal-data-v1',
      initDataMaxAgeSeconds: 3_600,
      ipRateLimitMax: 1_000,
      contactMaxAgeSeconds: 300,
      publicBaseUrl: ORIGIN,
      rateLimitMax: 100,
      rateLimitWindowSeconds: 60,
      now: () => NOW,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates only a host-only HttpOnly session usable from the embedded MAX WebView', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/password',
      headers: { origin: ORIGIN },
      payload: { initData: signInitData(ADMIN_ID), password: PASSWORD },
    });

    expect(response.statusCode).toBe(200);
    expect(AdminAuthResponseSchema.parse(response.json()).user.id).toBe(ADMIN_ID);
    expect(response.body).not.toContain(TOKEN);
    expect(response.body).not.toContain(PASSWORD);
    expect(response.headers['set-cookie']).toContain(`${ADMIN_SESSION_COOKIE}=${TOKEN}`);
    expect(response.headers['set-cookie']).toContain('Secure');
    expect(response.headers['set-cookie']).toContain('HttpOnly');
    expect(response.headers['set-cookie']).toContain('SameSite=None');
    expect(response.headers['set-cookie']).toContain('Partitioned');
    expect(response.headers['set-cookie']).not.toContain('Domain=');

    const anotherProfile = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/password',
      headers: { origin: ORIGIN },
      payload: { initData: signInitData('61096227'), password: PASSWORD },
    });
    expect(anotherProfile.statusCode).toBe(200);
    expect(AdminAuthResponseSchema.parse(anotherProfile.json()).user.id).toBe('61096227');
  });

  it('returns one credential error for wrong password, launch payload and MAX proof', async () => {
    const requests = [
      { initData: signInitData(ADMIN_ID), password: 'this password is wrong' },
      { initData: signInitData(ADMIN_ID, 'home'), password: PASSWORD },
      { initData: `${signInitData(ADMIN_ID)}forged`, password: PASSWORD },
    ];

    for (const payload of requests) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/auth/password',
        headers: { origin: ORIGIN },
        payload,
      });
      expect(response.statusCode).toBe(401);
      expect(ApiErrorResponseSchema.parse(response.json()).error.code).toBe('UNAUTHORIZED');
    }
    expect(store.createSessionSpy).not.toHaveBeenCalled();
    expect(verifyAdminPassword).toHaveBeenCalledTimes(3);
  });

  it('rejects password login outside the configured origin', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/password',
      payload: { initData: signInitData(ADMIN_ID), password: PASSWORD },
    });

    expect(response.statusCode).toBe(403);
    expect(verifyAdminPassword).not.toHaveBeenCalled();
    expect(store.createSessionSpy).not.toHaveBeenCalled();
  });

  it('does not retain the former profile-based authentication endpoint', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/max',
      headers: { origin: ORIGIN },
      payload: { initData: signInitData(ADMIN_ID) },
    });

    expect(response.statusCode).toBe(404);
  });

  it('rate limits repeated password attempts independently of the broad API quota', async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/auth/password',
        headers: { origin: ORIGIN },
        payload: { initData: signInitData(ADMIN_ID), password: 'this password is wrong' },
      });
      statuses.push(response.statusCode);
    }

    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
  });

  it('requires same-origin writes and keeps submitted intake immutable', async () => {
    store.active = true;
    const cookie = `${ADMIN_SESSION_COOKIE}=${TOKEN}`;
    const withoutOrigin = await app.inject({
      method: 'PATCH',
      url: `/api/admin/submissions/${submission.submissionId}`,
      headers: { cookie },
      payload: { expectedUpdatedAt: NOW.toISOString(), reviewStatus: 'in_review' },
    });
    expect(withoutOrigin.statusCode).toBe(403);

    const intakeMutation = await app.inject({
      method: 'PATCH',
      url: `/api/admin/submissions/${submission.submissionId}`,
      headers: { cookie, origin: ORIGIN },
      payload: { expectedUpdatedAt: NOW.toISOString(), intake },
    });
    expect(intakeMutation.statusCode).toBe(400);
    expect(store.updateSubmissionSpy).not.toHaveBeenCalled();

    const reviewUpdate = await app.inject({
      method: 'PATCH',
      url: `/api/admin/submissions/${submission.submissionId}`,
      headers: { cookie, origin: ORIGIN },
      payload: {
        expectedUpdatedAt: NOW.toISOString(),
        reviewStatus: 'in_review',
        adminNote: 'Перезвонить',
      },
    });
    expect(reviewUpdate.statusCode).toBe(200);
    expect(reviewUpdate.json()).toMatchObject({
      submission: { reviewStatus: 'in_review', adminNote: 'Перезвонить' },
    });
  });

  it('queues a MAX profile handoff only for a same-origin authenticated administrator', async () => {
    store.active = true;
    const cookie = `${ADMIN_SESSION_COOKIE}=${TOKEN}`;
    const url = `/api/admin/submissions/${submission.submissionId}/contact-handoff`;

    const withoutOrigin = await app.inject({ method: 'POST', url, headers: { cookie } });
    expect(withoutOrigin.statusCode).toBe(403);
    expect(store.queueContactHandoffSpy).not.toHaveBeenCalled();

    const response = await app.inject({
      method: 'POST',
      url,
      headers: { cookie, origin: ORIGIN },
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ queued: true });
    expect(store.queueContactHandoffSpy).toHaveBeenCalledOnce();
    expect(store.queueContactHandoffSpy.mock.calls[0]?.[0]).toBe(submission.submissionId);
    expect(store.queueContactHandoffSpy.mock.calls[0]?.[1]).toMatchObject({
      maxUserId: ADMIN_ID,
    });
  });

  it('does not queue a contact handoff without a session and translates store failures', async () => {
    const url = `/api/admin/submissions/${submission.submissionId}/contact-handoff`;
    const headers = { origin: ORIGIN };

    const unauthenticated = await app.inject({ method: 'POST', url, headers });
    expect(unauthenticated.statusCode).toBe(401);
    expect(store.queueContactHandoffSpy).not.toHaveBeenCalled();

    store.active = true;
    store.contactHandoffError = new AdminStoreNotFoundError();
    const missing = await app.inject({
      method: 'POST',
      url,
      headers: { ...headers, cookie: `${ADMIN_SESSION_COOKIE}=${TOKEN}` },
    });
    expect(missing.statusCode).toBe(404);

    store.contactHandoffError = new AdminStoreActiveDialogNotFoundError();
    const unavailable = await app.inject({
      method: 'POST',
      url,
      headers: { ...headers, cookie: `${ADMIN_SESSION_COOKIE}=${TOKEN}` },
    });
    expect(unavailable.statusCode).toBe(409);
    expect(ApiErrorResponseSchema.parse(unavailable.json()).error.code).toBe(
      'CONTACT_HANDOFF_UNAVAILABLE',
    );
  });

  it('clears the cross-site MAX WebView cookie on logout', async () => {
    store.active = true;
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/logout',
      headers: { cookie: `${ADMIN_SESSION_COOKIE}=${TOKEN}`, origin: ORIGIN },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['set-cookie']).toContain('Max-Age=0');
    expect(response.headers['set-cookie']).toContain('SameSite=None');
    expect(response.headers['set-cookie']).toContain('Partitioned');
    expect(response.headers['set-cookie']).not.toContain('Domain=');
  });

  it('returns bot-only identities through the same protected users endpoint', async () => {
    store.active = true;
    store.users = [botOnlyUser];
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/users?limit=25',
      headers: { cookie: `${ADMIN_SESSION_COOKIE}=${TOKEN}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [botOnlyUser], nextCursor: null });
  });

  it('publishes a versioned questionnaire without exposing its draft publicly', async () => {
    store.active = true;
    const headers = {
      cookie: `${ADMIN_SESSION_COOKIE}=${TOKEN}`,
      origin: ORIGIN,
    };
    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/content',
      headers,
      payload: {
        key: 'lead-questionnaire',
        kind: 'questionnaire',
        draft: { steps: [{ id: 'role', title: 'Ваша роль' }] },
      },
    });
    expect(created.statusCode).toBe(201);

    const beforePublish = await app.inject({
      method: 'GET',
      url: '/api/content/lead-questionnaire',
    });
    expect(beforePublish.statusCode).toBe(404);

    const published = await app.inject({
      method: 'POST',
      url: '/api/admin/content/lead-questionnaire/publish',
      headers,
      payload: { expectedVersion: 1 },
    });
    expect(published.statusCode).toBe(200);

    const publicContent = await app.inject({
      method: 'GET',
      url: '/api/content/lead-questionnaire',
    });
    expect(publicContent.statusCode).toBe(200);
    expect(publicContent.json()).toMatchObject({
      key: 'lead-questionnaire',
      version: 1,
      content: { steps: [{ id: 'role', title: 'Ваша роль' }] },
    });
  });
});
