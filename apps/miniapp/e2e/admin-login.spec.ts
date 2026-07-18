import { expect, test, type Page, type Route } from '@playwright/test';

const ADMIN_INIT_DATA =
  'query_id=admin-e2e&auth_date=1784332800&start_param=admin&hash=server-validated';
const ADMIN_SUBMISSION = {
  submissionId: 'CRAFT72-000001',
  maxUserId: '70000001',
  user: {
    id: '70000001',
    firstName: 'Иван',
    lastName: 'Петров',
    username: null,
    languageCode: 'ru',
  },
  intake: {
    role: 'property_owner',
    fullName: 'Иван Петров',
    organization: 'ООО Проект',
    inn: null,
    objectType: 'public-building',
    location: { city: 'Тюмень' },
    scope: { kind: 'single_object' },
    area: { status: 'unknown' },
    currentStage: 'concept',
    services: ['architecture'],
    expertiseRequired: 'unknown',
    culturalHeritageSite: 'no',
    desiredStart: { status: 'unknown' },
    description: 'Тестовая заявка для проверки контакта в MAX.',
    links: [],
    documentIds: [],
    selectedCaseIds: [],
    contact: { phone: '+79990000000', email: 'client@example.com' },
    consent: { version: '2026-07-18', accepted: true },
  },
  phoneVerified: true,
  integrationStatus: 'received',
  reviewStatus: 'new',
  adminNote: null,
  submittedAt: '2026-07-18T08:00:00.000Z',
  updatedAt: '2026-07-18T08:00:00.000Z',
} as const;

async function installMaxLaunch(page: Page, initData: string): Promise<void> {
  await page.addInitScript((signedInitData) => {
    Object.defineProperty(window, 'WebApp', {
      configurable: true,
      value: {
        BackButton: {
          isVisible: false,
          hide: () => undefined,
          offClick: () => undefined,
          onClick: () => undefined,
          show: () => undefined,
        },
        close: () => undefined,
        colorScheme: 'light',
        disableClosingConfirmation: () => undefined,
        enableClosingConfirmation: () => undefined,
        getViewportSize: async () => ({ height: String(innerHeight), width: String(innerWidth) }),
        initData: signedInitData,
        initDataUnsafe: {},
        openLink: () => undefined,
        openMaxLink: () => undefined,
        platform: 'android',
        requestContact: async () => Promise.reject(new Error('Unavailable in admin E2E')),
        version: '26.20.0-e2e',
      },
    });
  }, initData);
  await page.route('https://st.max.ru/**', (route) => route.abort());
}

async function adminApiRoute(route: Route): Promise<void> {
  const request = route.request();
  const url = new URL(request.url());
  const json = (body: unknown, status = 200) =>
    route.fulfill({ body: JSON.stringify(body), contentType: 'application/json', status });

  if (url.pathname === '/api/admin/session') {
    await json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'A valid admin session is required',
          requestId: 'admin-e2e-session',
        },
      },
      401,
    );
    return;
  }
  if (url.pathname === '/api/admin/auth/password') {
    expect(request.method()).toBe('POST');
    expect(request.postDataJSON()).toEqual({
      initData: ADMIN_INIT_DATA,
      password: 'secure-password',
    });
    await json({
      authenticated: true,
      user: {
        id: '347125190',
        firstName: 'Системный',
        lastName: null,
        username: null,
        languageCode: 'ru',
        photoUrl: null,
      },
      expiresAt: '2026-07-18T16:00:00.000Z',
    });
    return;
  }
  if (url.pathname.endsWith('/contact-handoff')) {
    expect(request.method()).toBe('POST');
    await json({ queued: true }, 202);
    return;
  }
  if (url.pathname === '/api/admin/users') {
    await json({ items: [], nextCursor: null });
    return;
  }
  if (url.pathname === '/api/admin/submissions') {
    await json({ items: [ADMIN_SUBMISSION], nextCursor: null });
    return;
  }
  if (url.pathname === '/api/admin/cases' || url.pathname === '/api/admin/content') {
    await json({ items: [] });
    return;
  }
  await route.abort();
}

test('admin launch shows a responsive password login and opens the control panel', async ({
  page,
}) => {
  await installMaxLaunch(page, ADMIN_INIT_DATA);
  await page.route('**/api/admin/**', adminApiRoute);
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: 'Вход в КРАФТ Control' })).toBeVisible();
  const password = page.getByLabel('Пароль администратора');
  await expect(password).toHaveAttribute('type', 'password');
  await expect(password).toHaveAttribute('autocomplete', 'current-password');
  await expect(page.getByRole('button', { name: 'Войти' })).toBeDisabled();

  const layout = await page.evaluate(() => ({
    innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    formWidth: document.querySelector('.admin-login-form')?.getBoundingClientRect().width ?? 0,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.innerWidth);
  expect(layout.formWidth).toBeGreaterThan(250);
  expect(layout.formWidth).toBeLessThanOrEqual(Math.min(430, layout.innerWidth));

  await password.fill('secure-password');
  await page.getByRole('button', { name: 'Войти' }).click();

  await expect(
    page.getByRole('heading', { name: 'Добро пожаловать в КРАФТ Control' }),
  ).toBeVisible();
  await expect(page.locator('.admin-profile')).toContainText('Администратор');
  await expect(page.locator('.admin-profile')).not.toContainText('Системный');

  await page
    .getByRole('navigation', { name: 'Разделы админ-панели' })
    .getByRole('button', { name: /Заявки/ })
    .click();
  await page.getByRole('row', { name: /Иван Петров/ }).click();
  await expect(page.getByRole('button', { name: 'Написать в MAX' })).toBeVisible();
  await expect(page.locator('a[href^="mailto:"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Написать в MAX' }).click();
  await expect(page.getByRole('button', { name: 'Открыть чат с ботом' })).toBeVisible();

  const detailLayout = await page.evaluate(() => ({
    innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    actionsWidth:
      document.querySelector('.admin-contact-actions')?.getBoundingClientRect().width ?? 0,
  }));
  expect(detailLayout.scrollWidth).toBeLessThanOrEqual(detailLayout.innerWidth);
  expect(detailLayout.actionsWidth).toBeLessThanOrEqual(detailLayout.innerWidth);
});

test('a direct admin hash stays on the public home screen', async ({ page }) => {
  await installMaxLaunch(
    page,
    'query_id=home-e2e&auth_date=1784332800&start_param=home&hash=server-validated',
  );
  await page.goto('/#admin', { waitUntil: 'domcontentloaded' });

  await expect(
    page.getByRole('heading', { name: /Расскажите о проекте|Перед началом/ }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Вход в КРАФТ Control' })).toHaveCount(0);
});
