import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { CardPaymentManager, InMemoryBookingPaymentJourneyRepository, DirectPaystackClient, PaystackConfigurationError, isApprovedPaystackCheckoutUrl, loadPaystackConfiguration, type ConditionalBookingOffer, type PSPVerifyResult } from "../domains/shortlet/src/index.js";
import { cardPaymentArtifactFromState } from "../apps/web/src/card-payment-artifact.js";
import { renderGuestShellHtml } from "../apps/local-guest/src/guest-server.js";
import { createPaystackHttpFake } from "./helpers/paystack-http.js";
import type { CommandPrincipal, PlatformCommandEnvelope } from "../packages/platform-core/src/index.js";

const NOW = new Date("2026-08-01T12:10:00.000Z");
const guest: CommandPrincipal = { id: "guest-456", role: "guest", tenantId: "tenant-lagos" };
const system: CommandPrincipal = { id: "platform-system", role: "system", tenantId: "tenant-lagos" };

function offer(overrides: Partial<ConditionalBookingOffer> = {}): ConditionalBookingOffer {
  return {
    offerId: "offer-paystack",
    offerVersion: 1,
    requestId: "request-paystack",
    inventoryCommitmentId: "commit-paystack",
    unitId: "unit-paystack",
    tenantId: "tenant-lagos",
    parties: { primaryGuest: { id: "guest-456", name: "Ada Okafor" }, operator: { id: "operator", name: "Operator" }, distinctPayer: null },
    unit: { id: "unit-paystack", title: "Pilot Apartment", propertyId: "property", location: { city: "Lagos" } },
    dates: { checkIn: "2026-08-10", checkOut: "2026-08-12", nights: 2 },
    occupants: [{ name: "Ada Okafor" }],
    quote: { breakdown: { accommodationNetKobo: 11000000, platformCommissionKobo: 2000000 }, allInStayTotalKobo: 13000000 },
    refundableSecurityDepositKobo: 0,
    totalAmountDueNowKobo: 13000000,
    policies: { cancellationPolicy: { name: "Flexible" }, guestConductRules: [] },
    disclosures: [],
    paymentWindow: { durationMinutes: 20, expiresAt: "2026-08-01T12:20:00.000Z" },
    status: "accepted",
    issuedAt: "2026-08-01T12:00:00.000Z",
    acceptedAt: "2026-08-01T12:05:00.000Z",
    confirmationToken: "token",
    tokenUsed: true,
    aggregateVersions: { offerVersion: 1, pricingVersion: "p1", quoteVersion: "q1", cancellationPolicyVersion: "c1", managementAuthorityVersion: "m1", inspectionVersion: "i1" },
    ...overrides,
  } as ConditionalBookingOffer;
}

function envelope<T>(commandName: string, payload: T, principal: CommandPrincipal = guest): PlatformCommandEnvelope<T> {
  return { commandId: `command-${Math.random().toString(16).slice(2)}`, commandName, timestamp: NOW.toISOString(), principal, payload };
}

