import { createHash } from 'node:crypto';

import type {
  MaxAnswerCallbackBody,
  MaxInlineKeyboardAttachment,
  MaxOpenAppButton,
  MaxSendMessageBody,
} from './max-api.js';
import type { ParsedMaxUpdate } from './max-update.js';

export const BOT_START_PAYLOADS = ['new_project', 'services', 'portfolio', 'upload_brief'] as const;

export type BotStartPayload = (typeof BOT_START_PAYLOADS)[number];

interface BotActionBase {
  readonly eventKey: string;
  readonly idempotencyKey: string;
}

export interface BotSendMessageAction extends BotActionBase {
  readonly body: MaxSendMessageBody;
  readonly chatId: string;
  readonly kind: 'send_message';
}

export interface BotAnswerCallbackAction extends BotActionBase {
  readonly body: MaxAnswerCallbackBody;
  readonly callbackId: string;
  readonly chatId: string | null;
  readonly kind: 'answer_callback';
}

export interface BotSaveInquiryAction extends BotActionBase {
  readonly chatId: string;
  readonly kind: 'save_inquiry';
  readonly maxUserId: string;
  readonly messageId: string;
  readonly text: string;
}

export interface BotSetDialogStateAction extends BotActionBase {
  readonly active: boolean;
  readonly chatId: string;
  readonly kind: 'set_dialog_state';
  readonly maxUserId: string | null;
}

export type BotPlannedAction =
  BotAnswerCallbackAction | BotSaveInquiryAction | BotSendMessageAction | BotSetDialogStateAction;

export interface BotPlanOptions {
  /** Public username of the bot whose Mini App should be opened. */
  readonly webApp: string;
}

const WELCOME_TEXT =
  'Здравствуйте! Это КРАФТ — архитектурно-проектная команда. В Mini App можно подобрать услугу, посмотреть проекты или отправить ТЗ.';
const ROUTING_TEXT =
  'Спасибо, сообщение принято. Чтобы быстрее передать задачу команде, выберите подходящий раздел.';
const CALLBACK_TEXT = 'Откройте нужный раздел CRAFT72:';
const TEXT_REQUIRED_TEXT =
  'Сейчас бот сохраняет только текстовые обращения. Опишите задачу сообщением или откройте нужный раздел Mini App.';
const START_COMMAND_PATTERN = /^\/start(?:@[A-Za-z0-9_]+)?(?:\s|$)/i;
const WELCOME_DEDUPLICATION_WINDOW_MS = 5 * 60 * 1_000;

function safeWebApp(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_]{1,128}$/.test(normalized)) {
    throw new TypeError('MAX web_app value is invalid');
  }
  return normalized;
}

export function createBotActionIdempotencyKey(identity: string, action: string): string {
  const digest = createHash('sha256').update(`${identity}\0${action}`).digest('hex');
  return `maxbot:${digest}`;
}

function openAppButton(text: string, webApp: string, payload: BotStartPayload): MaxOpenAppButton {
  return { payload, text, type: 'open_app', web_app: webApp };
}

export function createOpenAppKeyboard(webAppInput: string): MaxInlineKeyboardAttachment {
  const webApp = safeWebApp(webAppInput);
  return {
    type: 'inline_keyboard',
    payload: {
      buttons: [
        [openAppButton('Начать проект', webApp, 'new_project')],
        [
          openAppButton('Подобрать услугу', webApp, 'services'),
          openAppButton('Проекты', webApp, 'portfolio'),
        ],
        [openAppButton('Отправить ТЗ', webApp, 'upload_brief')],
        [{ text: 'Связаться с менеджером', type: 'message' }],
      ],
    },
  };
}

function messageBody(text: string, webApp: string): MaxSendMessageBody {
  return { attachments: [createOpenAppKeyboard(webApp)], text };
}

function eventActionKey(update: ParsedMaxUpdate, action: string): string {
  return createBotActionIdempotencyKey(update.eventKey, action);
}

function welcomeActionKey(update: ParsedMaxUpdate): string {
  const timeWindow = Math.floor(update.timestampMs / WELCOME_DEDUPLICATION_WINDOW_MS);
  const identity = `welcome:${update.chatId ?? 'unknown'}:${update.actorUserId ?? 'unknown'}:${timeWindow}`;
  return createBotActionIdempotencyKey(identity, 'send_message');
}

function dialogAction(update: ParsedMaxUpdate, active: boolean): BotSetDialogStateAction | null {
  if (update.chatId === null) return null;
  return {
    active,
    chatId: update.chatId,
    eventKey: update.eventKey,
    idempotencyKey: eventActionKey(update, active ? 'dialog_active' : 'dialog_stopped'),
    kind: 'set_dialog_state',
    maxUserId: update.actorUserId,
  };
}

function sendAction(
  update: ParsedMaxUpdate,
  body: MaxSendMessageBody,
  action: string,
  idempotencyKey = eventActionKey(update, action),
): BotSendMessageAction | null {
  if (update.chatId === null) return null;
  return {
    body,
    chatId: update.chatId,
    eventKey: update.eventKey,
    idempotencyKey,
    kind: 'send_message',
  };
}

function answerCallbackAction(
  update: ParsedMaxUpdate,
  body: MaxAnswerCallbackBody,
): BotAnswerCallbackAction | null {
  if (update.callbackId === null) return null;
  return {
    body,
    callbackId: update.callbackId,
    chatId: update.chatId,
    eventKey: update.eventKey,
    idempotencyKey: eventActionKey(update, 'answer_callback'),
    kind: 'answer_callback',
  };
}

function compact(actions: readonly (BotPlannedAction | null)[]): BotPlannedAction[] {
  return actions.filter((action): action is BotPlannedAction => action !== null);
}

/** Returns deterministic business actions; it performs no I/O and is safe to replay. */
export function planBotActions(
  update: ParsedMaxUpdate,
  options: BotPlanOptions,
): readonly BotPlannedAction[] {
  const webApp = safeWebApp(options.webApp);

  if (update.updateType === 'bot_started') {
    return compact([
      dialogAction(update, true),
      sendAction(update, messageBody(WELCOME_TEXT, webApp), 'welcome', welcomeActionKey(update)),
    ]);
  }

  if (update.updateType === 'bot_stopped') return compact([dialogAction(update, false)]);

  if (update.updateType === 'message_callback') {
    return compact([
      dialogAction(update, true),
      answerCallbackAction(update, { message: messageBody(CALLBACK_TEXT, webApp) }),
    ]);
  }

  if (update.updateType !== 'message_created' || update.actorIsBot) return [];

  const text = update.messageText?.trim() ?? '';
  if (START_COMMAND_PATTERN.test(text)) {
    return compact([
      dialogAction(update, true),
      sendAction(update, messageBody(WELCOME_TEXT, webApp), 'welcome', welcomeActionKey(update)),
    ]);
  }

  if (text.length === 0) {
    return compact([
      dialogAction(update, true),
      sendAction(update, messageBody(TEXT_REQUIRED_TEXT, webApp), 'text_required'),
    ]);
  }

  const inquiry: BotSaveInquiryAction | null =
    update.chatId !== null && update.actorUserId !== null && update.messageId !== null
      ? {
          chatId: update.chatId,
          eventKey: update.eventKey,
          idempotencyKey: eventActionKey(update, 'save_inquiry'),
          kind: 'save_inquiry',
          maxUserId: update.actorUserId,
          messageId: update.messageId,
          text,
        }
      : null;

  return compact([
    dialogAction(update, true),
    inquiry,
    sendAction(update, messageBody(ROUTING_TEXT, webApp), 'route_message'),
  ]);
}
