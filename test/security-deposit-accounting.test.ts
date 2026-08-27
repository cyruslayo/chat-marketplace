import test from "node:test";
import assert from "node:assert/strict";
import { calculateSecurityDepositPolicySnapshot, SECURITY_DEPOSIT_POLICY_VERSION, assertSecurityDepositCollectionAvailable } from "../domains/shortlet/src/index.js";
import { InMemorySecurityDepositAccountingRepository } from "../domains/shortlet/src/index.js";

test("Issue 25 production snapshot and accounting are fail-closed, separate, and balanced", () => {
  const snapshot = calculateSecurityDepositPolicySnapshot({ accommodationSubtotalKobo: 100_000_000, bedrooms: 3, configuredDepositKobo: 25_000_000 });
  assert.equal(snapshot.policyVersion, SECURITY_DEPOSIT_POLICY_VERSION);
  assert.equal(snapshot.amountKobo, 25_000_000);
  assert.throws(() => calculateSecurityDepositPolicySnapshot({ accommodationSubtotalKobo: 100, bedrooms: 1.5, configuredDepositKobo: 1 }));
  const repo = new InMemorySecurityDepositAccountingRepository();
  const created = repo.createOrGet({ offerId: "offer-25", snapshot, paymentMethod: "fresh_card", providerReference: "deposit-provider-ref", capabilityVersion: "cap-1" });
  const collected = repo.recordCollection(created.collectionId, "2026-08-01T12:00:00.000Z");
  const held = repo.bind(created.collectionId, { reservationId: "reservation-25", contractId: "contract-25" });
  assert.equal(held.status, "held");
  assert.equal(repo.journals()[0].lines[0].account, "security_deposit_payment_clearing");
  assert.equal(repo.journals()[0].lines[1].account, "refundable_security_deposit_liability");
  assert.equal(collected.collectionId, held.collectionId);
  const refunded = repo.refund(created.collectionId, { refundedAt: "2026-08-02T12:00:00.000Z", refundSucceeded: true });
  assert.equal(refunded.status, "refunded");
  assert.equal(repo.getByReservationId("reservation-25")?.refundableBalanceKobo, 0);
});

test("Issue 25 collection capability fails closed and requires both approvals", () => {
  const provider = { getCapability: () => ({ capabilityVersion: "cap-1", enabled: true, pspProviderId: "psp", pspApproved: true, counselApproved: true, collectionModel: "separate_actual_charge" as const, paymentMethod: "fresh_card" as const }) };
  assert.equal(assertSecurityDepositCollectionAvailable(provider, "fresh_card").capabilityVersion, "cap-1");
  assert.throws(() => assertSecurityDepositCollectionAvailable({ getCapability: () => ({ ...provider.getCapability(), counselApproved: false }) }, "fresh_card"), /unavailable/);
});
