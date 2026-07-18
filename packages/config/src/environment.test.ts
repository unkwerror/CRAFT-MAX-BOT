import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  ConfigurationError,
  parseServerEnvironment,
  serverEnvironmentSchema,
} from './environment.js';

const validEnvironment = {
  NODE_ENV: 'production',
  API_HOST: '127.0.0.1',
  API_PORT: '4100',
  PUBLIC_BASE_URL: 'https://craft72app.ru',
  PRIVACY_POLICY_URL: 'https://craft72app.ru/privacy.html',
  CONSENT_VERSION: 'miniapp-2026-07-16-stage5',
  MAX_API_BASE_URL: 'https://platform-api2.max.ru',
  MAX_BOT_TOKEN: 'rotated-token-with-enough-length',
  MAX_BOT_PUBLIC_NAME: 'craft72_bot',
  MAX_MANAGER_PROFILE_URL: 'https://max.ru/u/Manager_token-123',
  MAX_MANAGER_USER_ID: '61096226',
  MAX_MANAGER_PHONE: '+79220063645',
  MAX_WEBHOOK_SECRET: 'a-random-webhook-secret-with-32-characters',
  MAX_API_TIMEOUT_MS: '10000',
  MAX_INIT_DATA_MAX_AGE_SECONDS: '3600',
  MAX_CONTACT_MAX_AGE_SECONDS: '300',
  ADMIN_MAX_USER_IDS: '61096226,9223372036854775807',
  ADMIN_SESSION_TTL_SECONDS: '28800',
  BOT_WORKER_POLL_INTERVAL_MS: '500',
  BOT_WORKER_LEASE_SECONDS: '60',
  BOT_WORKER_MAX_ATTEMPTS: '8',
  BOT_RETRY_BASE_MS: '1000',
  BOT_RETRY_MAX_MS: '300000',
  SESSION_TTL_SECONDS: '3600',
  DRAFT_TTL_SECONDS: '2592000',
  SUBMISSION_RETENTION_DAYS: '1095',
  RETENTION_CLEANUP_INTERVAL_SECONDS: '21600',
  API_RATE_LIMIT_MAX: '120',
  API_IP_RATE_LIMIT_MAX: '1200',
  API_RATE_LIMIT_WINDOW_SECONDS: '60',
  DATABASE_URL: 'postgresql://craft72:password@127.0.0.1:5432/craft72_max_app',
  DB_POOL_MAX: '10',
  DB_CONNECTION_TIMEOUT_MS: '5000',
  DB_STATEMENT_TIMEOUT_MS: '10000',
  TRACKER_API_BASE_URL: 'https://api.tracker.yandex.net/v3',
  TRACKER_AUTH_TYPE: 'oauth',
  TRACKER_TOKEN: 'tracker-token-with-enough-length',
  TRACKER_ORG_HEADER: 'X-Org-ID',
  TRACKER_ORG_ID: 'organization-id',
  TRACKER_QUEUE_CRM: 'CRM',
  TRACKER_QUEUE_PART: 'PART',
  TRACKER_QUEUE_DOCS: 'DOCS',
  TRACKER_DRY_RUN: 'true',
  TRACKER_PRODUCTION_WRITES_APPROVED: 'false',
  TRACKER_ASSIGNEE: '',
  TRACKER_API_TIMEOUT_MS: '10000',
  TRACKER_WORKER_POLL_INTERVAL_MS: '1000',
  TRACKER_WORKER_LEASE_SECONDS: '90',
  TRACKER_WORKER_MAX_ATTEMPTS: '8',
  TRACKER_RETRY_BASE_MS: '1000',
  TRACKER_RETRY_MAX_MS: '300000',
  UPLOAD_MAX_BYTES: '52428800',
  UPLOAD_STAGING_TTL_SECONDS: '86400',
  UPLOAD_STORAGE_PATH: '/srv/craft72-max-app/uploads',
  UPLOAD_SIGNING_SECRET: 'upload-signing-secret-with-32-characters',
  UPLOAD_DOWNLOAD_TTL_SECONDS: '900',
  UPLOAD_LEASE_SECONDS: '900',
  UPLOAD_MAX_ACTIVE_PER_USER: '5',
  UPLOAD_MAX_STAGED_BYTES_PER_USER: '262144000',
  UPLOAD_MAX_FILES_PER_USER: '100',
  UPLOAD_MAX_TOTAL_BYTES_PER_USER: '1073741824',
  CLAMAV_SOCKET_PATH: '/run/clamav/clamd.ctl',
  CLAMAV_SCAN_TIMEOUT_MS: '120000',
  FILE_SCAN_POLL_INTERVAL_MS: '1000',
  FILE_SCAN_LEASE_SECONDS: '180',
  FILE_SCAN_MAX_ATTEMPTS: '8',
  FILE_SCAN_RETRY_BASE_MS: '5000',
  FILE_SCAN_RETRY_MAX_MS: '300000',
  LOG_LEVEL: 'info',
  LOG_RETENTION_DAYS: '90',
  BACKUP_RETENTION_DAYS: '30',
  SHUTDOWN_GRACE_MS: '10000',
} as const;

