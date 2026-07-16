export interface MaxOpenAppButton {
  readonly payload?: string;
  readonly text: string;
  readonly type: 'open_app';
  /** Public bot username (or a MAX-supported app link), per the current MAX wire model. */
  readonly web_app: string;
}

export interface MaxMessageButton {
  readonly text: string;
  readonly type: 'message';
}

export type MaxKeyboardButton = MaxMessageButton | MaxOpenAppButton;

export interface MaxInlineKeyboardAttachment {
  readonly payload: {
    readonly buttons: readonly (readonly MaxKeyboardButton[])[];
  };
  readonly type: 'inline_keyboard';
}

export interface MaxSendMessageBody {
  readonly attachments?: readonly MaxInlineKeyboardAttachment[];
  readonly format?: 'html' | 'markdown';
  readonly notify?: boolean;
  readonly text: string;
}

export interface MaxAnswerCallbackBody {
  readonly message?: MaxSendMessageBody;
  readonly notification?: string;
}

export interface MaxSendMessageResult {
  readonly body: unknown;
  readonly statusCode: number;
}

export type MaxApiFailureKind = 'http' | 'network' | 'protocol' | 'timeout' | 'unknown';

export interface MaxApiFailureClassification {
  readonly kind: MaxApiFailureKind;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;
  readonly statusCode: number | null;
}

interface MaxApiRequestErrorOptions extends MaxApiFailureClassification {
  readonly cause?: unknown;
}

export class MaxApiRequestError extends Error {
  public readonly kind: MaxApiFailureKind;
  public readonly retryable: boolean;
  public readonly retryAfterMs: number | null;
  public readonly statusCode: number | null;

  public constructor(message: string, options: MaxApiRequestErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'MaxApiRequestError';
    this.kind = options.kind;
    this.retryable = options.retryable;
    this.retryAfterMs = options.retryAfterMs;
    this.statusCode = options.statusCode;
  }
}

export interface MaxApiClientOptions {
  readonly baseUrl?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly token: string;
}

const DEFAULT_MAX_API_BASE_URL = 'https://platform-api2.max.ru';
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1_000;
const CHAT_ID_PATTERN = /^-?[1-9]\d{0,18}$/;

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new TypeError('MAX API base URL is invalid', { cause: error });
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new TypeError('MAX API base URL must be a credential-free HTTPS URL');
  }
  return url.href.replace(/\/$/, '');
}

function validChatId(value: string): string {
  if (!CHAT_ID_PATTERN.test(value)) throw new TypeError('MAX chat ID is invalid');
  try {
    const id = BigInt(value);
    if (id < -9_223_372_036_854_775_808n || id > 9_223_372_036_854_775_807n) {
      throw new TypeError('MAX chat ID does not fit int64');
    }
    return id.toString();
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError('MAX chat ID is invalid', { cause: error });
  }
}

function validCallbackId(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 4_096 || /[\r\n]/.test(normalized)) {
    throw new TypeError('MAX callback ID is invalid');
  }
  return normalized;
}

function assertValidMessageBody(body: MaxSendMessageBody): void {
  if (body.text.trim().length === 0 && (body.attachments?.length ?? 0) === 0) {
    throw new TypeError('MAX message must contain text or an attachment');
  }
}

function recordFromUnknown(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function classifyHttpStatus(statusCode: number, retryAfterMs: number | null): MaxApiRequestError {
  const retryable = statusCode === 429 || statusCode >= 500;
  return new MaxApiRequestError(`MAX API request failed with HTTP ${statusCode}`, {
    kind: 'http',
    retryable,
    retryAfterMs: retryable ? retryAfterMs : null,
    statusCode,
  });
}

export function parseRetryAfterMilliseconds(
  value: string | null,
  nowMilliseconds = Date.now(),
): number | null {
  if (value === null) return null;
  const normalized = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(normalized)) {
    const milliseconds = Math.ceil(Number(normalized) * 1_000);
    return Number.isFinite(milliseconds) ? Math.min(milliseconds, MAX_RETRY_AFTER_MS) : null;
  }

  const date = Date.parse(normalized);
  if (Number.isNaN(date)) return null;
  return Math.min(Math.max(0, date - nowMilliseconds), MAX_RETRY_AFTER_MS);
}

