import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CardPaymentManager, type PSPVerifyResult } from "../domains/shortlet/src/card-payment.js";
import { InMemoryBookingStateRepository } from "../domains/shortlet/src/index.js";
import { LivePaymentAttemptRegistry } from "../domains/shortlet/src/payment-attempt.js";
import { CARD_CHECKOUT_SESSION_TRANSITIONS } from "../domains/shortlet/src/card-payment.js";
import { BANK_TRANSFER_SESSION_TRANSITIONS } from "../domains/shortlet/src/bank-transfer.js";
import { MANUAL_TRANSFER_TRANSITIONS } from "../domains/shortlet/src/manual-transfer.js";
import { LIVE_PAYMENT_ATTEMPT_TRANSITIONS } from "../domains/shortlet/src/payment-attempt.js";
import { canTransition } from "../packages/platform-core/src/state-transition.js";
import type { CommandPrincipal } from "../packages/platform-core/src/index.js";
import { TEST_GUEST_CONTACTS } from "./helpers/bank-transfer-provider.js";
import { TEST_MANUAL_ACCOUNT, TEST_RECEIPTS, guestPaymentPage, multipartBody } from "./helpers/guest-payment-page.js";
import { at, paymentOffer, envelope, bankSetup, providerSuccess } from "./helpers/bank-transfer-session-fixture.js";

// Issue 06 (state-machines PRD, Track B). Characterisation of the payment session lifecycles as they run TODAY.
// No behaviour changes here: every assertion pins a status or error text the code produces now.
// ADRs 0044 (Payment Window 20 + 10 grace minutes), 0045 (refund every late payment), 0046 (one live attempt),
// 0047 (expiring bank transfers), 0090 (manual transfer and its 60-minute hold).


// ---- Card checkout session -------------------------------------------------------------------------------------

const cardPayer: CommandPrincipal = { id: "guest-card", role: "guest", tenantId: "tenant-card" };
const cardSystem: CommandPrincipal = { id: "payment-worker", role: "system", tenantId: "tenant-card" };

function cardManager(providerStatus: PSPVerifyResult["status"] = "success") {
  const offer = paymentOffer({ offerId: "offer-card", guestId: "guest-card", tenantId: "tenant-card" });
  const manager = new CardPaymentManager({
    offerManager: { getOffer: () => offer },
    guestContacts: TEST_GUEST_CONTACTS,
    repository: { findById: () => ({ id: "unit-06", published: true, inspection: {} }), findAll: () => [] },
    bookingState: new InMemoryBookingStateRepository(),
    calendar: { transitionPaymentPendingToConfirmedBooking: () => undefined, releasePaymentPending: () => undefined },
    pspClient: {
      verifyTransaction: (pspReference: string): PSPVerifyResult => ({
        verified: providerStatus === "success",
        status: providerStatus,
        amountKobo: offer.totalAmountDueNowKobo,
        currency: "NGN",
        pspReference,
        payerId: "guest-card",
      }),
    },
  });
  return { manager, offer };
}

function startCard(manager: CardPaymentManager, reuseExisting = false) {
  return manager.initializeCardCheckout(envelope("card_payment.initialize_checkout", { offerId: "offer-card" }, cardPayer), { clock: () => at(5), reuseExisting });
}

// ---- Bank transfer session -------------------------------------------------------------------------------------


// ---- Manual transfer -------------------------------------------------------------------------------------------

