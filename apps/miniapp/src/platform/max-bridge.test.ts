import { describe, expect, it, vi } from 'vitest';

import { createMaxBridge } from './max-bridge.js';
import type {
  BrowserEventListener,
  MaxBridgeWindow,
  MaxContactData,
  MaxWebAppBackButton,
  MaxWebAppBridge,
  MediaQueryChangeListener,
  MediaQueryListLike,
} from './types.js';

const CONTACT: MaxContactData = {
  phone: '+79991234567',
  authDate: '1784102400',
  hash: 'a'.repeat(64),
};

function createBackButton(overrides: Partial<MaxWebAppBackButton> = {}): MaxWebAppBackButton {
  return {
    isVisible: false,
    show: vi.fn(),
    hide: vi.fn(),
    onClick: vi.fn(),
    offClick: vi.fn(),
    ...overrides,
  };
}

function createWebApp(overrides: Partial<MaxWebAppBridge> = {}): MaxWebAppBridge {
  return {
    initData: 'query_id=q1&auth_date=1784102400&hash=signed',
    initDataUnsafe: {},
    platform: 'android',
    version: '26.2.8',
    BackButton: createBackButton(),
    getViewportSize: async () => ({ width: '390', height: '844' }),
    enableClosingConfirmation: vi.fn(),
    disableClosingConfirmation: vi.fn(),
    requestContact: async () => CONTACT,
    openLink: vi.fn(),
    openMaxLink: vi.fn(),
    ...overrides,
  };
}

