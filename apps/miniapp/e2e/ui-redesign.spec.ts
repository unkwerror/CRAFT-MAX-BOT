import { expect, test } from '@playwright/test';

const viewports = [
  { height: 568, name: 'compact-320', width: 320 },
  { height: 844, name: 'mobile-390', width: 390 },
  { height: 932, name: 'mobile-430', width: 430 },
] as const;

test('mobile CTA geometry and motion remain stable', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Run the viewport matrix once.');

  for (const viewport of viewports) {
    const context = await browser.newContext({ colorScheme: 'light', viewport });
    const page = await context.newPage();
    await page.route('https://st.max.ru/**', (route) => route.abort());
    await page.goto('http://127.0.0.1:4173/');
    await expect(page.getByRole('heading', { name: /Проект начинается/ })).toBeVisible();

    const primary = page.getByRole('button', { name: 'Начать бриф' });
    const secondary = page.getByRole('button', { exact: true, name: 'Смотреть проекты' });
    const [primaryBox, secondaryBox] = await Promise.all([
      primary.boundingBox(),
      secondary.boundingBox(),
    ]);

    expect(primaryBox, viewport.name).not.toBeNull();
    expect(secondaryBox, viewport.name).not.toBeNull();
    if (primaryBox === null || secondaryBox === null) continue;

    expect(primaryBox.x, viewport.name).toBeGreaterThanOrEqual(0);
    expect(primaryBox.x + primaryBox.width, viewport.name).toBeLessThanOrEqual(viewport.width);
    expect(primaryBox.height, viewport.name).toBeGreaterThanOrEqual(52);
    expect(secondaryBox.x, viewport.name).toBeCloseTo(primaryBox.x, 0);
    expect(secondaryBox.width, viewport.name).toBeCloseTo(primaryBox.width, 0);
    expect(secondaryBox.y, viewport.name).toBeGreaterThanOrEqual(primaryBox.y + primaryBox.height);

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
        intersects,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });

    expect(layoutState.scrollWidth, viewport.name).toBeLessThanOrEqual(viewport.width);
    expect(layoutState.intersects, viewport.name).toBe(false);
    expect(layoutState.animationName, viewport.name).toBe('screen-enter');
    expect(Number.parseFloat(layoutState.animationDuration), viewport.name).toBeGreaterThan(0.18);

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
      expect(routeScroll.before).toBeGreaterThan(500);
      expect(routeScroll.after).toBe(0);
      await expect(page.getByRole('heading', { name: 'Подобрать услугу' })).toBeVisible();
    }

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reducedDuration = await page
      .locator('.screen-shell')
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).animationDuration));
    expect(reducedDuration, viewport.name).toBeLessThan(0.02);

    await context.close();
  }
});
