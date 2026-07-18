import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  AdminCase,
  AdminCaseCreateRequest,
  AdminContentDocument,
  AdminJsonValue,
  AdminSessionResponse,
  AdminSubmissionListItem,
  AdminUserListItem,
  SubmissionReviewStatus,
} from '@craft72/contracts/source';

import { Icon, type IconName } from '../components/Icon.js';
import { adminApi, AdminApiError } from './admin-api.js';
import { QuestionnaireEditor } from './QuestionnaireEditor.js';
import {
  normalizeQuestionnaireContent,
  questionnaireContentAsJson,
  type QuestionnaireContent,
} from './questionnaire-content.js';

type AdminTab = 'overview' | 'submissions' | 'users' | 'cases' | 'content';
type AuthState = 'checking' | 'ready' | 'outside-max' | 'forbidden' | 'error';

const ADMIN_TABS: readonly { icon: IconName; label: string; value: AdminTab }[] = [
  { icon: 'spark', label: 'Обзор', value: 'overview' },
  { icon: 'brief', label: 'Заявки', value: 'submissions' },
  { icon: 'projects', label: 'Пользователи', value: 'users' },
  { icon: 'building', label: 'Объекты', value: 'cases' },
  { icon: 'file', label: 'Контент', value: 'content' },
];

const REVIEW_STATUSES: readonly { label: string; value: SubmissionReviewStatus }[] = [
  { label: 'Новая', value: 'new' },
  { label: 'В работе', value: 'in_review' },
  { label: 'Связались', value: 'contacted' },
  { label: 'Квалифицирована', value: 'qualified' },
  { label: 'Завершена', value: 'closed' },
  { label: 'Отклонена', value: 'rejected' },
];

const reviewLabel = (status: SubmissionReviewStatus): string =>
  REVIEW_STATUSES.find((item) => item.value === status)?.label ?? status;

const formatDate = (value: string, withTime = true): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date);
};

const displayName = (user: {
  readonly firstName: string;
  readonly lastName: string | null;
}): string => [user.firstName, user.lastName].filter(Boolean).join(' ');

const errorMessage = (error: unknown): string => {
  if (!(error instanceof AdminApiError)) return 'Не удалось выполнить действие. Повторите позже.';
  if (error.status === 409) return 'Данные уже изменились. Обновите список и повторите.';
  if (error.status === 401) return 'Админ-сессия завершилась. Откройте панель заново из MAX.';
  if (error.status === 403) return 'У этого MAX-аккаунта нет доступа к админ-панели.';
  if (error.code === 'VALIDATION_ERROR') return 'Проверьте заполненные поля и формат значений.';
  if (error.status === 0) return 'Нет соединения с сервером. Проверьте интернет.';
  return 'Сервер не смог выполнить действие. Попробуйте ещё раз.';
};

interface CursorPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

