import { CaseCatalogItemSchema } from '@craft72/contracts/source';
import { describe, expect, it } from 'vitest';

import {
  MOCK_CASE_CATALOG,
  filterCaseCatalog,
  getCaseCatalogPage,
  rankCaseCatalog,
  rankCasesForLead,
} from './case-catalog.js';

describe('curated mock case catalog', () => {
  it('is deterministic and contract-valid', () => {
    expect(CaseCatalogItemSchema.array().safeParse(MOCK_CASE_CATALOG).success).toBe(true);
    expect(MOCK_CASE_CATALOG.map((item) => item.id)).toEqual([
      'tyumen-heritage-quarter',
      'tyumen-residential-reconstruction',
      'tobolsk-school-campus',
      'surgut-industrial-complex',
      'ural-retail-portfolio',
      'novosibirsk-business-center',
      'omsk-clinic-modernization',
      'tyumen-riverfront-masterplan',
    ]);
  });

  it('combines all catalog filters and normalizes Russian locations', () => {
    const filtered = filterCaseCatalog(MOCK_CASE_CATALOG, {
      objectType: 'public-building',
      service: 'restoration',
      city: '  тюмень ',
      region: 'ТЮМЕНСКАЯ ОБЛАСТЬ',
      constructionKind: 'cultural-heritage',
      scale: 'large-object',
    });

    expect(filtered.map((item) => item.id)).toEqual(['tyumen-heritage-quarter']);
  });

  it('paginates the filtered result with stable cursors', () => {
    const first = getCaseCatalogPage({ region: 'Тюменская область', limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBe('offset_2');

    if (first.nextCursor === null) {
      throw new Error('Expected a second page');
    }

    const second = getCaseCatalogPage({
      region: 'Тюменская область',
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.items.map((item) => item.id)).toEqual([
      'tobolsk-school-campus',
      'tyumen-riverfront-masterplan',
    ]);
    expect(second.nextCursor).toBeNull();
    expect(() => getCaseCatalogPage({ cursor: 'unknown_cursor' })).toThrow(RangeError);
  });

  it('ranks by weighted relevance and keeps catalog order for equal scores', () => {
    const first = rankCaseCatalog({
      services: ['restoration'],
      city: 'Тюмень',
      constructionKind: 'cultural-heritage',
    });
    const second = rankCaseCatalog({
      services: ['restoration'],
      city: 'Тюмень',
      constructionKind: 'cultural-heritage',
    });

    expect(first).toEqual(second);
    expect(first[0]?.item.id).toBe('tyumen-heritage-quarter');
    expect(first[0]?.reasons).toEqual(['service', 'city', 'construction-kind']);

    const duplicateService = rankCaseCatalog({ services: ['restoration', 'restoration'] });
    const uniqueService = rankCaseCatalog({ services: ['restoration'] });
    expect(duplicateService).toEqual(uniqueService);

    const tied = rankCaseCatalog({ objectType: 'public-building' });
    expect(tied.map((match) => match.item.id)).toEqual([
      'tyumen-heritage-quarter',
      'tobolsk-school-campus',
      'omsk-clinic-modernization',
    ]);
  });

  it('maps a lead draft to at most three relevant cases', () => {
    const matched = rankCasesForLead({
      objectType: 'cultural-heritage',
      location: { city: 'Тюмень' },
      scope: { kind: 'single_object' },
      currentStage: 'reconstruction',
      services: ['restoration', 'expertise-support'],
      culturalHeritageSite: 'yes',
    });

    expect(matched.length).toBeGreaterThanOrEqual(1);
    expect(matched).toHaveLength(3);
    expect(matched[0]?.id).toBe('tyumen-heritage-quarter');
    expect(new Set(matched.map((item) => item.id)).size).toBe(matched.length);
  });
});
