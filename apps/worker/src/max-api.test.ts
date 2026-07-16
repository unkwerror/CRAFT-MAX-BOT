import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MaxApiClient,
  MaxApiRequestError,
  classifyMaxApiFailure,
  parseRetryAfterMilliseconds,
} from './max-api.js';

const TOKEN = 'production-test-token-with-sufficient-entropy';
const body = { text: 'Здравствуйте!' } as const;

afterEach(() => {
  vi.useRealTimers();
});

describe('MaxApiClient', () => {
  it('sends JSON to /messages using a raw Authorization token', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ message: { body: { mid: 'mid.sent' } } }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
    );
    const client = new MaxApiClient({ fetch: fetchMock, token: TOKEN });

    await expect(client.sendMessage('-70801090403050', body)).resolves.toEqual({
      body: { message: { body: { mid: 'mid.sent' } } },
      statusCode: 200,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://platform-api2.max.ru/messages?chat_id=-70801090403050');
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe(TOKEN);
    expect(headers.get('authorization')).not.toContain('Bearer');
    expect(headers.get('content-type')).toBe('application/json');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual(body);
  });

  it('answers callbacks through /answers and requires an explicit success result', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ success: true }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
    );
    const client = new MaxApiClient({ fetch: fetchMock, token: TOKEN });
    const callbackBody = { notification: 'Раздел открыт' } as const;

    await expect(client.answerCallback('callback-id', callbackBody)).resolves.toEqual({
      body: { success: true },
      statusCode: 200,
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://platform-api2.max.ru/answers?callback_id=callback-id');
    expect(new Headers(init?.headers).get('authorization')).toBe(TOKEN);
    expect(JSON.parse(String(init?.body))).toEqual(callbackBody);
  });

  it('treats callback success false as a permanent protocol failure', async () => {
    const client = new MaxApiClient({
      fetch: vi.fn<typeof fetch>(
        async () =>
          new Response(JSON.stringify({ success: false, message: 'private detail' }), {
            status: 200,
          }),
      ),
      token: TOKEN,
    });

    const error = await client
      .answerCallback('callback-id', { notification: 'OK' })
      .catch((failure: unknown) => failure);
    expect(classifyMaxApiFailure(error)).toEqual({
      kind: 'protocol',
      retryable: false,
      retryAfterMs: null,
      statusCode: 200,
    });
    expect(String(error)).not.toContain('private detail');
  });

  it.each([400, 401])('classifies HTTP %s as a permanent failure', async (statusCode) => {
    const client = new MaxApiClient({
      fetch: vi.fn<typeof fetch>(
        async () => new Response('private server detail', { status: statusCode }),
      ),
      token: TOKEN,
    });

    const error = await client.sendMessage('182182182', body).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(MaxApiRequestError);
    expect(classifyMaxApiFailure(error)).toEqual({
      kind: 'http',
      retryable: false,
      retryAfterMs: null,
      statusCode,
    });
    expect(String(error)).not.toContain('private server detail');
    expect(String(error)).not.toContain(TOKEN);
  });

  it('classifies 429 as retryable and honors Retry-After', async () => {
    const client = new MaxApiClient({
      fetch: vi.fn<typeof fetch>(
        async () => new Response(null, { headers: { 'retry-after': '7' }, status: 429 }),
      ),
      token: TOKEN,
    });

    const error = await client.sendMessage('182182182', body).catch((failure: unknown) => failure);
    expect(classifyMaxApiFailure(error)).toEqual({
      kind: 'http',
      retryable: true,
      retryAfterMs: 7_000,
      statusCode: 429,
    });
  });

  it('classifies 503 and other 5xx responses as retryable', async () => {
    const client = new MaxApiClient({
      fetch: vi.fn<typeof fetch>(async () => new Response(null, { status: 503 })),
      token: TOKEN,
    });

    const error = await client.sendMessage('182182182', body).catch((failure: unknown) => failure);
    expect(classifyMaxApiFailure(error)).toMatchObject({
      kind: 'http',
      retryable: true,
      statusCode: 503,
    });
  });

  it('aborts timed-out requests and classifies them as retryable', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>(
      async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    const client = new MaxApiClient({ fetch: fetchMock, timeoutMs: 25, token: TOKEN });
    const request = client.sendMessage('182182182', body).catch((failure: unknown) => failure);
    await vi.advanceTimersByTimeAsync(25);

    expect(classifyMaxApiFailure(await request)).toEqual({
      kind: 'timeout',
      retryable: true,
      retryAfterMs: null,
      statusCode: null,
    });
  });

  it('keeps the timeout active while reading a successful response body', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const stream = new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')));
        },
      });
      return new Response(stream, { status: 200 });
    });
    const client = new MaxApiClient({ fetch: fetchMock, timeoutMs: 25, token: TOKEN });
    const request = client.sendMessage('182182182', body).catch((failure: unknown) => failure);
    await vi.advanceTimersByTimeAsync(25);

    expect(classifyMaxApiFailure(await request)).toEqual({
      kind: 'timeout',
      retryable: true,
      retryAfterMs: null,
      statusCode: null,
    });
  });

  it('parses HTTP-date Retry-After values', () => {
    expect(
      parseRetryAfterMilliseconds(
        'Thu, 16 Jul 2026 02:00:07 GMT',
        Date.parse('2026-07-16T02:00:00Z'),
      ),
    ).toBe(7_000);
  });
});