const loadAllCursorPages = async <T,>(
  loadPage: (cursor?: string) => Promise<CursorPage<T>>,
  keyOf: (item: T) => string,
): Promise<readonly T[]> => {
  const items = new Map<string, T>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  while (true) {
    const page = await loadPage(cursor);
    for (const item of page.items) items.set(keyOf(item), item);
    if (page.nextCursor === null) return [...items.values()];
    if (seenCursors.has(page.nextCursor)) throw new AdminApiError(502, 'INVALID_RESPONSE');
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
};

const includesSearch = (values: readonly (null | string)[], search: string): boolean => {
  const query = search.trim().toLocaleLowerCase('ru-RU');
  return query === '' || values.some((value) => value?.toLocaleLowerCase('ru-RU').includes(query));
};

const StatusBadge = ({ status }: { readonly status: SubmissionReviewStatus }) => (
  <span className={`admin-status admin-status--${status}`}>{reviewLabel(status)}</span>
);

const EmptyAdminState = ({
  children,
  title,
}: {
  readonly children: ReactNode;
  readonly title: string;
}) => (
  <div className="admin-empty">
    <span>
      <Icon name="search" size={24} />
    </span>
    <h3>{title}</h3>
    <p>{children}</p>
  </div>
);

interface AdminPanelProps {
  readonly initData: string | null;
  readonly onExit: () => void;
}

interface CaseFormState {
  readonly area: string;
  readonly categories: string;
  readonly city: string;
  readonly constructionKind: string;
  readonly id: string;
  readonly image: string;
  readonly published: boolean;
  readonly region: string;
  readonly scale: string;
  readonly services: string;
  readonly sortOrder: string;
  readonly status: string;
  readonly tags: string;
  readonly title: string;
  readonly url: string;
}

const EMPTY_CASE: CaseFormState = {
  area: '',
  categories: 'public-building',
  city: '',
  constructionKind: 'new-construction',
  id: '',
  image: '',
  published: false,
  region: '',
  scale: 'single-object',
  services: 'architecture',
  sortOrder: '100',
  status: 'Проект',
  tags: '',
  title: '',
  url: '',
};

const DEFAULT_BOT_WELCOME_JSON = JSON.stringify(
  {
    text: 'Здравствуйте! Я помощник проектного бюро КРАФТ 👋\n\nПомогу передать вводные по проекту команде. Анкета займёт 7–10 минут, а черновик можно продолжить позже.',
  },
  null,
  2,
);

const caseToForm = (item: AdminCase): CaseFormState => ({
  area: item.area === null ? '' : String(item.area),
  categories: item.categories.join(', '),
  city: item.city,
  constructionKind: item.constructionKind ?? '',
  id: item.id,
  image: item.image ?? '',
  published: item.published,
  region: item.region,
  scale: item.scale ?? '',
  services: item.services.join(', '),
  sortOrder: String(item.sortOrder),
  status: item.status,
  tags: item.tags.join(', '),
  title: item.title,
  url: item.url,
});

const taxonomyList = (value: string): string[] => [
  ...new Set(
    value
      .split(',')
      .map((item) => item.trim().toLocaleLowerCase('ru-RU'))
      .filter(Boolean),
  ),
];

const caseFormPayload = (form: CaseFormState): AdminCaseCreateRequest => ({
  id: form.id.trim(),
  title: form.title.trim(),
  url: form.url.trim(),
  image: form.image.trim() === '' ? null : form.image.trim(),
  city: form.city.trim(),
  region: form.region.trim(),
  categories: taxonomyList(form.categories),
  services: taxonomyList(form.services),
  area: form.area.trim() === '' ? null : Number(form.area.replace(',', '.')),
  scale: form.scale.trim() === '' ? null : form.scale.trim(),
  constructionKind: form.constructionKind.trim() === '' ? null : form.constructionKind.trim(),
  status: form.status.trim(),
  tags: taxonomyList(form.tags),
  published: form.published,
  sortOrder: Number(form.sortOrder),
});

export const AdminPanel = ({ initData, onExit }: AdminPanelProps) => {
  const [authState, setAuthState] = useState<AuthState>('checking');
  const [session, setSession] = useState<AdminSessionResponse | null>(null);
  const [tab, setTab] = useState<AdminTab>('overview');
  const [users, setUsers] = useState<readonly AdminUserListItem[]>([]);
  const [submissions, setSubmissions] = useState<readonly AdminSubmissionListItem[]>([]);
  const [cases, setCases] = useState<readonly AdminCase[]>([]);
  const [content, setContent] = useState<readonly AdminContentDocument[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [notice, setNotice] = useState<{ readonly error?: boolean; readonly text: string } | null>(
    null,
  );

  const refresh = useCallback(async (): Promise<void> => {
    setLoadingData(true);
    const results = await Promise.allSettled([
      loadAllCursorPages(adminApi.listUsers, (item) => item.maxUserId),
      loadAllCursorPages(
        (cursor) => adminApi.listSubmissions(cursor === undefined ? {} : { cursor }),
        (item) => item.submissionId,
      ),
      adminApi.listCases(),
      adminApi.listContent(),
    ]);
    const [usersResult, submissionsResult, casesResult, contentResult] = results;
    if (usersResult.status === 'fulfilled') setUsers(usersResult.value);
    if (submissionsResult.status === 'fulfilled') setSubmissions(submissionsResult.value);
    if (casesResult.status === 'fulfilled') setCases(casesResult.value);
    if (contentResult.status === 'fulfilled') setContent(contentResult.value);
    const failed = results.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected')
      setNotice({ error: true, text: errorMessage(failed.reason) });
    setLoadingData(false);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        let authenticated: AdminSessionResponse;
        try {
          authenticated = await adminApi.getSession();
        } catch (error) {
          if (!(error instanceof AdminApiError) || error.status !== 401) throw error;
          if (initData === null || initData === '') {
            if (active) setAuthState('outside-max');
            return;
          }
          authenticated = await adminApi.authenticate(initData);
        }
        if (!active) return;
        setSession(authenticated);
        setAuthState('ready');
      } catch (error) {
        if (!active) return;
        setAuthState(
          error instanceof AdminApiError && error.status === 403 ? 'forbidden' : 'error',
        );
      }
    })();
    return () => {
      active = false;
    };
  }, [initData]);

  useEffect(() => {
    if (authState !== 'ready') return;
    void refresh();
  }, [authState, refresh]);

  useEffect(() => {
    if (notice === null) return;
    const timeout = window.setTimeout(() => setNotice(null), 5_000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  if (authState !== 'ready' || session === null) {
    const stateCopy =
      authState === 'checking'
        ? {
            title: 'Проверяем доступ',
            text: 'Подтверждаем MAX-аккаунт и защищённую админ-сессию.',
          }
        : authState === 'outside-max'
          ? {
              title: 'Откройте панель из MAX',
              text: 'Админ-панель использует подпись MAX вместо пароля. Нажмите «Админ-панель» в чате с ботом.',
            }
          : authState === 'forbidden'
            ? {
                title: 'Доступ не разрешён',
                text: 'Этот MAX-аккаунт не входит в список администраторов.',
              }
            : {
                title: 'Не удалось войти',
                text: 'Проверьте соединение и повторно откройте Mini App из чата с ботом.',
              };
    return (
      <main className="admin-auth-state">
        <div className="admin-auth-state__brand">
          КРАФТ<span>.</span> <small>CONTROL</small>
        </div>
        <div className="admin-auth-state__visual">
          <span className={authState === 'checking' ? 'admin-loader' : ''}>
            <Icon name={authState === 'forbidden' ? 'warning' : 'shield'} size={30} />
          </span>
        </div>
        <p className="eyebrow">Защищённая зона</p>
        <h1>{stateCopy.title}</h1>
        <p>{stateCopy.text}</p>
        {authState === 'checking' ? null : (
          <button className="admin-button admin-button--primary" onClick={onExit} type="button">
            Вернуться в Mini App
          </button>
        )}
      </main>
    );
  }

  const newCount = submissions.filter(({ reviewStatus }) => reviewStatus === 'new').length;
  const publishedCases = cases.filter(({ published }) => published).length;

  return (
    <div className="admin-shell">
      <header className="admin-header">
        <button
          aria-label="Выйти на главную"
          className="admin-brand"
          onClick={onExit}
          type="button"
        >
          <span>
            КРАФТ<span aria-hidden="true">.</span>
          </span>
          <small>CONTROL</small>
        </button>
        <div className="admin-header__actions">
          <button
            aria-label="Обновить данные"
            className="admin-icon-button"
            disabled={loadingData}
            onClick={() => void refresh()}
            type="button"
          >
            <Icon name="spark" size={19} />
          </button>
          <div className="admin-profile">
            <span>{session.user.firstName.slice(0, 1).toUpperCase()}</span>
            <div>
              <strong>{displayName(session.user)}</strong>
              <small>Администратор</small>
            </div>
          </div>
          <button
            className="admin-logout"
            onClick={() => {
              void adminApi.logout().finally(onExit);
            }}
            type="button"
          >
            Выйти
          </button>
        </div>
      </header>

      <div className="admin-layout">
        <aside className="admin-sidebar">
          <div className="admin-sidebar__intro">
            <span className="admin-live">
              <i /> Система работает
            </span>
            <strong>Центр управления</strong>
            <p>Пользователи, заявки и контент бота в одном месте.</p>
          </div>
          <nav aria-label="Разделы админ-панели" className="admin-navigation">
            {ADMIN_TABS.map((item) => (
              <button
                aria-current={tab === item.value ? 'page' : undefined}
                className={tab === item.value ? 'is-active' : ''}
                key={item.value}
                onClick={() => setTab(item.value)}
                type="button"
              >
                <Icon name={item.icon} size={19} />
                <span>{item.label}</span>
                {item.value === 'submissions' && newCount > 0 ? <b>{newCount}</b> : null}
              </button>
            ))}
          </nav>
          <div className="admin-sidebar__session">
            <Icon name="shield" size={18} />
            <span>
              Сессия до
              <strong>{formatDate(session.expiresAt)}</strong>
            </span>
          </div>
        </aside>

        <main className="admin-main">
          {tab === 'overview' ? (
            <OverviewPanel
              cases={cases}
              newCount={newCount}
              onOpenTab={setTab}
              publishedCases={publishedCases}
              submissions={submissions}
              users={users}
            />
          ) : null}
          {tab === 'submissions' ? (
            <SubmissionsPanel
              items={submissions}
              onChange={(item) =>
                setSubmissions((current) =>
                  current.map((candidate) =>
                    candidate.submissionId === item.submissionId ? item : candidate,
                  ),
                )
              }
              onNotice={setNotice}
              onRefresh={refresh}
            />
          ) : null}
          {tab === 'users' ? <UsersPanel items={users} /> : null}
          {tab === 'cases' ? (
            <CasesAdminPanel items={cases} onItemsChange={setCases} onNotice={setNotice} />
          ) : null}
          {tab === 'content' ? (
            <ContentAdminPanel items={content} onItemsChange={setContent} onNotice={setNotice} />
          ) : null}
        </main>
      </div>
      {notice === null ? null : (
        <div
          className={notice.error === true ? 'admin-toast is-error' : 'admin-toast'}
          role="status"
        >
          <Icon name={notice.error === true ? 'warning' : 'check'} size={18} />
          <span>{notice.text}</span>
          <button aria-label="Закрыть" onClick={() => setNotice(null)} type="button">
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
    </div>
  );
};

const PanelHeading = ({
  action,
  eyebrow,
  subtitle,
  title,
}: {
  readonly action?: ReactNode;
  readonly eyebrow: string;
  readonly subtitle: string;
  readonly title: string;
}) => (
  <header className="admin-panel-heading">
    <div>
      <span>{eyebrow}</span>
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </div>
    {action}
  </header>
);

const OverviewPanel = ({
  cases,
  newCount,
  onOpenTab,
  publishedCases,
  submissions,
  users,
}: {
  readonly cases: readonly AdminCase[];
  readonly newCount: number;
  readonly onOpenTab: (tab: AdminTab) => void;
  readonly publishedCases: number;
  readonly submissions: readonly AdminSubmissionListItem[];
  readonly users: readonly AdminUserListItem[];
}) => (
  <div className="admin-panel">
    <PanelHeading
      eyebrow="Сегодня"
      subtitle="Сводка по пользователям и работе с обращениями."
      title="Добро пожаловать в КРАФТ Control"
    />
    <section className="admin-metrics" aria-label="Ключевые показатели">
      <button onClick={() => onOpenTab('submissions')} type="button">
        <span className="admin-metric-icon admin-metric-icon--coral">
          <Icon name="brief" size={21} />
        </span>
        <small>Новые заявки</small>
        <strong>{newCount}</strong>
        <em>Требуют внимания</em>
      </button>
      <button onClick={() => onOpenTab('users')} type="button">
        <span className="admin-metric-icon">
          <Icon name="projects" size={21} />
        </span>
        <small>Пользователи</small>
        <strong>{users.length}</strong>
        <em>В текущей выборке</em>
      </button>
      <button onClick={() => onOpenTab('submissions')} type="button">
        <span className="admin-metric-icon admin-metric-icon--green">
          <Icon name="check" size={21} />
        </span>
        <small>Все заявки</small>
        <strong>{submissions.length}</strong>
        <em>За всё время</em>
      </button>
      <button onClick={() => onOpenTab('cases')} type="button">
        <span className="admin-metric-icon admin-metric-icon--violet">
          <Icon name="building" size={21} />
        </span>
        <small>Объекты</small>
        <strong>
          {publishedCases}
          <i> / {cases.length}</i>
        </strong>
        <em>Опубликовано</em>
      </button>
    </section>

    <section className="admin-dashboard-grid">
      <div className="admin-surface">
        <div className="admin-surface__heading">
          <div>
            <h2>Последние заявки</h2>
            <p>Самые свежие обращения</p>
          </div>
          <button onClick={() => onOpenTab('submissions')} type="button">
            Все заявки <Icon name="arrow" size={16} />
          </button>
        </div>
        {submissions.length === 0 ? (
          <EmptyAdminState title="Заявок пока нет">
            Новые обращения появятся здесь автоматически.
          </EmptyAdminState>
        ) : (
          <div className="admin-recent-list">
            {submissions.slice(0, 5).map((item) => (
              <button
                key={item.submissionId}
                onClick={() => onOpenTab('submissions')}
                type="button"
              >
                <span className="admin-avatar">{item.user.firstName.slice(0, 1)}</span>
                <span>
                  <strong>{item.intake.fullName}</strong>
                  <small>
                    {item.intake.organization} · {item.intake.objectType}
                  </small>
                </span>
                <time>{formatDate(item.submittedAt)}</time>
                <StatusBadge status={item.reviewStatus} />
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="admin-surface admin-quick-actions">
        <div className="admin-surface__heading">
          <div>
            <h2>Быстрые действия</h2>
            <p>Основные операции</p>
          </div>
        </div>
        <button onClick={() => onOpenTab('cases')} type="button">
          <span>
            <Icon name="plus" size={20} />
          </span>
          <div>
            <strong>Добавить объект</strong>
            <small>Новый кейс в портфолио</small>
          </div>
          <Icon name="chevron" size={18} />
        </button>
        <button onClick={() => onOpenTab('content')} type="button">
          <span>
            <Icon name="brief" size={20} />
          </span>
          <div>
            <strong>Изменить анкету</strong>
            <small>Вопросы и варианты ответов</small>
          </div>
          <Icon name="chevron" size={18} />
        </button>
        <button onClick={() => onOpenTab('submissions')} type="button">
          <span>
            <Icon name="chat" size={20} />
          </span>
          <div>
            <strong>Разобрать обращения</strong>
            <small>{newCount} новых в очереди</small>
          </div>
          <Icon name="chevron" size={18} />
        </button>
      </div>
    </section>
  </div>
);

const SubmissionsPanel = ({
  items,
  onChange,
  onNotice,
  onRefresh,
}: {
  readonly items: readonly AdminSubmissionListItem[];
  readonly onChange: (item: AdminSubmissionListItem) => void;
  readonly onNotice: (notice: { readonly error?: boolean; readonly text: string }) => void;
  readonly onRefresh: () => Promise<void>;
}) => {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const visible = useMemo(
    () =>
      items.filter(
        (item) =>
          (status === '' || item.reviewStatus === status) &&
          includesSearch(
            [
              item.submissionId,
              item.intake.fullName,
              item.intake.organization,
              item.intake.contact.phone,
              item.intake.contact.email,
            ],
            search,
          ),
      ),
    [items, search, status],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = items.find(({ submissionId }) => submissionId === selectedId) ?? null;

  return (
    <div className="admin-panel">
      <PanelHeading
        eyebrow="CRM"
        subtitle="Статусы, контакты и исходные данные заявок."
        title="Заявки"
      />
      <div className="admin-toolbar">
        <label className="admin-search">
          <Icon name="search" size={18} />
          <input
            aria-label="Поиск заявок"
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="Имя, компания, телефон или ID"
            type="search"
            value={search}
          />
        </label>
        <label className="admin-filter">
          <span>Статус</span>
          <select onChange={(event) => setStatus(event.currentTarget.value)} value={status}>
            <option value="">Все</option>
            {REVIEW_STATUSES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="admin-submissions-layout">
        <div className="admin-surface admin-table-wrap">
          <div className="admin-table admin-table--submissions" role="table">
            <div className="admin-table__head" role="row">
              <span>Клиент</span>
              <span>Проект</span>
              <span>Дата</span>
              <span>Статус</span>
              <span />
            </div>
            {visible.map((item) => (
              <button
                className={
                  selectedId === item.submissionId
                    ? 'admin-table__row is-selected'
                    : 'admin-table__row'
                }
                key={item.submissionId}
                onClick={() => setSelectedId(item.submissionId)}
                role="row"
                type="button"
              >
                <span data-label="Клиент">
                  <b>{item.intake.fullName}</b>
                  <small>{item.intake.organization}</small>
                </span>
                <span data-label="Проект">
                  <b>{item.intake.objectType}</b>
                  <small>{item.intake.location.city ?? item.intake.location.region}</small>
                </span>
                <time data-label="Дата">{formatDate(item.submittedAt)}</time>
                <span data-label="Статус">
                  <StatusBadge status={item.reviewStatus} />
                </span>
                <Icon name="chevron" size={17} />
              </button>
            ))}
          </div>
          {visible.length === 0 ? (
            <EmptyAdminState title="Ничего не найдено">
              Измените поиск или фильтр статуса.
            </EmptyAdminState>
          ) : null}
        </div>
        {selected === null ? (
          <aside className="admin-detail-placeholder">
            <Icon name="brief" size={26} />
            <h3>Выберите заявку</h3>
            <p>Карточка откроется здесь без перехода на другой экран.</p>
          </aside>
        ) : (
          <SubmissionDetail
            item={selected}
            onChange={onChange}
            onClose={() => setSelectedId(null)}
            onNotice={onNotice}
            onRefresh={onRefresh}
          />
        )}
      </div>
    </div>
  );
};

const SubmissionDetail = ({
  item,
  onChange,
  onClose,
  onNotice,
  onRefresh,
}: {
  readonly item: AdminSubmissionListItem;
  readonly onChange: (item: AdminSubmissionListItem) => void;
  readonly onClose: () => void;
  readonly onNotice: (notice: { readonly error?: boolean; readonly text: string }) => void;
  readonly onRefresh: () => Promise<void>;
}) => {
  const [status, setStatus] = useState<SubmissionReviewStatus>(item.reviewStatus);
  const [note, setNote] = useState(item.adminNote ?? '');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setStatus(item.reviewStatus);
    setNote(item.adminNote ?? '');
  }, [item]);
  const intake = item.intake;
  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      const updated = await adminApi.updateSubmission(item.submissionId, {
        expectedUpdatedAt: item.updatedAt,
        reviewStatus: status,
        adminNote: note.trim() === '' ? null : note.trim(),
      });
      onChange(updated);
      onNotice({ text: 'Изменения заявки сохранены' });
    } catch (error) {
      onNotice({ error: true, text: errorMessage(error) });
      if (error instanceof AdminApiError && error.status === 409) await onRefresh();
    } finally {
      setSaving(false);
    }
  };
  return (
    <aside className="admin-submission-detail">
      <header>
        <div>
          <span>{item.submissionId}</span>
          <h2>{intake.fullName}</h2>
          <p>{intake.organization}</p>
        </div>
        <button aria-label="Закрыть карточку" onClick={onClose} type="button">
          <Icon name="close" size={18} />
        </button>
      </header>
      <div className="admin-contact-actions">
        <a href={`tel:${intake.contact.phone}`}>
          <Icon name="phone" size={17} />
          {intake.contact.phone}
        </a>
        <a href={`mailto:${intake.contact.email}`}>
          <Icon name="mail" size={17} />
          Написать
        </a>
      </div>
      <dl className="admin-detail-list">
        <div>
          <dt>Объект</dt>
          <dd>{intake.objectType}</dd>
        </div>
        <div>
          <dt>Локация</dt>
          <dd>{[intake.location.city, intake.location.region].filter(Boolean).join(', ')}</dd>
        </div>
        <div>
          <dt>Стадия</dt>
          <dd>{intake.currentStage}</dd>
        </div>
        <div>
          <dt>Площадь</dt>
          <dd>
            {intake.area.status === 'known'
              ? `${intake.area.squareMeters.toLocaleString('ru-RU')} м²`
              : 'Не указана'}
          </dd>
        </div>
        <div className="is-wide">
          <dt>Услуги</dt>
          <dd>{intake.services.join(', ')}</dd>
        </div>
        <div className="is-wide">
          <dt>Описание</dt>
          <dd>{intake.description}</dd>
        </div>
        {intake.links.length === 0 ? null : (
          <div className="is-wide">
            <dt>Ссылки</dt>
            <dd>
              {intake.links.map((link) => (
                <a href={link} key={link} rel="noreferrer" target="_blank">
                  {link}
                </a>
              ))}
            </dd>
          </div>
        )}
      </dl>
      <div className="admin-review-form">
        <label>
          <span>Статус обработки</span>
          <select
            onChange={(event) => setStatus(event.currentTarget.value as SubmissionReviewStatus)}
            value={status}
          >
            {REVIEW_STATUSES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Заметка менеджера</span>
          <textarea
            maxLength={4000}
            onChange={(event) => setNote(event.currentTarget.value)}
            placeholder="Следующий шаг, договорённости, важные детали…"
            rows={4}
            value={note}
          />
        </label>
        <button
          className="admin-button admin-button--primary"
          disabled={saving || (status === item.reviewStatus && note === (item.adminNote ?? ''))}
          onClick={() => void save()}
          type="button"
        >
          {saving ? 'Сохраняем…' : 'Сохранить изменения'}
        </button>
      </div>
      <p className="admin-immutable-note">
        <Icon name="shield" size={15} /> Исходная анкета неизменяема; действия администратора
        записываются в аудит.
      </p>
    </aside>
  );
};

const UsersPanel = ({ items }: { readonly items: readonly AdminUserListItem[] }) => {
  const [search, setSearch] = useState('');
  const visible = items.filter((item) =>
    includesSearch(
      [item.maxUserId, item.displayName, item.user?.username ?? null, item.identitySource],
      search,
    ),
  );
  const sourceLabel = (item: AdminUserListItem): string => {
    if (item.identitySource === 'miniapp_and_bot') return 'Mini App + бот';
    if (item.identitySource === 'bot') return 'Только бот';
    return 'Mini App';
  };
  const lastActivity = (item: AdminUserListItem): string => {
    const candidates = [item.updatedAt, item.lastSubmissionAt, item.lastBotEventAt]
      .filter((value): value is string => value !== null)
      .toSorted((left, right) => Date.parse(right) - Date.parse(left));
    return candidates[0] ?? item.updatedAt;
  };
  return (
    <div className="admin-panel">
      <PanelHeading
        eyebrow="Аудитория"
        subtitle="Все MAX-пользователи из Mini App и диалогов с ботом."
        title="Пользователи"
      />
      <div className="admin-toolbar">
        <label className="admin-search">
          <Icon name="search" size={18} />
          <input
            aria-label="Поиск пользователей"
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="Имя, username или MAX ID"
            type="search"
            value={search}
          />
        </label>
      </div>
      <div className="admin-surface admin-table-wrap">
        <div className="admin-table admin-table--users" role="table">
          <div className="admin-table__head" role="row">
            <span>Пользователь</span>
            <span>Источник</span>
            <span>MAX ID</span>
            <span>Заявки</span>
            <span>Активность</span>
            <span>Черновик</span>
          </div>
          {visible.map((item) => (
            <div className="admin-table__row" key={item.maxUserId} role="row">
              <span data-label="Пользователь">
                <i className="admin-avatar">{item.displayName.slice(0, 1).toUpperCase()}</i>
                <span>
                  <b>{item.displayName}</b>
                  <small>
                    {item.user?.username === null || item.user?.username === undefined
                      ? item.identitySource === 'bot'
                        ? `${String(item.botDialogCount)} диалогов с ботом`
                        : 'без username'
                      : `@${item.user.username}`}
                  </small>
                </span>
              </span>
              <span
                data-label="Источник"
                className={`admin-source-badge admin-source-badge--${item.identitySource}`}
              >
                {sourceLabel(item)}
              </span>
              <code data-label="MAX ID">{item.maxUserId}</code>
              <strong data-label="Заявки">{item.submissionCount}</strong>
              <time data-label="Активность">{formatDate(lastActivity(item))}</time>
              <span
                data-label="Черновик"
                className={
                  item.hasActiveDraft ? 'admin-draft-badge is-active' : 'admin-draft-badge'
                }
              >
                {item.hasActiveDraft ? 'Есть' : 'Нет'}
              </span>
            </div>
          ))}
        </div>
        {visible.length === 0 ? (
          <EmptyAdminState title="Пользователи не найдены">
            Попробуйте другой запрос.
          </EmptyAdminState>
        ) : null}
      </div>
    </div>
  );
};

const CasesAdminPanel = ({
  items,
  onItemsChange,
  onNotice,
}: {
  readonly items: readonly AdminCase[];
  readonly onItemsChange: (items: readonly AdminCase[]) => void;
  readonly onNotice: (notice: { readonly error?: boolean; readonly text: string }) => void;
}) => {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminCase | null>(null);
  const [form, setForm] = useState<CaseFormState>(EMPTY_CASE);
  const [saving, setSaving] = useState(false);
  const openCreate = (): void => {
    setEditing(null);
    setForm(EMPTY_CASE);
    setFormOpen(true);
  };
  const openEdit = (item: AdminCase): void => {
    setEditing(item);
    setForm(caseToForm(item));
    setFormOpen(true);
  };
  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      const payload = caseFormPayload(form);
      const item =
        editing === null
          ? await adminApi.createCase(payload)
          : await adminApi.updateCase(editing.id, { ...payload, expectedVersion: editing.version });
      onItemsChange(
        editing === null
          ? [...items, item]
          : items.map((candidate) => (candidate.id === item.id ? item : candidate)),
      );
      setFormOpen(false);
      setEditing(null);
      onNotice({ text: editing === null ? 'Объект добавлен' : 'Объект обновлён' });
    } catch (error) {
      onNotice({ error: true, text: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  };
  const remove = async (item: AdminCase): Promise<void> => {
    if (!window.confirm(`Удалить объект «${item.title}»?`)) return;
    try {
      await adminApi.deleteCase(item.id, item.version);
      onItemsChange(items.filter(({ id }) => id !== item.id));
      onNotice({ text: 'Объект удалён' });
    } catch (error) {
      onNotice({ error: true, text: errorMessage(error) });
    }
  };
  const patchForm = (patch: Partial<CaseFormState>): void =>
    setForm((current) => ({ ...current, ...patch }));
  return (
    <div className="admin-panel">
      <PanelHeading
        action={
          <button className="admin-button admin-button--primary" onClick={openCreate} type="button">
            <Icon name="plus" size={18} />
            Добавить объект
          </button>
        }
        eyebrow="Портфолио"
        subtitle="Опубликованные объекты сразу появляются в каталоге Mini App."
        title="Объекты и кейсы"
      />
      <div className="admin-case-grid">
        {items.map((item) => (
          <article className="admin-case-card" key={item.id}>
            {item.image === null ? (
              <div className="admin-case-card__placeholder">
                <Icon name="building" size={25} />
              </div>
            ) : (
              <img alt="" src={item.image} />
            )}
            <div className="admin-case-card__body">
              <div>
                <span
                  className={item.published ? 'admin-publish-badge is-live' : 'admin-publish-badge'}
                >
                  {item.published ? 'Опубликован' : 'Черновик'}
                </span>
                <small>v{item.version}</small>
              </div>
              <h3>{item.title}</h3>
              <p>
                {item.city} · {item.status}
              </p>
              <div className="admin-case-card__actions">
                <button onClick={() => openEdit(item)} type="button">
                  Редактировать
                </button>
                <button
                  aria-label={`Удалить ${item.title}`}
                  onClick={() => void remove(item)}
                  type="button"
                >
                  <Icon name="close" size={17} />
                </button>
              </div>
            </div>
          </article>
        ))}
        <button className="admin-case-add" onClick={openCreate} type="button">
          <span>
            <Icon name="plus" size={24} />
          </span>
          <strong>Новый объект</strong>
          <small>Добавить в портфолио</small>
        </button>
      </div>
      {formOpen ? (
        <div
          className="admin-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setFormOpen(false);
          }}
          role="presentation"
        >
          <section
            aria-label={editing === null ? 'Добавить объект' : 'Редактировать объект'}
            aria-modal="true"
            className="admin-modal"
            role="dialog"
          >
            <header>
              <div>
                <span>Портфолио</span>
                <h2>{editing === null ? 'Новый объект' : 'Редактирование объекта'}</h2>
              </div>
              <button aria-label="Закрыть" onClick={() => setFormOpen(false)} type="button">
                <Icon name="close" size={19} />
              </button>
            </header>
            <div className="admin-form-grid">
              <label>
                <span>Системный ID</span>
                <input
                  disabled={editing !== null}
                  onChange={(event) => patchForm({ id: event.currentTarget.value })}
                  placeholder="new-business-center"
                  value={form.id}
                />
              </label>
              <label className="is-wide">
                <span>Название</span>
                <input
                  onChange={(event) => patchForm({ title: event.currentTarget.value })}
                  placeholder="Бизнес-центр…"
                  value={form.title}
                />
              </label>
              <label>
                <span>Город</span>
                <input
                  onChange={(event) => patchForm({ city: event.currentTarget.value })}
                  value={form.city}
                />
              </label>
              <label>
                <span>Регион</span>
                <input
                  onChange={(event) => patchForm({ region: event.currentTarget.value })}
                  value={form.region}
                />
              </label>
              <label className="is-wide">
                <span>Страница проекта (HTTPS)</span>
                <input
                  inputMode="url"
                  onChange={(event) => patchForm({ url: event.currentTarget.value })}
                  placeholder="https://craft72.ru/project"
                  value={form.url}
                />
              </label>
              <label className="is-wide">
                <span>Обложка (HTTPS)</span>
                <input
                  inputMode="url"
                  onChange={(event) => patchForm({ image: event.currentTarget.value })}
                  placeholder="https://…"
                  value={form.image}
                />
              </label>
              <label>
                <span>Категории через запятую</span>
                <input
                  onChange={(event) => patchForm({ categories: event.currentTarget.value })}
                  value={form.categories}
                />
              </label>
              <label>
                <span>Услуги через запятую</span>
                <input
                  onChange={(event) => patchForm({ services: event.currentTarget.value })}
                  value={form.services}
                />
              </label>
              <label>
                <span>Площадь, м²</span>
                <input
                  inputMode="decimal"
                  onChange={(event) => patchForm({ area: event.currentTarget.value })}
                  value={form.area}
                />
              </label>
              <label>
                <span>Статус проекта</span>
                <input
                  onChange={(event) => patchForm({ status: event.currentTarget.value })}
                  value={form.status}
                />
              </label>
              <label>
                <span>Масштаб</span>
                <input
                  onChange={(event) => patchForm({ scale: event.currentTarget.value })}
                  value={form.scale}
                />
              </label>
              <label>
                <span>Тип строительства</span>
                <input
                  onChange={(event) => patchForm({ constructionKind: event.currentTarget.value })}
                  value={form.constructionKind}
                />
              </label>
              <label>
                <span>Теги через запятую</span>
                <input
                  onChange={(event) => patchForm({ tags: event.currentTarget.value })}
                  value={form.tags}
                />
              </label>
              <label>
                <span>Порядок</span>
                <input
                  inputMode="numeric"
                  onChange={(event) => patchForm({ sortOrder: event.currentTarget.value })}
                  type="number"
                  value={form.sortOrder}
                />
              </label>
              <label className="admin-checkbox is-wide">
                <input
                  checked={form.published}
                  onChange={(event) => patchForm({ published: event.currentTarget.checked })}
                  type="checkbox"
                />
                <span>
                  <strong>Опубликовать в Mini App</strong>
                  <small>Объект станет доступен всем пользователям</small>
                </span>
              </label>
            </div>
            <footer>
              <button className="admin-button" onClick={() => setFormOpen(false)} type="button">
                Отмена
              </button>
              <button
                className="admin-button admin-button--primary"
                disabled={saving}
                onClick={() => void save()}
                type="button"
              >
                {saving ? 'Сохраняем…' : editing === null ? 'Добавить объект' : 'Сохранить'}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
};

const ContentAdminPanel = ({
  items,
  onItemsChange,
  onNotice,
}: {
  readonly items: readonly AdminContentDocument[];
  readonly onItemsChange: (items: readonly AdminContentDocument[]) => void;
  readonly onNotice: (notice: { readonly error?: boolean; readonly text: string }) => void;
}) => {
  const questionnaireDocument = items.find(({ key }) => key === 'questionnaire-main') ?? null;
  const [questionnaire, setQuestionnaire] = useState<QuestionnaireContent>(() =>
    normalizeQuestionnaireContent(questionnaireDocument?.draft),
  );
  const [questionnaireDirty, setQuestionnaireDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedGenericKey, setSelectedGenericKey] = useState<string | null>(null);
  const [genericKey, setGenericKey] = useState('bot-welcome');
  const [genericKind, setGenericKind] = useState<'bot' | 'miniapp'>('bot');
  const [genericJson, setGenericJson] = useState(DEFAULT_BOT_WELCOME_JSON);
  const [genericDirty, setGenericDirty] = useState(false);
  const genericDocument =
    selectedGenericKey === null
      ? null
      : (items.find(({ key }) => key === selectedGenericKey) ?? null);
  useEffect(() => {
    setQuestionnaire(normalizeQuestionnaireContent(questionnaireDocument?.draft));
    setQuestionnaireDirty(false);
  }, [questionnaireDocument]);
  const replaceDocument = (document: AdminContentDocument): void =>
    onItemsChange(
      items.some(({ key }) => key === document.key)
        ? items.map((item) => (item.key === document.key ? document : item))
        : [...items, document],
    );
  const saveQuestionnaire = async (): Promise<void> => {
    setSaving(true);
    try {
      const draft = questionnaireContentAsJson(questionnaire);
      const document =
        questionnaireDocument === null
          ? await adminApi.createContent({
              key: 'questionnaire-main',
              kind: 'questionnaire',
              draft,
            })
          : await adminApi.updateContent(questionnaireDocument.key, {
              expectedVersion: questionnaireDocument.version,
              draft,
            });
      replaceDocument(document);
      setQuestionnaireDirty(false);
      onNotice({ text: 'Черновик анкеты сохранён' });
    } catch (error) {
      onNotice({ error: true, text: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  };
  const publishQuestionnaire = async (): Promise<void> => {
    if (questionnaireDocument === null || questionnaireDirty) return;
    setSaving(true);
    try {
      const document = await adminApi.publishContent(
        questionnaireDocument.key,
        questionnaireDocument.version,
      );
      replaceDocument(document);
      onNotice({ text: 'Анкета опубликована в Mini App' });
    } catch (error) {
      onNotice({ error: true, text: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  };
  const resetGeneric = (): void => {
    setSelectedGenericKey(null);
    setGenericKey('bot-welcome');
    setGenericKind('bot');
    setGenericJson(DEFAULT_BOT_WELCOME_JSON);
    setGenericDirty(false);
  };
  const editGeneric = (document: AdminContentDocument): void => {
    setSelectedGenericKey(document.key);
    setGenericKey(document.key);
    setGenericKind(document.kind === 'bot' ? 'bot' : 'miniapp');
    setGenericJson(JSON.stringify(document.draft, null, 2));
    setGenericDirty(false);
  };
  const saveGeneric = async (): Promise<void> => {
    setSaving(true);
    try {
      const parsed = JSON.parse(genericJson) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
        throw new Error('record');
      const draft = parsed as Record<string, AdminJsonValue>;
      const document =
        genericDocument === null
          ? await adminApi.createContent({ key: genericKey.trim(), kind: genericKind, draft })
          : await adminApi.updateContent(genericDocument.key, {
              expectedVersion: genericDocument.version,
              draft,
            });
      replaceDocument(document);
      setSelectedGenericKey(document.key);
      setGenericKey(document.key);
      setGenericDirty(false);
      onNotice({
        text: genericDocument === null ? 'Контентный документ создан' : 'Черновик сохранён',
      });
    } catch (error) {
      onNotice({
        error: true,
        text:
          error instanceof SyntaxError
            ? 'JSON содержит ошибку'
            : error instanceof Error && error.message === 'record'
              ? 'JSON должен содержать объект'
              : errorMessage(error),
      });
    } finally {
      setSaving(false);
    }
  };
  const publishGeneric = async (): Promise<void> => {
    if (genericDocument === null || genericDirty) return;
    setSaving(true);
    try {
      const document = await adminApi.publishContent(genericDocument.key, genericDocument.version);
      replaceDocument(document);
      onNotice({ text: 'Документ опубликован' });
    } catch (error) {
      onNotice({ error: true, text: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  };
  const deleteGeneric = async (): Promise<void> => {
    if (genericDocument === null || !window.confirm(`Удалить документ «${genericDocument.key}»?`))
      return;
    setSaving(true);
    try {
      await adminApi.deleteContent(genericDocument.key, genericDocument.version);
      onItemsChange(items.filter(({ key }) => key !== genericDocument.key));
      resetGeneric();
      onNotice({ text: 'Документ удалён' });
    } catch (error) {
      onNotice({ error: true, text: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="admin-panel">
      <PanelHeading
        action={
          <div className="admin-version">
            <span
              className={
                questionnaireDocument?.publishedVersion === null || questionnaireDocument === null
                  ? ''
                  : 'is-live'
              }
            />
            {questionnaireDocument === null
              ? 'Не создана'
              : questionnaireDocument.publishedVersion === null
                ? `Черновик v${questionnaireDocument.version}`
                : `Опубликована v${questionnaireDocument.publishedVersion}`}
          </div>
        }
        eyebrow="CMS"
        subtitle="Управляйте формулировками без выпуска новой версии приложения."
        title="Анкета и контент"
      />
      <section className="admin-surface admin-content-editor">
        <div className="admin-surface__heading">
          <div>
            <h2>Анкета проекта</h2>
            <p>Заголовки шагов, подсказки и варианты ответов</p>
          </div>
          <span>
            {questionnaireDirty ? 'Есть несохранённые изменения' : 'Все изменения сохранены'}
          </span>
        </div>
        <QuestionnaireEditor
          onChange={(value) => {
            setQuestionnaire(value);
            setQuestionnaireDirty(true);
          }}
          value={questionnaire}
        />
        <div className="admin-editor-actions">
          <button
            className="admin-button"
            disabled={questionnaireDocument === null || questionnaireDirty || saving}
            onClick={() => void publishQuestionnaire()}
            type="button"
          >
            <Icon name="upload" size={17} />
            Опубликовать
          </button>
          <button
            className="admin-button admin-button--primary"
            disabled={!questionnaireDirty || saving}
            onClick={() => void saveQuestionnaire()}
            type="button"
          >
            {saving
              ? 'Сохраняем…'
              : questionnaireDocument === null
                ? 'Создать анкету'
                : 'Сохранить черновик'}
          </button>
        </div>
      </section>
      <section className="admin-content-grid">
        <div className="admin-surface">
          <div className="admin-surface__heading">
            <div>
              <h2>Другие документы</h2>
              <p>Тексты Mini App и сообщения бота</p>
            </div>
            <button className="admin-button" onClick={resetGeneric} type="button">
              <Icon name="plus" size={16} /> Новый
            </button>
          </div>
          <div className="admin-document-list">
            {items
              .filter(({ kind }) => kind !== 'questionnaire')
              .map((document) => (
                <button
                  className={selectedGenericKey === document.key ? 'is-selected' : ''}
                  key={document.key}
                  onClick={() => editGeneric(document)}
                  type="button"
                >
                  <span>
                    <Icon name={document.kind === 'bot' ? 'chat' : 'file'} size={17} />
                  </span>
                  <div>
                    <strong>{document.key}</strong>
                    <small>
                      {document.kind} · v{document.version}
                    </small>
                  </div>
                  <b className={document.publishedVersion === null ? '' : 'is-live'}>
                    {document.publishedVersion === null ? 'Черновик' : 'Опубликован'}
                  </b>
                </button>
              ))}
            {items.filter(({ kind }) => kind !== 'questionnaire').length === 0 ? (
              <p className="admin-document-empty">Документов пока нет</p>
            ) : null}
          </div>
        </div>
        <div className="admin-surface admin-generic-content">
          <div className="admin-surface__heading">
            <div>
              <h2>{genericDocument === null ? 'Новый документ' : genericDocument.key}</h2>
              <p>
                {genericDocument === null
                  ? 'Для текстов бота или Mini App'
                  : `Черновик v${genericDocument.version}${genericDocument.publishedVersion === null ? '' : ` · опубликована v${genericDocument.publishedVersion}`}`}
              </p>
            </div>
          </div>
          <div className="admin-form-grid">
            <label>
              <span>Ключ</span>
              <input
                disabled={genericDocument !== null}
                onChange={(event) => setGenericKey(event.currentTarget.value)}
                value={genericKey}
              />
            </label>
            <label>
              <span>Раздел</span>
              <select
                disabled={genericDocument !== null}
                onChange={(event) => setGenericKind(event.currentTarget.value as 'bot' | 'miniapp')}
                value={genericKind}
              >
                <option value="bot">Сообщения бота</option>
                <option value="miniapp">Mini App</option>
              </select>
            </label>
            <label className="is-wide">
              <span>JSON-содержимое</span>
              <textarea
                onChange={(event) => {
                  setGenericJson(event.currentTarget.value);
                  setGenericDirty(true);
                }}
                rows={6}
                spellCheck={false}
                value={genericJson}
              />
            </label>
          </div>
          <div className="admin-generic-actions">
            {genericDocument === null ? null : (
              <button
                className="admin-button admin-button--danger"
                disabled={saving}
                onClick={() => void deleteGeneric()}
                type="button"
              >
                Удалить
              </button>
            )}
            <button
              className="admin-button"
              disabled={genericDocument === null || genericDirty || saving}
              onClick={() => void publishGeneric()}
              type="button"
            >
              Опубликовать
            </button>
            <button
              className="admin-button admin-button--primary"
              disabled={saving || (genericDocument !== null && !genericDirty)}
              onClick={() => void saveGeneric()}
              type="button"
            >
              {saving
                ? 'Сохраняем…'
                : genericDocument === null
                  ? 'Создать документ'
                  : 'Сохранить черновик'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
