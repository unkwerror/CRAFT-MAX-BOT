import { describe, expect, it } from 'vitest';

import { resolvePrivacyConfiguration } from './privacy-config.js';

describe('privacy runtime configuration', () => {
  it('keeps production data disabled until both approved values are provided', () => {
    expect(resolvePrivacyConfiguration({})).toEqual({
      consentVersion: 'mock-v1-not-for-production',
      policyUrl: null,
      productionDataEnabled: false,
    });
    expect(
      resolvePrivacyConfiguration({ VITE_PRIVACY_POLICY_URL: 'https://craft72.ru/privacy' }),
    ).toMatchObject({ productionDataEnabled: false });
  });

  it('enables the production backend only for an HTTPS policy and valid version', () => {
    expect(
      resolvePrivacyConfiguration({
        VITE_CONSENT_VERSION: 'privacy-2026-07-15',
        VITE_PRIVACY_POLICY_URL: 'https://craft72.ru/privacy',
      }),
    ).toEqual({
      consentVersion: 'privacy-2026-07-15',
      policyUrl: 'https://craft72.ru/privacy',
      productionDataEnabled: true,
    });
  });

  it('rejects placeholders, credentials, HTTP and malformed consent versions', () => {
    for (const policyUrl of [
      '<APPROVED_HTTPS_URL>',
      'http://craft72.ru/privacy',
      'https://user:secret@craft72.ru/privacy',
    ]) {
      expect(
        resolvePrivacyConfiguration({
          VITE_CONSENT_VERSION: 'privacy-v1',
          VITE_PRIVACY_POLICY_URL: policyUrl,
        }).productionDataEnabled,
      ).toBe(false);
    }

    expect(
      resolvePrivacyConfiguration({
        VITE_CONSENT_VERSION: 'invalid version',
        VITE_PRIVACY_POLICY_URL: 'https://craft72.ru/privacy',
      }).productionDataEnabled,
    ).toBe(false);
  });
});
