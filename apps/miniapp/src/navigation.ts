export const APP_ROUTES = [
  'home',
  'finder',
  'brief',
  'cases',
  'upload',
  'summary',
  'success',
  'privacy',
] as const;

export type AppRoute = (typeof APP_ROUTES)[number];

const routeSet = new Set<string>(APP_ROUTES);

export const getRouteFromHash = (hash: string): AppRoute => {
  const route = hash.replace(/^#\/?/, '').split('?')[0];
  return route !== undefined && routeSet.has(route) ? (route as AppRoute) : 'home';
};

export const routeHref = (route: AppRoute): string => `#${route}`;
