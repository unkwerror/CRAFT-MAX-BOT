import { z } from 'zod';

const placeholderPattern = /<[^>]+>/;

const containsPlaceholder = (value: string): boolean => {
  if (placeholderPattern.test(value)) {
    return true;
  }

  try {
    return placeholderPattern.test(decodeURIComponent(value));
  } catch {
    return false;
  }
};

const concreteString = (name: string, minimumLength = 1) =>
  z
    .string()
    .trim()
    .min(minimumLength, `${name} is required`)
    .refine((value) => !containsPlaceholder(value), `${name} must not contain a placeholder`);

const hasHttpsProtocol = (value: string): boolean => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

const httpsUrl = z.url().refine(hasHttpsProtocol, 'Production endpoints must use HTTPS');

const booleanFromEnvironment = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => value === true || value === 'true');

export const serverEnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_HOST: z.ipv4().default('127.0.0.1'),
    API_PORT: z.coerce.number().int().min(1024).max(65_535),
    PUBLIC_BASE_URL: z.url(),
    PRIVACY_POLICY_URL: z
      .url()
      .refine(hasHttpsProtocol, 'Privacy policy must use HTTPS')
      .refine(
        (value) => !containsPlaceholder(value),
        'PRIVACY_POLICY_URL must not contain placeholders',
      ),
    CONSENT_VERSION: concreteString('CONSENT_VERSION')
      .max(64)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'CONSENT_VERSION has an invalid format'),
    MAX_API_BASE_URL: z
      .url()
      .refine(
        (value) => value === 'https://platform-api2.max.ru',
        'MAX_API_BASE_URL must use the supported MAX API endpoint',
      ),
    MAX_BOT_TOKEN: concreteString('MAX_BOT_TOKEN', 16),
    MAX_WEBHOOK_SECRET: concreteString('MAX_WEBHOOK_SECRET', 32),
    MAX_INIT_DATA_MAX_AGE_SECONDS: z.coerce.number().int().positive().max(3_600),
    MAX_CONTACT_MAX_AGE_SECONDS: z.coerce.number().int().positive().max(3_600).default(300),
    SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(86_400).default(3_600),
    DRAFT_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(3_600)
      .max(90 * 24 * 60 * 60)
      .default(30 * 24 * 60 * 60),
    SUBMISSION_RETENTION_DAYS: z.coerce.number().int().min(30).max(1_095).default(1_095),
    RETENTION_CLEANUP_INTERVAL_SECONDS: z.coerce
      .number()
      .int()
      .min(300)
      .max(86_400)
      .default(21_600),
    API_RATE_LIMIT_MAX: z.coerce.number().int().min(10).max(1_000).default(120),
    API_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).max(3_600).default(60),
    DATABASE_URL: z
      .url()
      .refine(
        (value) => ['postgres:', 'postgresql:'].includes(new URL(value).protocol),
        'DATABASE_URL must be a PostgreSQL URL',
      )
      .refine((value) => !containsPlaceholder(value), 'DATABASE_URL must not contain placeholders'),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
    DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(5_000),
    DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(10_000),
    TRACKER_API_BASE_URL: z
      .url()
      .refine(
        (value) => value === 'https://api.tracker.yandex.net/v3',
        'TRACKER_API_BASE_URL must use Yandex Tracker API v3',
      ),
    TRACKER_AUTH_TYPE: z.enum(['oauth', 'iam']),
    TRACKER_TOKEN: concreteString('TRACKER_TOKEN', 16),
    TRACKER_ORG_HEADER: z.enum(['X-Org-ID', 'X-Cloud-Org-ID']),
    TRACKER_ORG_ID: concreteString('TRACKER_ORG_ID'),
    TRACKER_QUEUE_CRM: concreteString('TRACKER_QUEUE_CRM').default('CRM'),
    TRACKER_QUEUE_PART: concreteString('TRACKER_QUEUE_PART').default('PART'),
    TRACKER_QUEUE_DOCS: concreteString('TRACKER_QUEUE_DOCS').default('DOCS'),
    TRACKER_DRY_RUN: booleanFromEnvironment.default(true),
    UPLOAD_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .max(50 * 1024 * 1024),
    UPLOAD_STAGING_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(300)
      .max(7 * 24 * 60 * 60),
    UPLOAD_STORAGE_PATH: concreteString('UPLOAD_STORAGE_PATH')
      .refine((value) => value.startsWith('/'), 'UPLOAD_STORAGE_PATH must be an absolute path')
      .refine((value) => value !== '/', 'UPLOAD_STORAGE_PATH must not be the filesystem root')
      .refine(
        (value) => !value.split('/').some((segment) => segment === '..'),
        'UPLOAD_STORAGE_PATH must not contain parent-directory segments',
      ),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    LOG_RETENTION_DAYS: z.coerce.number().int().min(1).max(90).default(90),
    BACKUP_RETENTION_DAYS: z.coerce.number().int().min(1).max(30).default(30),
    SHUTDOWN_GRACE_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),
  })
  .superRefine((environment, context) => {
    if (environment.NODE_ENV !== 'production') {
      return;
    }

    for (const [key, value] of [
      ['PUBLIC_BASE_URL', environment.PUBLIC_BASE_URL],
      ['PRIVACY_POLICY_URL', environment.PRIVACY_POLICY_URL],
      ['TRACKER_API_BASE_URL', environment.TRACKER_API_BASE_URL],
      ['MAX_API_BASE_URL', environment.MAX_API_BASE_URL],
    ] as const) {
      const result = httpsUrl.safeParse(value);

      if (!result.success) {
        context.addIssue({
          code: 'custom',
          message: `${key} must use HTTPS in production`,
          path: [key],
        });
      }
    }
  });

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

export interface ConfigurationIssue {
  readonly key: string;
  readonly message: string;
}

export class ConfigurationError extends Error {
  public readonly issues: readonly ConfigurationIssue[];

  public constructor(issues: readonly ConfigurationIssue[]) {
    super(`Invalid configuration: ${issues.map((issue) => issue.key).join(', ')}`);
    this.name = 'ConfigurationError';
    this.issues = issues;
  }
}

export const parseServerEnvironment = (
  input: Readonly<Record<string, unknown>>,
): ServerEnvironment => {
  const result = serverEnvironmentSchema.safeParse(input);

  if (result.success) {
    return result.data;
  }

  throw new ConfigurationError(
    result.error.issues.map((issue) => ({
      key: issue.path.join('.') || 'environment',
      message: issue.message,
    })),
  );
};
