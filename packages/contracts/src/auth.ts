import { z } from 'zod';

import { VerifiedContactSnapshotSchema } from './contact.js';
import { HttpsUrlSchema, IsoDateTimeSchema } from './primitives.js';
import { StartParamSchema } from './start-param.js';

const ConsentVersionSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);

export const privacyConsentText = (version: string): string =>
  'Я свободно, своей волей и в своём интересе даю ООО «КРАФТ ГРУПП» (ИНН 7203447380, ' +
  'ОГРН 1187232009524, адрес: 625003, Тюменская область, г. Тюмень, ул. Гранитная, д. 4) ' +
  'согласие на автоматизированную обработку моих персональных данных для аутентификации в ' +
  'CRAFT72 Mini App, сохранения черновика, рассмотрения обращения, связи со мной и подготовки ' +
  'предложения: данных профиля MAX; имени, роли, организации или ИП и ИНН; телефона, электронной ' +
  'почты; сведений о проекте и ссылок; технических данных сессии и доказательства согласия. ' +
  'Разрешаю сбор, запись, систематизацию, накопление, хранение, уточнение, извлечение, ' +
  'использование, предоставление уполномоченным работникам и обработчикам, блокирование, удаление ' +
  'и уничтожение без распространения. Сроки: сессия — 1 час, черновик — 30 дней, заявка — 1095 ' +
  `дней. Согласие можно отозвать через manager@craft72.ru. Политика версии ${version}: ` +
  'https://craft72app.ru/privacy.html.';

export const termsAcceptanceText = (version: string): string =>
  `Я принимаю Условия использования CRAFT72 Mini App версии ${version}, подтверждаю право ` +
  'передавать сведения, тексты и ссылки на материалы проекта и разрешаю ООО «Крафт Групп» ' +
  'использовать их только для рассмотрения обращения, связи со мной и подготовки предложения.';

export const PrivacyConsentEvidenceSchema = z
  .strictObject({
    accepted: z.literal(true),
    acceptedAt: IsoDateTimeSchema,
    text: z.string().trim().min(1).max(2_048),
    version: ConsentVersionSchema,
  })
  .refine((evidence) => evidence.text === privacyConsentText(evidence.version), {
    message: 'Privacy consent text does not match its version',
    path: ['text'],
  });
export type PrivacyConsentEvidence = z.infer<typeof PrivacyConsentEvidenceSchema>;

export const TermsAcceptanceEvidenceSchema = z
  .strictObject({
    accepted: z.literal(true),
    acceptedAt: IsoDateTimeSchema,
    text: z.string().trim().min(1).max(2_048),
    version: ConsentVersionSchema,
  })
  .refine((evidence) => evidence.text === termsAcceptanceText(evidence.version), {
    message: 'Terms acceptance text does not match its version',
    path: ['text'],
  });
export type TermsAcceptanceEvidence = z.infer<typeof TermsAcceptanceEvidenceSchema>;

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
  privacyConsent: PrivacyConsentEvidenceSchema,
  termsAcceptance: TermsAcceptanceEvidenceSchema,
});
export type MaxAuthRequest = z.infer<typeof MaxAuthRequestSchema>;

export const SessionTokenSchema = z
  .string()
  .length(43)
  .regex(/^[A-Za-z0-9_-]{43}$/);
export type SessionToken = z.infer<typeof SessionTokenSchema>;

export const MaxSessionSnapshotSchema = z.strictObject({
  token: SessionTokenSchema,
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
