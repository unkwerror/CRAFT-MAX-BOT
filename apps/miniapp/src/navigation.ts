import type { StartParam } from '@craft72/contracts/source';

export const APP_ROUTES = [
  'home',
  'finder',
  'brief',
  'cases',
  'upload',
  'summary',
  'success',
  'privacy',
  'admin',
] as const;

export type AppRoute = (typeof APP_ROUTES)[number];

const hashRouteSet = new Set<string>(APP_ROUTES.filter((route) => route !== 'admin'));

export const getRouteFromHash = (hash: string): AppRoute => {
  const route = hash.replace(/^#\/?/, '').split('?')[0];
  return route !== undefined && hashRouteSet.has(route) ? (route as AppRoute) : 'home';
};

export const routeHref = (route: AppRoute): string => `#${route}`;

export const getRouteFromStartParam = (startParam: StartParam | null): AppRoute => {
  switch (startParam) {
    case 'home':
      return 'home';
    case 'new_project':
      return 'brief';
    case 'services':
      return 'finder';
    case 'portfolio':
      return 'cases';
    case 'upload_brief':
      return 'upload';
    case 'admin':
      return 'admin';
    default:
      return 'home';
  }
};
