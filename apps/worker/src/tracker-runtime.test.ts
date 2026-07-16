import { describe, expect, it, vi } from 'vitest';

import { TrackerApiError, type TrackerCreateIssueBody } from './tracker-api.js';
import type { TrackerSubmissionSnapshot } from './tracker-plan.js';
import type {
  ClaimedTrackerOperation,
  TrackerOperationCandidate,
  TrackerOperationContext,
  TrackerOutboxStore,
} from './tracker-repository.js';
import { runTrackerWorkerCycle, type TrackerIssueWriter } from './tracker-runtime.js';

const NOW = new Date('2026-07-16T05:00:00.000Z');
const LEASE_TOKEN = '10000000-0000-4000-8000-000000000009';

const submission: TrackerSubmissionSnapshot = {
  areaSquareMeters: '12500.00',
  city: 'Тюмень',
  contactEmail: 'client@example.com',
  contactName: 'Иван Петров',
  contactPhone: '+79991234567',
  culturalHeritage: false,
  description: 'Нужна концепция',
  desiredStart: '2026-09-01',
  documents: [],
  expertiseRequired: null,
  inn: '7707083893',
  materialLinks: [],
  maxUserId: '123456789',
  objectCount: 1,
  objectType: 'office',
  organization: 'ООО Девелопмент',
  projectScope: 'single_object',
  projectStage: 'concept',
  region: 'Тюменская область',
  role: 'developer',
  selectedCaseIds: ['office-reconstruction'],
  services: ['architecture'],
  submissionId: 'CRAFT-20260716-ABCDEF',
};

function candidate(operation: ClaimedTrackerOperation['operation'] = 'upsert_partner') {
  return {
    attempts: 1,
    id: '10000000-0000-4000-8000-000000000001',
    leaseToken: LEASE_TOKEN,
    operation,
    payload: { schemaVersion: 1 },
    submissionDatabaseId: '10000000-0000-4000-8000-000000000002',
  } satisfies ClaimedTrackerOperation;
}

class MemoryTrackerStore implements TrackerOutboxStore {
  public claim: ClaimedTrackerOperation | null = null;
  public preview: readonly TrackerOperationCandidate[] = [];
  public context: TrackerOperationContext = {
    dependencies: { crmKey: null, partnerKey: null },
    submission,
  };
  public completed: { claim: ClaimedTrackerOperation; key: string; now: Date } | null = null;
  public failure: {
    claim: ClaimedTrackerOperation;
    errorCode: string;
    now: Date;
    retryAt: Date | null;
  } | null = null;
  public claimArguments: { leaseExpiresAt: Date; leaseToken: string; now: Date } | null = null;
  public completeError: Error | null = null;
  public contextError: Error | null = null;
  public contextLoads = 0;
  public onClaim: (() => void) | null = null;

  public async backfillTrackerOutbox(): Promise<number> {
    return 0;
  }

  public async claimTrackerOperation(
    now: Date,
    leaseExpiresAt: Date,
    leaseToken: string,
  ): Promise<ClaimedTrackerOperation | null> {
    this.claimArguments = { leaseExpiresAt, leaseToken, now };
    const value = this.claim;
    this.claim = null;
    this.onClaim?.();
    return value;
  }

  public async previewTrackerOperations(): Promise<readonly TrackerOperationCandidate[]> {
    return this.preview;
  }

  public async loadTrackerOperationContext(): Promise<TrackerOperationContext> {
    this.contextLoads += 1;
    if (this.contextError !== null) throw this.contextError;
    return this.context;
  }

  public async completeTrackerOperation(
    claim: ClaimedTrackerOperation,
    key: string,
    now: Date,
  ): Promise<void> {
    if (this.completeError !== null) throw this.completeError;
    this.completed = { claim, key, now };
  }

  public async failTrackerOperation(
    claim: ClaimedTrackerOperation,
    errorCode: string,
    retryAt: Date | null,
    now: Date,
  ): Promise<void> {
    this.failure = { claim, errorCode, now, retryAt };
  }
}

