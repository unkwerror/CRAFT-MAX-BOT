import {
  CaseCatalogItemSchema,
  SubmissionCreateRequestSchema,
  SubmissionCreateResponseSchema,
  SubmissionIdSchema,
  SubmissionReadResponseSchema,
  type CaseCatalogItem,
  type Document,
  type SubmissionCreateRequest,
  type SubmissionCreateResponse,
  type SubmissionReadResponse,
} from '@craft72/contracts/source';

import { MOCK_CASE_CATALOG, rankCasesForLead } from '../domain/case-catalog.js';
import { MockApiError } from './errors.js';
import { MockSessionState } from './session-state.js';
import { stableSubmissionId } from './stable-identifiers.js';

export interface MockDocumentSource {
  getDocuments(documentIds: readonly string[]): readonly Document[];
}

export interface MockSubmissionApiOptions {
  readonly now?: () => Date;
  readonly session?: MockSessionState;
  readonly catalog?: readonly CaseCatalogItem[];
  readonly documentSource?: MockDocumentSource;
}

interface StoredSubmission {
  readonly fingerprint: string;
  readonly response: SubmissionCreateResponse;
}

const emptyDocumentSource: MockDocumentSource = {
  getDocuments(documentIds) {
    if (documentIds.length > 0) {
      throw new MockApiError('UPLOAD_NOT_FOUND', 'No mock upload source was configured');
    }

    return [];
  },
};

function requestFingerprint(request: SubmissionCreateRequest): string {
  return JSON.stringify(request);
}

function validNow(clock: () => Date): Date {
  const value = clock();
  if (Number.isNaN(value.getTime())) {
    throw new RangeError('Mock submission clock returned an invalid date');
  }

  return value;
}

function resolveMatchedCases(
  request: SubmissionCreateRequest,
  catalog: readonly CaseCatalogItem[],
): readonly CaseCatalogItem[] {
  const catalogById = new Map(catalog.map((item) => [item.id, item]));
  const selected = request.payload.selectedCaseIds.map((caseId) => {
    const item = catalogById.get(caseId);
    if (item === undefined) {
      throw new MockApiError('BAD_REQUEST', 'Submission references an unknown mock case');
    }

    return item;
  });
  const selectedIds = new Set(selected.map((item) => item.id));
  const ranked = rankCasesForLead(request.payload, 10, catalog).filter(
    (item) => !selectedIds.has(item.id),
  );
  const resultCount = Math.max(3, selected.length);

  return CaseCatalogItemSchema.array()
    .max(10)
    .parse([...selected, ...ranked].slice(0, resultCount));
}

export class MockSubmissionApi {
  readonly #now: () => Date;
  readonly #session: MockSessionState;
  readonly #catalog: readonly CaseCatalogItem[];
  readonly #documentSource: MockDocumentSource;
  readonly #byIdempotencyKey = new Map<string, StoredSubmission>();
  readonly #bySubmissionId = new Map<string, SubmissionCreateResponse>();

  public constructor(options: MockSubmissionApiOptions = {}) {
    this.#now = options.now ?? (() => new Date());
    this.#session = options.session ?? new MockSessionState();
    this.#catalog = CaseCatalogItemSchema.array().parse(options.catalog ?? MOCK_CASE_CATALOG);
    this.#documentSource = options.documentSource ?? emptyDocumentSource;
  }

  public createSubmission(input: SubmissionCreateRequest): SubmissionCreateResponse {
    const request = SubmissionCreateRequestSchema.parse(input);
    const fingerprint = requestFingerprint(request);
    const existing = this.#byIdempotencyKey.get(request.idempotencyKey);

    if (existing !== undefined) {
      if (existing.fingerprint !== fingerprint) {
        throw new MockApiError('CONFLICT', 'Idempotency key was reused for another submission');
      }

      return existing.response;
    }

    const submissionId = SubmissionIdSchema.parse(stableSubmissionId(request.idempotencyKey));
    if (this.#bySubmissionId.has(submissionId)) {
      throw new MockApiError('CONFLICT', 'Mock submission identifier collision');
    }

    const timestamp = validNow(this.#now).toISOString();
    const response = SubmissionCreateResponseSchema.parse({
      submission: {
        submissionId,
        status: 'received',
        payload: request.payload,
        phoneVerified: this.#session.isPhoneVerified(request.payload.contact.phone),
        materials: this.#documentSource.getDocuments(request.payload.documentIds),
        matchedCases: resolveMatchedCases(request, this.#catalog),
        submittedAt: timestamp,
        updatedAt: timestamp,
      },
    });

    this.#byIdempotencyKey.set(request.idempotencyKey, { fingerprint, response });
    this.#bySubmissionId.set(submissionId, response);
    return response;
  }

  public readSubmission(submissionIdInput: string): SubmissionReadResponse | null {
    const submissionId = SubmissionIdSchema.parse(submissionIdInput);
    const response = this.#bySubmissionId.get(submissionId);
    return response === undefined ? null : SubmissionReadResponseSchema.parse(response);
  }
}
