import { z } from 'zod';

const INN_10_WEIGHTS = [2, 4, 10, 3, 5, 9, 4, 6, 8] as const;
const INN_11_WEIGHTS = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8] as const;
const INN_12_WEIGHTS = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8] as const;

function innChecksum(value: string, weights: readonly number[]): number {
  const sum = weights.reduce((total, weight, index) => {
    return total + Number(value[index]) * weight;
  }, 0);

  return (sum % 11) % 10;
}

export function isValidInn(value: string): boolean {
  if (!/^(?:\d{10}|\d{12})$/.test(value) || /^(\d)\1+$/.test(value)) {
    return false;
  }

  if (value.length === 10) {
    return innChecksum(value, INN_10_WEIGHTS) === Number(value[9]);
  }

  return (
    innChecksum(value, INN_11_WEIGHTS) === Number(value[10]) &&
    innChecksum(value, INN_12_WEIGHTS) === Number(value[11])
  );
}

export const UuidSchema = z.string().uuid();
export type Uuid = z.infer<typeof UuidSchema>;

export const IsoDateTimeSchema = z.string().datetime({ offset: true });
export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;

export const IsoDateSchema = z.iso.date();
export type IsoDate = z.infer<typeof IsoDateSchema>;

export const ShortTextSchema = z.string().trim().min(1).max(200);
export type ShortText = z.infer<typeof ShortTextSchema>;

export const TaxonomyKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]*$/);
export type TaxonomyKey = z.infer<typeof TaxonomyKeySchema>;

export const PhoneNumberSchema = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, 'Expected a canonical E.164 phone number');
export type PhoneNumber = z.infer<typeof PhoneNumberSchema>;

export const MaxContactPhoneSchema = z
  .string()
  .regex(/^\+?[1-9]\d{7,14}$/, 'Expected a MAX phone number');
export type MaxContactPhone = z.infer<typeof MaxContactPhoneSchema>;

export const EmailAddressSchema = z.string().trim().max(254).email();
export type EmailAddress = z.infer<typeof EmailAddressSchema>;

export const InnSchema = z
  .string()
  .regex(/^(?:\d{10}|\d{12})$/)
  .refine(isValidInn, 'Invalid INN checksum');
export type Inn = z.infer<typeof InnSchema>;

export const HttpsUrlSchema = z.string().trim().max(2_048).url().startsWith('https://');
export type HttpsUrl = z.infer<typeof HttpsUrlSchema>;

export const Sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/i)
  .transform((value) => value.toLowerCase());
export type Sha256 = z.infer<typeof Sha256Schema>;

export const CursorSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/);
export type Cursor = z.infer<typeof CursorSchema>;

export const IdempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>;

export const RequestIdSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
export type RequestId = z.infer<typeof RequestIdSchema>;
