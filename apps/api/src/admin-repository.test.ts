import { describe, expect, it } from 'vitest';

import { buildAdminContactHandoffMessage } from './admin-repository.js';

describe('admin contact handoff outbox message', () => {
  it('uses the exact MAX profile name and numeric user mention supported by bot messages', () => {
    expect(
      buildAdminContactHandoffMessage('CRAFT-20260718-ABCDEF', {
        id: '347125190',
        firstName: 'Иван',
        lastName: 'Гришанов',
      }),
    ).toEqual({
      format: 'markdown',
      notify: true,
      text:
        'Контакт по заявке **CRAFT-20260718-ABCDEF**\n\n' +
        '[Иван Гришанов](max://user/347125190)\n\n' +
        'Нажмите на имя, чтобы открыть профиль и написать пользователю в MAX.',
    });
  });

  it('escapes MAX profile names as markdown without changing the rendered full name', () => {
    const message = buildAdminContactHandoffMessage('CRAFT-1', {
      id: '70000001',
      firstName: 'Ив\\ан [тест]',
      lastName: null,
    });

    expect(message.text).toContain('[Ив\\\\ан \\[тест\\]](max://user/70000001)');
    expect(message.text).not.toContain('mailto:');
  });
});
