import { Button } from '@maxhub/max-ui';

import type { AppRoute } from '../navigation.js';
import { Icon, type IconName } from '../components/Icon.js';
import { Page } from '../components/Layout.js';

interface HomeAction {
  readonly description: string;
  readonly icon: IconName;
  readonly label: string;
  readonly route?: AppRoute;
}

const actions: readonly HomeAction[] = [
  {
    description: 'Структурированный бриф с сохранением прогресса',
    icon: 'brief',
    label: 'Обсудить новый проект',
    route: 'brief',
  },
  {
    description: 'Короткая диагностика задачи',
    icon: 'compass',
    label: 'Подобрать услугу',
    route: 'finder',
  },
  {
    description: 'Релевантный опыт бюро',
    icon: 'projects',
    label: 'Посмотреть проекты',
    route: 'cases',
  },
  {
    description: 'Файлы и ссылки на материалы',
    icon: 'upload',
    label: 'Отправить ТЗ',
    route: 'upload',
  },
  {
    description: 'Открыть диалог с командой',
    icon: 'chat',
    label: 'Связаться с менеджером',
  },
];

export interface HomeScreenProps {
  readonly draftStep: number | null;
  readonly draftUpdatedAt?: string;
  readonly onNavigate: (route: AppRoute) => void;
  readonly onSupport: () => void;
}

export const HomeScreen = ({
  draftStep,
  draftUpdatedAt,
  onNavigate,
  onSupport,
}: HomeScreenProps) => (
  <Page>
    <div className="home-layout">
      <section className="hero">
        <span className="hero__tag">
          <Icon name="spark" size={15} />
          Архитектура · инженерия · развитие
        </span>
        <h1>
          Проект начинается с <em>точного вопроса</em>
        </h1>
        <p>
          Расскажите о задаче — соберём исходные данные, предложим подходящие направления и
          подготовим заявку для проектной команды CRAFT72.
        </p>
        <div className="hero__actions">
          <Button
            className="hero__primary"
            iconAfter={<Icon name="arrow" size={19} />}
            onClick={() => onNavigate('brief')}
            size="large"
            type="button"
          >
            Начать бриф
          </Button>
          <Button
            className="hero__secondary"
            mode="secondary"
            onClick={() => onNavigate('cases')}
            size="large"
            type="button"
          >
            Смотреть проекты
          </Button>
        </div>
      </section>

      <section>
        <div className="section-heading">
          <div>
            <h2>С чего начнём?</h2>
            <p>Выберите удобный сценарий</p>
          </div>
        </div>

        {draftStep === null ? null : (
          <div className="draft-banner">
            <Icon name="clock" size={22} />
            <div>
              <strong>Есть сохранённый черновик · шаг {draftStep} из 17</strong>
              <small>{draftUpdatedAt ?? 'Данные сохранены на этом устройстве'}</small>
            </div>
            <button onClick={() => onNavigate('brief')} type="button">
              Продолжить
            </button>
          </div>
        )}

        <div className="action-grid">
          {actions.map((action) => (
            <button
              className="action-card"
              key={action.label}
              onClick={() => {
                if (action.route === undefined) onSupport();
                else onNavigate(action.route);
              }}
              type="button"
            >
              <span className="action-card__icon">
                <Icon name={action.icon} size={22} />
              </span>
              <span className="action-card__copy">
                <span>
                  <strong>{action.label}</strong>
                  <small>{action.description}</small>
                </span>
                <Icon name="chevron" size={18} />
              </span>
            </button>
          ))}
        </div>

        <div className="metric-strip" aria-label="Возможности брифа">
          <div>
            <strong>17</strong>
            <span>понятных шагов</span>
          </div>
          <div>
            <strong>50 МБ</strong>
            <span>на один файл</span>
          </div>
          <div>
            <strong>Auto</strong>
            <span>сохранение</span>
          </div>
        </div>

        <div className="section-heading">
          <div>
            <h2>Прозрачно и безопасно</h2>
            <p>Только данные, необходимые для обсуждения проекта</p>
          </div>
          <button onClick={() => onNavigate('privacy')} type="button">
            О данных
          </button>
        </div>
      </section>
    </div>
  </Page>
);
