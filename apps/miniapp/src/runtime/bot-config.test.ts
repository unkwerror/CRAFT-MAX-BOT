import { describe, expect, it } from 'vitest';

import { resolveMaxBotConfiguration } from './bot-config.js';

describe('MAX bot runtime configuration', () => {
  it('accepts an exact public MAX bot link', () => {
    expect(resolveMaxBotConfiguration({ VITE_MAX_BOT_URL: 'https://max.ru/craft72_bot' })).toEqual({
      url: 'https://max.ru/craft72_bot',
      managerProfileUrl: null,
      managerUserId: null,
      managerPhone: null,
    });
  });

  it('keeps a numeric MAX user id only for the native profile fallback', () => {
    expect(
      resolveMaxBotConfiguration({
        VITE_MAX_BOT_URL: 'https://max.ru/se13560957_bot',
        VITE_MAX_MANAGER_USER_ID: '61096226',
      }),
    ).toEqual({
      url: 'https://max.ru/se13560957_bot',
      managerUserId: '61096226',
      managerProfileUrl: null,
      managerPhone: null,
    });
  });

  it.each(['https://max.ru/craft_manager', 'https://max.ru/u/AbC_def-0123456789'])(
    'accepts a canonical copied manager profile link: %s',
    (value) => {
      expect(resolveMaxBotConfiguration({ VITE_MAX_MANAGER_PROFILE_URL: value })).toEqual({
        url: null,
        managerProfileUrl: value,
        managerUserId: null,
        managerPhone: null,
      });
    },
  );

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
      managerProfileUrl: null,
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
      managerProfileUrl: null,
      managerUserId: null,
      managerPhone: null,
    });
  });

  it.each(['0', 'abc', '12', '61096226;', '61096226/extra', '9223372036854775808'])(
    'rejects an unsafe manager user id: %s',
    (value) => {
      expect(
        resolveMaxBotConfiguration({
          VITE_MAX_BOT_URL: 'https://max.ru/se13560957_bot',
          VITE_MAX_MANAGER_USER_ID: value,
        }),
      ).toEqual({
        url: 'https://max.ru/se13560957_bot',
        managerProfileUrl: null,
        managerUserId: null,
        managerPhone: null,
      });
    },
  );

  it.each([
    'http://max.ru/craft_manager',
    'https://user:secret@max.ru/craft_manager',
    'https://max.ru:443/craft_manager',
    'https://max.ru/u/',
    'https://max.ru/u/token/extra',
    'https://max.ru/craft-manager',
    'https://max.ru/craft_manager/',
    'https://max.ru/craft_manager?chat=1',
    'https://max.ru/craft_manager#profile',
    'https://max.ru.evil.example/craft_manager',
    'https://max.ru/%63raft_manager',
  ])('rejects a non-canonical or unsafe manager profile link: %s', (value) => {
    expect(
      resolveMaxBotConfiguration({ VITE_MAX_MANAGER_PROFILE_URL: value }).managerProfileUrl,
    ).toBeNull();
  });

  it.each(['123', '++7922', 'not-a-phone', '79220063645x'])(
    'rejects an unsafe manager phone: %s',
    (value) => {
      expect(resolveMaxBotConfiguration({ VITE_MAX_MANAGER_PHONE: value }).managerPhone).toBeNull();
    },
  );
});
