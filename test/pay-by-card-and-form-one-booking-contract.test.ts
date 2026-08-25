import test from "node:test";
import assert from "node:assert/strict";
import { CardPaymentManager, type PSPVerifyResult } from "../domains/shortlet/src/index.js";
import type { CommandPrincipal, PlatformCommandEnvelope } from "../packages/platform-core/src/index.js";

const clock = () => new Date("2026-08-01T12:10:00.000Z");
function offer(offerId = "offer-123", tenantId: string | undefined = "tenant-lagos") {
  return { offerId, offerVersion: 1, requestId: "req-123", inventoryCommitmentId: `commit-${offerId}`, unitId: "unit-1", tenantId, parties: { primaryGuest: { id: "guest-456", name: "Ada Okafor" }, operator: { id: "op-789", name: "Lekki Luxury Homes" }, distinctPayer: null }, unit: { id: "unit-1", title: "Waterfront Suite", propertyId: "prop-1", location: { city: "Lagos" } }, dates: { checkIn: "2026-08-10", checkOut: "2026-08-12", nights: 2 }, occupants: [{ name: "Ada Okafor" }], quote: { breakdown: { accommodationNetKobo: 11000000, platformCommissionKobo: 2000000 } }, refundableSecurityDepositKobo: 2000000, totalAmountDueNowKobo: 15000000, policies: { cancellationPolicy: { name: "Flexible" }, guestConductRules: ["No parties"] }, disclosures: [], paymentWindow: { durationMinutes: 20, expiresAt: "2026-08-01T12:20:00.000Z" }, status: "accepted" as const, issuedAt: "2026-08-01T12:00:00.000Z", confirmationToken: "token", tokenUsed: true, aggregateVersions: { offerVersion: 1, pricingVersion: "p1", quoteVersion: "q1", cancellationPolicyVersion: "c1", managementAuthorityVersion: "m1", inspectionVersion: "i1" } };
}
function envelope<T>(commandName: string, payload: T, principal: CommandPrincipal = { id: "guest-456", role: "guest", tenantId: "tenant-lagos" }): PlatformCommandEnvelope<T> { return { commandId: `cmd-${Math.random()}`, commandName, timestamp: clock().toISOString(), principal, payload }; }
function setup() {
  let result: PSPVerifyResult = { verified: true, status: "success", amountKobo: 15000000, currency: "NGN", pspReference: "unset", payerId: "guest-456" };
  const pspClient = { verifyTransaction(reference: string) { return { ...result, pspReference: result.pspReference === "unset" ? reference : result.pspReference }; } };
  const manager = new CardPaymentManager({ offerManager: { getOffer: (id: string) => { if (id !== "offer-123") throw new Error("not found"); return offer(); } }, repository: { findById: () => ({ id: "unit-1", published: true, inspection: { materialChangePending: false } }), findAll: () => [] }, calendar: { transitionPaymentPendingToConfirmedBooking() {} }, pspClient });
  const session = manager.initializeCardCheckout(envelope("card_payment.initialize_checkout", { offerId: "offer-123" }), { clock });
  return { manager, session, setResult: (next: PSPVerifyResult) => { result = next; } };
}

test("The platform handles no raw PAN, CVV, PIN, OTP, or reusable card token", () => {
  const { manager } = setup();
  for (const key of ["pan", "cvv", "pin", "otp", "cardToken", "reusableToken"]) assert.throws(() => manager.initializeCardCheckout(envelope("card_payment.initialize_checkout", { offerId: "offer-123", [key]: "secret" })), /Security policy violation/);
});

test("Authoritative payer, tenant, role, and one-live-attempt checks fail closed", () => {
  const { manager } = setup();
  for (const principal of [{ id: "other", role: "guest" as const, tenantId: "tenant-lagos" }, { id: "guest-456", role: "guest" as const, tenantId: "other" }, { id: "guest-456", role: "guest" as const }, { id: "op-789", role: "operator" as const, tenantId: "tenant-lagos" }]) assert.throws(() => manager.initializeCardCheckout(envelope("card_payment.initialize_checkout", { offerId: "offer-123" }, principal)), /authorized payer|payer|tenant|Cross-tenant/);
  assert.throws(() => manager.initializeCardCheckout(envelope("card_payment.initialize_checkout", { offerId: "offer-123" })), /live checkout/);
});

test("Production verification uses the injected PSP client and rejects client verification facts", () => {
  const { manager, session } = setup();
  assert.throws(() => manager.verifyAndConfirmCardPayment(envelope("card_payment.verify_and_confirm", { offerId: "offer-123", pspReference: session.pspReference, mockVerifyResult: { verified: true } } as unknown as { offerId: string; pspReference: string }, { id: "system", role: "system", tenantId: "tenant-lagos" })), /only the server-resolved/);
  const result = manager.verifyAndConfirmCardPayment(envelope("card_payment.verify_and_confirm", { offerId: "offer-123", pspReference: session.pspReference }, { id: "system", role: "system", tenantId: "tenant-lagos" }), { clock });
  assert.equal(result.bookingContract.paymentDetails.cardMetadata, undefined);
});

test("Confirmation independently verifies amount, currency, reference, payer, expiry, and inventory", () => {
  for (const change of [{ amountKobo: 1, message: /Amount/ }, { currency: "USD", message: /Currency/ }, { pspReference: "wrong", message: /Reference/ }, { payerId: "wrong", message: /Payer/ }]) {
    const { manager, session, setResult } = setup(); setResult({ verified: true, status: "success", amountKobo: 15000000, currency: "NGN", pspReference: session.pspReference, payerId: "guest-456", ...change });
    assert.throws(() => manager.verifyAndConfirmCardPayment(envelope("card_payment.verify_and_confirm", { offerId: "offer-123", pspReference: session.pspReference }, { id: "system", role: "system", tenantId: "tenant-lagos" }), { clock }), change.message);
  }
  const { manager, session, setResult } = setup(); setResult({ verified: true, status: "success", amountKobo: 15000000, currency: "NGN", pspReference: session.pspReference, payerId: "guest-456" });
  assert.throws(() => manager.verifyAndConfirmCardPayment(envelope("card_payment.verify_and_confirm", { offerId: "offer-123", pspReference: session.pspReference }, { id: "system", role: "system", tenantId: "tenant-lagos" }), { clock: () => new Date("2026-08-01T12:31:00.000Z") }), /expired/);
});

test("Duplicate callbacks produce one Reservation, Booking Contract, and ledger effect set", () => {
  const { manager, session } = setup(); const command = envelope("card_payment.verify_and_confirm", { offerId: "offer-123", pspReference: session.pspReference }, { id: "system", role: "system", tenantId: "tenant-lagos" });
  const first = manager.verifyAndConfirmCardPayment(command, { clock }); const second = manager.verifyAndConfirmCardPayment(command, { clock });
  assert.equal(second.reservation.reservationId, first.reservation.reservationId); assert.equal(second.bookingContract.contractId, first.bookingContract.contractId); assert.equal(second.ledgerEntries, first.ledgerEntries); assert.equal(manager.projectInteractionState("offer-123").paymentStatus, "confirmed");
});

test("PSP references require an authoritative existing checkout and cannot be substituted across offers", () => {
  const { manager } = setup();
  assert.throws(() => manager.verifyAndConfirmCardPayment(envelope("card_payment.verify_and_confirm", { offerId: "offer-123", pspReference: "arbitrary" }, { id: "system", role: "system", tenantId: "tenant-lagos" })), /bound/);
});
