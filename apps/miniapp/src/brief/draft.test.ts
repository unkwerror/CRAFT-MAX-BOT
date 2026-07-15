import type { LeadDraftFormState } from '@craft72/contracts/source';
import { describe, expect, it } from 'vitest';

import {
  createEmptyDraft,
  toFinalLeadForm,
  toggleDraftSelection,
  validateBriefStep,
} from './draft.js';

const completeDraft: LeadDraftFormState = {
  ...createEmptyDraft(),
  role: 'developer',
  fullName: 'Иван Петров',
  organization: 'ООО Проект',
  inn: null,
  objectType: 'residential',
  location: { city: 'Тюмень' },
  scope: { kind: 'single_object' },
  area: { status: 'unknown' },
  currentStage: 'concept',
  services: ['architecture'],
  expertiseRequired: 'unknown',
  culturalHeritageSite: 'no',
  desiredStart: { status: 'unknown' },
  description: 'Новый жилой проект',
  links: [],
  documentIds: [],
  selectedCaseIds: [],
  contact: { phone: '+79990000000', email: 'hello@example.com' },
  consent: { version: 'mock-v1-not-for-production', accepted: true },
};

describe('brief draft helpers', () => {
  it('keeps raw portfolio input while validating the completed step', () => {
    const draft = { ...createEmptyDraft(), scope: { kind: 'portfolio', objectCount: '1' } };
    expect(validateBriefStep(6, draft)).toHaveProperty('objectCount');
    expect(draft.scope.objectCount).toBe('1');
  });

  it('converts a completed raw draft into the strict submission payload', () => {
    const payload = toFinalLeadForm(completeDraft);
    expect(payload.fullName).toBe('Иван Петров');
    expect(payload.area).toEqual({ status: 'unknown' });
  });

  it('toggles selections deterministically without exceeding the limit', () => {
    expect(toggleDraftSelection(['a'], 'b', 2)).toEqual(['a', 'b']);
    expect(toggleDraftSelection(['a', 'b'], 'c', 2)).toEqual(['a', 'b']);
    expect(toggleDraftSelection(['a', 'b'], 'a', 2)).toEqual(['b']);
  });
});
