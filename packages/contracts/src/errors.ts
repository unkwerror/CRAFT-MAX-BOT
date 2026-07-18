import { z } from 'zod';

import { RequestIdSchema } from './primitives.js';

export const API_ERROR_CODES = [
  'BAD_REQUEST',
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'MAX_AUTH_INVALID',
  'MAX_AUTH_EXPIRED',
  'CONTACT_VERIFICATION_FAILED',
  'CONTACT_HANDOFF_UNAVAILABLE',
  'DRAFT_NOT_FOUND',
  'UPLOAD_NOT_FOUND',
  'SUBMISSION_NOT_FOUND',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
] as const;

export const ApiErrorCodeSchema = z.enum(API_ERROR_CODES);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorIssueSchema = z.strictObject({
  path: z.array(z.union([z.string().max(128), z.number().int().nonnegative()])).max(16),
  code: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z_]+$/),
  message: z.string().min(1).max(500),
});
export type ApiErrorIssue = z.infer<typeof ApiErrorIssueSchema>;

export const ApiErrorResponseSchema = z.strictObject({
  error: z.strictObject({
    code: ApiErrorCodeSchema,
    message: z.string().min(1).max(500),
    requestId: RequestIdSchema,
    issues: z.array(ApiErrorIssueSchema).max(100).optional(),
  }),
});
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
