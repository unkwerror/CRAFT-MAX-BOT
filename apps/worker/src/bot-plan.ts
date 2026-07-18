import { createHash } from 'node:crypto';

import type {
  MaxAnswerCallbackBody,
  MaxInlineKeyboardAttachment,
  MaxOpenAppButton,
  MaxSendMessageBody,
} from './max-api.js';
import type { ParsedMaxUpdate } from './max-update.js';

export const BOT_START_PAYLOADS = [
  'home',
  'new_project',
  'services',
  'portfolio',
  'upload_brief',
  'admin',
] as const;

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
  /** Canonical MAX user IDs that may receive the administrative Mini App entry point. */
  readonly adminMaxUserIds?: readonly string[];
  /** Full profile name displayed by MAX for the configured manager mention. */
  readonly managerDisplayName?: string;
  /** Canonical MAX user ID used in the supported max://user mention. */
  readonly managerUserId?: string;
  /** Validated, published administrator override for the greeting text. */
  readonly welcomeText?: string;
}

export interface OpenAppKeyboardOptions {
  /** Adds the administrative entry point. The caller must authorize the current MAX actor first. */
  readonly includeAdmin?: boolean;
}

export const BOT_WELCOME_CONTENT_KEY = 'bot-welcome' as const;

const WELCOME_TEXT =
  'Здравствуйте! Я помощник проектного бюро КРАФТ 👋\n\n' +
  'В мини-приложении можно за 7–10 минут собрать бриф, подобрать услугу, посмотреть проекты и приложить материалы. Черновик сохранится автоматически.\n\n' +
  'Нажмите «Открыть КРАФТ» ниже. Если удобнее остаться в чате — кратко опишите задачу одним сообщением.';
const ROUTING_TEXT =
  'Спасибо, сообщение принято. Чтобы ускорить работу, откройте нужный раздел мини-приложения кнопками ниже — или дождитесь ответа менеджера.';
const CALLBACK_TEXT = 'Откройте нужный раздел мини-приложения КРАФТ:';
const TEXT_REQUIRED_TEXT =
  'Сейчас бот сохраняет только текстовые обращения. Опишите задачу сообщением или откройте мини-приложение кнопками ниже.';
const MANAGER_CONTACT_PHRASE = 'Связаться с менеджером';
export const MANAGER_CONTACT_START_PAYLOAD = 'manager_contact' as const;
const MANAGER_HANDOFF_TEXT =
  'Напишите задачу одним сообщением — менеджер КРАФТ получит обращение. ' +
  'Или откройте мини-приложение, чтобы заполнить анкету и приложить материалы.';
const START_COMMAND_PATTERN = /^\/start(?:@[A-Za-z0-9_]+)?(?:\s|$)/i;
const MANAGER_START_COMMAND_PATTERN = /^\/start(?:@[A-Za-z0-9_]+)?\s+manager_contact\s*$/i;
const ID_COMMAND_PATTERN = /^\/id(?:@[A-Za-z0-9_]+)?$/i;
const WELCOME_DEDUPLICATION_WINDOW_MS = 5 * 60 * 1_000;
const MAX_MESSAGE_TEXT_LENGTH = 4_000;
const MAX_MANAGER_USER_ID_PATTERN = /^[1-9]\d{4,18}$/;
const MAX_SIGNED_INT64 = 9_223_372_036_854_775_807n;

/**
 * Reads the published `bot-welcome` payload shape: `{ "text": "..." }`.
 * Unknown keys are ignored so the document can be extended without breaking the worker.
 */
export function publishedBotWelcomeText(content: unknown): string | null {
  if (typeof content !== 'object' || content === null || Array.isArray(content)) return null;
  const text = (content as { readonly text?: unknown }).text;
  if (typeof text !== 'string') return null;
  const normalized = text.trim();
  return normalized.length > 0 && normalized.length <= MAX_MESSAGE_TEXT_LENGTH ? normalized : null;
}

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

export function createOpenAppKeyboard(
  webAppInput: string,
  options: OpenAppKeyboardOptions = {},
): MaxInlineKeyboardAttachment {
  const webApp = safeWebApp(webAppInput);
  return {
    type: 'inline_keyboard',
    payload: {
      buttons: [
        ...(options.includeAdmin === true
          ? [[openAppButton('Админ-панель', webApp, 'admin')]]
          : []),
        [openAppButton('Открыть КРАФТ', webApp, 'home')],
        [openAppButton('Заполнить анкету', webApp, 'new_project')],
        [
          openAppButton('Подобрать услугу', webApp, 'services'),
          openAppButton('Проекты', webApp, 'portfolio'),
        ],
        [openAppButton('Отправить материалы', webApp, 'upload_brief')],
        [{ text: MANAGER_CONTACT_PHRASE, type: 'message' }],
      ],
    },
  };
}

