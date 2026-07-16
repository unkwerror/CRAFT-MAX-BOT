import { describe, expect, it } from 'vitest';

import {
  ApiErrorResponseSchema,
  CaseCatalogItemSchema,
  CaseCatalogQuerySchema,
  CaseCatalogResponseSchema,
  DocumentDownloadLinkResponseSchema,
  DocumentDownloadQuerySchema,
  DocumentSchema,
  HealthLiveResponseSchema,
  HealthReadyResponseSchema,
  InnSchema,
  LeadDraftFormStateSchema,
  LeadDraftUpsertRequestSchema,
  LeadFormDataSchema,
  MAX_UPLOAD_BYTES,
  MaxAuthRequestSchema,
  MaxAuthResponseSchema,
  MaxContactVerifyRequestSchema,
  MaxContactVerifyResponseSchema,
  MaxSessionSnapshotSchema,
  Sha256Schema,
  StartParamSchema,
  SubmissionCreateRequestSchema,
  SubmissionParamsSchema,
  SubmissionReadResponseSchema,
  UploadCompleteRequestSchema,
  UploadFileNameSchema,
  UploadInitRequestSchema,
  privacyConsentText,
  termsAcceptanceText,
  type LeadFormData,
  type StartParam,
} from '../src/index.js';

const NOW = '2026-07-15T08:00:00.000Z';
const LATER = '2026-07-15T09:00:00.000Z';
const UUID = 'a5fd2117-1821-419f-8ed7-6e9b2b9d4133';
const SHA256 = 'a'.repeat(64);
const SESSION_TOKEN = 'A'.repeat(43);

const validCase = {
  id: 'office-reconstruction',
  title: 'Реконструкция офисного центра',
  url: 'https://craft72.ru/projects/office-reconstruction',
  image: 'https://craft72.ru/media/office.jpg',
  city: 'Тюмень',
  region: 'Тюменская область',
  categories: ['office'],
  services: ['architecture'],
  area: 12_500,
  scale: 'medium',
  constructionKind: 'reconstruction',
  status: 'Завершён',
  tags: ['reconstruction'],
  published: true,
} as const;

const validLead: LeadFormData = {
  role: 'developer',
  fullName: 'Иван Петров',
  organization: 'ООО Девелопмент',
  inn: '7707083893',
  objectType: 'office',
  location: {
    city: 'Тюмень',
    region: 'Тюменская область',
  },
  scope: {
    kind: 'single_object',
  },
  area: {
    status: 'known',
    squareMeters: 12_500,
  },
  currentStage: 'concept',
  services: ['architecture', 'engineering'],
  expertiseRequired: 'unknown',
  culturalHeritageSite: 'no',
  desiredStart: {
    status: 'known',
    date: '2026-09-01',
  },
  description: 'Нужна концепция и проектная документация.',
  links: ['https://files.example.com/project-brief'],
  documentIds: [UUID],
  selectedCaseIds: ['office-reconstruction'],
  contact: {
    phone: '+79991234567',
    email: 'client@example.com',
  },
  consent: {
    version: 'personal-data-v1',
    accepted: true,
  },
};

describe('start_param', () => {
  it.each(['new_project', 'services', 'portfolio', 'upload_brief', 'source_summer-2026'])(
    'accepts %s',
    (value) => {
      const parsed: StartParam = StartParamSchema.parse(value);
      expect(parsed).toBe(value);
    },
  );

  it.each([
    'unknown',
    'source_',
    'source_Summer',
    'source_campaign/../../admin',
    'new_project;delete',
  ])('rejects %s', (value) => {
    expect(StartParamSchema.safeParse(value).success).toBe(false);
  });
});

