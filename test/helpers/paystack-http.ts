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
}

export function createPaystackHttpFake(options: { readonly transaction?: PaystackFakeTransaction; readonly authorizationUrl?: string } = {}): { readonly fetcher: PaystackHttpFetcher; readonly requests: PaystackFakeRequest[]; setTransaction(transaction: PaystackFakeTransaction): void } {
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
    return response(200, { status: true, data: transaction });
  };
  return { fetcher, requests, setTransaction(next) { transaction = next; } };
}
