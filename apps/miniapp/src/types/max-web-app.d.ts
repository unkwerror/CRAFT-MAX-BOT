import type { MaxWebAppBridge } from '../platform/types.js';

declare global {
  interface Window {
    WebApp?: MaxWebAppBridge;
  }
}

export {};
