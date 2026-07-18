import { describe, expect, it } from 'vitest';

import { getRouteFromStartParam } from './navigation.js';

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
