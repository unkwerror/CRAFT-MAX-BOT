import { describe, expect, it } from 'vitest';

import { resolveMaxBotConfiguration } from './bot-config.js';

describe('MAX bot runtime configuration', () => {
  it('accepts an exact public MAX bot link', () => {
    expect(resolveMaxBotConfiguration({ VITE_MAX_BOT_URL: 'https://max.ru/craft72_bot' })).toEqual({
      url: 'https://max.ru/craft72_bot',
      managerUrl: null,
      managerUserId: null,
    });
  });

  it('builds a manager deep-link from a numeric MAX user id', () => {
    expect(
      resolveMaxBotConfiguration({
        VITE_MAX_BOT_URL: 'https://max.ru/se13560957_bot',
        VITE_MAX_MANAGER_USER_ID: '347125190',
      }),
    ).toEqual({
      url: 'https://max.ru/se13560957_bot',
      managerUserId: '347125190',
      managerUrl: 'https://max.ru/347125190',
    });
  });

  it('keeps the manager link disabled when the setting is absent', () => {
    expect(resolveMaxBotConfiguration({})).toEqual({
      url: null,
      managerUrl: null,
      managerUserId: null,
    });
  });

  it.each([
    'http://max.ru/craft72_bot',
    'https://user:secret@max.ru/craft72_bot',
    'https://max.ru:443/craft72_bot',
    'https://max.ru/craft72-bot',
    'https://max.ru/craft72_bot/extra',
    'https://max.ru/craft72_bot?startapp=new_project',
    'https://max.ru/craft72_bot#chat',
    'https://max.ru.evil.example/craft72_bot',
  ])('rejects a non-canonical or unsafe link: %s', (value) => {
    expect(resolveMaxBotConfiguration({ VITE_MAX_BOT_URL: value })).toEqual({
      url: null,
      managerUrl: null,
      managerUserId: null,
    });
  });

  it.each(['0', 'abc', '12', '347125190;', '347125190/extra'])(
    'rejects an unsafe manager user id: %s',
    (value) => {
      expect(
        resolveMaxBotConfiguration({
          VITE_MAX_BOT_URL: 'https://max.ru/se13560957_bot',
          VITE_MAX_MANAGER_USER_ID: value,
        }),
      ).toEqual({
        url: 'https://max.ru/se13560957_bot',
        managerUrl: null,
        managerUserId: null,
      });
    },
  );
});
