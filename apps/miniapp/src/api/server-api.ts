import {
  ApiErrorResponseSchema,
  DocumentDownloadLinkResponseSchema,
  DocumentDownloadQuerySchema,
  LeadDraftGetResponseSchema,
  LeadDraftUpsertRequestSchema,
  LeadDraftUpsertResponseSchema,
  MaxAuthRequestSchema,
  MaxAuthResponseSchema,
  MaxContactVerifyRequestSchema,
  MaxContactVerifyResponseSchema,
  SubmissionCreateRequestSchema,
  SubmissionCreateResponseSchema,
  SubmissionParamsSchema,
  SubmissionReadResponseSchema,
  UploadCompleteRequestSchema,
  UploadCompleteResponseSchema,
  UploadIdParamsSchema,
  UploadInitRequestSchema,
  UploadInitResponseSchema,
  UuidSchema,
  type ApiErrorCode,
  type Document,
  type DocumentDownloadLinkResponse,
  type LeadDraftGetResponse,
  type LeadDraftUpsertRequest,
  type LeadDraftUpsertResponse,
  type MaxContactVerifyRequest,
  type MaxContactVerifyResponse,
  type MaxUser,
  type StartParam,
  type SubmissionCreateRequest,
  type SubmissionCreateResponse,
  type SubmissionReadResponse,
  type UploadCompleteRequest,
  type UploadCompleteResponse,
  type UploadInitRequest,
  type UploadInitResponse,
  type VerifiedContactSnapshot,
  privacyConsentText,
  termsAcceptanceText,
} from '@craft72/contracts/source';

const DEFAULT_TIMEOUT_MILLISECONDS = 12_000;
const MAX_TIMEOUT_MILLISECONDS = 120_000;
const DEFAULT_UPLOAD_TIMEOUT_MILLISECONDS = 10 * 60_000;
const MAX_UPLOAD_TIMEOUT_MILLISECONDS = 30 * 60_000;

interface RuntimeSchema<T> {
  safeParse(
    input: unknown,
  ): { readonly success: true; readonly data: T } | { readonly success: false };
}

export interface ApiRequestOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMilliseconds?: number;
}

export interface UploadProgress {
  readonly loadedBytes: number;
  readonly percent: number;
  readonly totalBytes: number;
}

export interface UploadFileOptions {
  readonly onProgress?: (progress: UploadProgress) => void;
  readonly signal?: AbortSignal;
  readonly timeoutMilliseconds?: number;
}

export interface Stage3ApiClientOptions {
  /** Root-relative prefix only. An empty prefix calls the production same-origin `/api/*` routes. */
  readonly basePath?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMilliseconds?: number;
  readonly uploadTimeoutMilliseconds?: number;
  readonly xhr?: () => XMLHttpRequest;
}

export interface MaxAuthenticatedSnapshot {
  readonly authenticated: true;
  readonly user: MaxUser;
  readonly session: {
    readonly expiresAt: string;
    readonly verifiedContact: VerifiedContactSnapshot | null;
  };
  readonly startParam: StartParam | null;
}

export type Stage3ApiClientErrorCode =
  | ApiErrorCode
  | 'INVALID_REQUEST'
  | 'INVALID_RESPONSE'
  | 'NETWORK_ERROR'
  | 'REQUEST_ABORTED'
  | 'REQUEST_TIMEOUT';