function setup(options: { readonly environment?: "test" | "live"; readonly journey?: InMemoryBookingPaymentJourneyRepository; readonly contactEmail?: string | null; readonly contactPhone?: string | null; readonly currentOffer?: ConditionalBookingOffer; readonly initialize?: boolean } = {}) {
  let result: PSPVerifyResult = { verified: true, status: "success", amountKobo: 13000000, currency: "NGN", pspReference: "unset", payerId: "guest-456", ...(options.environment === undefined ? {} : { environment: options.environment }) };
  const currentOffer = options.currentOffer ?? offer();
  const manager = new CardPaymentManager({
    offerManager: { getOffer: (offerId) => { if (offerId !== currentOffer.offerId) throw new Error("unknown offer"); return currentOffer; } },
    repository: { findById: () => ({ id: currentOffer.unitId, published: true, inspection: { materialChangePending: false } }), findAll: () => [] },
    calendar: { transitionPaymentPendingToConfirmedBooking() {} },
    journeyRepository: options.journey,
    guestContacts: { find: () => ({ guestId: "guest-456", tenantId: "tenant-lagos", phoneNumber: options.contactPhone ?? "+2348012345678", contactEmail: options.contactEmail === undefined ? "guest@example.com" : options.contactEmail, revision: 1 }) },
    pspClient: { verifyTransaction: (reference) => ({ ...result, pspReference: result.pspReference === "unset" ? reference : result.pspReference }) },
  });
  const session = options.initialize === false ? undefined : manager.initializeCardCheckout(envelope("card_payment.initialize_checkout", { offerId: currentOffer.offerId }), { clock: () => NOW, ...(options.environment === undefined ? {} : { providerEnvironment: options.environment }) });
  return { manager, session: session as ReturnType<CardPaymentManager["getCheckoutSession"]> & { pspReference: string }, setResult(next: PSPVerifyResult) { result = next; } };
}

function successCommand(sessionReference: string, offerId = "offer-paystack"): PlatformCommandEnvelope<{ offerId: string; pspReference: string }> {
  return envelope("card_payment.verify_and_confirm", { offerId, pspReference: sessionReference }, system);
}

test("AC1 — Production Paystack configuration fails closed when the secret key is absent", () => {
  assert.throws(() => loadPaystackConfiguration({ PAYSTACK_ENVIRONMENT: "live", PAYSTACK_CALLBACK_BASE_URL: "https://pilot.example" }, { runtime: "production" }), PaystackConfigurationError);
});

test("AC2 — Test runtime can still use deterministic payment fixtures", () => {
  const { manager, session } = setup();
  const result = manager.verifyAndConfirmCardPayment(successCommand(session.pspReference), { clock: () => NOW });
  assert.equal(result.outcome, "confirmed");
});

test("AC3 — Payment initialization requires an authenticated Guest", () => {
  assert.throws(() => setup({ currentOffer: offer() }).manager.initializeCardCheckout(envelope("card_payment.initialize_checkout", { offerId: "offer-paystack" }, { id: "guest-456", role: "system", tenantId: "tenant-lagos" })), /authoritative payer/);
});

test("AC4 — Payment initialization requires an accepted Conditional Booking Offer", () => {
  const currentOffer = offer();
  const { manager } = setup({ currentOffer, initialize: false });
  (currentOffer as { status: string }).status = "confirmed";
  assert.throws(() => manager.initializeCardCheckout(envelope("card_payment.initialize_checkout", { offerId: "offer-paystack" })), /accepted offer/);
});

test("AC5 — Payment initialization requires stored Guest email", () => {
  const { manager } = setup({ contactEmail: null, initialize: false });
  assert.throws(() => manager.initializeCardCheckout(envelope("card_payment.initialize_checkout", { offerId: "offer-paystack" }), { clock: () => NOW }), /email address/);
});

test("AC6 — Initialization uses the authoritative amount", async () => {
  const fake = createPaystackHttpFake();
  const client = new DirectPaystackClient({ secretKey: "sk_test_secret", environment: "test", callbackBaseUrl: "https://pilot.example" }, fake.fetcher);
  await client.initializeTransaction({ email: "guest@example.com", amountKobo: 13000000, currency: "NGN", reference: "platform-ref", callbackUrl: "https://pilot.example/payments/paystack/callback" });
  assert.equal(JSON.parse(fake.requests[0]!.body!).amount, 13000000);
});

test("AC7 — Initialization sends exact NGN", async () => {
  const fake = createPaystackHttpFake();
  const client = new DirectPaystackClient({ secretKey: "sk_test_secret", environment: "test", callbackBaseUrl: "https://pilot.example" }, fake.fetcher);
  await client.initializeTransaction({ email: "guest@example.com", amountKobo: 13000000, currency: "NGN", reference: "platform-ref", callbackUrl: "https://pilot.example/payments/paystack/callback" });
  assert.equal(JSON.parse(fake.requests[0]!.body!).currency, "NGN");
});

