import {
  CaseCatalogResponseSchema,
  PublicContentResponseSchema,
  type CaseCatalogItem,
} from '@craft72/contracts/source';

import {
  DEFAULT_QUESTIONNAIRE_CONTENT,
  normalizeQuestionnaireContent,
  type QuestionnaireContent,
} from '../admin/questionnaire-content.js';
import { MOCK_CASE_CATALOG } from '../domain/case-catalog.js';

const fetchJson = async (path: string, signal: AbortSignal): Promise<unknown> => {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
    signal,
  });
  if (!response.ok || !(response.headers.get('content-type') ?? '').includes('application/json')) {
    throw new Error('Public content is unavailable');
  }
  return response.json();
};

const fetchPublishedCases = async (signal: AbortSignal): Promise<readonly CaseCatalogItem[]> => {
  const items = new Map<string, CaseCatalogItem>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  while (true) {
    const query = new URLSearchParams({ limit: '100' });
    if (cursor !== undefined) query.set('cursor', cursor);
    const page = CaseCatalogResponseSchema.safeParse(
      await fetchJson(`/api/cases?${query.toString()}`, signal),
    );
    if (!page.success) throw new Error('Public cases response is invalid');
    for (const item of page.data.items) items.set(item.id, item);
    if (page.data.nextCursor === null) return [...items.values()];
    if (seenCursors.has(page.data.nextCursor)) throw new Error('Public cases cursor repeated');
    seenCursors.add(page.data.nextCursor);
    cursor = page.data.nextCursor;
  }
};

export interface PublicExperience {
  readonly cases: readonly CaseCatalogItem[];
  readonly questionnaire: QuestionnaireContent;
}

/** Loads published admin content without making the Mini App depend on its availability. */
export const loadPublicExperience = async (signal: AbortSignal): Promise<PublicExperience> => {
  const [casesResult, questionnaireResult] = await Promise.allSettled([
    fetchPublishedCases(signal),
    fetchJson('/api/content/questionnaire-main', signal),
  ]);

  const parsedQuestionnaire =
    questionnaireResult.status === 'fulfilled'
      ? PublicContentResponseSchema.safeParse(questionnaireResult.value)
      : { success: false as const };

  return {
    cases: casesResult.status === 'fulfilled' ? casesResult.value : MOCK_CASE_CATALOG,
    questionnaire: parsedQuestionnaire.success
      ? normalizeQuestionnaireContent(parsedQuestionnaire.data.content)
      : DEFAULT_QUESTIONNAIRE_CONTENT,
  };
};
