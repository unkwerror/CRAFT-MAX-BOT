function hash32(value: string, seed: number): number {
  let hash = seed >>> 0;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
    hash ^= hash >>> 13;
  }

  return hash >>> 0;
}

function hashHex(value: string, seed: number): string {
  return hash32(value, seed).toString(16).padStart(8, '0');
}

/** Deterministic IDs for mocks and fixtures only; this is not a cryptographic hash. */
export function stableMockToken(value: string): string {
  return [
    hashHex(value, 2_166_136_261),
    hashHex(value, 2_654_435_761),
    hashHex(value, 1_013_904_223),
    hashHex(value, 3_747_613_931),
  ].join('');
}

export function stableMockUuid(namespace: string, value: string): string {
  const hex = stableMockToken(`${namespace}:${value}`);
  const versioned = `${hex.slice(0, 12)}4${hex.slice(13, 16)}8${hex.slice(17)}`;

  return `${versioned.slice(0, 8)}-${versioned.slice(8, 12)}-${versioned.slice(12, 16)}-${versioned.slice(16, 20)}-${versioned.slice(20)}`;
}

export function stableSubmissionId(idempotencyKey: string): string {
  return `CRAFT72-MOCK-${stableMockToken(idempotencyKey).slice(0, 24).toUpperCase()}`;
}
