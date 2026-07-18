import { describe, expect, it, vi } from 'vitest';

import type { JsonObject } from '@craft72/database';

import { MaxApiClient } from './max-api.js';
import type {
  BotWorkerStore,
  ClaimedOutboundAction,
  ClaimedWebhook,
  WebhookProcessingResult,
} from './repository.js';
import { runWorkerCycle } from './runtime.js';

const NOW = new Date('2026-07-16T03:00:00.000Z');
const TOKEN = 'worker-test-token-with-enough-entropy';

class MemoryWorkerStore implements BotWorkerStore {
  public outbound: ClaimedOutboundAction | null = null;
  public webhook: ClaimedWebhook | null = null;
  public completedOutbound = false;
  public completedWebhook: WebhookProcessingResult | null = null;
  public outboundFailure: { errorCode: string; retryAt: Date | null } | null = null;
  public webhookFailure: { errorCode: string; retryAt: Date | null } | null = null;
  public publishedContent: JsonObject | null = null;
  public publishedContentError: Error | null = null;

  public async isReady(): Promise<void> {
    return undefined;
  }

  public async getPublishedContent(): Promise<JsonObject | null> {
    if (this.publishedContentError !== null) throw this.publishedContentError;
    return this.publishedContent;
  }

  public async claimWebhook(): Promise<ClaimedWebhook | null> {
    const claim = this.webhook;
    this.webhook = null;
    return claim;
  }

  public async completeWebhook(
    _claim: ClaimedWebhook,
    result: WebhookProcessingResult,
  ): Promise<void> {
    this.completedWebhook = result;
    const send = result.actions[0];
    if (send !== undefined) {
      this.outbound = {
        action: send.action,
        attempts: 1,
        chatId: send.chatId,
        id: '10000000-0000-4000-8000-000000000001',
        payload: send.payload,
      };
    }
  }

  public async failWebhook(
    _claim: ClaimedWebhook,
    errorCode: string,
    retryAt: Date | null,
  ): Promise<void> {
    this.webhookFailure = { errorCode, retryAt };
  }

  public async claimOutboundAction(): Promise<ClaimedOutboundAction | null> {
    const claim = this.outbound;
    this.outbound = null;
    return claim;
  }

  public async completeOutboundAction(): Promise<void> {
    this.completedOutbound = true;
  }

  public async failOutboundAction(
    _claim: ClaimedOutboundAction,
    errorCode: string,
    retryAt: Date | null,
  ): Promise<void> {
    this.outboundFailure = { errorCode, retryAt };
  }
}

function options(store: MemoryWorkerStore, fetch: typeof globalThis.fetch) {
  return {
    baseDelayMs: 1_000,
    leaseSeconds: 60,
    managerDisplayName: 'Ivan Grishanow',
    managerUserId: '347125190',
    maxApi: new MaxApiClient({ fetch, token: TOKEN }),
    maxAttempts: 8,
    maximumDelayMs: 300_000,
    now: () => NOW,
    pollIntervalMs: 500,
    random: () => 0.5,
    store,
    webApp: 'craft72_bot',
  } as const;
}

