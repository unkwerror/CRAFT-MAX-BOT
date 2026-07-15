import {
  MAX_PLATFORMS,
  type BrowserEventListener,
  type MaxBackButtonAdapter,
  type MaxBridgeAdapter,
  type MaxBridgeWindow,
  type MaxContactData,
  type MaxPlatform,
  type MaxTheme,
  type MaxViewportSize,
  type MaxWebAppBridge,
  type MediaQueryListLike,
  type Unsubscribe,
} from './types.js';

const DARK_THEME_MEDIA_QUERY = '(prefers-color-scheme: dark)';
const MAX_HOSTNAME = 'max.ru';

function noop(): void {
  return undefined;
}

function createIdempotentUnsubscribe(unsubscribe: () => void): Unsubscribe {
  let active = true;

  return () => {
    if (!active) {
      return;
    }

    active = false;
    unsubscribe();
  };
}

function getDefaultWindow(): MaxBridgeWindow | undefined {
  return typeof window === 'undefined' ? undefined : (window as unknown as MaxBridgeWindow);
}

function isMaxPlatform(value: unknown): value is MaxPlatform {
  return typeof value === 'string' && MAX_PLATFORMS.some((platform) => platform === value);
}

function toPositiveDimension(value: unknown): number | undefined {
  const dimension =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseFloat(value)
        : Number.NaN;

  return Number.isFinite(dimension) && dimension > 0 ? dimension : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isMaxContactData(value: unknown): value is MaxContactData {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.phone === 'string' &&
    /^\+?[1-9]\d{7,14}$/.test(value.phone) &&
    typeof value.authDate === 'string' &&
    /^\d{10,13}$/.test(value.authDate) &&
    typeof value.hash === 'string' &&
    /^[a-f0-9]{64}$/i.test(value.hash)
  );
}

function getBridgeErrorCode(error: unknown): string | undefined {
  if (!isRecord(error) || !isRecord(error.error)) {
    return undefined;
  }

  return typeof error.error.code === 'string' ? error.error.code : undefined;
}

function normalizeUrl(value: string, maxOnly: boolean): string {
  if (value.length > 2_048) {
    throw new TypeError('URL is too long');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new TypeError('Expected an absolute URL', { cause: error });
  }

  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    throw new TypeError('Only credential-free HTTPS URLs are allowed');
  }

  if (maxOnly && (url.hostname !== MAX_HOSTNAME || url.port !== '')) {
    throw new TypeError('Expected an https://max.ru link');
  }

  return url.toString();
}

export class MaxBridgeError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MaxBridgeError';
    this.code = code;
  }
}

class MaxBridgeAdapterImpl implements MaxBridgeAdapter {
  readonly backButton: MaxBackButtonAdapter;

  private closingConfirmationMode: 'native' | 'browser' | undefined;
  private closingConfirmationWebApp: MaxWebAppBridge | undefined;
  private readonly host: MaxBridgeWindow | undefined;
  private readonly beforeUnloadListener: BrowserEventListener = (event) => {
    event.preventDefault?.();
    event.returnValue = '';
  };

  constructor(host: MaxBridgeWindow | undefined) {
    this.host = host;
    this.backButton = {
      isVisible: () => this.isBackButtonVisible(),
      show: () => this.showBackButton(),
      hide: () => this.hideBackButton(),
      subscribe: (callback) => this.subscribeBackButton(callback),
    };
  }

  isAvailable(): boolean {
    return this.getWebApp() !== undefined;
  }

  getPlatform(): MaxPlatform {
    const platform = this.getWebApp()?.platform;
    return isMaxPlatform(platform) ? platform : 'web';
  }

  getTheme(): MaxTheme {
    return this.getThemeMediaQuery()?.matches === true ? 'dark' : 'light';
  }

  subscribeTheme(callback: (theme: MaxTheme) => void): Unsubscribe {
    const mediaQuery = this.getThemeMediaQuery();
    if (mediaQuery === undefined) {
      return noop;
    }

    const listener = (event: { readonly matches: boolean }): void => {
      callback(event.matches ? 'dark' : 'light');
    };

    try {
      if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', listener);
        return createIdempotentUnsubscribe(() => {
          mediaQuery.removeEventListener?.('change', listener);
        });
      }

      if (typeof mediaQuery.addListener === 'function') {
        mediaQuery.addListener(listener);
        return createIdempotentUnsubscribe(() => {
          mediaQuery.removeListener?.(listener);
        });
      }
    } catch {
      return noop;
    }

