import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DirectPaystackClient,
  InMemoryPaymentIntentRegistry,
  PaystackBankTransferClient,
  PaystackConfigurationError,
  PaystackPayments,
  isApprovedPaystackCheckoutUrl,
  loadPaystackConfiguration,
  type PaystackConfiguration,
} from "../packages/platform-core/src/payments/index.js";
import * as shortlet from "../domains/shortlet/src/index.js";
import { SqliteReceiptBlobStore, newReceiptObjectKey } from "../packages/platform-core/src/payments/receipt-blob-store.js";
import { createPaystackHttpFake } from "./helpers/paystack-http.js";

// Map slice 15: Platform Payments — move the Paystack port, webhook, transfer verification and receipt
// store out of shortlet into a deep platform module (ADR 0099 rule 2, ADR 0087/0088/0090/0096, ADR 0075).

const CONFIG: PaystackConfiguration = { secretKey: "sk_test_platform_payments", environment: "test", callbackBaseUrl: "https://pilot.example" };
const TRANSFER_CLOCK = (): Date => new Date("2026-08-01T12:00:00.000Z");

const shortletSource = fileURLToPath(new URL("../domains/shortlet/src", import.meta.url));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(entryPath) : [entryPath];
  });
}

test("AC1: domains/shortlet has no Paystack HTTP or webhook-signature code; the adapter and webhook live in the platform Payments module", () => {
  const markers = ["api.paystack.co", "x-paystack-signature", "checkout.paystack.com", "verifyWebhookSignature", "DirectPaystackClient", "PaystackBankTransferClient"];
  const offenders: string[] = [];
  for (const file of sourceFiles(shortletSource)) {
    const source = readFileSync(file, "utf8");
    for (const marker of markers) {
      if (source.includes(marker)) offenders.push(`${path.relative(shortletSource, file)}: ${marker}`);
    }
  }
  assert.deepEqual(offenders, []);
  // The shortlet façade no longer hands a provider client to callers; the platform module owns it.
  assert.equal(Object.hasOwn(shortlet, "DirectPaystackClient"), false);
  assert.equal(Object.hasOwn(shortlet, "PaystackBankTransferClient"), false);
  assert.equal(Object.hasOwn(shortlet, "loadPaystackConfiguration"), false);
});

test("AC2: a payment intent carries a domain id and reference, and the outcome routes back to that domain; an unknown reference routes nowhere", async () => {
  const fake = createPaystackHttpFake({ transaction: { reference: "psp-ref-route", amount: 13000000, currency: "NGN", status: "success", domain: "test" } });
  const registry = new InMemoryPaymentIntentRegistry();
  const payments = new PaystackPayments({ card: new DirectPaystackClient(CONFIG, fake.fetcher), registry });

  await payments.start({ domainId: "shortlet", method: "card", reference: "psp-ref-route", email: "guest@example.test", amountKobo: 13000000, currency: "NGN", payerId: "guest-1" });
  assert.deepEqual(registry.find("psp-ref-route"), { domainId: "shortlet", method: "card" });

  const routed = await payments.confirm("psp-ref-route");
  assert.equal(routed.domainId, "shortlet");
  assert.equal(routed.reference, "psp-ref-route");
  assert.equal(routed.providerReference, "psp-ref-route");

  // A reference no intent recorded fails closed: the outcome carries no domain id.
  const unrouted = await payments.confirm("psp-ref-unrecorded");
  assert.equal(unrouted.domainId, undefined);
});

test("AC2: a transfer intent records its domain so a transfer outcome carries it back", async () => {
  const card = createPaystackHttpFake();
  const transferFake = createPaystackHttpFake();
  const transfers = new PaystackBankTransferClient(CONFIG, { fetcher: transferFake.fetcher, clock: TRANSFER_CLOCK });
  const payments = new PaystackPayments({ card: new DirectPaystackClient(CONFIG, card.fetcher), transfers });

  const started = await payments.start({ domainId: "shortlet", method: "bank_transfer", reference: "exp_trf_route", email: "guest@example.test", amountKobo: 1000, currency: "NGN", expiresAt: "2026-08-01T12:20:00.000Z" });
  assert.equal(started.method, "bank_transfer");
  if (started.method !== "bank_transfer") throw new Error("unreachable");

  const outcome = await payments.verifyTransfer("exp_trf_route");
  assert.equal(outcome.domainId, "shortlet");
  assert.equal(outcome.reference, "exp_trf_route");
});

