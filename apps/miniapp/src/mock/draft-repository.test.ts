import { LeadDraftFormStateSchema } from '@craft72/contracts/source';
import { describe, expect, it } from 'vitest';

import {
  LocalStorageDraftRepository,
  MOCK_DRAFT_STORAGE_KEY,
  type DraftStepSnapshot,
  type DraftStorage,
} from './draft-repository.js';

class MemoryStorage implements DraftStorage {
  readonly #items = new Map<string, string>();

  public getItem(key: string): string | null {
    return this.#items.get(key) ?? null;
  }

  public setItem(key: string, value: string): void {
    this.#items.set(key, value);
  }

  public removeItem(key: string): void {
    this.#items.delete(key);
  }
}

describe('localStorage mock draft persistence', () => {
  it('persists a lossless permissive form snapshot after a step and resumes it', () => {
    const storage = new MemoryStorage();
    let now = new Date('2026-07-15T08:00:00.000Z');
    const repository = new LocalStorageDraftRepository(storage, {
      now: () => now,
      source: 'new_project',
    });
    const rawFormState = LeadDraftFormStateSchema.parse({
      role: 'property_owner',
      fullName: ' Иван ',
      organization: '',
      inn: '72',
      objectType: 'cultural-heritage',
      location: { city: 'Тюм', region: '' },
      scope: { kind: 'portfolio', objectCount: '0' },
      area: { status: 'known', squareMeters: '1,' },
      currentStage: 'concept',
      services: ['restoration'],
      expertiseRequired: 'unknown',
      culturalHeritageSite: 'yes',
      desiredStart: { status: 'known', date: '2026-' },
      description: '',
      links: ['https://'],
      documentIds: [],
      selectedCaseIds: [],
      contact: { phone: '+7', email: 'owner@' },
      consent: { version: '2026-07-15', accepted: false },
    });

    const saved = repository.saveAfterStep({ currentStep: 3, payload: rawFormState });
    expect(saved.payload).toEqual(rawFormState);
    expect(saved.source).toBe('new_project');
    expect(saved.updatedAt).toBe('2026-07-15T08:00:00.000Z');

    now = new Date('2026-07-15T09:00:00.000Z');
    const resumedRepository = new LocalStorageDraftRepository(storage, { now: () => now });
    expect(resumedRepository.load()).toEqual(saved);

    const nextSnapshot = {
      ...rawFormState,
      contact: { ...rawFormState.contact, email: 'owner@example.com' },
    };
    const next = resumedRepository.saveAfterStep({ currentStep: 15, payload: nextSnapshot });
    expect(next.id).toBe(saved.id);
    expect(next.payload).toEqual(nextSnapshot);
    expect(next.updatedAt).toBe('2026-07-15T09:00:00.000Z');
  });

  it('discards corrupt browser state instead of trusting it', () => {
    const storage = new MemoryStorage();
    storage.setItem(MOCK_DRAFT_STORAGE_KEY, '{not-json');
    const repository = new LocalStorageDraftRepository(storage);

    expect(repository.load()).toBeNull();
    expect(storage.getItem(MOCK_DRAFT_STORAGE_KEY)).toBeNull();
  });

  it('validates before writing and rejects trusted verification flags', () => {
    const storage = new MemoryStorage();
    const repository = new LocalStorageDraftRepository(storage);
    const oversized: DraftStepSnapshot = {
      currentStep: 2,
      payload: { fullName: 'x'.repeat(201) },
    };
    const untrustedVerification = {
      currentStep: 14,
      payload: { contact: { phone: '+79991234567' }, phoneVerified: true },
    } as unknown as DraftStepSnapshot;

    expect(() => repository.saveAfterStep(oversized)).toThrow();
    expect(() => repository.saveAfterStep(untrustedVerification)).toThrow();
    expect(storage.getItem(MOCK_DRAFT_STORAGE_KEY)).toBeNull();
  });

  it('clears an existing snapshot explicitly', () => {
    const storage = new MemoryStorage();
    const repository = new LocalStorageDraftRepository(storage);
    repository.saveAfterStep({ currentStep: 1, payload: { role: 'developer' } });

    const firstId = repository.load()?.id;
    repository.clear();
    expect(repository.load()).toBeNull();

    const next = repository.saveAfterStep({ currentStep: 1, payload: { role: 'investor' } });
    expect(next.id).not.toBe(firstId);
  });

  it('does not crash while reading or clearing a restricted browser storage', () => {
    const restrictedStorage: DraftStorage = {
      getItem: () => {
        throw new Error('storage blocked');
      },
      removeItem: () => {
        throw new Error('storage blocked');
      },
      setItem: () => {
        throw new Error('storage blocked');
      },
    };
    const repository = new LocalStorageDraftRepository(restrictedStorage);

    expect(repository.load()).toBeNull();
    expect(() => repository.clear()).not.toThrow();
  });
});
