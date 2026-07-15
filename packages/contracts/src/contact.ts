import { z } from 'zod';

import {
  IsoDateTimeSchema,
  MaxContactPhoneSchema,
  PhoneNumberSchema,
  Sha256Schema,
} from './primitives.js';

export const MaxContactVerifyRequestSchema = z.strictObject({
  phone: MaxContactPhoneSchema,
  authDate: z.string().regex(/^\d{10,13}$/),
  hash: Sha256Schema,
});
export type MaxContactVerifyRequest = z.infer<typeof MaxContactVerifyRequestSchema>;

export const MaxContactVerifyResponseSchema = z.strictObject({
  phone: PhoneNumberSchema,
  verified: z.literal(true),
  verifiedAt: IsoDateTimeSchema,
});
export type MaxContactVerifyResponse = z.infer<typeof MaxContactVerifyResponseSchema>;
