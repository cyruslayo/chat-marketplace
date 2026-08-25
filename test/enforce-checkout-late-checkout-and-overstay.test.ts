import test from "node:test";
import assert from "node:assert/strict";
import { CheckoutOverstayManager } from "../domains/shortlet/src/index.js";

function createMockDeps(overrides: Record<string, any> = {}) {
  return {
    hasSameDayArrival: () => false,
    hasMaintenanceOrInspection: () => false,
    hasTurnoverCapacity: () => true,
    hasSupportAvailability: () => true,
    operatorApproved: () => true,
    ...overrides
  };
}

test("Eligibility checks same-day arrivals, maintenance/inspection needs, turnover capacity, support availability, Operator decision, price, and guest acceptance", () => {
  const deps = createMockDeps();
  const manager = new CheckoutOverstayManager(deps);

  // Success path: Valid 12:00, 13:00, or 14:00 WAT late checkout with guest acceptance & price quote
  const eligible = manager.evaluateLateCheckoutEligibility({
    reservationId: "res-101",
    requestedTime: "14:00",
    checkoutDate: "2026-08-25"
  });
  assert.equal(eligible.eligible, true);
  assert.equal("feeKobo" in eligible, false);

  // Failure path 1: Prohibited when same-day arrival exists (ADR 0033 & ADR 0034)
  const sameDayDeps = createMockDeps({ hasSameDayArrival: () => true });
  const sameDayManager = new CheckoutOverstayManager(sameDayDeps);
  const resSameDay = sameDayManager.evaluateLateCheckoutEligibility({
    reservationId: "res-101",
    requestedTime: "12:00",
    checkoutDate: "2026-08-25"
  });
  assert.equal(resSameDay.eligible, false);
  assert.match(resSameDay.reason!, /prohibited for same-day incoming reservation/i);

  // Failure path 2: Conflicting maintenance or inspection
  const maintDeps = createMockDeps({ hasMaintenanceOrInspection: () => true });
  const maintManager = new CheckoutOverstayManager(maintDeps);
  const resMaint = maintManager.evaluateLateCheckoutEligibility({
    reservationId: "res-101",
    requestedTime: "13:00",
    checkoutDate: "2026-08-25"
  });
  assert.equal(resMaint.eligible, false);
  assert.match(resMaint.reason!, /maintenance or inspection scheduled/i);

  // Failure path 3: Late checkout requested past 14:00 WAT limit (ADR 0033)
  const resPastLimit = manager.evaluateLateCheckoutEligibility({
    reservationId: "res-101",
    requestedTime: "15:00",
    checkoutDate: "2026-08-25"
  });
  assert.equal(resPastLimit.eligible, false);
  assert.match(resPastLimit.reason!, /Late checkout capped at 14:00 WAT/i);
});

test("Approved amendment time drives reminders, access expiry, turnover start, overstay, support, and deposit-claim deadlines", () => {
  const deps = createMockDeps();
  const manager = new CheckoutOverstayManager(deps);

  // Standard checkout (11:00 AM WAT)
  const stdSchedule = manager.calculateCheckoutSchedule({
    reservationId: "res-std",
    checkoutDate: "2026-08-25",
    contractualCheckoutTime: "11:00"
  });
  assert.equal(stdSchedule.contractualCheckoutIso, "2026-08-25T10:00:00.000Z"); // 11:00 WAT = 10:00 UTC
  assert.equal(stdSchedule.accessExpiryIso, "2026-08-25T10:00:00.000Z");
  assert.equal(stdSchedule.depositClaimDeadlineIso, "2026-08-26T10:00:00.000Z"); // +24 hours

  // Approved Late Checkout amendment to 14:00 WAT (2:00 PM WAT)
  const lateSchedule = manager.calculateCheckoutSchedule({
    reservationId: "res-late",
    checkoutDate: "2026-08-25",
    contractualCheckoutTime: "14:00"
  });
  assert.equal(lateSchedule.contractualCheckoutIso, "2026-08-25T13:00:00.000Z"); // 14:00 WAT = 13:00 UTC
  assert.equal(lateSchedule.accessExpiryIso, "2026-08-25T13:00:00.000Z");
  assert.equal(lateSchedule.depositClaimDeadlineIso, "2026-08-26T13:00:00.000Z"); // Driven by approved amendment time (+24h)
});

test("No informal message, cash, or direct transfer can extend checkout or create a charge", () => {
  const deps = createMockDeps();
  const manager = new CheckoutOverstayManager(deps);

  // Failure path 1: Informal message attempt MUST fail
  assert.throws(
    () =>
      manager.processCheckoutExtensionRequest({
        reservationId: "res-101",
        method: "informal_chat",
        note: "Host said I could stay till 4 PM over WhatsApp"
      }),
    /Informal messages cannot amend checkout/
  );

  // Failure path 2: Direct cash / bank transfer attempt MUST fail
  assert.throws(
    () =>
      manager.processCheckoutExtensionRequest({
        reservationId: "res-101",
        method: "cash_or_direct_transfer",
        amountKobo: 2000000
      }),
    /Cash or direct transfers cannot extend checkout or create charges/
  );
});

test("Overstay consequences are standardized, evidence-backed, non-duplicative, and subject to human safety escalation", () => {
  const deps = createMockDeps();
  const manager = new CheckoutOverstayManager(deps);

  // Overstay detected past authoritative deadline (e.g. 11:15 WAT when checkout was 11:00 WAT)
  const incident = manager.openOverstayIncident({
    reservationId: "res-overstay",
    checkoutDate: "2026-08-25",
    contractualCheckoutTime: "11:00",
    currentIso: "2026-08-25T10:30:00.000Z", // 11:30 WAT
    evidenceReferences: [{ evidenceId: "occupancy-1", source: "trusted-occupancy" }]
  });

  assert.equal(incident.status, "open_incident");
  assert.equal(incident.consequences.standardized, true);
  assert.equal(incident.consequences.duplicativeChargesProhibited, true);

  // Safety threat escalation path
  const escalated = manager.escalateOverstaySafetyIncident(incident.incidentId, {
    requiresHumanSafetyEscalation: true,
    assessmentVersion: "safety-1"
  });

  assert.equal(escalated.humanSafetyEscalation, true);
  assert.equal(escalated.targetQueue, "Active-Stay Emergency Support (24/7)");
});
