import {
  privacyConsentText,
  termsAcceptanceText,
  type LeadDraftUpsertResponse,
  type LeadFormData,
  type MaxAuthResponse,
  type MaxContactVerifyResponse,
  type SubmissionCreateResponse,
} from '@craft72/contracts/source';
import { describe, expect, it, vi } from 'vitest';

import { Stage3ApiClient, Stage3ApiClientError } from './server-api.js';

const TOKEN = 't'.repeat(43);
const NOW = '2026-07-15T08:00:00.000Z';
const LATER = '2026-07-15T09:00:00.000Z';
const DRAFT_ID = '10000000-0000-4000-8000-000000000001';

const AUTH_RESPONSE: MaxAuthResponse = {
  authenticated: true,
  user: {
    id: '100500',
    firstName: 'Иван',
    lastName: 'Петров',
    username: 'ivan',
    languageCode: 'ru',
    photoUrl: null,
  },
  session: {
    token: TOKEN,
    expiresAt: LATER,
    verifiedContact: null,
  },
  startParam: null,
};

const CONTACT_RESPONSE: MaxContactVerifyResponse = {
  phone: '+79991234567',
  verified: true,
  verifiedAt: NOW,
};

const DRAFT_RESPONSE: LeadDraftUpsertResponse = {
  draft: {
    id: DRAFT_ID,
    currentStep: 3,
    payload: { fullName: 'Иван Петров', organization: 'ООО Проект' },
    source: null,
    updatedAt: NOW,
    expiresAt: '2026-08-14T08:00:00.000Z',
  },
};

const LEAD_PAYLOAD: LeadFormData = {
  role: 'property_owner',
  fullName: 'Иван Петров',
  organization: 'ООО Проект',
  inn: null,
  objectType: 'cultural-heritage',
  location: { city: 'Тюмень', region: 'Тюменская область' },
  scope: { kind: 'single_object' },
  area: { status: 'unknown' },
  currentStage: 'reconstruction',
  services: ['restoration'],
  expertiseRequired: 'yes',
  culturalHeritageSite: 'yes',
  desiredStart: { status: 'unknown' },
  description: 'Нужно подготовить проект реставрации и провести экспертизу.',
  links: [],
  documentIds: [],
  selectedCaseIds: [],
  contact: { phone: '+79991234567', email: 'owner@example.com' },
  consent: { version: '2026-07-15', accepted: true },
};

