import { createHmac, timingSafeEqual } from "node:crypto";
import type { PSPVerifyResult } from "./provider.js";
import type { BankTransferAccountRequest, BankTransferProviderClient, BankTransferProviderResult, ProviderTransferAccount } from "./provider.js";

export type PaystackEnvironment = "test" | "live";

/**
 * The provider metadata key carrying the authoritative payer id (ADR 0013). Configurable so the platform
 * adapter stays domain-neutral (ADR 0099 rule 4); the legacy value is the default for existing deployments.
 */
export const DEFAULT_PAYER_METADATA_KEY = "shortlet_guest_id";

export interface PaystackConfiguration {
  readonly secretKey: string;
  readonly environment: PaystackEnvironment;
  readonly callbackBaseUrl: string;
  readonly payerMetadataKey?: string;
}

export type PaystackPublicConfiguration = Omit<PaystackConfiguration, "secretKey">;

export interface PaystackEnvironmentSource {
  readonly PAYSTACK_SECRET_KEY?: string;
  readonly PAYSTACK_ENVIRONMENT?: string;
  readonly PAYSTACK_CALLBACK_BASE_URL?: string;
  readonly PAYSTACK_PAYER_METADATA_KEY?: string;
  readonly NODE_ENV?: string;
}

/**
 * A Paystack call failure with a closed reason and a fixed message. The message never carries provider text, a URL, a
 * reference or a key (ADR 0075). The chat checkout maps the reason to its diagnostic code.
 */
export type PaystackProviderFailureReason = "provider_rejected" | "provider_unreachable" | "provider_response_invalid" | "checkout_url_rejected" | "reference_conflict";

export class PaystackProviderFailure extends Error {
  readonly reason: PaystackProviderFailureReason;

  constructor(reason: PaystackProviderFailureReason, message: string) {
    super(message);
    this.name = "PaystackProviderFailure";
    this.reason = reason;
  }
}

export class PaystackConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaystackConfigurationError";
  }
}

/**
 * Loads only the pilot configuration values. Production cannot use the
 * deterministic local PSP or an absent/invalid secret.
 */
export function loadPaystackConfiguration(
  source: PaystackEnvironmentSource = process.env,
  options: { readonly runtime?: "production" | "test" } = {},
): PaystackConfiguration | undefined {
  const runtime = options.runtime ?? (source.NODE_ENV === "production" ? "production" : "test");
  const secretKey = source.PAYSTACK_SECRET_KEY?.trim() ?? "";
  const environment = source.PAYSTACK_ENVIRONMENT?.trim() ?? "";
  const callbackBaseUrl = source.PAYSTACK_CALLBACK_BASE_URL?.trim() ?? "";
  const payerMetadataKey = source.PAYSTACK_PAYER_METADATA_KEY?.trim();

  if (runtime === "test" && secretKey === "" && environment === "" && callbackBaseUrl === "") return undefined;
  if (secretKey === "") throw new PaystackConfigurationError("PAYSTACK_SECRET_KEY is required");
  if (environment !== "test" && environment !== "live") throw new PaystackConfigurationError("PAYSTACK_ENVIRONMENT must be test or live");
  if (callbackBaseUrl === "") throw new PaystackConfigurationError("PAYSTACK_CALLBACK_BASE_URL is required");

  let parsedCallback: URL;
  try {
    parsedCallback = new URL(callbackBaseUrl);
  } catch {
    throw new PaystackConfigurationError("PAYSTACK_CALLBACK_BASE_URL must be an absolute URL");
  }
  if (parsedCallback.username || parsedCallback.password || parsedCallback.search || parsedCallback.hash) {
    throw new PaystackConfigurationError("PAYSTACK_CALLBACK_BASE_URL must not contain credentials, query, or fragment data");
  }
  if (runtime === "production" && (environment !== "live" || parsedCallback.protocol !== "https:")) {
    throw new PaystackConfigurationError("Production Paystack configuration requires live environment and an HTTPS callback base URL");
  }

  return Object.freeze({ secretKey, environment, callbackBaseUrl: parsedCallback.origin, ...(payerMetadataKey === undefined || payerMetadataKey === "" ? {} : { payerMetadataKey }) });
}

