const MAX_BOT_URL_PATTERN = /^https:\/\/max\.ru\/[A-Za-z0-9_]+$/;
const MAX_MANAGER_USER_ID_PATTERN = /^[1-9][0-9]{4,20}$/;

export interface MaxBotConfiguration {
  /** Bot public profile used for Mini App deep-links. */
  readonly url: string | null;
  /** Direct manager dialog deep-link inside MAX, if configured. */
  readonly managerUrl: string | null;
  readonly managerUserId: string | null;
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
  return MAX_MANAGER_USER_ID_PATTERN.test(trimmed) ? trimmed : null;
}

export function resolveMaxBotConfiguration(environment: {
  readonly VITE_MAX_BOT_URL?: string;
  readonly VITE_MAX_MANAGER_USER_ID?: string;
}): MaxBotConfiguration {
  const managerUserId = approvedManagerUserId(environment.VITE_MAX_MANAGER_USER_ID);
  return {
    url: approvedMaxBotUrl(environment.VITE_MAX_BOT_URL),
    managerUserId,
    managerUrl: managerUserId === null ? null : `https://max.ru/${managerUserId}`,
  };
}

export const maxBotConfiguration = resolveMaxBotConfiguration({
  VITE_MAX_BOT_URL: import.meta.env.VITE_MAX_BOT_URL,
  VITE_MAX_MANAGER_USER_ID: import.meta.env.VITE_MAX_MANAGER_USER_ID,
});
