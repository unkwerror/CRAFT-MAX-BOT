import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Socket } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { ClamAvScanner, type ClamAvError } from './clamav.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function fixture(): Promise<{ readonly file: string; readonly socket: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'craft72-clamav-test-'));
  temporaryDirectories.push(directory);
  const file = join(directory, 'fixture.bin');
  await writeFile(file, 'safe fixture');
  return { file, socket: join(directory, 'clamd.sock') };
}

async function fakeClamd(
  socketPath: string,
  response: string,
  version = 'ClamAV 1.5.3/28061/Thu Jul 16 05:00:00 2026',
): Promise<{ readonly close: () => Promise<void> }> {
  const server = createServer((socket: Socket) => {
    let received = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);
      if (received.subarray(0, 9).equals(Buffer.from('zVERSION\0'))) {
        socket.end(`${version}\0`);
        return;
      }
      if (!received.subarray(0, 10).equals(Buffer.from('zINSTREAM\0'))) return;
      let offset = 10;
      while (offset + 4 <= received.length) {
        const size = received.readUInt32BE(offset);
        if (offset + 4 + size > received.length) return;
        offset += 4 + size;
        if (size === 0) {
          socket.end(`${response}\0`);
          return;
        }
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  return {
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

describe('ClamAV INSTREAM client', () => {
  it('checks daemon readiness without sending a file', async () => {
    const { socket } = await fixture();
    const server = await fakeClamd(socket, 'stream: OK');
    try {
      await expect(
        new ClamAvScanner({
          now: () => new Date('2026-07-16T06:00:00.000Z'),
          socketPath: socket,
          timeoutMs: 2_000,
        }).ping(),
      ).resolves.toBeUndefined();
    } finally {
      await server.close();
    }
  });

  it('fails readiness when the official signature database is stale', async () => {
    const { socket } = await fixture();
    const server = await fakeClamd(
      socket,
      'stream: OK',
      'ClamAV 1.5.3/28000/Mon Jul 06 05:00:00 2026',
    );
    try {
      await expect(
        new ClamAvScanner({
          now: () => new Date('2026-07-16T06:00:00.000Z'),
          socketPath: socket,
          timeoutMs: 2_000,
        }).ping(),
      ).rejects.toMatchObject({ code: 'protocol' } satisfies Partial<ClamAvError>);
    } finally {
      await server.close();
    }
  });

  it('streams a clean file over the Unix socket', async () => {
    const { file, socket } = await fixture();
    const server = await fakeClamd(socket, 'stream: OK');
    try {
      await expect(
        new ClamAvScanner({ socketPath: socket, timeoutMs: 2_000 }).scan(file),
      ).resolves.toEqual({
        kind: 'clean',
      });
    } finally {
      await server.close();
    }
  });

  it('returns only a normalized malware signature for infected content', async () => {
    const { file, socket } = await fixture();
    const server = await fakeClamd(socket, 'stream: Win.Test.EICAR_HDB-1 FOUND');
    try {
      await expect(
        new ClamAvScanner({ socketPath: socket, timeoutMs: 2_000 }).scan(file),
      ).resolves.toEqual({
        kind: 'infected',
        signature: 'Win.Test.EICAR_HDB-1',
      });
    } finally {
      await server.close();
    }
  });

  it('fails closed when the scanner socket is unavailable', async () => {
    const { file, socket } = await fixture();
    await expect(
      new ClamAvScanner({ socketPath: socket, timeoutMs: 2_000 }).scan(file),
    ).rejects.toMatchObject({ code: 'unavailable' } satisfies Partial<ClamAvError>);
  });
});
