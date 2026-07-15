import { CaseCatalogItemSchema } from '@craft72/contracts/source';
import { describe, expect, it } from 'vitest';

import {
  CASE_PORTFOLIO_ASSETS,
  MOCK_CASE_CATALOG,
  filterCaseCatalog,
  getCasePortfolioAsset,
  getCaseCatalogPage,
  rankCaseCatalog,
  rankCasesForLead,
} from './case-catalog.js';

describe('curated mock case catalog', () => {
  it('is deterministic and contract-valid', () => {
    expect(CaseCatalogItemSchema.array().safeParse(MOCK_CASE_CATALOG).success).toBe(true);
    expect(MOCK_CASE_CATALOG.map((item) => item.id)).toEqual([
      'businesshouse',
      'sportscentertsimlyanskoe',
      'childcenter',
      'citypumpingstation',
      'gagarinsky',
      'zemstvoschool',
      'industrialpark',
      'masterplan',
    ]);
    expect(Object.keys(CASE_PORTFOLIO_ASSETS)).toHaveLength(MOCK_CASE_CATALOG.length);

    for (const item of MOCK_CASE_CATALOG) {
      const asset = getCasePortfolioAsset(item.id);
      expect(asset?.path).toMatch(/^\/portfolio\/[a-z0-9-]+\.jpg$/);
      expect(asset?.sourceUrl).toBe(item.image);
      expect(item.url).toMatch(/^https:\/\/craft72\.ru\/[a-z0-9]+$/);
    }
  });

  it('combines all catalog filters and normalizes Russian locations', () => {
    const filtered = filterCaseCatalog(MOCK_CASE_CATALOG, {
      objectType: 'public-building',
      service: 'restoration',
      city: '  тобольск ',
      region: 'ТЮМЕНСКАЯ ОБЛАСТЬ',
      constructionKind: 'cultural-heritage',
      scale: 'single-object',
    });

    expect(filtered.map((item) => item.id)).toEqual(['citypumpingstation']);
  });

  it('paginates the filtered result with stable cursors', () => {
    const first = getCaseCatalogPage({ city: 'Тобольск', limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBe('offset_2');

    if (first.nextCursor === null) {
      throw new Error('Expected a second page');
    }

    const second = getCaseCatalogPage({
      city: 'Тобольск',
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.items.map((item) => item.id)).toEqual(['masterplan']);
    expect(second.nextCursor).toBeNull();
    expect(() => getCaseCatalogPage({ cursor: 'unknown_cursor' })).toThrow(RangeError);
  });

  it('ranks by weighted relevance and keeps catalog order for equal scores', () => {
    const first = rankCaseCatalog({
      services: ['restoration'],
      city: 'Тобольск',
      constructionKind: 'cultural-heritage',
    });
    const second = rankCaseCatalog({
      services: ['restoration'],
      city: 'Тобольск',
      constructionKind: 'cultural-heritage',
    });

    expect(first).toEqual(second);
    expect(first[0]?.item.id).toBe('citypumpingstation');
    expect(first[0]?.reasons).toEqual(['service', 'city', 'construction-kind']);

    const duplicateService = rankCaseCatalog({ services: ['restoration', 'restoration'] });
    const uniqueService = rankCaseCatalog({ services: ['restoration'] });
    expect(duplicateService).toEqual(uniqueService);

    const tied = rankCaseCatalog({ objectType: 'public-building' });
    expect(tied.map((match) => match.item.id)).toEqual([
      'sportscentertsimlyanskoe',
      'childcenter',
      'citypumpingstation',
      'zemstvoschool',
    ]);
  });

  it('maps a lead draft to at most three relevant cases', () => {
    const matched = rankCasesForLead({
      objectType: 'cultural-heritage',
      location: { city: 'Тобольск' },
      scope: { kind: 'single_object' },
      currentStage: 'reconstruction',
      services: ['restoration', 'expertise-support'],
      culturalHeritageSite: 'yes',
    });

    expect(matched.length).toBeGreaterThanOrEqual(1);
    expect(matched).toHaveLength(3);
    expect(matched[0]?.id).toBe('citypumpingstation');
    expect(new Set(matched.map((item) => item.id)).size).toBe(matched.length);
  });
});
