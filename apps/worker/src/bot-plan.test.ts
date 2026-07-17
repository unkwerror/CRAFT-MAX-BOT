import { describe, expect, it } from 'vitest';

import { createOpenAppKeyboard, planBotActions } from './bot-plan.js';
import { parseMaxUpdate } from './max-update.js';

const WEB_APP = 'craft72_bot';

const lifecycle = (updateType: 'bot_started' | 'bot_stopped', timestamp = 1_775_025_604_499) =>
  parseMaxUpdate({
    chat_id: 182_182_182,
    timestamp,
    update_type: updateType,
    user: { user_id: 123_456_789, first_name: 'Иван', is_bot: false },
  });

const message = (text: string, isBot = false, timestamp = 1_775_025_604_500) =>
  parseMaxUpdate({
    message: {
      recipient: { chat_id: 182_182_182, chat_type: 'dialog' },
      body: { mid: `mid.${timestamp}`, text },
      sender: { user_id: isBot ? 229_229_229 : 123_456_789, is_bot: isBot },
    },
    timestamp,
    update_type: 'message_created',
  });

describe('planBotActions', () => {
  it('builds the documented open_app keyboard with every approved start payload', () => {
    expect(createOpenAppKeyboard(WEB_APP)).toEqual({
      type: 'inline_keyboard',
      payload: {
        buttons: [
          [
            {
              type: 'open_app',
              text: 'Заполнить анкету',
              web_app: WEB_APP,
              payload: 'new_project',
            },
          ],
          [
            { type: 'open_app', text: 'Подобрать услугу', web_app: WEB_APP, payload: 'services' },
            { type: 'open_app', text: 'Проекты', web_app: WEB_APP, payload: 'portfolio' },
          ],
          [
            {
              type: 'open_app',
              text: 'Отправить материалы',
              web_app: WEB_APP,
              payload: 'upload_brief',
            },
          ],
          [{ type: 'message', text: 'Связаться с менеджером' }],
        ],
      },
    });
  });

  it('rejects URLs and malformed public names as MAX web_app values', () => {
    for (const webApp of ['', 'https://craft72app.ru', 'bot name', '<BOT_PUBLIC_NAME>']) {
      expect(() => createOpenAppKeyboard(webApp)).toThrow(TypeError);
    }
  });

  it('welcomes bot_started and /start with a shared short-window idempotency key', () => {
    const started = planBotActions(lifecycle('bot_started'), { webApp: WEB_APP });
    const startCommand = planBotActions(message('/start'), { webApp: WEB_APP });
    const startedSend = started.find(({ kind }) => kind === 'send_message');
    const commandSend = startCommand.find(({ kind }) => kind === 'send_message');

    expect(started.map(({ kind }) => kind)).toEqual(['set_dialog_state', 'send_message']);
    expect(commandSend?.idempotencyKey).toBe(startedSend?.idempotencyKey);
    expect(startedSend).toMatchObject({
      chatId: '182182182',
      kind: 'send_message',
      body: {
        text: expect.stringMatching(/Здравствуйте! Это КРАФТ[\s\S]*мини-приложени/i),
      },
    });
  });

  it('answers manager contact with a dedicated handoff message', () => {
    const actions = planBotActions(message('Связаться с менеджером'), { webApp: WEB_APP });
    const send = actions.find(({ kind }) => kind === 'send_message');
    expect(send).toMatchObject({
      kind: 'send_message',
      body: { text: expect.stringContaining('менеджер КРАФТ получит обращение') },
    });
    expect(actions.some(({ kind }) => kind === 'save_inquiry')).toBe(true);
  });

  it('stores free text and creates deterministic routing actions', () => {
    const update = message('  Нужен эскизный проект  ');
    const first = planBotActions(update, { webApp: WEB_APP });
    const replay = planBotActions(update, { webApp: WEB_APP });

    expect(first).toEqual(replay);
    expect(first.map(({ kind }) => kind)).toEqual([
      'set_dialog_state',
      'save_inquiry',
      'send_message',
    ]);
    expect(first[1]).toMatchObject({
      chatId: '182182182',
      kind: 'save_inquiry',
      maxUserId: '123456789',
      messageId: 'mid.1775025604500',
      text: 'Нужен эскизный проект',
    });
    expect(new Set(first.map(({ idempotencyKey }) => idempotencyKey)).size).toBe(first.length);
  });

  it('filters bot-authored messages and marks bot_stopped without sending', () => {
    expect(planBotActions(message('echo', true), { webApp: WEB_APP })).toEqual([]);
    expect(planBotActions(lifecycle('bot_stopped'), { webApp: WEB_APP })).toEqual([
      expect.objectContaining({ active: false, chatId: '182182182', kind: 'set_dialog_state' }),
    ]);
  });

  it('does not claim an attachment-only message was stored as an inquiry', () => {
    const update = parseMaxUpdate({
      message: {
        recipient: { chat_id: 182_182_182 },
        body: { mid: 'mid.attachment', attachments: [{ type: 'image' }] },
        sender: { user_id: 123_456_789, is_bot: false },
      },
      timestamp: 1_775_025_604_502,
      update_type: 'message_created',
    });
    const actions = planBotActions(update, { webApp: WEB_APP });

    expect(actions.map(({ kind }) => kind)).toEqual(['set_dialog_state', 'send_message']);
    expect(actions[1]).toMatchObject({
      body: { text: expect.stringContaining('только текстовые обращения') },
    });
  });

  it('routes legacy callbacks through the current Mini App keyboard', () => {
    const update = parseMaxUpdate({
      callback: {
        callback_id: 'callback-id',
        payload: 'legacy',
        user: { user_id: 123_456_789, is_bot: false },
      },
      message: {
        recipient: { chat_id: 182_182_182 },
        body: { mid: 'mid.callback' },
        sender: { user_id: 229_229_229, is_bot: true },
      },
      timestamp: 1_775_025_604_500,
      update_type: 'message_callback',
    });
    const actions = planBotActions(update, { webApp: WEB_APP });

    expect(actions.map(({ kind }) => kind)).toEqual(['set_dialog_state', 'answer_callback']);
    expect(actions[1]).toMatchObject({
      body: { message: { text: 'Откройте нужный раздел мини-приложения КРАФТ:' } },
      callbackId: 'callback-id',
      kind: 'answer_callback',
    });
  });

  it('answers a callback even when MAX no longer includes its deleted source message', () => {
    const update = parseMaxUpdate({
      callback: {
        callback_id: 'callback-without-message',
        payload: 'legacy',
        user: { user_id: 123_456_789, is_bot: false },
      },
      message: null,
      timestamp: 1_775_025_604_501,
      update_type: 'message_callback',
    });

    expect(planBotActions(update, { webApp: WEB_APP })).toEqual([
      expect.objectContaining({
        callbackId: 'callback-without-message',
        chatId: null,
        kind: 'answer_callback',
      }),
    ]);
  });
});
