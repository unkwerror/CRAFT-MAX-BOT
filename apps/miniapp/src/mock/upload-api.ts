import {
  DocumentSchema,
  MAX_UPLOAD_BYTES,
  UploadCompleteRequestSchema,
  UploadCompleteResponseSchema,
  UploadInitRequestSchema,
  UploadInitResponseSchema,
  UuidSchema,
  type Document,
  type UploadCompleteRequest,
  type UploadCompleteResponse,
  type UploadInitRequest,
  type UploadInitResponse,
} from '@craft72/contracts/source';

import { MockApiError } from './errors.js';
import { stableMockUuid } from './stable-identifiers.js';

const MOCK_UPLOAD_LIFETIME_MILLISECONDS = 15 * 60 * 1_000;
export const MOCK_UPLOAD_STORAGE_KEY = 'craft72:max-miniapp:uploads:v1';

export interface MockUploadStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface MockUploadApiOptions {
  readonly now?: () => Date;
  readonly storage?: MockUploadStorage;
  readonly storageKey?: string;
}

function validNow(clock: () => Date): Date {
  const value = clock();
  if (Number.isNaN(value.getTime())) {
    throw new RangeError('Mock upload clock returned an invalid date');
  }

  return value;
}

function uploadFingerprint(request: UploadInitRequest): string {
  return JSON.stringify([
    request.fileName,
    request.mimeType,
    request.sizeBytes,
    request.sha256 ?? null,
  ]);
}

export class MockUploadApi {
  readonly #now: () => Date;
  readonly #pendingUploads = new Map<string, UploadInitRequest>();
  readonly #documents = new Map<string, Document>();
  readonly #storage: MockUploadStorage | undefined;
  readonly #storageKey: string;
  #uploadSequence = 0;

  public constructor(options: MockUploadApiOptions = {}) {
    this.#now = options.now ?? (() => new Date());
    this.#storage = options.storage;
    this.#storageKey = options.storageKey ?? MOCK_UPLOAD_STORAGE_KEY;
    this.restoreDocuments();
  }

  public initUpload(input: UploadInitRequest): UploadInitResponse {
    const request = UploadInitRequestSchema.parse(input);
    this.#uploadSequence += 1;
    const uploadId = stableMockUuid(
      'upload',
      `${uploadFingerprint(request)}:${String(this.#uploadSequence)}`,
    );
    const now = validNow(this.#now);
    const existing = this.#pendingUploads.get(uploadId);

    if (existing !== undefined && uploadFingerprint(existing) !== uploadFingerprint(request)) {
      throw new MockApiError('CONFLICT', 'Mock upload identifier collision');
    }

    this.#pendingUploads.set(uploadId, request);

    return UploadInitResponseSchema.parse({
      uploadId,
      uploadUrl: `https://uploads.mock.craft72.invalid/${uploadId}`,
      method: 'PUT',
      headers: { 'content-type': request.mimeType },
      expiresAt: new Date(now.getTime() + MOCK_UPLOAD_LIFETIME_MILLISECONDS).toISOString(),
      maxBytes: MAX_UPLOAD_BYTES,
    });
  }

  public completeUpload(
    uploadIdInput: string,
    input: UploadCompleteRequest,
  ): UploadCompleteResponse {
    const uploadId = UuidSchema.parse(uploadIdInput);
    const request = UploadCompleteRequestSchema.parse(input);
    const pending = this.#pendingUploads.get(uploadId);

    if (pending === undefined) {
      throw new MockApiError('UPLOAD_NOT_FOUND', 'Mock upload was not initialized');
    }

    if (pending.sizeBytes !== request.sizeBytes) {
      throw new MockApiError('CONFLICT', 'Completed upload size differs from initialized size');
    }

    if (pending.sha256 !== undefined && pending.sha256 !== request.sha256) {
      throw new MockApiError('CONFLICT', 'Completed upload hash differs from initialized hash');
    }

    const existing = this.#documents.get(uploadId);
    if (existing !== undefined) {
      if (existing.sizeBytes !== request.sizeBytes || existing.sha256 !== request.sha256) {
        throw new MockApiError('CONFLICT', 'Upload was already completed with different metadata');
      }

      return UploadCompleteResponseSchema.parse({ document: existing });
    }

    const document = DocumentSchema.parse({
      id: uploadId,
      originalName: pending.fileName,
      mimeType: pending.mimeType,
      sizeBytes: request.sizeBytes,
      sha256: request.sha256,
      scanStatus: 'clean',
      createdAt: validNow(this.#now).toISOString(),
    });

    this.#documents.set(uploadId, document);
    this.persistDocuments();
    return UploadCompleteResponseSchema.parse({ document });
  }

  public getDocument(documentIdInput: string): Document | null {
    const documentId = UuidSchema.parse(documentIdInput);
    return this.#documents.get(documentId) ?? null;
  }

  public getDocuments(documentIds: readonly string[]): readonly Document[] {
    return documentIds.map((documentId) => {
      const document = this.getDocument(documentId);
      if (document === null) {
        throw new MockApiError('UPLOAD_NOT_FOUND', 'Submission references an unknown mock upload');
      }

      return document;
    });
  }

  private restoreDocuments(): void {
    if (this.#storage === undefined) return;

    try {
      const serialized = this.#storage.getItem(this.#storageKey);
      if (serialized === null) return;
      const result = DocumentSchema.array().safeParse(JSON.parse(serialized) as unknown);
      if (!result.success) {
        this.#storage.removeItem(this.#storageKey);
        return;
      }
      for (const document of result.data) this.#documents.set(document.id, document);
    } catch {
      // Corrupt or restricted browser storage is ignored by the deterministic mock.
    }
  }

  private persistDocuments(): void {
    if (this.#storage === undefined) return;

    try {
      this.#storage.setItem(this.#storageKey, JSON.stringify([...this.#documents.values()]));
    } catch {
      // The upload remains available in memory when browser persistence is unavailable.
    }
  }
}
