import { z } from 'zod';

import { MaxUserIdSchema, MaxUserSchema, SessionTokenSchema } from './auth.js';
import { CaseIdSchema } from './case-catalog.js';
import { LeadFormDataSchema } from './lead-draft.js';
import {
  CursorSchema,
  HttpsUrlSchema,
  IsoDateTimeSchema,
  ShortTextSchema,
  TaxonomyKeySchema,
} from './primitives.js';
import { SubmissionIdSchema, SubmissionStatusSchema } from './submissions.js';

const AdminListLimitSchema = z.preprocess(
  (value) => (typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value),
  z.number().int().min(1).max(100).default(25),
);

const VersionQueryValueSchema = z.preprocess(
  (value) => (typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value),
  z.number().int().positive(),
);

const UniqueTaxonomyListSchema = z
  .array(TaxonomyKeySchema)
  .max(32)
  .refine((values) => new Set(values).size === values.length, 'Values must be unique');

export const AdminAuthRequestSchema = z.strictObject({
  initData: z
    .string()
    .min(1)
    .max(16_384)
    .refine((value) => !value.includes('\0')),
  password: z
    .string()
    .min(12)
    .max(256)
    .refine((value) => !value.includes('\0')),
});
export type AdminAuthRequest = z.infer<typeof AdminAuthRequestSchema>;

export const AdminSessionResponseSchema = z.strictObject({
  authenticated: z.literal(true),
  user: MaxUserSchema,
  expiresAt: IsoDateTimeSchema,
});
export type AdminSessionResponse = z.infer<typeof AdminSessionResponseSchema>;

export const AdminAuthResponseSchema = AdminSessionResponseSchema.extend({
  sessionToken: SessionTokenSchema,
});
export type AdminAuthResponse = z.infer<typeof AdminAuthResponseSchema>;

export const AdminUserListQuerySchema = z.strictObject({
  cursor: CursorSchema.optional(),
  limit: AdminListLimitSchema,
});
export type AdminUserListQuery = z.infer<typeof AdminUserListQuerySchema>;

export const AdminUserIdentitySourceSchema = z.enum(['miniapp', 'bot', 'miniapp_and_bot']);
export type AdminUserIdentitySource = z.infer<typeof AdminUserIdentitySourceSchema>;

