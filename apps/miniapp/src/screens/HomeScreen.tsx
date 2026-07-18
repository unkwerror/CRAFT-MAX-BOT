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
    description: '6 вопросов и понятная рекомендация',
    icon: 'compass',
    label: 'Подобрать услугу',
    route: 'finder',
  },
  {
    description: 'Реализованные объекты и масштабы',
    icon: 'projects',
    label: 'Посмотреть проекты',
    route: 'cases',
  },
  {
    description: 'ТЗ, планы, ссылки и другие файлы',
    icon: 'upload',
    label: 'Отправить материалы',
    route: 'upload',
  },
];

const howItWorks: readonly { readonly title: string; readonly text: string }[] = [
  {
    title: 'Заполните короткий бриф',
    text: 'Можно пропустить необязательное и вернуться позже.',
  },
  {
    title: 'Добавьте материалы',
    text: 'Если они уже есть — файлы и ссылки попадут в ту же заявку.',
  },
  {
    title: 'Получите следующий шаг',
    text: 'Менеджер изучит вводные и ответит в вашем чате MAX.',
  },
];

const heroFacts = ['7–10 минут', 'Черновик сохраняется', 'Ответ в MAX'] as const;

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

      <section className="hero hero--friendly">
        <div className="hero__content">
          <span className="hero__eyebrow hero__eyebrow--soft">
            <b>КРАФТ / 72</b>
            Проектное бюро · Тюмень
          </span>
          <h1>
            Расскажите о проекте —<em> соберём ясный первый шаг</em>
          </h1>
          <p>
            Не нужно готовить идеальное ТЗ. Ответьте на понятные вопросы, а мы поможем определить
            состав работ и следующий шаг.
          </p>
          <ul aria-label="Преимущества анкеты" className="hero__facts">
            {heroFacts.map((fact) => (
              <li key={fact}>
                <Icon name="check" size={14} />
                {fact}
              </li>
            ))}
          </ul>
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
              iconAfter={<Icon name="chat" size={18} />}
              mode="secondary"
              onClick={onSupport}
              size="large"
              type="button"
            >
              Связаться с менеджером
            </Button>
          </div>
          <button
            className="hero__portfolio-link"
            onClick={() => onNavigate('cases')}
            type="button"
          >
            Смотреть проекты <Icon name="arrow" size={17} />
          </button>
        </div>
        <figure className="hero__media">
          <img
            alt="Деловой дом — проект КРАФТ в Тюмени"
            src="/portfolio/business-center-tyumen.jpg"
          />
          <span className="hero__media-kicker">Выбранный проект</span>
          <figcaption>
            <span>
              <strong>Деловой дом</strong>
              Тюмень · 42 000 м²
            </span>
            <span className="hero__media-arrow" aria-hidden="true">
              <Icon name="arrow" size={18} />
            </span>
          </figcaption>
        </figure>
      </section>

      <section className="home-actions">
        <div className="section-heading">
          <div>
            <span className="section-heading__index">Быстрый маршрут</span>
            <h2>Что хотите сделать?</h2>
            <p>Выберите удобную точку входа — всё останется в одной заявке</p>
          </div>
        </div>

        <div className="action-grid action-grid--friendly">
          {actions.map((action, index) => (
            <button
              className="action-card action-card--friendly"
              key={action.label}
              onClick={() => {
                if (action.route === undefined) onSupport();
                else onNavigate(action.route);
              }}
              type="button"
            >
              <span className="action-card__icon" aria-hidden="true">
                <Icon name={action.icon} size={20} />
              </span>
              <span className="action-card__body">
                <span className="action-card__index">0{index + 1}</span>
                <strong>{action.label}</strong>
                <small>{action.description}</small>
              </span>
              <Icon name="chevron" size={18} />
            </button>
          ))}
        </div>

        <section className="process-panel">
          <div className="section-heading">
            <div>
              <span className="section-heading__index">Как всё пройдёт</span>
              <h2>От вводных к разговору</h2>
              <p>Без повторного опроса и потери файлов в переписке</p>
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
        </section>

        <div className="trust-panel trust-panel--compact">
          <div>
            <span className="section-heading__index">Под вашим контролем</span>
            <h2>Черновик — ваш. Отправка — только вручную.</h2>
            <p>
              До согласия данные не уходят на сервер. Ответы можно проверить и изменить перед
              отправкой менеджеру.
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