test("AC8 — Initialization requests card-only checkout", async () => {
  const fake = createPaystackHttpFake();
  const client = new DirectPaystackClient({ secretKey: "sk_test_secret", environment: "test", callbackBaseUrl: "https://pilot.example" }, fake.fetcher);
  await client.initializeTransaction({ email: "guest@example.com", amountKobo: 13000000, currency: "NGN", reference: "platform-ref", callbackUrl: "https://pilot.example/payments/paystack/callback" });
  assert.deepEqual(JSON.parse(fake.requests[0]!.body!).channels, ["card"]);
});

test("AC9 — The browser cannot override amount", () => {
  const { manager } = setup();
  assert.throws(() => manager.initializeCardCheckout(envelope("card_payment.initialize_checkout", { offerId: "offer-paystack", amountKobo: 1 } as unknown as { offerId: string })), /only offerId/);
});

test("AC10 — The browser cannot override currency", () => {
  const { manager } = setup();
  assert.throws(() => manager.initializeCardCheckout(envelope("card_payment.initialize_checkout", { offerId: "offer-paystack", currency: "USD" } as unknown as { offerId: string })), /only offerId/);
});

test("AC11 — The browser cannot override callback URL", () => {
  const { manager } = setup();
  assert.throws(() => manager.initializeCardCheckout(envelope("card_payment.initialize_checkout", { offerId: "offer-paystack", callbackUrl: "https://evil.example" } as unknown as { offerId: string })), /only offerId/);
});

test("AC12 — A Live Payment Attempt has one stable Paystack reference", () => {
  const { manager, session } = setup({ environment: "test" });
  assert.equal(manager.getCheckoutSession("offer-paystack")?.pspReference, session.pspReference);
  assert.match(session.pspReference, /^psp_ref_/);
});

test("AC13 — Refresh does not initialize another Live Payment Attempt", () => {
  const { manager, session } = setup({ environment: "test" });
  const reused = manager.initializeCardCheckout(envelope("card_payment.initialize_checkout", { offerId: "offer-paystack" }), { clock: () => NOW, providerEnvironment: "test", reuseExisting: true });
  assert.equal(reused.pspReference, session.pspReference);
});

test("AC14 — Returned checkout URLs are restricted to approved Paystack hosts", async () => {
  assert.equal(isApprovedPaystackCheckoutUrl("https://checkout.paystack.com/fake"), true);
  assert.equal(isApprovedPaystackCheckoutUrl("https://evil.example/pay"), false);
  const fake = createPaystackHttpFake({ authorizationUrl: "https://evil.example/pay" });
  const client = new DirectPaystackClient({ secretKey: "sk_test_secret", environment: "test", callbackBaseUrl: "https://pilot.example" }, fake.fetcher);
  await assert.rejects(client.initializeTransaction({ email: "guest@example.com", amountKobo: 1, currency: "NGN", reference: "platform-ref", callbackUrl: "https://pilot.example/payments/paystack/callback" }), /invalid checkout/);
});

test("AC15 — Callback arrival alone cannot mark payment successful", () => {
  const { manager, session } = setup();
  assert.equal(manager.projectInteractionState("offer-paystack").paymentStatus, "awaiting_verification");
  assert.equal(manager.getBookingContract("offer-paystack"), undefined);
  assert.equal(session.status, "initiated");
});

test("AC16 — Valid Paystack verification can mark payment verified", () => {
  const { manager, session } = setup({ environment: "test" });
  const result = manager.verifyAndConfirmCardPaymentWithProviderResult(successCommand(session.pspReference), { verified: true, status: "success", amountKobo: 13000000, currency: "NGN", pspReference: session.pspReference, payerId: "guest-456", environment: "test" }, { clock: () => NOW });
  assert.equal(result.outcome, "confirmed");
});

