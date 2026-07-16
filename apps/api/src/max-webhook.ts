import { createHash, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

const MAX_EVENT_TYPE_LENGTH = 128;

export const MaxWebhookUpdateSchema = z
  .object({
    update_type: z.string().trim().min(1).max(MAX_EVENT_TYPE_LENGTH),
    timestamp: z.number().int().positive(),
  })
  .loose();

export type MaxWebhookUpdate = z.infer<typeof MaxWebhookUpdateSchema>;

export interface AcceptedMaxWebhook {
  readonly chatId: bigint | null;
  readonly eventKey: string;
  readonly eventType: string;
  readonly payload: MaxWebhookUpdate;
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;

  return `{${Object.entries(value)
    .filter(([, child]) => child !== undefined)
    .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(',')}}`;
}

function integerFromUnknown(value: unknown): bigint | null {
  const minimum = -9_223_372_036_854_775_808n;
  const maximum = 9_223_372_036_854_775_807n;
  if (typeof value === 'bigint') {
    return value !== 0n && value >= minimum && value <= maximum ? value : null;
  }
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value !== 0 ? BigInt(value) : null;
  }
  if (typeof value === 'string' && /^-?[1-9]\d{0,18}$/.test(value)) {
    try {
      const parsed = BigInt(value);
      return parsed >= minimum && parsed <= maximum ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function recordFromUnknown(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function extractChatId(update: MaxWebhookUpdate): bigint | null {
  const direct = integerFromUnknown(update.chat_id);
  if (direct !== null) return direct;

  const message = recordFromUnknown(update.message);
  const recipient = recordFromUnknown(message?.recipient);
  const fromMessage = integerFromUnknown(recipient?.chat_id);
  if (fromMessage !== null) return fromMessage;

  const callback = recordFromUnknown(update.callback);
  const callbackMessage = recordFromUnknown(callback?.message);
  const callbackRecipient = recordFromUnknown(callbackMessage?.recipient);
  return integerFromUnknown(callbackRecipient?.chat_id);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function eventIdentity(update: MaxWebhookUpdate, chatId: bigint | null): string {
  const callback = recordFromUnknown(update.callback);
  const callbackId = nonEmptyString(callback?.callback_id);
  if (callbackId !== null) return `${update.update_type}\0callback:${callbackId}`;

  const message = recordFromUnknown(update.message);
  const body = recordFromUnknown(message?.body);
  const messageId = nonEmptyString(body?.mid) ?? nonEmptyString(update.message_id);
  if (messageId !== null && update.update_type.startsWith('message_')) {
    return `${update.update_type}\0message:${messageId}`;
  }

  if (
    (update.update_type === 'bot_started' || update.update_type === 'bot_stopped') &&
    chatId !== null
  ) {
    const user = recordFromUnknown(update.user);
    const userId = integerFromUnknown(user?.user_id) ?? integerFromUnknown(update.user_id);
    return `${update.update_type}\0chat:${chatId.toString()}\0user:${userId?.toString() ?? 'unknown'}\0timestamp:${String(update.timestamp)}`;
  }

  return `${update.update_type}\0payload:${canonicalJson(update)}`;
}

export function parseMaxWebhookUpdate(input: unknown): AcceptedMaxWebhook {
  const payload = MaxWebhookUpdateSchema.parse(input);
  const chatId = extractChatId(payload);
  const digest = createHash('sha256').update(eventIdentity(payload, chatId)).digest('hex');

  return {
    chatId,
    eventKey: `max:${payload.update_type}:${digest}`,
    eventType: payload.update_type,
    payload,
  };
}

function secretDigest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function isValidMaxWebhookSecret(
  providedSecret: string | undefined,
  expectedSecret: string,
): boolean {
  const providedDigest = secretDigest(providedSecret ?? '');
  const expectedDigest = secretDigest(expectedSecret);
  return timingSafeEqual(providedDigest, expectedDigest) && providedSecret !== undefined;
}