const SAFE_ERROR_MESSAGES: Readonly<Record<Stage3ApiClientErrorCode, string>> = {
  BAD_REQUEST: 'The request could not be processed.',
  VALIDATION_ERROR: 'The request contains invalid data.',
  UNAUTHORIZED: 'The session has expired. Reopen the mini application.',
  FORBIDDEN: 'This action is not available for the current user.',
  NOT_FOUND: 'The requested data was not found.',
  CONFLICT: 'The data has changed. Refresh it and try again.',
  RATE_LIMITED: 'Too many requests. Try again shortly.',
  PAYLOAD_TOO_LARGE: 'The request is too large.',
  UNSUPPORTED_MEDIA_TYPE: 'This data format is not supported.',
  MAX_AUTH_INVALID: 'MAX authentication failed. Reopen the mini application.',
  MAX_AUTH_EXPIRED: 'MAX authentication has expired. Reopen the mini application.',
  CONTACT_VERIFICATION_FAILED: 'The MAX contact could not be verified.',
  CONTACT_HANDOFF_UNAVAILABLE: 'Open the administrator panel from the bot and try again.',
  DRAFT_NOT_FOUND: 'The draft was not found.',
  UPLOAD_NOT_FOUND: 'An uploaded document was not found.',
  SUBMISSION_NOT_FOUND: 'The submission was not found.',
  INTERNAL_ERROR: 'The service could not complete the request.',
  SERVICE_UNAVAILABLE: 'The service is temporarily unavailable.',
  INVALID_REQUEST: 'The request contains invalid data.',
  INVALID_RESPONSE: 'The service returned an invalid response.',
  NETWORK_ERROR: 'The service could not be reached.',
  REQUEST_ABORTED: 'The request was cancelled.',
  REQUEST_TIMEOUT: 'The service did not respond in time.',
};

/**
 * A presentation-safe API error. It deliberately excludes response bodies, server messages,
 * validation issues, request payloads, and authentication data.
 */
export class Stage3ApiClientError extends Error {
  public readonly code: Stage3ApiClientErrorCode;
  public readonly status: number | null;
  public readonly requestId: string | null;

  public constructor(
    code: Stage3ApiClientErrorCode,
    options: { readonly status?: number; readonly requestId?: string } = {},
  ) {
    super(SAFE_ERROR_MESSAGES[code]);
    this.name = 'Stage3ApiClientError';
    this.code = code;
    this.status = options.status ?? null;
    this.requestId = options.requestId ?? null;
  }
}

function normalizeBasePath(input: string | undefined): string {
  const value = input ?? '';
  if (value === '') return '';
  if (
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('?') ||
    value.includes('#')
  ) {
    throw new TypeError('API base path must be a root-relative path');
  }

  return value.replace(/\/+$/, '');
}

function validateTimeout(input: number | undefined, fallback: number): number {
  const value = input ?? fallback;
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_TIMEOUT_MILLISECONDS) {
    throw new RangeError('API timeout must be a positive integer no greater than 120000 ms');
  }

  return value;
}

function validateUploadTimeout(input: number | undefined, fallback: number): number {
  const value = input ?? fallback;
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_UPLOAD_TIMEOUT_MILLISECONDS) {
    throw new RangeError('Upload timeout must be a positive integer no greater than 1800000 ms');
  }

  return value;
}

function parseRequest<T>(schema: RuntimeSchema<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new Stage3ApiClientError('INVALID_REQUEST');
  return result.data;
}

function parseSuccessfulResponse<T>(schema: RuntimeSchema<T>, input: unknown, status: number): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new Stage3ApiClientError('INVALID_RESPONSE', { status });
  return result.data;
}

function requestHeaders(token: string | null, hasBody: boolean): Headers {
  const headers = new Headers({ accept: 'application/json' });
  if (hasBody) headers.set('content-type', 'application/json');
  if (token !== null) headers.set('authorization', `Bearer ${token}`);
  return headers;
}

export class Stage3ApiClient {
  readonly #basePath: string;
  readonly #documents = new Map<string, Document>();
  readonly #fetch: typeof globalThis.fetch;
  readonly #timeoutMilliseconds: number;
  readonly #uploadTimeoutMilliseconds: number;
  readonly #xhr: () => XMLHttpRequest;
  #sessionToken: string | null = null;

