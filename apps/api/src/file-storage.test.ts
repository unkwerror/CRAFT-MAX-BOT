import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import {
  FileStorageError,
  PrivateFileStorage,
  writeAllBytes,
  type PositionedWriter,
} from './file-storage.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function storage(maximumBytes = 1_024): Promise<PrivateFileStorage> {
  const root = await mkdtemp(join(tmpdir(), 'craft72-storage-test-'));
  temporaryDirectories.push(root);
  const result = new PrivateFileStorage({ maximumBytes, root });
  await result.initialize();
  return result;
}

describe('private streaming file storage', () => {
  it('retries short writes until every byte in a chunk is persisted', async () => {
    const persisted: Buffer[] = [];
    const writer: PositionedWriter = {
      async write(buffer, offset, length) {
        const bytesWritten = Math.min(2, length);
        persisted.push(Buffer.from(buffer.subarray(offset, offset + bytesWritten)));
        return { bytesWritten };
      },
    };
    await writeAllBytes(writer, Buffer.from('partial-write'));
    expect(Buffer.concat(persisted).toString('utf8')).toBe('partial-write');
    expect(persisted.length).toBeGreaterThan(1);
  });

  it('fails closed when a writer reports no forward progress', async () => {
    const writer: PositionedWriter = {
      async write() {
        return { bytesWritten: 0 };
      },
    };
    await expect(writeAllBytes(writer, Buffer.from('blocked'))).rejects.toMatchObject({
      code: 'size_mismatch',
    } satisfies Partial<FileStorageError>);
  });

  it('streams bytes into quarantine and promotes an opaque internal name', async () => {
    const target = await storage();
    const uploadId = randomUUID();
    const documentId = randomUUID();
    const contents = Buffer.from('%PDF-1.7\nprivate');
    const facts = await target.receive(
      target.quarantineKey(uploadId),
      Readable.from([contents.subarray(0, 5), contents.subarray(5)]),
      contents.length,
    );
    expect(facts).toEqual({
      sha256: createHash('sha256').update(contents).digest('hex'),
      sizeBytes: contents.length,
    });

    const documentKey = target.documentKey(documentId);
    await target.promote(target.quarantineKey(uploadId), documentKey);
    expect(await readFile(target.pathFor(documentKey))).toEqual(contents);
    expect((await stat(target.pathFor(documentKey))).mode & 0o777).toBe(0o600);
  });

  it('removes partial content after an oversized or truncated stream', async () => {
    const target = await storage(8);
    const oversizedKey = target.quarantineKey(randomUUID());
    await expect(
      target.receive(oversizedKey, Readable.from([Buffer.alloc(9)]), 8),
    ).rejects.toMatchObject({ code: 'too_large' } satisfies Partial<FileStorageError>);
    await expect(stat(target.pathFor(oversizedKey))).rejects.toMatchObject({ code: 'ENOENT' });

    const truncatedKey = target.quarantineKey(randomUUID());
    await expect(
      target.receive(truncatedKey, Readable.from([Buffer.alloc(3)]), 4),
    ).rejects.toMatchObject({ code: 'size_mismatch' } satisfies Partial<FileStorageError>);
    await expect(stat(target.pathFor(truncatedKey))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects path traversal and refuses to overwrite an existing capability target', async () => {
    const target = await storage();
    expect(() => target.pathFor('../../etc/passwd')).toThrow(FileStorageError);
    const key = target.quarantineKey(randomUUID());
    await target.receive(key, Readable.from(['first']), 5);
    await expect(target.receive(key, Readable.from(['other']), 5)).rejects.toMatchObject({
      code: 'conflict',
    } satisfies Partial<FileStorageError>);
    expect(await readFile(target.pathFor(key), 'utf8')).toBe('first');
  });
});
