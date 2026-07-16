import {
  botDialogs,
  botInquiries,
  maxBotOutbox,
  webhookInbox,
  type Database,
  type JsonObject,
} from '@craft72/database';
import { and, eq, sql } from 'drizzle-orm';

export type BotDialogStatus = 'active' | 'stopped';
export type BotOutboxAction = 'answer_callback' | 'send_message';

export interface ClaimedWebhook {
  readonly attempts: number;
  readonly chatId: bigint | null;
  readonly eventKey: string;
  readonly eventType: string;
  readonly payload: JsonObject;
}

export interface PlannedInquiry {
  readonly bodyText: string;
  readonly maxUserId: bigint | null;
  readonly messageId: string | null;
}

export interface PlannedOutboundAction {
  readonly action: BotOutboxAction;
  readonly actionKey: string;
  readonly chatId: bigint | null;
  readonly payload: JsonObject;
}

export interface WebhookProcessingResult {
  readonly actions: readonly PlannedOutboundAction[];
  readonly dialog: {
    readonly chatId: bigint;
    readonly lastEventAt: Date;
    readonly maxUserId: bigint | null;
    readonly status: BotDialogStatus;
  } | null;
  readonly inquiry: PlannedInquiry | null;
}

export interface ClaimedOutboundAction {
  readonly action: BotOutboxAction;
  readonly attempts: number;
  readonly chatId: bigint | null;
  readonly id: string;
  readonly payload: JsonObject;
}

export interface BotWorkerStore {
  claimOutboundAction(now: Date, staleBefore: Date): Promise<ClaimedOutboundAction | null>;
  claimWebhook(now: Date, staleBefore: Date): Promise<ClaimedWebhook | null>;
  completeOutboundAction(
    claim: ClaimedOutboundAction,
    now: Date,
    providerMessageId: string | null,
  ): Promise<void>;
  completeWebhook(claim: ClaimedWebhook, result: WebhookProcessingResult, now: Date): Promise<void>;
  failOutboundAction(
    claim: ClaimedOutboundAction,
    errorCode: string,
    retryAt: Date | null,
    now: Date,
  ): Promise<void>;
  failWebhook(
    claim: ClaimedWebhook,
    errorCode: string,
    retryAt: Date | null,
    now: Date,
  ): Promise<void>;
  isReady(): Promise<void>;
}

interface RawWebhookRow {
  readonly attempts: unknown;
  readonly chatId: unknown;
  readonly eventKey: unknown;
  readonly eventType: unknown;
  readonly payload: unknown;
}

interface RawOutboundRow {
  readonly action: unknown;
  readonly attempts: unknown;
  readonly chatId: unknown;
  readonly id: unknown;
  readonly payload: unknown;
}

function firstRow(result: unknown): Record<string, unknown> | null {
  if (typeof result !== 'object' || result === null || !('rows' in result)) return null;
  const rows = (result as { rows?: unknown }).rows;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const row = rows[0];
  return typeof row === 'object' && row !== null && !Array.isArray(row)
    ? (row as Record<string, unknown>)
    : null;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`PostgreSQL returned an invalid ${name}`);
  }
  return value;
}

function requiredAttempts(value: unknown): number {
  const attempts = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(attempts) || attempts < 1) {
    throw new TypeError('PostgreSQL returned invalid attempts');
  }
  return attempts;
}

function nullableBigint(value: unknown): bigint | null {
  if (value === null || value === undefined) return null;
  try {
    return BigInt(value as bigint | boolean | number | string);
  } catch {
    throw new TypeError('PostgreSQL returned an invalid bigint');
  }
}

function jsonObject(value: unknown): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('PostgreSQL returned an invalid JSON object');
  }
  return value as JsonObject;
}

function affectedRows(result: unknown): number {
  if (typeof result !== 'object' || result === null || !('rowCount' in result)) return 0;
  const rowCount = (result as { rowCount?: unknown }).rowCount;
  return typeof rowCount === 'number' ? rowCount : 0;
}

function safeErrorCode(value: string): string {
  const normalized = value.replaceAll(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 128);
  return normalized.length > 0 ? normalized : 'unknown_error';
}

