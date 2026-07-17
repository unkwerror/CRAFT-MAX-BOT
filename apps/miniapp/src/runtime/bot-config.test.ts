import { describe, expect, it } from 'vitest';

import { resolveMaxBotConfiguration } from './bot-config.js';

describe('MAX bot runtime configuration', () => {
  it('accepts an exact public MAX bot link', () => {
    expect(resolveMaxBotConfiguration({ VITE_MAX_BOT_URL: 'https://max.ru/craft72_bot' })).toEqual({
      url: 'https://max.ru/craft72_bot',
      managerUrl: null,
      managerUserId: null,
      managerPhone: null,
    });
  });

  it('builds a manager deep-link from a numeric MAX user id', () => {
    expect(
      resolveMaxBotConfiguration({
        VITE_MAX_BOT_URL: 'https://max.ru/se13560957_bot',
        VITE_MAX_MANAGER_USER_ID: '61096226',
      }),
    ).toEqual({
      url: 'https://max.ru/se13560957_bot',
      managerUserId: '61096226',
      managerUrl: 'https://max.ru/61096226',
      managerPhone: null,
    });
  });

  it('accepts a manager phone in E.164 and normalizes 8… local form', () => {
    expect(
      resolveMaxBotConfiguration({
        VITE_MAX_BOT_URL: 'https://max.ru/se13560957_bot',
        VITE_MAX_MANAGER_PHONE: '+79220063645',
      }).managerPhone,
    ).toBe('+79220063645');
    expect(
      resolveMaxBotConfiguration({
        VITE_MAX_MANAGER_PHONE: '8 (922) 006-36-45',
      }).managerPhone,
    ).toBe('+79220063645');
  });

  it('keeps the manager link disabled when the setting is absent', () => {
    expect(resolveMaxBotConfiguration({})).toEqual({
      url: null,
      managerUrl: null,
      managerUserId: null,
      managerPhone: null,
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
      managerPhone: null,
    });
  });

  it.each(['0', 'abc', '12', '61096226;', '61096226/extra'])(
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
        managerPhone: null,
      });
    },
  );

  it.each(['123', '++7922', 'not-a-phone', '79220063645x'])(
    'rejects an unsafe manager phone: %s',
    (value) => {
      expect(resolveMaxBotConfiguration({ VITE_MAX_MANAGER_PHONE: value }).managerPhone).toBeNull();
    },
  );
});
