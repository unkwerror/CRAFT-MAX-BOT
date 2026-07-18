import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { privacyConsentText, termsAcceptanceText } from '@craft72/contracts/source';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MaxWebAppBridge } from './platform/types.js';

const SESSION_TOKEN = 'A'.repeat(43);
const UPLOAD_ID = '20000000-0000-4000-8000-000000000002';
const SHA256 = 'a'.repeat(64);

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function installMaxBridge(): MaxWebAppBridge {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  const backButton = {
    isVisible: false,
    show: vi.fn(),
    hide: vi.fn(),
    onClick: vi.fn(),
    offClick: vi.fn(),
  };
  const webApp = {
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
    close: vi.fn(),
  } as MaxWebAppBridge;
  window.WebApp = webApp;
  return webApp;
}

afterEach(() => {
  cleanup();
  delete window.WebApp;
  window.location.hash = '';
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('App Stage 3 runtime', () => {
  it('requires explicit consent before MAX auth and then uses bearer for the draft', async () => {
    vi.stubEnv('VITE_PRIVACY_POLICY_URL', 'https://craft72.ru/privacy');
    vi.stubEnv('VITE_CONSENT_VERSION', 'privacy-2026-07-15');
    installMaxBridge();
    let resolveDraftRequest!: (response: Response) => void;
    const draftResponse = new Promise<Response>((resolve) => {
      resolveDraftRequest = resolve;
    });

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
        return draftResponse;
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

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Проверяем защищённую MAX-сессию…')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Новый проект' })).toBeNull();
    expect(window.location.hash).toBe('');

    resolveDraftRequest(jsonResponse({ draft: null }));
    expect(await screen.findByText('MAX · защищённая сессия')).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/auth/max')).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/leads/draft')).toBe(true);
    expect(screen.getByRole('heading', { name: 'Новый проект' })).toBeTruthy();
    expect(window.location.hash).toBe('#brief');
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

  it('restores authenticated upload metadata and opens a short-lived download link', async () => {
    vi.stubEnv('VITE_PRIVACY_POLICY_URL', 'https://craft72.ru/privacy');
    vi.stubEnv('VITE_CONSENT_VERSION', 'privacy-2026-07-16');
    const webApp = installMaxBridge();
    const draft = {
      id: '10000000-0000-4000-8000-000000000001',
      currentStep: 13,
      payload: { documentIds: [UPLOAD_ID], description: 'Материалы проекта' },
      source: null,
      updatedAt: '2026-07-16T08:00:00.000Z',
      expiresAt: '2026-08-15T08:00:00.000Z',
    };
    const document = {
      id: UPLOAD_ID,
      originalName: 'brief.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1_024,
      sha256: SHA256,
      scanStatus: 'clean',
      createdAt: '2026-07-16T08:00:00.000Z',
    };
    const downloadUrl = `https://craft72app.ru/files/${UPLOAD_ID}?grant=${UPLOAD_ID}&expires=1784103300&signature=${SHA256}`;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === '/api/auth/max') {
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
            expiresAt: '2026-07-16T11:00:00.000Z',
            verifiedContact: null,
          },
          startParam: 'upload_brief',
        });
      }
      if (url === '/api/leads/draft') return jsonResponse({ draft });
      if (url === `/api/uploads/${UPLOAD_ID}`) return jsonResponse({ document });
      if (url === `/api/uploads/${UPLOAD_ID}/download-link`) {
        expect(init?.method).toBe('POST');
        return jsonResponse({
          downloadUrl,
          expiresAt: '2026-07-16T08:15:00.000Z',
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { App } = await import('./App.js');
    render(<App />);

    const checkboxes = screen.getAllByRole('checkbox');
    await userEvent.click(checkboxes[0] as HTMLElement);
    await userEvent.click(checkboxes[1] as HTMLElement);
    await userEvent.click(screen.getByRole('button', { name: 'Продолжить' }));

    expect(await screen.findByRole('heading', { name: 'Загрузка файлов' })).toBeTruthy();
    expect(screen.getByText('brief.pdf')).toBeTruthy();
    expect((screen.getByLabelText('Выбрать файлы') as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByText('Защищённая загрузка')).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          url === `/api/uploads/${UPLOAD_ID}` &&
          new Headers(init?.headers).get('authorization') === `Bearer ${SESSION_TOKEN}`,
      ),
    ).toBe(true);
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) => url === '/api/leads/draft' && init?.method === 'POST',
        ),
      ).toBe(true),
    );
    const savedDraftCall = fetchMock.mock.calls.find(
      ([url, init]) => url === '/api/leads/draft' && init?.method === 'POST',
    );
    expect(JSON.parse(String(savedDraftCall?.[1]?.body))).toMatchObject({
      payload: { documentIds: [UPLOAD_ID] },
    });

    await userEvent.click(screen.getByRole('button', { name: 'Скачать файл brief.pdf' }));
    await waitFor(() => expect(webApp.openLink).toHaveBeenCalledWith(downloadUrl));
  });

  it('opens the configured manager profile before the phone fallback', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_MAX_BOT_URL', 'https://max.ru/se13560957_bot');
    vi.stubEnv('VITE_MAX_MANAGER_PROFILE_URL', 'https://max.ru/u/Manager_token-123');
    vi.stubEnv('VITE_MAX_MANAGER_PHONE', '+79220063645');
    vi.stubEnv('VITE_MAX_MANAGER_USER_ID', '61096226');
    vi.stubEnv('VITE_PRIVACY_POLICY_URL', '');
    vi.stubEnv('VITE_CONSENT_VERSION', '');
    const webApp = installMaxBridge();

    const { App } = await import('./App.js');
    render(<App />);

    await userEvent.click(screen.getByRole('button', { name: /менеджер/i }));

    expect(webApp.openMaxLink).toHaveBeenCalledOnce();
    expect(webApp.openMaxLink).toHaveBeenCalledWith('https://max.ru/u/Manager_token-123');
    expect(webApp.close).not.toHaveBeenCalled();
    expect(screen.queryByText(/Не удалось открыть/)).toBeNull();
  });

  it('does not substitute the bot profile when manager contacts are not configured', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_MAX_BOT_URL', 'https://max.ru/se13560957_bot');
    vi.stubEnv('VITE_MAX_MANAGER_PROFILE_URL', '');
    vi.stubEnv('VITE_MAX_MANAGER_PHONE', '');
    vi.stubEnv('VITE_MAX_MANAGER_USER_ID', '');
    vi.stubEnv('VITE_PRIVACY_POLICY_URL', '');
    vi.stubEnv('VITE_CONSENT_VERSION', '');
    const webApp = installMaxBridge();

    const { App } = await import('./App.js');
    render(<App />);

    await userEvent.click(screen.getByRole('button', { name: /менеджер/i }));

    expect(webApp.openMaxLink).not.toHaveBeenCalled();
    expect(screen.getByText(/Профиль менеджера в MAX временно недоступен/)).toBeTruthy();
  });

  it('uses the supported bot handoff for a numeric manager MAX ID before phone fallback', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_MAX_BOT_URL', 'https://max.ru/se13560957_bot');
    vi.stubEnv('VITE_MAX_MANAGER_PROFILE_URL', '');
    vi.stubEnv('VITE_MAX_MANAGER_PHONE', '+79220063645');
    vi.stubEnv('VITE_MAX_MANAGER_USER_ID', '347125190');
    vi.stubEnv('VITE_PRIVACY_POLICY_URL', '');
    vi.stubEnv('VITE_CONSENT_VERSION', '');
    const webApp = installMaxBridge();
    const browserOpen = vi.spyOn(window, 'open').mockReturnValue({} as Window);

    const { App } = await import('./App.js');
    render(<App />);

    await userEvent.click(screen.getByRole('button', { name: /менеджер/i }));

    expect(webApp.openMaxLink).not.toHaveBeenCalled();
    expect(webApp.openLink).toHaveBeenCalledOnce();
    expect(webApp.openLink).toHaveBeenCalledWith(
      'https://max.ru/se13560957_bot?start=manager_contact',
    );
    expect(browserOpen).not.toHaveBeenCalled();
    expect(webApp.close).not.toHaveBeenCalled();
  });

  it('uses the phone only when manager profile links are unavailable', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_MAX_BOT_URL', 'https://max.ru/se13560957_bot');
    vi.stubEnv('VITE_MAX_MANAGER_PROFILE_URL', '');
    vi.stubEnv('VITE_MAX_MANAGER_PHONE', '+79220063645');
    vi.stubEnv('VITE_MAX_MANAGER_USER_ID', '');
    vi.stubEnv('VITE_PRIVACY_POLICY_URL', '');
    vi.stubEnv('VITE_CONSENT_VERSION', '');
    const webApp = installMaxBridge();
    const browserOpen = vi.spyOn(window, 'open').mockReturnValue({} as Window);

    const { App } = await import('./App.js');
    render(<App />);

    await userEvent.click(screen.getByRole('button', { name: /менеджер/i }));

    expect(webApp.openMaxLink).not.toHaveBeenCalled();
    expect(browserOpen).toHaveBeenCalledWith('tel:+79220063645', '_blank', 'noopener,noreferrer');
    expect(webApp.close).not.toHaveBeenCalled();
  });
});
