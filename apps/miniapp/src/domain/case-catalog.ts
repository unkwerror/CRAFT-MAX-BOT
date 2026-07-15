import {
  CaseCatalogItemSchema,
  CaseCatalogQuerySchema,
  CaseCatalogResponseSchema,
  LeadDraftPayloadSchema,
  LeadFormDataSchema,
  type CaseCatalogItem,
  type CaseCatalogQuery,
  type CaseCatalogResponse,
  type CaseId,
  type LeadDraftPayload,
  type LeadFormData,
  type TaxonomyKey,
} from '@craft72/contracts/source';

export interface CasePortfolioAsset {
  readonly attribution?: string;
  readonly path: `/${string}`;
  readonly sourceUrl: `https://${string}`;
}

/**
 * Local copies of the 1680x945 project covers published by CRAFT GROUP.
 * `sourceUrl` keeps the original asset provenance next to the local path.
 */
export const CASE_PORTFOLIO_ASSETS: Readonly<Record<string, CasePortfolioAsset>> = Object.freeze({
  businesshouse: Object.freeze({
    path: '/portfolio/business-center-tyumen.jpg',
    sourceUrl: 'https://static.tildacdn.com/tild6165-3531-4166-a265-656533383936/_-94.jpg',
  }),
  sportscentertsimlyanskoe: Object.freeze({
    path: '/portfolio/sports-center-tsimlyanskoye.jpg',
    sourceUrl: 'https://static.tildacdn.com/tild6162-6234-4263-a333-303736326161/__-76.jpg',
  }),
  childcenter: Object.freeze({
    path: '/portfolio/children-leisure-center-tobolsk.jpg',
    sourceUrl: 'https://static.tildacdn.com/tild6137-3636-4936-b365-326232316539/__-74.jpg',
  }),
  citypumpingstation: Object.freeze({
    path: '/portfolio/city-pumping-station-tobolsk.jpg',
    sourceUrl: 'https://static.tildacdn.com/tild6164-3938-4934-b465-323764656430/__-82.jpg',
  }),
  gagarinsky: Object.freeze({
    path: '/portfolio/gagarinsky-residential-complex.jpg',
    sourceUrl: 'https://static.tildacdn.com/tild3262-3037-4934-b932-353130623935/__-92.jpg',
  }),
  zemstvoschool: Object.freeze({
    path: '/portfolio/zemstvo-school-yekaterinburg.jpg',
    sourceUrl: 'https://static.tildacdn.com/tild3166-3861-4130-a238-313364653238/__-90.jpg',
  }),
  industrialpark: Object.freeze({
    path: '/portfolio/industrial-park-tyumen.jpg',
    sourceUrl: 'https://static.tildacdn.com/tild3332-6236-4564-b261-663036663337/__1-90.jpg',
  }),
  masterplan: Object.freeze({
    attribution: 'Рендер предоставлен бюро WOWHAUS',
    path: '/portfolio/tobolsk-tourism-masterplan.jpg',
    sourceUrl: 'https://static.tildacdn.com/tild3930-3737-4466-a663-643430316238/__-27.jpg',
  }),
});

export function getCasePortfolioAsset(caseId: CaseId): CasePortfolioAsset | undefined {
  return CASE_PORTFOLIO_ASSETS[caseId];
}

