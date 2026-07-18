const MAX_BOT_URL_PATTERN = /^https:\/\/max\.ru\/[A-Za-z0-9_]+$/;
const MAX_MANAGER_PROFILE_URL_PATTERN =
  /^https:\/\/max\.ru\/(?:u\/[A-Za-z0-9_-]{1,256}|[A-Za-z0-9_]{1,128})$/;
const MAX_MANAGER_USER_ID_PATTERN = /^[1-9][0-9]{4,18}$/;
const MAX_SIGNED_INT64_MAX = 9_223_372_036_854_775_807n;
/** E.164, e.g. +79220063645 */
const MAX_MANAGER_PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;

export interface MaxBotConfiguration {
  /** Bot public profile used for Mini App deep-links. */
  readonly url: string | null;
  /** Canonical public manager profile link copied from MAX, if configured. */
  readonly managerProfileUrl: string | null;
  readonly managerUserId: string | null;
  /** Manager phone in E.164 (+7…); used for tel: contact. */
  readonly managerPhone: string | null;
}

function approvedManagerProfileUrl(value: string | undefined): string | null {
  if (value === undefined || !MAX_MANAGER_PROFILE_URL_PATTERN.test(value)) return null;

  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'max.ru' ||
      url.port !== '' ||
      url.username !== '' ||
      url.password !== '' ||
      url.search !== '' ||
      url.hash !== '' ||
      url.toString() !== value
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function approvedMaxBotUrl(value: string | undefined): string | null {
  if (value === undefined || !MAX_BOT_URL_PATTERN.test(value)) return null;

  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'max.ru' ||
      url.port !== '' ||
      url.username !== '' ||
      url.password !== '' ||
      url.search !== '' ||
      url.hash !== ''
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function approvedManagerUserId(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (!MAX_MANAGER_USER_ID_PATTERN.test(trimmed)) return null;
  return BigInt(trimmed) <= MAX_SIGNED_INT64_MAX ? trimmed : null;
}

function approvedManagerPhone(value: string | undefined): string | null {
  if (value === undefined) return null;
  // Keep digits and leading +; drop spaces/dashes from pasted numbers.
  const normalized = value.trim().replaceAll(/[\s()-]/g, '');
  const withPlus = normalized.startsWith('+')
    ? normalized
    : normalized.startsWith('8') && normalized.length === 11
      ? `+7${normalized.slice(1)}`
      : normalized.startsWith('7') && normalized.length === 11
        ? `+${normalized}`
        : normalized;
  return MAX_MANAGER_PHONE_PATTERN.test(withPlus) ? withPlus : null;
}

export function resolveMaxBotConfiguration(environment: {
  readonly VITE_MAX_BOT_URL?: string;
  readonly VITE_MAX_MANAGER_PHONE?: string;
  readonly VITE_MAX_MANAGER_PROFILE_URL?: string;
  readonly VITE_MAX_MANAGER_USER_ID?: string;
}): MaxBotConfiguration {
  const managerUserId = approvedManagerUserId(environment.VITE_MAX_MANAGER_USER_ID);
  const managerPhone = approvedManagerPhone(environment.VITE_MAX_MANAGER_PHONE);
  return {
    url: approvedMaxBotUrl(environment.VITE_MAX_BOT_URL),
    managerProfileUrl: approvedManagerProfileUrl(environment.VITE_MAX_MANAGER_PROFILE_URL),
    managerUserId,
    managerPhone,
  };
}

export const maxBotConfiguration = resolveMaxBotConfiguration({
  VITE_MAX_BOT_URL: import.meta.env.VITE_MAX_BOT_URL,
  VITE_MAX_MANAGER_PHONE: import.meta.env.VITE_MAX_MANAGER_PHONE,
  VITE_MAX_MANAGER_PROFILE_URL: import.meta.env.VITE_MAX_MANAGER_PROFILE_URL,
  VITE_MAX_MANAGER_USER_ID: import.meta.env.VITE_MAX_MANAGER_USER_ID,
});