describe('MAX authentication and contact verification', () => {
  it('accepts only the signed initData string', () => {
    const consentVersion = 'miniapp-2026-07-15';
    const evidence = {
      initData: 'query_id=q1&hash=abc',
      privacyConsent: {
        accepted: true,
        acceptedAt: NOW,
        text: privacyConsentText(consentVersion),
        version: consentVersion,
      },
      termsAcceptance: {
        accepted: true,
        acceptedAt: NOW,
        text: termsAcceptanceText(consentVersion),
        version: consentVersion,
      },
    } as const;

    expect(MaxAuthRequestSchema.safeParse(evidence).success).toBe(true);
    expect(
      MaxAuthRequestSchema.safeParse({
        ...evidence,
        initDataUnsafe: { user: { id: 1 } },
      }).success,
    ).toBe(false);
    expect(
      MaxAuthRequestSchema.safeParse({
        ...evidence,
        privacyConsent: { ...evidence.privacyConsent, text: 'Подменённый текст' },
      }).success,
    ).toBe(false);
  });

  it('keeps MAX bigint identifiers as decimal strings', () => {
    const response = {
      authenticated: true,
      user: {
        id: '9223372036854775807',
        firstName: 'Иван',
        lastName: 'Петров',
        username: 'ivan',
        languageCode: 'ru',
        photoUrl: null,
      },
      session: { token: SESSION_TOKEN, expiresAt: LATER, verifiedContact: null },
      startParam: 'new_project',
    };

    expect(MaxAuthResponseSchema.safeParse(response).success).toBe(true);
    expect(
      MaxAuthResponseSchema.safeParse({
        ...response,
        user: { ...response.user, id: 9_223_372_036_854_776_000 },
      }).success,
    ).toBe(false);
    expect(
      MaxAuthResponseSchema.safeParse({
        ...response,
        user: { ...response.user, id: 'not-a-number' },
      }).success,
    ).toBe(false);
    expect(
      MaxAuthResponseSchema.safeParse({
        ...response,
        user: { ...response.user, id: '9223372036854775808' },
      }).success,
    ).toBe(false);
    expect(
      MaxAuthResponseSchema.safeParse({
        ...response,
        user: { ...response.user, lastName: '' },
      }).success,
    ).toBe(false);
  });

  it('restores only a server-owned verified contact snapshot', () => {
    expect(
      MaxSessionSnapshotSchema.safeParse({
        token: SESSION_TOKEN,
        expiresAt: LATER,
        verifiedContact: {
          phone: '+79991234567',
          verifiedAt: NOW,
        },
      }).success,
    ).toBe(true);
    expect(MaxSessionSnapshotSchema.safeParse({ expiresAt: LATER }).success).toBe(false);
    expect(
      MaxSessionSnapshotSchema.safeParse({
        token: SESSION_TOKEN,
        expiresAt: LATER,
        verifiedContact: {
          phone: '+79991234567',
          verifiedAt: NOW,
          verified: true,
        },
      }).success,
    ).toBe(false);
  });

  it('validates the exact MAX Bridge contact proof', () => {
    expect(
      MaxContactVerifyRequestSchema.safeParse({
        phone: '+79991234567',
        authDate: '1784102400',
        hash: SHA256,
      }).success,
    ).toBe(true);
    expect(
      MaxContactVerifyRequestSchema.safeParse({
        phone: '+79991234567',
        authDate: '1784102400',
        hash: 'not-a-hash',
      }).success,
    ).toBe(false);
  });

  it('normalizes SHA-256 values to the database canonical form', () => {
    expect(Sha256Schema.parse('A'.repeat(64))).toBe(SHA256);
  });

  it('does not let the client set verification state', () => {
    expect(
      MaxContactVerifyRequestSchema.safeParse({
        phone: '+79991234567',
        authDate: '1784102400',
        hash: SHA256,
        verified: true,
      }).success,
    ).toBe(false);

    expect(
      MaxContactVerifyResponseSchema.safeParse({
        phone: '+79991234567',
        verified: true,
        verifiedAt: NOW,
      }).success,
    ).toBe(true);
  });
});

