import type { Database } from '@craft72/database';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { PostgresBotWorkerStore } from './repository.js';

interface FakeResult {
  readonly rowCount: number;
  readonly rows: readonly Record<string, unknown>[];
}

class FakeDatabase {
  public readonly parameters: readonly unknown[][] = [];
  public readonly queries: string[] = [];
  readonly #dialect = new PgDialect();
  readonly #results: FakeResult[];

  public constructor(results: readonly FakeResult[]) {
    this.#results = [...results];
  }

  public async execute(query: SQL): Promise<FakeResult> {
    const rendered = this.#dialect.sqlToQuery(query);
    this.queries.push(rendered.sql);
    (this.parameters as unknown[][]).push(rendered.params);
    const result = this.#results.shift();
    if (result === undefined) throw new Error('Fake database has no queued result');
    return result;
  }

  public database(): Database {
    return this as unknown as Database;
  }
}

describe('PostgreSQL bot content repository', () => {
  it('loads only the published JSON object for the requested content key', async () => {
    const database = new FakeDatabase([
      { rowCount: 1, rows: [{ published: { text: 'Привет из админки' } }] },
    ]);
    const store = new PostgresBotWorkerStore(database.database());

    await expect(store.getPublishedContent('bot-welcome')).resolves.toEqual({
      text: 'Привет из админки',
    });

    expect(database.queries[0]).toContain('source_document.published is not null');
    expect(database.queries[0]).toContain("source_document.kind = 'bot'");
    expect(database.queries[0]).toContain('source_document.published_version is not null');
    expect(database.queries[0]).toContain('source_document.published_at is not null');
    expect(database.parameters[0]).toEqual(['bot-welcome']);
  });

  it('returns null when no published document exists', async () => {
    const database = new FakeDatabase([{ rowCount: 0, rows: [] }]);
    const store = new PostgresBotWorkerStore(database.database());

    await expect(store.getPublishedContent('bot-welcome')).resolves.toBeNull();
  });
});
