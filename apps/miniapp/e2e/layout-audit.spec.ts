import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const viewports = [
  { height: 568, name: 'compact-320', width: 320 },
  { height: 844, name: 'mobile-390', width: 390 },
  { height: 932, name: 'mobile-430', width: 430 },
  { height: 900, name: 'desktop-1280', width: 1280 },
] as const;

const colorSchemes = ['light', 'dark'] as const;

const routes = [
  { heading: /Расскажите о проекте/, name: 'home' },
  { heading: 'Подобрать услугу', name: 'finder' },
  { heading: 'Новый проект', name: 'brief' },
  { heading: 'Проекты КРАФТ', name: 'cases' },
  { heading: 'Загрузка файлов', name: 'upload' },
  { heading: 'Прозрачная работа с данными', name: 'privacy' },
] as const;

type ColorScheme = (typeof colorSchemes)[number];
type Viewport = (typeof viewports)[number];

interface MaxMockState {
  readonly browserOpenUrls: string[];
  closeCalls: number;
  readonly externalLinks: string[];
  readonly maxLinks: string[];
}

async function installMaxMock(
  context: BrowserContext,
  colorScheme: ColorScheme,
  viewport: Viewport,
): Promise<void> {
  await context.addInitScript(
    ({ height, scheme, width }) => {
      const state: MaxMockState = {
        browserOpenUrls: [],
        closeCalls: 0,
        externalLinks: [],
        maxLinks: [],
      };
      const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
      const backListeners = new Set<() => void>();

      Object.defineProperty(window, '__maxE2e', {
        configurable: true,
        value: state,
      });
      Object.defineProperty(window, 'WebApp', {
        configurable: true,
        value: {
          BackButton: {
            isVisible: false,
            hide: () => undefined,
            offClick: (callback: () => void) => backListeners.delete(callback),
            onClick: (callback: () => void) => backListeners.add(callback),
            show: () => undefined,
          },
          close: () => {
            state.closeCalls += 1;
          },
          colorScheme: scheme,
          disableClosingConfirmation: () => undefined,
          enableClosingConfirmation: () => undefined,
          getViewportSize: async () => ({ height: String(height), width: String(width) }),
          initData: '',
          initDataUnsafe: {},
          offEvent: (eventType: string, callback: (...args: unknown[]) => void) => {
            listeners.get(eventType)?.delete(callback);
          },
          onEvent: (eventType: string, callback: (...args: unknown[]) => void) => {
            const callbacks = listeners.get(eventType) ?? new Set();
            callbacks.add(callback);
            listeners.set(eventType, callbacks);
          },
          openLink: (url: string) => state.externalLinks.push(url),
          openMaxLink: (url: string) => state.maxLinks.push(url),
          platform: 'android',
          requestContact: async () => Promise.reject(new Error('Contact is unavailable in E2E')),
          version: '26.20.0-e2e',
        },
      });

      // A phone-first implementation must be observable without opening a real popup.
      Object.defineProperty(window, 'open', {
        configurable: true,
        value: (url?: string | URL) => {
          state.browserOpenUrls.push(String(url ?? ''));
          return {};
        },
      });

      try {
        window.localStorage.clear();
      } catch {
        // Storage can be unavailable on the initial about:blank document.
      }
    },
    { height: viewport.height, scheme: colorScheme, width: viewport.width },
  );
}

async function createAuditedPage(
  browser: Browser,
  colorScheme: ColorScheme,
  viewport: Viewport,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    colorScheme,
    reducedMotion: 'reduce',
    viewport,
  });
  await installMaxMock(context, colorScheme, viewport);
  const page = await context.newPage();
  await page.route('https://st.max.ru/**', (route) => route.abort());
  return { context, page };
}

async function openRoute(page: Page, route: (typeof routes)[number]): Promise<void> {
  const suffix = route.name === 'home' ? '/' : `/#${route.name}`;
  await page.goto(suffix, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: route.heading }).first()).toBeVisible();
  await waitForLayout(page);
}