export class PostgresBotWorkerStore implements BotWorkerStore {
  readonly #database: Database;

  public constructor(database: Database) {
    this.#database = database;
  }

  public async isReady(): Promise<void> {
    await this.#database.execute(sql`select 1`);
  }

  public async claimWebhook(now: Date, staleBefore: Date): Promise<ClaimedWebhook | null> {
    const result = await this.#database.execute(sql`
      with candidate as (
        select current_event.event_key
        from ${webhookInbox} as current_event
        where (
          (current_event.status in ('pending', 'retry') and current_event.next_attempt_at <= ${now})
          or (current_event.status = 'processing' and current_event.updated_at <= ${staleBefore})
        )
          and (
            current_event.chat_id is null
            or not exists (
              select 1
              from ${webhookInbox} as older_event
              where older_event.chat_id = current_event.chat_id
                and older_event.status in ('pending', 'processing', 'retry')
                and (
                  older_event.received_at < current_event.received_at
                  or (
                    older_event.received_at = current_event.received_at
                    and older_event.event_key < current_event.event_key
                  )
                )
            )
          )
        order by current_event.received_at, current_event.event_key
        for update skip locked
        limit 1
      )
      update ${webhookInbox} as claimed
      set status = 'processing',
          attempts = claimed.attempts + 1,
          updated_at = ${now},
          last_error_code = null,
          processed_at = null
      from candidate
      where claimed.event_key = candidate.event_key
      returning claimed.event_key as "eventKey",
                claimed.event_type as "eventType",
                claimed.chat_id as "chatId",
                claimed.payload as "payload",
                claimed.attempts as "attempts"
    `);
    const row = firstRow(result) as RawWebhookRow | null;
    if (row === null) return null;

    return {
      attempts: requiredAttempts(row.attempts),
      chatId: nullableBigint(row.chatId),
      eventKey: requiredString(row.eventKey, 'event key'),
      eventType: requiredString(row.eventType, 'event type'),
      payload: jsonObject(row.payload),
    };
  }

  public async completeWebhook(
    claim: ClaimedWebhook,
    result: WebhookProcessingResult,
    now: Date,
  ): Promise<void> {
    await this.#database.transaction(async (transaction) => {
      if (result.dialog !== null) {
        await transaction
          .insert(botDialogs)
          .values({
            chatId: result.dialog.chatId,
            maxUserId: result.dialog.maxUserId,
            status: result.dialog.status,
            lastEventAt: result.dialog.lastEventAt,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: botDialogs.chatId,
            setWhere: sql`${botDialogs.lastEventAt} <= ${result.dialog.lastEventAt}`,
            set: {
              ...(result.dialog.maxUserId === null ? {} : { maxUserId: result.dialog.maxUserId }),
              status: result.dialog.status,
              lastEventAt: result.dialog.lastEventAt,
              updatedAt: now,
            },
          });
      }

      if (result.inquiry !== null) {
        if (result.dialog === null) throw new Error('An inquiry requires a bot dialog');
        await transaction
          .insert(botInquiries)
          .values({
            eventKey: claim.eventKey,
            chatId: result.dialog.chatId,
            maxUserId: result.inquiry.maxUserId,
            messageId: result.inquiry.messageId,
            bodyText: result.inquiry.bodyText,
            status: 'received',
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing();
      }

      for (const action of result.actions) {
        await transaction
          .insert(maxBotOutbox)
          .values({
            eventKey: claim.eventKey,
            actionKey: action.actionKey,
            action: action.action,
            chatId: action.chatId,
            payload: action.payload,
            status: 'pending',
            attempts: 0,
            nextAttemptAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing({ target: maxBotOutbox.actionKey });
      }

      const completed = await transaction
        .update(webhookInbox)
        .set({ status: 'processed', processedAt: now, updatedAt: now, lastErrorCode: null })
        .where(
          and(
            eq(webhookInbox.eventKey, claim.eventKey),
            eq(webhookInbox.status, 'processing'),
            eq(webhookInbox.attempts, claim.attempts),
          ),
        );
      if (affectedRows(completed) !== 1) throw new Error('Webhook claim lease was lost');
    });
  }

  public async failWebhook(
    claim: ClaimedWebhook,
    errorCode: string,
    retryAt: Date | null,
    now: Date,
  ): Promise<void> {
    const failed = await this.#database
      .update(webhookInbox)
      .set({
        status: retryAt === null ? 'dead_letter' : 'retry',
        nextAttemptAt: retryAt ?? now,
        lastErrorCode: safeErrorCode(errorCode),
        processedAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(webhookInbox.eventKey, claim.eventKey),
          eq(webhookInbox.status, 'processing'),
          eq(webhookInbox.attempts, claim.attempts),
        ),
      );
    if (affectedRows(failed) !== 1) throw new Error('Webhook claim lease was lost');
  }

  public async claimOutboundAction(
    now: Date,
    staleBefore: Date,
  ): Promise<ClaimedOutboundAction | null> {
    const result = await this.#database.execute(sql`
      with candidate as (
        select current_action.id
        from ${maxBotOutbox} as current_action
        where (
          (current_action.status in ('pending', 'retry') and current_action.next_attempt_at <= ${now})
          or (current_action.status = 'processing' and current_action.updated_at <= ${staleBefore})
        )
          and not exists (
            select 1
            from ${maxBotOutbox} as older_action
            where older_action.chat_id = current_action.chat_id
              and older_action.status in ('pending', 'processing', 'retry')
              and (
                older_action.created_at < current_action.created_at
                or (
                  older_action.created_at = current_action.created_at
                  and older_action.id::text < current_action.id::text
                )
              )
          )
        order by current_action.created_at, current_action.id
        for update skip locked
        limit 1
      )
      update ${maxBotOutbox} as claimed
      set status = 'processing',
          attempts = claimed.attempts + 1,
          updated_at = ${now},
          last_error_code = null,
          completed_at = null
      from candidate
      where claimed.id = candidate.id
      returning claimed.id as "id",
                claimed.action as "action",
                claimed.chat_id as "chatId",
                claimed.payload as "payload",
                claimed.attempts as "attempts"
    `);
    const row = firstRow(result) as RawOutboundRow | null;
    if (row === null) return null;
    const action = requiredString(row.action, 'MAX action');
    if (action !== 'send_message' && action !== 'answer_callback') {
      throw new TypeError('PostgreSQL returned an unsupported MAX action');
    }

    return {
      action,
      attempts: requiredAttempts(row.attempts),
      chatId: nullableBigint(row.chatId),
      id: requiredString(row.id, 'outbox id'),
      payload: jsonObject(row.payload),
    };
  }

  public async completeOutboundAction(
    claim: ClaimedOutboundAction,
    now: Date,
    providerMessageId: string | null,
  ): Promise<void> {
    const completed = await this.#database
      .update(maxBotOutbox)
      .set({
        status: 'completed',
        completedAt: now,
        updatedAt: now,
        lastErrorCode: null,
        providerMessageId,
      })
      .where(
        and(
          eq(maxBotOutbox.id, claim.id),
          eq(maxBotOutbox.status, 'processing'),
          eq(maxBotOutbox.attempts, claim.attempts),
        ),
      );
    if (affectedRows(completed) !== 1) throw new Error('Outbound claim lease was lost');
  }

  public async failOutboundAction(
    claim: ClaimedOutboundAction,
    errorCode: string,
    retryAt: Date | null,
    now: Date,
  ): Promise<void> {
    const failed = await this.#database
      .update(maxBotOutbox)
      .set({
        status: retryAt === null ? 'dead_letter' : 'retry',
        nextAttemptAt: retryAt ?? now,
        lastErrorCode: safeErrorCode(errorCode),
        completedAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(maxBotOutbox.id, claim.id),
          eq(maxBotOutbox.status, 'processing'),
          eq(maxBotOutbox.attempts, claim.attempts),
        ),
      );
    if (affectedRows(failed) !== 1) throw new Error('Outbound claim lease was lost');
  }
}
