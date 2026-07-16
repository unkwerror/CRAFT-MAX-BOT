export interface RetryPolicy {
  readonly baseDelayMs: number;
  readonly maximumDelayMs: number;
  readonly random?: () => number;
}

function checkedInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be positive`);
  return value;
}

export function retryDelayMilliseconds(
  attempts: number,
  policy: RetryPolicy,
  retryAfterMs: number | null = null,
): number {
  checkedInteger(attempts, 'Attempts');
  const baseDelay = checkedInteger(policy.baseDelayMs, 'Retry base delay');
  const maximumDelay = checkedInteger(policy.maximumDelayMs, 'Retry maximum delay');
  if (maximumDelay < baseDelay) throw new RangeError('Retry maximum delay is below base delay');

  const random = policy.random?.() ?? Math.random();
  if (!Number.isFinite(random) || random < 0 || random > 1) {
    throw new RangeError('Retry random source returned an invalid value');
  }

  const exponential = Math.min(maximumDelay, baseDelay * 2 ** Math.min(attempts - 1, 30));
  const jittered = Math.max(1, Math.round(exponential * (0.8 + random * 0.4)));
  return retryAfterMs === null ? jittered : Math.max(jittered, Math.max(0, retryAfterMs));
}

export function retryDate(
  now: Date,
  attempts: number,
  policy: RetryPolicy,
  retryAfterMs: number | null = null,
): Date {
  const value = new Date(now.getTime() + retryDelayMilliseconds(attempts, policy, retryAfterMs));
  if (Number.isNaN(value.getTime())) throw new RangeError('Retry date is invalid');
  return value;
}