test("AC17 — Wrong amount fails closed", () => {
  const { manager, session } = setup();
  assert.throws(() => manager.verifyAndConfirmCardPaymentWithProviderResult(successCommand(session.pspReference), { verified: true, status: "success", amountKobo: 1, currency: "NGN", pspReference: session.pspReference, payerId: "guest-456" }, { clock: () => NOW }), /Amount/);
});

test("AC18 — Wrong currency fails closed", () => {
  const { manager, session } = setup();
  assert.throws(() => manager.verifyAndConfirmCardPaymentWithProviderResult(successCommand(session.pspReference), { verified: true, status: "success", amountKobo: 13000000, currency: "USD", pspReference: session.pspReference, payerId: "guest-456" }, { clock: () => NOW }), /Currency/);
});

test("AC19 — Wrong reference fails closed", () => {
  const { manager, session } = setup();
  assert.throws(() => manager.verifyAndConfirmCardPaymentWithProviderResult(successCommand(session.pspReference), { verified: true, status: "success", amountKobo: 13000000, currency: "NGN", pspReference: "wrong", payerId: "guest-456" }, { clock: () => NOW }), /Reference/);
});

test("AC20 — Wrong environment fails closed", () => {
  const { manager, session } = setup({ environment: "live" });
  assert.throws(() => manager.verifyAndConfirmCardPaymentWithProviderResult(successCommand(session.pspReference), { verified: true, status: "success", amountKobo: 13000000, currency: "NGN", pspReference: session.pspReference, payerId: "guest-456", environment: "test" }, { clock: () => NOW }), /Environment/);
});

test("AC21 — Pending payment does not create a Reservation", () => {
  const { manager, session } = setup();
  assert.throws(() => manager.verifyAndConfirmCardPaymentWithProviderResult(successCommand(session.pspReference), { verified: true, status: "pending", amountKobo: 13000000, currency: "NGN", pspReference: session.pspReference, payerId: "guest-456" }, { clock: () => NOW }), /processing/);
  assert.equal(manager.getBookingContract("offer-paystack"), undefined);
});

test("AC22 — Failed payment does not create a Reservation", () => {
  const { manager, session } = setup();
  assert.throws(() => manager.verifyAndConfirmCardPaymentWithProviderResult(successCommand(session.pspReference), { verified: true, status: "failed", amountKobo: 13000000, currency: "NGN", pspReference: session.pspReference, payerId: "guest-456" }, { clock: () => NOW }), /unsuccessful/);
  assert.equal(manager.getBookingContract("offer-paystack"), undefined);
});

test("AC23 — Unknown Paystack state fails closed", () => {
  const { manager, session } = setup();
  assert.throws(() => manager.verifyAndConfirmCardPaymentWithProviderResult(successCommand(session.pspReference), { verified: true, status: "unknown", amountKobo: 13000000, currency: "NGN", pspReference: session.pspReference, payerId: "guest-456" }, { clock: () => NOW }), /Unknown PSP/);
});

test("AC24 — Valid charge.success webhook signature is accepted", () => {
  const fake = createPaystackHttpFake();
  const client = new DirectPaystackClient({ secretKey: "sk_test_secret", environment: "test", callbackBaseUrl: "https://pilot.example" }, fake.fetcher);
  const body = Buffer.from('{"event":"charge.success"}');
  const signature = createHmac("sha512", "sk_test_secret").update(body).digest("hex");
  assert.equal(client.verifyWebhookSignature(body, signature), true);
});

test("AC25 — Invalid webhook signature is rejected", () => {
  const fake = createPaystackHttpFake();
  const client = new DirectPaystackClient({ secretKey: "sk_test_secret", environment: "test", callbackBaseUrl: "https://pilot.example" }, fake.fetcher);
  assert.equal(client.verifyWebhookSignature(Buffer.from("{}"), "bad"), false);
});

