import {
  CaseCatalogItemSchema,
  CaseCatalogQuerySchema,
  CaseCatalogResponseSchema,
  LeadDraftPayloadSchema,
  LeadFormDataSchema,
  type CaseCatalogItem,
  type CaseCatalogQuery,
  type CaseCatalogResponse,
  type LeadDraftPayload,
  type LeadFormData,
  type TaxonomyKey,
} from '@craft72/contracts/source';

const catalogFixtures = [
  {
    id: 'tyumen-heritage-quarter',
    title: 'Реставрация исторического квартала в Тюмени',
    url: 'https://craft72.ru/projects/tyumen-heritage-quarter',
    image: null,
    city: 'Тюмень',
    region: 'Тюменская область',
    categories: ['cultural-heritage', 'public-building'],
    services: ['restoration', 'architecture', 'general-design', 'expertise-support'],
    area: 18_400,
    scale: 'large-object',
    constructionKind: 'cultural-heritage',
    status: 'Реализован',
    tags: ['heritage', 'city-center'],
    published: true,
  },
  {
    id: 'tyumen-residential-reconstruction',
    title: 'Реконструкция жилого комплекса',
    url: 'https://craft72.ru/projects/tyumen-residential-reconstruction',
    image: null,
    city: 'Тюмень',
    region: 'Тюменская область',
    categories: ['residential'],
    services: ['architecture', 'general-design', 'engineering-surveys'],
    area: 42_000,
    scale: 'large-object',
    constructionKind: 'reconstruction',
    status: 'В строительстве',
    tags: ['housing', 'redevelopment'],
    published: true,
  },
  {
    id: 'tobolsk-school-campus',
    title: 'Образовательный кампус в Тобольске',
    url: 'https://craft72.ru/projects/tobolsk-school-campus',
    image: null,
    city: 'Тобольск',
    region: 'Тюменская область',
    categories: ['education', 'public-building'],
    services: ['architecture', 'general-design', 'expertise-support'],
    area: 27_500,
    scale: 'large-object',
    constructionKind: 'new-construction',
    status: 'Проектирование завершено',
    tags: ['education', 'campus'],
    published: true,
  },
  {
    id: 'surgut-industrial-complex',
    title: 'Производственно-логистический комплекс',
    url: 'https://craft72.ru/projects/surgut-industrial-complex',
    image: null,
    city: 'Сургут',
    region: 'Ханты-Мансийский автономный округ — Югра',
    categories: ['industrial', 'logistics'],
    services: ['engineering-surveys', 'general-design', 'expertise-support'],
    area: 63_000,
    scale: 'large-object',
    constructionKind: 'new-construction',
    status: 'Реализован',
    tags: ['industrial', 'logistics'],
    published: true,
  },
  {
    id: 'ural-retail-portfolio',
    title: 'Портфель реконструкции торговых объектов',
    url: 'https://craft72.ru/projects/ural-retail-portfolio',
    image: null,
    city: 'Екатеринбург',
    region: 'Свердловская область',
    categories: ['retail'],
    services: ['architecture', 'general-design', 'technical-customer'],
    area: null,
    scale: 'portfolio',
    constructionKind: 'reconstruction',
    status: 'В работе',
    tags: ['portfolio', 'retail'],
    published: true,
  },
  {
    id: 'novosibirsk-business-center',
    title: 'Деловой центр в Новосибирске',
    url: 'https://craft72.ru/projects/novosibirsk-business-center',
    image: null,
    city: 'Новосибирск',
    region: 'Новосибирская область',
    categories: ['office', 'commercial'],
    services: ['architecture', 'general-design', 'engineering-surveys'],
    area: 31_200,
    scale: 'large-object',
    constructionKind: 'new-construction',
    status: 'Проектирование завершено',
    tags: ['office', 'mixed-use'],
    published: true,
  },
  {
    id: 'omsk-clinic-modernization',
    title: 'Модернизация городской клиники',
    url: 'https://craft72.ru/projects/omsk-clinic-modernization',
    image: null,
    city: 'Омск',
    region: 'Омская область',
    categories: ['healthcare', 'public-building'],
    services: ['engineering-surveys', 'general-design', 'expertise-support'],
    area: 14_600,
    scale: 'single-object',
    constructionKind: 'reconstruction',
    status: 'Реализован',
    tags: ['healthcare', 'modernization'],
    published: true,
  },
  {
    id: 'tyumen-riverfront-masterplan',
    title: 'Концепция развития городской набережной',
    url: 'https://craft72.ru/projects/tyumen-riverfront-masterplan',
    image: null,
    city: 'Тюмень',
    region: 'Тюменская область',
    categories: ['public-space', 'urban-development'],
    services: ['urban-planning', 'architecture'],
    area: 120_000,
    scale: 'territory',
    constructionKind: 'new-construction',
    status: 'Концепция утверждена',
    tags: ['masterplan', 'public-space'],
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
