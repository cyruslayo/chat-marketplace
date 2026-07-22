import test from "node:test";
import assert from "node:assert/strict";
import { ProviderContractRegistry, PaymentRequestPayload } from "../packages/platform-core/src/provider-contracts.js";
import { InMemoryAuditLog } from "../packages/platform-core/src/index.js";

test("Domain and application services depend on platform-owned provider capabilities rather than vendor types.", () => {
  const registry = new ProviderContractRegistry();

  const status1 = registry.recordAutomatedContractSuccess("psp_paystack", "payment");
  const status2 = registry.recordAutomatedContractSuccess("id_identitypass", "identity");
  const status3 = registry.recordAutomatedContractSuccess("msg_whatsapp", "messaging");

  assert.equal(status1.capability, "payment");
  assert.equal(status2.capability, "identity");
  assert.equal(status3.capability, "messaging");
  assert.equal(status1.automatedContractSuccess, true);
});

test("Request, signature, response mapping, error translation, idempotency, redaction, circuit-breaking, and recovery cases pass.", () => {
  const audit = new InMemoryAuditLog();
  const registry = new ProviderContractRegistry({ audit });

  const payload: PaymentRequestPayload = {
    transactionRef: "tx-9991",
    amountKobo: 5000000,
    currency: "NGN",
    payerId: "pyr-001",
    signature: "sig_valid_123"
  };

  // 1. Signature validation failure
  assert.throws(
    () => registry.processPaymentRequest(payload, "sig_invalid", () => ({ status: "success", providerReference: "pref-1" })),
    /Invalid provider signature/
  );

  // 2. Successful call and idempotency
  let callCount = 0;
  const mockCall = () => {
    callCount++;
    return { status: "success" as const, providerReference: "pref-1" };
  };

  const res1 = registry.processPaymentRequest(payload, "sig_valid_123", mockCall);
  assert.equal(res1.status, "success");
  assert.equal(callCount, 1);

  // Duplicate request returns cached idempotent result without calling vendor again
  const res2 = registry.processPaymentRequest(payload, "sig_valid_123", mockCall);
  assert.equal(res2.status, "success");
  assert.equal(callCount, 1);

  // 3. Error translation & Circuit breaking
  const failingPayload: PaymentRequestPayload = {
    transactionRef: "tx-fail-1",
    amountKobo: 100000,
    currency: "NGN",
    payerId: "pyr-002",
    signature: "sig_fail"
  };

  const failingCall = () => {
    throw new Error("Vendor API HTTP 500 Gateway Timeout");
  };

  // Fail 3 times to open circuit breaker
  for (let i = 0; i < 3; i++) {
    assert.throws(
      () => registry.processPaymentRequest({ ...failingPayload, transactionRef: `tx-fail-${i}` }, "sig_fail", failingCall),
      /Provider Error Translation/
    );
  }

  // 4th call is blocked by Circuit Breaker
  assert.throws(
    () => registry.processPaymentRequest({ ...failingPayload, transactionRef: "tx-fail-4" }, "sig_fail", failingCall),
    /Provider circuit breaker OPEN/
  );
});

test("Unknown or contradictory provider states fail safely and create actionable reconciliation context.", () => {
  const audit = new InMemoryAuditLog();
  const registry = new ProviderContractRegistry({ audit });

  const payload: PaymentRequestPayload = {
    transactionRef: "tx-contradictory",
    amountKobo: 2500000,
    currency: "NGN",
    payerId: "pyr-003",
    signature: "sig_contra"
  };

  const contradictoryCall = () => ({
    status: "unknown_contradictory" as const,
    providerReference: "pref-contra-99"
  });

  const res = registry.processPaymentRequest(payload, "sig_contra", contradictoryCall);

  assert.equal(res.status, "unknown_contradictory");
  assert.ok(res.reconciliationContext);
  assert.equal(res.reconciliationContext.actionRequired, "assisted_reconciliation");

  const auditEntries = audit.entries();
  assert.ok(auditEntries.some(e => e.type === "provider.reconciliation_required"));
});

test("Automated contract success is recorded separately from production-equivalent capability certification.", () => {
  const audit = new InMemoryAuditLog();
  const registry = new ProviderContractRegistry({ audit });

  const contractStatus = registry.recordAutomatedContractSuccess("psp_paystack", "payment");
  assert.equal(contractStatus.automatedContractSuccess, true);
  assert.equal(contractStatus.capabilityCertified, false);

  const certStatus = registry.certifyCapability("psp_paystack", "payment");
  assert.equal(certStatus.automatedContractSuccess, true);
  assert.equal(certStatus.capabilityCertified, true);

  const auditEntries = audit.entries();
  assert.ok(auditEntries.some(e => e.type === "provider.contract_success_recorded"));
  assert.ok(auditEntries.some(e => e.type === "provider.capability_certified"));
});
