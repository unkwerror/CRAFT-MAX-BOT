import {
  LeadDraftSchema,
  LeadDraftFormStateSchema,
  LeadDraftUpsertRequestSchema,
  StartParamSchema,
  UuidSchema,
  type LeadDraft,
  type LeadDraftFormState,
  type StartParam,
} from '@craft72/contracts/source';

import { stableMockUuid } from './stable-identifiers.js';

export const MOCK_DRAFT_STORAGE_KEY = 'craft72:max-miniapp:draft:v1';
export const DEFAULT_MOCK_DRAFT_ID = '00000000-0000-4000-8000-000000000001';

const DEFAULT_DRAFT_TTL_MILLISECONDS = 30 * 24 * 60 * 60 * 1_000;

export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

class ResilientBrowserStorage implements DraftStorage {
  readonly #fallback = new Map<string, string>();
  readonly #primary: Storage | undefined;

  public constructor() {
    try {
      this.#primary = typeof window === 'undefined' ? undefined : window.localStorage;
    } catch {
      this.#primary = undefined;
    }
  }

  public getItem(key: string): string | null {
    try {
      const value = this.#primary?.getItem(key) ?? null;
      if (value !== null) this.#fallback.set(key, value);
      return value ?? this.#fallback.get(key) ?? null;
    } catch {
      return this.#fallback.get(key) ?? null;
    }
  }

  public setItem(key: string, value: string): void {
    this.#fallback.set(key, value);
    try {
      this.#primary?.setItem(key, value);
    } catch {
      // Restricted WebViews and storage quotas fall back to the in-memory copy.
    }
  }

  public removeItem(key: string): void {
    this.#fallback.delete(key);
    try {
      this.#primary?.removeItem(key);
    } catch {
      // The in-memory copy is already cleared.
    }
  }
}

export interface MockDraftRepositoryOptions {
  readonly storageKey?: string;
  readonly draftId?: string;
  readonly source?: StartParam | null;
  readonly ttlMilliseconds?: number;
  readonly now?: () => Date;
}

export interface DraftStepSnapshot {
  readonly currentStep: number;
  readonly payload: LeadDraftFormState;
}

function validateClockValue(value: Date): Date {
  if (Number.isNaN(value.getTime())) {
    throw new RangeError('Mock draft clock returned an invalid date');
  }

  return value;
}

export class LocalStorageDraftRepository {
  readonly #storage: DraftStorage;
  readonly #storageKey: string;
  #draftGeneration = 0;
  #draftId: string;
  readonly #source: StartParam | null;
  readonly #ttlMilliseconds: number;
  readonly #now: () => Date;

  public constructor(storage: DraftStorage, options: MockDraftRepositoryOptions = {}) {
    this.#storage = storage;
    this.#storageKey = options.storageKey ?? MOCK_DRAFT_STORAGE_KEY;
    this.#draftId = UuidSchema.parse(options.draftId ?? DEFAULT_MOCK_DRAFT_ID);
    this.#source =
      options.source === undefined || options.source === null
        ? null
        : StartParamSchema.parse(options.source);
    this.#ttlMilliseconds = options.ttlMilliseconds ?? DEFAULT_DRAFT_TTL_MILLISECONDS;
    this.#now = options.now ?? (() => new Date());

    if (!Number.isSafeInteger(this.#ttlMilliseconds) || this.#ttlMilliseconds <= 0) {
      throw new RangeError('Draft TTL must be a positive integer');
    }
  }

  public load(): LeadDraft | null {
    let serialized: string | null;
    try {
      serialized = this.#storage.getItem(this.#storageKey);
    } catch {
      return null;
    }
    if (serialized === null) {
      return null;
    }

    try {
      const result = LeadDraftSchema.safeParse(JSON.parse(serialized) as unknown);
      if (result.success) {
        return result.data;
      }
    } catch {
      // Corrupt browser state is discarded below and never reaches the UI as trusted data.
    }

    try {
      this.#storage.removeItem(this.#storageKey);
    } catch {
      // Invalid state is ignored even when a restricted storage cannot remove it.
    }
    return null;
  }

  /** Persist the complete validated form snapshot immediately after a completed brief step. */
  public saveAfterStep(input: DraftStepSnapshot): LeadDraft {
    const request = LeadDraftUpsertRequestSchema.parse(input);
    const previous = this.load();
    const now = validateClockValue(this.#now());
    const draft = LeadDraftSchema.parse({
      id: previous?.id ?? this.#draftId,
      currentStep: request.currentStep,
      payload: LeadDraftFormStateSchema.parse(request.payload),
      source: previous === null ? this.#source : previous.source,
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.#ttlMilliseconds).toISOString(),
    });

    this.#storage.setItem(this.#storageKey, JSON.stringify(draft));
    return draft;
  }

  public clear(): void {
    try {
      this.#storage.removeItem(this.#storageKey);
    } catch {
      // Clearing a mock draft must not crash a restricted embedded browser.
    } finally {
      this.#draftGeneration += 1;
      this.#draftId = stableMockUuid(
        'draft-generation',
        `${this.#draftId}:${String(this.#draftGeneration)}`,
      );
    }
  }
}

export function createBrowserDraftStorage(): DraftStorage {
  return new ResilientBrowserStorage();
}

export function createBrowserDraftRepository(
  options: MockDraftRepositoryOptions = {},
): LocalStorageDraftRepository {
  return new LocalStorageDraftRepository(createBrowserDraftStorage(), options);
}
