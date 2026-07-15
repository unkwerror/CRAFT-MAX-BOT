import {
  ApiErrorResponseSchema,
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
  type ApiErrorCode,
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
  type VerifiedContactSnapshot,
  privacyConsentText,
  termsAcceptanceText,
} from '@craft72/contracts/source';

const DEFAULT_TIMEOUT_MILLISECONDS = 12_000;
const MAX_TIMEOUT_MILLISECONDS = 120_000;

interface RuntimeSchema<T> {
  safeParse(
    input: unknown,
  ): { readonly success: true; readonly data: T } | { readonly success: false };
}

export interface ApiRequestOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMilliseconds?: number;
}

export interface Stage3ApiClientOptions {
  /** Root-relative prefix only. An empty prefix calls the production same-origin `/api/*` routes. */
  readonly basePath?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMilliseconds?: number;
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
  readonly #fetch: typeof globalThis.fetch;
  readonly #timeoutMilliseconds: number;
  #sessionToken: string | null = null;

  public constructor(options: Stage3ApiClientOptions = {}) {
    this.#basePath = normalizeBasePath(options.basePath);
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#timeoutMilliseconds = validateTimeout(
      options.timeoutMilliseconds,
      DEFAULT_TIMEOUT_MILLISECONDS,
    );
  }

  public hasSession(): boolean {
    return this.#sessionToken !== null;
  }

  public clearSession(): void {
    this.#sessionToken = null;
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
