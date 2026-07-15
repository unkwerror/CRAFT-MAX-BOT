import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { MaxProofError, validateMaxInitData, verifyMaxContact } from './max-auth.js';

const BOT_TOKEN = 'stage-3-test-bot-token-with-enough-entropy';
const NOW = new Date('2026-07-15T10:00:00.000Z');
const AUTH_DATE = String(Math.floor(NOW.getTime() / 1_000) - 60);
const USER_ID = '67890';

function signInitData(values: readonly (readonly [string, string])[]): string {
  const canonical = values
    .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const hash = createHmac('sha256', secret).update(canonical).digest('hex');
  return [...values, ['hash', hash] as const]
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
}

function validInitData(overrides: Partial<Record<string, string>> = {}): string {
  const values = {
    auth_date: AUTH_DATE,
    query_id: '4c0ab423-342b-4e45-aea4-2747dbc500cd',
    start_param: 'new_project',
    user: JSON.stringify({
      id: Number(USER_ID),
      first_name: 'Max',
      last_name: 'User',
      username: null,
      language_code: 'ru',
      photo_url: null,
    }),
    ...overrides,
  };
  return signInitData(Object.entries(values));
}

const options = {
  botToken: BOT_TOKEN,
  maxAgeSeconds: 3_600,
  now: () => NOW,
} as const;

describe('validateMaxInitData', () => {
  it('validates and maps signed MAX launch data', () => {
    expect(validateMaxInitData(validInitData(), options)).toEqual({
      authDate: new Date(Number(AUTH_DATE) * 1_000),
      queryId: '4c0ab423-342b-4e45-aea4-2747dbc500cd',
      startParam: 'new_project',
      user: {
        id: USER_ID,
        firstName: 'Max',
        lastName: 'User',
        username: null,
        languageCode: 'ru',
        photoUrl: null,
      },
    });
  });

  it('rejects tampering and duplicate keys', () => {
    expect(() => validateMaxInitData(validInitData().replace('Max', 'Mallory'), options)).toThrow(
      MaxProofError,
    );
    const duplicate = `${validInitData()}&auth_date=${AUTH_DATE}`;
    expect(() => validateMaxInitData(duplicate, options)).toThrow(/duplicate/i);
  });

  it('rejects malformed encoding and malformed user JSON', () => {
    expect(() => validateMaxInitData('auth_date=%GG&hash=a', options)).toThrow(/encoding/i);
    expect(() => validateMaxInitData(validInitData({ user: '{broken' }), options)).toThrow(/JSON/i);
  });

  it('distinguishes expired launch data from an invalid future timestamp', () => {
    try {
      validateMaxInitData(validInitData({ auth_date: String(Number(AUTH_DATE) - 3_601) }), options);
    } catch (error) {
      expect(error).toMatchObject({ code: 'expired' });
    }

    expect(() =>
      validateMaxInitData(
        validInitData({ auth_date: String(Math.floor(NOW.getTime() / 1_000) + 61) }),
        options,
      ),
    ).toThrow(/future/i);
  });

  it('ignores a signed but unsupported start parameter', () => {
    expect(validateMaxInitData(validInitData({ start_param: 'admin' }), options).startParam).toBe(
      null,
    );
  });
});

describe('verifyMaxContact', () => {
  function contactHash(authDate: string, phone: string, userId = USER_ID): string {
    const digits = phone.replace(/^\+/, '');
    return createHmac('sha256', BOT_TOKEN)
      .update(`authDate=${authDate}\nphone=${digits}\nuserId=${userId}`)
      .digest('hex');
  }

  it('verifies the documented proof and normalizes the phone', () => {
    const phone = '+79991234567';
    expect(
      verifyMaxContact(
        { phone, authDate: AUTH_DATE, hash: contactHash(AUTH_DATE, phone) },
        USER_ID,
        { ...options, maxAgeSeconds: 300 },
      ),
    ).toEqual({ phone, verifiedAt: NOW });
  });

  it('rejects another user, a tampered phone and an expired proof', () => {
    const phone = '+79991234567';
    const hash = contactHash(AUTH_DATE, phone);
    expect(() => verifyMaxContact({ phone, authDate: AUTH_DATE, hash }, '67891', options)).toThrow(
      /signature/i,
    );
    expect(() =>
      verifyMaxContact({ phone: '+79990000000', authDate: AUTH_DATE, hash }, USER_ID, options),
    ).toThrow(/signature/i);
    expect(() =>
      verifyMaxContact(
        {
          phone,
          authDate: String(Number(AUTH_DATE) - 3_601),
          hash: contactHash(String(Number(AUTH_DATE) - 3_601), phone),
        },
        USER_ID,
        options,
      ),
    ).toThrow(/expired/i);
  });
});