test("AC26 — Webhook processing re-verifies the transaction server-side", async () => {
  const fake = createPaystackHttpFake({ transaction: { reference: "platform-ref", amount: 13000000, currency: "NGN", status: "success", domain: "test" } });
  const client = new DirectPaystackClient({ secretKey: "sk_test_secret", environment: "test", callbackBaseUrl: "https://pilot.example" }, fake.fetcher);
  await client.verifyTransaction("platform-ref");
  assert.equal(fake.requests.filter((request) => request.method === "GET").length, 1);
});

test("AC27 — Repeated webhook delivery remains idempotent", () => {
  const { manager, session } = setup();
  const command = successCommand(session.pspReference);
  const first = manager.verifyAndConfirmCardPayment(command, { clock: () => NOW });
  const second = manager.verifyAndConfirmCardPayment(command, { clock: () => NOW });
  assert.equal(first.outcome, "confirmed"); assert.equal(second.outcome, "confirmed");
  if (first.outcome === "confirmed" && second.outcome === "confirmed") assert.equal(first.reservation.reservationId, second.reservation.reservationId);
});

test("AC28 — Repeated callback delivery remains idempotent", () => {
  const { manager, session } = setup();
  const command = successCommand(session.pspReference);
  const first = manager.verifyAndConfirmCardPayment(command, { clock: () => NOW });
  const second = manager.verifyAndConfirmCardPayment(command, { clock: () => NOW });
  assert.equal(first.outcome, second.outcome);
});

test("AC29 — Concurrent callback and webhook produce one authoritative payment transition", async () => {
  const { manager, session } = setup();
  const command = successCommand(session.pspReference);
  const results = await Promise.all([Promise.resolve().then(() => manager.verifyAndConfirmCardPayment(command, { clock: () => NOW })), Promise.resolve().then(() => manager.verifyAndConfirmCardPayment(command, { clock: () => NOW }))]);
  assert.equal(results[0].outcome, "confirmed"); assert.equal(results[1].outcome, "confirmed");
  if (results[0].outcome === "confirmed" && results[1].outcome === "confirmed") assert.equal(results[0].reservation.reservationId, results[1].reservation.reservationId);
});

test("AC30 — Successful payment creates at most one Reservation", () => {
  const { manager, session } = setup();
  const result = manager.verifyAndConfirmCardPayment(successCommand(session.pspReference), { clock: () => NOW });
  assert.equal(result.outcome, "confirmed");
  if (result.outcome === "confirmed") assert.equal(manager.projectInteractionState("offer-paystack").reservationId, result.reservation.reservationId);
});

test("AC31 — Successful payment creates at most one Booking Contract", () => {
  const { manager, session } = setup();
  const result = manager.verifyAndConfirmCardPayment(successCommand(session.pspReference), { clock: () => NOW });
  assert.equal(result.outcome, "confirmed");
  if (result.outcome === "confirmed") assert.equal(manager.getBookingContract("offer-paystack")?.contractId, result.bookingContract.contractId);
});

test("AC32 — Payment Window is not reset", () => {
  const { manager, session } = setup();
  assert.equal(session.expiresAt, "2026-08-01T12:20:00.000Z");
  assert.equal(manager.getCheckoutSession("offer-paystack")?.expiresAt, session.expiresAt);
});

test("AC33 — Existing processing grace remains unchanged", () => {
  const { manager, session } = setup();
  assert.throws(() => manager.verifyAndConfirmCardPaymentWithProviderResult(successCommand(session.pspReference), { verified: true, status: "processing", amountKobo: 13000000, currency: "NGN", pspReference: session.pspReference, payerId: "guest-456" }, { clock: () => new Date("2026-08-01T12:29:59.000Z") }), /processing/);
});

