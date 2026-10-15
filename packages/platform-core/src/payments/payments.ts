import type { PaystackClient } from "./paystack.js";
import { InMemoryPaymentIntentRegistry, type BankTransferProviderClient, type PaymentIntentRegistry, type PaymentMethod, type PaymentProviderStatus } from "./provider.js";

/**
 * The platform Payments module (ADR 0099 rule 2, PRD target design). One deep module owns card checkout,
 * transfer-account issuance, server-side verification and the signed webhook. A host constructs it once and
 * passes it to packs; a domain reacts to the outcomes and keeps its own ledger, windows and reservations.
 * No provider name, endpoint, secret or signature rule is exposed here.
 */

export interface PaymentIntent {
  /** The pack the payment belongs to, so the outcome routes back to it (ADR 0099 rule 2). */
  readonly domainId: string;
  readonly reference: string;
  readonly method: PaymentMethod;
  readonly email: string;
  readonly amountKobo: number;
  readonly currency: "NGN";
  readonly payerId?: string;
  /** The transfer account's deadline; the Payment Window deadline (ADR 0044). */
  readonly expiresAt?: string;
  /** Overrides the configured payer-metadata key for this intent (ADR 0013, 0099 rule 4). */
  readonly payerMetadataKey?: string;
}

export interface CardPaymentStarted {
  readonly method: "card";
  readonly reference: string;
  readonly authorizationUrl: string;
  readonly environment: "test" | "live";
}

export interface TransferPaymentStarted {
  readonly method: "bank_transfer";
  readonly reference: string;
  readonly bankName: string;
  readonly accountNumber: string;
  readonly expiresAt: string;
}

export type PaymentStartResult = CardPaymentStarted | TransferPaymentStarted;

export interface PaymentOutcome {
  readonly domainId?: string;
  readonly reference: string;
  readonly method: PaymentMethod;
  readonly verified: boolean;
  /** The raw provider state, so a domain can apply its own Payment Window and grace rules (ADR 0044). */
  readonly status: PaymentProviderStatus;
  readonly amountKobo: number;
  readonly currency: string;
  readonly providerReference: string;
  readonly payerId?: string;
  readonly environment?: "test" | "live";
  readonly cardMetadata?: { readonly brand: string; readonly last4: string };
  readonly processingStartedAt?: string;
  readonly failureReason?: string;
}

export interface PaymentWebhookRequest {
  readonly rawBody: Buffer | string;
  readonly signature: string | undefined;
}

export type PaymentWebhookOutcome =
  | { readonly kind: "invalid-signature" }
  | { readonly kind: "invalid" }
  | { readonly kind: "ignored" }
  | { readonly kind: "charge"; readonly reference: string; readonly domainId?: string; readonly method?: PaymentMethod };

export interface Payments {
  /**
   * The provider-neutral transfer port a domain composes for its transfer lifecycle (ADR 0047/0088). It records
   * the intent so a later verification carries the domain id (ADR 0099 rule 2). Absent when transfers are not certified.
   */
  readonly transfers?: BankTransferProviderClient;
  /** Begin a payment for an intent: a hosted card checkout or a provider-issued transfer account. */
  start(intent: PaymentIntent): Promise<PaymentStartResult>;
  /** Server-side verification of a card reference (a callback or webhook is only a prompt; ADR 0087). */
  confirm(reference: string): Promise<PaymentOutcome>;
  /** Server-side verification of a transfer reference (ADR 0047). */
  verifyTransfer(reference: string): Promise<PaymentOutcome>;
  /** Validate the raw signed provider event and resolve the reference it names. */
  handleWebhook(request: PaymentWebhookRequest): Promise<PaymentWebhookOutcome>;
}

export interface PaystackPaymentsOptions {
  readonly card: PaystackClient;
  /** Absent when the provider's Pay with Transfer is not certified for this deployment (ADR 0088 activation). */
  readonly transfers?: BankTransferProviderClient;
  /** Shared with the host so both card and transfer outcomes carry their domain id. */
  readonly registry?: PaymentIntentRegistry;
}

function callbackUrlFor(configuration: { readonly callbackBaseUrl: string }): string {
  return new URL("/payments/paystack/callback", `${configuration.callbackBaseUrl}/`).toString();
}

/** The Paystack implementation of the platform Payments module. It never logs or exposes the server secret. */
export class PaystackPayments implements Payments {
  readonly #card: PaystackClient;
  readonly #transfers?: BankTransferProviderClient;
  readonly #registry: PaymentIntentRegistry;

  constructor(options: PaystackPaymentsOptions) {
    this.#card = options.card;
    this.#transfers = options.transfers;
    this.#registry = options.registry ?? new InMemoryPaymentIntentRegistry();
  }