describe('catalog and lead draft', () => {
  it('validates published catalog records and bounded filters', () => {
    expect(CaseCatalogItemSchema.safeParse(validCase).success).toBe(true);
    expect(CaseCatalogQuerySchema.safeParse({ service: 'architecture', limit: 20 }).success).toBe(
      true,
    );
    expect(CaseCatalogQuerySchema.safeParse({ service: 'architecture', limit: '20' }).success).toBe(
      true,
    );
    expect(CaseCatalogQuerySchema.safeParse({ limit: true }).success).toBe(false);
    expect(CaseCatalogQuerySchema.safeParse({ limit: ['20'] }).success).toBe(false);
    expect(CaseCatalogQuerySchema.safeParse({ service: 'architecture', limit: 101 }).success).toBe(
      false,
    );
    expect(CaseCatalogQuerySchema.safeParse({ service: 'architecture', sql: 'DROP' }).success).toBe(
      false,
    );
  });

  it('exposes only published cases with explicit classification fields', () => {
    expect(
      CaseCatalogResponseSchema.safeParse({ items: [validCase], nextCursor: null }).success,
    ).toBe(true);
    expect(
      CaseCatalogResponseSchema.safeParse({
        items: [{ ...validCase, published: false }],
        nextCursor: null,
      }).success,
    ).toBe(false);
    expect(
      CaseCatalogItemSchema.safeParse({
        ...validCase,
        scale: null,
        constructionKind: null,
      }).success,
    ).toBe(true);
    const { scale: _scale, ...caseWithoutScale } = validCase;
    expect(CaseCatalogItemSchema.safeParse(caseWithoutScale).success).toBe(false);
  });

  it('validates Russian INN checksums', () => {
    expect(InnSchema.safeParse('7707083893').success).toBe(true);
    expect(InnSchema.safeParse('500100732259').success).toBe(true);
    expect(InnSchema.safeParse('7707083894').success).toBe(false);
    expect(InnSchema.safeParse('0000000000').success).toBe(false);
  });

  it('preserves bounded raw partial values for autosave', () => {
    expect(
      LeadDraftUpsertRequestSchema.safeParse({
        currentStep: 14,
        payload: {
          role: 'developer',
          fullName: 'И',
          organization: '',
          inn: '7707',
          location: {},
          scope: { kind: 'portfolio', objectCount: '1' },
          area: { status: 'known', squareMeters: '12,' },
          desiredStart: { status: 'known', date: '2026-' },
          links: ['https://'],
          contact: { phone: '+7999', email: 'client@' },
          consent: {},
        },
      }).success,
    ).toBe(true);
    expect(
      LeadDraftFormStateSchema.parse({
        fullName: ' И',
        contact: { phone: '+7 ' },
      }),
    ).toEqual({ fullName: ' И', contact: { phone: '+7 ' } });
    expect(
      LeadDraftUpsertRequestSchema.safeParse({
        currentStep: 4,
        payload: { role: 'developer', arbitrary: 'value' },
      }).success,
    ).toBe(false);
    expect(
      LeadDraftUpsertRequestSchema.safeParse({
        currentStep: 14,
        payload: { contact: { phone: '+7999', phoneVerified: true } },
      }).success,
    ).toBe(false);
  });

  it('bounds raw draft strings and collections', () => {
    expect(LeadDraftFormStateSchema.safeParse({ fullName: 'x'.repeat(201) }).success).toBe(false);
    expect(
      LeadDraftFormStateSchema.safeParse({ scope: { objectCount: '1'.repeat(17) } }).success,
    ).toBe(false);
    expect(
      LeadDraftFormStateSchema.safeParse({ links: Array.from({ length: 11 }, () => '') }).success,
    ).toBe(false);
    expect(LeadDraftFormStateSchema.safeParse({ contact: { phone: '1'.repeat(33) } }).success).toBe(
      false,
    );
  });

  it('requires a complete submission form without duplicate selections', () => {
    expect(LeadFormDataSchema.safeParse(validLead).success).toBe(true);
    expect(
      LeadFormDataSchema.safeParse({
        ...validLead,
        services: ['architecture', 'architecture'],
      }).success,
    ).toBe(false);
    expect(
      LeadFormDataSchema.safeParse({
        ...validLead,
        location: {},
      }).success,
    ).toBe(false);
    expect(
      LeadFormDataSchema.safeParse({
        ...validLead,
        fullName: 'И',
        contact: { phone: '+7999', email: 'client@' },
      }).success,
    ).toBe(false);
  });
});

describe('uploads', () => {
  it('accepts upload metadata without a client-provided hash', () => {
    expect(
      UploadInitRequestSchema.safeParse({
        fileName: 'brief.pdf',
        mimeType: 'application/pdf',
        sizeBytes: MAX_UPLOAD_BYTES,
      }).success,
    ).toBe(true);
    expect(
      UploadCompleteRequestSchema.safeParse({
        sizeBytes: 1_024,
      }).success,
    ).toBe(true);
  });

  it('rejects legacy client-provided hashes in strict upload requests', () => {
    expect(
      UploadInitRequestSchema.safeParse({
        fileName: 'brief.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1_024,
        sha256: SHA256,
      }).success,
    ).toBe(false);
    expect(
      UploadCompleteRequestSchema.safeParse({ sizeBytes: 1_024, sha256: SHA256 }).success,
    ).toBe(false);
  });

  it('rejects path traversal, executable extensions and oversized files', () => {
    expect(UploadFileNameSchema.safeParse('../../etc/passwd.pdf').success).toBe(false);
    expect(UploadFileNameSchema.safeParse('payload.exe').success).toBe(false);
    expect(
      UploadInitRequestSchema.safeParse({
        fileName: 'brief.pdf',
        mimeType: 'image/png',
        sizeBytes: 1_024,
      }).success,
    ).toBe(false);
    expect(
      UploadInitRequestSchema.safeParse({
        fileName: 'archive.zip',
        mimeType: 'application/octet-stream',
        sizeBytes: 1_024,
      }).success,
    ).toBe(false);
    expect(
      UploadInitRequestSchema.safeParse({
        fileName: 'brief.pdf',
        mimeType: 'application/pdf',
        sizeBytes: MAX_UPLOAD_BYTES + 1,
      }).success,
    ).toBe(false);
  });

  it('enforces the extension and MIME pair on stored documents', () => {
    const document = {
      id: UUID,
      originalName: 'brief.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1_024,
      sha256: SHA256,
      scanStatus: 'clean',
      createdAt: NOW,
    } as const;

    expect(DocumentSchema.safeParse(document).success).toBe(true);
    expect(
      DocumentSchema.safeParse({
        ...document,
        mimeType: 'image/png',
      }).success,
    ).toBe(false);
  });

  it('validates temporary signed download links without accepting arbitrary schemes', () => {
    expect(
      DocumentDownloadLinkResponseSchema.safeParse({
        downloadUrl: `https://craft72app.ru/files/${UUID}?grant=${UUID}&expires=1784103300&signature=${SHA256}`,
        expiresAt: NOW,
      }).success,
    ).toBe(true);
    expect(
      DocumentDownloadLinkResponseSchema.safeParse({
        downloadUrl: `javascript:alert(1)`,
        expiresAt: NOW,
      }).success,
    ).toBe(false);
    expect(
      DocumentDownloadQuerySchema.parse({
        grant: UUID,
        expires: '1784103300',
        signature: SHA256.toUpperCase(),
      }),
    ).toEqual({ grant: UUID, expires: 1_784_103_300, signature: SHA256 });
  });
});