describe("Issue 06: payment session transitions (characterisation)", () => {
  it("AC1: card checkout main path (start, verify) ends completed, and a verify that the provider rejects leaves it initiated", () => {
    const { manager } = cardManager();
    const session = startCard(manager);
    assert.equal(session.status, "initiated");
    assert.equal(manager.getCheckoutSession("offer-card")?.status, "initiated");
    manager.verifyAndConfirmCardPayment(envelope("card_payment.verify_and_confirm", { offerId: "offer-card", pspReference: session.pspReference }, cardSystem), { clock: () => at(5) });
    assert.equal(manager.getCheckoutSession("offer-card")?.status, "completed");

    const declined = cardManager("failed");
    const declinedSession = startCard(declined.manager);
    assert.throws(() => declined.manager.verifyAndConfirmCardPayment(envelope("card_payment.verify_and_confirm", { offerId: "offer-card", pspReference: declinedSession.pspReference }, cardSystem), { clock: () => at(5) }));
    assert.equal(declined.manager.getCheckoutSession("offer-card")?.status, "initiated");
  });

  it("AC1: bank transfer main path (start, provider success before the deadline) ends completed", async () => {
    const s = bankSetup("bank-confirmed");
    const session = await s.start();
    assert.equal(session.status, "initiated");
    s.setResult(providerSuccess(session.transferReference, s.offer.totalAmountDueNowKobo));
    assert.equal(s.verify(session.transferReference, 1).outcome, "confirmed");
    assert.equal(s.manager.getSession(s.offer.offerId)?.status, "completed");
  });

  it("AC1: bank transfer processing grace ends processing_in_grace, and a later success inside the grace ends completed", async () => {
    const s = bankSetup("bank-grace");
    const session = await s.start();
    s.setResult({ ...providerSuccess(session.transferReference, s.offer.totalAmountDueNowKobo), status: "pending", processingStartedAt: at(19).toISOString() });
    assert.equal(s.verify(session.transferReference, 20).outcome, "processing_in_grace");
    assert.equal(s.manager.getSession(s.offer.offerId)?.status, "processing_in_grace");

    s.setResult(providerSuccess(session.transferReference, s.offer.totalAmountDueNowKobo));
    assert.equal(s.verify(session.transferReference, 25).outcome, "confirmed");
    assert.equal(s.manager.getSession(s.offer.offerId)?.status, "completed");
  });

  it("AC1: bank transfer expiry at the grace end ends expired, and repeating it returns the same expired session", async () => {
    const s = bankSetup("bank-expiry");
    const session = await s.start();
    const first = s.manager.resolveExpiry(s.offer.offerId, s.server, { clock: () => at(30) });
    assert.equal(first.status, "expired");
    const second = s.manager.resolveExpiry(s.offer.offerId, s.server, { clock: () => at(31) });
    assert.deepEqual(second, first);
    assert.equal(s.manager.getSession(s.offer.offerId)?.status, "expired");
    assert.equal(session.status, "initiated");
  });

  it("AC1: bank transfer late payment after the deadline ends refunded, from initiated", async () => {
    const s = bankSetup("bank-late");
    const session = await s.start();
    s.setResult(providerSuccess(session.transferReference, s.offer.totalAmountDueNowKobo));
    const outcome = s.verify(session.transferReference, 21);
    assert.equal(outcome.outcome, "late_payment_refunded");
    assert.equal(s.manager.getSession(s.offer.offerId)?.status, "refunded");
  });

  it("AC1: bank transfer late payment after an expiry ends refunded, from expired", async () => {
    const s = bankSetup("bank-late-after-expiry");
    const session = await s.start();
    s.manager.resolveExpiry(s.offer.offerId, s.server, { clock: () => at(30) });
    s.setResult(providerSuccess(session.transferReference, s.offer.totalAmountDueNowKobo));
    assert.equal(s.verify(session.transferReference, 31).outcome, "late_payment_refunded");
    assert.equal(s.manager.getSession(s.offer.offerId)?.status, "refunded");
  });

  it("AC1: manual transfer main path (start, receipt upload) ends awaiting_verification; confirm needs the operator composition, covered by back-office-manual-transfers", async () => {
    const g = await guestPaymentPage({ config: { manualTransferAccount: TEST_MANUAL_ACCOUNT } });
    try {
      assert.equal((await g.post(`${g.paymentPage}/manual-transfer`)).status, 303);
      const started = g.env.manualTransfers!.current(g.offerId, g.now())!;
      assert.equal(started.status, "awaiting_receipt");

      const form = multipartBody("receipt", "receipt.png", "image/png", TEST_RECEIPTS.png);
      await g.postRaw(`${g.paymentPage}/manual-transfer/receipt`, form.body, form.contentType);
      const uploaded = g.env.manualTransfers!.current(g.offerId, g.now())!;
      assert.equal(uploaded.status, "awaiting_verification");

    } finally {
      await g.close();
    }
  });

  it("AC1: manual transfer deadlines end expired, at the payment deadline from awaiting_receipt and at the verification deadline from awaiting_verification", async () => {
    const g = await guestPaymentPage({ config: { manualTransferAccount: TEST_MANUAL_ACCOUNT } });
    try {
      await g.post(`${g.paymentPage}/manual-transfer`);
      const started = g.env.manualTransfers!.current(g.offerId, g.now())!;
      const unpaid = g.env.manualTransfers!.current(g.offerId, new Date(Date.parse(started.paymentDeadlineAt) + 1))!;
      assert.equal(unpaid.status, "expired");
    } finally {
      await g.close();
    }

    const h = await guestPaymentPage({ config: { manualTransferAccount: TEST_MANUAL_ACCOUNT } });
    try {
      await h.post(`${h.paymentPage}/manual-transfer`);
      const started = h.env.manualTransfers!.current(h.offerId, h.now())!;
      const form = multipartBody("receipt", "receipt.png", "image/png", TEST_RECEIPTS.png);
      await h.postRaw(`${h.paymentPage}/manual-transfer/receipt`, form.body, form.contentType);
      const uploaded = h.env.manualTransfers!.current(h.offerId, h.now())!;
      assert.equal(uploaded.status, "awaiting_verification");
      const unverified = h.env.manualTransfers!.current(h.offerId, new Date(Date.parse(uploaded.verificationDeadlineAt) + 1))!;
      assert.equal(unverified.status, "expired");
      assert.ok(Date.parse(started.paymentDeadlineAt) < Date.parse(uploaded.verificationDeadlineAt));
    } finally {
      await h.close();
    }
  });

  it("AC1: live payment attempt main path (acquire, then release) ends terminal and frees the offer", () => {
    const registry = new LivePaymentAttemptRegistry();
    const attempt = registry.acquire({ offerId: "offer-attempt", method: "fresh_card", purpose: "stay", attemptId: "attempt-1", startedAt: at(0).toISOString(), expiresAt: at(20).toISOString() });
    assert.equal(attempt.status, "active");
    assert.equal(registry.current("offer-attempt", at(1))?.status, "active");
    registry.release("offer-attempt");
    assert.equal(registry.current("offer-attempt", at(1)), undefined);
    assert.equal(registry.history("attempt-1")?.status, "terminal");
    assert.equal(registry.acquire({ offerId: "offer-attempt", method: "bank_transfer", purpose: "stay", attemptId: "attempt-2", startedAt: at(2).toISOString(), expiresAt: at(22).toISOString() }).status, "active");
  });

  it("AC2: a second card checkout while one is initiated is refused with today's error text", () => {
    const { manager } = cardManager();
    startCard(manager);
    assert.throws(() => startCard(manager), { message: "A live checkout already exists for this offer" });
  });

  it("AC2: a decision on a manual transfer that has no receipt yet is refused with today's error text", async () => {
    const g = await guestPaymentPage({ config: { manualTransferAccount: TEST_MANUAL_ACCOUNT } });
    try {
      await g.post(`${g.paymentPage}/manual-transfer`);
      const transfer = g.env.manualTransfers!.current(g.offerId, g.now())!;
      assert.equal(transfer.status, "awaiting_receipt");
      assert.throws(
        () => g.env.manualTransfers!.confirm(transfer.transferId, "staff-06", { bankTransactionReference: "TRX-06-2", amountReceivedKobo: transfer.amountKobo, expectedVersion: transfer.version }, () => g.now()),
        { message: "The Guest has not uploaded a receipt yet" },
      );
    } finally {
      await g.close();
    }
  });

  it("AC2: a decision on an expired manual transfer is refused with today's error text", async () => {
    const g = await guestPaymentPage({ config: { manualTransferAccount: TEST_MANUAL_ACCOUNT } });
    try {
      await g.post(`${g.paymentPage}/manual-transfer`);
      const started = g.env.manualTransfers!.current(g.offerId, g.now())!;
      const expired = g.env.manualTransfers!.current(g.offerId, new Date(Date.parse(started.paymentDeadlineAt) + 1))!;
      assert.equal(expired.status, "expired");
      assert.throws(
        () => g.env.manualTransfers!.confirm(expired.transferId, "staff-06", { bankTransactionReference: "TRX-06-3", amountReceivedKobo: expired.amountKobo, expectedVersion: expired.version }, () => g.now()),
        { message: "This transfer expired before it was verified; any money received is refunded in full" },
      );
    } finally {
      await g.close();
    }
  });
});

