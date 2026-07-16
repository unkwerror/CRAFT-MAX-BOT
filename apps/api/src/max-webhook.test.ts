import { describe, expect, it } from 'vitest';

import { isValidMaxWebhookSecret, parseMaxWebhookUpdate } from './max-webhook.js';

describe('MAX webhook envelope', () => {
  it('uses a MAX message id for stable deduplication and accepts signed chat ids', () => {
    const first = parseMaxWebhookUpdate({
      update_type: 'message_created',
      timestamp: 1_784_102_400_000,
      message: {
        recipient: { chat_id: -70801090403050 },
        body: { mid: 'mid.stable', text: 'Первый текст' },
      },
    });
    const repeated = parseMaxWebhookUpdate({
      update_type: 'message_created',
      timestamp: 1_784_102_400_001,
      message: {
        recipient: { chat_id: -70801090403050 },
        body: { mid: 'mid.stable', text: 'Первый текст', future_field: true },
      },
    });

    expect(first.eventKey).toBe(repeated.eventKey);
    expect(first.chatId).toBe(-70801090403050n);
  });

  it('compares webhook secrets without returning the secret', () => {
    const secret = 'webhook_secret_with_at_least_32_characters';
    expect(isValidMaxWebhookSecret(secret, secret)).toBe(true);
    expect(isValidMaxWebhookSecret(undefined, secret)).toBe(false);
    expect(isValidMaxWebhookSecret(`${secret}_wrong`, secret)).toBe(false);
  });
});
