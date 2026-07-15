import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  MaxContactVerifyRequestSchema,
  MaxUserIdSchema,
  MaxUserSchema,
  StartParamSchema,
  type MaxContactVerifyRequest,
  type MaxUser,
  type StartParam,
} from '@craft72/contracts';
import { z } from 'zod';

const HASH_PATTERN = /^[a-f0-9]{64}$/i;
const PARAMETER_NAME_PATTERN = /^[A-Za-z0-9_]+$/;
const DEFAULT_FUTURE_SKEW_SECONDS = 60;

const SignedMaxUserSchema = z.object({
  id: z.union([z.string(), z.number().int().positive().safe()]),
  first_name: z.string().trim().min(1).max(128),
  last_name: z.string().trim().min(1).max(128).nullable().optional(),
  username: z.string().trim().min(1).max(64).nullable().optional(),
  language_code: z.string().trim().min(2).max(35).nullable().optional(),
  photo_url: z.string().trim().url().startsWith('https://').nullable().optional(),
});

export type MaxProofErrorCode = 'expired' | 'invalid';

export class MaxProofError extends Error {
  public readonly code: MaxProofErrorCode;

  public constructor(code: MaxProofErrorCode, message: string) {
    super(message);
    this.name = 'MaxProofError';
    this.code = code;
  }
}

export interface MaxProofOptions {
  readonly botToken: string;
  readonly maxAgeSeconds: number;
  readonly now?: () => Date;
  readonly futureSkewSeconds?: number;
}

export interface ValidatedMaxInitData {
  readonly authDate: Date;
  readonly queryId: string | null;
  readonly startParam: StartParam | null;
  readonly user: MaxUser;
}

export interface VerifiedMaxContact {
  readonly phone: string;
  readonly verifiedAt: Date;
}

interface ParsedParameter {
  readonly key: string;
  readonly value: string;
}

function invalid(message: string): MaxProofError {
  return new MaxProofError('invalid', message);
}

function decodeFormComponent(value: string): string {
  try {
    return decodeURIComponent(value.replaceAll('+', ' '));
  } catch {
    throw invalid('MAX proof contains malformed URL encoding');
  }
}

function parseUniqueParameters(input: string): ParsedParameter[] {
  if (input.length === 0 || input.length > 16_384 || input.includes('\0')) {
    throw invalid('MAX proof has an invalid length');
  }

  const seen = new Set<string>();
  const parameters = input.split('&').map((part): ParsedParameter => {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex <= 0) {
      throw invalid('MAX proof contains a malformed parameter');
    }

    const key = decodeFormComponent(part.slice(0, separatorIndex));
    const value = decodeFormComponent(part.slice(separatorIndex + 1));
    if (!PARAMETER_NAME_PATTERN.test(key) || seen.has(key)) {
      throw invalid('MAX proof contains a duplicate or invalid parameter');
    }

    seen.add(key);
    return { key, value };
  });

  if (parameters.length === 0) {
    throw invalid('MAX proof contains no parameters');
  }

  return parameters;
}

function getRequiredParameter(parameters: readonly ParsedParameter[], key: string): string {
  const parameter = parameters.find((candidate) => candidate.key === key);
  if (parameter === undefined || parameter.value.length === 0) {
    throw invalid(`MAX proof is missing ${key}`);
  }

  return parameter.value;
}

function validClock(options: MaxProofOptions): Date {
  if (options.botToken.length < 16) {
    throw new RangeError('MAX bot token is too short');
  }
  if (!Number.isSafeInteger(options.maxAgeSeconds) || options.maxAgeSeconds <= 0) {
    throw new RangeError('MAX proof max age must be a positive integer');
  }

  const now = (options.now ?? (() => new Date()))();
  if (Number.isNaN(now.getTime())) {
    throw new RangeError('MAX proof clock returned an invalid date');
  }

  return now;
}