  /**
   * The provider-neutral transfer port a domain composes for its own transfer lifecycle (ADR 0047/0088).
   * Absent when Pay with Transfer is not certified for this deployment.
   */
  get transfers(): BankTransferProviderClient | undefined {
    return this.#transfers;
  }

  async start(intent: PaymentIntent): Promise<PaymentStartResult> {
    this.#registry.record(intent.reference, { domainId: intent.domainId, method: intent.method });
    if (intent.method === "card") {
      const initialized = await this.#card.initializeTransaction({
        email: intent.email,
        amountKobo: intent.amountKobo,
        currency: intent.currency,
        reference: intent.reference,
        callbackUrl: callbackUrlFor(this.#card.configuration),
        ...(intent.payerId === undefined ? {} : { payerId: intent.payerId }),
        ...(intent.payerMetadataKey === undefined ? {} : { payerMetadataKey: intent.payerMetadataKey }),
      });
      return Object.freeze({ method: "card" as const, reference: initialized.reference, authorizationUrl: initialized.authorizationUrl, environment: initialized.environment });
    }
    const transfers = this.transfers;
    if (!transfers) throw new Error("Bank transfer is not configured for this deployment");
    if (!intent.expiresAt) throw new Error("A bank transfer payment intent requires an expiry");
    const account = await transfers.createTransferAccount({
      reference: intent.reference,
      amountKobo: intent.amountKobo,
      currency: intent.currency,
      expiresAt: intent.expiresAt,
      email: intent.email,
      ...(intent.payerId === undefined ? {} : { payerId: intent.payerId }),
    });
    return Object.freeze({ method: "bank_transfer" as const, reference: account.reference, bankName: account.bankName, accountNumber: account.accountNumber, expiresAt: account.expiresAt });
  }

  async confirm(reference: string): Promise<PaymentOutcome> {
    const result = await this.#card.verifyTransaction(reference);
    const record = this.#registry.find(reference);
    return Object.freeze({
      ...(record === undefined ? {} : { domainId: record.domainId }),
      reference,
      method: "card" as const,
      verified: result.verified,
      status: result.status,
      amountKobo: result.amountKobo,
      currency: result.currency,
      providerReference: result.pspReference,
      ...(result.payerId === undefined ? {} : { payerId: result.payerId }),
      ...(result.environment === undefined ? {} : { environment: result.environment }),
      ...(result.cardMetadata === undefined ? {} : { cardMetadata: result.cardMetadata }),
      ...(result.failureReason === undefined ? {} : { failureReason: result.failureReason }),
    });
  }

  async verifyTransfer(reference: string): Promise<PaymentOutcome> {
    const transfers = this.transfers;
    if (!transfers) throw new Error("Bank transfer is not configured for this deployment");
    const result = transfers.verifyTransferAsync ? await transfers.verifyTransferAsync(reference) : transfers.verifyTransfer(reference);
    const record = this.#registry.find(reference);
    return Object.freeze({
      ...(record === undefined ? {} : { domainId: record.domainId }),
      reference,
      method: "bank_transfer" as const,
      verified: result.verified,
      status: result.status,
      amountKobo: result.amountKobo,
      currency: result.currency,
      providerReference: result.pspReference,
      ...(result.payerId === undefined ? {} : { payerId: result.payerId }),
      ...(result.processingStartedAt === undefined ? {} : { processingStartedAt: result.processingStartedAt }),
      ...(result.failureReason === undefined ? {} : { failureReason: result.failureReason }),
    });
  }

  async handleWebhook(request: PaymentWebhookRequest): Promise<PaymentWebhookOutcome> {
    // ADR 0087: validate the raw signed body before parsing event meaning.
    if (!this.#card.verifyWebhookSignature(request.rawBody, request.signature)) return { kind: "invalid-signature" };
    let parsed: unknown;
    try {
      parsed = JSON.parse(typeof request.rawBody === "string" ? request.rawBody : request.rawBody.toString("utf8"));
    } catch {
      return { kind: "invalid" };
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { kind: "invalid" };
    const event = parsed as { event?: unknown; data?: unknown };
    if (event.event !== "charge.success") return { kind: "ignored" };
    const data = event.data !== null && typeof event.data === "object" && !Array.isArray(event.data) ? (event.data as { reference?: unknown }) : undefined;
    if (typeof data?.reference !== "string" || data.reference === "") return { kind: "invalid" };
    const record = this.#registry.find(data.reference);
    return { kind: "charge", reference: data.reference, ...(record === undefined ? {} : { domainId: record.domainId, method: record.method }) };
  }
}
