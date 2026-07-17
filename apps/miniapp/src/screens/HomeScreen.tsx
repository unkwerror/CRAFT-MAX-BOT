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
    description: 'Ответьте на вопросы — прогресс сохранится',
    icon: 'brief',
    label: 'Заполнить анкету',
    route: 'brief',
  },
  {
    description: 'Короткая подсказка, какая услуга подойдёт',
    icon: 'compass',
    label: 'Подобрать услугу',
    route: 'finder',
  },
  {
    description: 'Примеры реализованных объектов',
    icon: 'projects',
    label: 'Посмотреть проекты',
    route: 'cases',
  },
  {
    description: 'Файлы, ссылки и материалы к задаче',
    icon: 'upload',
    label: 'Отправить материалы',
    route: 'upload',
  },
];

const howItWorks: readonly { readonly title: string; readonly text: string }[] = [
  {
    title: 'Расскажите о задаче',
    text: 'Короткая анкета: объект, цель и контакты.',
  },
  {
    title: 'При желании добавьте материалы',
    text: 'Проекты, файлы ТЗ или ссылки — не обязательно сразу.',
  },
  {
    title: 'Менеджер свяжется с вами',
    text: 'Ответ придёт в MAX — обычно в ближайшее время.',
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
    <div className="home-layout home-layout--friendly">
      <section className="hero hero--friendly">
        <div className="hero__content">
          <span className="hero__eyebrow hero__eyebrow--soft">
            <b>КРАФТ</b>
            Архитектура и проектирование
          </span>
          <h1>
            Расскажите о проекте —
            <em> мы подскажем, с чего начать</em>
          </h1>
          <p>
            Заполните анкету или напишите менеджеру. Можно сохранить ответы и вернуться позже.
          </p>
          <div className="hero__actions">
            <Button
              className="hero__primary"
              iconAfter={<Icon name="arrow" size={19} />}
              onClick={() => onNavigate('brief')}
              size="large"
              type="button"
            >
              Заполнить анкету
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
        {draftStep === null ? null : (
          <div className="draft-banner draft-banner--priority">
            <Icon name="clock" size={22} />
            <div>
              <strong>Продолжить анкету · шаг {draftStep} из 17</strong>
              <small>{draftUpdatedAt ?? 'Ответы сохранены на этом устройстве'}</small>
            </div>
            <button onClick={() => onNavigate('brief')} type="button">
              Продолжить
            </button>
          </div>
        )}

        <div className="section-heading">
          <div>
            <span className="section-heading__index">Как это работает</span>
            <h2>Три простых шага</h2>
            <p>Без сложных терминов — только нужное для заявки</p>
          </div>
        </div>

        <ol className="how-steps">
          {howItWorks.map((step, index) => (
            <li className="how-steps__item" key={step.title}>
              <span className="how-steps__num" aria-hidden="true">
                {index + 1}
              </span>
              <div>
                <strong>{step.title}</strong>
                <small>{step.text}</small>
              </div>
            </li>
          ))}
        </ol>

        <div className="section-heading">
          <div>
            <span className="section-heading__index">С чего начать</span>
            <h2>Выберите действие</h2>
            <p>Любой путь можно сменить позже</p>
          </div>
        </div>

        <div className="action-grid action-grid--friendly">
          {actions.map((action) => (
            <button
              className="action-card action-card--friendly"
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

        <button className="home-support" onClick={onSupport} type="button">
          <Icon name="chat" size={20} />
          <span>
            <strong>Связаться с менеджером</strong>
            <small>Напишите в чат MAX — ответим по задаче</small>
          </span>
          <Icon name="arrow" size={18} />
        </button>

        <div className="trust-panel trust-panel--compact">
          <div>
            <span className="section-heading__index">Данные</span>
            <h2>Только необходимое</h2>
            <p>
              До согласия данные не уходят на сервер. Черновик можно продолжить позже, заявку —
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
