import test from "node:test";
import assert from "node:assert/strict";
import {
  ProviderCapabilityCertifier,
  CapabilityCertificationRecord,
  BankReferenceExpiryProof,
  FailureSimulationRequest
} from "../packages/platform-core/src/provider-certification.js";
import { InMemoryAuditLog } from "../packages/platform-core/src/index.js";

test("Named provider, environment, configuration, evidence, observed behaviour, exceptions, owner, and expiry are recorded per capability.", () => {
  const audit = new InMemoryAuditLog();
  const certifier = new ProviderCapabilityCertifier({ audit });

  const validRecord: CapabilityCertificationRecord = {
    providerId: "psp_paystack",
    capability: "payment",
    environment: "production-equivalent",
    configuration: { storeCheckoutId: "chk_live_01", currency: "NGN" },
    evidence: ["EVID-PAYSTACK-CERT-01", "HASH-SETTLEMENT-PROOF"],
    observedBehaviour: "Store checkout returns valid payment token; 20+10m reservation enforced",
    exceptions: ["USSD channel explicitly excluded"],
    owner: "Lead Infrastructure Engineer",
    expiryDate: "2027-07-22T00:00:00.000Z"
  };

  const cert = certifier.recordCapabilityCertification(validRecord);
  assert.equal(cert.providerId, "psp_paystack");
  assert.equal(cert.capability, "payment");
  assert.equal(cert.environment, "production-equivalent");
  assert.equal(cert.owner, "Lead Infrastructure Engineer");

  const status = certifier.getCertificationStatus("psp_paystack", "payment");
  assert.ok(status);
  assert.equal(status?.observedBehaviour, validRecord.observedBehaviour);

  // Failure path: missing required fields
  assert.throws(
    () =>
      certifier.recordCapabilityCertification({
        ...validRecord,
        evidence: []
      }),
    /Certification record must contain evidence/
  );

  assert.throws(
    () =>
      certifier.recordCapabilityCertification({
        ...validRecord,
        owner: ""
      }),
    /Certification record requires owner, observedBehaviour, and expiryDate/
  );
});

test("Bank references demonstrably become non-payable at the required deadline; documentation or ordinary sandbox success alone is insufficient.", () => {
  const certifier = new ProviderCapabilityCertifier();

  // 1. Sandbox only claim without deadline proof fails
  const sandboxOnlyProof: BankReferenceExpiryProof = {
    referenceId: "ref-bank-1001",
    deadlineIso: "2026-07-22T14:30:00.000Z",
    sandboxOnlySuccess: true,
    simulatedPaymentTimeIso: "2026-07-22T14:35:00.000Z"
  };

  assert.throws(
    () => certifier.certifyBankReferenceExpiry(sandboxOnlyProof),
    /Sandbox success alone is insufficient: deadline enforcement proof required/
  );

  // 2. Payment attempt after deadline returns non-payable
  const postDeadlineProof: BankReferenceExpiryProof = {
    referenceId: "ref-bank-1002",
    deadlineIso: "2026-07-22T14:30:00.000Z",
    sandboxOnlySuccess: false,
    simulatedPaymentTimeIso: "2026-07-22T14:31:00.000Z"
  };

  const result = certifier.certifyBankReferenceExpiry(postDeadlineProof);
  assert.equal(result.isPayable, false);
  assert.equal(result.reason, "Bank reference expired at deadline");

  // 3. Payment attempt before deadline is payable
  const preDeadlineProof: BankReferenceExpiryProof = {
    referenceId: "ref-bank-1003",
    deadlineIso: "2026-07-22T14:30:00.000Z",
    sandboxOnlySuccess: false,
    simulatedPaymentTimeIso: "2026-07-22T14:25:00.000Z"
  };

  const validResult = certifier.certifyBankReferenceExpiry(preDeadlineProof);
  assert.equal(validResult.isPayable, true);
});

test("Payment, identity, and channel failure simulations produce the platform's required authoritative and recovery outcomes.", () => {
  const audit = new InMemoryAuditLog();
  const certifier = new ProviderCapabilityCertifier({ audit });

  // Payment late success failure simulation
  const paySim: FailureSimulationRequest = {
    capability: "payment",
    failureType: "late_success"
  };
  const payRes = certifier.simulateFailure(paySim);
  assert.equal(payRes.authoritativeOutcome, "refunded");
  assert.match(payRes.recoveryOutcome, /Late payment refunded under ADR 0045/);

  // Identity ambiguous outcome simulation
  const idSim: FailureSimulationRequest = {
    capability: "identity",
    failureType: "ambiguous_identity"
  };
  const idRes = certifier.simulateFailure(idSim);
  assert.equal(idRes.authoritativeOutcome, "unverified");
  assert.match(idRes.recoveryOutcome, /Escalated to Human Risk Review under ADR 0051/);

  // Messaging delivery callback failure simulation
  const msgSim: FailureSimulationRequest = {
    capability: "messaging",
    failureType: "delivery_callback_failure"
  };
  const msgRes = certifier.simulateFailure(msgSim);
  assert.equal(msgRes.authoritativeOutcome, "undelivered");
  assert.match(msgRes.recoveryOutcome, /Fallback channel routing or human handoff under ADR 0067/);

  const auditEntries = audit.entries();
  assert.ok(auditEntries.some((e) => e.type === "provider.failure_simulated"));
});

test("Production-equivalent certification is eligible immediately before expiry and disabled at expiry.", () => {
  const certifier = new ProviderCapabilityCertifier();
  certifier.recordCapabilityCertification({ providerId: "psp_paystack", capability: "ussd", environment: "production-equivalent", configuration: {}, evidence: ["EVID-USSD"], observedBehaviour: "Certified lifecycle", exceptions: [], owner: "Launch owner", expiryDate: "2026-08-01T12:00:00.000Z" });
  assert.equal(certifier.isCapabilityEnabled("ussd", "psp_paystack", new Date("2026-08-01T11:59:59.999Z")), true);
  assert.equal(certifier.isCapabilityEnabled("ussd", "psp_paystack", new Date("2026-08-01T12:00:00.000Z")), false);
});

test("Unsupported capabilities remain disabled and any accepted limitation is reflected in the capability matrix and launch policy.", () => {
  const certifier = new ProviderCapabilityCertifier();

  // USSD payment is uncertified and remains disabled
  assert.equal(certifier.isCapabilityEnabled("ussd", "psp_paystack"), false);

  certifier.registerCapabilityLimitation({
    capability: "ussd",
    providerId: "psp_paystack",
    acceptedLimitation: "USSD channel not certified for launch under ADR 0048"
  });

  const matrix = certifier.getCapabilityMatrix();
  const ussdItem = matrix.find((m) => m.capability === "ussd");
  assert.ok(ussdItem);
  assert.equal(ussdItem?.enabled, false);
  assert.equal(ussdItem?.certificationStatus, "disabled");
  assert.equal(ussdItem?.acceptedLimitation, "USSD channel not certified for launch under ADR 0048");

  // Attempting to execute uncertified capability throws fail-closed error
  assert.throws(
    () => certifier.executeCapability("ussd", "psp_paystack", () => "should not run"),
    /Capability 'ussd' for provider 'psp_paystack' is disabled/
  );
});