const catalogFixtures = [
  {
    id: 'businesshouse',
    title: 'Бизнес-центр на Герцена',
    url: 'https://craft72.ru/businesshouse',
    image: CASE_PORTFOLIO_ASSETS.businesshouse?.sourceUrl ?? null,
    city: 'Тюмень',
    region: 'Тюменская область',
    categories: ['office', 'commercial'],
    services: ['urban-planning', 'architecture'],
    area: 42_000,
    scale: 'large-object',
    constructionKind: 'new-construction',
    status: 'Проект',
    tags: ['business-center', 'mixed-use'],
    published: true,
  },
  {
    id: 'sportscentertsimlyanskoe',
    title: 'Многофункциональный спортивный центр оз. Цимлянское',
    url: 'https://craft72.ru/sportscentertsimlyanskoe',
    image: CASE_PORTFOLIO_ASSETS.sportscentertsimlyanskoe?.sourceUrl ?? null,
    city: 'Тюмень',
    region: 'Тюменская область',
    categories: ['public-building', 'sports-infrastructure'],
    services: ['urban-planning', 'architecture', 'general-design'],
    area: 800_000,
    scale: 'territory',
    constructionKind: 'new-construction',
    status: 'Согласован',
    tags: ['sports', 'landscape'],
    published: true,
  },
  {
    id: 'childcenter',
    title: 'Детский досуговый центр',
    url: 'https://craft72.ru/childcenter',
    image: CASE_PORTFOLIO_ASSETS.childcenter?.sourceUrl ?? null,
    city: 'Тобольск',
    region: 'Тюменская область',
    categories: ['public-building', 'social-infrastructure'],
    services: ['architecture', 'general-design'],
    area: 1_450,
    scale: 'single-object',
    constructionKind: 'new-construction',
    status: 'Согласован',
    tags: ['family', 'public-space'],
    published: true,
  },
  {
    id: 'citypumpingstation',
    title: 'Ансамбль городской насосной станции',
    url: 'https://craft72.ru/citypumpingstation',
    image: CASE_PORTFOLIO_ASSETS.citypumpingstation?.sourceUrl ?? null,
    city: 'Тобольск',
    region: 'Тюменская область',
    categories: ['cultural-heritage', 'public-building'],
    services: ['restoration', 'architecture', 'general-design', 'expertise-support'],
    area: 3_500,
    scale: 'single-object',
    constructionKind: 'cultural-heritage',
    status: 'Проектная документация',
    tags: ['heritage', 'adaptation'],
    published: true,
  },
  {
    id: 'gagarinsky',
    title: 'Жилой комплекс «Гагаринский»',
    url: 'https://craft72.ru/gagarinsky',
    image: CASE_PORTFOLIO_ASSETS.gagarinsky?.sourceUrl ?? null,
    city: 'Тюмень',
    region: 'Тюменская область',
    categories: ['residential'],
    services: ['architecture'],
    area: 20_000,
    scale: 'large-object',
    constructionKind: 'new-construction',
    status: 'Согласовано',
    tags: ['residential', 'architectural-lighting'],
    published: true,
  },
  {
    id: 'zemstvoschool',
    title: 'Здание «Земской школы»',
    url: 'https://craft72.ru/zemstvoschool',
    image: CASE_PORTFOLIO_ASSETS.zemstvoschool?.sourceUrl ?? null,
    city: 'Екатеринбург',
    region: 'Свердловская область',
    categories: ['cultural-heritage', 'public-building'],
    services: ['restoration', 'architecture'],
    area: null,
    scale: 'single-object',
    constructionKind: 'cultural-heritage',
    status: 'Проект',
    tags: ['heritage', 'school'],
    published: true,
  },
  {
    id: 'industrialpark',
    title: 'Индустриальный парк',
    url: 'https://craft72.ru/industrialpark',
    image: CASE_PORTFOLIO_ASSETS.industrialpark?.sourceUrl ?? null,
    city: 'Тюмень',
    region: 'Тюменская область',
    categories: ['industrial'],
    services: ['urban-planning', 'architecture'],
    area: 48_000,
    scale: 'territory',
    constructionKind: 'new-construction',
    status: 'Согласовано',
    tags: ['industrial', 'masterplan'],
    published: true,
  },
  {
    id: 'masterplan',
    title: 'Мастер-план туристического каркаса города',
    url: 'https://craft72.ru/masterplan',
    image: CASE_PORTFOLIO_ASSETS.masterplan?.sourceUrl ?? null,
    city: 'Тобольск',
    region: 'Тюменская область',
    categories: ['hospitality', 'urban-development'],
    services: ['urban-planning', 'architecture'],
    area: null,
    scale: 'territory',
    constructionKind: 'new-construction',
    status: 'Согласование проекта',
    tags: ['masterplan', 'tourism'],
    published: true,
  },
] as const;

function freezeCase(item: CaseCatalogItem): CaseCatalogItem {
  Object.freeze(item.categories);
  Object.freeze(item.services);
  Object.freeze(item.tags);
  return Object.freeze(item);
}

/** Curated at build time. This module intentionally has no network or scraping path. */
export const MOCK_CASE_CATALOG: readonly CaseCatalogItem[] = Object.freeze(
  CaseCatalogItemSchema.array().parse(catalogFixtures).map(freezeCase),
);

function normalizeLocation(value: string): string {
  return value.trim().toLowerCase().replaceAll('ё', 'е').replace(/\s+/g, ' ');
}

function includesTaxonomy(values: readonly string[], expected: string | undefined): boolean {
  return expected === undefined || values.includes(expected);
}

export function filterCaseCatalog(
  items: readonly CaseCatalogItem[],
  input: CaseCatalogQuery,
): readonly CaseCatalogItem[] {
  const query = CaseCatalogQuerySchema.parse(input);

  return items.filter((item) => {
    return (
      includesTaxonomy(item.categories, query.objectType) &&
      includesTaxonomy(item.services, query.service) &&
      (query.region === undefined ||
        normalizeLocation(item.region) === normalizeLocation(query.region)) &&
      (query.city === undefined ||
        normalizeLocation(item.city) === normalizeLocation(query.city)) &&
      (query.scale === undefined || item.scale === query.scale) &&
      (query.constructionKind === undefined || item.constructionKind === query.constructionKind)
    );
  });
}

function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined) {
    return 0;
  }

  const match = /^offset_([1-9]\d*)$/.exec(cursor);
  if (match === null) {
    throw new RangeError('Unknown case catalog cursor');
  }

  const offset = Number(match[1]);
  if (!Number.isSafeInteger(offset)) {
    throw new RangeError('Case catalog cursor is outside the safe range');
  }

  return offset;
}

