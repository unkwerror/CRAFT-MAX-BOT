export const MAX_PLATFORMS = ['ios', 'android', 'desktop', 'web'] as const;
export type MaxPlatform = (typeof MAX_PLATFORMS)[number];

export const MAX_THEMES = ['light', 'dark'] as const;
export type MaxTheme = (typeof MAX_THEMES)[number];

export interface MaxViewportSize {
  readonly width: number;
  readonly height: number;
}

export interface MaxWebAppViewportSize {
  readonly width: string;
  readonly height: string;
}

export interface MaxContactData {
  readonly phone: string;
  readonly authDate: string;
  readonly hash: string;
}

export interface MaxWebAppUser {
  readonly id: number;
  readonly first_name: string;
  readonly last_name: string;
  readonly username: string | null;
  readonly language_code: string;
  readonly photo_url: string | null;
}

export interface MaxWebAppChat {
  readonly id: number;
  readonly type: 'DIALOG' | 'CHAT' | 'CHANNEL';
}

export interface MaxWebAppInitDataUnsafe {
  readonly query_id?: string;
  readonly ip?: string;
  readonly auth_date?: number;
  readonly hash?: string;
  readonly user?: MaxWebAppUser;
  readonly chat?: MaxWebAppChat;
  readonly start_param?: string;
}

export interface MaxWebAppBackButton {
  readonly isVisible: boolean;
  show(): void;
  hide(): void;
  onClick(callback: () => void): void;
  offClick(callback: () => void): void;
}

export interface MaxWebAppBridge {
  readonly initData: string;
  readonly initDataUnsafe: MaxWebAppInitDataUnsafe;
  readonly platform: MaxPlatform;
  readonly version: string;
  readonly BackButton: MaxWebAppBackButton;
  getViewportSize(): Promise<MaxWebAppViewportSize>;
  enableClosingConfirmation(): void;
  disableClosingConfirmation(): void;
  requestContact(): Promise<MaxContactData>;
  openLink(url: string): void;
  openMaxLink(url: string): void;
}

export type Unsubscribe = () => void;

export interface MaxBackButtonAdapter {
  isVisible(): boolean;
  show(): void;
  hide(): void;
  subscribe(callback: () => void): Unsubscribe;
}

export interface MaxBridgeAdapter {
  readonly backButton: MaxBackButtonAdapter;
  isAvailable(): boolean;
  getInitData(): string | null;
  getPlatform(): MaxPlatform;
  getTheme(): MaxTheme;
  subscribeTheme(callback: (theme: MaxTheme) => void): Unsubscribe;
  getViewportSize(): Promise<MaxViewportSize>;
  enableClosingConfirmation(): void;
  disableClosingConfirmation(): void;
  requestContact(): Promise<MaxContactData>;
  openLink(url: string): boolean;
  openMaxLink(url: string): boolean;
}

export interface MediaQueryChangeEventLike {
  readonly matches: boolean;
}

export type MediaQueryChangeListener = (event: MediaQueryChangeEventLike) => void;

export interface MediaQueryListLike {
  readonly matches: boolean;
  addEventListener?(type: 'change', listener: MediaQueryChangeListener): void;
  removeEventListener?(type: 'change', listener: MediaQueryChangeListener): void;
  addListener?(listener: MediaQueryChangeListener): void;
  removeListener?(listener: MediaQueryChangeListener): void;
}

export interface BrowserEventLike {
  returnValue?: string | boolean;
  preventDefault?(): void;
}

export type BrowserEventListener = (event: BrowserEventLike) => void;

export interface BrowserWindowProxyLike {
  opener: unknown;
}

export interface MaxBridgeWindow {
  readonly WebApp?: MaxWebAppBridge;
  readonly innerWidth?: number;
  readonly innerHeight?: number;
  readonly document?: {
    readonly documentElement?: {
      readonly clientWidth?: number;
      readonly clientHeight?: number;
    };
  };
  matchMedia?(query: string): MediaQueryListLike;
  open?(url: string, target: string, features: string): BrowserWindowProxyLike | null;
  addEventListener?(type: 'popstate' | 'beforeunload', listener: BrowserEventListener): void;
  removeEventListener?(type: 'popstate' | 'beforeunload', listener: BrowserEventListener): void;
}
