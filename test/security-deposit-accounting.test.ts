import test from "node:test";
import assert from "node:assert/strict";
import { calculateSecurityDepositPolicySnapshot, SECURITY_DEPOSIT_POLICY_VERSION, assertSecurityDepositCollectionAvailable } from "../domains/shortlet/src/index.js";
import { InMemorySecurityDepositAccountingRepository } from "../domains/shortlet/src/index.js";
import { createSecurityDepositCancellationRefundAdapter } from "../apps/web/src/security-deposit-cancellation-adapter.js";

test("Issue 25 production snapshot and accounting are fail-closed, separate, and balanced", () => {
  const snapshot = calculateSecurityDepositPolicySnapshot({ accommodationSubtotalKobo: 100_000_000, bedrooms: 3, configuredDepositKobo: 25_000_000 });
  assert.equal(snapshot.policyVersion, SECURITY_DEPOSIT_POLICY_VERSION);
  assert.equal(snapshot.amountKobo, 25_000_000);
  assert.throws(() => calculateSecurityDepositPolicySnapshot({ accommodationSubtotalKobo: 100, bedrooms: 1.5, configuredDepositKobo: 1 }));
  const repo = new InMemorySecurityDepositAccountingRepository();
  const created = repo.createOrGet({ offerId: "offer-25", snapshot, paymentMethod: "fresh_card", capabilityVersion: "cap-1" });
  const collected = repo.recordCollection(created.collectionId, { providerReference: "provider-ref-25", collectedAt: "2026-08-01T12:00:00.000Z" });
  const held = repo.bind(created.collectionId, { reservationId: "reservation-25", contractId: "contract-25" });
  assert.equal(held.status, "held");
  assert.equal(repo.journals()[0].lines[0].account, "security_deposit_payment_clearing");
  assert.equal(repo.journals()[0].lines[1].account, "refundable_security_deposit_liability");
  assert.equal(collected.collectionId, held.collectionId);
  const refunded = repo.refund(created.collectionId, { refundedAt: "2026-08-02T12:00:00.000Z", refundSucceeded: true });
  assert.equal(refunded.status, "refunded");
  assert.equal(repo.getByReservationId("reservation-25")?.refundableBalanceKobo, 0);
});

test("Issue 25 cancellation adapter refunds the bound deposit source separately", () => {
  const repo = new InMemorySecurityDepositAccountingRepository(); const snapshot = calculateSecurityDepositPolicySnapshot({ accommodationSubtotalKobo: 40_000_000, bedrooms: 1, configuredDepositKobo: 4_000_000 }); const created = repo.createOrGet({ offerId: "offer-cancel-25", snapshot, paymentMethod: "fresh_card" }); repo.recordCollection(created.collectionId, { providerReference: "successful-deposit-ref", collectedAt: "2026-08-01T00:00:00Z" }); repo.bind(created.collectionId, { reservationId: "reservation-cancel-25", contractId: "contract-cancel-25" }); let source = ""; const adapter = createSecurityDepositCancellationRefundAdapter({ accounting: repo, refunds: { refundOrGet: (input) => { source = input.originalPaymentReference; return { refundId: "deposit-refund-25", status: "settled", amountKobo: input.amountKobo, currency: "NGN" }; } }, clock: () => new Date("2026-08-02T00:00:00Z") }); const result = adapter.initiateOrGetRefund({ cancellationId: "cancellation:reservation-cancel-25", reservationId: "reservation-cancel-25", collectionId: created.collectionId, amountKobo: snapshot.amountKobo, currency: "NGN" }); assert.equal(source, "successful-deposit-ref"); assert.equal(result.status, "settled"); assert.equal(repo.getByReservationId("reservation-cancel-25")?.refundableBalanceKobo, 0); assert.equal(repo.journals().length, 2);
});

test("Issue 25 collection capability fails closed and requires both approvals", () => {
  const provider = { getCapability: () => ({ capabilityVersion: "cap-1", enabled: true, pspProviderId: "psp", pspApproved: true, counselApproved: true, collectionModel: "separate_actual_charge" as const, paymentMethod: "fresh_card" as const }) };
  assert.equal(assertSecurityDepositCollectionAvailable(provider, "fresh_card").capabilityVersion, "cap-1");
  assert.throws(() => assertSecurityDepositCollectionAvailable({ getCapability: () => ({ ...provider.getCapability(), counselApproved: false }) }, "fresh_card"), /unavailable/);
});
