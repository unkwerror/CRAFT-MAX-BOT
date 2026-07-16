import { randomUUID } from 'node:crypto';

import {
  classifyTrackerFailure,
  TrackerApiError,
  type TrackerCreateIssueBody,
  type TrackerIssueResult,
} from './tracker-api.js';
import { buildTrackerIssuePlan, type TrackerOperation } from './tracker-plan.js';
import type {
  ClaimedTrackerOperation,
  TrackerOperationCandidate,
  TrackerOutboxStore,
} from './tracker-repository.js';
import { retryDate, type RetryPolicy } from './retry.js';
import type { WorkerLogger } from './runtime.js';

export interface TrackerIssueWriter {
  ensureIssue(body: TrackerCreateIssueBody): Promise<TrackerIssueResult>;
}

export interface TrackerWorkerOptions extends RetryPolicy {
  readonly apiTimeoutMs: number;
  readonly assignee: string | null;
  readonly dryRun: boolean;
  readonly leaseSeconds: number;
  readonly leaseToken?: () => string;
  readonly log?: WorkerLogger;
  readonly maxAttempts: number;
  readonly now?: () => Date;
  readonly pollIntervalMs: number;
  readonly productionWritesApproved: boolean;
  readonly store: TrackerOutboxStore;
  readonly trackerApi: TrackerIssueWriter;
}

export interface TrackerDryRunPreview {
  readonly operation: TrackerOperation;
  readonly outboxId: string;
  readonly payloadHash: string;
}

export interface TrackerWorkerCycleResult {
  readonly claimed: boolean;
  readonly preview: readonly TrackerDryRunPreview[];
}

const MAX_API_REQUESTS_PER_OPERATION = 3;
const LEASE_SAFETY_MARGIN_MS = 1_000;

