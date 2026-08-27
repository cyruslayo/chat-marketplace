import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryDepositClaimRepository } from "../domains/shortlet/src/deposit-claim.js";

test("Issue 26 production claim cases have one stable versioned identity and no Issue 27 actions", () => {
  const repository = new InMemoryDepositClaimRepository();
  const record = { claimId: "deposit-claim:r26", reservationId: "r26", contractId: "c26", tenantId: "t26", operatorId: "op26", guestId: "g26", policyVersion: "deposit-policy/v1", evidenceVersion: "evidence/v1", depositAmountKobo: 20_000_000, claimedAmountKobo: 5_000_000, effectiveCheckoutIso: "2026-09-02T10:00:00.000Z", claimDeadlineIso: "2026-09-03T10:00:00.000Z", submittedAtIso: "2026-09-03T10:00:00.000Z", claimVersion: 1, status: "validated_notification_pending" as const, items: [], notification: { status: "pending" as const, notificationVersion: "0", deliveredAtIso: null, evidenceId: null }, responseWindowStartIso: null, responseWindowEndIso: null, guestResponse: null, initialReservedOperatorAwardKobo: 0, approvedOperatorAwardKobo: null, unapprovedRefundKobo: 0, history: [] };
  assert.equal(repository.createIfAbsent(record), record);
  assert.equal(repository.createIfAbsent(record), record);
  assert.equal(repository.findByReservationId("r26")?.claimVersion, 1);
  assert.equal("fileClaimAppeal" in record, false);
  assert.equal("processPayout" in record, false);
});

test("Issue 26 response state is not inferred from silence or notification creation", () => {
  const repository = new InMemoryDepositClaimRepository();
  assert.equal(repository.findByClaimId("deposit-claim:missing"), null);
});
