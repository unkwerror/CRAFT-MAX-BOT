import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { privacyConsentText, termsAcceptanceText } from '@craft72/contracts/source';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MaxWebAppBridge } from './platform/types.js';

const SESSION_TOKEN = 'A'.repeat(43);

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function installMaxBridge(): void {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  const backButton = {
    isVisible: false,
    show: vi.fn(),
    hide: vi.fn(),
    onClick: vi.fn(),
    offClick: vi.fn(),
  };
  window.WebApp = {
    initData: 'query_id=signed&auth_date=1784102400&hash=server-validated',
    initDataUnsafe: {},
    platform: 'android',
    version: '26.7.0',
    BackButton: backButton,
    getViewportSize: async () => ({ width: '390', height: '844' }),
    enableClosingConfirmation: vi.fn(),
    disableClosingConfirmation: vi.fn(),
    requestContact: vi.fn(),
    openLink: vi.fn(),
    openMaxLink: vi.fn(),
  } as MaxWebAppBridge;
}

afterEach(() => {
  cleanup();
  delete window.WebApp;
  window.location.hash = '';
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('App Stage 3 runtime', () => {
  it('requires explicit consent before MAX auth and then uses bearer for the draft', async () => {
    vi.stubEnv('VITE_PRIVACY_POLICY_URL', 'https://craft72.ru/privacy');
    vi.stubEnv('VITE_CONSENT_VERSION', 'privacy-2026-07-15');
    installMaxBridge();

    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === '/api/auth/max') {
        expect(new Headers(init?.headers).has('authorization')).toBe(false);
        const body = JSON.parse(String(init?.body)) as {
          privacyConsent: { accepted: boolean; acceptedAt: string; text: string; version: string };
          termsAcceptance: { accepted: boolean; acceptedAt: string; text: string; version: string };
        };
        expect(body.privacyConsent).toEqual({
          accepted: true,
          acceptedAt: expect.any(String),
          text: privacyConsentText('privacy-2026-07-15'),
          version: 'privacy-2026-07-15',
        });
        expect(body.termsAcceptance).toEqual({
          accepted: true,
          acceptedAt: expect.any(String),
          text: termsAcceptanceText('privacy-2026-07-15'),
          version: 'privacy-2026-07-15',
        });
        return jsonResponse({
          authenticated: true,
          user: {
            id: '101',
            firstName: 'Максим',
            lastName: 'Иванов',
            username: null,
            languageCode: 'ru',
            photoUrl: null,
          },
          session: {
            token: SESSION_TOKEN,
            expiresAt: '2026-07-15T11:00:00.000Z',
            verifiedContact: null,
          },
          startParam: 'new_project',
        });
      }

      if (url === '/api/leads/draft') {
        expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${SESSION_TOKEN}`);
        return jsonResponse({ draft: null });
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { App } = await import('./App.js');
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Перед началом' })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole('link', { name: 'Политика конфиденциальности' }).getAttribute('href'),
    ).toBe('https://craft72.ru/privacy');

    const continueButton = screen.getByRole('button', { name: 'Продолжить' });
    expect((continueButton as HTMLButtonElement).disabled).toBe(true);
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(2);
    await userEvent.click(checkboxes[0] as HTMLElement);
    expect((continueButton as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(checkboxes[1] as HTMLElement);
    await userEvent.click(continueButton);

    expect(await screen.findByText('MAX · защищённая сессия')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await userEvent.click(screen.getByRole('button', { name: 'Начать бриф' }));
    expect(screen.getByRole('heading', { name: 'Новый проект' })).toBeTruthy();
  });

  it('keeps MAX in preview when the approved policy configuration is absent', async () => {
    installMaxBridge();
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const { App } = await import('./App.js');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('MAX · preview')).toBeTruthy();
    });
    expect(
      screen.getByText(
        'Без утверждённой политики персональные данные остаются только в preview-режиме',
      ),
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
