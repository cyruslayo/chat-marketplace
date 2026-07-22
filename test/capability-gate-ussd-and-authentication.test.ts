import test from "node:test";
import assert from "node:assert/strict";
import { PaymentCapabilityManager } from "../domains/shortlet/src/index.js";
import { PlatformCommandEnvelope } from "../packages/platform-core/src/index.js";

function createEnvelope<T>(
  commandName: string,
  payload: T,
  actorId = "admin-123",
  tenantId = "tenant-lagos"
): PlatformCommandEnvelope<T> {
  return {
    commandId: `cmd-${Math.random().toString(36).slice(2)}`,
    commandName,
    timestamp: "2026-08-01T12:00:00.000Z",
    principal: {
      id: actorId,
      role: "admin",
      tenantId
    },
    payload
  };
}

test("An uncertified, expired, or suspended payment capability is absent from all channels", () => {
  const manager = new PaymentCapabilityManager({
    certifications: [
      {
        capabilityId: "gtbank_ussd",
        providerId: "gtbank",
        channel: "ussd",
        version: 1,
        status: "uncertified",
        certifiedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2027-01-01T00:00:00.000Z",
        auditTrail: [{ action: "registered", timestamp: "2026-01-01T00:00:00.000Z", updatedBy: "sys" }]
      },
      {
        capabilityId: "zenith_ussd",
        providerId: "zenith",
        channel: "ussd",
        version: 1,
        status: "expired",
        certifiedAt: "2025-01-01T00:00:00.000Z",
        expiresAt: "2026-06-01T00:00:00.000Z",
        auditTrail: [{ action: "registered", timestamp: "2025-01-01T00:00:00.000Z", updatedBy: "sys" }]
      },
      {
        capabilityId: "firstbank_ussd",
        providerId: "firstbank",
        channel: "ussd",
        version: 1,
        status: "suspended",
        certifiedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2027-01-01T00:00:00.000Z",
        auditTrail: [{ action: "registered", timestamp: "2026-01-01T00:00:00.000Z", updatedBy: "sys" }]
      },
      {
        capabilityId: "card_mastercard",
        providerId: "paystack",
        channel: "card",
        version: 1,
        status: "certified",
        certifiedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2027-01-01T00:00:00.000Z",
        auditTrail: [{ action: "registered", timestamp: "2026-01-01T00:00:00.000Z", updatedBy: "sys" }]
      }
    ]
  });

  const clock = () => new Date("2026-08-01T12:00:00.000Z");
  const available = manager.getAvailablePaymentCapabilities("web", clock);

  assert.equal(available.length, 1);
  assert.equal(available[0].capabilityId, "card_mastercard");

  // Verify none of the uncertified, expired, or suspended capabilities are returned
  const capabilityIds = available.map((c) => c.capabilityId);
  assert.equal(capabilityIds.includes("gtbank_ussd"), false);
  assert.equal(capabilityIds.includes("zenith_ussd"), false);
  assert.equal(capabilityIds.includes("firstbank_ussd"), false);
});

test("Certification status is authoritative, versioned, auditable, and checked again before initialization", () => {
  const auditLogs: Record<string, unknown>[] = [];
  const manager = new PaymentCapabilityManager({
    certifications: [
      {
        capabilityId: "gtbank_ussd",
        providerId: "gtbank",
        channel: "ussd",
        version: 1,
        status: "certified",
        certifiedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2027-01-01T00:00:00.000Z",
        auditTrail: [{ action: "registered", timestamp: "2026-01-01T00:00:00.000Z", updatedBy: "sys" }]
      }
    ],
    audit: {
      record(entry) {
        auditLogs.push(entry);
      }
    }
  });

  const clock = () => new Date("2026-08-01T12:00:00.000Z");

  // Attempting to initialize uncertified capability throws error
  const uncertifiedEnv = createEnvelope("payment_capability.initialize_ussd", {
    capabilityId: "unknown_ussd",
    offerId: "offer-123",
    amountKobo: 5000000
  });
  assert.throws(
    () => manager.initializeUssdSession(uncertifiedEnv, clock),
    /Payment capability 'unknown_ussd' is not certified, active, or available/
  );

  // Suspend gtbank_ussd via versioned auditable command
  const suspendEnv = createEnvelope("payment_capability.update_certification", {
    capabilityId: "gtbank_ussd",
    status: "suspended" as const,
    reason: "Security audit hold"
  });
  const updatedCert = manager.updateCertificationStatus(suspendEnv, clock);
  assert.equal(updatedCert.status, "suspended");
  assert.equal(updatedCert.version, 2);

  // Checking again right before initialization must throw error because status is now suspended
  const initEnv = createEnvelope("payment_capability.initialize_ussd", {
    capabilityId: "gtbank_ussd",
    offerId: "offer-123",
    amountKobo: 5000000
  });
  assert.throws(
    () => manager.initializeUssdSession(initEnv, clock),
    /Payment capability 'gtbank_ussd' is not certified, active, or available/
  );

  // Audit trail verification
  assert.ok(auditLogs.some((l) => l.type === "payment_capability.status_updated"));
});

test("Card authentication outcomes map safely without exposing restricted data or bypassing booking verification", () => {
  const manager = new PaymentCapabilityManager({});

  // Success path: safe mapping of frictionless / step-up auth outcomes
  const safeOutcomeEnv = createEnvelope("payment_capability.map_card_auth_outcome", {
    outcome: {
      outcomeId: "out-123",
      pspReference: "psp-ref-99",
      authType: "challenged_step_up" as const,
      verified: true,
      riskScore: 12,
      redactedMetadata: { brand: "Visa", last4: "4242", issuerCountry: "NG" }
    }
  });

  const mapped = manager.mapCardAuthenticationOutcome(safeOutcomeEnv);
  assert.equal(mapped.outcomeId, "out-123");
  assert.equal(mapped.authType, "challenged_step_up");
  assert.equal(mapped.verified, true);

  // Security failure path: payload containing raw card data (pan, cvv, pin, otp) MUST throw
  const badOutcomeEnv = createEnvelope("payment_capability.map_card_auth_outcome", {
    outcome: {
      outcomeId: "out-bad",
      pspReference: "psp-ref-bad",
      authType: "frictionless" as const,
      verified: true,
      pan: "4111111111111111",
      otp: "123456",
      redactedMetadata: { brand: "Visa", last4: "1111" }
    }
  });

  assert.throws(
    () => manager.mapCardAuthenticationOutcome(badOutcomeEnv),
    /Security policy violation: Platform must handle no raw payment credentials/
  );
});

test("Capability changes project consistently to conventional, agent, and permitted messaging experiences", () => {
  const manager = new PaymentCapabilityManager({
    certifications: [
      {
        capabilityId: "bank_transfer",
        providerId: "paystack",
        channel: "bank_transfer",
        version: 1,
        status: "certified",
        certifiedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2027-01-01T00:00:00.000Z",
        auditTrail: []
      }
    ]
  });

  const clock = () => new Date("2026-08-01T12:00:00.000Z");

  const webProj = manager.projectCapabilityState("web", clock);
  const agentProj = manager.projectCapabilityState("agent", clock);
  const whatsappProj = manager.projectCapabilityState("whatsapp", clock);

  assert.deepEqual(webProj.supportedChannels, ["bank_transfer"]);
  assert.deepEqual(agentProj.supportedChannels, ["bank_transfer"]);
  assert.deepEqual(whatsappProj.supportedChannels, ["bank_transfer"]);
});
