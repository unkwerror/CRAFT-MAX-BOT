import { expect, test, type Browser, type Page } from '@playwright/test';

const viewports = [
  { height: 568, name: 'compact-320', width: 320 },
  { height: 844, name: 'mobile-390', width: 390 },
  { height: 932, name: 'mobile-430', width: 430 },
] as const;

const colorSchemes = ['light', 'dark'] as const;

async function openHome(page: Page): Promise<void> {
  await page.route('https://st.max.ru/**', (route) => route.abort());
  await page.goto('http://127.0.0.1:4173/');
  await expect(page.getByRole('heading', { name: /Расскажите о проекте/ })).toBeVisible();
}

async function measureLayout(page: Page, viewportWidth: number) {
  const primary = page.getByRole('button', { name: 'Заполнить анкету' });
  const secondary = page.getByRole('button', { exact: true, name: 'Смотреть проекты' });
  const [primaryBox, secondaryBox] = await Promise.all([
    primary.boundingBox(),
    secondary.boundingBox(),
  ]);

  expect(primaryBox).not.toBeNull();
  expect(secondaryBox).not.toBeNull();
  if (primaryBox === null || secondaryBox === null) {
    return null;
  }

  expect(primaryBox.x).toBeGreaterThanOrEqual(0);
  expect(primaryBox.x + primaryBox.width).toBeLessThanOrEqual(viewportWidth);
  expect(primaryBox.height).toBeGreaterThanOrEqual(52);
  expect(secondaryBox.x).toBeCloseTo(primaryBox.x, 0);
  expect(secondaryBox.width).toBeCloseTo(primaryBox.width, 0);
  expect(secondaryBox.y).toBeGreaterThanOrEqual(primaryBox.y + primaryBox.height);

  const layoutState = await page.evaluate(() => {
    const navigation = document.querySelector('.bottom-nav');
    const screenShell = document.querySelector('.screen-shell');
    const secondaryAction = [...document.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Смотреть проекты',
    );
    const intersects =
      navigation instanceof HTMLElement && secondaryAction instanceof HTMLElement
        ? (() => {
            const nav = navigation.getBoundingClientRect();
            const action = secondaryAction.getBoundingClientRect();
            return (
              action.left < nav.right &&
              action.right > nav.left &&
              action.top < nav.bottom &&
              action.bottom > nav.top
            );
          })()
        : false;

    return {
      animationDuration:
        screenShell instanceof HTMLElement ? getComputedStyle(screenShell).animationDuration : '',
      animationName:
        screenShell instanceof HTMLElement ? getComputedStyle(screenShell).animationName : '',
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      dataTheme: document.documentElement.dataset.theme ?? '',
      intersects,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });

  return layoutState;
}

function isDarkRgb(background: string): boolean {
  const match = background.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (match === null) return false;
  const r = Number(match[1]);
  const g = Number(match[2]);
  const b = Number(match[3]);
  // Perceived luminance — dark theme surfaces stay well under mid-gray
  return (r * 299 + g * 587 + b * 114) / 1000 < 80;
}

async function runViewportMatrix(
  browser: Browser,
  colorScheme: (typeof colorSchemes)[number],
): Promise<void> {
  for (const viewport of viewports) {
    const context = await browser.newContext({ colorScheme, viewport });
    const page = await context.newPage();
    await openHome(page);

    const label = `${colorScheme}/${viewport.name}`;
    const layoutState = await measureLayout(page, viewport.width);
    expect(layoutState, label).not.toBeNull();
    if (layoutState === null) {
      await context.close();
      continue;
    }

    expect(layoutState.scrollWidth, label).toBeLessThanOrEqual(viewport.width);
    expect(layoutState.intersects, label).toBe(false);
    expect(layoutState.dataTheme, label).toBe(colorScheme);
    expect(layoutState.animationName, label).toBe('screen-enter');
    expect(Number.parseFloat(layoutState.animationDuration), label).toBeGreaterThan(0.18);

    if (colorScheme === 'dark') {
      expect(isDarkRgb(layoutState.bodyBackground), `${label} body bg ${layoutState.bodyBackground}`).toBe(
        true,
      );
    }

    if (viewport.name === 'mobile-390') {
      const routeScroll = await page.evaluate(() => {
        document.documentElement.scrollTop = 900;
        document.body.scrollTop = 900;
        const before = scrollY;
        const finder = [...document.querySelectorAll('button')].find((button) =>
          button.textContent?.includes('Подобрать услугу'),
        );
        if (finder instanceof HTMLButtonElement) finder.click();
        return { after: scrollY, before };
      });
      expect(routeScroll.before, label).toBeGreaterThan(500);
      expect(routeScroll.after, label).toBe(0);
      await expect(page.getByRole('heading', { name: 'Подобрать услугу' })).toBeVisible();
    }

    // Reduced motion is required on light; still assert on dark for stability
    if (colorScheme === 'light' || viewport.name === 'mobile-390') {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const reducedDuration = await page
        .locator('.screen-shell')
        .evaluate((element) => Number.parseFloat(getComputedStyle(element).animationDuration));
      expect(reducedDuration, label).toBeLessThan(0.02);
    }

    await context.close();
  }
}

test('mobile CTA geometry and motion remain stable (light + dark)', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Run the viewport matrix once.');

  for (const colorScheme of colorSchemes) {
    await runViewportMatrix(browser, colorScheme);
  }
});
