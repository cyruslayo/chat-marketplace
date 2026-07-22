import test from "node:test";
import assert from "node:assert/strict";
import {
  RestrictedPayloadStore,
  LedgerBalanceGuard,
  ExternalEventReconciler,
  RecoveryCommandPayload
} from "../packages/platform-core/src/reconciliation.js";
import { InMemoryAuditLog, createPlatformCommandEnvelope } from "../packages/platform-core/src/index.js";

// ADR 0001, ADR 0002, ADR 0021, ADR 0024, ADR 0045, ADR 0046, ADR 0072, ADR 0079, ADR 0080 & Issue 41

test("Every case preserves original provider payload provenance in a restricted store and exposes only redacted operational facts.", () => {
  const store = new RestrictedPayloadStore();

  const payloadId = store.saveRawPayload(
    "psp_paystack",
    "payment.success",
    { transactionRef: "tx-pay-777", amountKobo: 15000000, providerReference: "pref-8899", status: "success" },
    { "x-paystack-signature": "sig_raw_secret_header" },
    "sig_raw_secret_header"
  );

  // Unauthorized principal fails to read restricted raw payload
  const guestContext = { principalId: "usr-guest-1", tenantId: "tenant-1", sessionId: "sess-1", role: "guest" };
  assert.throws(
    () => store.getRawPayload(payloadId, guestContext),
    /Unauthorized access to restricted payload store/
  );

  // Authorized staff principal reads restricted raw payload
  const staffContext = { principalId: "usr-staff-1", tenantId: "tenant-1", sessionId: "sess-2", role: "authorized_staff" };
  const rawEntry = store.getRawPayload(payloadId, staffContext);
  assert.equal(rawEntry.providerId, "psp_paystack");
  assert.equal(rawEntry.headers?.["x-paystack-signature"], "sig_raw_secret_header");

  // Redacted operational facts expose only non-sensitive facts
  const redactedFacts = store.getRedactedOperationalFacts(payloadId);
  assert.equal(redactedFacts.transactionRef, "tx-pay-777");
  assert.equal(redactedFacts.amountKobo, 15000000);
  assert.equal(redactedFacts.status, "success");
  const stringified = JSON.stringify(redactedFacts);
  assert.equal(stringified.includes("sig_raw_secret_header"), false);
});

test("Recovery commands are authorized, idempotent, expected-version checked, auditable, and balanced in the ledger.", () => {
  const audit = new InMemoryAuditLog();
  const reconciler = new ExternalEventReconciler({ audit });

  // 1. Unauthorized recovery command fails closed
  const unauthorizedEnvelope = createPlatformCommandEnvelope<RecoveryCommandPayload>({
    commandName: "reconcile.late_payment",
    principal: { id: "usr-guest-99", role: "guest" },
    payload: { actionType: "reconcile_late_payment", transactionRef: "tx-100" }
  });
  assert.throws(
    () => reconciler.executeRecoveryCommand(unauthorizedEnvelope),
    /Unauthorized recovery command: caller lacks authorized staff role/
  );

  // 2. Unbalanced ledger entries fail
  const unbalancedEnvelope = createPlatformCommandEnvelope<RecoveryCommandPayload>({
    commandName: "reconcile.late_payment",
    principal: { id: "usr-staff-1", role: "authorized_staff" },
    payload: {
      actionType: "reconcile_late_payment",
      transactionRef: "tx-101",
      ledgerEntries: [
        { accountId: "acc-bank", debitKobo: 50000, creditKobo: 0 },
        { accountId: "acc-revenue", debitKobo: 0, creditKobo: 40000 } // Unbalanced!
      ]
    }
  });
  assert.throws(
    () => reconciler.executeRecoveryCommand(unbalancedEnvelope),
    /Ledger balance violation: total debits must equal total credits/
  );

  // 3. Authorized & balanced recovery command succeeds and is auditable
  const validEnvelope = createPlatformCommandEnvelope<RecoveryCommandPayload>({
    commandName: "reconcile.late_payment",
    principal: { id: "usr-staff-1", role: "authorized_staff" },
    expectedVersion: 1,
    payload: {
      actionType: "reconcile_late_payment",
      transactionRef: "tx-102",
      amountKobo: 50000,
      ledgerEntries: [
        { accountId: "acc-bank", debitKobo: 50000, creditKobo: 0 },
        { accountId: "acc-revenue", debitKobo: 0, creditKobo: 50000 }
      ]
    }
  });

  const res1 = reconciler.executeRecoveryCommand(validEnvelope);
  assert.equal(res1.status, "reconciled");
  assert.equal(res1.isDuplicateReprocessing, false);

  const auditEntries = audit.entries();
  assert.ok(auditEntries.some((e) => e.type === "reconciliation.command_executed"));

  // 4. Version conflict fails
  const staleEnvelope = createPlatformCommandEnvelope<RecoveryCommandPayload>({
    commandName: "reconcile.late_payment",
    principal: { id: "usr-staff-1", role: "authorized_staff" },
    expectedVersion: 1, // Already advanced to version 2!
    payload: { actionType: "reconcile_late_payment", transactionRef: "tx-102" }
  });
  assert.throws(
    () => reconciler.executeRecoveryCommand(staleEnvelope),
    /Version conflict: expected version 1 but found 2/
  );

  // 5. Idempotent reprocessing with same idempotency key returns identical cached result
  const res2 = reconciler.executeRecoveryCommand(validEnvelope);
  assert.equal(res2.status, "reconciled");

  // 6. Reprocessing with a new command envelope for already-reconciled entity detects duplicate
  const reprocessEnvelope = createPlatformCommandEnvelope<RecoveryCommandPayload>({
    commandName: "reconcile.late_payment",
    principal: { id: "usr-staff-1", role: "authorized_staff" },
    expectedVersion: 2,
    payload: { actionType: "reconcile_late_payment", transactionRef: "tx-102" }
  });
  const res3 = reconciler.executeRecoveryCommand(reprocessEnvelope);
  assert.equal(res3.isDuplicateReprocessing, true);
});