export const AdminUserListItemSchema = z
  .strictObject({
    maxUserId: MaxUserIdSchema,
    displayName: z.string().trim().min(1).max(255),
    identitySource: AdminUserIdentitySourceSchema,
    user: MaxUserSchema.omit({ photoUrl: true }).nullable(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    submissionCount: z.number().int().nonnegative(),
    lastSubmissionAt: IsoDateTimeSchema.nullable(),
    hasActiveDraft: z.boolean(),
    botDialogCount: z.number().int().nonnegative(),
    lastBotEventAt: IsoDateTimeSchema.nullable(),
  })
  .refine((item) => item.user === null || item.user.id === item.maxUserId, {
    message: 'Profile identity must match the directory identity',
    path: ['user', 'id'],
  })
  .refine(
    (item) =>
      (item.identitySource === 'bot' && item.user === null && item.botDialogCount > 0) ||
      (item.identitySource === 'miniapp' && item.user !== null && item.botDialogCount === 0) ||
      (item.identitySource === 'miniapp_and_bot' && item.user !== null && item.botDialogCount > 0),
    {
      message: 'Identity source must match available profile and bot data',
      path: ['identitySource'],
    },
  )
  .refine((item) => item.identitySource !== 'bot' || item.displayName === 'Пользователь MAX', {
    message: 'Bot-only identities must use the neutral display label',
    path: ['displayName'],
  });
export type AdminUserListItem = z.infer<typeof AdminUserListItemSchema>;

export const AdminUserListResponseSchema = z.strictObject({
  items: z.array(AdminUserListItemSchema).max(100),
  nextCursor: CursorSchema.nullable(),
});
export type AdminUserListResponse = z.infer<typeof AdminUserListResponseSchema>;

export const SubmissionReviewStatusSchema = z.enum([
  'new',
  'in_review',
  'contacted',
  'qualified',
  'closed',
  'rejected',
]);
export type SubmissionReviewStatus = z.infer<typeof SubmissionReviewStatusSchema>;

export const AdminSubmissionListQuerySchema = z.strictObject({
  cursor: CursorSchema.optional(),
  limit: AdminListLimitSchema,
  maxUserId: MaxUserIdSchema.optional(),
  integrationStatus: SubmissionStatusSchema.optional(),
  reviewStatus: SubmissionReviewStatusSchema.optional(),
});
export type AdminSubmissionListQuery = z.infer<typeof AdminSubmissionListQuerySchema>;

export const AdminSubmissionListItemSchema = z.strictObject({
  submissionId: SubmissionIdSchema,
  maxUserId: MaxUserIdSchema,
  user: MaxUserSchema.omit({ photoUrl: true }),
  intake: LeadFormDataSchema,
  phoneVerified: z.boolean(),
  integrationStatus: SubmissionStatusSchema,
  reviewStatus: SubmissionReviewStatusSchema,
  adminNote: z.string().max(4_000).nullable(),
  submittedAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type AdminSubmissionListItem = z.infer<typeof AdminSubmissionListItemSchema>;

export const AdminSubmissionListResponseSchema = z.strictObject({
  items: z.array(AdminSubmissionListItemSchema).max(100),
  nextCursor: CursorSchema.nullable(),
});
export type AdminSubmissionListResponse = z.infer<typeof AdminSubmissionListResponseSchema>;

export const AdminSubmissionParamsSchema = z.strictObject({
  submissionId: SubmissionIdSchema,
});

export const AdminSubmissionUpdateRequestSchema = z
  .strictObject({
    expectedUpdatedAt: IsoDateTimeSchema,
    reviewStatus: SubmissionReviewStatusSchema.optional(),
    adminNote: z.string().trim().min(1).max(4_000).nullable().optional(),
  })
  .refine((value) => value.reviewStatus !== undefined || value.adminNote !== undefined, {
    message: 'At least one mutable review field is required',
  });
export type AdminSubmissionUpdateRequest = z.infer<typeof AdminSubmissionUpdateRequestSchema>;

export const AdminSubmissionResponseSchema = z.strictObject({
  submission: AdminSubmissionListItemSchema,
});
export type AdminSubmissionResponse = z.infer<typeof AdminSubmissionResponseSchema>;

export const AdminContactHandoffResponseSchema = z.strictObject({
  queued: z.literal(true),
});
export type AdminContactHandoffResponse = z.infer<typeof AdminContactHandoffResponseSchema>;

const AdminCaseFieldsSchema = z.strictObject({
  id: CaseIdSchema,
  title: z.string().trim().min(1).max(250),
  url: HttpsUrlSchema,
  image: HttpsUrlSchema.nullable(),
  city: ShortTextSchema,
  region: ShortTextSchema,
  categories: UniqueTaxonomyListSchema.min(1),
  services: UniqueTaxonomyListSchema.min(1),
  area: z.number().positive().max(1_000_000_000).nullable(),
  scale: TaxonomyKeySchema.nullable(),
  constructionKind: TaxonomyKeySchema.nullable(),
  status: z.string().trim().min(1).max(80),
  tags: UniqueTaxonomyListSchema,
  published: z.boolean(),
  sortOrder: z.number().int().min(-1_000_000).max(1_000_000),
});

export const AdminCaseCreateRequestSchema = AdminCaseFieldsSchema;
export type AdminCaseCreateRequest = z.infer<typeof AdminCaseCreateRequestSchema>;

export const AdminCaseUpdateRequestSchema = AdminCaseFieldsSchema.omit({ id: true })
  .partial()
  .extend({ expectedVersion: z.number().int().positive() })
  .refine((value) => Object.keys(value).some((key) => key !== 'expectedVersion'), {
    message: 'At least one mutable case field is required',
  });
export type AdminCaseUpdateRequest = z.infer<typeof AdminCaseUpdateRequestSchema>;

export const AdminCaseParamsSchema = z.strictObject({ id: CaseIdSchema });
export const AdminVersionQuerySchema = z.strictObject({ expectedVersion: VersionQueryValueSchema });

export const AdminCaseSchema = AdminCaseFieldsSchema.extend({
  version: z.number().int().positive(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type AdminCase = z.infer<typeof AdminCaseSchema>;

export const AdminCaseResponseSchema = z.strictObject({ item: AdminCaseSchema });
export type AdminCaseResponse = z.infer<typeof AdminCaseResponseSchema>;
export const AdminCaseListResponseSchema = z.strictObject({
  items: z.array(AdminCaseSchema).max(1_000),
});
export type AdminCaseListResponse = z.infer<typeof AdminCaseListResponseSchema>;

export type AdminJsonValue =
  boolean | null | number | string | AdminJsonValue[] | { [key: string]: AdminJsonValue };

export const AdminJsonValueSchema: z.ZodType<AdminJsonValue> = z.lazy(() =>
  z.union([
    z.boolean(),
    z.null(),
    z.number().finite(),
    z.string().max(20_000),
    z.array(AdminJsonValueSchema).max(1_000),
    z.record(z.string().min(1).max(128), AdminJsonValueSchema),
  ]),
);

export const ContentDocumentKindSchema = z.enum(['questionnaire', 'miniapp', 'bot']);
export type ContentDocumentKind = z.infer<typeof ContentDocumentKindSchema>;

const ContentPayloadSchema = z.record(z.string().min(1).max(128), AdminJsonValueSchema);

export const AdminContentCreateRequestSchema = z.strictObject({
  key: TaxonomyKeySchema,
  kind: ContentDocumentKindSchema,
  draft: ContentPayloadSchema,
});
export type AdminContentCreateRequest = z.infer<typeof AdminContentCreateRequestSchema>;

export const AdminContentUpdateRequestSchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
  draft: ContentPayloadSchema,
});
export type AdminContentUpdateRequest = z.infer<typeof AdminContentUpdateRequestSchema>;

export const AdminContentPublishRequestSchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
});
export type AdminContentPublishRequest = z.infer<typeof AdminContentPublishRequestSchema>;

export const AdminContentParamsSchema = z.strictObject({ key: TaxonomyKeySchema });

export const AdminContentDocumentSchema = z.strictObject({
  key: TaxonomyKeySchema,
  kind: ContentDocumentKindSchema,
  draft: ContentPayloadSchema,
  published: ContentPayloadSchema.nullable(),
  version: z.number().int().positive(),
  publishedVersion: z.number().int().positive().nullable(),
  publishedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type AdminContentDocument = z.infer<typeof AdminContentDocumentSchema>;

export const AdminContentResponseSchema = z.strictObject({ document: AdminContentDocumentSchema });
export type AdminContentResponse = z.infer<typeof AdminContentResponseSchema>;
export const AdminContentListResponseSchema = z.strictObject({
  items: z.array(AdminContentDocumentSchema).max(1_000),
});
export type AdminContentListResponse = z.infer<typeof AdminContentListResponseSchema>;

export const PublicContentResponseSchema = z.strictObject({
  key: TaxonomyKeySchema,
  kind: ContentDocumentKindSchema,
  content: ContentPayloadSchema,
  version: z.number().int().positive(),
  publishedAt: IsoDateTimeSchema,
});
export type PublicContentResponse = z.infer<typeof PublicContentResponseSchema>;
