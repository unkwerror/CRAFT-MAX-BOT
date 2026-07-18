import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AdminApiError } from './admin-api.js';

const SESSION_TOKEN = 'A'.repeat(43);
const SESSION_RESPONSE = {
  authenticated: true as const,
  user: {
    id: '347125190',
    firstName: 'Администратор',
    lastName: null,
    username: null,
    languageCode: 'ru',
    photoUrl: null,
  },
  expiresAt: '2026-07-18T16:00:00.000Z',
};
const AUTH_RESPONSE = { ...SESSION_RESPONSE, sessionToken: SESSION_TOKEN };
const UNAUTHORIZED_RESPONSE = {
  error: {
    code: 'UNAUTHORIZED',
    message: 'Unauthorized',
    requestId: 'request-admin-session',
  },
};

const jsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    headers: { 'content-type': 'application/json' },
    status,
  });

const authorizationFrom = (init: RequestInit | undefined): string | null =>
  new Headers(init?.headers).get('authorization');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('admin password API client', () => {
  it('keeps only the returned token in memory and authorizes the immediate data refresh', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(AUTH_RESPONSE))
      .mockResolvedValueOnce(jsonResponse({ items: [], nextCursor: null }));
    vi.stubGlobal('fetch', fetchMock);
    const { adminApi } = await import('./admin-api.js');

    const response = await adminApi.authenticate('signed-start-param-admin', 'secure-password');
    await adminApi.listSubmissions();

    expect(response.authenticated).toBe(true);
    expect(response.sessionToken).toBe(SESSION_TOKEN);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [loginPath, loginRequest] = fetchMock.mock.calls[0] ?? [];
    expect(loginPath).toBe('/api/admin/auth/password');
    expect(loginRequest?.method).toBe('POST');
    expect(loginRequest?.credentials).toBe('include');
    expect(authorizationFrom(loginRequest)).toBeNull();
    expect(JSON.parse(String(loginRequest?.body))).toEqual({
      initData: 'signed-start-param-admin',
      password: 'secure-password',
    });
    const [listPath, listRequest] = fetchMock.mock.calls[1] ?? [];
    expect(listPath).toBe('/api/admin/submissions?limit=100');
    expect(authorizationFrom(listRequest)).toBe(`Bearer ${SESSION_TOKEN}`);
  });

  it('does not persist the bearer token across a page reload', async () => {
    const firstFetch = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(AUTH_RESPONSE));
    vi.stubGlobal('fetch', firstFetch);
    const firstModule = await import('./admin-api.js');
    await firstModule.adminApi.authenticate('signed-start-param-admin', 'secure-password');

    vi.resetModules();
    const reloadedFetch = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(SESSION_RESPONSE));
    vi.stubGlobal('fetch', reloadedFetch);
    const reloadedModule = await import('./admin-api.js');
    await reloadedModule.adminApi.getSession();

    const [, request] = reloadedFetch.mock.calls[0] ?? [];
    expect(authorizationFrom(request)).toBeNull();
  });

  it('adds the bearer token to all protected admin request methods', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(AUTH_RESPONSE))
      .mockResolvedValueOnce(jsonResponse({ queued: true }, 202))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const { adminApi } = await import('./admin-api.js');

    await adminApi.authenticate('signed-start-param-admin', 'secure-password');
    await adminApi.queueContactHandoff('CRAFT72-000001');
    await adminApi.deleteCase('project-1', 1);

    expect(authorizationFrom(fetchMock.mock.calls[1]?.[1])).toBe(`Bearer ${SESSION_TOKEN}`);
    expect(authorizationFrom(fetchMock.mock.calls[2]?.[1])).toBe(`Bearer ${SESSION_TOKEN}`);
  });

  it('clears the in-memory token after a protected request returns 401', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(AUTH_RESPONSE))
      .mockResolvedValueOnce(jsonResponse(UNAUTHORIZED_RESPONSE, 401))
      .mockResolvedValueOnce(jsonResponse(SESSION_RESPONSE));
    vi.stubGlobal('fetch', fetchMock);
    const { adminApi } = await import('./admin-api.js');

    await adminApi.authenticate('signed-start-param-admin', 'secure-password');
    await expect(adminApi.listSubmissions()).rejects.toEqual(
      expect.objectContaining<Partial<AdminApiError>>({ status: 401 }),
    );
    await adminApi.getSession();

    expect(authorizationFrom(fetchMock.mock.calls[1]?.[1])).toBe(`Bearer ${SESSION_TOKEN}`);
    expect(authorizationFrom(fetchMock.mock.calls[2]?.[1])).toBeNull();
  });

  it('clears the in-memory token even when server logout returns 401', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(AUTH_RESPONSE))
      .mockResolvedValueOnce(jsonResponse(UNAUTHORIZED_RESPONSE, 401))
      .mockResolvedValueOnce(jsonResponse(SESSION_RESPONSE));
    vi.stubGlobal('fetch', fetchMock);
    const { adminApi } = await import('./admin-api.js');

    await adminApi.authenticate('signed-start-param-admin', 'secure-password');
    await expect(adminApi.logout()).rejects.toEqual(
      expect.objectContaining<Partial<AdminApiError>>({ status: 401 }),
    );
    await adminApi.getSession();

    expect(authorizationFrom(fetchMock.mock.calls[1]?.[1])).toBe(`Bearer ${SESSION_TOKEN}`);
    expect(authorizationFrom(fetchMock.mock.calls[2]?.[1])).toBeNull();
  });

  it('clears the in-memory token when logout fails before receiving a response', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(AUTH_RESPONSE))
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(jsonResponse(SESSION_RESPONSE));
    vi.stubGlobal('fetch', fetchMock);
    const { adminApi } = await import('./admin-api.js');

    await adminApi.authenticate('signed-start-param-admin', 'secure-password');
    await expect(adminApi.logout()).rejects.toEqual(
      expect.objectContaining<Partial<AdminApiError>>({ code: 'NETWORK_ERROR', status: 0 }),
    );
    await adminApi.getSession();

    expect(authorizationFrom(fetchMock.mock.calls[2]?.[1])).toBeNull();
  });

  it('preserves a server throttling response for the login form', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: 'RATE_LIMITED',
              message: 'Too many requests',
              requestId: 'request-admin-login',
            },
          },
          429,
        ),
      ),
    );
    const { adminApi } = await import('./admin-api.js');

    await expect(
      adminApi.authenticate('signed-start-param-admin', 'secure-password'),
    ).rejects.toEqual(
      expect.objectContaining<Partial<AdminApiError>>({
        code: 'RATE_LIMITED',
        status: 429,
      }),
    );
  });
});
