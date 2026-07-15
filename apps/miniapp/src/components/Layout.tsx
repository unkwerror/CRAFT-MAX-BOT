import { Button, Typography } from '@maxhub/max-ui';
import type { ReactNode } from 'react';

import type { AppRoute } from '../navigation.js';
import { routeHref } from '../navigation.js';
import { Icon, type IconName } from './Icon.js';

const NAV_ITEMS: readonly { icon: IconName; label: string; route: AppRoute }[] = [
  { icon: 'home', label: 'Главная', route: 'home' },
  { icon: 'brief', label: 'Бриф', route: 'brief' },
  { icon: 'projects', label: 'Проекты', route: 'cases' },
  { icon: 'upload', label: 'Материалы', route: 'upload' },
];

export interface AppTopbarProps {
  readonly onNavigate: (route: AppRoute) => void;
  readonly status?: string;
}

export const AppTopbar = ({ onNavigate, status = 'Проектное бюро' }: AppTopbarProps) => (
  <header className="app-topbar">
    <button className="brand" onClick={() => onNavigate('home')} type="button">
      <span className="brand__mark" aria-hidden="true">
        C72
      </span>
      <span>
        <strong>CRAFT72</strong>
        <small>{status}</small>
      </span>
    </button>
    <span className="app-topbar__secure">
      <Icon name="shield" size={16} />
      Локальный черновик
    </span>
  </header>
);

export interface PageProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly withNavigation?: boolean;
}

export const Page = ({ children, className = '', withNavigation = true }: PageProps) => (
  <main className={`page ${withNavigation ? 'page--with-nav' : ''} ${className}`.trim()}>
    {children}
  </main>
);

export interface BottomNavProps {
  readonly activeRoute: AppRoute;
  readonly onNavigate: (route: AppRoute) => void;
}

export const BottomNav = ({ activeRoute, onNavigate }: BottomNavProps) => (
  <nav aria-label="Основная навигация" className="bottom-nav">
    {NAV_ITEMS.map((item) => (
      <a
        aria-current={activeRoute === item.route ? 'page' : undefined}
        className={activeRoute === item.route ? 'bottom-nav__item is-active' : 'bottom-nav__item'}
        href={routeHref(item.route)}
        key={item.route}
        onClick={(event) => {
          event.preventDefault();
          onNavigate(item.route);
        }}
      >
        <Icon name={item.icon} size={22} />
        <span>{item.label}</span>
      </a>
    ))}
  </nav>
);

export interface ScreenHeaderProps {
  readonly eyebrow?: string;
  readonly onBack?: () => void;
  readonly subtitle?: string;
  readonly title: string;
}

export const ScreenHeader = ({ eyebrow, onBack, subtitle, title }: ScreenHeaderProps) => (
  <div className="screen-header">
    {onBack === undefined ? null : (
      <button aria-label="Назад" className="icon-control" onClick={onBack} type="button">
        <Icon name="back" size={22} />
      </button>
    )}
    <div>
      {eyebrow === undefined ? null : <span className="eyebrow">{eyebrow}</span>}
      <h1 className="screen-header__heading">
        <Typography.Headline className="screen-header__title">{title}</Typography.Headline>
      </h1>
      {subtitle === undefined ? null : <p className="screen-header__subtitle">{subtitle}</p>}
    </div>
  </div>
);

export interface ProgressBarProps {
  readonly current: number;
  readonly label?: string;
  readonly total: number;
}

export const ProgressBar = ({ current, label, total }: ProgressBarProps) => {
  const progress = Math.max(0, Math.min(100, (current / total) * 100));

  return (
    <div className="progress" aria-label={`Шаг ${String(current)} из ${String(total)}`}>
      <div className="progress__meta">
        <span>{label ?? `Шаг ${String(current)} из ${String(total)}`}</span>
        <strong>{Math.round(progress)}%</strong>
      </div>
      <div aria-hidden="true" className="progress__track">
        <span style={{ width: `${String(progress)}%` }} />
      </div>
    </div>
  );
};

export interface StickyActionsProps {
  readonly backLabel?: string;
  readonly children?: ReactNode;
  readonly continueDisabled?: boolean;
  readonly continueLabel?: string;
  readonly loading?: boolean;
  readonly onBack?: () => void;
  readonly onContinue: () => void;
}

export const StickyActions = ({
  backLabel = 'Назад',
  children,
  continueDisabled = false,
  continueLabel = 'Продолжить',
  loading = false,
  onBack,
  onContinue,
}: StickyActionsProps) => (
  <div className="sticky-actions">
    {children}
    <div className="sticky-actions__row">
      {onBack === undefined ? null : (
        <Button mode="secondary" onClick={onBack} size="large" type="button">
          {backLabel}
        </Button>
      )}
      <Button
        className="sticky-actions__primary"
        disabled={continueDisabled}
        loading={loading}
        mode="primary"
        onClick={onContinue}
        size="large"
        type="button"
      >
        {continueLabel}
      </Button>
    </div>
  </div>
);

export const LoadingScreen = ({ label = 'Загружаем данные…' }: { readonly label?: string }) => (
  <div className="state-screen" role="status">
    <span className="state-screen__spinner" />
    <p>{label}</p>
  </div>
);

export interface ToastProps {
  readonly message: string;
  readonly onClose: () => void;
}

export const Toast = ({ message, onClose }: ToastProps) => (
  <div className="toast" role="status">
    <Icon name="check" size={18} />
    <span>{message}</span>
    <button aria-label="Закрыть уведомление" onClick={onClose} type="button">
      <Icon name="close" size={17} />
    </button>
  </div>
);