    return noop;
  }

  async getViewportSize(): Promise<MaxViewportSize> {
    const webApp = this.getWebApp();

    if (typeof webApp?.getViewportSize === 'function') {
      try {
        const viewport: unknown = await webApp.getViewportSize();
        if (isRecord(viewport)) {
          const width = toPositiveDimension(viewport.width);
          const height = toPositiveDimension(viewport.height);
          if (width !== undefined && height !== undefined) {
            return { width, height };
          }
        }
      } catch {
        // MAX Bridge may be unavailable in an ordinary browser; use the browser viewport below.
      }
    }

    return this.getBrowserViewportSize();
  }

  enableClosingConfirmation(): void {
    if (this.closingConfirmationMode !== undefined) {
      return;
    }

    const webApp = this.getWebApp();
    if (typeof webApp?.enableClosingConfirmation === 'function') {
      try {
        webApp.enableClosingConfirmation();
        this.closingConfirmationMode = 'native';
        this.closingConfirmationWebApp = webApp;
        return;
      } catch {
        // Fall through to beforeunload when a partial or broken bridge is injected.
      }
    }

    if (typeof this.host?.addEventListener === 'function') {
      try {
        this.host.addEventListener('beforeunload', this.beforeUnloadListener);
        this.closingConfirmationMode = 'browser';
      } catch {
        // A fallback must remain safe in restricted browser contexts.
      }
    }
  }

  disableClosingConfirmation(): void {
    const webApp = this.closingConfirmationWebApp ?? this.getWebApp();

    if (this.closingConfirmationMode === 'native') {
      try {
        webApp?.disableClosingConfirmation();
      } catch {
        // Disabling confirmation should never break navigation.
      }
    }

    if (this.closingConfirmationMode === 'browser') {
      try {
        this.host?.removeEventListener?.('beforeunload', this.beforeUnloadListener);
      } catch {
        // Removing a fallback listener is best-effort.
      }
    }

    this.closingConfirmationMode = undefined;
    this.closingConfirmationWebApp = undefined;
  }

  async requestContact(): Promise<MaxContactData> {
    const webApp = this.getWebApp();
    if (typeof webApp?.requestContact !== 'function') {
      throw new MaxBridgeError(
        'bridge_unavailable',
        'MAX contact sharing is unavailable outside the MAX client',
      );
    }

    try {
      const contact: unknown = await webApp.requestContact();
      if (!isMaxContactData(contact)) {
        throw new MaxBridgeError(
          'invalid_contact_response',
          'MAX Bridge returned malformed contact data',
        );
      }

      return contact;
    } catch (error) {
      if (error instanceof MaxBridgeError) {
        throw error;
      }

      throw new MaxBridgeError(
        getBridgeErrorCode(error) ?? 'contact_request_failed',
        'MAX contact request failed',
        { cause: error },
      );
    }
  }

  openLink(value: string): boolean {
    return this.open(normalizeUrl(value, false), 'openLink');
  }

  openMaxLink(value: string): boolean {
    return this.open(normalizeUrl(value, true), 'openMaxLink');
  }

  private getWebApp(): MaxWebAppBridge | undefined {
    try {
      return this.host?.WebApp;
    } catch {
      return undefined;
    }
  }

  private getThemeMediaQuery(): MediaQueryListLike | undefined {
    try {
      return this.host?.matchMedia?.(DARK_THEME_MEDIA_QUERY);
    } catch {
      return undefined;
    }
  }

  private getBrowserViewportSize(): MaxViewportSize {
    const documentElement = this.host?.document?.documentElement;
    const width =
      toPositiveDimension(this.host?.innerWidth) ??
      toPositiveDimension(documentElement?.clientWidth) ??
      0;
    const height =
      toPositiveDimension(this.host?.innerHeight) ??
      toPositiveDimension(documentElement?.clientHeight) ??
      0;

    return { width, height };
  }

  private isBackButtonVisible(): boolean {
    try {
      return this.getWebApp()?.BackButton?.isVisible === true;
    } catch {
      return false;
    }
  }

  private showBackButton(): void {
    try {
      this.getWebApp()?.BackButton?.show();
    } catch {
      // Browser fallback is intentionally a no-op.
    }
  }

  private hideBackButton(): void {
    try {
      this.getWebApp()?.BackButton?.hide();
    } catch {
      // Browser fallback is intentionally a no-op.
    }
  }

  private subscribeBackButton(callback: () => void): Unsubscribe {
    const backButton = this.getWebApp()?.BackButton;
    if (typeof backButton?.onClick === 'function') {
      try {
        backButton.onClick(callback);
        return createIdempotentUnsubscribe(() => {
          try {
            backButton.offClick(callback);
          } catch {
            // Unsubscription is best-effort for a partially injected bridge.
          }
        });
      } catch {
        // Fall through to browser history navigation.
      }
    }

    if (typeof this.host?.addEventListener !== 'function') {
      return noop;
    }

    const listener: BrowserEventListener = () => {
      callback();
    };

    try {
      this.host.addEventListener('popstate', listener);
      return createIdempotentUnsubscribe(() => {
        this.host?.removeEventListener?.('popstate', listener);
      });
    } catch {
      return noop;
    }
  }

  private open(url: string, method: 'openLink' | 'openMaxLink'): boolean {
    const webApp = this.getWebApp();
    try {
      if (method === 'openLink' && typeof webApp?.openLink === 'function') {
        webApp.openLink(url);
        return true;
      }

      if (method === 'openMaxLink' && typeof webApp?.openMaxLink === 'function') {
        webApp.openMaxLink(url);
        return true;
      }
    } catch {
      // Use a secure browser tab when the native bridge rejects the call.
    }

    if (typeof this.host?.open !== 'function') {
      return false;
    }

    try {
      const openedWindow = this.host.open(url, '_blank', 'noopener,noreferrer');
      if (openedWindow === null) {
        return false;
      }

      openedWindow.opener = null;
      return true;
    } catch {
      return false;
    }
  }
}

export function createMaxBridge(
  ...args: [] | [host: MaxBridgeWindow | undefined]
): MaxBridgeAdapter {
  return new MaxBridgeAdapterImpl(args.length === 0 ? getDefaultWindow() : args[0]);
}

export const maxBridge: MaxBridgeAdapter = createMaxBridge();
