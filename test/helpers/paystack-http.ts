import type { PaystackHttpFetcher, PaystackHttpResponse } from "../../domains/shortlet/src/index.js";

export interface PaystackFakeRequest {
  readonly url: string;
  readonly method: "GET" | "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}
export interface PaystackFakeTransaction {
  readonly reference: string;
  readonly amount: number;
  readonly currency: string;
  readonly status: string;
  readonly domain?: "test" | "live";
  readonly card?: { readonly brand: string; readonly last4: string };
  readonly metadata?: unknown;
}

/** The Pay with Transfer account the fake issues, in the Charge API's documented response shape. */
export const PAYSTACK_FAKE_TRANSFER_ACCOUNT = Object.freeze({ bankName: "Test Bank", accountNumber: "1260257501" });

export function createPaystackHttpFake(options: {
  readonly transaction?: PaystackFakeTransaction;
  readonly authorizationUrl?: string;
  /** The expiry Paystack answers a transfer charge with; defaults to the requested `account_expires_at`. */
  readonly chargeExpiry?: (requested: string) => string;
} = {}): { readonly fetcher: PaystackHttpFetcher; readonly requests: PaystackFakeRequest[]; setTransaction(transaction: PaystackFakeTransaction): void } {
  let transaction = options.transaction ?? { reference: "psp_ref_test", amount: 15000000, currency: "NGN", status: "success", domain: "test" as const };
  const requests: PaystackFakeRequest[] = [];
  const response = (status: number, value: unknown): PaystackHttpResponse => ({ status, async json() { return value; } });
  const fetcher: PaystackHttpFetcher = async (url, init) => {
    requests.push({ url, method: init.method, headers: { ...init.headers }, ...(init.body === undefined ? {} : { body: init.body }) });
    if (url.endsWith("/transaction/initialize")) {
      const body: unknown = init.body === undefined ? undefined : JSON.parse(init.body);
      const reference = body !== null && typeof body === "object" && !Array.isArray(body) && typeof (body as { reference?: unknown }).reference === "string" ? (body as { reference: string }).reference : transaction.reference;
      return response(200, { status: true, data: { authorization_url: options.authorizationUrl ?? "https://checkout.paystack.com/fake-token", reference } });
    }
    if (url.endsWith("/charge")) {
      const body = JSON.parse(init.body ?? "{}") as { reference?: string; bank_transfer?: { account_expires_at?: string } };
      const requested = body.bank_transfer?.account_expires_at ?? "";
      return response(200, { status: true, message: "Charge attempted", data: { reference: body.reference, status: "pending_bank_transfer", display_text: "Please make a transfer to the account specified", account_name: "TEST-MANAGED-ACCOUNT", account_number: PAYSTACK_FAKE_TRANSFER_ACCOUNT.accountNumber, bank: { slug: "test-bank", name: PAYSTACK_FAKE_TRANSFER_ACCOUNT.bankName, id: 24 }, account_expires_at: options.chargeExpiry ? options.chargeExpiry(requested) : requested } });
    }
    return response(200, { status: true, data: transaction });
  };
  return { fetcher, requests, setTransaction(next) { transaction = next; } };
}
