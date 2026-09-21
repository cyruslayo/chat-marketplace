import { createHmac, timingSafeEqual } from "node:crypto";
import type { PSPVerifyResult } from "./card-payment.js";

export type PaystackEnvironment = "test" | "live";

export interface PaystackConfiguration {
  readonly secretKey: string;
  readonly environment: PaystackEnvironment;
  readonly callbackBaseUrl: string;
}

export type PaystackPublicConfiguration = Omit<PaystackConfiguration, "secretKey">;

export interface PaystackEnvironmentSource {
  readonly PAYSTACK_SECRET_KEY?: string;
  readonly PAYSTACK_ENVIRONMENT?: string;
  readonly PAYSTACK_CALLBACK_BASE_URL?: string;
  readonly NODE_ENV?: string;
}

export class PaystackConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaystackConfigurationError";
  }
}

/**
 * Loads only the three pilot configuration values. Production cannot use the
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

  return Object.freeze({ secretKey, environment, callbackBaseUrl: parsedCallback.origin });
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
    throw new Error(`Paystack ${operation} request failed`);
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

  async initializeTransaction(input: PaystackInitializeInput): Promise<PaystackInitializeResult> {
    if (!Number.isSafeInteger(input.amountKobo) || input.amountKobo < 0) throw new Error("Paystack amount must be a non-negative integer in kobo");
    const payload = {
      email: input.email,
      amount: input.amountKobo,
      currency: input.currency,
      reference: input.reference,
      callback_url: input.callbackUrl,
      channels: ["card"],
      ...(input.payerId === undefined ? {} : { metadata: JSON.stringify({ shortlet_guest_id: input.payerId }) }),
    };
    const response = await this.#fetcher(`${PAYSTACK_API_URL}/transaction/initialize`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.#configuration.secretKey}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
    const envelope = assertProviderResponse(response, await response.json(), "initialization");
    const data = recordOf(envelope.data);
    const authorizationUrl = data?.authorization_url;
    const reference = data?.reference;
    if (typeof authorizationUrl !== "string" || !isApprovedPaystackCheckoutUrl(authorizationUrl) || typeof reference !== "string" || reference !== input.reference) {
      throw new Error("Paystack initialization returned an invalid checkout");
    }
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
    const payerId = recordOf(metadata)?.shortlet_guest_id;
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
