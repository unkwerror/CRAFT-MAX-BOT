import { BOT_WELCOME_CONTENT_KEY, publishedBotWelcomeText } from './bot-plan.js';
import { classifyMaxApiFailure, type MaxApiClient } from './max-api.js';
import { MaxUpdateParseError } from './max-update.js';
import {
  answerCallbackFromPayload,
  processWebhook,
  sendMessageBodyFromPayload,
  sentMessageIdFromResult,
} from './processor.js';
import type { BotWorkerStore, ClaimedOutboundAction, ClaimedWebhook } from './repository.js';
import { retryDate, type RetryPolicy } from './retry.js';

export interface WorkerLogFields {
  readonly [key: string]: boolean | number | string | null;
}

export type WorkerLogger = (
  level: 'error' | 'info' | 'warn',
  event: string,
  fields?: WorkerLogFields,
) => void;

export interface BotWorkerOptions extends RetryPolicy {
  readonly adminMaxUserIds?: readonly string[];
  readonly leaseSeconds: number;
  readonly maxAttempts: number;
  readonly maxApi: MaxApiClient;
  readonly managerDisplayName?: string;
  readonly managerUserId?: string;
  readonly now?: () => Date;
  readonly pollIntervalMs: number;
  readonly store: BotWorkerStore;
  readonly webApp: string;
  readonly log?: WorkerLogger;
}

export interface WorkerCycleResult {
  readonly outboundClaimed: boolean;
  readonly webhookClaimed: boolean;
}

function validNow(clock: () => Date): Date {
  const now = clock();
  if (Number.isNaN(now.getTime())) throw new RangeError('Worker clock returned an invalid date');
  return now;
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function errorCode(error: unknown): string {
  if (error instanceof MaxUpdateParseError) return 'max_update_invalid';
  if (error instanceof TypeError || error instanceof RangeError) return 'bot_payload_invalid';
  return 'bot_processing_failed';
}

function maxFailureCode(classification: ReturnType<typeof classifyMaxApiFailure>): string {
  return classification.statusCode === null
    ? `max_${classification.kind}`
    : `max_http_${String(classification.statusCode)}`;
}

async function failWebhook(
  claim: ClaimedWebhook,
  error: unknown,
  options: BotWorkerOptions,
  now: Date,
): Promise<void> {
  const permanent = error instanceof MaxUpdateParseError || error instanceof TypeError;
  const retryAt =
    permanent || claim.attempts >= options.maxAttempts
      ? null
      : retryDate(now, claim.attempts, options);
  await options.store.failWebhook(claim, errorCode(error), retryAt, now);
  options.log?.(retryAt === null ? 'error' : 'warn', 'webhook_failed', {
    attempts: claim.attempts,
    eventKey: claim.eventKey,
    retrying: retryAt !== null,
  });
}

async function loadWelcomeText(options: BotWorkerOptions): Promise<string | undefined> {
  try {
    const content = await options.store.getPublishedContent(BOT_WELCOME_CONTENT_KEY);
    if (content === null) return undefined;
    const text = publishedBotWelcomeText(content);
    if (text === null) {
      options.log?.('warn', 'bot_welcome_content_invalid', {
        contentKey: BOT_WELCOME_CONTENT_KEY,
      });
      return undefined;
    }
    return text;
  } catch {
    options.log?.('warn', 'bot_welcome_content_read_failed', {
      contentKey: BOT_WELCOME_CONTENT_KEY,
    });
    return undefined;
  }
}

async function deliverOutbound(
  claim: ClaimedOutboundAction,
  options: BotWorkerOptions,
): Promise<string | null> {
  if (claim.action === 'answer_callback') {
    const callback = answerCallbackFromPayload(claim.payload);
    await options.maxApi.answerCallback(callback.callbackId, callback.body);
    return null;
  }
  if (claim.action === 'send_message') {
    if (claim.chatId === null) throw new TypeError('MAX send_message action has no chat ID');
    const result = await options.maxApi.sendMessage(
      claim.chatId.toString(),
      sendMessageBodyFromPayload(claim.payload),
    );
    return sentMessageIdFromResult(result.body);
  }
  throw new TypeError('Unsupported MAX outbox action');
}

async function failOutbound(
  claim: ClaimedOutboundAction,
  error: unknown,
  options: BotWorkerOptions,
  now: Date,
): Promise<void> {
  const classification = classifyMaxApiFailure(error);
  const retryAt =
    classification.retryable && claim.attempts < options.maxAttempts
      ? retryDate(now, claim.attempts, options, classification.retryAfterMs)
      : null;
  await options.store.failOutboundAction(claim, maxFailureCode(classification), retryAt, now);
  options.log?.(retryAt === null ? 'error' : 'warn', 'outbound_failed', {
    actionId: claim.id,
    attempts: claim.attempts,
    errorCode: maxFailureCode(classification),
    retrying: retryAt !== null,
  });
}

export async function runWorkerCycle(
  options: BotWorkerOptions,
  signal?: AbortSignal,
): Promise<WorkerCycleResult> {
  if (isAborted(signal)) return { outboundClaimed: false, webhookClaimed: false };
  const cycleNow = validNow(options.now ?? (() => new Date()));
  const staleBefore = new Date(cycleNow.getTime() - options.leaseSeconds * 1_000);
  const webhook = await options.store.claimWebhook(cycleNow, staleBefore);
  if (webhook !== null) {
    try {
      const welcomeText = await loadWelcomeText(options);
      const result = processWebhook(
        webhook,
        options.webApp,
        options.adminMaxUserIds,
        welcomeText,
        options.managerUserId,
        options.managerDisplayName,
      );
      await options.store.completeWebhook(webhook, result, cycleNow);
    } catch (error) {
      await failWebhook(webhook, error, options, cycleNow);
    }
  }

  if (isAborted(signal)) {
    return { outboundClaimed: false, webhookClaimed: webhook !== null };
  }

  const outboundNow = validNow(options.now ?? (() => new Date()));
  const outboundStaleBefore = new Date(outboundNow.getTime() - options.leaseSeconds * 1_000);
  const outbound = await options.store.claimOutboundAction(outboundNow, outboundStaleBefore);
  if (outbound !== null) {
    if (isAborted(signal)) {
      await options.store.failOutboundAction(outbound, 'worker_shutdown', outboundNow, outboundNow);
      return { outboundClaimed: true, webhookClaimed: webhook !== null };
    }
    try {
      const providerMessageId = await deliverOutbound(outbound, options);
      await options.store.completeOutboundAction(outbound, outboundNow, providerMessageId);
    } catch (error) {
      await failOutbound(outbound, error, options, outboundNow);
    }
  }

  return { outboundClaimed: outbound !== null, webhookClaimed: webhook !== null };
}

function waitForNextCycle(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(done, milliseconds);
    timeout.unref?.();
    signal.addEventListener('abort', done, { once: true });

    function done(): void {
      clearTimeout(timeout);
      signal.removeEventListener('abort', done);
      resolve();
    }
  });
}

export async function runBotWorker(options: BotWorkerOptions, signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    let worked = false;
    try {
      const result = await runWorkerCycle(options, signal);
      worked = result.webhookClaimed || result.outboundClaimed;
    } catch {
      options.log?.('error', 'worker_cycle_failed');
    }
    if (!worked) await waitForNextCycle(options.pollIntervalMs, signal);
  }
}
