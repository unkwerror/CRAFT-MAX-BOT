import { describe, expect, it } from 'vitest';

import { resolveMaxBotConfiguration } from './bot-config.js';

describe('MAX bot runtime configuration', () => {
  it('accepts an exact public MAX bot link', () => {
    expect(resolveMaxBotConfiguration({ VITE_MAX_BOT_URL: 'https://max.ru/craft72_bot' })).toEqual({
      url: 'https://max.ru/craft72_bot',
    });
  });

  it('keeps the manager link disabled when the setting is absent', () => {
    expect(resolveMaxBotConfiguration({})).toEqual({ url: null });
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
    expect(resolveMaxBotConfiguration({ VITE_MAX_BOT_URL: value })).toEqual({ url: null });
  });
});