describe('MAX Bridge adapter', () => {
  it('is safe in SSR or a browser without MAX Bridge', async () => {
    const bridge = createMaxBridge(undefined);
    const unsubscribe = bridge.backButton.subscribe(vi.fn());

    expect(bridge.isAvailable()).toBe(false);
    expect(bridge.getPlatform()).toBe('web');
    expect(bridge.getTheme()).toBe('light');
    await expect(bridge.getViewportSize()).resolves.toEqual({ width: 0, height: 0 });
    expect(bridge.backButton.isVisible()).toBe(false);
    expect(() => bridge.backButton.show()).not.toThrow();
    expect(() => bridge.backButton.hide()).not.toThrow();
    expect(() => bridge.enableClosingConfirmation()).not.toThrow();
    expect(() => bridge.disableClosingConfirmation()).not.toThrow();
    expect(bridge.openLink('https://craft72.ru/')).toBe(false);
    expect(() => unsubscribe()).not.toThrow();

    await expect(bridge.requestContact()).rejects.toMatchObject({
      name: 'MaxBridgeError',
      code: 'bridge_unavailable',
    });
  });

  it('reads the documented MAX platform and viewport', async () => {
    const webApp = createWebApp({
      platform: 'ios',
      getViewportSize: async () => ({ width: '393.5px', height: '852' }),
    });
    const bridge = createMaxBridge({ WebApp: webApp });

    expect(bridge.isAvailable()).toBe(true);
    expect(bridge.getPlatform()).toBe('ios');
    await expect(bridge.getViewportSize()).resolves.toEqual({ width: 393.5, height: 852 });
  });

  it('falls back to browser viewport when the native call fails or is malformed', async () => {
    const rejectingBridge = createMaxBridge({
      WebApp: createWebApp({
        getViewportSize: async () => {
          throw new Error('bridge unavailable');
        },
      }),
      innerWidth: 1_024,
      innerHeight: 768,
    });

    await expect(rejectingBridge.getViewportSize()).resolves.toEqual({
      width: 1_024,
      height: 768,
    });

    const malformedBridge = createMaxBridge({
      WebApp: createWebApp({
        getViewportSize: async () => ({ width: 'invalid', height: '-1' }),
      }),
      document: { documentElement: { clientWidth: 320, clientHeight: 640 } },
    });

    await expect(malformedBridge.getViewportSize()).resolves.toEqual({
      width: 320,
      height: 640,
    });
  });

  it('subscribes and unsubscribes the same native BackButton callback once', () => {
    let registeredCallback: (() => void) | undefined;
    const show = vi.fn();
    const hide = vi.fn();
    const onClick = vi.fn((callback: () => void) => {
      registeredCallback = callback;
    });
    const offClick = vi.fn();
    const backButton = createBackButton({ isVisible: true, show, hide, onClick, offClick });
    const bridge = createMaxBridge({ WebApp: createWebApp({ BackButton: backButton }) });
    const callback = vi.fn();

    const unsubscribe = bridge.backButton.subscribe(callback);
    registeredCallback?.();
    bridge.backButton.show();
    bridge.backButton.hide();
    unsubscribe();
    unsubscribe();

    expect(callback).toHaveBeenCalledOnce();
    expect(onClick).toHaveBeenCalledWith(callback);
    expect(offClick).toHaveBeenCalledOnce();
    expect(offClick).toHaveBeenCalledWith(callback);
    expect(show).toHaveBeenCalledOnce();
    expect(hide).toHaveBeenCalledOnce();
    expect(bridge.backButton.isVisible()).toBe(true);
  });

  it('uses popstate as the browser BackButton fallback', () => {
    const listeners = new Map<string, BrowserEventListener>();
    const addEventListener = vi.fn((type: string, listener: BrowserEventListener) => {
      listeners.set(type, listener);
    });
    const removeEventListener = vi.fn((type: string, listener: BrowserEventListener) => {
      if (listeners.get(type) === listener) {
        listeners.delete(type);
      }
    });
    const bridge = createMaxBridge({ addEventListener, removeEventListener });
    const callback = vi.fn();

    const unsubscribe = bridge.backButton.subscribe(callback);
    listeners.get('popstate')?.({});
    unsubscribe();
    unsubscribe();

    expect(callback).toHaveBeenCalledOnce();
    expect(addEventListener).toHaveBeenCalledWith('popstate', expect.any(Function));
    expect(removeEventListener).toHaveBeenCalledOnce();
  });

  it('uses native closing confirmation idempotently', () => {
    const enableClosingConfirmation = vi.fn();
    const disableClosingConfirmation = vi.fn();
    const bridge = createMaxBridge({
      WebApp: createWebApp({ enableClosingConfirmation, disableClosingConfirmation }),
    });

    bridge.enableClosingConfirmation();
    bridge.enableClosingConfirmation();
    bridge.disableClosingConfirmation();
    bridge.disableClosingConfirmation();

    expect(enableClosingConfirmation).toHaveBeenCalledOnce();
    expect(disableClosingConfirmation).toHaveBeenCalledOnce();
  });

  it('uses beforeunload as closing confirmation in a browser', () => {
    const listeners = new Map<string, BrowserEventListener>();
    const addEventListener = vi.fn((type: string, listener: BrowserEventListener) => {
      listeners.set(type, listener);
    });
    const removeEventListener = vi.fn((type: string, listener: BrowserEventListener) => {
      if (listeners.get(type) === listener) {
        listeners.delete(type);
      }
    });
    const bridge = createMaxBridge({ addEventListener, removeEventListener });

    bridge.enableClosingConfirmation();
    bridge.enableClosingConfirmation();
    const preventDefault = vi.fn();
    const event = { preventDefault, returnValue: true };
    listeners.get('beforeunload')?.(event);
    bridge.disableClosingConfirmation();

    expect(addEventListener).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(event.returnValue).toBe('');
    expect(removeEventListener).toHaveBeenCalledOnce();
  });

  it('reads and subscribes to browser color scheme', () => {
    let themeListener: MediaQueryChangeListener | undefined;
    const mediaQuery: MediaQueryListLike = {
      matches: true,
      addEventListener: vi.fn((_type, listener) => {
        themeListener = listener;
      }),
      removeEventListener: vi.fn(),
    };
    const host: MaxBridgeWindow = {
      matchMedia: vi.fn(() => mediaQuery),
    };
    const bridge = createMaxBridge(host);
    const callback = vi.fn();

    expect(bridge.getTheme()).toBe('dark');
    const unsubscribe = bridge.subscribeTheme(callback);
    themeListener?.({ matches: false });
    unsubscribe();
    unsubscribe();

    expect(callback).toHaveBeenCalledWith('light');
    expect(mediaQuery.removeEventListener).toHaveBeenCalledOnce();
  });

  it('returns verified contact proof and rejects malformed Bridge data', async () => {
    const bridge = createMaxBridge({ WebApp: createWebApp() });
    await expect(bridge.requestContact()).resolves.toEqual(CONTACT);

    const malformedContact = {
      phone: 'not-a-phone',
      authDate: 'yesterday',
      hash: 'invalid',
    } as MaxContactData;
    const malformedBridge = createMaxBridge({
      WebApp: createWebApp({ requestContact: async () => malformedContact }),
    });

    await expect(malformedBridge.requestContact()).rejects.toMatchObject({
      code: 'invalid_contact_response',
    });
  });

  it('preserves the documented MAX contact refusal code', async () => {
    const errorCode = 'client.request_phone.user_refused_provide_phone_number';
    const bridge = createMaxBridge({
      WebApp: createWebApp({
        requestContact: async () => {
          throw { error: { code: errorCode } };
        },
      }),
    });

    await expect(bridge.requestContact()).rejects.toMatchObject({
      code: errorCode,
      name: 'MaxBridgeError',
    });
  });

  it('opens only safe links through the native Bridge', () => {
    const openLink = vi.fn();
    const openMaxLink = vi.fn();
    const bridge = createMaxBridge({ WebApp: createWebApp({ openLink, openMaxLink }) });

    expect(bridge.openLink('https://craft72.ru/policy')).toBe(true);
    expect(bridge.openMaxLink('https://max.ru/craft72?startapp=new_project')).toBe(true);
    expect(openLink).toHaveBeenCalledWith('https://craft72.ru/policy');
    expect(openMaxLink).toHaveBeenCalledWith('https://max.ru/craft72?startapp=new_project');
    expect(() => bridge.openLink('javascript:alert(1)')).toThrow(TypeError);
    expect(() => bridge.openLink('http://craft72.ru/')).toThrow(TypeError);
    expect(() => bridge.openMaxLink('https://max.ru.evil.example/craft72')).toThrow(TypeError);
  });

  it('opens a secure, detached browser tab as a link fallback', () => {
    const openedWindow = { opener: { unsafe: true } };
    const open = vi.fn(() => openedWindow);
    const bridge = createMaxBridge({ open });

    expect(bridge.openLink('https://craft72.ru/')).toBe(true);
    expect(open).toHaveBeenCalledWith('https://craft72.ru/', '_blank', 'noopener,noreferrer');
    expect(openedWindow.opener).toBeNull();

    const blockedBridge = createMaxBridge({ open: vi.fn(() => null) });
    expect(blockedBridge.openLink('https://craft72.ru/')).toBe(false);
  });
});