describe('parseServerEnvironment', () => {
  it('covers every variable declared in the repository environment template', () => {
    const template = readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8');
    const templateKeys = template
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
      .map((line) => line.slice(0, line.indexOf('=')))
      .sort();
    const schemaKeys = Object.keys(serverEnvironmentSchema.shape).sort();

    expect(schemaKeys).toEqual(templateKeys);
  });

  it('parses and coerces a complete production environment', () => {
    const environment = parseServerEnvironment(validEnvironment);

    expect(environment.API_PORT).toBe(4100);
    expect(environment.TRACKER_DRY_RUN).toBe(true);
    expect(environment.UPLOAD_MAX_BYTES).toBe(52_428_800);
    expect(environment.UPLOAD_STAGING_TTL_SECONDS).toBe(86_400);
    expect(environment.UPLOAD_MAX_STAGED_BYTES_PER_USER).toBe(262_144_000);
    expect(environment.SESSION_TTL_SECONDS).toBe(3_600);
    expect(environment.DRAFT_TTL_SECONDS).toBe(2_592_000);
    expect(environment.SUBMISSION_RETENTION_DAYS).toBe(1_095);
    expect(environment.ADMIN_MAX_USER_IDS).toEqual(['61096226', '9223372036854775807']);
    expect(environment.ADMIN_SESSION_TTL_SECONDS).toBe(28_800);
    expect(environment.MAX_MANAGER_PROFILE_URL).toBe('https://max.ru/u/Manager_token-123');
  });

  it('requires a unique MAX admin allowlist in production', () => {
    for (const ADMIN_MAX_USER_IDS of ['', '0', '61096226,61096226', '9223372036854775808']) {
      expect(() => parseServerEnvironment({ ...validEnvironment, ADMIN_MAX_USER_IDS })).toThrow(
        ConfigurationError,
      );
    }
  });

  it('rejects unsupported MAX API endpoints', () => {
    expect(() =>
      parseServerEnvironment({
        ...validEnvironment,
        MAX_API_BASE_URL: 'https://api.max.ru',
      }),
    ).toThrow(ConfigurationError);
  });

  it('enforces the MAX webhook subscription secret format', () => {
    for (const MAX_WEBHOOK_SECRET of [
      'too-short',
      'webhook secret with spaces and enough length',
      'x'.repeat(257),
    ]) {
      expect(() => parseServerEnvironment({ ...validEnvironment, MAX_WEBHOOK_SECRET })).toThrow(
        ConfigurationError,
      );
    }
  });

  it('requires the concrete public MAX bot name used by open_app buttons', () => {
    for (const MAX_BOT_PUBLIC_NAME of [
      '',
      '<BOT_PUBLIC_NAME>',
      'https://craft72app.ru',
      'bot name',
    ]) {
      expect(() => parseServerEnvironment({ ...validEnvironment, MAX_BOT_PUBLIC_NAME })).toThrow(
        ConfigurationError,
      );
    }
  });

  it('rejects committed placeholder secrets', () => {
    expect(() =>
      parseServerEnvironment({
        ...validEnvironment,
        MAX_BOT_TOKEN: '<NEW_ROTATED_TOKEN>',
      }),
    ).toThrow(ConfigurationError);
  });

  it('rejects the placeholder database URL from the environment template', () => {
    expect(() =>
      parseServerEnvironment({
        ...validEnvironment,
        DATABASE_URL: 'postgresql://<DEDICATED_USER>:<PASSWORD>@127.0.0.1:5432/craft72_max_app',
      }),
    ).toThrow(ConfigurationError);
  });

  it('requires a dedicated absolute upload storage path', () => {
    for (const path of ['uploads', '.', '/', '/srv/craft72/../shared']) {
      expect(() =>
        parseServerEnvironment({
          ...validEnvironment,
          UPLOAD_STORAGE_PATH: path,
        }),
      ).toThrow(ConfigurationError);
    }
  });

  it('validates upload signing and ClamAV runtime boundaries', () => {
    for (const override of [
      { UPLOAD_SIGNING_SECRET: 'too-short' },
      { UPLOAD_SIGNING_SECRET: 'upload signing secret with spaces and enough length' },
      { CLAMAV_SOCKET_PATH: 'run/clamav/clamd.ctl' },
      { CLAMAV_SOCKET_PATH: '/run/clamav/../private.sock' },
      { CLAMAV_SCAN_TIMEOUT_MS: '999' },
    ]) {
      expect(() => parseServerEnvironment({ ...validEnvironment, ...override })).toThrow(
        ConfigurationError,
      );
    }
  });

  it('keeps Tracker retry delays ordered', () => {
    expect(() =>
      parseServerEnvironment({
        ...validEnvironment,
        TRACKER_RETRY_BASE_MS: '5000',
        TRACKER_RETRY_MAX_MS: '1000',
      }),
    ).toThrow(ConfigurationError);
  });

  it('requires a second explicit gate before Tracker production writes', () => {
    expect(() =>
      parseServerEnvironment({
        ...validEnvironment,
        TRACKER_DRY_RUN: 'false',
        TRACKER_PRODUCTION_WRITES_APPROVED: 'false',
      }),
    ).toThrow(ConfigurationError);
  });

  it('requires an explicit assignee when Tracker writes are enabled', () => {
    expect(() =>
      parseServerEnvironment({
        ...validEnvironment,
        TRACKER_DRY_RUN: 'false',
        TRACKER_PRODUCTION_WRITES_APPROVED: 'true',
      }),
    ).toThrow(ConfigurationError);

    expect(
      parseServerEnvironment({
        ...validEnvironment,
        TRACKER_ASSIGNEE: 'robot-craft72',
        TRACKER_DRY_RUN: 'false',
        TRACKER_PRODUCTION_WRITES_APPROVED: 'true',
      }).TRACKER_ASSIGNEE,
    ).toBe('robot-craft72');
  });

  it('keeps API and upload quotas internally consistent', () => {
    for (const override of [
      { API_IP_RATE_LIMIT_MAX: '119' },
      { UPLOAD_MAX_STAGED_BYTES_PER_USER: '52428799' },
      { UPLOAD_MAX_TOTAL_BYTES_PER_USER: '262143999' },
    ]) {
      expect(() => parseServerEnvironment({ ...validEnvironment, ...override })).toThrow(
        ConfigurationError,
      );
    }
  });

  it('does not expose secret values in errors or structured issues', () => {
    const secrets = {
      DATABASE_URL: 'postgresql://<PRIVATE_USER>:<PRIVATE_PASSWORD>@127.0.0.1:5432/craft72_max_app',
      MAX_BOT_TOKEN: '<VERY_SENSITIVE_MAX_TOKEN>',
      MAX_WEBHOOK_SECRET: '<VERY_SENSITIVE_WEBHOOK_SECRET>',
      TRACKER_TOKEN: '<VERY_SENSITIVE_TRACKER_TOKEN>',
    } as const;

    try {
      parseServerEnvironment({ ...validEnvironment, ...secrets });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);

      for (const secret of Object.values(secrets)) {
        expect(String(error)).not.toContain(secret);
        expect(JSON.stringify(error)).not.toContain(secret);
      }

      return;
    }

    throw new Error('Expected configuration parsing to fail');
  });

  it('requires HTTPS for the production public URL', () => {
    expect(() =>
      parseServerEnvironment({
        ...validEnvironment,
        PUBLIC_BASE_URL: 'http://craft72app.ru',
      }),
    ).toThrow(ConfigurationError);
  });

  it('requires an approved HTTPS privacy policy and version', () => {
    expect(() =>
      parseServerEnvironment({
        ...validEnvironment,
        PRIVACY_POLICY_URL: '<APPROVED_HTTPS_URL>',
      }),
    ).toThrow(ConfigurationError);
    expect(() =>
      parseServerEnvironment({
        ...validEnvironment,
        CONSENT_VERSION: 'invalid version',
      }),
    ).toThrow(ConfigurationError);
  });

  it('enforces the retention limits published by the Mini App policy', () => {
    for (const override of [
      { SUBMISSION_RETENTION_DAYS: '1096' },
      { LOG_RETENTION_DAYS: '91' },
      { BACKUP_RETENTION_DAYS: '31' },
    ]) {
      expect(() => parseServerEnvironment({ ...validEnvironment, ...override })).toThrow(
        ConfigurationError,
      );
    }
  });
});
