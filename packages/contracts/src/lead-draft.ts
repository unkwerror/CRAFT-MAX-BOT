import { z } from 'zod';

import { CaseIdSchema } from './case-catalog.js';
import {
  EmailAddressSchema,
  HttpsUrlSchema,
  InnSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  PhoneNumberSchema,
  ShortTextSchema,
  TaxonomyKeySchema,
  UuidSchema,
} from './primitives.js';
import { StartParamSchema } from './start-param.js';

function hasUniqueValues(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

export const USER_ROLES = [
  'developer',
  'investor',
  'government_customer',
  'property_owner',
  'general_contractor',
  'other',
] as const;

export const UserRoleSchema = z.enum(USER_ROLES);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const TriStateAnswerSchema = z.enum(['yes', 'no', 'unknown']);
export type TriStateAnswer = z.infer<typeof TriStateAnswerSchema>;

export const ProjectLocationSchema = z
  .strictObject({
    city: ShortTextSchema.optional(),
    region: ShortTextSchema.optional(),
  })
  .refine((location) => location.city !== undefined || location.region !== undefined, {
    message: 'City or region is required',
  });
export type ProjectLocation = z.infer<typeof ProjectLocationSchema>;

export const ProjectScopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('single_object'),
  }),
  z.strictObject({
    kind: z.literal('portfolio'),
    objectCount: z.number().int().min(2).max(100_000),
  }),
]);
export type ProjectScope = z.infer<typeof ProjectScopeSchema>;

export const ProjectAreaSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('known'),
    squareMeters: z.number().positive().max(1_000_000_000),
  }),
  z.strictObject({
    status: z.literal('unknown'),
  }),
]);
export type ProjectArea = z.infer<typeof ProjectAreaSchema>;

export const DesiredStartSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('known'),
    date: IsoDateSchema,
  }),
  z.strictObject({
    status: z.literal('unknown'),
  }),
]);
export type DesiredStart = z.infer<typeof DesiredStartSchema>;

const UniqueTaxonomyKeyListSchema = z
  .array(TaxonomyKeySchema)
  .min(1)
  .max(20)
  .refine(hasUniqueValues, 'Values must be unique');

const UniqueLinkListSchema = z
  .array(HttpsUrlSchema)
  .max(10)
  .refine(hasUniqueValues, 'Links must be unique');

const UniqueDocumentIdListSchema = z
  .array(UuidSchema)
  .max(20)
  .refine(hasUniqueValues, 'Document IDs must be unique');

const UniqueCaseIdListSchema = z
  .array(CaseIdSchema)
  .max(10)
  .refine(hasUniqueValues, 'Case IDs must be unique');

export const LeadContactSchema = z.strictObject({
  phone: PhoneNumberSchema,
  email: EmailAddressSchema,
});
export type LeadContact = z.infer<typeof LeadContactSchema>;

export const LeadConsentSchema = z.strictObject({
  version: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  accepted: z.literal(true),
});
export type LeadConsent = z.infer<typeof LeadConsentSchema>;

export const LeadFormDataSchema = z.strictObject({
  role: UserRoleSchema,
  fullName: z.string().trim().min(2).max(200),
  organization: z.string().trim().min(1).max(250),
  inn: InnSchema.nullable(),
  objectType: TaxonomyKeySchema,
  location: ProjectLocationSchema,
  scope: ProjectScopeSchema,
  area: ProjectAreaSchema,
  currentStage: TaxonomyKeySchema,
  services: UniqueTaxonomyKeyListSchema,
  expertiseRequired: TriStateAnswerSchema,
  culturalHeritageSite: TriStateAnswerSchema,
  desiredStart: DesiredStartSchema,
  description: z.string().trim().min(1).max(5_000),
  links: UniqueLinkListSchema,
  documentIds: UniqueDocumentIdListSchema,
  selectedCaseIds: UniqueCaseIdListSchema,
  contact: LeadContactSchema,
  consent: LeadConsentSchema,
});
export type LeadFormData = z.infer<typeof LeadFormDataSchema>;

const RawDraftTextSchema = z.string();
const RawDraftTaxonomyKeySchema = RawDraftTextSchema.max(64);

