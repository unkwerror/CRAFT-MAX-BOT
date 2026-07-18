import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  AdminContentDocument,
  AdminSubmissionListItem,
  AdminUserListItem,
  LeadFormData,
} from '@craft72/contracts/source';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminPanel } from './AdminPanel.js';
import { adminApi } from './admin-api.js';

const NOW = '2026-07-18T08:00:00.000Z';

const INTAKE: LeadFormData = {
  role: 'property_owner',
  fullName: 'Клиент КРАФТ',
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
  description: 'Тестовая заявка для проверки загрузки всех страниц.',
  links: [],
  documentIds: [],
  selectedCaseIds: [],
  contact: { phone: '+79990000000', email: 'client@example.com' },
  consent: { version: '2026-07-18', accepted: true },
};

const makeUser = (index: number): AdminUserListItem => {
  const maxUserId = String(10_000 + index);
  return {
    maxUserId,
    displayName: `Пользователь ${index}`,
    identitySource: 'miniapp',
    user: {
      id: maxUserId,
      firstName: `Имя ${index}`,
      lastName: null,
      username: null,
      languageCode: 'ru',
    },
    createdAt: NOW,
    updatedAt: NOW,
    submissionCount: 1,
    lastSubmissionAt: NOW,
    hasActiveDraft: false,
    botDialogCount: 0,
    lastBotEventAt: null,
  };
};

const makeSubmission = (index: number): AdminSubmissionListItem => ({
  submissionId: `CRAFT72-${String(index).padStart(6, '0')}`,
  maxUserId: String(10_000 + index),
  user: {
    id: String(10_000 + index),
    firstName: `Имя ${index}`,
    lastName: null,
    username: null,
    languageCode: 'ru',
  },
  intake: { ...INTAKE, fullName: `Клиент ${index}` },
  phoneVerified: true,
  integrationStatus: 'received',
  reviewStatus: 'new',
  adminNote: null,
  submittedAt: NOW,
  updatedAt: NOW,
});

const BOT_WELCOME: AdminContentDocument = {
  key: 'bot-welcome',
  kind: 'bot',
  draft: { text: 'Старое приветствие' },
  published: { text: 'Старое приветствие' },
  version: 4,
  publishedVersion: 4,
  publishedAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
};

const mockAuthenticatedAdminData = (content: readonly AdminContentDocument[] = []): void => {
  vi.spyOn(adminApi, 'getSession').mockResolvedValue({
    authenticated: true,
    user: {
      id: '61096226',
      firstName: 'Администратор',
      lastName: null,
      username: null,
      languageCode: 'ru',
      photoUrl: null,
    },
    expiresAt: '2026-07-18T16:00:00.000Z',
  });
  vi.spyOn(adminApi, 'listUsers').mockResolvedValue({ items: [], nextCursor: null });
  vi.spyOn(adminApi, 'listSubmissions').mockResolvedValue({ items: [], nextCursor: null });
  vi.spyOn(adminApi, 'listCases').mockResolvedValue([]);
  vi.spyOn(adminApi, 'listContent').mockResolvedValue(content);
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AdminPanel cursor pagination', () => {
  it('loads and displays users and submissions beyond the first 100 records', async () => {
    const users = Array.from({ length: 101 }, (_, index) => makeUser(index + 1));
    const submissions = Array.from({ length: 102 }, (_, index) => makeSubmission(index + 1));

    vi.spyOn(adminApi, 'getSession').mockResolvedValue({
      authenticated: true,
      user: {
        id: '61096226',
        firstName: 'Администратор',
        lastName: null,
        username: null,
        languageCode: 'ru',
        photoUrl: null,
      },
      expiresAt: '2026-07-18T16:00:00.000Z',
    });
    const listUsers = vi
      .spyOn(adminApi, 'listUsers')
      .mockImplementation(async (cursor) =>
        cursor === undefined
          ? { items: users.slice(0, 100), nextCursor: 'users-page-2' }
          : { items: users.slice(100), nextCursor: null },
      );
    const listSubmissions = vi
      .spyOn(adminApi, 'listSubmissions')
      .mockImplementation(async ({ cursor } = {}) =>
        cursor === undefined
          ? { items: submissions.slice(0, 100), nextCursor: 'submissions-page-2' }
          : { items: submissions.slice(100), nextCursor: null },
      );
    vi.spyOn(adminApi, 'listCases').mockResolvedValue([]);
    vi.spyOn(adminApi, 'listContent').mockResolvedValue([]);

    render(<AdminPanel initData="signed-init-data" onExit={vi.fn()} />);

    const metrics = await screen.findByRole('region', { name: 'Ключевые показатели' });
    await waitFor(() => {
      const usersMetric = within(metrics).getByText('Пользователи').closest('button');
      const submissionsMetric = within(metrics).getByText('Все заявки').closest('button');
      expect(usersMetric?.textContent).toContain('101');
      expect(submissionsMetric?.textContent).toContain('102');
      expect(listUsers).toHaveBeenNthCalledWith(1, undefined);
      expect(listUsers).toHaveBeenNthCalledWith(2, 'users-page-2');
      expect(listSubmissions).toHaveBeenNthCalledWith(1, {});
      expect(listSubmissions).toHaveBeenNthCalledWith(2, { cursor: 'submissions-page-2' });
    });
  });
});

