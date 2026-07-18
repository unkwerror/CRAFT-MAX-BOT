import { afterEach, describe, expect, it, vi } from 'vitest';

import { MOCK_CASE_CATALOG } from '../domain/case-catalog.js';
import { loadPublicExperience } from './public-experience.js';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const installFetch = (casesResponse: (path: string) => Response | Promise<Response>): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) => {
      const path = String(input);
      if (path.startsWith('/api/cases?')) return casesResponse(path);
      if (path === '/api/content/questionnaire-main') return jsonResponse({}, 404);
      throw new Error(`Unexpected request: ${path}`);
    }),
  );
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadPublicExperience', () => {
  it('keeps a successful empty case catalog instead of replacing it with mock cases', async () => {
    installFetch(() => jsonResponse({ items: [], nextCursor: null }));

    const experience = await loadPublicExperience(new AbortController().signal);

    expect(experience.cases).toEqual([]);
  });

  it('loads every published case cursor page', async () => {
    const paths: string[] = [];
    const secondItem = { ...MOCK_CASE_CATALOG[0], id: 'second-page-case' };
    installFetch((path) => {
      paths.push(path);
      return path.includes('cursor=next-page')
        ? jsonResponse({ items: [secondItem], nextCursor: null })
        : jsonResponse({ items: [MOCK_CASE_CATALOG[0]], nextCursor: 'next-page' });
    });

    const experience = await loadPublicExperience(new AbortController().signal);

    expect(experience.cases).toEqual([MOCK_CASE_CATALOG[0], secondItem]);
    expect(paths).toEqual(['/api/cases?limit=100', '/api/cases?limit=100&cursor=next-page']);
  });

  it.each([
    ['an invalid response', () => jsonResponse({ items: 'not-an-array', nextCursor: null })],
    ['a request error', () => Promise.reject(new Error('offline'))],
  ])('uses mock cases for %s', async (_scenario, casesResponse) => {
    installFetch(casesResponse);

    const experience = await loadPublicExperience(new AbortController().signal);

    expect(experience.cases).toEqual(MOCK_CASE_CATALOG);
  });
});
