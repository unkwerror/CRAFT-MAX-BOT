export interface TrackerCreateIssueBody {
  readonly [fieldId: string]: unknown;
  readonly assignee?: string;
  readonly description: string;
  readonly links?: readonly { readonly issue: string; readonly relationship: 'relates' }[];
  readonly markupType: 'md';
  readonly queue: string;
  readonly summary: string;
  readonly type?: string;
  readonly unique: string;
}

export interface TrackerIssueResult {
  readonly key: string;
}

export type TrackerApiFailureKind = 'http' | 'network' | 'protocol' | 'timeout';

export class TrackerApiError extends Error {
  public readonly kind: TrackerApiFailureKind;
  public readonly retryAfterMs: number | null;
  public readonly retryable: boolean;
  public readonly statusCode: number | null;

  public constructor(
    kind: TrackerApiFailureKind,
    options: {
      readonly cause?: unknown;
      readonly retryAfterMs?: number | null;
      readonly retryable: boolean;
      readonly statusCode?: number | null;
    },
  ) {
    super(
      `Tracker API ${kind} failure`,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'TrackerApiError';
    this.kind = kind;
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.retryable = options.retryable;
    this.statusCode = options.statusCode ?? null;
  }
}

export interface TrackerApiClientOptions {
  readonly authType: 'iam' | 'oauth';
  readonly baseUrl: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
  readonly organizationHeader: 'X-Cloud-Org-ID' | 'X-Org-ID';
  readonly organizationId: string;
  readonly timeoutMs: number;
  readonly token: string;
}

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1_000;
const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,31}-[1-9]\d*$/;
const PART_INN_FIELD = '69e7541f05f9ba3198eb07fe--inn';

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (
    url.href !== 'https://api.tracker.yandex.net/v3' &&
    url.href !== 'https://api.tracker.yandex.net/v3/'
  ) {
    throw new TypeError('Tracker API base URL is not approved');
  }
  return url.href.replace(/\/$/, '');
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function issueKey(value: unknown): string | null {
  const candidate = record(value)?.key;
  return typeof candidate === 'string' && ISSUE_KEY_PATTERN.test(candidate) ? candidate : null;
}

function retryAfterMilliseconds(value: string | null, now: number): number | null {
  if (value === null) return null;
  const normalized = value.trim();
  if (/^\d+(?:[.]\d+)?$/.test(normalized)) {
    const milliseconds = Math.ceil(Number(normalized) * 1_000);
    return Number.isFinite(milliseconds) ? Math.min(milliseconds, MAX_RETRY_AFTER_MS) : null;
  }
  const date = Date.parse(normalized);
  return Number.isNaN(date) ? null : Math.min(Math.max(0, date - now), MAX_RETRY_AFTER_MS);
}

async function readJson(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new TrackerApiError('protocol', { retryable: true, statusCode: response.status });
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
    throw new TrackerApiError('protocol', { retryable: true, statusCode: response.status });
  }
  try {
    return text.length === 0 ? null : (JSON.parse(text) as unknown);
  } catch (error) {
    throw new TrackerApiError('protocol', {
      cause: error,
      retryable: true,
      statusCode: response.status,
    });
  }
}

export class TrackerApiClient {
  readonly #baseUrl: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #headers: Readonly<Record<string, string>>;
  readonly #now: () => number;
  readonly #timeoutMs: number;

  public constructor(options: TrackerApiClientOptions) {
    if (options.token.trim().length < 16 || /[\r\n]/.test(options.token)) {
      throw new TypeError('Tracker token is invalid');
    }
    if (options.organizationId.trim().length === 0 || /[\r\n]/.test(options.organizationId)) {
      throw new TypeError('Tracker organization ID is invalid');
    }
    if (
      !Number.isSafeInteger(options.timeoutMs) ||
      options.timeoutMs < 500 ||
      options.timeoutMs > 30_000
    ) {
      throw new RangeError('Tracker API timeout is invalid');
    }
    this.#baseUrl = normalizeBaseUrl(options.baseUrl);
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#now = options.now ?? Date.now;
    this.#timeoutMs = options.timeoutMs;
    this.#headers = {
      Authorization: `${options.authType === 'oauth' ? 'OAuth' : 'Bearer'} ${options.token.trim()}`,
      'Content-Type': 'application/json',
      [options.organizationHeader]: options.organizationId.trim(),
    };
  }

  public async ensureIssue(body: TrackerCreateIssueBody): Promise<TrackerIssueResult> {
    const partnerInn = body.queue === 'PART' ? body[PART_INN_FIELD] : undefined;
    if (typeof partnerInn === 'string' && /^[0-9]{10}(?:[0-9]{2})?$/.test(partnerInn)) {
      const existing = await this.#findSingle({
        queue: 'PART',
        type: 'kompania',
        [PART_INN_FIELD]: partnerInn,
      });
      if (existing !== null) return existing;
    }
    try {
      const result = await this.#request('/issues/?notify=false', {
        body: JSON.stringify(body),
        method: 'POST',
      });
      const key = issueKey(Array.isArray(result) ? result[0] : result);
      if (key === null) throw new TrackerApiError('protocol', { retryable: true, statusCode: 201 });
      return { key };
    } catch (error) {
      if (!(error instanceof TrackerApiError) || error.statusCode !== 409) throw error;
      return this.#findByUnique(body.unique);
    }
  }

  async #findByUnique(unique: string): Promise<TrackerIssueResult> {
    const result = await this.#findSingle({ unique });
    if (result === null) {
      throw new TrackerApiError('protocol', { retryable: false, statusCode: 409 });
    }
    return result;
  }

  async #findSingle(filter: Readonly<Record<string, string>>): Promise<TrackerIssueResult | null> {
    const result = await this.#request('/issues/_search?perPage=2', {
      body: JSON.stringify({ filter }),
      method: 'POST',
    });
    if (!Array.isArray(result) || result.length > 1) {
      throw new TrackerApiError('protocol', { retryable: false, statusCode: 409 });
    }
    if (result.length === 0) return null;
    const key = issueKey(result[0]);
    if (key === null) throw new TrackerApiError('protocol', { retryable: false, statusCode: 409 });
    return { key };
  }

  async #request(
    path: string,
    init: { readonly body: string; readonly method: 'POST' },
  ): Promise<unknown> {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.#timeoutMs);
    timeout.unref?.();
    try {
      const response = await this.#fetch(`${this.#baseUrl}${path}`, {
        ...init,
        headers: this.#headers,
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        const retryAfterMs = retryable
          ? retryAfterMilliseconds(response.headers.get('retry-after'), this.#now())
          : null;
        await response.body?.cancel().catch(() => undefined);
        throw new TrackerApiError('http', {
          retryAfterMs,
          retryable,
          statusCode: response.status,
        });
      }
      return await readJson(response);
    } catch (error) {
      if (error instanceof TrackerApiError) throw error;
      throw new TrackerApiError(timedOut ? 'timeout' : 'network', {
        cause: error,
        retryable: true,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function classifyTrackerFailure(error: unknown): {
  readonly retryAfterMs: number | null;
  readonly retryable: boolean;
  readonly statusCode: number | null;
} {
  return error instanceof TrackerApiError
    ? {
        retryAfterMs: error.retryAfterMs,
        retryable: error.retryable,
        statusCode: error.statusCode,
      }
    : { retryAfterMs: null, retryable: false, statusCode: null };
}