  public constructor(options: Stage3ApiClientOptions = {}) {
    this.#basePath = normalizeBasePath(options.basePath);
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#timeoutMilliseconds = validateTimeout(
      options.timeoutMilliseconds,
      DEFAULT_TIMEOUT_MILLISECONDS,
    );
    this.#uploadTimeoutMilliseconds = validateUploadTimeout(
      options.uploadTimeoutMilliseconds,
      DEFAULT_UPLOAD_TIMEOUT_MILLISECONDS,
    );
    this.#xhr = options.xhr ?? (() => new globalThis.XMLHttpRequest());
  }

  public hasSession(): boolean {
    return this.#sessionToken !== null;
  }

  public clearSession(): void {
    this.#sessionToken = null;
    this.#documents.clear();
  }

  public async authenticate(
    initData: string,
    consentVersion: string,
    options: ApiRequestOptions = {},
  ): Promise<MaxAuthenticatedSnapshot> {
    const request = parseRequest(MaxAuthRequestSchema, {
      initData,
      privacyConsent: {
        accepted: true,
        acceptedAt: new Date().toISOString(),
        text: privacyConsentText(consentVersion),
        version: consentVersion,
      },
      termsAcceptance: {
        accepted: true,
        acceptedAt: new Date().toISOString(),
        text: termsAcceptanceText(consentVersion),
        version: consentVersion,
      },
    });
    this.clearSession();
    const response = await this.#request(
      '/api/auth/max',
      MaxAuthResponseSchema,
      { method: 'POST', body: request },
      options,
    );
    this.#sessionToken = response.session.token;

    return {
      authenticated: response.authenticated,
      user: response.user,
      session: {
        expiresAt: response.session.expiresAt,
        verifiedContact: response.session.verifiedContact,
      },
      startParam: response.startParam,
    };
  }

  public getDraft(options: ApiRequestOptions = {}): Promise<LeadDraftGetResponse> {
    return this.#protectedRequest('/api/leads/draft', LeadDraftGetResponseSchema, {}, options);
  }

  public upsertDraft(
    input: LeadDraftUpsertRequest,
    options: ApiRequestOptions = {},
  ): Promise<LeadDraftUpsertResponse> {
    const request = parseRequest(LeadDraftUpsertRequestSchema, input);
    return this.#protectedRequest(
      '/api/leads/draft',
      LeadDraftUpsertResponseSchema,
      { method: 'POST', body: request },
      options,
    );
  }

  public verifyContact(
    input: MaxContactVerifyRequest,
    options: ApiRequestOptions = {},
  ): Promise<MaxContactVerifyResponse> {
    const request = parseRequest(MaxContactVerifyRequestSchema, input);
    return this.#protectedRequest(
      '/api/contact/verify',
      MaxContactVerifyResponseSchema,
      { method: 'POST', body: request },
      options,
    );
  }

  public initUpload(
    input: UploadInitRequest,
    options: ApiRequestOptions = {},
  ): Promise<UploadInitResponse> {
    const request = parseRequest(UploadInitRequestSchema, input);
    return this.#protectedRequest(
      '/api/uploads/init',
      UploadInitResponseSchema,
      { method: 'POST', body: request },
      options,
    );
  }

  public uploadFile(
    initializedInput: UploadInitResponse,
    file: Blob,
    options: UploadFileOptions = {},
  ): Promise<void> {
    const initialized = parseRequest(UploadInitResponseSchema, initializedInput);
    const uploadUrl = new URL(initialized.uploadUrl);
    const runtimeOrigin = globalThis.location?.origin;
    if (
      uploadUrl.protocol !== 'https:' ||
      uploadUrl.username !== '' ||
      uploadUrl.password !== '' ||
      uploadUrl.hash !== '' ||
      uploadUrl.search !== '' ||
      (runtimeOrigin !== undefined && uploadUrl.origin !== runtimeOrigin) ||
      uploadUrl.pathname !== `/api/uploads/${encodeURIComponent(initialized.uploadId)}/content`
    ) {
      return Promise.reject(new Stage3ApiClientError('INVALID_RESPONSE'));
    }
    if (file.size <= 0 || file.size > initialized.maxBytes) {
      return Promise.reject(new Stage3ApiClientError('INVALID_REQUEST'));
    }
    if (options.signal?.aborted === true) {
      return Promise.reject(new Stage3ApiClientError('REQUEST_ABORTED'));
    }

    const timeoutMilliseconds = validateUploadTimeout(
      options.timeoutMilliseconds,
      this.#uploadTimeoutMilliseconds,
    );

    return new Promise<void>((resolve, reject) => {
      let request: XMLHttpRequest;
      try {
        request = this.#xhr();
      } catch {
        reject(new Stage3ApiClientError('NETWORK_ERROR'));
        return;
      }
      let settled = false;

      const finish = (error?: Stage3ApiClientError): void => {
        if (settled) return;
        settled = true;
        options.signal?.removeEventListener('abort', handleAbort);
        if (error === undefined) resolve();
        else reject(error);
      };
      const reportProgress = (loadedBytes: number, totalBytes: number): void => {
        const safeTotal = Math.max(1, totalBytes);
        const safeLoaded = Math.max(0, Math.min(loadedBytes, safeTotal));
        try {
          options.onProgress?.({
            loadedBytes: safeLoaded,
            percent: Math.round((safeLoaded / safeTotal) * 100),
            totalBytes: safeTotal,
          });
        } catch {
          // Presentation callbacks must not interrupt the byte transfer.
        }
      };
      const handleAbort = (): void => {
        request.abort();
        finish(new Stage3ApiClientError('REQUEST_ABORTED'));
      };

      try {
        request.open(initialized.method, uploadUrl.toString(), true);
        request.withCredentials = false;
        request.timeout = timeoutMilliseconds;
        for (const [name, value] of Object.entries(initialized.headers)) {
          request.setRequestHeader(name, value);
        }
        request.upload.onprogress = (event) => {
          reportProgress(
            event.loaded,
            event.lengthComputable && event.total > 0 ? event.total : file.size,
          );
        };
        request.onload = () => {
          if (request.status < 200 || request.status >= 300) {
            finish(new Stage3ApiClientError('NETWORK_ERROR', { status: request.status }));
            return;
          }
          reportProgress(file.size, file.size);
          finish();
        };
        request.onerror = () => finish(new Stage3ApiClientError('NETWORK_ERROR'));
        request.ontimeout = () => finish(new Stage3ApiClientError('REQUEST_TIMEOUT'));
        request.onabort = () => finish(new Stage3ApiClientError('REQUEST_ABORTED'));
        options.signal?.addEventListener('abort', handleAbort, { once: true });
        reportProgress(0, file.size);
        request.send(file);
      } catch {
        finish(new Stage3ApiClientError('NETWORK_ERROR'));
      }
    });
  }

  public async completeUpload(
    uploadIdInput: string,
    input: UploadCompleteRequest,
    options: ApiRequestOptions = {},
  ): Promise<UploadCompleteResponse> {
    const { id } = parseRequest(UploadIdParamsSchema, { id: uploadIdInput });
    const request = parseRequest(UploadCompleteRequestSchema, input);
    const response = await this.#protectedRequest(
      `/api/uploads/${encodeURIComponent(id)}/complete`,
      UploadCompleteResponseSchema,
      { method: 'POST', body: request },
      options,
    );
    if (response.document.id !== id || response.document.sizeBytes !== request.sizeBytes) {
      throw new Stage3ApiClientError('INVALID_RESPONSE', { status: 200 });
    }
    this.#documents.set(response.document.id, response.document);
    return response;
  }

  /** Returns only documents completed in this in-memory authenticated session. */
  public getDocument(documentIdInput: string): Document | null {
    const documentId = parseRequest(UuidSchema, documentIdInput);
    return this.#documents.get(documentId) ?? null;
  }

  public async fetchDocument(
    documentIdInput: string,
    options: ApiRequestOptions = {},
  ): Promise<UploadCompleteResponse> {
    const { id } = parseRequest(UploadIdParamsSchema, { id: documentIdInput });
    const response = await this.#protectedRequest(
      `/api/uploads/${encodeURIComponent(id)}`,
      UploadCompleteResponseSchema,
      {},
      options,
    );
    if (response.document.id !== id) {
      throw new Stage3ApiClientError('INVALID_RESPONSE', { status: 200 });
    }
    this.#documents.set(response.document.id, response.document);
    return response;
  }

  public async createDownloadLink(
    documentIdInput: string,
    options: ApiRequestOptions = {},
  ): Promise<DocumentDownloadLinkResponse> {
    const { id } = parseRequest(UploadIdParamsSchema, { id: documentIdInput });
    const response = await this.#protectedRequest(
      `/api/uploads/${encodeURIComponent(id)}/download-link`,
      DocumentDownloadLinkResponseSchema,
      { method: 'POST' },
      options,
    );
    const url = new URL(response.downloadUrl);
    const runtimeOrigin = globalThis.location?.origin;
    const query = Object.fromEntries(url.searchParams);
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== '' ||
      url.hash !== '' ||
      (runtimeOrigin !== undefined && url.origin !== runtimeOrigin) ||
      url.pathname !== `/files/${encodeURIComponent(id)}` ||
      !DocumentDownloadQuerySchema.safeParse(query).success
    ) {
      throw new Stage3ApiClientError('INVALID_RESPONSE', { status: 200 });
    }
    return response;
  }

  public createSubmission(
    input: SubmissionCreateRequest,
    options: ApiRequestOptions = {},
  ): Promise<SubmissionCreateResponse> {
    const request = parseRequest(SubmissionCreateRequestSchema, input);
    return this.#protectedRequest(
      '/api/submissions',
      SubmissionCreateResponseSchema,
      { method: 'POST', body: request },
      options,
    );
  }

  public readSubmission(
    submissionId: string,
    options: ApiRequestOptions = {},
  ): Promise<SubmissionReadResponse> {
    const parameters = parseRequest(SubmissionParamsSchema, { submissionId });
    return this.#protectedRequest(
      `/api/submissions/${encodeURIComponent(parameters.submissionId)}`,
      SubmissionReadResponseSchema,
      {},
      options,
    );
  }

  async #protectedRequest<T>(
    path: string,
    schema: RuntimeSchema<T>,
    request: { readonly method?: 'GET' | 'POST'; readonly body?: unknown },
    options: ApiRequestOptions,
  ): Promise<T> {
    const token = this.#sessionToken;
    if (token === null) {
      throw new Stage3ApiClientError('UNAUTHORIZED', { status: 401 });
    }

    return this.#request(path, schema, request, options, token);
  }

  async #request<T>(
    path: string,
    schema: RuntimeSchema<T>,
    request: { readonly method?: 'GET' | 'POST'; readonly body?: unknown },
    options: ApiRequestOptions,
    token: string | null = null,
  ): Promise<T> {
    const controller = new AbortController();
    let timedOut = false;
    const timeoutMilliseconds = validateTimeout(
      options.timeoutMilliseconds,
      this.#timeoutMilliseconds,
    );
    const handleExternalAbort = (): void => {
      controller.abort();
    };

    if (options.signal?.aborted === true) {
      controller.abort();
    } else {
      options.signal?.addEventListener('abort', handleExternalAbort, { once: true });
    }

    const timer = globalThis.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMilliseconds);

    try {
      const hasBody = request.body !== undefined;
      const response = await this.#fetch(`${this.#basePath}${path}`, {
        method: request.method ?? 'GET',
        headers: requestHeaders(token, hasBody),
        ...(hasBody ? { body: JSON.stringify(request.body) } : {}),
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
      });

      if (response.status === 401) this.clearSession();

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new Stage3ApiClientError('INVALID_RESPONSE', { status: response.status });
      }

      if (!response.ok) {
        const errorResult = ApiErrorResponseSchema.safeParse(payload);
        if (!errorResult.success) {
          throw new Stage3ApiClientError('INVALID_RESPONSE', { status: response.status });
        }

        throw new Stage3ApiClientError(errorResult.data.error.code, {
          status: response.status,
          requestId: errorResult.data.error.requestId,
        });
      }

      return parseSuccessfulResponse(schema, payload, response.status);
    } catch (error) {
      if (error instanceof Stage3ApiClientError) throw error;
      if (timedOut) throw new Stage3ApiClientError('REQUEST_TIMEOUT');
      if (options.signal?.aborted === true) throw new Stage3ApiClientError('REQUEST_ABORTED');
      throw new Stage3ApiClientError('NETWORK_ERROR');
    } finally {
      globalThis.clearTimeout(timer);
      options.signal?.removeEventListener('abort', handleExternalAbort);
    }
  }
}
