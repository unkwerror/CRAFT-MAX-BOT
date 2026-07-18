import { expect, test, type Page } from '@playwright/test';

async function openApp(page: Page): Promise<void> {
  await page.route('https://st.max.ru/**', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Расскажите о проекте/ })).toBeVisible();
}

async function continueBrief(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const measurement = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    offenders: [...document.querySelectorAll<HTMLElement>('body *')]
      .map((element) => ({
        className: element.className,
        right: Math.round(element.getBoundingClientRect().right),
        tagName: element.tagName,
      }))
      .filter((item) => item.right > window.innerWidth + 1)
      .slice(0, 8),
    scrollWidth: document.documentElement.scrollWidth,
  }));

  expect(measurement.offenders, JSON.stringify(measurement)).toEqual([]);
  expect(measurement.scrollWidth).toBeLessThanOrEqual(measurement.innerWidth);
}

test('home and service finder stay inside the viewport', async ({ page }) => {
  await openApp(page);

  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: /Подобрать услугу/ }).click();
  await expect(page.getByRole('heading', { name: 'Подобрать услугу' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('an unfinished raw step survives refresh', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Заполнить анкету' }).click();
  await page.getByRole('button', { name: /Девелопер/ }).click();
  await continueBrief(page);

  await page.getByLabel('Имя и фамилия').fill('Анна');
  await page.getByLabel('Организация или ИП').fill('Крафт Заказчик');
  await page.waitForTimeout(250);
  await page.reload();

  await expect(page.getByLabel('Имя и фамилия')).toHaveValue('Анна');
  await expect(page.getByLabel('Организация или ИП')).toHaveValue('Крафт Заказчик');
  await expect(page.getByText('Шаг 2 из 17', { exact: true })).toBeVisible();
});

test('mock upload metadata survives refresh', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: /Отправить материалы/ }).click();
  await page.getByLabel('Выбрать файлы').setInputFiles({
    buffer: Buffer.from('%PDF-1.7 mock brief'),
    mimeType: 'application/pdf',
    name: 'brief.pdf',
  });

  await expect(page.getByText('Загружен и проверен')).toBeVisible();
  await page.waitForTimeout(250);
  await page.reload();
  await expect(page.getByText('brief.pdf')).toBeVisible();
  await expect(page.getByText('Загружен и проверен')).toBeVisible();
});

test('a complete mock brief produces one stable submission', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Заполнить анкету' }).click();

  await page.getByRole('button', { name: /Девелопер/ }).click();
  await continueBrief(page);

  await page.getByLabel('Имя и фамилия').fill('Анна Иванова');
  await page.getByLabel('Организация или ИП').fill('ООО Проект');
  await continueBrief(page);

  await continueBrief(page);

  await page.getByRole('button', { name: 'Жилой комплекс' }).click();
  await continueBrief(page);

  await page.getByLabel('Город').fill('Тюмень');
  await continueBrief(page);

  await page.getByRole('button', { name: 'Один объект' }).click();
  await continueBrief(page);

  await page.getByRole('button', { name: 'Пока не знаю' }).click();
  await continueBrief(page);

  await page.getByRole('button', { name: 'Идея или предпроект' }).click();
  await continueBrief(page);

  await page.getByRole('button', { name: 'Архитектурная концепция' }).click();
  await continueBrief(page);

  const expertiseGroup = page.getByRole('group', { name: 'Потребуется экспертиза?' });
  await expertiseGroup.getByRole('button', { name: 'Пока не знаю' }).click();
  const heritageGroup = page.getByRole('group', {
    name: 'Объект относится к культурному наследию?',
  });
  await heritageGroup.getByRole('button', { name: 'Нет' }).click();
  await continueBrief(page);

  await page.getByRole('button', { name: 'Пока не знаю' }).click();
  await continueBrief(page);

  await page.getByLabel('Описание задачи').fill('Нужна архитектурная концепция жилого комплекса.');
  await continueBrief(page);

  await continueBrief(page);

  await page.getByRole('button', { name: 'Передать контакт из MAX' }).click();
  await expect(page.getByText(/MAX не передал контакт/)).toBeVisible();
  await page.getByRole('textbox', { name: /Телефон/ }).fill('+79990000000');
  await continueBrief(page);

  await page.getByLabel('Email').fill('project@example.ru');
  await continueBrief(page);

  await page.getByRole('checkbox', { name: /обработку данных заявки/ }).check();
  await continueBrief(page);

  await page.getByRole('button', { name: 'К проверке' }).click();
  await expect(page.getByRole('heading', { name: 'Резюме заявки' })).toBeVisible();

  const roleSection = page.locator('.summary-card').filter({ hasText: 'Роль' });
  await roleSection.getByRole('button', { name: 'Изменить' }).click();
  await page.getByRole('button', { name: /Инвестор/ }).click();
  await continueBrief(page);
  await expect(page.getByRole('heading', { name: 'Резюме заявки' })).toBeVisible();
  await expect(page.getByText('Инвестор', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Отправить заявку' }).click();

  await expect(page.getByRole('heading', { name: 'Заявка принята' })).toBeVisible();
  const submissionId = page.locator('.submission-id strong');
  await expect(submissionId).toHaveText(/^CRAFT72-MOCK-[A-Z0-9]+$/);
  await expect(page.getByText('Подходящие проекты')).toBeVisible();
});