describe('submission contracts', () => {
  it('validates create and read boundaries', () => {
    const request = {
      draftId: UUID,
      idempotencyKey: 'submit:2026-07-15:0001',
      payload: validLead,
    };

    expect(SubmissionCreateRequestSchema.safeParse(request).success).toBe(true);
    expect(
      SubmissionParamsSchema.safeParse({ submissionId: 'CRAFT72-20260715-0001' }).success,
    ).toBe(true);

    expect(
      SubmissionReadResponseSchema.safeParse({
        submission: {
          submissionId: 'CRAFT72-20260715-0001',
          status: 'received',
          payload: validLead,
          phoneVerified: true,
          materials: [],
          matchedCases: [validCase],
          submittedAt: NOW,
          updatedAt: NOW,
        },
      }).success,
    ).toBe(true);
  });
});

describe('health and errors', () => {
  it('keeps health payloads free of configuration and PII', () => {
    expect(HealthLiveResponseSchema.safeParse({ status: 'ok', timestamp: NOW }).success).toBe(true);
    expect(
      HealthReadyResponseSchema.safeParse({
        status: 'ok',
        timestamp: NOW,
        checks: { database: { status: 'ok', latencyMs: 3 } },
      }).success,
    ).toBe(true);
    expect(
      HealthReadyResponseSchema.safeParse({
        status: 'ok',
        timestamp: NOW,
        checks: { database: { status: 'ok' } },
        databaseUrl: 'postgresql://secret',
      }).success,
    ).toBe(false);
  });

  it('requires a database check and derives readiness status from checks', () => {
    expect(
      HealthReadyResponseSchema.safeParse({
        status: 'ok',
        timestamp: NOW,
        checks: { cache: { status: 'ok' } },
      }).success,
    ).toBe(false);
    expect(
      HealthReadyResponseSchema.safeParse({
        status: 'ok',
        timestamp: NOW,
        checks: { database: { status: 'error' } },
      }).success,
    ).toBe(false);
    expect(
      HealthReadyResponseSchema.safeParse({
        status: 'unavailable',
        timestamp: NOW,
        checks: { database: { status: 'error' } },
      }).success,
    ).toBe(true);
    expect(
      HealthReadyResponseSchema.safeParse({
        status: 'degraded',
        timestamp: NOW,
        checks: { database: { status: 'ok' } },
      }).success,
    ).toBe(false);
    expect(
      HealthReadyResponseSchema.safeParse({
        status: 'degraded',
        timestamp: NOW,
        checks: {
          database: { status: 'ok' },
          tracker: { status: 'error' },
        },
      }).success,
    ).toBe(true);
    expect(
      HealthReadyResponseSchema.safeParse({
        status: 'ok',
        timestamp: NOW,
        checks: {
          database: { status: 'ok' },
          tracker: { status: 'error' },
        },
      }).success,
    ).toBe(false);
    expect(
      HealthReadyResponseSchema.safeParse({
        status: 'unavailable',
        timestamp: NOW,
        checks: {
          database: { status: 'ok' },
          tracker: { status: 'error' },
        },
      }).success,
    ).toBe(false);
  });

  it('allows structured field issues but rejects stack traces', () => {
    const response = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        requestId: 'req:20260715:0001',
        issues: [
          {
            path: ['payload', 'inn'],
            code: 'invalid_format',
            message: 'Invalid INN',
          },
        ],
      },
    };

    expect(ApiErrorResponseSchema.safeParse(response).success).toBe(true);
    expect(
      ApiErrorResponseSchema.safeParse({
        error: { ...response.error, stack: 'Error: secret' },
      }).success,
    ).toBe(false);
  });
});