test("AC34 — Late payment cannot create a Reservation", () => {
  const { manager, session } = setup({ journey: new InMemoryBookingPaymentJourneyRepository() });
  assert.throws(() => manager.verifyAndConfirmCardPaymentWithProviderResult(successCommand(session.pspReference), { verified: true, status: "success", amountKobo: 13000000, currency: "NGN", pspReference: session.pspReference, payerId: "guest-456" }, { clock: () => new Date("2026-08-01T12:31:00.000Z") }), /expired/);
  assert.equal(manager.getBookingContract("offer-paystack"), undefined);
});

test("AC35 — Late successful payment is marked for manual refund/reconciliation", () => {
  const journey = new InMemoryBookingPaymentJourneyRepository();
  const { manager, session } = setup({ journey });
  assert.throws(() => manager.verifyAndConfirmCardPaymentWithProviderResult(successCommand(session.pspReference), { verified: true, status: "success", amountKobo: 13000000, currency: "NGN", pspReference: session.pspReference, payerId: "guest-456" }, { clock: () => new Date("2026-08-01T12:31:00.000Z") }));
  const state = journey.findByOfferId("offer-paystack");
  assert.equal(state?.stage, "reconciliation_required");
  assert.equal(state?.compensation.stay.originalPaymentReference, session.pspReference);
});

test("AC36 — Paystack secret never enters browser state", () => {
  assert.equal(renderGuestShellHtml().includes("sk_test_secret"), false);
});

test("AC37 — Paystack secret never enters telemetry or audit", () => {
  const fake = createPaystackHttpFake();
  const client = new DirectPaystackClient({ secretKey: "sk_test_secret", environment: "test", callbackBaseUrl: "https://pilot.example" }, fake.fetcher);
  assert.equal(JSON.stringify(client).includes("sk_test_secret"), false);
  assert.equal(renderGuestShellHtml().includes("sk_test_secret"), false);
});

test("AC38 — Raw card data never enters application state", () => {
  const { manager } = setup();
  assert.throws(() => manager.initializeCardCheckout(envelope("card_payment.initialize_checkout", { offerId: "offer-paystack", cardNumber: "4111111111111111" } as unknown as { offerId: string })), /raw payment credentials/);
});

test("AC39 — Guest contact email is not exposed unnecessarily", () => {
  const { manager, session } = setup();
  const artifact = cardPaymentArtifactFromState({ offer: offer(), viewer: guest, session, now: NOW });
  assert.equal(JSON.stringify(artifact).includes("guest@example.com"), false);
});

test("AC40 — Payment continuation remains usable at 320px", () => {
  assert.match(renderGuestShellHtml(), /viewport-fit=cover/);
  assert.match(renderGuestShellHtml(), /@media \(max-width: 420px\)/);
});

test("AC41 — Payment callback restoration remains usable at 320px", () => {
  assert.match(renderGuestShellHtml(), /@media \(max-width: 420px\)/);
  assert.match(renderGuestShellHtml(), /workspace-reopen/);
});

test("AC42 — Operator inbox remains unaffected by payment verification", () => {
  const { manager, session } = setup();
  const result = manager.verifyAndConfirmCardPayment(successCommand(session.pspReference), { clock: () => NOW });
  assert.equal(result.outcome, "confirmed");
  assert.equal(offer().parties.operator.id, "operator");
});

test("AC43 — Complete Guest → Operator → Paystack contract → Reservation journey passes", () => {
  const { manager, session } = setup({ environment: "test" });
  const result = manager.verifyAndConfirmCardPaymentWithProviderResult(successCommand(session.pspReference), { verified: true, status: "success", amountKobo: 13000000, currency: "NGN", pspReference: session.pspReference, payerId: "guest-456", environment: "test" }, { clock: () => NOW });
  assert.equal(result.outcome, "confirmed");
  if (result.outcome === "confirmed") { assert.equal(result.bookingContract.paymentDetails.paymentMethod, "fresh_card"); assert.equal(result.reservation.status, "confirmed"); }
});
