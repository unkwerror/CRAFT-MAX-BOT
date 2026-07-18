import { createHash, scrypt, timingSafeEqual } from 'node:crypto';

const ENCODED_HASH_PATTERN = /^scrypt-v1\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/;
const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_OPTIONS = {
  N: 32_768,
  maxmem: 64 * 1_024 * 1_024,
  p: 1,
  r: 8,
} as const;

interface ParsedAdminPasswordHash {
  readonly expected: Buffer;
  readonly salt: Buffer;
}

function parseEncodedHash(encodedHash: string): ParsedAdminPasswordHash {
  const match = ENCODED_HASH_PATTERN.exec(encodedHash);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new TypeError('Admin password hash has an invalid format');
  }
  const salt = Buffer.from(match[1], 'base64url');
  const expected = Buffer.from(match[2], 'base64url');
  if (salt.length !== 16 || expected.length !== SCRYPT_KEY_LENGTH) {
    throw new TypeError('Admin password hash has an invalid format');
  }
  return { expected, salt };
}

function derivePassword(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEY_LENGTH, SCRYPT_OPTIONS, (error, derivedKey) => {
      if (error !== null) {
        reject(error);
        return;
      }
      resolve(derivedKey);
    });
  });
}

export class AdminPasswordVerifier {
  readonly #expected: Buffer;
  readonly #salt: Buffer;
  readonly #sessionTokenHashKey: Buffer;

  public constructor(encodedHash: string) {
    const parsed = parseEncodedHash(encodedHash);
    this.#expected = parsed.expected;
    this.#salt = parsed.salt;
    this.#sessionTokenHashKey = createHash('sha256')
      .update('craft72-admin-session-v1\0')
      .update(encodedHash)
      .digest();
  }

  public get sessionTokenHashKey(): Buffer {
    return Buffer.from(this.#sessionTokenHashKey);
  }

  public async verify(password: string): Promise<boolean> {
    const derived = await derivePassword(password, this.#salt);
    return timingSafeEqual(this.#expected, derived);
  }
}
