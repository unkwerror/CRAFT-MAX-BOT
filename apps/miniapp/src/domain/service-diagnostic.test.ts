import { describe, expect, it } from 'vitest';

import { diagnoseServices } from './service-diagnostic.js';

describe('service diagnostic', () => {
  it('returns one to three deterministic directions for a complex brief', () => {
    const input = {
      objectType: 'cultural-heritage',
      currentStage: 'concept',
      desiredResult: 'project-documentation',
      expertiseRequired: 'yes',
      culturalHeritageSite: 'yes',
      scope: { kind: 'portfolio', objectCount: 4 },
    } as const;

    const first = diagnoseServices(input);
    const second = diagnoseServices(input);

    expect(first).toEqual(second);
    expect(first).toHaveLength(3);
    expect(first.map((item) => item.service)).toEqual([
      'restoration',
      'expertise-support',
      'general-design',
    ]);
  });

  it('always has a useful fallback without inventing commercial estimates', () => {
    const result = diagnoseServices({
      objectType: 'other-object',
      currentStage: 'unknown-stage',
      desiredResult: 'consultation',
      expertiseRequired: 'no',
      culturalHeritageSite: 'no',
      scope: { kind: 'single_object' },
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.service).toBe('general-design');
    for (const recommendation of result) {
      expect(Object.keys(recommendation)).toEqual(['service', 'title', 'explanation']);
      expect(recommendation).not.toHaveProperty('price');
      expect(recommendation).not.toHaveProperty('duration');
      expect(recommendation).not.toHaveProperty('deadline');
    }
  });

  it('uses contract taxonomy validation at its boundary', () => {
    expect(() =>
      diagnoseServices({
        objectType: 'Office Building',
        currentStage: 'concept',
        desiredResult: 'architecture',
        expertiseRequired: 'unknown',
        culturalHeritageSite: 'unknown',
        scope: { kind: 'single_object' },
      }),
    ).toThrow();
  });
});
