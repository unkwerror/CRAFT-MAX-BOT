import { describe, expect, it } from 'vitest';

import { MaxUpdateParseError, parseMaxUpdate, parseMaxUpdateJson } from './max-update.js';

const messageCreated = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  message: {
    recipient: { chat_id: -70_801_090_403_050, chat_type: 'chat' },
    timestamp: 1_775_053_255_737,
    body: { mid: 'mid.ffffbdb48e6c3775019d496b34394b84', seq: 116, text: 'Нужен проект' },
    sender: { user_id: 123_456_789, first_name: 'Иван', is_bot: false },
  },
  timestamp: 1_775_025_604_499,
  update_type: 'message_created',
  ...overrides,
});

describe('parseMaxUpdate', () => {
  it('extracts stable message identity and actor data without dropping the raw payload', () => {
    const parsed = parseMaxUpdate(messageCreated({ future_field: { enabled: true } }));

    expect(parsed).toMatchObject({
      actorIsBot: false,
      actorUserId: '123456789',
      callbackId: null,
      chatId: '-70801090403050',
      messageId: 'mid.ffffbdb48e6c3775019d496b34394b84',
      messageText: 'Нужен проект',
      startPayload: null,
      timestampMs: 1_775_025_604_499,
      updateType: 'message_created',
    });
    expect(parsed.eventKey).toMatch(/^max:message_created:[a-f0-9]{64}$/);
    expect(parsed.raw.future_field).toEqual({ enabled: true });
    expect(parseMaxUpdate(messageCreated()).eventKey).toBe(parsed.eventKey);
  });

  it('extracts the official bot deep-link payload from bot_started', () => {
    const parsed = parseMaxUpdate({
      chat_id: 182_182_182,
      payload: 'manager_contact',
      timestamp: 1_775_025_604_500,
      update_type: 'bot_started',
      user: { user_id: 123_456_789, first_name: 'Иван', is_bot: false },
    });

    expect(parsed.startPayload).toBe('manager_contact');
  });

  it('uses callback_id rather than the bot-authored message as callback identity', () => {
    const callback = {
      callback: {
        callback_id: 'callback-one',
        payload: 'legacy-route',
        timestamp: 1_775_026_702_210,
        user: { user_id: 123_456_789, first_name: 'Иван', is_bot: false },
      },
      message: {
        recipient: { chat_id: 182_182_182, chat_type: 'dialog' },
        body: { mid: 'mid.shared', text: 'Старое сообщение' },
        sender: { user_id: 229_229_229, first_name: 'CRAFT72', is_bot: true },
      },
      timestamp: 1_775_025_604_499,
      update_type: 'message_callback',
    };

    const first = parseMaxUpdate(callback);
    const second = parseMaxUpdate({
      ...callback,
      callback: { ...callback.callback, callback_id: 'callback-two' },
    });
    expect(first).toMatchObject({
      actorIsBot: false,
      actorUserId: '123456789',
      callbackId: 'callback-one',
      callbackPayload: 'legacy-route',
      chatId: '182182182',
    });
    expect(second.eventKey).not.toBe(first.eventKey);
  });

  it('accepts unknown future update types and canonicalizes their fallback identity', () => {
    const left = parseMaxUpdate({
      update_type: 'future_event',
      timestamp: 1_775_025_604_500,
      future: { b: 2, a: 1 },
    });
    const right = parseMaxUpdateJson(
      '{"future":{"a":1,"b":2},"timestamp":1775025604500,"update_type":"future_event"}',
    );

    expect(right.eventKey).toBe(left.eventKey);
    expect(left.updateType).toBe('future_event');
  });

  it('rejects malformed envelopes and malformed JSON', () => {
    expect(() => parseMaxUpdate({ timestamp: 1 })).toThrow(MaxUpdateParseError);
    expect(() => parseMaxUpdate({ timestamp: 1, update_type: 'BAD TYPE' })).toThrow(
      MaxUpdateParseError,
    );
    expect(() => parseMaxUpdateJson('{')).toThrow(MaxUpdateParseError);
  });
});
