import { createHash } from 'node:crypto';

export type MaxJsonValue = boolean | null | number | string | MaxJsonValue[] | MaxJsonObject;

export interface MaxJsonObject {
  readonly [key: string]: MaxJsonValue;
}

export const KNOWN_MAX_UPDATE_TYPES = [
  'bot_started',
  'bot_stopped',
  'message_created',
  'message_callback',
] as const;

export type KnownMaxUpdateType = (typeof KNOWN_MAX_UPDATE_TYPES)[number];

export interface ParsedMaxUpdate {
  readonly actorIsBot: boolean;
  readonly actorUserId: string | null;
  readonly callbackId: string | null;
  readonly callbackPayload: string | null;
  readonly chatId: string | null;
  readonly eventKey: string;
  readonly messageId: string | null;
  readonly messageText: string | null;
  readonly raw: MaxJsonObject;
  readonly startPayload: string | null;
  readonly timestampMs: number;
  readonly updateType: string;
}

export class MaxUpdateParseError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MaxUpdateParseError';
  }
}

const MAX_JSON_DEPTH = 32;
const UPDATE_TYPE_PATTERN = /^[a-z][a-z0-9_]{0,127}$/;
const INTEGER_ID_PATTERN = /^-?[1-9]\d{0,18}$/;

function parseJsonValue(input: unknown, path: string, depth: number): MaxJsonValue {
  if (depth > MAX_JSON_DEPTH) throw new MaxUpdateParseError(`${path} is nested too deeply`);
  if (input === null || typeof input === 'boolean' || typeof input === 'string') return input;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new MaxUpdateParseError(`${path} is not valid JSON`);
    return input;
  }
  if (Array.isArray(input)) {
    return input.map((value, index) => parseJsonValue(value, `${path}[${index}]`, depth + 1));
  }
  if (typeof input !== 'object') throw new MaxUpdateParseError(`${path} is not valid JSON`);

  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new MaxUpdateParseError(`${path} must be a plain JSON object`);
  }

  const output: Record<string, MaxJsonValue> = {};
  for (const [key, value] of Object.entries(input)) {
    output[key] = parseJsonValue(value, `${path}.${key}`, depth + 1);
  }
  return output;
}

function asRecord(value: MaxJsonValue | undefined): MaxJsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

function stringField(record: MaxJsonObject | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function booleanField(record: MaxJsonObject | undefined, key: string): boolean {
  return record?.[key] === true;
}

function integerId(value: MaxJsonValue | undefined): string | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value !== 0 ? String(value) : null;
  }
  if (typeof value !== 'string' || !INTEGER_ID_PATTERN.test(value)) return null;

  try {
    const id = BigInt(value);
    return id >= -9_223_372_036_854_775_808n && id <= 9_223_372_036_854_775_807n
      ? id.toString()
      : null;
  } catch {
    return null;
  }
}

function canonicalJson(value: MaxJsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;

  return `{${Object.entries(value)
    .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(',')}}`;
}

function eventIdentity(
  updateType: string,
  timestampMs: number,
  chatId: string | null,
  actorUserId: string | null,
  messageId: string | null,
  callbackId: string | null,
  raw: MaxJsonObject,
): string {
  if (callbackId !== null) return `${updateType}\0callback:${callbackId}`;
  if (messageId !== null && updateType.startsWith('message_')) {
    return `${updateType}\0message:${messageId}`;
  }
  if ((updateType === 'bot_started' || updateType === 'bot_stopped') && chatId !== null) {
    return `${updateType}\0chat:${chatId}\0user:${actorUserId ?? 'unknown'}\0timestamp:${timestampMs}`;
  }
  return `${updateType}\0payload:${canonicalJson(raw)}`;
}

function createEventKey(identity: string, updateType: string): string {
  const digest = createHash('sha256').update(identity).digest('hex');
  return `max:${updateType}:${digest}`;
}

export function isKnownMaxUpdateType(value: string): value is KnownMaxUpdateType {
  return KNOWN_MAX_UPDATE_TYPES.some((candidate) => candidate === value);
}

/**
 * Parses the stable envelope shared by MAX update variants while preserving every unknown field.
 * Unknown update types are intentionally accepted so a future MAX event cannot cause a retry storm.
 */
export function parseMaxUpdate(input: unknown): ParsedMaxUpdate {
  const json = parseJsonValue(input, 'update', 0);
  const raw = asRecord(json);
  if (raw === undefined) throw new MaxUpdateParseError('MAX update must be a JSON object');

  const updateType = stringField(raw, 'update_type');
  if (updateType === null || !UPDATE_TYPE_PATTERN.test(updateType)) {
    throw new MaxUpdateParseError('MAX update_type is missing or invalid');
  }

  const timestampValue = raw.timestamp;
  const timestampMs =
    typeof timestampValue === 'number' && Number.isSafeInteger(timestampValue) && timestampValue > 0
      ? timestampValue
      : Number.NaN;
  if (!Number.isFinite(timestampMs)) {
    throw new MaxUpdateParseError('MAX timestamp must be a positive safe integer');
  }

  const message = asRecord(raw.message);
  const recipient = asRecord(message?.recipient);
  const sender = asRecord(message?.sender);
  const body = asRecord(message?.body);
  const callback = asRecord(raw.callback);
  const callbackUser = asRecord(callback?.user);
  const topLevelUser = asRecord(raw.user);
  const actor = updateType === 'message_callback' ? callbackUser : (sender ?? topLevelUser);

  const chatId = integerId(raw.chat_id) ?? integerId(recipient?.chat_id);
  const actorUserId = integerId(actor?.user_id) ?? integerId(raw.user_id);
  const messageId = stringField(body, 'mid') ?? stringField(raw, 'message_id');
  const callbackId = stringField(callback, 'callback_id');
  const callbackPayload = stringField(callback, 'payload');
  const startPayload = updateType === 'bot_started' ? stringField(raw, 'payload') : null;
  const messageText = typeof body?.text === 'string' ? body.text : null;
  const actorIsBot = booleanField(actor, 'is_bot');
  const identity = eventIdentity(
    updateType,
    timestampMs,
    chatId,
    actorUserId,
    messageId,
    callbackId,
    raw,
  );

  return {
    actorIsBot,
    actorUserId,
    callbackId,
    callbackPayload,
    chatId,
    eventKey: createEventKey(identity, updateType),
    messageId,
    messageText,
    raw,
    startPayload,
    timestampMs,
    updateType,
  };
}

export function parseMaxUpdateJson(input: string): ParsedMaxUpdate {
  let value: unknown;
  try {
    value = JSON.parse(input) as unknown;
  } catch (error) {
    throw new MaxUpdateParseError('MAX update body is not valid JSON', { cause: error });
  }
  return parseMaxUpdate(value);
}
