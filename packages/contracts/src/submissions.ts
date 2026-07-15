import { z } from 'zod';

import { CaseCatalogItemSchema } from './case-catalog.js';
import { LeadFormDataSchema } from './lead-draft.js';
import { IdempotencyKeySchema, IsoDateTimeSchema, UuidSchema } from './primitives.js';
import { DocumentSchema } from './uploads.js';

export const SubmissionIdSchema = z
  .string()
  .min(6)
  .max(64)
  .regex(/^[A-Z0-9][A-Z0-9-]*$/);
export type SubmissionId = z.infer<typeof SubmissionIdSchema>;

export const SubmissionStatusSchema = z.enum([
  'received',
  'syncing',
  'synced',
  'sync_failed',
  'cancelled',
]);
export type SubmissionStatus = z.infer<typeof SubmissionStatusSchema>;

export const SubmissionCreateRequestSchema = z.strictObject({
  draftId: UuidSchema.optional(),
  idempotencyKey: IdempotencyKeySchema,
  payload: LeadFormDataSchema,
});
export type SubmissionCreateRequest = z.infer<typeof SubmissionCreateRequestSchema>;

export const SubmissionParamsSchema = z.strictObject({
  submissionId: SubmissionIdSchema,
});
export type SubmissionParams = z.infer<typeof SubmissionParamsSchema>;

export const SubmissionSchema = z.strictObject({
  submissionId: SubmissionIdSchema,
  status: SubmissionStatusSchema,
  payload: LeadFormDataSchema,
  phoneVerified: z.boolean(),
  materials: z.array(DocumentSchema).max(20),
  matchedCases: z.array(CaseCatalogItemSchema).max(10),
  submittedAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type Submission = z.infer<typeof SubmissionSchema>;

export const SubmissionCreateResponseSchema = z.strictObject({
  submission: SubmissionSchema,
});
export type SubmissionCreateResponse = z.infer<typeof SubmissionCreateResponseSchema>;

export const SubmissionReadResponseSchema = SubmissionCreateResponseSchema;
export type SubmissionReadResponse = z.infer<typeof SubmissionReadResponseSchema>;
