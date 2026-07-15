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
  MAX_API_BASE_URL: 'https://platform-api2.max.ru',
  MAX_BOT_TOKEN: 'rotated-token-with-enough-length',
  MAX_WEBHOOK_SECRET: 'a-random-webhook-secret-with-32-characters',
  MAX_INIT_DATA_MAX_AGE_SECONDS: '3600',
  DATABASE_URL: 'postgresql://craft72:password@127.0.0.1:5432/craft72_max_app',
  TRACKER_API_BASE_URL: 'https://api.tracker.yandex.net/v3',
  TRACKER_AUTH_TYPE: 'oauth',
  TRACKER_TOKEN: 'tracker-token-with-enough-length',
  TRACKER_ORG_HEADER: 'X-Org-ID',
  TRACKER_ORG_ID: 'organization-id',
  TRACKER_QUEUE_CRM: 'CRM',
  TRACKER_QUEUE_PART: 'PART',
  TRACKER_QUEUE_DOCS: 'DOCS',
  TRACKER_DRY_RUN: 'true',
  UPLOAD_MAX_BYTES: '52428800',
  UPLOAD_STAGING_TTL_SECONDS: '86400',
  UPLOAD_STORAGE_PATH: '/srv/craft72-max-app/uploads',
  LOG_LEVEL: 'info',
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
  });

  it('rejects unsupported MAX API endpoints', () => {
    expect(() =>
      parseServerEnvironment({
        ...validEnvironment,
        MAX_API_BASE_URL: 'https://api.max.ru',
      }),
    ).toThrow(ConfigurationError);
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
});
