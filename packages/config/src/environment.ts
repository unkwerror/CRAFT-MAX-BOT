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

const adminMaxUserIds = z
  .string()
  .trim()
  .max(1_024)
  .transform((value) => (value.length === 0 ? [] : value.split(',').map((part) => part.trim())))
  .pipe(
    z
      .array(
        z
          .string()
          .regex(/^[1-9]\d{0,18}$/)
          .refine(
            (value) => BigInt(value) <= 9_223_372_036_854_775_807n,
            'ADMIN_MAX_USER_IDS contains an identifier outside signed bigint range',
          ),
      )
      .max(32)
      .refine((values) => new Set(values).size === values.length, 'Admin IDs must be unique'),
  );

const maxManagerProfileUrl = z
  .string()
  .trim()
  .max(2_048)
  .refine(
    (value) =>
      value === '' ||
      /^https:\/\/max\.ru\/(?:u\/[A-Za-z0-9_-]{1,256}|[A-Za-z0-9_]{1,128})$/.test(value),
    'MAX_MANAGER_PROFILE_URL must be an exact manager profile link copied from MAX',
  );

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
    MAX_BOT_PUBLIC_NAME: concreteString('MAX_BOT_PUBLIC_NAME')
      .max(128)
      .regex(
        /^[A-Za-z0-9_]+$/,
        'MAX_BOT_PUBLIC_NAME may contain only letters, digits and underscore',
      ),
    MAX_MANAGER_PROFILE_URL: maxManagerProfileUrl.default(''),
    MAX_MANAGER_USER_ID: z
      .string()
      .trim()
      .regex(/^[1-9]\d{4,18}$/)
      .refine((value) => BigInt(value) <= 9_223_372_036_854_775_807n),
    MAX_MANAGER_PHONE: z
      .string()
      .trim()
      .regex(/^\+[1-9]\d{7,14}$/),
    MAX_WEBHOOK_SECRET: concreteString('MAX_WEBHOOK_SECRET', 32)
      .max(256)
      .regex(
        /^[A-Za-z0-9_-]+$/,
        'MAX_WEBHOOK_SECRET may contain only letters, digits, underscore and hyphen',
      ),
    MAX_API_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(10_000),
    MAX_INIT_DATA_MAX_AGE_SECONDS: z.coerce.number().int().positive().max(3_600),
    MAX_CONTACT_MAX_AGE_SECONDS: z.coerce.number().int().positive().max(3_600).default(300),
    ADMIN_MAX_USER_IDS: adminMaxUserIds,
    ADMIN_SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(86_400).default(28_800),
    BOT_WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(10_000).default(500),
    BOT_WORKER_LEASE_SECONDS: z.coerce.number().int().min(10).max(600).default(60),
    BOT_WORKER_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(8),
    BOT_RETRY_BASE_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
    BOT_RETRY_MAX_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(300_000),
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
    API_IP_RATE_LIMIT_MAX: z.coerce.number().int().min(100).max(20_000).default(1_200),
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
    TRACKER_QUEUE_CRM: z.literal('CRM').default('CRM'),
    TRACKER_QUEUE_PART: z.literal('PART').default('PART'),
    TRACKER_QUEUE_DOCS: z.literal('DOCS').default('DOCS'),
    TRACKER_DRY_RUN: booleanFromEnvironment.default(true),
    TRACKER_PRODUCTION_WRITES_APPROVED: booleanFromEnvironment.default(false),
    TRACKER_ASSIGNEE: z
      .string()
      .trim()
      .max(128)
      .refine(
        (value) => !containsPlaceholder(value),
        'TRACKER_ASSIGNEE must not contain a placeholder',
      )
      .refine((value) => !/[\r\n]/.test(value), 'TRACKER_ASSIGNEE must be a single line')
      .default(''),
    TRACKER_API_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(10_000),
    TRACKER_WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(250).max(30_000).default(1_000),
    TRACKER_WORKER_LEASE_SECONDS: z.coerce.number().int().min(10).max(600).default(90),
    TRACKER_WORKER_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(8),
    TRACKER_RETRY_BASE_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
    TRACKER_RETRY_MAX_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(300_000),
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
    UPLOAD_SIGNING_SECRET: concreteString('UPLOAD_SIGNING_SECRET', 32)
      .max(256)
      .regex(
        /^[A-Za-z0-9_-]+$/,
        'UPLOAD_SIGNING_SECRET may contain only letters, digits, underscore and hyphen',
      ),
    UPLOAD_DOWNLOAD_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(900),
    UPLOAD_LEASE_SECONDS: z.coerce.number().int().min(60).max(3_600).default(900),
    UPLOAD_MAX_ACTIVE_PER_USER: z.coerce.number().int().min(1).max(100).default(5),
    UPLOAD_MAX_STAGED_BYTES_PER_USER: z.coerce
      .number()
      .int()
      .positive()
      .max(10 * 1024 * 1024 * 1024)
      .default(250 * 1024 * 1024),
    UPLOAD_MAX_FILES_PER_USER: z.coerce.number().int().min(1).max(10_000).default(100),
    UPLOAD_MAX_TOTAL_BYTES_PER_USER: z.coerce
      .number()
      .int()
      .positive()
      .max(100 * 1024 * 1024 * 1024)
      .default(1024 * 1024 * 1024),
    CLAMAV_SOCKET_PATH: concreteString('CLAMAV_SOCKET_PATH')
      .refine((value) => value.startsWith('/'), 'CLAMAV_SOCKET_PATH must be an absolute path')
      .refine(
        (value) => !value.split('/').some((segment) => segment === '..'),
        'CLAMAV_SOCKET_PATH must not contain parent-directory segments',
      ),
    CLAMAV_SCAN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(180_000).default(120_000),
    FILE_SCAN_POLL_INTERVAL_MS: z.coerce.number().int().min(250).max(30_000).default(1_000),
    FILE_SCAN_LEASE_SECONDS: z.coerce.number().int().min(30).max(600).default(180),
    FILE_SCAN_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(8),
    FILE_SCAN_RETRY_BASE_MS: z.coerce.number().int().min(100).max(60_000).default(5_000),
    FILE_SCAN_RETRY_MAX_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(300_000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    LOG_RETENTION_DAYS: z.coerce.number().int().min(1).max(90).default(90),
    BACKUP_RETENTION_DAYS: z.coerce.number().int().min(1).max(30).default(30),
    SHUTDOWN_GRACE_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),
  })
  .superRefine((environment, context) => {
    if (environment.BOT_RETRY_MAX_MS < environment.BOT_RETRY_BASE_MS) {
      context.addIssue({
        code: 'custom',
        message: 'BOT_RETRY_MAX_MS must be greater than or equal to BOT_RETRY_BASE_MS',
        path: ['BOT_RETRY_MAX_MS'],
      });
    }

    if (environment.TRACKER_RETRY_MAX_MS < environment.TRACKER_RETRY_BASE_MS) {
      context.addIssue({
        code: 'custom',
        message: 'TRACKER_RETRY_MAX_MS must be greater than or equal to TRACKER_RETRY_BASE_MS',
        path: ['TRACKER_RETRY_MAX_MS'],
      });
    }

    if (environment.FILE_SCAN_RETRY_MAX_MS < environment.FILE_SCAN_RETRY_BASE_MS) {
      context.addIssue({
        code: 'custom',
        message: 'FILE_SCAN_RETRY_MAX_MS must be greater than or equal to FILE_SCAN_RETRY_BASE_MS',
        path: ['FILE_SCAN_RETRY_MAX_MS'],
      });
    }

    if (environment.API_IP_RATE_LIMIT_MAX < environment.API_RATE_LIMIT_MAX) {
      context.addIssue({
        code: 'custom',
        message: 'API_IP_RATE_LIMIT_MAX must be greater than or equal to API_RATE_LIMIT_MAX',
        path: ['API_IP_RATE_LIMIT_MAX'],
      });
    }

    if (
      environment.TRACKER_WORKER_LEASE_SECONDS * 1_000 <=
      environment.TRACKER_API_TIMEOUT_MS * 3 + 5_000
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Tracker lease must exceed the longest idempotent API sequence',
        path: ['TRACKER_WORKER_LEASE_SECONDS'],
      });
    }

    if (environment.UPLOAD_MAX_STAGED_BYTES_PER_USER < environment.UPLOAD_MAX_BYTES) {
      context.addIssue({
        code: 'custom',
        message: 'UPLOAD_MAX_STAGED_BYTES_PER_USER must allow at least one maximum-size upload',
        path: ['UPLOAD_MAX_STAGED_BYTES_PER_USER'],
      });
    }

    if (
      environment.UPLOAD_MAX_TOTAL_BYTES_PER_USER < environment.UPLOAD_MAX_STAGED_BYTES_PER_USER
    ) {
      context.addIssue({
        code: 'custom',
        message: 'UPLOAD_MAX_TOTAL_BYTES_PER_USER must cover the staged-byte quota',
        path: ['UPLOAD_MAX_TOTAL_BYTES_PER_USER'],
      });
    }

    if (!environment.TRACKER_DRY_RUN && !environment.TRACKER_PRODUCTION_WRITES_APPROVED) {
      context.addIssue({
        code: 'custom',
        message: 'Tracker writes require explicit production approval',
        path: ['TRACKER_PRODUCTION_WRITES_APPROVED'],
      });
    }

    if (!environment.TRACKER_DRY_RUN && environment.TRACKER_ASSIGNEE.length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'Tracker production writes require an explicit assignee',
        path: ['TRACKER_ASSIGNEE'],
      });
    }

    if (environment.NODE_ENV !== 'production') {
      return;
    }

    if (environment.ADMIN_MAX_USER_IDS.length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'ADMIN_MAX_USER_IDS must contain at least one MAX user ID in production',
        path: ['ADMIN_MAX_USER_IDS'],
      });
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