const LeadDraftLocationFormStateSchema = z.strictObject({
  city: RawDraftTextSchema.max(200).optional(),
  region: RawDraftTextSchema.max(200).optional(),
});

const LeadDraftScopeFormStateSchema = z.strictObject({
  kind: RawDraftTaxonomyKeySchema.optional(),
  objectCount: RawDraftTextSchema.max(16).optional(),
});

const LeadDraftAreaFormStateSchema = z.strictObject({
  status: RawDraftTextSchema.max(32).optional(),
  squareMeters: RawDraftTextSchema.max(32).optional(),
});

const LeadDraftDesiredStartFormStateSchema = z.strictObject({
  status: RawDraftTextSchema.max(32).optional(),
  date: RawDraftTextSchema.max(32).optional(),
});

const LeadDraftContactFormStateSchema = z.strictObject({
  phone: RawDraftTextSchema.max(32).optional(),
  email: RawDraftTextSchema.max(254).optional(),
});

const LeadDraftConsentFormStateSchema = z.strictObject({
  version: RawDraftTextSchema.max(64).optional(),
  accepted: z.boolean().optional(),
});

/**
 * Bounded, lossless form state for autosave. Values deliberately remain raw so an interrupted
 * input such as an incomplete phone number or decimal can be restored exactly. Validate with
 * LeadFormDataSchema before advancing a completed step or creating a submission.
 *
 * Trusted phone-verification state is intentionally excluded. Clients derive its presentation
 * from the server-owned session snapshot instead of submitting a boolean in a draft payload.
 */
export const LeadDraftFormStateSchema = z.strictObject({
  role: RawDraftTaxonomyKeySchema.optional(),
  fullName: RawDraftTextSchema.max(200).optional(),
  organization: RawDraftTextSchema.max(250).optional(),
  inn: RawDraftTextSchema.max(12).nullable().optional(),
  objectType: RawDraftTaxonomyKeySchema.optional(),
  location: LeadDraftLocationFormStateSchema.optional(),
  scope: LeadDraftScopeFormStateSchema.optional(),
  area: LeadDraftAreaFormStateSchema.optional(),
  currentStage: RawDraftTaxonomyKeySchema.optional(),
  services: z.array(RawDraftTaxonomyKeySchema).max(20).optional(),
  expertiseRequired: RawDraftTextSchema.max(32).optional(),
  culturalHeritageSite: RawDraftTextSchema.max(32).optional(),
  desiredStart: LeadDraftDesiredStartFormStateSchema.optional(),
  description: RawDraftTextSchema.max(5_000).optional(),
  links: z.array(RawDraftTextSchema.max(2_048)).max(10).optional(),
  documentIds: z.array(RawDraftTextSchema.max(64)).max(20).optional(),
  selectedCaseIds: z.array(RawDraftTaxonomyKeySchema).max(10).optional(),
  contact: LeadDraftContactFormStateSchema.optional(),
  consent: LeadDraftConsentFormStateSchema.optional(),
});
export type LeadDraftFormState = z.infer<typeof LeadDraftFormStateSchema>;

export const LeadDraftPayloadSchema = LeadDraftFormStateSchema;
export type LeadDraftPayload = LeadDraftFormState;

export const LeadDraftUpsertRequestSchema = z.strictObject({
  currentStep: z.number().int().min(1).max(17),
  payload: LeadDraftPayloadSchema,
});
export type LeadDraftUpsertRequest = z.infer<typeof LeadDraftUpsertRequestSchema>;

export const LeadDraftSchema = z.strictObject({
  id: UuidSchema,
  currentStep: z.number().int().min(1).max(17),
  payload: LeadDraftPayloadSchema,
  source: StartParamSchema.nullable(),
  updatedAt: IsoDateTimeSchema,
  expiresAt: IsoDateTimeSchema,
});
export type LeadDraft = z.infer<typeof LeadDraftSchema>;

export const LeadDraftUpsertResponseSchema = z.strictObject({
  draft: LeadDraftSchema,
});
export type LeadDraftUpsertResponse = z.infer<typeof LeadDraftUpsertResponseSchema>;

export const LeadDraftGetResponseSchema = z.strictObject({
  draft: LeadDraftSchema.nullable(),
});
export type LeadDraftGetResponse = z.infer<typeof LeadDraftGetResponseSchema>;