describe('Stage 4 worker cycle', () => {
  it('uses a valid published bot-welcome document for bot_started', async () => {
    const store = new MemoryWorkerStore();
    store.publishedContent = { text: '  Добро пожаловать в КРАФТ!  ' };
    store.webhook = {
      attempts: 1,
      chatId: 182182182n,
      eventKey: 'max:bot_started:published-welcome',
      eventType: 'bot_started',
      payload: {
        chat_id: 182182182,
        timestamp: NOW.getTime(),
        update_type: 'bot_started',
        user: { user_id: 123456789, first_name: 'Иван', is_bot: false },
      },
    };
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ message: { body: { mid: 'mid.welcome' } } })),
    );

    await runWorkerCycle(options(store, fetchMock));

    expect(store.completedWebhook?.actions[0]?.payload).toMatchObject({
      text: 'Добро пожаловать в КРАФТ!',
    });
    expect(store.completedWebhook?.actions[0]?.payload).toHaveProperty('attachments');
  });

  it('delivers the manager deep-link handoff with a clickable MAX user mention', async () => {
    const store = new MemoryWorkerStore();
    store.webhook = {
      attempts: 1,
      chatId: 182182182n,
      eventKey: 'max:bot_started:manager-contact',
      eventType: 'bot_started',
      payload: {
        chat_id: 182182182,
        payload: 'manager_contact',
        timestamp: NOW.getTime(),
        update_type: 'bot_started',
        user: { user_id: 123456789, first_name: 'Иван', is_bot: false },
      },
    };
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ message: { body: { mid: 'mid.manager' } } })),
    );

    await runWorkerCycle(options(store, fetchMock));

    expect(store.completedWebhook?.actions[0]?.payload).toMatchObject({
      format: 'markdown',
      text: expect.stringContaining('[Ivan Grishanow](max://user/347125190)'),
    });
    const request = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      format: 'markdown',
      text: expect.stringContaining('(max://user/347125190)'),
    });
  });

  it.each([
    ['invalid document', { text: '   ' }, null],
    ['read failure', null, new Error('database unavailable')],
  ])('falls back to the built-in greeting after a %s', async (_case, content, readError) => {
    const store = new MemoryWorkerStore();
    store.publishedContent = content;
    store.publishedContentError = readError;
    store.webhook = {
      attempts: 1,
      chatId: 182182182n,
      eventKey: `max:bot_started:${_case}`,
      eventType: 'bot_started',
      payload: {
        chat_id: 182182182,
        timestamp: NOW.getTime(),
        update_type: 'bot_started',
        user: { user_id: 123456789, first_name: 'Иван', is_bot: false },
      },
    };
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ message: { body: { mid: 'mid.welcome' } } })),
    );

    await runWorkerCycle(options(store, fetchMock));

    expect(store.completedWebhook?.actions[0]?.payload.text).toMatch(
      /Здравствуйте![\s\S]*проектного бюро КРАФТ/,
    );
  });

  it('turns one free-text webhook into one inquiry and one delivered outbox action', async () => {
    const store = new MemoryWorkerStore();
    store.webhook = {
      attempts: 1,
      chatId: 182182182n,
      eventKey: 'max:message_created:event-one',
      eventType: 'message_created',
      payload: {
        update_type: 'message_created',
        timestamp: NOW.getTime(),
        message: {
          recipient: { chat_id: 182182182 },
          sender: { user_id: 123456789, is_bot: false },
          body: { mid: 'mid.one', text: 'Нужен проект' },
        },
      },
    };
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ message: { body: { mid: 'mid.reply' } } }), { status: 200 }),
    );

    await expect(runWorkerCycle(options(store, fetchMock))).resolves.toEqual({
      outboundClaimed: true,
      webhookClaimed: true,
    });
    expect(store.completedWebhook?.inquiry).toMatchObject({ bodyText: 'Нужен проект' });
    expect(store.completedWebhook?.actions).toHaveLength(1);
    expect(store.completedOutbound).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('delivers a durable callback answer without requiring a chat or source message', async () => {
    const store = new MemoryWorkerStore();
    store.outbound = {
      action: 'answer_callback',
      attempts: 1,
      chatId: null,
      id: '10000000-0000-4000-8000-000000000004',
      payload: {
        callbackId: 'callback-deleted-message',
        body: { notification: 'Откройте Mini App' },
      },
    };
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ success: true }), { status: 200 }),
    );

    await runWorkerCycle(options(store, fetchMock));

    expect(store.completedOutbound).toBe(true);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://platform-api2.max.ru/answers?callback_id=callback-deleted-message',
    );
  });

  it('releases an action claimed during shutdown without calling MAX', async () => {
    const controller = new AbortController();
    class ShutdownStore extends MemoryWorkerStore {
      public override async claimOutboundAction(): Promise<ClaimedOutboundAction | null> {
        const claim = await super.claimOutboundAction();
        controller.abort();
        return claim;
      }
    }

    const store = new ShutdownStore();
    store.outbound = {
      action: 'send_message',
      attempts: 1,
      chatId: 182182182n,
      id: '10000000-0000-4000-8000-000000000005',
      payload: { text: 'Не отправлять при остановке' },
    };
    const fetchMock = vi.fn<typeof fetch>();

    await expect(runWorkerCycle(options(store, fetchMock), controller.signal)).resolves.toEqual({
      outboundClaimed: true,
      webhookClaimed: false,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.outboundFailure).toEqual({ errorCode: 'worker_shutdown', retryAt: NOW });
  });

  it('retries 429 after Retry-After without exposing the response body', async () => {
    const store = new MemoryWorkerStore();
    store.outbound = {
      action: 'send_message',
      attempts: 2,
      chatId: 182182182n,
      id: '10000000-0000-4000-8000-000000000002',
      payload: { text: 'Ответ' },
    };
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response('private failure', { headers: { 'retry-after': '7' }, status: 429 }),
    );

    await runWorkerCycle(options(store, fetchMock));
    expect(store.outboundFailure).toEqual({
      errorCode: 'max_http_429',
      retryAt: new Date(NOW.getTime() + 7_000),
    });
  });

  it('dead-letters permanent MAX 401 and malformed webhook payloads', async () => {
    const store = new MemoryWorkerStore();
    store.outbound = {
      action: 'send_message',
      attempts: 1,
      chatId: 182182182n,
      id: '10000000-0000-4000-8000-000000000003',
      payload: { text: 'Ответ' },
    };
    store.webhook = {
      attempts: 1,
      chatId: null,
      eventKey: 'max:future:invalid',
      eventType: 'future_event',
      payload: { update_type: 'future_event', timestamp: 0 },
    };
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 401 }));

    await runWorkerCycle(options(store, fetchMock));
    expect(store.webhookFailure).toEqual({ errorCode: 'max_update_invalid', retryAt: null });
    expect(store.outboundFailure).toEqual({ errorCode: 'max_http_401', retryAt: null });
  });
});
