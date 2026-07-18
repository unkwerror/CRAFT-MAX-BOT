import { describe, expect, it } from 'vitest';

import { AdminPasswordVerifier } from './admin-password.js';

const HASH = 'scrypt-v1$MDEyMzQ1Njc4OWFiY2RlZg$9rcVF-DZ8uU77qz3H_v29-n2g8c877AOCRXSQvC_fs0';
const ROTATED_HASH = 'scrypt-v1$ZmVkY2JhOTg3NjU0MzIxMA$EjS8tqktedJWp1XzA3g408odCLaDzrMASFfOLiIRB3I';

describe('AdminPasswordVerifier', () => {
  it('verifies the configured scrypt hash without exposing the password', async () => {
    const verifier = new AdminPasswordVerifier(HASH);

    await expect(verifier.verify('correct horse battery staple')).resolves.toBe(true);
    await expect(verifier.verify('wrong password')).resolves.toBe(false);
  });

  it('fails closed for malformed encoded hashes', () => {
    for (const hash of ['', 'plaintext-password', 'scrypt-v1$short$short']) {
      expect(() => new AdminPasswordVerifier(hash)).toThrow(TypeError);
    }
  });

  it('derives stable isolated copies of the session token hash key', () => {
    const verifier = new AdminPasswordVerifier(HASH);
    const first = verifier.sessionTokenHashKey;
    const second = verifier.sessionTokenHashKey;

    expect(first).toEqual(second);
    expect(first).toHaveLength(32);
    first.fill(0);
    expect(verifier.sessionTokenHashKey).toEqual(second);
    expect(new AdminPasswordVerifier(ROTATED_HASH).sessionTokenHashKey).not.toEqual(second);
  });
});