function messageBody(text: string, webApp: string, includeAdmin: boolean): MaxSendMessageBody {
  return { attachments: [createOpenAppKeyboard(webApp, { includeAdmin })], text };
}

function approvedManagerUserId(value: string | undefined): string | null {
  const normalized = value?.trim();
  if (normalized === undefined || !MAX_MANAGER_USER_ID_PATTERN.test(normalized)) return null;
  return BigInt(normalized) <= MAX_SIGNED_INT64 ? normalized : null;
}

function managerDisplayName(value: string | undefined): string {
  const normalized = value?.trim();
  if (normalized === undefined || normalized.length === 0 || normalized.length > 128) {
    return 'Менеджер КРАФТ';
  }
  return normalized.replaceAll('\\', '\\\\').replaceAll('[', '\\[').replaceAll(']', '\\]');
}

function managerContactBody(options: BotPlanOptions): MaxSendMessageBody | null {
  const managerUserId = approvedManagerUserId(options.managerUserId);
  if (managerUserId === null) return null;
  const displayName = managerDisplayName(options.managerDisplayName);
  return {
    format: 'markdown',
    text:
      `Ваш менеджер КРАФТ — [${displayName}](max://user/${managerUserId}).\n\n` +
      'Нажмите на имя, чтобы открыть профиль и написать напрямую в MAX.',
  };
}

function isAdminActor(update: ParsedMaxUpdate, adminMaxUserIds: readonly string[]): boolean {
  return update.actorUserId !== null && adminMaxUserIds.includes(update.actorUserId);
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
  const includeAdmin = isAdminActor(update, options.adminMaxUserIds ?? []);
  const welcomeText = publishedBotWelcomeText({ text: options.welcomeText }) ?? WELCOME_TEXT;
  const managerContact = managerContactBody(options);

  if (update.updateType === 'bot_started') {
    if (update.startPayload === MANAGER_CONTACT_START_PAYLOAD && managerContact !== null) {
      return compact([
        dialogAction(update, true),
        sendAction(update, managerContact, 'manager_contact'),
      ]);
    }
    return compact([
      dialogAction(update, true),
      sendAction(
        update,
        messageBody(welcomeText, webApp, includeAdmin),
        'welcome',
        welcomeActionKey(update),
      ),
    ]);
  }

  if (update.updateType === 'bot_stopped') return compact([dialogAction(update, false)]);

  if (update.updateType === 'message_callback') {
    return compact([
      dialogAction(update, true),
      answerCallbackAction(update, {
        message: messageBody(CALLBACK_TEXT, webApp, includeAdmin),
      }),
    ]);
  }

  if (update.updateType !== 'message_created' || update.actorIsBot) return [];

  const text = update.messageText?.trim() ?? '';
  if (MANAGER_START_COMMAND_PATTERN.test(text) && managerContact !== null) {
    return compact([
      dialogAction(update, true),
      sendAction(update, managerContact, 'manager_contact'),
    ]);
  }
  if (START_COMMAND_PATTERN.test(text)) {
    return compact([
      dialogAction(update, true),
      sendAction(
        update,
        messageBody(welcomeText, webApp, includeAdmin),
        'welcome',
        welcomeActionKey(update),
      ),
    ]);
  }

  if (ID_COMMAND_PATTERN.test(text)) {
    return compact([
      dialogAction(update, true),
      update.actorUserId === null
        ? null
        : sendAction(update, { text: `Ваш MAX ID: ${update.actorUserId}` }, 'show_max_id'),
    ]);
  }

  if (text.length === 0) {
    return compact([
      dialogAction(update, true),
      sendAction(update, messageBody(TEXT_REQUIRED_TEXT, webApp, includeAdmin), 'text_required'),
    ]);
  }

  const isManagerContact =
    text.localeCompare(MANAGER_CONTACT_PHRASE, 'ru', {
      sensitivity: 'accent',
    }) === 0;

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
    sendAction(
      update,
      isManagerContact && managerContact !== null
        ? managerContact
        : messageBody(isManagerContact ? MANAGER_HANDOFF_TEXT : ROUTING_TEXT, webApp, includeAdmin),
      isManagerContact ? 'manager_handoff' : 'route_message',
    ),
  ]);
}
