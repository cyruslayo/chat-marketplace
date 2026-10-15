/**
 * Provider-neutral payment contracts (ADR 0087/0088/0090). The platform owns these; a domain pack
 * depends on them and reacts to outcomes. No provider name, endpoint, key or signature rule appears here.
 */

export type PaymentMethod = "card" | "bank_transfer";

/** The normalized provider transaction state (ADR 0087 mapping). Unknown provider states fail closed. */
export type PaymentProviderStatus =
  | "success"
  | "abandoned"
  | "failed"
  | "ongoing"
  | "pending"
  | "processing"
  | "reversed"
  | "queued"
  | "unknown";

/** The result of server-side verification of one provider reference. */
export interface PSPVerifyResult {
  readonly verified: boolean;
  readonly status: PaymentProviderStatus;
  readonly amountKobo: number;
  readonly currency: string;
  readonly pspReference: string;
  readonly payerId?: string;
  readonly environment?: "test" | "live";
  readonly cardMetadata?: { readonly brand: string; readonly last4: string };
  readonly failureReason?: string;
  /** The domain the intent belongs to, so the outcome routes to the right pack (ADR 0099 rule 2). */
  readonly domainId?: string;
}

/** Test fixtures may alias the provider response type, but production commands cannot carry it. */
export type MockPSPVerifyResult = PSPVerifyResult;

/** What the platform asks a transfer provider for: one expiring account bound to this booking's reference and exact amount (ADR 0047). */
export interface BankTransferAccountRequest {
  readonly reference: string;
  readonly amountKobo: number;
  readonly currency: "NGN";
  /** The Payment Window deadline; the account must stop being payable by then (ADR 0044, 0047). */
  readonly expiresAt: string;
  readonly email: string;
  /** The authoritative payer, bound in provider metadata so verification can attribute the sender (ADR 0013). */
  readonly payerId?: string;
}

/** The provider-issued account. The platform never derives account details itself (ADR 0047). */
export interface ProviderTransferAccount {
  readonly bankName: string;
  readonly accountNumber: string;
  readonly reference: string;
  /** The provider's own expiry for the account; never later than the Payment Window deadline. */
  readonly expiresAt: string;
}

export interface BankTransferProviderResult {
  readonly verified: boolean;
  readonly status: "success" | "pending" | "failed";
  readonly amountKobo: number;
  readonly currency: string;
  readonly pspReference: string;
  readonly payerId?: string;
  /** Provider evidence that the designated transaction was in flight before the deadline. */
  readonly processingStartedAt?: string;
  readonly failureReason?: string;
}

/** Retained as a test-fixture compatibility name; production commands cannot carry it. */
export type MockBankTransferVerifyResult = BankTransferProviderResult;

export interface BankTransferProviderClient {
  createTransferAccount(
    request: BankTransferAccountRequest,
  ): Promise<ProviderTransferAccount>;
  verifyTransfer(transferReference: string): BankTransferProviderResult;
  /** Providers that verify over the network (Paystack) implement this; the server awaits it before processing. */
  verifyTransferAsync?(
    transferReference: string,
  ): Promise<BankTransferProviderResult>;
}

/** Records which domain and method a payment reference belongs to, so an outcome can be routed (ADR 0099 rule 2). */
export interface PaymentIntentRecord {
  readonly domainId: string;
  readonly method: PaymentMethod;
}

export interface PaymentIntentRegistry {
  record(reference: string, record: PaymentIntentRecord): void;
  find(reference: string): PaymentIntentRecord | undefined;
}

export class InMemoryPaymentIntentRegistry implements PaymentIntentRegistry {
  readonly #records = new Map<string, PaymentIntentRecord>();

  record(reference: string, record: PaymentIntentRecord): void {
    this.#records.set(reference, Object.freeze({ ...record }));
  }

  find(reference: string): PaymentIntentRecord | undefined {
    const record = this.#records.get(reference);
    return record === undefined ? undefined : { ...record };
  }
}
