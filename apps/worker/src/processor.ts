import {
  planBotActions,
  type BotAnswerCallbackAction,
  type BotSaveInquiryAction,
  type BotSendMessageAction,
  type BotSetDialogStateAction,
} from './bot-plan.js';
import type { MaxAnswerCallbackBody, MaxSendMessageBody } from './max-api.js';
import { parseMaxUpdate } from './max-update.js';
import type {
  ClaimedWebhook,
  PlannedOutboundAction,
  WebhookProcessingResult,
} from './repository.js';
import type { JsonObject } from '@craft72/database';

function jsonObject(value: object): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function bigintOrNull(value: string | null): bigint | null {
  if (value === null) return null;
  try {
    return BigInt(value);
  } catch {
    throw new TypeError('MAX update contains an invalid integer identifier');
  }
}

function eventDate(timestampMilliseconds: number): Date {
  const date = new Date(timestampMilliseconds);
  if (Number.isNaN(date.getTime())) throw new TypeError('MAX update contains an invalid timestamp');
  return date;
}

function sendAction(action: BotSendMessageAction): PlannedOutboundAction {
  return {
    action: 'send_message',
    actionKey: action.idempotencyKey,
    chatId: BigInt(action.chatId),
    payload: jsonObject(action.body),
  };
}

function answerCallbackAction(action: BotAnswerCallbackAction): PlannedOutboundAction {
  return {
    action: 'answer_callback',
    actionKey: action.idempotencyKey,
    chatId: bigintOrNull(action.chatId),
    payload: jsonObject({ body: action.body, callbackId: action.callbackId }),
  };
}

export function processWebhook(
  claim: ClaimedWebhook,
  webApp: string,
  adminMaxUserIds: readonly string[] = [],
  welcomeText?: string,
): WebhookProcessingResult {
  const update = parseMaxUpdate(claim.payload);
  const plan = planBotActions(update, {
    adminMaxUserIds,
    webApp,
    ...(welcomeText === undefined ? {} : { welcomeText }),
  });
  const dialogAction = plan.find(
    (action): action is BotSetDialogStateAction => action.kind === 'set_dialog_state',
  );
  const inquiryAction = plan.find(
    (action): action is BotSaveInquiryAction => action.kind === 'save_inquiry',
  );
  const actions = plan.flatMap((action) => {
    if (action.kind === 'send_message') return [sendAction(action)];
    if (action.kind === 'answer_callback') return [answerCallbackAction(action)];
    return [];
  });

  return {
    actions,
    dialog:
      dialogAction === undefined
        ? null
        : {
            chatId: BigInt(dialogAction.chatId),
            lastEventAt: eventDate(update.timestampMs),
            maxUserId: bigintOrNull(dialogAction.maxUserId),
            status: dialogAction.active ? 'active' : 'stopped',
          },
    inquiry:
      inquiryAction === undefined
        ? null
        : {
            bodyText: inquiryAction.text,
            maxUserId: BigInt(inquiryAction.maxUserId),
            messageId: inquiryAction.messageId,
          },
  };
}

export function sendMessageBodyFromPayload(payload: JsonObject): MaxSendMessageBody {
  const text = payload.text;
  const attachments = payload.attachments;
  if (typeof text !== 'string' || text.trim().length === 0 || text.length > 4_000) {
    throw new TypeError('MAX outbox message text is invalid');
  }
  if (attachments !== undefined && !Array.isArray(attachments)) {
    throw new TypeError('MAX outbox message attachments are invalid');
  }

  return JSON.parse(JSON.stringify(payload)) as MaxSendMessageBody;
}

export function answerCallbackFromPayload(payload: JsonObject): {
  readonly body: MaxAnswerCallbackBody;
  readonly callbackId: string;
} {
  const callbackId = payload.callbackId;
  const rawBody = payload.body;
  if (
    typeof callbackId !== 'string' ||
    callbackId.trim().length === 0 ||
    callbackId.length > 4_096
  ) {
    throw new TypeError('MAX callback outbox ID is invalid');
  }
  const body = recordFromUnknown(rawBody);
  if (body === null) throw new TypeError('MAX callback outbox body is invalid');

  const rawMessage = recordFromUnknown(body.message);
  const notification = body.notification;
  if (notification !== undefined && typeof notification !== 'string') {
    throw new TypeError('MAX callback notification is invalid');
  }
  const message =
    rawMessage === null ? undefined : sendMessageBodyFromPayload(rawMessage as JsonObject);
  if (message === undefined && (notification === undefined || notification.trim().length === 0)) {
    throw new TypeError('MAX callback outbox body is empty');
  }

  return {
    body: {
      ...(message === undefined ? {} : { message }),
      ...(notification === undefined ? {} : { notification }),
    },
    callbackId: callbackId.trim(),
  };
}

function recordFromUnknown(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function sentMessageIdFromResult(body: unknown): string | null {
  const response = recordFromUnknown(body);
  const message = recordFromUnknown(response?.message) ?? response;
  const messageBody = recordFromUnknown(message?.body);
  const messageId = messageBody?.mid;
  return typeof messageId === 'string' && messageId.length > 0 && messageId.length <= 255
    ? messageId
    : null;
}
