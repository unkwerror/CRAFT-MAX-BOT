const MAX_BOT_URL_PATTERN = /^https:\/\/max\.ru\/[A-Za-z0-9_]+$/;

export interface MaxBotConfiguration {
  readonly url: string | null;
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

export function resolveMaxBotConfiguration(environment: {
  readonly VITE_MAX_BOT_URL?: string;
}): MaxBotConfiguration {
  return { url: approvedMaxBotUrl(environment.VITE_MAX_BOT_URL) };
}

export const maxBotConfiguration = resolveMaxBotConfiguration({
  VITE_MAX_BOT_URL: import.meta.env.VITE_MAX_BOT_URL,
});
