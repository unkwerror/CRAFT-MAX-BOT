import { afterEach, describe, expect, it, vi } from 'vitest';

import { adminApi, type AdminApiError } from './admin-api.js';

const jsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    headers: { 'content-type': 'application/json' },
    status,
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('admin password API client', () => {
  it('posts the launch proof and password without exposing a browser-readable credential', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        authenticated: true,
        user: {
          id: '347125190',
          firstName: 'Администратор',
          lastName: null,
          username: null,
          languageCode: 'ru',
          photoUrl: null,
        },
        expiresAt: '2026-07-18T16:00:00.000Z',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await adminApi.authenticate('signed-start-param-admin', 'secure-password');

    expect(response.authenticated).toBe(true);
    expect('token' in response).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [path, request] = fetchMock.mock.calls[0] ?? [];
    expect(path).toBe('/api/admin/auth/password');
    expect(request?.method).toBe('POST');
    expect(request?.credentials).toBe('include');
    expect(JSON.parse(String(request?.body))).toEqual({
      initData: 'signed-start-param-admin',
      password: 'secure-password',
    });
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