function options(
  store: MemoryTrackerStore,
  trackerApi: TrackerIssueWriter,
  dryRun = false,
  productionWritesApproved = true,
  assignee: string | null = 'craft72.tracker',
  apiTimeoutMs = 10_000,
) {
  return {
    apiTimeoutMs,
    assignee,
    baseDelayMs: 1_000,
    dryRun,
    leaseSeconds: 90,
    leaseToken: () => LEASE_TOKEN,
    maxAttempts: 8,
    maximumDelayMs: 300_000,
    now: () => NOW,
    pollIntervalMs: 1_000,
    productionWritesApproved,
    random: () => 0.5,
    store,
    trackerApi,
  } as const;
}

describe('Tracker Stage 6 worker cycle', () => {
  it('claims with a lease and completes an idempotent PART operation', async () => {
    const store = new MemoryTrackerStore();
    store.claim = candidate();
    const ensureIssue = vi.fn(async (_body: TrackerCreateIssueBody) => ({ key: 'PART-10' }));

    await expect(runTrackerWorkerCycle(options(store, { ensureIssue }))).resolves.toEqual({
      claimed: true,
      preview: [],
    });

    expect(store.claimArguments).toEqual({
      leaseExpiresAt: new Date(NOW.getTime() + 90_000),
      leaseToken: LEASE_TOKEN,
      now: NOW,
    });
    expect(ensureIssue).toHaveBeenCalledOnce();
    expect(ensureIssue.mock.calls[0]?.[0]).toMatchObject({
      assignee: 'craft72.tracker',
      queue: 'PART',
      unique: 'craft72:part:inn:7707083893',
    });
    expect(store.completed).toMatchObject({ key: 'PART-10' });
    expect(store.failure).toBeNull();
  });

  it('honors Retry-After and jitter for a retryable Tracker failure', async () => {
    const store = new MemoryTrackerStore();
    store.claim = { ...candidate(), attempts: 2 };
    const trackerApi: TrackerIssueWriter = {
      ensureIssue: async () => {
        throw new TrackerApiError('http', {
          retryAfterMs: 3_000,
          retryable: true,
          statusCode: 429,
        });
      },
    };

    await runTrackerWorkerCycle(options(store, trackerApi));

    expect(store.failure).toMatchObject({
      errorCode: 'tracker_http_429',
      retryAt: new Date(NOW.getTime() + 3_000),
    });
    expect(store.completed).toBeNull();
  });

  it('dead-letters invalid dependent plans without calling Tracker', async () => {
    const store = new MemoryTrackerStore();
    store.claim = candidate('create_crm');
    const ensureIssue = vi.fn(async () => ({ key: 'CRM-20' }));

    await runTrackerWorkerCycle(options(store, { ensureIssue }));

    expect(ensureIssue).not.toHaveBeenCalled();
    expect(store.failure).toMatchObject({ errorCode: 'tracker_payload_invalid', retryAt: null });
  });

  it('previews a plan in dry-run without claims, state changes or HTTP writes', async () => {
    const store = new MemoryTrackerStore();
    store.preview = [candidate()];
    const ensureIssue = vi.fn(async () => ({ key: 'PART-10' }));

    const result = await runTrackerWorkerCycle(options(store, { ensureIssue }, true));

    expect(result.claimed).toBe(false);
    expect(result.preview).toEqual([
      expect.objectContaining({ operation: 'upsert_partner', outboxId: candidate().id }),
    ]);
    expect(result.preview[0]?.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(store.claimArguments).toBeNull();
    expect(store.completed).toBeNull();
    expect(store.failure).toBeNull();
    expect(ensureIssue).not.toHaveBeenCalled();
  });

  it('fails closed when dry-run is off but production writes are not explicitly approved', async () => {
    const store = new MemoryTrackerStore();
    store.preview = [candidate()];
    store.claim = candidate();
    const ensureIssue = vi.fn(async () => ({ key: 'PART-10' }));

    const result = await runTrackerWorkerCycle(options(store, { ensureIssue }, false, false));

    expect(result).toMatchObject({
      claimed: false,
      preview: [expect.objectContaining({ operation: 'upsert_partner' })],
    });
    expect(store.claimArguments).toBeNull();
    expect(store.completed).toBeNull();
    expect(store.failure).toBeNull();
    expect(ensureIssue).not.toHaveBeenCalled();
  });

  it('releases a claim fenced for immediate retry when shutdown starts', async () => {
    const controller = new AbortController();
    const store = new MemoryTrackerStore();
    store.claim = candidate();
    store.onClaim = () => controller.abort();
    const ensureIssue = vi.fn(async () => ({ key: 'PART-10' }));

    await runTrackerWorkerCycle(options(store, { ensureIssue }), controller.signal);

    expect(ensureIssue).not.toHaveBeenCalled();
    expect(store.failure).toMatchObject({ errorCode: 'worker_shutdown', retryAt: NOW });
  });

  it('previews every PART, CRM and DOCS row with synthetic dependencies and no mutations', async () => {
    const store = new MemoryTrackerStore();
    store.preview = [
      candidate('upsert_partner'),
      { ...candidate('create_crm'), id: '10000000-0000-4000-8000-000000000003' },
      { ...candidate('create_docs'), id: '10000000-0000-4000-8000-000000000004' },
    ];
    store.context = {
      dependencies: { crmKey: null, partnerKey: null },
      submission: { ...submission, materialLinks: ['https://files.example.com/brief'] },
    };
    const ensureIssue = vi.fn(async () => ({ key: 'PART-10' }));

    const result = await runTrackerWorkerCycle(options(store, { ensureIssue }, true));

    expect(result.preview.map(({ operation }) => operation)).toEqual([
      'upsert_partner',
      'create_crm',
      'create_docs',
    ]);
    expect(store.contextLoads).toBe(1);
    expect(store.claimArguments).toBeNull();
    expect(store.completed).toBeNull();
    expect(store.failure).toBeNull();
    expect(ensureIssue).not.toHaveBeenCalled();
  });

  it('fails closed before claiming when production writes have no assignee', async () => {
    const store = new MemoryTrackerStore();
    store.claim = candidate();
    const ensureIssue = vi.fn(async () => ({ key: 'PART-10' }));

    await expect(
      runTrackerWorkerCycle(options(store, { ensureIssue }, false, true, null)),
    ).rejects.toThrow('assignee is required');

    expect(store.claimArguments).toBeNull();
    expect(ensureIssue).not.toHaveBeenCalled();
  });

  it('validates that the lease covers all possible sequential API requests', async () => {
    const store = new MemoryTrackerStore();
    store.claim = candidate();
    const ensureIssue = vi.fn(async () => ({ key: 'PART-10' }));

    await expect(
      runTrackerWorkerCycle(options(store, { ensureIssue }, false, true, 'owner', 30_000)),
    ).rejects.toThrow('lease does not cover');

    expect(store.claimArguments).toBeNull();
    expect(ensureIssue).not.toHaveBeenCalled();
  });

  it('leaves a processing claim for lease recovery when completion persistence fails', async () => {
    const store = new MemoryTrackerStore();
    store.claim = candidate();
    store.completeError = new Error('database unavailable');
    const ensureIssue = vi.fn(async () => ({ key: 'PART-10' }));

    await expect(runTrackerWorkerCycle(options(store, { ensureIssue }))).resolves.toEqual({
      claimed: true,
      preview: [],
    });

    expect(ensureIssue).toHaveBeenCalledOnce();
    expect(store.failure).toBeNull();
    expect(store.completed).toBeNull();
  });

  it('leaves a processing claim for lease recovery when its database context cannot load', async () => {
    const store = new MemoryTrackerStore();
    store.claim = candidate();
    store.contextError = new Error('database unavailable');
    const ensureIssue = vi.fn(async () => ({ key: 'PART-10' }));

    await runTrackerWorkerCycle(options(store, { ensureIssue }));

    expect(ensureIssue).not.toHaveBeenCalled();
    expect(store.failure).toBeNull();
    expect(store.completed).toBeNull();
  });
});