async function waitForLayout(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

function perceivedLuminance(background: string): number | null {
  const match = background.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (match === null) return null;
  const red = Number(match[1]);
  const green = Number(match[2]);
  const blue = Number(match[3]);
  return (red * 299 + green * 587 + blue * 114) / 1000;
}

async function expectThemeAndReducedMotion(
  page: Page,
  colorScheme: ColorScheme,
  label: string,
): Promise<void> {
  const state = await page.evaluate(() => {
    const seconds = (value: string): number =>
      Math.max(
        ...value.split(',').map((item) => {
          const normalized = item.trim();
          if (normalized.endsWith('ms')) return Number.parseFloat(normalized) / 1_000;
          if (normalized.endsWith('s')) return Number.parseFloat(normalized);
          return 0;
        }),
      );
    const visible = (element: HTMLElement): boolean => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number.parseFloat(style.opacity || '1') > 0 &&
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.top < innerHeight
      );
    };
    const motionOffenders = [...document.querySelectorAll<HTMLElement>('body *')]
      .filter(visible)
      .map((element) => {
        const style = getComputedStyle(element);
        return {
          animation: seconds(style.animationDuration),
          className: element.className,
          tagName: element.tagName,
          transition: seconds(style.transitionDuration),
        };
      })
      .filter((item) => item.animation > 0.02 || item.transition > 0.02)
      .slice(0, 12);

    return {
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      dataTheme: document.documentElement.dataset.theme ?? '',
      motionOffenders,
      scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
    };
  });

  expect(state.dataTheme, label).toBe(colorScheme);
  expect(state.scrollBehavior, label).toBe('auto');
  expect(state.motionOffenders, `${label}: ${JSON.stringify(state.motionOffenders)}`).toEqual([]);

  const luminance = perceivedLuminance(state.bodyBackground);
  expect(luminance, `${label}: ${state.bodyBackground}`).not.toBeNull();
  if (luminance !== null) {
    if (colorScheme === 'dark') expect(luminance, label).toBeLessThan(90);
    else expect(luminance, label).toBeGreaterThan(150);
  }
}

async function auditScrollPosition(page: Page, label: string, atEnd: boolean): Promise<void> {
  const audit = await page.evaluate(
    ({ checkEndCtas }) => {
      const visible = (element: HTMLElement): boolean => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number.parseFloat(style.opacity || '1') > 0 &&
          rect.width > 0 &&
          rect.height > 0 &&
          rect.right > 0 &&
          rect.left < innerWidth &&
          rect.bottom > 0 &&
          rect.top < innerHeight
        );
      };
      const describe = (element: HTMLElement): string => {
        const text = element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '';
        const classes = typeof element.className === 'string' ? element.className : '';
        return `${element.tagName.toLowerCase()}.${classes.replaceAll(/\s+/g, '.')} ${text.slice(0, 60)}`;
      };
      const intersectionArea = (first: DOMRect, second: DOMRect): number => {
        const width = Math.max(
          0,
          Math.min(first.right, second.right) - Math.max(first.left, second.left),
        );
        const height = Math.max(
          0,
          Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top),
        );
        return width * height;
      };

      const overflowOffenders = [...document.querySelectorAll<HTMLElement>('body *')]
        .filter(visible)
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left < -1 || rect.right > innerWidth + 1;
        })
        .map(describe)
        .slice(0, 12);

      const touchSelector = [
        'button',
        'input:not([type="hidden"])',
        'select',
        'textarea',
        '[role="button"]',
        'a.bottom-nav__item',
        '.dropzone[tabindex="0"]',
      ].join(',');
      const touchNodes = new Set<HTMLElement>();
      for (const element of document.querySelectorAll<HTMLElement>(touchSelector)) {
        const input = element instanceof HTMLInputElement ? element : null;
        // MAX UI inputs render a compact native control inside a full-size clickable label.
        const label = input?.closest('label') ?? null;
        touchNodes.add(label instanceof HTMLElement ? label : element);
      }
      const undersizedTargets = [...touchNodes]
        .filter(visible)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            height: Math.round(rect.height * 10) / 10,
            key: describe(element),
            width: Math.round(rect.width * 10) / 10,
          };
        })
        .filter((item) => item.height < 43.5 || item.width < 43.5)
        .slice(0, 12);

      const overlaySelector = '.bottom-nav, .sticky-actions, .toast';
      const overlays = [...document.querySelectorAll<HTMLElement>(overlaySelector)].filter(
        (element) => {
          if (!visible(element)) return false;
          const position = getComputedStyle(element).position;
          return position === 'fixed' || position === 'sticky';
        },
      );
      const persistentCtaSelector = '.sticky-actions button:not([disabled])';
      const endCtaSelector = [
        '.hero__actions button:not([disabled])',
        '.action-card:not([disabled])',
        '.home-support:not([disabled])',
        '.trust-panel button:not([disabled])',
        '.case-card__actions button:not([disabled])',
        '.case-card__cta:not([disabled])',
        '.filter-panel__toggle:not([disabled])',
        '.dropzone[tabindex="0"]',
        '.consent-start__continue:not([disabled])',
      ].join(',');
      const ctaSelector = checkEndCtas
        ? `${persistentCtaSelector},${endCtaSelector}`
        : persistentCtaSelector;
      const overlapOffenders: string[] = [];
      for (const cta of document.querySelectorAll<HTMLElement>(ctaSelector)) {
        if (!visible(cta)) continue;
        const ctaRect = cta.getBoundingClientRect();
        const fullyInsideViewport =
          ctaRect.top >= -1 &&
          ctaRect.left >= -1 &&
          ctaRect.right <= innerWidth + 1 &&
          ctaRect.bottom <= innerHeight + 1;
        if (!fullyInsideViewport) continue;

        for (const overlay of overlays) {
          if (overlay.contains(cta) || cta.contains(overlay)) continue;
          const coveredArea = intersectionArea(ctaRect, overlay.getBoundingClientRect());
          if (coveredArea > 1) {
            overlapOffenders.push(
              `${describe(cta)} <> ${describe(overlay)} (${String(Math.round(coveredArea))}px²)`,
            );
          }
        }
      }

      return {
        clientWidth: document.documentElement.clientWidth,
        overflowOffenders,
        overlapOffenders: overlapOffenders.slice(0, 12),
        scrollWidth: document.documentElement.scrollWidth,
        undersizedTargets,
      };
    },
    { checkEndCtas: atEnd },
  );

  expect(audit.scrollWidth, label).toBeLessThanOrEqual(audit.clientWidth + 1);
  expect(
    audit.overflowOffenders,
    `${label}: horizontal overflow ${JSON.stringify(audit.overflowOffenders)}`,
  ).toEqual([]);
  expect(
    audit.undersizedTargets,
    `${label}: touch targets ${JSON.stringify(audit.undersizedTargets)}`,
  ).toEqual([]);
  expect(
    audit.overlapOffenders,
    `${label}: fixed/sticky overlap ${JSON.stringify(audit.overlapOffenders)}`,
  ).toEqual([]);
}