test("Reprocessing cannot form duplicate Reservations, refunds, releases, claims, or fund movements.", () => {
  const reconciler = new ExternalEventReconciler();

  // Late payment refund reprocessing
  const refund1 = reconciler.reconcileLatePayment({ transactionRef: "tx-late-1", amountKobo: 10000, providerReference: "pref-1" });
  assert.equal(refund1.isDuplicate, false);
  assert.equal(refund1.entityType, "Refund");

  const refund2 = reconciler.reconcileLatePayment({ transactionRef: "tx-late-1", amountKobo: 10000, providerReference: "pref-1" });
  assert.equal(refund2.isDuplicate, true);
  assert.equal(refund2.refundId, refund1.refundId);

  // Callback duplicate reservation reprocessing
  const resv1 = reconciler.reconcileDuplicateCallback({ eventId: "evt-cb-1", transactionRef: "tx-dup-cb", providerReference: "pref-2" });
  assert.equal(resv1.isDuplicate, false);
  assert.equal(resv1.entityType, "Reservation");

  const resv2 = reconciler.reconcileDuplicateCallback({ eventId: "evt-cb-1", transactionRef: "tx-dup-cb", providerReference: "pref-2" });
  assert.equal(resv2.isDuplicate, true);
  assert.equal(resv2.reservationId, resv1.reservationId);

  // Refund drift reprocessing
  const drift1 = reconciler.reconcileRefundDrift({ reservationId: "bk-999", refundAmountKobo: 5000, transactionRef: "tx-drift-1" });
  assert.equal(drift1.isDuplicate, false);
  const drift2 = reconciler.reconcileRefundDrift({ reservationId: "bk-999", refundAmountKobo: 5000, transactionRef: "tx-drift-1" });
  assert.equal(drift2.isDuplicate, true);

  // Revenue release reprocessing
  const release1 = reconciler.reconcileRevenueRelease({ reservationId: "bk-888", operatorNetKobo: 45000, transactionRef: "tx-rel-1" });
  assert.equal(release1.isDuplicate, false);
  const release2 = reconciler.reconcileRevenueRelease({ reservationId: "bk-888", operatorNetKobo: 45000, transactionRef: "tx-rel-1" });
  assert.equal(release2.isDuplicate, true);

  // Deposit claim reprocessing
  const claim1 = reconciler.reconcileDepositClaim({ claimId: "clm-777", claimAmountKobo: 20000, transactionRef: "tx-clm-1" });
  assert.equal(claim1.isDuplicate, false);
  const claim2 = reconciler.reconcileDepositClaim({ claimId: "clm-777", claimAmountKobo: 20000, transactionRef: "tx-clm-1" });
  assert.equal(claim2.isDuplicate, true);
});

test("Staff and guest/Operator projections update from the committed correction and clearly distinguish pending provider completion.", () => {
  const reconciler = new ExternalEventReconciler();

  reconciler.reconcileLatePayment({ transactionRef: "tx-pending-psp", amountKobo: 2500000, providerReference: "pref-psp-pending" });

  // Pending provider completion is explicitly distinguished
  const staffPendingProjection = reconciler.getReconciledProjection("tx-pending-psp", "staff", { isPendingProviderCompletion: true });
  assert.equal(staffPendingProjection.status, "reconciled");
  assert.equal(staffPendingProjection.providerCompletionStatus, "pending_provider_completion");
  assert.equal(staffPendingProjection.viewerRole, "staff");

  const guestPendingProjection = reconciler.getReconciledProjection("tx-pending-psp", "guest", { isPendingProviderCompletion: true });
  assert.equal(guestPendingProjection.status, "reconciled");
  assert.equal(guestPendingProjection.providerCompletionStatus, "pending_provider_completion");
  assert.equal(guestPendingProjection.viewerRole, "guest");

  // Fully completed provider status
  const staffCompletedProjection = reconciler.getReconciledProjection("tx-pending-psp", "staff", { isPendingProviderCompletion: false });
  assert.equal(staffCompletedProjection.providerCompletionStatus, "completed");
});