const SUBMISSION_RESPONSE: SubmissionCreateResponse = {
  submission: {
    submissionId: 'CRAFT72-ABC123',
    status: 'received',
    payload: LEAD_PAYLOAD,
    phoneVerified: true,
    materials: [],
    matchedCases: [],
    submittedAt: NOW,
    updatedAt: NOW,
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function requestInit(fetchMock: ReturnType<typeof vi.fn>, index: number): RequestInit {
  return (fetchMock.mock.calls[index]?.[1] ?? {}) as RequestInit;
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>, index: number): unknown {
  const body = requestInit(fetchMock, index).body;
  if (typeof body !== 'string') throw new TypeError('Expected a serialized JSON request body');
  return JSON.parse(body) as unknown;
}

describe('Stage3ApiClient', () => {
  it('authenticates without bearer and keeps the session token private for protected calls', async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(AUTH_RESPONSE))
      .mockResolvedValueOnce(jsonResponse({ draft: null }));
    const client = new Stage3ApiClient({ fetch: fetchMock });

    const authenticated = await client.authenticate(
      'auth_date=1720000000&hash=signed',
      'privacy-v1',
    );

    expect(authenticated).toEqual({
      authenticated: true,
      user: AUTH_RESPONSE.user,
      session: { expiresAt: LATER, verifiedContact: null },
      startParam: null,
    });
    expect('token' in authenticated.session).toBe(false);
    expect(client.hasSession()).toBe(true);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/auth/max');
    expect(new Headers(requestInit(fetchMock, 0).headers).has('authorization')).toBe(false);
    expect(requestInit(fetchMock, 0)).toMatchObject({
      method: 'POST',
      cache: 'no-store',
      credentials: 'omit',
    });
    expect(requestBody(fetchMock, 0)).toEqual({
      initData: 'auth_date=1720000000&hash=signed',
      privacyConsent: {
        accepted: true,
        acceptedAt: expect.any(String),
        text: privacyConsentText('privacy-v1'),
        version: 'privacy-v1',
      },
      termsAcceptance: {
        accepted: true,
        acceptedAt: expect.any(String),
        text: termsAcceptanceText('privacy-v1'),
        version: 'privacy-v1',
      },
    });

    await expect(client.getDraft()).resolves.toEqual({ draft: null });
    expect(new Headers(requestInit(fetchMock, 1).headers).get('authorization')).toBe(
      `Bearer ${TOKEN}`,
    );
  });

  it('rejects a contract-invalid successful response without exposing its body', async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(AUTH_RESPONSE))
      .mockResolvedValueOnce(jsonResponse({ draft: { payload: 'private invalid value' } }));
    const client = new Stage3ApiClient({ fetch: fetchMock });
    await client.authenticate('signed-init-data', 'privacy-v1');

    let caught: unknown;
    try {
      await client.getDraft();
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: 'INVALID_RESPONSE',
      status: 200,
      requestId: null,
    });
    expect(caught).toBeInstanceOf(Stage3ApiClientError);
    expect((caught as Error).message).not.toContain('private invalid value');
  });

  it('validates the API error envelope and clears the in-memory token after a 401', async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>();
    fetchMock.mockResolvedValueOnce(jsonResponse(AUTH_RESPONSE)).mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'private server diagnostics must not reach the UI',
            requestId: 'request-401',
          },
        },
        401,
      ),
    );
    const client = new Stage3ApiClient({ fetch: fetchMock });
    await client.authenticate('signed-init-data', 'privacy-v1');

    let caught: unknown;
    try {
      await client.getDraft();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Stage3ApiClientError);
    expect(caught).toMatchObject({
      code: 'UNAUTHORIZED',
      status: 401,
      requestId: 'request-401',
    });
    expect((caught as Error).message).not.toContain('private server diagnostics');
    expect(client.hasSession()).toBe(false);
    await expect(client.getDraft()).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('validates contact, draft, submission creation, and submission reading responses', async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(AUTH_RESPONSE))
      .mockResolvedValueOnce(jsonResponse(CONTACT_RESPONSE))
      .mockResolvedValueOnce(jsonResponse(DRAFT_RESPONSE))
      .mockResolvedValueOnce(jsonResponse(SUBMISSION_RESPONSE))
      .mockResolvedValueOnce(jsonResponse(SUBMISSION_RESPONSE));
    const client = new Stage3ApiClient({ fetch: fetchMock, basePath: '/backend/' });
    await client.authenticate('signed-init-data', 'privacy-v1');

    const contactRequest = {
      phone: '+79991234567',
      authDate: '1720000000',
      hash: 'a'.repeat(64),
    };
    const draftRequest = {
      currentStep: 3,
      payload: DRAFT_RESPONSE.draft.payload,
    };
    const submissionRequest = {
      draftId: DRAFT_ID,
      idempotencyKey: 'brief-submit-001',
      payload: LEAD_PAYLOAD,
    };

    await expect(client.verifyContact(contactRequest)).resolves.toEqual(CONTACT_RESPONSE);
    await expect(client.upsertDraft(draftRequest)).resolves.toEqual(DRAFT_RESPONSE);
    await expect(client.createSubmission(submissionRequest)).resolves.toEqual(SUBMISSION_RESPONSE);
    await expect(client.readSubmission('CRAFT72-ABC123')).resolves.toEqual(SUBMISSION_RESPONSE);

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/backend/api/auth/max',
      '/backend/api/contact/verify',
      '/backend/api/leads/draft',
      '/backend/api/submissions',
      '/backend/api/submissions/CRAFT72-ABC123',
    ]);
    expect(requestBody(fetchMock, 1)).toEqual(contactRequest);
    expect(requestBody(fetchMock, 2)).toEqual(draftRequest);
    expect(requestBody(fetchMock, 3)).toEqual(submissionRequest);
    for (const index of [1, 2, 3, 4]) {
      expect(new Headers(requestInit(fetchMock, index).headers).get('authorization')).toBe(
        `Bearer ${TOKEN}`,
      );
    }
  });

  it('rejects malformed error responses as invalid instead of reflecting arbitrary data', async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(AUTH_RESPONSE))
      .mockResolvedValueOnce(jsonResponse({ error: 'database password leaked here' }, 503));
    const client = new Stage3ApiClient({ fetch: fetchMock });
    await client.authenticate('signed-init-data', 'privacy-v1');

    let caught: unknown;
    try {
      await client.getDraft();
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ code: 'INVALID_RESPONSE', status: 503, requestId: null });
    expect((caught as Error).message).not.toContain('database password');
  });
});
