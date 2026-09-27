import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { startLocalGuestServer } from "../apps/local-guest/src/guest-server.js";
import { paystackTransfersEnabled } from "../apps/pilot/src/pilot-config.js";
import { BankTransferProviderError, DirectPaystackClient, PAYSTACK_TRANSFER_MINIMUM_EXPIRY_MINUTES, PaystackBankTransferClient, type PaystackConfiguration, type Unit } from "../domains/shortlet/src/index.js";
import { PAYSTACK_FAKE_TRANSFER_ACCOUNT, createPaystackHttpFake } from "./helpers/paystack-http.js";

// P2 — Paystack transfer adapter and webhook (.scratch/guest-payments/issues/02-paystack-transfer-adapter.md).

const MINUTE = 60_000;
const SECRET = "sk_test_transfer_secret";
const CONFIG: PaystackConfiguration = { secretKey: SECRET, environment: "test", callbackBaseUrl: "https://pilot.example" };
const EMAIL = "transfer.guest@example.test";

/** A Guest environment composed with Paystack Pay with Transfer over a fake Paystack HTTP API. */
function paystackGuest(options: { readonly chargeExpiry?: (requested: string) => string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "p2-paystack-"));
  let now = new Date("2026-09-03T10:00:00.000Z");
  const clock = () => now;
  const fake = createPaystackHttpFake(options.chargeExpiry ? { chargeExpiry: options.chargeExpiry } : {});
  const env = new LocalGuestEnvironment({
    databasePath: join(dir, "guest.sqlite"),
    deterministicPsp: false,
    paystackClient: new DirectPaystackClient(CONFIG, fake.fetcher),
    bankTransferProvider: new PaystackBankTransferClient(CONFIG, { fetcher: fake.fetcher, clock }),
    initialGuestPhoneNumber: "+2348012345678",
    initialGuestContactEmail: EMAIL,
    clock,
  });
  // Launch units carry no deposit (ADR 0089), so one transfer pays the booking.
  const unit = env.unitRepository.findById("unit-lagos-ikoyi-001") as Unit;
  env.unitRepository.save({ ...unit, price: { ...unit.price, refundableSecurityDepositKobo: 0 } });
  const draft = env.bookingRequestApp.createDraft({ unitId: unit.id, primaryGuest: { id: env.config.guestId, name: env.config.guestName }, occupants: env.demoOccupants(2), selfBookingAttestation: env.selfBookingAttestation(), checkIn: "2026-09-10", checkOut: "2026-09-13" }, env.guestPrincipal());
  const request = env.bookingRequestApp.disclose(draft.draftId, env.guestPrincipal());
  const { offerId } = env.simulateOperatorAcceptance(request.requestId);
  const offer = env.conditionalOfferApp.manager.getOffer(offerId);
  env.conditionalOfferApp.accept({ offerId, confirmationToken: offer.confirmationToken, expectedVersion: offer.offerVersion, principal: env.guestPrincipal() });
  const contracts = () => { const db = new DatabaseSync(env.config.databasePath); try { return (db.prepare("SELECT COUNT(*) AS count FROM booking_contracts").get() as { count: number }).count; } finally { db.close(); } };
  return {
    env, fake, offerId, deadline: offer.paymentWindow.expiresAt, contracts,
    advance(ms: number) { now = new Date(now.getTime() + ms); },
    now: () => now,
    close() { env.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}

function signed(body: string): string {
  return createHmac("sha512", SECRET).update(body).digest("hex");
}

test("AC1 — A transfer charge is created with the booking reference, exact amount in kobo and an expiry equal to the Payment Window deadline, and fails closed if that deadline is less than 15 minutes away", async () => {
  const g = paystackGuest();
  try {
    const session = await g.env.bankTransferApp!.initializeTransfer(g.offerId, g.env.guestPrincipal());
    const charges = g.fake.requests.filter((request) => request.url === "https://api.paystack.co/charge");
    assert.equal(charges.length, 1);
    const [charge] = charges;
    assert.equal(charge!.method, "POST");
    assert.equal(charge!.headers.Authorization, `Bearer ${SECRET}`);
    const body = JSON.parse(charge!.body!) as Record<string, unknown>;
    assert.equal(body.reference, session.transferReference);
    assert.equal(body.amount, session.amountKobo);
    assert.ok(Number.isSafeInteger(body.amount), "exact kobo");
    assert.equal(body.currency, "NGN");
    assert.equal(body.email, EMAIL);
    assert.deepEqual(body.bank_transfer, { account_expires_at: g.deadline });
    assert.deepEqual(JSON.parse(body.metadata as string), { shortlet_guest_id: g.env.config.guestId });
    assert.equal(session.bankName, PAYSTACK_FAKE_TRANSFER_ACCOUNT.bankName);
    assert.equal(session.accountNumber, PAYSTACK_FAKE_TRANSFER_ACCOUNT.accountNumber);
    assert.equal(session.expiresAt, g.deadline);
  } finally { g.close(); }

  // Less than 15 minutes left: Paystack would extend the account past the deadline, so nothing is asked or recorded.
  const late = paystackGuest();
  try {
    late.advance((20 - PAYSTACK_TRANSFER_MINIMUM_EXPIRY_MINUTES) * MINUTE + 1);
    await assert.rejects(late.env.bankTransferApp!.initializeTransfer(late.offerId, late.env.guestPrincipal()), BankTransferProviderError);
    assert.equal(late.fake.requests.filter((request) => request.url.endsWith("/charge")).length, 0);
    assert.equal(late.env.bankTransferApp!.manager.getSession(late.offerId), undefined);
    assert.equal(late.env.livePaymentAttempts.current(late.offerId, late.now()), undefined);
  } finally { late.close(); }

  // An account Paystack says stays payable past the deadline is refused (ADR 0047).
  const extended = paystackGuest({ chargeExpiry: (requested) => new Date(Date.parse(requested) + MINUTE).toISOString() });
  try {
    await assert.rejects(extended.env.bankTransferApp!.initializeTransfer(extended.offerId, extended.env.guestPrincipal()), /after the Payment Window deadline/);
    assert.equal(extended.env.bankTransferApp!.manager.getSession(extended.offerId), undefined);
  } finally { extended.close(); }

  // Production switches transfers on only by explicit, known configuration (ADR 0088 activation).
  assert.equal(paystackTransfersEnabled(undefined), false);
  assert.equal(paystackTransfersEnabled("disabled"), false);
  assert.equal(paystackTransfersEnabled("enabled"), true);
  for (const typo of ["yes", "true", "Enabled", "on"]) assert.throws(() => paystackTransfersEnabled(typo), /must be enabled or disabled/);
});

test("AC2 — A signed Paystack success event for the designated reference and exact amount confirms the booking once; an unsigned, mismatched-amount, unknown-reference or duplicate event confirms nothing", async () => {
  const g = paystackGuest();
  const server = startLocalGuestServer({ port: 0, environment: g.env, paystackClient: new DirectPaystackClient(CONFIG, g.fake.fetcher) });
  try {
    const port = await server.listen();
    const post = (body: string, signature?: string) => fetch(`http://localhost:${port}/webhooks/paystack`, { method: "POST", headers: { "content-type": "application/json", ...(signature === undefined ? {} : { "x-paystack-signature": signature }) }, body });
    const session = await g.env.bankTransferApp!.initializeTransfer(g.offerId, g.env.guestPrincipal());
    const event = JSON.stringify({ event: "charge.success", data: { reference: session.transferReference, channel: "bank_transfer", amount: session.amountKobo, currency: "NGN" } });
    const transaction = { reference: session.transferReference, amount: session.amountKobo, currency: "NGN", status: "success", domain: "test" as const, metadata: { shortlet_guest_id: g.env.config.guestId } };
    const status = () => g.env.bankTransferApp!.getArtifact(g.offerId, g.env.guestPrincipal()).facts.status;
    g.advance(5 * MINUTE);

    // Unsigned or wrongly signed: rejected before any meaning is read.
    g.fake.setTransaction(transaction);
    assert.equal((await post(event)).status, 401);
    assert.equal((await post(event, signed(event).replace(/.$/, (c) => (c === "0" ? "1" : "0")))).status, 401);
    assert.equal(g.contracts(), 0);

    // Signed, but Paystack reports a different amount: nothing confirms (the event body is never trusted).
    g.fake.setTransaction({ ...transaction, amount: transaction.amount - 100 });
    assert.equal((await post(event, signed(event))).status, 200);
    assert.equal(g.contracts(), 0);
    assert.notEqual(status(), "confirmed");

    // Signed, unknown reference: ignored.
    const unknown = JSON.stringify({ event: "charge.success", data: { reference: "exp_trf_not_ours" } });
    assert.equal((await post(unknown, signed(unknown))).status, 200);
    assert.equal(g.contracts(), 0);

    // Signed, designated reference, exact amount: confirms once; the duplicate confirms nothing more.
    g.fake.setTransaction(transaction);
    assert.equal((await post(event, signed(event))).status, 200);
    assert.equal(status(), "confirmed");
    assert.equal(g.contracts(), 1);
    assert.equal((await post(event, signed(event))).status, 200);
    assert.equal(g.contracts(), 1);
    // The double check is a server-side verification against Paystack, never the event body.
    assert.ok(g.fake.requests.some((request) => request.url.endsWith(`/transaction/verify/${encodeURIComponent(session.transferReference)}`)));
  } finally { await server.close(); g.close(); }
});

test("AC3 — A success reported after the deadline never confirms the booking and is recorded for a full refund", async () => {
  const g = paystackGuest();
  const server = startLocalGuestServer({ port: 0, environment: g.env, paystackClient: new DirectPaystackClient(CONFIG, g.fake.fetcher) });
  try {
    const port = await server.listen();
    const session = await g.env.bankTransferApp!.initializeTransfer(g.offerId, g.env.guestPrincipal());
    g.fake.setTransaction({ reference: session.transferReference, amount: session.amountKobo, currency: "NGN", status: "success", domain: "test", metadata: { shortlet_guest_id: g.env.config.guestId } });
    // Past the Payment Window and any grace (ADR 0044): the money is late.
    g.advance(31 * MINUTE);
    const event = JSON.stringify({ event: "charge.success", data: { reference: session.transferReference } });
    assert.equal((await fetch(`http://localhost:${port}/webhooks/paystack`, { method: "POST", headers: { "content-type": "application/json", "x-paystack-signature": signed(event) }, body: event })).status, 200);
    assert.equal(g.contracts(), 0, "never confirms");
    const refund = g.env.bankTransferApp!.manager.getRefundRecord(g.offerId);
    assert.ok(refund, "recorded for refund");
    assert.equal(refund.amountKobo, session.amountKobo, "in full");
    assert.equal(refund.reason, "late_payment_after_expiry");
    assert.equal(g.env.bankTransferApp!.manager.getReconciliationRecord(g.offerId)?.status, "quarantined_for_refund");
    assert.notEqual(g.env.bankTransferApp!.getArtifact(g.offerId, g.env.guestPrincipal()).facts.status, "confirmed");
  } finally { await server.close(); g.close(); }
});