function validNow(clock: () => Date): Date {
  const now = clock();
  if (Number.isNaN(now.getTime()))
    throw new RangeError('Tracker worker clock returned an invalid date');
  return now;
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function validatePayload(candidate: TrackerOperationCandidate): void {
  if (candidate.payload.schemaVersion !== 1) {
    throw new TypeError('Tracker outbox payload schema is unsupported');
  }
}

function payloadError(error: unknown): boolean {
  return error instanceof TypeError || error instanceof RangeError;
}

function validateLiveConfiguration(options: TrackerWorkerOptions): void {
  if (!Number.isSafeInteger(options.leaseSeconds) || options.leaseSeconds <= 0) {
    throw new RangeError('Tracker lease duration must be positive');
  }
  if (
    !Number.isSafeInteger(options.apiTimeoutMs) ||
    options.apiTimeoutMs < 500 ||
    options.apiTimeoutMs > 30_000
  ) {
    throw new RangeError('Tracker API timeout is invalid');
  }
  const minimumLeaseMilliseconds =
    options.apiTimeoutMs * MAX_API_REQUESTS_PER_OPERATION + LEASE_SAFETY_MARGIN_MS;
  if (options.leaseSeconds * 1_000 < minimumLeaseMilliseconds) {
    throw new RangeError('Tracker lease does not cover the maximum API request duration');
  }
  if (
    options.assignee === null ||
    options.assignee.trim().length === 0 ||
    options.assignee.trim().length > 255 ||
    [...options.assignee.trim()].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  ) {
    throw new TypeError('Tracker assignee is required for production writes');
  }
}

function validateTrackerResult(result: TrackerIssueResult): void {
  if (!/^[A-Z][A-Z0-9_]{0,31}-[1-9]\d*$/.test(result.key)) {
    throw new TrackerApiError('protocol', { retryable: false, statusCode: 200 });
  }
}

function trackerFailureCode(error: unknown): string {
  if (error instanceof TypeError || error instanceof RangeError) return 'tracker_payload_invalid';
  if (error instanceof TrackerApiError) {
    return error.statusCode === null
      ? `tracker_${error.kind}`
      : `tracker_http_${String(error.statusCode)}`;
  }
  return 'tracker_processing_failed';
}

async function failTrackerOperation(
  claim: ClaimedTrackerOperation,
  error: unknown,
  options: TrackerWorkerOptions,
  now: Date,
): Promise<void> {
  const classification =
    payloadError(error) || error instanceof TrackerApiError
      ? classifyTrackerFailure(error)
      : { retryAfterMs: null, retryable: true, statusCode: null };
  const retryAt =
    classification.retryable && claim.attempts < options.maxAttempts
      ? retryDate(now, claim.attempts, options, classification.retryAfterMs)
      : null;
  const errorCode = trackerFailureCode(error);
  try {
    await options.store.failTrackerOperation(claim, errorCode, retryAt, now);
    options.log?.(retryAt === null ? 'error' : 'warn', 'tracker_operation_failed', {
      attempts: claim.attempts,
      errorCode,
      operation: claim.operation,
      outboxId: claim.id,
      retrying: retryAt !== null,
    });
  } catch {
    options.log?.('error', 'tracker_failure_persistence_deferred', {
      attempts: claim.attempts,
      operation: claim.operation,
      outboxId: claim.id,
    });
  }
}

async function releaseForShutdown(
  claim: ClaimedTrackerOperation,
  options: TrackerWorkerOptions,
  now: Date,
): Promise<void> {
  try {
    await options.store.failTrackerOperation(claim, 'worker_shutdown', now, now);
  } catch {
    options.log?.('error', 'tracker_shutdown_release_deferred', {
      attempts: claim.attempts,
      operation: claim.operation,
      outboxId: claim.id,
    });
  }
}

async function previewTrackerPlans(
  options: TrackerWorkerOptions,
  now: Date,
): Promise<readonly TrackerDryRunPreview[]> {
  const candidates = await options.store.previewTrackerOperations(now);
  const contexts = new Map<
    string,
    Awaited<ReturnType<TrackerOutboxStore['loadTrackerOperationContext']>>
  >();
  const previews: TrackerDryRunPreview[] = [];

  for (const candidate of candidates) {
    validatePayload(candidate);
    let context = contexts.get(candidate.submissionDatabaseId);
    if (context === undefined) {
      context = await options.store.loadTrackerOperationContext(candidate.submissionDatabaseId);
      contexts.set(candidate.submissionDatabaseId, context);
    }
    const plan = buildTrackerIssuePlan(
      candidate.operation,
      context.submission,
      {
        crmKey: context.dependencies.crmKey ?? 'CRM-1',
        partnerKey: context.dependencies.partnerKey ?? 'PART-1',
      },
      { assignee: options.assignee },
    );
    previews.push({
      operation: candidate.operation,
      outboxId: candidate.id,
      payloadHash: plan.payloadHash,
    });
  }
  return previews;
}

export async function runTrackerWorkerCycle(
  options: TrackerWorkerOptions,
  signal?: AbortSignal,
): Promise<TrackerWorkerCycleResult> {
  if (isAborted(signal)) return { claimed: false, preview: [] };
  const clock = options.now ?? (() => new Date());
  const cycleNow = validNow(clock);

  const writesEnabled = options.dryRun === false && options.productionWritesApproved === true;
  if (!writesEnabled) {
    return { claimed: false, preview: await previewTrackerPlans(options, cycleNow) };
  }

  validateLiveConfiguration(options);
  const leaseExpiresAt = new Date(cycleNow.getTime() + options.leaseSeconds * 1_000);
  const claim = await options.store.claimTrackerOperation(
    cycleNow,
    leaseExpiresAt,
    options.leaseToken?.() ?? randomUUID(),
  );
  if (claim === null) return { claimed: false, preview: [] };

  if (isAborted(signal)) {
    await releaseForShutdown(claim, options, cycleNow);
    return { claimed: true, preview: [] };
  }

  try {
    validatePayload(claim);
  } catch (error) {
    await failTrackerOperation(claim, error, options, validNow(clock));
    return { claimed: true, preview: [] };
  }

  let context: Awaited<ReturnType<TrackerOutboxStore['loadTrackerOperationContext']>>;
  try {
    context = await options.store.loadTrackerOperationContext(claim.submissionDatabaseId);
  } catch {
    options.log?.('error', 'tracker_context_load_deferred', {
      attempts: claim.attempts,
      operation: claim.operation,
      outboxId: claim.id,
    });
    return { claimed: true, preview: [] };
  }

  let plan: ReturnType<typeof buildTrackerIssuePlan>;
  try {
    plan = buildTrackerIssuePlan(claim.operation, context.submission, context.dependencies, {
      assignee: options.assignee,
    });
  } catch (error) {
    if (payloadError(error)) {
      await failTrackerOperation(claim, error, options, validNow(clock));
    } else {
      options.log?.('error', 'tracker_plan_deferred', {
        attempts: claim.attempts,
        operation: claim.operation,
        outboxId: claim.id,
      });
    }
    return { claimed: true, preview: [] };
  }

  if (isAborted(signal)) {
    await releaseForShutdown(claim, options, validNow(clock));
    return { claimed: true, preview: [] };
  }

  let result: TrackerIssueResult;
  try {
    result = await options.trackerApi.ensureIssue(plan.body);
    validateTrackerResult(result);
  } catch (error) {
    await failTrackerOperation(claim, error, options, validNow(clock));
    return { claimed: true, preview: [] };
  }

  try {
    await options.store.completeTrackerOperation(claim, result.key, validNow(clock));
  } catch {
    options.log?.('error', 'tracker_completion_deferred', {
      attempts: claim.attempts,
      operation: claim.operation,
      outboxId: claim.id,
    });
    return { claimed: true, preview: [] };
  }
  options.log?.('info', 'tracker_operation_completed', {
    attempts: claim.attempts,
    operation: claim.operation,
    outboxId: claim.id,
  });

  return { claimed: true, preview: [] };
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

export async function runTrackerWorker(
  options: TrackerWorkerOptions,
  signal: AbortSignal,
): Promise<void> {
  let previousPreviews = new Set<string>();
  while (!signal.aborted) {
    let worked = false;
    try {
      const result = await runTrackerWorkerCycle(options, signal);
      worked = result.claimed;
      const currentPreviews = new Set<string>();
      for (const preview of result.preview) {
        const signature = `${preview.outboxId}:${preview.payloadHash}`;
        currentPreviews.add(signature);
        if (!previousPreviews.has(signature)) {
          options.log?.('info', 'tracker_dry_run_preview', {
            operation: preview.operation,
            outboxId: preview.outboxId,
            payloadHash: preview.payloadHash,
          });
        }
      }
      previousPreviews = currentPreviews;
    } catch {
      options.log?.('error', 'tracker_worker_cycle_failed');
    }
    if (!worked) await waitForNextCycle(options.pollIntervalMs, signal);
  }
}
