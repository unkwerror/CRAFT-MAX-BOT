import { z } from 'zod';

import { CursorSchema, HttpsUrlSchema, ShortTextSchema, TaxonomyKeySchema } from './primitives.js';

function hasUniqueValues(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

export const CaseIdSchema = TaxonomyKeySchema;
export type CaseId = z.infer<typeof CaseIdSchema>;

const TaxonomyKeyListSchema = z
  .array(TaxonomyKeySchema)
  .max(32)
  .refine(hasUniqueValues, 'Values must be unique');

const RequiredTaxonomyKeyListSchema = z
  .array(TaxonomyKeySchema)
  .min(1)
  .max(32)
  .refine(hasUniqueValues, 'Values must be unique');

export const CaseCatalogItemSchema = z.strictObject({
  id: CaseIdSchema,
  title: z.string().trim().min(1).max(250),
  url: HttpsUrlSchema,
  image: HttpsUrlSchema.nullable(),
  city: ShortTextSchema,
  region: ShortTextSchema,
  categories: RequiredTaxonomyKeyListSchema,
  services: RequiredTaxonomyKeyListSchema,
  area: z.number().positive().max(1_000_000_000).nullable(),
  scale: TaxonomyKeySchema.nullable(),
  constructionKind: TaxonomyKeySchema.nullable(),
  status: z.string().trim().min(1).max(80),
  tags: TaxonomyKeyListSchema,
  published: z.literal(true),
});
export type CaseCatalogItem = z.infer<typeof CaseCatalogItemSchema>;

const CaseCatalogLimitSchema = z.preprocess(
  (value) => (typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value),
  z.number().int().min(1).max(100),
);

export const CaseCatalogQuerySchema = z.strictObject({
  objectType: TaxonomyKeySchema.optional(),
  service: TaxonomyKeySchema.optional(),
  region: z.string().trim().min(1).max(200).optional(),
  city: z.string().trim().min(1).max(200).optional(),
  scale: TaxonomyKeySchema.optional(),
  constructionKind: TaxonomyKeySchema.optional(),
  cursor: CursorSchema.optional(),
  limit: CaseCatalogLimitSchema.optional(),
});
export type CaseCatalogQuery = z.infer<typeof CaseCatalogQuerySchema>;

export const CaseCatalogResponseSchema = z.strictObject({
  items: z.array(CaseCatalogItemSchema).max(100),
  nextCursor: CursorSchema.nullable(),
});
export type CaseCatalogResponse = z.infer<typeof CaseCatalogResponseSchema>;