// AC3 (added after the refactor): every move the characterised code makes is in its table, and a non-move is refused.
describe("Issue 06: transition tables", () => {
  it("AC3: every move the code makes is in its table, asserted with canTransition", () => {
    // Card: verify is the only write (initiated to completed).
    assert.equal(canTransition(CARD_CHECKOUT_SESSION_TRANSITIONS, "initiated", "completed"), true);
    // Bank transfer: pending before the deadline, success before the deadline, grace repeats, expiry, late refund.
    for (const [from, to] of [
      ["initiated", "processing_in_grace"],
      ["processing_in_grace", "processing_in_grace"],
      ["initiated", "completed"],
      ["processing_in_grace", "completed"],
      ["initiated", "expired"],
      ["processing_in_grace", "expired"],
      ["initiated", "refunded"],
      ["processing_in_grace", "refunded"],
      ["expired", "refunded"],
    ] as const) {
      assert.equal(canTransition(BANK_TRANSFER_SESSION_TRANSITIONS, from, to), true, `bank ${from} -> ${to}`);
    }
    // Manual transfer: upload, payment deadline, verification deadline, back-office decisions.
    for (const [from, to] of [
      ["awaiting_receipt", "awaiting_verification"],
      ["awaiting_receipt", "expired"],
      ["awaiting_verification", "expired"],
      ["awaiting_verification", "confirmed"],
      ["awaiting_verification", "rejected"],
    ] as const) {
      assert.equal(canTransition(MANUAL_TRANSFER_TRANSITIONS, from, to), true, `manual ${from} -> ${to}`);
    }
    // Live payment attempt: release.
    assert.equal(canTransition(LIVE_PAYMENT_ATTEMPT_TRANSITIONS, "active", "terminal"), true);
  });

  it("AC3: a move the code never makes is not in its table", () => {
    assert.equal(canTransition(CARD_CHECKOUT_SESSION_TRANSITIONS, "completed", "initiated"), false);
    assert.equal(canTransition(CARD_CHECKOUT_SESSION_TRANSITIONS, "failed", "completed"), false);
    assert.equal(canTransition(BANK_TRANSFER_SESSION_TRANSITIONS, "refunded", "completed"), false);
    assert.equal(canTransition(BANK_TRANSFER_SESSION_TRANSITIONS, "expired", "completed"), false);
    assert.equal(canTransition(BANK_TRANSFER_SESSION_TRANSITIONS, "completed", "expired"), false); // issue 17: a paid session never expires
    assert.equal(canTransition(MANUAL_TRANSFER_TRANSITIONS, "awaiting_receipt", "confirmed"), false);
    assert.equal(canTransition(MANUAL_TRANSFER_TRANSITIONS, "expired", "confirmed"), false);
    assert.equal(canTransition(MANUAL_TRANSFER_TRANSITIONS, "rejected", "confirmed"), false);
    assert.equal(canTransition(LIVE_PAYMENT_ATTEMPT_TRANSITIONS, "terminal", "active"), false);
  });
});
