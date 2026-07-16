import { Readable } from 'node:stream';

import type {
  LeadDraft,
  LeadDraftUpsertRequest,
  MaxAuthResponse,
  PrivacyConsentEvidence,
  Submission,
  SubmissionCreateRequest,
  TermsAcceptanceEvidence,
} from '@craft72/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ValidatedMaxInitData, VerifiedMaxContact } from './max-auth.js';
import type { AcceptedMaxWebhook } from './max-webhook.js';
import type { AuthenticatedSession, Stage3Store } from './repository.js';
import { buildStage3Api, type Stage3ApiOptions } from './server.js';

const TOKEN = 'A'.repeat(43);
const CAPABILITY = 'B'.repeat(43);
const ID = '9a3dbcd9-d454-49bd-8e4e-d6b9253fd18d';
const GRANT = 'b9951993-b3b4-4cab-af41-258b34081327';
const SHA256 = 'a'.repeat(64);
const NOW = new Date('2026-07-16T04:00:00.000Z');
const CONTENT = Buffer.from('%PDF-1.7\n');

const session: AuthenticatedSession = {
  consentedAt: NOW,
  consentTextHash: 'c'.repeat(64),
  consentVersion: 'stage5-v1',
  expiresAt: new Date(NOW.getTime() + 60_000),
  maxUserId: '900000000000000001',
  phoneVerifiedAt: null,
  sessionId: '42372638-ea36-4264-839d-1c74054761c6',
  startParam: null,
  termsAcceptedAt: NOW,
  termsTextHash: 'd'.repeat(64),
  termsVersion: 'stage5-v1',
  verifiedPhone: null,
};

const document = {
  id: ID,
  originalName: 'brief.pdf',
  mimeType: 'application/pdf' as const,
  sizeBytes: CONTENT.length,
  sha256: SHA256,
  scanStatus: 'clean' as const,
  createdAt: NOW.toISOString(),
};

class UploadTestStore implements Stage3Store {
  public async authenticate(token: string): Promise<AuthenticatedSession | null> {
    return token === TOKEN ? session : null;
  }

  public isReady(): Promise<void> {
    return Promise.resolve();
  }
  public cleanupExpired(): Promise<void> {
    return Promise.resolve();
  }
  public async acceptMaxWebhook(_event: AcceptedMaxWebhook): Promise<boolean> {
    return true;
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
  public setVerifiedContact(
    _session: AuthenticatedSession,
    _contact: VerifiedMaxContact,
  ): Promise<void> {
    return Promise.resolve();
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

describe('Stage 5 upload API', () => {
  let app: Awaited<ReturnType<typeof buildStage3Api>>;
  let received = Buffer.alloc(0);
  const uploads = {
    isReady: vi.fn(async () => undefined),
    initializeUpload: vi.fn(async () => ({
      uploadId: ID,
      uploadUrl: `https://craft72app.ru/api/uploads/${ID}/content`,
      method: 'PUT' as const,
      headers: {
        'Content-Type': 'application/pdf' as const,
        'X-Craft72-Upload-Token': CAPABILITY,
      },
      expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
      maxBytes: 52_428_800,
    })),
    receiveUpload: vi.fn(
      async (input: Parameters<NonNullable<Stage3ApiOptions['uploads']>['receiveUpload']>[0]) => {
        const chunks: Buffer[] = [];
        for await (const value of input.input) chunks.push(Buffer.from(value));
        received = Buffer.concat(chunks);
      },
    ),
    completeUpload: vi.fn(async () => ({ document })),
    getDocument: vi.fn(async () => document),
    createDownloadLink: vi.fn(async () => ({
      downloadUrl: `https://craft72app.ru/files/${ID}?grant=${GRANT}&expires=1784174460&signature=${SHA256}`,
      expiresAt: '2026-07-16T04:01:00.000Z',
    })),
    resolveDownload: vi.fn(async () => ({
      mimeType: 'application/pdf',
      originalName: 'brief.pdf',
      sizeBytes: CONTENT.length,
      storageKey: `documents/${ID}`,
    })),
    open: vi.fn(() => Readable.from([CONTENT])),
  } satisfies NonNullable<Stage3ApiOptions['uploads']>;

  beforeEach(async () => {
    received = Buffer.alloc(0);
    vi.clearAllMocks();
    app = await buildStage3Api({
      botToken: 'stage-5-test-bot-token-with-enough-entropy',
      consentVersion: 'stage5-v1',
      contactMaxAgeSeconds: 300,
      initDataMaxAgeSeconds: 3_600,
      ipRateLimitMax: 1_000,
      maxWebhookSecret: 'stage-5-webhook-secret-with-enough-entropy',
      now: () => NOW,
      publicBaseUrl: 'https://craft72app.ru',
      rateLimitMax: 100,
      rateLimitWindowSeconds: 60,
      store: new UploadTestStore(),
      uploads,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('streams a capability upload and completes it under the authenticated owner', async () => {
    const authorization = `Bearer ${TOKEN}`;
    const initialized = await app.inject({
      method: 'POST',
      url: '/api/uploads/init',
      headers: { authorization, origin: 'https://craft72app.ru' },
      payload: {
        fileName: document.originalName,
        mimeType: document.mimeType,
        sizeBytes: CONTENT.length,
      },
    });
    expect(initialized.statusCode).toBe(200);

    const uploaded = await app.inject({
      method: 'PUT',
      url: `/api/uploads/${ID}/content`,
      headers: {
        'content-type': 'application/pdf',
        'x-craft72-upload-token': CAPABILITY,
        origin: 'https://craft72app.ru',
      },
      payload: CONTENT,
    });
    expect(uploaded.statusCode).toBe(204);
    expect(received).toEqual(CONTENT);
    expect(uploads.receiveUpload.mock.calls[0]?.[0]).toMatchObject({
      token: CAPABILITY,
      uploadId: ID,
    });

    const completed = await app.inject({
      method: 'POST',
      url: `/api/uploads/${ID}/complete`,
      headers: { authorization },
      payload: { sizeBytes: CONTENT.length },
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toEqual({ document });
  });

  it('returns metadata, creates a temporary link, and streams only a valid grant', async () => {
    const authorization = `Bearer ${TOKEN}`;
    const metadata = await app.inject({
      method: 'GET',
      url: `/api/uploads/${ID}`,
      headers: { authorization },
    });
    expect(metadata.statusCode).toBe(200);
    expect(metadata.json()).toEqual({ document });

    const link = await app.inject({
      method: 'POST',
      url: `/api/uploads/${ID}/download-link`,
      headers: { authorization },
    });
    expect(link.statusCode).toBe(200);

    const download = await app.inject({
      method: 'GET',
      url: `/files/${ID}?grant=${GRANT}&expires=1784174460&signature=${SHA256}`,
    });
    expect(download.statusCode).toBe(200);
    expect(download.rawPayload).toEqual(CONTENT);
    expect(download.headers['content-disposition']).toContain('attachment');
    expect(uploads.resolveDownload).toHaveBeenCalledWith(ID, {
      grant: GRANT,
      expires: 1_784_174_460,
      signature: SHA256,
    });
  });
});