export function paystackCallbackUrl(configuration: PaystackConfiguration): string {
  return new URL("/payments/paystack/callback", `${configuration.callbackBaseUrl}/`).toString();
}

const PAYSTACK_API_URL = "https://api.paystack.co";
const APPROVED_CHECKOUT_HOSTS = new Set(["checkout.paystack.com"]);

export function isApprovedPaystackCheckoutUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && APPROVED_CHECKOUT_HOSTS.has(url.hostname) && url.username === "" && url.password === "" && url.hash === "";
  } catch {
    return false;
  }
}

export interface PaystackHttpResponse {
  readonly status: number;
  json(): Promise<unknown>;
}

export type PaystackHttpFetcher = (url: string, init: { readonly method: "GET" | "POST"; readonly headers: Record<string, string>; readonly body?: string }) => Promise<PaystackHttpResponse>;

function defaultFetcher(url: string, init: { readonly method: "GET" | "POST"; readonly headers: Record<string, string>; readonly body?: string }): Promise<PaystackHttpResponse> {
  return fetch(url, init);
}

interface PaystackEnvelope {
  readonly status?: unknown;
  readonly message?: unknown;
  readonly data?: unknown;
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function paystackEnvironment(value: unknown): PaystackEnvironment | undefined {
  return value === "test" || value === "live" ? value : undefined;
}

function paystackStatus(value: unknown): PSPVerifyResult["status"] {
  if (typeof value !== "string") return "unknown";
  if (["success", "abandoned", "failed", "ongoing", "pending", "processing", "reversed", "queued"].includes(value)) return value as PSPVerifyResult["status"];
  return "unknown";
}

function assertProviderResponse(response: PaystackHttpResponse, body: unknown, operation: string): PaystackEnvelope {
  const envelope = recordOf(body) as PaystackEnvelope | undefined;
  if (!envelope || envelope.status !== true || response.status < 200 || response.status >= 300) {
    throw new PaystackProviderFailure("provider_rejected", `Paystack ${operation} request failed`);
  }
  return envelope;
}

export interface PaystackInitializeInput {
  readonly email: string;
  readonly amountKobo: number;
  readonly currency: "NGN";
  readonly reference: string;
  readonly callbackUrl: string;
  readonly payerId?: string;
  /** Overrides the configured metadata key for the payer id (ADR 0013, 0099 rule 4). */
  readonly payerMetadataKey?: string;
}

export interface PaystackInitializeResult {
  readonly authorizationUrl: string;
  readonly reference: string;
  readonly environment: PaystackEnvironment;
}

export interface PaystackClient {
  readonly configuration: PaystackPublicConfiguration;
  initializeTransaction(input: PaystackInitializeInput): Promise<PaystackInitializeResult>;
  verifyTransaction(reference: string): Promise<PSPVerifyResult>;
  verifyWebhookSignature(rawBody: Buffer | string, signature: string | undefined): boolean;
}

/** Direct HTTPS Paystack adapter. It does not log or expose the server secret. */
export class DirectPaystackClient implements PaystackClient {
  readonly #configuration: PaystackConfiguration;
  readonly #fetcher: PaystackHttpFetcher;

  constructor(configuration: PaystackConfiguration, fetcher: PaystackHttpFetcher = defaultFetcher) {
    this.#configuration = configuration;
    this.#fetcher = fetcher;
  }

  get configuration(): PaystackPublicConfiguration {
    return { environment: this.#configuration.environment, callbackBaseUrl: this.#configuration.callbackBaseUrl };
  }

  #metadataKey(override: string | undefined): string {
    return override ?? this.#configuration.payerMetadataKey ?? DEFAULT_PAYER_METADATA_KEY;
  }