async function scrollAndAudit(page: Page, label: string): Promise<void> {
  await page.evaluate(() => scrollTo(0, 0));
  await waitForLayout(page);
  expect(await page.evaluate(() => scrollY), `${label}: starts at top`).toBe(0);

  const initial = await page.evaluate(() => ({
    innerHeight,
    maxScrollY: Math.max(0, document.documentElement.scrollHeight - innerHeight),
  }));
  const step = Math.max(160, Math.floor(initial.innerHeight * 0.72));
  const positions = new Set<number>([0, initial.maxScrollY]);
  for (let position = step; position < initial.maxScrollY; position += step) {
    positions.add(position);
  }
  const orderedPositions = [...positions].sort((left, right) => left - right);

  for (const intendedPosition of orderedPositions) {
    await page.evaluate((position) => scrollTo(0, position), intendedPosition);
    await waitForLayout(page);
    const current = await page.evaluate(() => ({
      maxScrollY: Math.max(0, document.documentElement.scrollHeight - innerHeight),
      scrollY,
    }));
    const atEnd = Math.abs(current.maxScrollY - current.scrollY) <= 2;
    await auditScrollPosition(
      page,
      `${label}/scroll-${String(Math.round(current.scrollY))}`,
      atEnd,
    );
  }

  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await waitForLayout(page);
  const final = await page.evaluate(() => ({
    maxScrollY: Math.max(0, document.documentElement.scrollHeight - innerHeight),
    scrollY,
  }));
  await auditScrollPosition(page, `${label}/scroll-end`, true);
  expect(
    Math.abs(final.maxScrollY - final.scrollY),
    `${label}: reaches document end`,
  ).toBeLessThanOrEqual(2);
}

test('all primary screens remain usable across viewport, theme and reduced-motion matrix', async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Run the cross-viewport matrix once.');
  test.setTimeout(300_000);

  for (const colorScheme of colorSchemes) {
    for (const viewport of viewports) {
      const { context, page } = await createAuditedPage(browser, colorScheme, viewport);
      try {
        for (const route of routes) {
          const label = `${colorScheme}/${viewport.name}/${route.name}`;
          await openRoute(page, route);
          await expectThemeAndReducedMotion(page, colorScheme, label);
          await scrollAndAudit(page, label);
        }
      } finally {
        await context.close();
      }
    }
  }
});

test('manager CTA sends a profile deep-link to MAX Bridge before any phone fallback', async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop',
    'The injected Bridge contract is viewport agnostic.',
  );

  const viewport = viewports[1];
  const { context, page } = await createAuditedPage(browser, 'light', viewport);
  try {
    await openRoute(page, routes[0]);
    await page
      .getByRole('button', { name: /(?:Связаться|Написать).*менеджер/i })
      .first()
      .click();

    const state = await page.evaluate(
      () => (window as unknown as { readonly __maxE2e: MaxMockState }).__maxE2e,
    );
    expect(state.browserOpenUrls.filter((url) => url.startsWith('tel:'))).toEqual([]);
    expect(state.maxLinks).toHaveLength(1);

    const managerLink = state.maxLinks[0] ?? '';
    const isConfiguredProfile = /^https:\/\/max\.ru\/u\/[^/?#\s]+$/.test(managerLink);
    const isNativeFallback = managerLink === 'max://user/61096226';
    expect(isConfiguredProfile || isNativeFallback, managerLink).toBe(true);
    expect(managerLink).not.toMatch(/_bot(?:[/?#]|$)/i);
  } finally {
    await context.close();
  }
});