export function getCaseCatalogPage(
  input: CaseCatalogQuery = {},
  items: readonly CaseCatalogItem[] = MOCK_CASE_CATALOG,
): CaseCatalogResponse {
  const query = CaseCatalogQuerySchema.parse(input);
  const filtered = filterCaseCatalog(items, query);
  const offset = decodeCursor(query.cursor);
  const limit = query.limit ?? 12;
  const pageItems = filtered.slice(offset, offset + limit);
  const nextOffset = offset + pageItems.length;

  return CaseCatalogResponseSchema.parse({
    items: pageItems,
    nextCursor: nextOffset < filtered.length ? `offset_${nextOffset}` : null,
  });
}

export type CaseMatchReason =
  'object-type' | 'service' | 'city' | 'region' | 'scale' | 'construction-kind';

export interface CaseRankingCriteria {
  readonly objectType?: TaxonomyKey;
  readonly services?: readonly TaxonomyKey[];
  readonly city?: string;
  readonly region?: string;
  readonly scale?: TaxonomyKey;
  readonly constructionKind?: TaxonomyKey;
}

export interface RankedCase {
  readonly item: CaseCatalogItem;
  readonly score: number;
  readonly reasons: readonly CaseMatchReason[];
}

function scoreCase(item: CaseCatalogItem, criteria: CaseRankingCriteria): RankedCase {
  let score = 0;
  const reasons: CaseMatchReason[] = [];

  if (criteria.objectType !== undefined && item.categories.includes(criteria.objectType)) {
    score += 40;
    reasons.push('object-type');
  }

  const matchingServices = [...new Set(criteria.services ?? [])].filter((service) =>
    item.services.includes(service),
  );
  if (matchingServices.length > 0) {
    score += matchingServices.length * 50;
    reasons.push('service');
  }

  if (
    criteria.city !== undefined &&
    normalizeLocation(item.city) === normalizeLocation(criteria.city)
  ) {
    score += 25;
    reasons.push('city');
  }

  if (
    criteria.region !== undefined &&
    normalizeLocation(item.region) === normalizeLocation(criteria.region)
  ) {
    score += 15;
    reasons.push('region');
  }

  if (criteria.scale !== undefined && item.scale === criteria.scale) {
    score += 20;
    reasons.push('scale');
  }

  if (
    criteria.constructionKind !== undefined &&
    item.constructionKind === criteria.constructionKind
  ) {
    score += 30;
    reasons.push('construction-kind');
  }

  return { item, score, reasons };
}

export function rankCaseCatalog(
  criteria: CaseRankingCriteria,
  items: readonly CaseCatalogItem[] = MOCK_CASE_CATALOG,
): readonly RankedCase[] {
  return items
    .map((item, catalogIndex) => ({ ...scoreCase(item, criteria), catalogIndex }))
    .filter((match) => match.score > 0)
    .sort((left, right) => right.score - left.score || left.catalogIndex - right.catalogIndex)
    .map(({ catalogIndex: _catalogIndex, ...match }) => match);
}

type RankableLead = LeadDraftPayload | LeadFormData;

function leadScale(payload: RankableLead): TaxonomyKey | undefined {
  if (payload.scope?.kind === 'portfolio') {
    return 'portfolio';
  }

  return payload.scope?.kind === 'single_object' ? 'single-object' : undefined;
}

function leadConstructionKind(payload: RankableLead): TaxonomyKey | undefined {
  if (payload.culturalHeritageSite === 'yes') {
    return 'cultural-heritage';
  }

  return payload.currentStage === 'reconstruction' ? 'reconstruction' : undefined;
}

export function rankCasesForLead(
  input: RankableLead,
  maximumResults = 3,
  items: readonly CaseCatalogItem[] = MOCK_CASE_CATALOG,
): readonly CaseCatalogItem[] {
  if (!Number.isInteger(maximumResults) || maximumResults < 1 || maximumResults > 10) {
    throw new RangeError('maximumResults must be an integer from 1 to 10');
  }

  const fullLead = LeadFormDataSchema.safeParse(input);
  const payload: RankableLead = fullLead.success
    ? fullLead.data
    : LeadDraftPayloadSchema.parse(input);
  const scale = leadScale(payload);
  const constructionKind = leadConstructionKind(payload);
  const ranked = rankCaseCatalog(
    {
      ...(payload.objectType === undefined ? {} : { objectType: payload.objectType }),
      ...(payload.services === undefined ? {} : { services: payload.services }),
      ...(payload.location?.city === undefined ? {} : { city: payload.location.city }),
      ...(payload.location?.region === undefined ? {} : { region: payload.location.region }),
      ...(scale === undefined ? {} : { scale }),
      ...(constructionKind === undefined ? {} : { constructionKind }),
    },
    items,
  );

  return ranked.slice(0, maximumResults).map((match) => match.item);
}
