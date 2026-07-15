import { MOCK_CONSENT_VERSION } from '../content.js';

const CONSENT_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export interface PrivacyConfiguration {
  readonly consentVersion: string;
  readonly policyUrl: string | null;
  readonly productionDataEnabled: boolean;
}

function approvedHttpsUrl(value: string | undefined): string | null {
  if (value === undefined || value.trim() === '' || value.includes('<')) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function resolvePrivacyConfiguration(environment: {
  readonly VITE_CONSENT_VERSION?: string;
  readonly VITE_PRIVACY_POLICY_URL?: string;
}): PrivacyConfiguration {
  const policyUrl = approvedHttpsUrl(environment.VITE_PRIVACY_POLICY_URL);
  const version = environment.VITE_CONSENT_VERSION?.trim();
  const approvedVersion =
    version !== undefined &&
    version !== MOCK_CONSENT_VERSION &&
    CONSENT_VERSION_PATTERN.test(version)
      ? version
      : null;

  return {
    consentVersion: approvedVersion ?? MOCK_CONSENT_VERSION,
    policyUrl,
    productionDataEnabled: policyUrl !== null && approvedVersion !== null,
  };
}

export const privacyConfiguration = resolvePrivacyConfiguration({
  VITE_CONSENT_VERSION: import.meta.env.VITE_CONSENT_VERSION,
  VITE_PRIVACY_POLICY_URL: import.meta.env.VITE_PRIVACY_POLICY_URL,
});
