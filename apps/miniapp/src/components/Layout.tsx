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

export type StatusTone = 'ok' | 'warn' | 'error' | 'neutral';

export interface AppTopbarProps {
  readonly onNavigate: (route: AppRoute) => void;
  readonly status?: string;
  readonly statusTone?: StatusTone;
}

export const AppTopbar = ({
  onNavigate,
  status = 'Проектное бюро',
  statusTone,
}: AppTopbarProps) => (
  <header className="app-topbar">
    <button
      aria-label="КРАФТ — на главную"
      className="brand"
      onClick={() => onNavigate('home')}
      type="button"
    >
      <span className="brand__wordmark" aria-label="КРАФТ">
        КРАФТ<span aria-hidden="true">.</span>
      </span>
      <span className="brand__product">MAX MINI APP</span>
    </button>
    <span className="app-topbar__secure" title={status}>
      <span
        aria-hidden="true"
        className={`app-topbar__status-dot app-topbar__status-dot--${statusTone ?? 'neutral'}`}
      />
      <span className="app-topbar__status-copy">{status}</span>
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
  const stepText = `Шаг ${String(current)} из ${String(total)}`;

  return (
    <div
      className="progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress)}
      aria-valuetext={stepText}
      aria-label={label ?? stepText}
    >
      <div className="progress__meta">
        <span>{label ?? stepText}</span>
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

export type ToastTone = 'success' | 'error' | 'warning';

export interface ToastProps {
  readonly message: string;
  readonly onClose: () => void;
  readonly tone?: ToastTone;
}

const TOAST_ICON: Readonly<Record<ToastTone, IconName>> = {
  success: 'check',
  error: 'warning',
  warning: 'warning',
};

export const Toast = ({ message, onClose, tone = 'success' }: ToastProps) => (
  <div className={`toast toast--${tone}`} role={tone === 'success' ? 'status' : 'alert'}>
    <Icon name={TOAST_ICON[tone]} size={18} />
    <span>{message}</span>
    <button aria-label="Закрыть уведомление" onClick={onClose} type="button">
      <Icon name="close" size={17} />
    </button>
  </div>
);
