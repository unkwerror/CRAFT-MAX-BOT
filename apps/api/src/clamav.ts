import { constants, createReadStream } from 'node:fs';
import { once } from 'node:events';
import { createConnection, type Socket } from 'node:net';

const CLAMAV_CHUNK_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 4 * 1024;
const DEFAULT_MAXIMUM_SIGNATURE_AGE_MS = 48 * 60 * 60 * 1_000;
const MAXIMUM_CLOCK_SKEW_MS = 5 * 60 * 1_000;

export type ClamAvVerdict =
  { readonly kind: 'clean' } | { readonly kind: 'infected'; readonly signature: string };

export class ClamAvError extends Error {
  public readonly code: 'protocol' | 'timeout' | 'unavailable';

  public constructor(code: 'protocol' | 'timeout' | 'unavailable', options?: ErrorOptions) {
    super(`ClamAV ${code}`, options);
    this.name = 'ClamAvError';
    this.code = code;
  }
}

export interface ClamAvScannerOptions {
  readonly maximumSignatureAgeMs?: number;
  readonly now?: () => Date;
  readonly socketPath: string;
  readonly timeoutMs: number;
}

async function write(socket: Socket, value: Buffer | string): Promise<void> {
  if (socket.write(value)) return;
  await once(socket, 'drain');
}

function safeSignature(value: string): string {
  const normalized = value.replaceAll(/[^A-Za-z0-9._:+-]/g, '_').slice(0, 128);
  return normalized.length === 0 ? 'unknown_signature' : normalized;
}

export class ClamAvScanner {
  readonly #maximumSignatureAgeMs: number;
  readonly #now: () => Date;
  readonly #socketPath: string;
  readonly #timeoutMs: number;

  public constructor(options: ClamAvScannerOptions) {
    if (!options.socketPath.startsWith('/') || options.socketPath.split('/').includes('..')) {
      throw new TypeError('ClamAV socket path must be an absolute normalized path');
    }
    if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1_000) {
      throw new RangeError('ClamAV timeout is invalid');
    }
    const maximumSignatureAgeMs = options.maximumSignatureAgeMs ?? DEFAULT_MAXIMUM_SIGNATURE_AGE_MS;
    if (!Number.isSafeInteger(maximumSignatureAgeMs) || maximumSignatureAgeMs < 60_000) {
      throw new RangeError('ClamAV maximum signature age is invalid');
    }
    this.#maximumSignatureAgeMs = maximumSignatureAgeMs;
    this.#now = options.now ?? (() => new Date());
    this.#socketPath = options.socketPath;
    this.#timeoutMs = options.timeoutMs;
  }

  public async ping(): Promise<void> {
    const socket = createConnection({ path: this.#socketPath });
    let timedOut = false;
    const pingTimeoutMs = Math.min(this.#timeoutMs, 2_000);
    const timeout = setTimeout(() => {
      timedOut = true;
      socket.destroy(new Error('ClamAV request timed out'));
    }, pingTimeoutMs);
    timeout.unref?.();
    try {
      await once(socket, 'connect');
      await write(socket, 'zVERSION\0');
      const chunks: Buffer[] = [];
      let responseBytes = 0;
      for await (const value of socket) {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        responseBytes += chunk.length;
        if (responseBytes > MAX_RESPONSE_BYTES) throw new ClamAvError('protocol');
        chunks.push(chunk);
        if (chunk.includes(0)) break;
      }
      const response = Buffer.concat(chunks).toString('utf8').split('\0', 1)[0]?.trim() ?? '';
      const version = /^[^/]+\/[1-9]\d*\/(.+)$/.exec(response);
      const signatureDate = version?.[1] === undefined ? Number.NaN : Date.parse(version[1]);
      const now = this.#now().getTime();
      if (
        Number.isNaN(now) ||
        Number.isNaN(signatureDate) ||
        signatureDate > now + MAXIMUM_CLOCK_SKEW_MS ||
        now - signatureDate > this.#maximumSignatureAgeMs
      ) {
        throw new ClamAvError('protocol');
      }
    } catch (error) {
      if (error instanceof ClamAvError) throw error;
      throw new ClamAvError(timedOut ? 'timeout' : 'unavailable', { cause: error });
    } finally {
      clearTimeout(timeout);
      socket.destroy();
    }
  }

  public async scan(path: string): Promise<ClamAvVerdict> {
    const socket = createConnection({ path: this.#socketPath });
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      socket.destroy(new Error('ClamAV request timed out'));
    }, this.#timeoutMs);
    timeout.unref?.();

    try {
      await once(socket, 'connect');
      await write(socket, 'zINSTREAM\0');
      const source = createReadStream(path, {
        flags: (constants.O_RDONLY | constants.O_NOFOLLOW) as unknown as string,
        highWaterMark: CLAMAV_CHUNK_BYTES,
      });
      try {
        for await (const value of source) {
          const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
          const length = Buffer.alloc(4);
          length.writeUInt32BE(chunk.length);
          await write(socket, length);
          await write(socket, chunk);
        }
      } finally {
        source.destroy();
      }
      await write(socket, Buffer.alloc(4));

      const chunks: Buffer[] = [];
      let responseBytes = 0;
      for await (const value of socket) {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        responseBytes += chunk.length;
        if (responseBytes > MAX_RESPONSE_BYTES) throw new ClamAvError('protocol');
        chunks.push(chunk);
        if (chunk.includes(0)) break;
      }
      const response = Buffer.concat(chunks).toString('utf8').split('\0', 1)[0]?.trim() ?? '';
      if (response === 'stream: OK') return { kind: 'clean' };
      const infected = /^stream: (.+) FOUND$/.exec(response);
      if (infected?.[1] !== undefined) {
        return { kind: 'infected', signature: safeSignature(infected[1]) };
      }
      throw new ClamAvError('protocol');
    } catch (error) {
      if (error instanceof ClamAvError) throw error;
      throw new ClamAvError(timedOut ? 'timeout' : 'unavailable', { cause: error });
    } finally {
      clearTimeout(timeout);
      socket.destroy();
    }
  }
}