describe('AdminPanel content management', () => {
  it('updates, publishes, and deletes an existing bot welcome document', async () => {
    const user = userEvent.setup();
    const editedDraft = { text: 'Новое приветствие из админки' };
    const updatedDocument: AdminContentDocument = {
      ...BOT_WELCOME,
      draft: editedDraft,
      version: 5,
      updatedAt: '2026-07-18T08:05:00.000Z',
    };
    const publishedDocument: AdminContentDocument = {
      ...updatedDocument,
      published: editedDraft,
      publishedVersion: 5,
      publishedAt: '2026-07-18T08:06:00.000Z',
      updatedAt: '2026-07-18T08:06:00.000Z',
    };

    mockAuthenticatedAdminData([BOT_WELCOME]);
    const updateContent = vi.spyOn(adminApi, 'updateContent').mockResolvedValue(updatedDocument);
    const publishContent = vi
      .spyOn(adminApi, 'publishContent')
      .mockResolvedValue(publishedDocument);
    const deleteContent = vi.spyOn(adminApi, 'deleteContent').mockResolvedValue();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<AdminPanel initData="signed-init-data" onExit={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Контент' }));
    await user.click(await screen.findByRole('button', { name: /bot-welcome/ }));

    const jsonEditor = screen.getByLabelText('JSON-содержимое');
    fireEvent.change(jsonEditor, { target: { value: JSON.stringify(editedDraft, null, 2) } });
    await user.click(screen.getByRole('button', { name: 'Сохранить черновик' }));

    await waitFor(() => {
      expect(updateContent).toHaveBeenCalledWith('bot-welcome', {
        expectedVersion: 4,
        draft: editedDraft,
      });
    });

    const genericEditor = screen
      .getByRole('heading', { name: 'bot-welcome' })
      .closest<HTMLElement>('section');
    expect(genericEditor).not.toBeNull();
    await user.click(
      within(genericEditor as HTMLElement).getByRole('button', { name: 'Опубликовать' }),
    );

    await waitFor(() => {
      expect(publishContent).toHaveBeenCalledWith('bot-welcome', 5);
    });

    await user.click(within(genericEditor as HTMLElement).getByRole('button', { name: 'Удалить' }));

    await waitFor(() => {
      expect(confirm).toHaveBeenCalledWith('Удалить документ «bot-welcome»?');
      expect(deleteContent).toHaveBeenCalledWith('bot-welcome', 5);
    });
    expect(screen.queryByRole('button', { name: /bot-welcome/ })).toBeNull();
  });
});
