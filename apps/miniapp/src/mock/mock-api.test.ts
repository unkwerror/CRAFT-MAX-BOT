import {
  SubmissionCreateResponseSchema,
  UploadCompleteResponseSchema,
  UploadInitResponseSchema,
  type LeadFormData,
} from '@craft72/contracts/source';
import { describe, expect, it } from 'vitest';

import { MockApiError } from './errors.js';
import { MockSessionState } from './session-state.js';
import { MockSubmissionApi } from './submission-api.js';
import { MockUploadApi, type MockUploadStorage } from './upload-api.js';

const NOW = new Date('2026-07-15T08:00:00.000Z');
const SHA256 = 'a'.repeat(64);

class MemoryUploadStorage implements MockUploadStorage {
  readonly #items = new Map<string, string>();

  public getItem(key: string): string | null {
    return this.#items.get(key) ?? null;
  }

  public removeItem(key: string): void {
    this.#items.delete(key);
  }

  public setItem(key: string, value: string): void {
    this.#items.set(key, value);
  }
}

function validPayload(documentIds: readonly string[]): LeadFormData {
  return {
    role: 'property_owner',
    fullName: 'Иван Петров',
    organization: 'ООО Проект',
    inn: null,
    objectType: 'cultural-heritage',
    location: { city: 'Тюмень', region: 'Тюменская область' },
    scope: { kind: 'single_object' },
    area: { status: 'unknown' },
    currentStage: 'reconstruction',
    services: ['restoration', 'expertise-support'],
    expertiseRequired: 'yes',
    culturalHeritageSite: 'yes',
    desiredStart: { status: 'unknown' },
    description: 'Нужно подготовить проект реставрации и провести экспертизу.',
    links: [],
    documentIds: [...documentIds],
    selectedCaseIds: ['tyumen-heritage-quarter'],
    contact: { phone: '+79991234567', email: 'owner@example.com' },
    consent: { version: '2026-07-15', accepted: true },
  };
}

describe('mock upload and submission APIs', () => {
  it('initializes and completes a contract-valid deterministic upload', () => {
    const firstApi = new MockUploadApi({ now: () => NOW });
    const secondApi = new MockUploadApi({ now: () => NOW });
    const request = {
      fileName: 'brief.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 12_345,
      sha256: SHA256,
    } as const;

    const first = firstApi.initUpload(request);
    const second = secondApi.initUpload(request);
    const anotherUpload = firstApi.initUpload(request);
    expect(UploadInitResponseSchema.safeParse(first).success).toBe(true);
    expect(first.uploadId).toBe(second.uploadId);
    expect(anotherUpload.uploadId).not.toBe(first.uploadId);

    const completed = firstApi.completeUpload(first.uploadId, {
      sizeBytes: request.sizeBytes,
      sha256: SHA256,
    });
    expect(UploadCompleteResponseSchema.safeParse(completed).success).toBe(true);
    expect(completed.document.id).toBe(first.uploadId);
    expect(
      firstApi.completeUpload(first.uploadId, {
        sizeBytes: request.sizeBytes,
        sha256: request.sha256,
      }),
    ).toEqual(completed);
  });

  it('rejects completion metadata that differs from initialization', () => {
    const api = new MockUploadApi({ now: () => NOW });
    const initialized = api.initUpload({
      fileName: 'brief.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 100,
    });

    expect(() =>
      api.completeUpload(initialized.uploadId, { sizeBytes: 99, sha256: SHA256 }),
    ).toThrow(MockApiError);
  });

  it('restores completed mock document metadata after a browser refresh', () => {
    const storage = new MemoryUploadStorage();
    const firstApi = new MockUploadApi({ now: () => NOW, storage });
    const initialized = firstApi.initUpload({
      fileName: 'brief.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 100,
      sha256: SHA256,
    });
    const completed = firstApi.completeUpload(initialized.uploadId, {
      sizeBytes: 100,
      sha256: SHA256,
    });

    const restoredApi = new MockUploadApi({ now: () => NOW, storage });
    expect(restoredApi.getDocument(completed.document.id)).toEqual(completed.document);
  });

  it('keeps submission_id stable for idempotent retries and includes mock materials', () => {
    const uploads = new MockUploadApi({ now: () => NOW });
    const initialized = uploads.initUpload({
      fileName: 'brief.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1_024,
      sha256: SHA256,
    });
    const completed = uploads.completeUpload(initialized.uploadId, {
      sizeBytes: 1_024,
      sha256: SHA256,
    });
    const session = new MockSessionState();
    session.setVerifiedContact({
      phone: '+79991234567',
      verifiedAt: NOW.toISOString(),
    });
    const api = new MockSubmissionApi({
      now: () => NOW,
      documentSource: uploads,
      session,
    });
    const request = {
      idempotencyKey: 'brief-submit-001',
      payload: validPayload([completed.document.id]),
    };

    const first = api.createSubmission(request);
    const retry = api.createSubmission(request);
    const otherInstance = new MockSubmissionApi({
      now: () => NOW,
      documentSource: uploads,
    }).createSubmission(request);

    expect(SubmissionCreateResponseSchema.safeParse(first).success).toBe(true);
    expect(retry).toEqual(first);
    expect(otherInstance.submission.submissionId).toBe(first.submission.submissionId);
    expect(otherInstance.submission.phoneVerified).toBe(false);
    expect(first.submission.submissionId).toMatch(/^CRAFT72-MOCK-[A-F0-9]{24}$/);
    expect(first.submission.materials).toEqual([completed.document]);
    expect(first.submission.phoneVerified).toBe(true);
    expect(first.submission.matchedCases[0]?.id).toBe('tyumen-heritage-quarter');
    expect(first.submission.matchedCases.length).toBeGreaterThanOrEqual(1);
    expect(first.submission.matchedCases.length).toBeLessThanOrEqual(3);
    expect(api.readSubmission(first.submission.submissionId)).toEqual(first);
  });

  it('rejects reuse of an idempotency key with another payload', () => {
    const api = new MockSubmissionApi({ now: () => NOW });
    const request = {
      idempotencyKey: 'brief-submit-002',
      payload: validPayload([]),
    };
    api.createSubmission(request);

    expect(() =>
      api.createSubmission({
        ...request,
        payload: { ...request.payload, description: 'Другое описание проекта.' },
      }),
    ).toThrow(MockApiError);
  });
});
