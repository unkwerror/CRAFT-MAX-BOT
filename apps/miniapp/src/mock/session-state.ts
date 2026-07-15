import {
  PhoneNumberSchema,
  VerifiedContactSnapshotSchema,
  type VerifiedContactSnapshot,
} from '@craft72/contracts/source';

export class MockSessionState {
  #verifiedContact: VerifiedContactSnapshot | null = null;

  public get verifiedContact(): VerifiedContactSnapshot | null {
    return this.#verifiedContact;
  }

  /** Simulates the result of MAX contact verification outside the submission payload. */
  public setVerifiedContact(value: VerifiedContactSnapshot): void {
    this.#verifiedContact = Object.freeze(VerifiedContactSnapshotSchema.parse(value));
  }

  public isPhoneVerified(phoneInput: string): boolean {
    const phone = PhoneNumberSchema.parse(phoneInput);
    return this.#verifiedContact?.phone === phone;
  }

  public reset(): void {
    this.#verifiedContact = null;
  }
}