test("AC3: the moved adapter keeps the card, bank-transfer and manual-transfer provider contracts", async () => {
  // Card: approved checkout hosts, card-only channel and the payer metadata key are unchanged.
  assert.equal(isApprovedPaystackCheckoutUrl("https://checkout.paystack.com/token"), true);
  assert.equal(isApprovedPaystackCheckoutUrl("https://evil.example/pay"), false);
  const fake = createPaystackHttpFake();
  const card = new DirectPaystackClient(CONFIG, fake.fetcher);
  await card.initializeTransaction({ email: "guest@example.test", amountKobo: 1000, currency: "NGN", reference: "psp-ref-contract", callbackUrl: "https://pilot.example/payments/paystack/callback", payerId: "guest-1" });
  const body = JSON.parse(fake.requests[0]!.body!) as { channels: string[]; metadata: string };
  assert.deepEqual(body.channels, ["card"]);
  assert.deepEqual(JSON.parse(body.metadata), { shortlet_guest_id: "guest-1" });

  // Configuration still fails closed without a secret in production.
  assert.throws(() => loadPaystackConfiguration({}, { runtime: "production" }), PaystackConfigurationError);

  // Transfer: the provider issues the account and the sync port still refuses network verification.
  const transfers = new PaystackBankTransferClient(CONFIG, { fetcher: createPaystackHttpFake().fetcher, clock: TRANSFER_CLOCK });
  const account = await transfers.createTransferAccount({ reference: "exp_trf_contract", amountKobo: 1000, currency: "NGN", expiresAt: "2026-08-01T12:20:00.000Z", email: "guest@example.test" });
  assert.equal(account.reference, "exp_trf_contract");
  assert.throws(() => transfers.verifyTransfer(), /verifyTransferAsync/);

  // The receipt port a manual transfer composes is still the platform store with opaque keys.
  assert.equal(typeof SqliteReceiptBlobStore, "function");
  assert.notEqual(newReceiptObjectKey(), newReceiptObjectKey());
});

test("AC4: no secret key or raw card data enters platform payment state, an outcome or a webhook result", async () => {
  const fake = createPaystackHttpFake({ transaction: { reference: "psp-ref-secret", amount: 1000, currency: "NGN", status: "success", domain: "test", card: { brand: "visa", last4: "4242" } } });
  const registry = new InMemoryPaymentIntentRegistry();
  const payments = new PaystackPayments({ card: new DirectPaystackClient(CONFIG, fake.fetcher), registry });

  await payments.start({ domainId: "shortlet", method: "card", reference: "psp-ref-secret", email: "guest@example.test", amountKobo: 1000, currency: "NGN" });
  const outcome = await payments.confirm("psp-ref-secret");

  // The registry keeps only routing facts, never amounts, references or credentials.
  assert.deepEqual(registry.find("psp-ref-secret"), { domainId: "shortlet", method: "card" });

  // Only the non-sensitive card projection survives.
  assert.deepEqual(outcome.cardMetadata, { brand: "visa", last4: "4242" });
  const serialized = JSON.stringify(outcome);
  assert.equal(serialized.includes(CONFIG.secretKey), false);
  assert.equal(serialized.includes("4242424242424242"), false);

  // The webhook result names only the reference and its routing fact.
  const signature = "0".repeat(128);
  const webhook = await payments.handleWebhook({ rawBody: JSON.stringify({ event: "charge.success", data: { reference: "psp-ref-secret" } }), signature });
  assert.equal(webhook.kind, "invalid-signature");
  const accepted = await payments.handleWebhook({ rawBody: JSON.stringify({ event: "charge.success", data: { reference: "psp-ref-secret" } }), signature: validSignature(JSON.stringify({ event: "charge.success", data: { reference: "psp-ref-secret" } })) });
  assert.deepEqual(accepted, { kind: "charge", reference: "psp-ref-secret", domainId: "shortlet", method: "card" });
});

function validSignature(rawBody: string): string {
  return createHmac("sha512", CONFIG.secretKey).update(rawBody).digest("hex");
}
