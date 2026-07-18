import { fileURLToPath } from 'node:url';

import { botDialogs, createDatabaseClient, maxUsers } from '@craft72/database';
import { inArray } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresAdminStore } from './admin-repository.js';

const databaseUrl = process.env.DATABASE_URL;
const destructiveTestEnabled = process.env.REPOSITORY_TEST_ALLOW_DESTRUCTIVE === 'true';
const describeWithDatabase =
  databaseUrl !== undefined && destructiveTestEnabled ? describe : describe.skip;

describeWithDatabase('PostgresAdminStore user directory integration', () => {
  const connectionString =
    databaseUrl ?? 'postgresql://disabled@127.0.0.1/craft72_admin_repository_disabled_test';
  const databaseName = new URL(connectionString).pathname.slice(1);
  if (!databaseName.endsWith('_test')) {
    throw new Error('Admin repository integration tests require a database name ending in _test');
  }

  const client = createDatabaseClient({ connectionString, max: 2 });
  const store = new PostgresAdminStore(client.db, { sessionTtlSeconds: 3_600 });
  let releaseIsolationLock: (() => Promise<void>) | null = null;
  const profileUserId = 900000000000000101n;
  const botOnlyUserId = 900000000000000102n;
  const chatIds = [900000000000000201n, 900000000000000202n, 900000000000000203n] as const;

  beforeAll(async () => {
    const isolationConnection = await client.pool.connect();
    await isolationConnection.query('select pg_advisory_lock(724256)');
    releaseIsolationLock = async () => {
      await isolationConnection.query('select pg_advisory_unlock(724256)');
      isolationConnection.release();
    };
    await migrate(client.db, {
      migrationsFolder: fileURLToPath(
        new URL('../../../packages/database/drizzle', import.meta.url),
      ),
    });
  });

  afterAll(async () => {
    await client.db.delete(botDialogs).where(inArray(botDialogs.chatId, [...chatIds]));
    await client.db
      .delete(maxUsers)
      .where(inArray(maxUsers.maxUserId, [profileUserId, botOnlyUserId]));
    if (releaseIsolationLock !== null) await releaseIsolationLock();
    await client.close();
  });

  it('deduplicates profiles and bot dialogs by MAX user ID and includes bot-only identities', async () => {
    const createdAt = new Date('2099-07-18T08:00:00.000Z');
    await client.db.insert(maxUsers).values({
      maxUserId: profileUserId,
      firstName: 'Профиль',
      lastName: 'Mini App',
      username: null,
      languageCode: 'ru',
      createdAt,
      updatedAt: createdAt,
    });
    await client.db.insert(botDialogs).values([
      {
        chatId: chatIds[0],
        maxUserId: profileUserId,
        createdAt: new Date('2099-07-18T08:01:00.000Z'),
        lastEventAt: new Date('2099-07-18T08:04:00.000Z'),
        updatedAt: new Date('2099-07-18T08:04:00.000Z'),
      },
      {
        chatId: chatIds[1],
        maxUserId: botOnlyUserId,
        createdAt: new Date('2099-07-18T08:02:00.000Z'),
        lastEventAt: new Date('2099-07-18T08:03:00.000Z'),
        updatedAt: new Date('2099-07-18T08:03:00.000Z'),
      },
      {
        chatId: chatIds[2],
        maxUserId: botOnlyUserId,
        createdAt: new Date('2099-07-18T08:03:00.000Z'),
        lastEventAt: new Date('2099-07-18T08:05:00.000Z'),
        updatedAt: new Date('2099-07-18T08:05:00.000Z'),
      },
    ]);
    await client.pool.query(
      `update bot_dialogs
          set created_at = '2099-07-18T08:02:00.123456Z'::timestamptz
        where chat_id = $1`,
      [chatIds[1]?.toString()],
    );

    const page = await store.listUsers({ limit: 100 });
    const profileItems = page.items.filter(({ maxUserId }) => maxUserId === String(profileUserId));
    const botOnlyItems = page.items.filter(({ maxUserId }) => maxUserId === String(botOnlyUserId));

    expect(profileItems).toHaveLength(1);
    expect(profileItems[0]).toMatchObject({
      displayName: 'Профиль Mini App',
      identitySource: 'miniapp_and_bot',
      botDialogCount: 1,
      user: { id: String(profileUserId), firstName: 'Профиль' },
    });
    expect(botOnlyItems).toHaveLength(1);
    expect(botOnlyItems[0]).toMatchObject({
      displayName: 'Пользователь MAX',
      identitySource: 'bot',
      botDialogCount: 2,
      user: null,
      lastBotEventAt: '2099-07-18T08:05:00.000Z',
    });

    const firstCursorPage = await store.listUsers({ limit: 1 });
    expect(firstCursorPage.items.map(({ maxUserId }) => maxUserId)).toEqual([
      String(botOnlyUserId),
    ]);
    expect(firstCursorPage.nextCursor).not.toBeNull();
    if (firstCursorPage.nextCursor === null) throw new Error('Expected a user directory cursor');
    const secondCursorPage = await store.listUsers({
      cursor: firstCursorPage.nextCursor,
      limit: 1,
    });
    expect(secondCursorPage.items.map(({ maxUserId }) => maxUserId)).toEqual([
      String(profileUserId),
    ]);
  });
});
