import { describe, expect, it, vi } from 'vitest';

import { TrackerApiClient, type TrackerApiError } from './tracker-api.js';

const TOKEN = 'tracker-test-token-with-enough-entropy';
const body = {
  description: 'Dry-run fixture',
  markupType: 'md',
  queue: 'CRM',
  summary: 'CRAFT fixture',
  unique: 'craft72:crm:CRAFT-TEST-1',
} as const;
const PART_INN_FIELD = '69e7541f05f9ba3198eb07fe--inn';

function client(fetch: typeof globalThis.fetch, timeoutMs = 10_000): TrackerApiClient {
  return new TrackerApiClient({
    authType: 'oauth',
    baseUrl: 'https://api.tracker.yandex.net/v3',
    fetch,
    organizationHeader: 'X-Org-ID',
    organizationId: '3676790',
    timeoutMs,
    token: TOKEN,
  });
}

describe('Tracker API client', () => {
  it('creates a non-notifying issue with the official auth headers', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe(`OAuth ${TOKEN}`);
      expect(headers.get('x-org-id')).toBe('3676790');
      expect(JSON.parse(String(init?.body))).toEqual(body);
      return new Response(JSON.stringify({ key: 'CRM-101' }), { status: 201 });
    });

    await expect(client(fetchMock).ensureIssue(body)).resolves.toEqual({ key: 'CRM-101' });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://api.tracker.yandex.net/v3/issues/?notify=false',
    );
  });

  it('resolves a lost or duplicate create through the exact unique field after 409', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ key: 'CRM-102' }]), { status: 200 }));

    await expect(client(fetchMock).ensureIssue(body)).resolves.toEqual({ key: 'CRM-102' });
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      'https://api.tracker.yandex.net/v3/issues/_search?perPage=2',
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      filter: { unique: body.unique },
    });
  });

  it('reuses the single PART issue found by exact canonical INN before creating', async () => {
    const partnerBody = {
      ...body,
      [PART_INN_FIELD]: '7707083893',
      queue: 'PART',
      type: 'kompania',
      unique: 'craft72:part:inn:7707083893',
    } as const;
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Promise.resolve(new Response(JSON.stringify([{ key: 'PART-17' }]), { status: 200 })),
    );

    await expect(client(fetchMock).ensureIssue(partnerBody)).resolves.toEqual({ key: 'PART-17' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      filter: { queue: 'PART', type: 'kompania', [PART_INN_FIELD]: '7707083893' },
    });
  });

  it('creates PART only after the exact INN lookup returns no result', async () => {
    const partnerBody = {
      ...body,
      [PART_INN_FIELD]: '7707083893',
      queue: 'PART',
      type: 'kompania',
      unique: 'craft72:part:inn:7707083893',
    } as const;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ key: 'PART-18' }), { status: 201 }));

    await expect(client(fetchMock).ensureIssue(partnerBody)).resolves.toEqual({ key: 'PART-18' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('classifies throttling without reading or exposing the response body', async () => {
    const error = await client(
      vi.fn<typeof fetch>(
        async () =>
          new Response('private Tracker error', { headers: { 'retry-after': '3' }, status: 429 }),
      ),
    )
      .ensureIssue(body)
      .catch((value: unknown) => value);
    expect(error).toMatchObject({
      kind: 'http',
      retryable: true,
      retryAfterMs: 3_000,
      statusCode: 429,
    } satisfies Partial<TrackerApiError>);
    expect(String(error)).not.toContain('private Tracker error');
    expect(String(error)).not.toContain(TOKEN);
  });

  it('times out while reading a stalled success body', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      const signal = init?.signal;
      const stream = new ReadableStream({
        start(controller) {
          signal?.addEventListener(
            'abort',
            () => controller.error(new DOMException('aborted', 'AbortError')),
            { once: true },
          );
        },
      });
      return new Response(stream, { status: 201 });
    });

    await expect(client(fetchMock, 500).ensureIssue(body)).rejects.toMatchObject({
      kind: 'timeout',
      retryable: true,
    } satisfies Partial<TrackerApiError>);
  });
});
