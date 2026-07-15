import type { ApiErrorCode } from '@craft72/contracts/source';

export class MockApiError extends Error {
  public readonly code: ApiErrorCode;

  public constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'MockApiError';
    this.code = code;
  }
}
