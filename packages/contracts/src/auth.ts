import { z } from 'zod';

import { VerifiedContactSnapshotSchema } from './contact.js';
import { HttpsUrlSchema, IsoDateTimeSchema } from './primitives.js';
import { StartParamSchema } from './start-param.js';

export const MaxUserIdSchema = z
  .string()
  .refine((value) => /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9_223_372_036_854_775_807n, {
    message: 'MAX user ID must fit a signed bigint',
  });
export type MaxUserId = z.infer<typeof MaxUserIdSchema>;

export const MaxUserSchema = z.strictObject({
  id: MaxUserIdSchema,
  firstName: z.string().trim().min(1).max(128),
  lastName: z.string().trim().min(1).max(128).nullable(),
  username: z.string().trim().min(1).max(64).nullable(),
  languageCode: z.string().trim().min(2).max(35).nullable(),
  photoUrl: HttpsUrlSchema.nullable(),
});
export type MaxUser = z.infer<typeof MaxUserSchema>;

export const MaxAuthRequestSchema = z.strictObject({
  initData: z
    .string()
    .min(1)
    .max(16_384)
    .refine((value) => !value.includes('\0')),
});
export type MaxAuthRequest = z.infer<typeof MaxAuthRequestSchema>;

export const MaxSessionSnapshotSchema = z.strictObject({
  expiresAt: IsoDateTimeSchema,
  verifiedContact: VerifiedContactSnapshotSchema.nullable(),
});
export type MaxSessionSnapshot = z.infer<typeof MaxSessionSnapshotSchema>;

export const MaxAuthResponseSchema = z.strictObject({
  authenticated: z.literal(true),
  user: MaxUserSchema,
  session: MaxSessionSnapshotSchema,
  startParam: StartParamSchema.nullable(),
});
export type MaxAuthResponse = z.infer<typeof MaxAuthResponseSchema>;
