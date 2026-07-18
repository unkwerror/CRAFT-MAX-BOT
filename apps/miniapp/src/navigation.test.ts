import { describe, expect, it } from 'vitest';

import { getRouteFromHash, getRouteFromStartParam } from './navigation.js';

describe('authenticated MAX start parameter routing', () => {
  it.each([
    ['home', 'home'],
    ['new_project', 'brief'],
    ['services', 'finder'],
    ['portfolio', 'cases'],
    ['upload_brief', 'upload'],
    ['admin', 'admin'],
  ] as const)('maps %s to %s', (startParam, expectedRoute) => {
    expect(getRouteFromStartParam(startParam)).toBe(expectedRoute);
  });

  it('keeps direct and campaign launches on the home screen', () => {
    expect(getRouteFromStartParam(null)).toBe('home');
    expect(getRouteFromStartParam('source_summer_2026')).toBe('home');
  });
});

describe('browser hash routing', () => {
  it('does not expose the admin panel through a direct hash', () => {
    expect(getRouteFromHash('#admin')).toBe('home');
    expect(getRouteFromHash('#/admin')).toBe('home');
    expect(getRouteFromHash('#admin?source=direct')).toBe('home');
  });

  it('keeps public hash routes available', () => {
    expect(getRouteFromHash('#brief')).toBe('brief');
    expect(getRouteFromHash('#/cases')).toBe('cases');
  });
});