export function classifyMaxApiFailure(error: unknown): MaxApiFailureClassification {
  if (error instanceof MaxApiRequestError) {
    return {
      kind: error.kind,
      retryable: error.retryable,
      retryAfterMs: error.retryAfterMs,
      statusCode: error.statusCode,
    };
  }
  return {
    kind: 'unknown',
    retryable: false,
    retryAfterMs: null,
    statusCode: null,
  };
}

async function readSuccessBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new MaxApiRequestError('MAX API returned malformed success JSON', {
      cause: error,
      kind: 'protocol',
      retryable: true,
      retryAfterMs: null,
      statusCode: response.status,
    });
  }
}

export class MaxApiClient {
  readonly #baseUrl: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #now: () => number;
  readonly #timeoutMs: number;
  readonly #token: string;

  public constructor(options: MaxApiClientOptions) {
    const token = options.token.trim();
    if (token.length < 16 || /[\r\n]/.test(token)) throw new TypeError('MAX bot token is invalid');
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
      throw new RangeError('MAX API timeout must be an integer from 1 to 60000 milliseconds');
    }

    this.#baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_MAX_API_BASE_URL);
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#now = options.now ?? Date.now;
    this.#timeoutMs = timeoutMs;
    this.#token = token;
  }

  public async sendMessage(
    chatIdInput: string,
    body: MaxSendMessageBody,
  ): Promise<MaxSendMessageResult> {
    const chatId = validChatId(chatIdInput);
    assertValidMessageBody(body);

    return this.#post('/messages', 'chat_id', chatId, body);
  }

  public async answerCallback(
    callbackIdInput: string,
    body: MaxAnswerCallbackBody,
  ): Promise<MaxSendMessageResult> {
    const callbackId = validCallbackId(callbackIdInput);
    const notification = body.notification?.trim();
    if (body.message === undefined && (notification === undefined || notification.length === 0)) {
      throw new TypeError('MAX callback answer must contain a message or notification');
    }
    if (body.message !== undefined) assertValidMessageBody(body.message);
    if (notification !== undefined && notification.length > 4_000) {
      throw new TypeError('MAX callback notification is too long');
    }

    const result = await this.#post('/answers', 'callback_id', callbackId, body);
    const response = recordFromUnknown(result.body);
    if (response?.success !== true) {
      throw new MaxApiRequestError('MAX API rejected or malformed the callback answer result', {
        kind: 'protocol',
        retryable: response?.success !== false,
        retryAfterMs: null,
        statusCode: result.statusCode,
      });
    }
    return result;
  }

  async #post(
    pathname: string,
    queryName: string,
    queryValue: string,
    body: MaxAnswerCallbackBody | MaxSendMessageBody,
  ): Promise<MaxSendMessageResult> {
    const url = new URL(pathname, `${this.#baseUrl}/`);
    url.searchParams.set(queryName, queryValue);
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.#timeoutMs);
    timeout.unref?.();

    try {
      const response = await this.#fetch(url, {
        body: JSON.stringify(body),
        headers: {
          authorization: this.#token,
          'content-type': 'application/json',
        },
        method: 'POST',
        signal: controller.signal,
      });
      if (!response.ok) {
        const retryAfterMs = parseRetryAfterMilliseconds(
          response.headers.get('retry-after'),
          this.#now(),
        );
        await response.body?.cancel().catch(() => undefined);
        throw classifyHttpStatus(response.status, retryAfterMs);
      }

      return { body: await readSuccessBody(response), statusCode: response.status };
    } catch (error) {
      if (error instanceof MaxApiRequestError) throw error;
      if (timedOut || controller.signal.aborted) {
        throw new MaxApiRequestError('MAX API request timed out', {
          cause: error,
          kind: 'timeout',
          retryable: true,
          retryAfterMs: null,
          statusCode: null,
        });
      }
      throw new MaxApiRequestError('MAX API network request failed', {
        cause: error,
        kind: 'network',
        retryable: true,
        retryAfterMs: null,
        statusCode: null,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
