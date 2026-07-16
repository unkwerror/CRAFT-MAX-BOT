import { createHash } from 'node:crypto';
import { constants, createReadStream, type ReadStream } from 'node:fs';
import { chmod, link, lstat, mkdir, open, rm, unlink } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

import type { Readable } from 'node:stream';

const STORAGE_KEY_PATTERN = /^(?:quarantine|documents)\/[0-9a-f-]{36}(?:[.]upload)?$/;

export class FileStorageError extends Error {
  public readonly code: 'conflict' | 'invalid_key' | 'size_mismatch' | 'too_large';

  public constructor(code: 'conflict' | 'invalid_key' | 'size_mismatch' | 'too_large') {
    super(`Private file storage ${code}`);
    this.name = 'FileStorageError';
    this.code = code;
  }
}

export interface StoredUploadFacts {
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface PositionedWriter {
  write(
    buffer: Uint8Array,
    offset: number,
    length: number,
  ): Promise<{ readonly bytesWritten: number }>;
}

export async function writeAllBytes(destination: PositionedWriter, chunk: Buffer): Promise<void> {
  let offset = 0;
  while (offset < chunk.length) {
    const { bytesWritten } = await destination.write(chunk, offset, chunk.length - offset);
    if (
      !Number.isSafeInteger(bytesWritten) ||
      bytesWritten < 1 ||
      bytesWritten > chunk.length - offset
    ) {
      throw new FileStorageError('size_mismatch');
    }
    offset += bytesWritten;
  }
}

export interface PrivateFileStorageOptions {
  readonly maximumBytes: number;
  readonly root: string;
}

function validStorageKey(value: string): string {
  if (!STORAGE_KEY_PATTERN.test(value) || value.includes('..') || value.includes('\\')) {
    throw new FileStorageError('invalid_key');
  }
  return value;
}

export class PrivateFileStorage {
  readonly #maximumBytes: number;
  readonly #root: string;

  public constructor(options: PrivateFileStorageOptions) {
    if (!Number.isSafeInteger(options.maximumBytes) || options.maximumBytes < 1) {
      throw new RangeError('Private storage maximum size is invalid');
    }
    if (!options.root.startsWith('/') || options.root.split('/').includes('..')) {
      throw new TypeError('Private storage root must be an absolute normalized path');
    }
    this.#maximumBytes = options.maximumBytes;
    this.#root = resolve(options.root);
  }

  public async initialize(): Promise<void> {
    await mkdir(this.#root, { mode: 0o700, recursive: true });
    await Promise.all(
      ['quarantine', 'documents'].map(async (directory) => {
        const path = resolve(this.#root, directory);
        await mkdir(path, { mode: 0o700, recursive: true });
        const metadata = await lstat(path);
        if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
          throw new FileStorageError('invalid_key');
        }
        await chmod(path, 0o700);
      }),
    );
    const rootMetadata = await lstat(this.#root);
    if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
      throw new FileStorageError('invalid_key');
    }
    await chmod(this.#root, 0o700);
  }

  public quarantineKey(uploadId: string): string {
    return validStorageKey(`quarantine/${uploadId}.upload`);
  }

  public documentKey(documentId: string): string {
    return validStorageKey(`documents/${documentId}`);
  }

  public pathFor(storageKey: string): string {
    const key = validStorageKey(storageKey);
    const path = resolve(this.#root, key);
    if (!path.startsWith(`${this.#root}${sep}`)) throw new FileStorageError('invalid_key');
    return path;
  }

  public async receive(
    storageKey: string,
    input: Readable,
    expectedBytes: number,
  ): Promise<StoredUploadFacts> {
    if (
      !Number.isSafeInteger(expectedBytes) ||
      expectedBytes < 1 ||
      expectedBytes > this.#maximumBytes
    ) {
      throw new FileStorageError(
        expectedBytes > this.#maximumBytes ? 'too_large' : 'size_mismatch',
      );
    }
    const path = this.pathFor(storageKey);
    let destination;
    try {
      destination = await open(
        path,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600,
      );
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'EEXIST'
      ) {
        throw new FileStorageError('conflict');
      }
      throw error;
    }

    const hash = createHash('sha256');
    let sizeBytes = 0;
    try {
      for await (const value of input) {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as ArrayBuffer);
        sizeBytes += chunk.length;
        if (sizeBytes > expectedBytes || sizeBytes > this.#maximumBytes) {
          throw new FileStorageError(
            sizeBytes > this.#maximumBytes ? 'too_large' : 'size_mismatch',
          );
        }
        hash.update(chunk);
        await writeAllBytes(destination, chunk);
      }
      if (sizeBytes !== expectedBytes) throw new FileStorageError('size_mismatch');
      await destination.sync();
      await destination.chmod(0o600);
      return { sha256: hash.digest('hex'), sizeBytes };
    } catch (error) {
      await destination.close().catch(() => undefined);
      await rm(path, { force: true }).catch(() => undefined);
      throw error;
    } finally {
      await destination.close().catch(() => undefined);
    }
  }

  public async promote(quarantineKey: string, documentKey: string): Promise<void> {
    const source = this.pathFor(quarantineKey);
    const destination = this.pathFor(documentKey);
    try {
      const sourceMetadata = await lstat(source);
      if (!sourceMetadata.isFile() || sourceMetadata.isSymbolicLink()) {
        throw new FileStorageError('invalid_key');
      }
      await link(source, destination);
      await unlink(source);
      await chmod(destination, 0o600);
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error) {
        const code = error.code;
        if (code === 'ENOENT' || code === 'EEXIST') {
          const [sourceMetadata, destinationMetadata] = await Promise.all([
            lstat(source).catch(() => null),
            lstat(destination).catch(() => null),
          ]);
          if (
            destinationMetadata?.isFile() === true &&
            !destinationMetadata.isSymbolicLink() &&
            (sourceMetadata === null ||
              (sourceMetadata.isFile() &&
                !sourceMetadata.isSymbolicLink() &&
                sourceMetadata.dev === destinationMetadata.dev &&
                sourceMetadata.ino === destinationMetadata.ino))
          ) {
            if (sourceMetadata !== null) await unlink(source);
            await chmod(destination, 0o600);
            return;
          }
        }
      }
      throw error;
    }
  }

  public async existingKey(primaryKey: string, fallbackKey: string): Promise<string> {
    for (const key of [primaryKey, fallbackKey]) {
      const metadata = await lstat(this.pathFor(key)).catch(() => null);
      if (metadata?.isFile() === true && !metadata.isSymbolicLink()) return key;
    }
    throw new FileStorageError('invalid_key');
  }

  public open(storageKey: string): ReadStream {
    return createReadStream(this.pathFor(storageKey), {
      // Numeric open(2) flags are supported by Node, although @types/node narrows this to strings.
      flags: (constants.O_RDONLY | constants.O_NOFOLLOW) as unknown as string,
    });
  }

  public async remove(storageKey: string): Promise<void> {
    await rm(this.pathFor(storageKey), { force: true });
  }
}
