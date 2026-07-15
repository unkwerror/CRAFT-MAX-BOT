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
        <div className="hero__content">
          <span className="hero__eyebrow">
            <b>01</b>
            Архитектура · инженерия · развитие
          </span>
          <h1>
            Проект <span className="hero__line">начинается с</span>
            <em>точного вопроса</em>
          </h1>
          <p>
            Соберём исходные данные, определим состав работ и передадим задачу профильной команде
            КРАФТ.
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
        </div>
        <figure className="hero__media">
          <img
            alt="Деловой дом — проект КРАФТ в Тюмени"
            src="/portfolio/business-center-tyumen.jpg"
          />
          <figcaption>
            <span>Тюмень · 42 000 м²</span>
            <strong>Деловой дом</strong>
          </figcaption>
        </figure>
      </section>

      <section className="home-actions">
        <div className="section-heading">
          <div>
            <span className="section-heading__index">02 / Маршрут</span>
            <h2>С чего начнём</h2>
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
          {actions.map((action, index) => (
            <button
              className="action-card"
              key={action.label}
              onClick={() => {
                if (action.route === undefined) onSupport();
                else onNavigate(action.route);
              }}
              type="button"
            >
              <span className="action-card__topline">
                <span className="action-card__index">{String(index + 1).padStart(2, '0')}</span>
                <span className="action-card__icon">
                  <Icon name={action.icon} size={22} />
                </span>
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
            <strong>8</strong>
            <span>реальных проектов</span>
          </div>
          <div>
            <strong>Auto</strong>
            <span>сохранение</span>
          </div>
        </div>

        <div className="trust-panel">
          <div>
            <span className="section-heading__index">03 / Данные</span>
            <h2>Только необходимое</h2>
            <p>
              До согласия данные не уходят на сервер. Черновик можно продолжить позже, а заявку —
              отправить только вручную.
            </p>
          </div>
          <button onClick={() => onNavigate('privacy')} type="button">
            Как мы храним данные <Icon name="arrow" size={18} />
          </button>
        </div>
      </section>
    </div>
  </Page>
);