  async initializeTransaction(input: PaystackInitializeInput): Promise<PaystackInitializeResult> {
    if (!Number.isSafeInteger(input.amountKobo) || input.amountKobo < 0) throw new Error("Paystack amount must be a non-negative integer in kobo");
    const payload = {
      email: input.email,
      amount: input.amountKobo,
      currency: input.currency,
      reference: input.reference,
      callback_url: input.callbackUrl,
      channels: ["card"],
      ...(input.payerId === undefined ? {} : { metadata: JSON.stringify({ [this.#metadataKey(input.payerMetadataKey)]: input.payerId }) }),
    };
    let response: PaystackHttpResponse;
    try {
      response = await this.#fetcher(`${PAYSTACK_API_URL}/transaction/initialize`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.#configuration.secretKey}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      throw new PaystackProviderFailure("provider_unreachable", "Paystack initialization request could not be sent");
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new PaystackProviderFailure("provider_response_invalid", "Paystack initialization response was not JSON");
    }
    const envelope = assertProviderResponse(response, body, "initialization");
    const data = recordOf(envelope.data);
    const authorizationUrl = data?.authorization_url;
    const reference = data?.reference;
    if (typeof reference !== "string" || typeof authorizationUrl !== "string") {
      throw new PaystackProviderFailure("provider_response_invalid", "Paystack initialization returned an invalid checkout");
    }
    if (reference !== input.reference) throw new PaystackProviderFailure("reference_conflict", "Paystack initialization returned a different reference");
    if (!isApprovedPaystackCheckoutUrl(authorizationUrl)) throw new PaystackProviderFailure("checkout_url_rejected", "Paystack initialization returned an unapproved checkout URL");
    return Object.freeze({ authorizationUrl, reference, environment: this.configuration.environment });
  }

  async verifyTransaction(reference: string): Promise<PSPVerifyResult> {
    if (reference.trim() === "") throw new Error("Paystack reference is required");
    const response = await this.#fetcher(`${PAYSTACK_API_URL}/transaction/verify/${encodeURIComponent(reference)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.#configuration.secretKey}`, Accept: "application/json" },
    });
    const envelope = assertProviderResponse(response, await response.json(), "verification");
    const data = recordOf(envelope.data);
    const returnedReference = data?.reference;
    const amountKobo = data?.amount;
    const currency = data?.currency;
    const domain = paystackEnvironment(data?.domain);
    const metadata = typeof data?.metadata === "string" ? (() => { try { return JSON.parse(data.metadata) as unknown; } catch { return undefined; } })() : data?.metadata;
    const payerId = recordOf(metadata)?.[this.#metadataKey(undefined)];
    if (typeof returnedReference !== "string" || typeof amountKobo !== "number" || !Number.isSafeInteger(amountKobo) || typeof currency !== "string") throw new Error("Paystack verification returned an invalid transaction");
    return Object.freeze({
      verified: true,
      status: paystackStatus(data?.status),
      amountKobo,
      currency,
      pspReference: returnedReference,
      ...(typeof payerId === "string" && payerId !== "" ? { payerId } : {}),
      ...(domain === undefined ? {} : { environment: domain }),
      ...(recordOf(data?.card) && typeof recordOf(data?.card)?.brand === "string" && typeof recordOf(data?.card)?.last4 === "string" ? { cardMetadata: { brand: recordOf(data?.card)!.brand as string, last4: recordOf(data?.card)!.last4 as string } } : {}),
    });
  }

  verifyWebhookSignature(rawBody: Buffer | string, signature: string | undefined): boolean {
    if (!signature || !/^[0-9a-f]{128}$/i.test(signature)) return false;
    const expected = createHmac("sha512", this.#configuration.secretKey).update(rawBody).digest("hex");
    const provided = Buffer.from(signature, "hex");
    const actual = Buffer.from(expected, "hex");
    return provided.length === actual.length && timingSafeEqual(provided, actual);
  }
}

/** Paystack raises any Pay with Transfer expiry under 15 minutes to 15 (ADR 0088), so a shorter deadline cannot be honoured. */
export const PAYSTACK_TRANSFER_MINIMUM_EXPIRY_MINUTES = 15;

function transferStatus(status: PSPVerifyResult["status"]): BankTransferProviderResult["status"] {
  if (status === "success") return "success";
  if (status === "ongoing" || status === "pending" || status === "processing" || status === "queued") return "pending";
  return "failed";
}

/**
 * Paystack Pay with Transfer behind the provider-neutral transfer port (ADR 0088, P2): a Charge API `bank_transfer`
 * charge whose `account_expires_at` is the Payment Window deadline. Paystack verifies over HTTP, so verification is
 * `verifyTransferAsync`; the synchronous port method refuses. Never logs the key, account numbers or bodies (ADR 0075).
 */
export class PaystackBankTransferClient implements BankTransferProviderClient {
  readonly #configuration: PaystackConfiguration;
  readonly #fetcher: PaystackHttpFetcher;
  readonly #clock: () => Date;
  readonly #transactions: DirectPaystackClient;

  constructor(configuration: PaystackConfiguration, options: { readonly fetcher?: PaystackHttpFetcher; readonly clock?: () => Date } = {}) {
    this.#configuration = configuration;
    this.#fetcher = options.fetcher ?? defaultFetcher;
    this.#clock = options.clock ?? (() => new Date());
    this.#transactions = new DirectPaystackClient(configuration, this.#fetcher);
  }

  #metadataKey(): string {
    return this.#configuration.payerMetadataKey ?? DEFAULT_PAYER_METADATA_KEY;
  }

  async createTransferAccount(request: BankTransferAccountRequest): Promise<ProviderTransferAccount> {
    if (!Number.isSafeInteger(request.amountKobo) || request.amountKobo <= 0) throw new Error("Paystack amount must be a positive integer in kobo");
    // ADR 0088: Paystack would silently extend a shorter expiry past the deadline, so fail closed instead.
    const remaining = Date.parse(request.expiresAt) - this.#clock().getTime();
    if (!Number.isFinite(remaining) || remaining < PAYSTACK_TRANSFER_MINIMUM_EXPIRY_MINUTES * 60_000) throw new Error("The Payment Window deadline is too close for a Paystack transfer account");
    const response = await this.#fetcher(`${PAYSTACK_API_URL}/charge`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.#configuration.secretKey}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        email: request.email,
        amount: request.amountKobo,
        currency: request.currency,
        reference: request.reference,
        bank_transfer: { account_expires_at: request.expiresAt },
        ...(request.payerId === undefined ? {} : { metadata: JSON.stringify({ [this.#metadataKey()]: request.payerId }) }),
      }),
    });
    const envelope = assertProviderResponse(response, await response.json(), "transfer charge");
    const data = recordOf(envelope.data);
    const bank = recordOf(data?.bank);
    if (data?.status !== "pending_bank_transfer" || data.reference !== request.reference || typeof data.account_number !== "string" || typeof bank?.name !== "string" || typeof data.account_expires_at !== "string") {
      throw new Error("Paystack transfer charge returned an invalid account");
    }
    return Object.freeze({ bankName: bank.name, accountNumber: data.account_number, reference: data.reference, expiresAt: data.account_expires_at });
  }

  verifyTransfer(): BankTransferProviderResult {
    throw new Error("Paystack transfers are verified with verifyTransferAsync");
  }

  /** Server-side double check of a transfer against the provider's transaction record (ADR 0047). */
  async verifyTransferAsync(reference: string): Promise<BankTransferProviderResult> {
    const result = await this.#transactions.verifyTransaction(reference);
    return Object.freeze({
      verified: result.verified && result.environment === this.#configuration.environment,
      status: transferStatus(result.status),
      amountKobo: result.amountKobo,
      currency: result.currency,
      pspReference: result.pspReference,
      ...(result.payerId === undefined ? {} : { payerId: result.payerId }),
    });
  }
}