function validateProofTimestamp(
  timestampMilliseconds: number,
  options: MaxProofOptions,
  now: Date,
): Date {
  if (!Number.isSafeInteger(timestampMilliseconds) || timestampMilliseconds <= 0) {
    throw invalid('MAX proof timestamp is invalid');
  }

  const futureSkewSeconds = options.futureSkewSeconds ?? DEFAULT_FUTURE_SKEW_SECONDS;
  if (!Number.isSafeInteger(futureSkewSeconds) || futureSkewSeconds < 0) {
    throw new RangeError('MAX future clock skew must be a non-negative integer');
  }

  const ageMilliseconds = now.getTime() - timestampMilliseconds;
  if (ageMilliseconds < -futureSkewSeconds * 1_000) {
    throw invalid('MAX proof timestamp is in the future');
  }
  if (ageMilliseconds > options.maxAgeSeconds * 1_000) {
    throw new MaxProofError('expired', 'MAX proof has expired');
  }

  return new Date(timestampMilliseconds);
}

function compareHexDigest(expected: Buffer, received: string): boolean {
  if (!HASH_PATTERN.test(received)) {
    return false;
  }

  const receivedBytes = Buffer.from(received, 'hex');
  return receivedBytes.length === expected.length && timingSafeEqual(expected, receivedBytes);
}

function parseMaxUser(value: string): MaxUser {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(value) as unknown;
  } catch {
    throw invalid('MAX user payload is not valid JSON');
  }

  const result = SignedMaxUserSchema.safeParse(parsedJson);
  if (!result.success) {
    throw invalid('MAX user payload is invalid');
  }

  const id = String(result.data.id);
  if (!MaxUserIdSchema.safeParse(id).success) {
    throw invalid('MAX user identifier is invalid');
  }

  const user = MaxUserSchema.safeParse({
    id,
    firstName: result.data.first_name,
    lastName: result.data.last_name ?? null,
    username: result.data.username ?? null,
    languageCode: result.data.language_code ?? null,
    photoUrl: result.data.photo_url ?? null,
  });
  if (!user.success) {
    throw invalid('MAX user payload is invalid');
  }

  return user.data;
}

export function validateMaxInitData(
  initData: string,
  options: MaxProofOptions,
): ValidatedMaxInitData {
  const now = validClock(options);
  const parameters = parseUniqueParameters(initData);
  const receivedHash = getRequiredParameter(parameters, 'hash');
  const canonical = parameters
    .filter(({ key }) => key !== 'hash')
    .toSorted((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0))
    .map(({ key, value }) => `${key}=${value}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(options.botToken).digest();
  const expectedHash = createHmac('sha256', secretKey).update(canonical).digest();
  if (!compareHexDigest(expectedHash, receivedHash)) {
    throw invalid('MAX initData signature is invalid');
  }

  const authDateValue = getRequiredParameter(parameters, 'auth_date');
  if (!/^\d{1,13}$/.test(authDateValue)) {
    throw invalid('MAX initData auth_date is invalid');
  }
  const authDate = validateProofTimestamp(Number(authDateValue) * 1_000, options, now);
  const user = parseMaxUser(getRequiredParameter(parameters, 'user'));
  const startParamValue = parameters.find(({ key }) => key === 'start_param')?.value;
  const startParamResult =
    startParamValue === undefined ? undefined : StartParamSchema.safeParse(startParamValue);

  return {
    authDate,
    queryId: parameters.find(({ key }) => key === 'query_id')?.value ?? null,
    startParam: startParamResult?.success === true ? startParamResult.data : null,
    user,
  };
}

function contactTimestampMilliseconds(value: string): number {
  if (!/^\d{10,13}$/.test(value)) {
    throw invalid('MAX contact authDate is invalid');
  }

  const timestamp = Number(value);
  return value.length >= 13 ? timestamp : timestamp * 1_000;
}

export function verifyMaxContact(
  input: MaxContactVerifyRequest,
  maxUserId: string,
  options: MaxProofOptions,
): VerifiedMaxContact {
  const request = MaxContactVerifyRequestSchema.parse(input);
  const userId = MaxUserIdSchema.parse(maxUserId);
  const now = validClock(options);
  validateProofTimestamp(contactTimestampMilliseconds(request.authDate), options, now);
  const phoneDigits = request.phone.startsWith('+') ? request.phone.slice(1) : request.phone;
  const canonical = `authDate=${request.authDate}\nphone=${phoneDigits}\nuserId=${userId}`;
  const expectedHash = createHmac('sha256', options.botToken).update(canonical).digest();
  if (!compareHexDigest(expectedHash, request.hash)) {
    throw invalid('MAX contact signature is invalid');
  }

  return {
    phone: `+${phoneDigits}`,
    verifiedAt: now,
  };
}
