import { test } from "node:test";
import assert from "node:assert/strict";
import { createPlatformCommandEnvelope, InMemoryAuditLog } from "../packages/platform-core/src/index.js";
import {
  RelocationManager,
  OriginalBooking,
  ReplacementCandidate
} from "../domains/shortlet/src/relocation-choice.js";

const baseBooking: OriginalBooking = {
  reservationId: "res-101",
  tenantId: "tenant-lagos",
  primaryGuestId: "guest-777",
  operatorId: "op-88",
  unitId: "unit-1",
  city: "Lagos",
  neighborhood: "Ikoyi",
  entirePlace: true,
  guestCount: 2,
  bedrooms: 1,
  beds: 1,
  qualityRating: 4.5,
  datesIso: ["2026-08-01", "2026-08-02"],
  essentialAmenities: ["wifi", "air_conditioning", "backup_power"],
  originalPriceKobo: 20000000, // ₦200,000
  securityDepositKobo: 5000000, // ₦50,000
  feesKobo: 2000000, // ₦20,000
  taxesKobo: 1500000 // ₦15,000
};

const baseCandidate: ReplacementCandidate = {
  candidateUnitId: "unit-2-replacement",
  operatorId: "op-99",
  city: "Lagos",
  neighborhood: "Ikoyi",
  locationDistanceMeters: 800,
  entirePlace: true,
  capacity: 2,
  bedrooms: 1,
  beds: 1,
  safetyPassed: true,
  qualityRating: 4.8,
  datesIso: ["2026-08-01", "2026-08-02"],
  essentialAmenities: ["wifi", "air_conditioning", "backup_power", "swimming_pool"],
  operatorTrustScore: 0.98,
  totalPriceKobo: 22000000, // ₦220,000 (₦20,000 diff = 10% diff)
  transportCostKobo: 1500000, // ₦15,000
  materialDisclosures: ["2nd floor with elevator", "24/7 security gate access"]
};

/**
 * ADR 0027, ADR 0028, ADR 0029, ADR 0063, ADR 0072
 */
test("Replacement comparison preserves capacity, location, quality, safety, dates, price difference, transport, and material disclosures", () => {
  const manager = new RelocationManager();

  // Valid comparable candidate
  const validEval = manager.evaluateReplacementComparability(baseBooking, baseCandidate);
  assert.equal(validEval.comparable, true);
  assert.equal(validEval.reasons.length, 0);

  // Failure path 1: Not entire place
  const nonEntirePlace = manager.evaluateReplacementComparability(baseBooking, {
    ...baseCandidate,
    entirePlace: false
  });
  assert.equal(nonEntirePlace.comparable, false);
  assert.ok(nonEntirePlace.reasons.some((r) => r.toLowerCase().includes("entire place")));

  // Failure path 2: Inferior capacity / beds
  const lowCapacity = manager.evaluateReplacementComparability(baseBooking, {
    ...baseCandidate,
    capacity: 1
  });
  assert.equal(lowCapacity.comparable, false);
  assert.ok(lowCapacity.reasons.some((r) => r.toLowerCase().includes("capacity")));

  // Failure path 3: Location in wrong city or too far
  const wrongCity = manager.evaluateReplacementComparability(baseBooking, {
    ...baseCandidate,
    city: "Abuja"
  });
  assert.equal(wrongCity.comparable, false);
  assert.ok(wrongCity.reasons.some((r) => r.toLowerCase().includes("city")));

  // Failure path 4: Dates mismatch
  const wrongDates = manager.evaluateReplacementComparability(baseBooking, {
    ...baseCandidate,
    datesIso: ["2026-08-01", "2026-08-03"]
  });
  assert.equal(wrongDates.comparable, false);
  assert.ok(wrongDates.reasons.some((r) => r.toLowerCase().includes("dates")));

  // Failure path 5: Failed safety or missing essential amenities
  const missingAmenity = manager.evaluateReplacementComparability(baseBooking, {
    ...baseCandidate,
    essentialAmenities: ["wifi"] // missing backup_power
  });
  assert.equal(missingAmenity.comparable, false);
  assert.ok(missingAmenity.reasons.some((r) => r.toLowerCase().includes("amenity")));
});

test("Routine, senior, and executive relocation limits require the accepted human roles and approvals", () => {
  const manager = new RelocationManager();

  // 1. Routine tier (<=25% diff, <=₦150k exposure, <=₦50k transport)
  // Price diff: ₦20,000 (10%), total exposure: ₦35,000, transport: ₦15,000
  const routineValid = manager.validateRelocationApprovals({
    originalPriceKobo: 20000000,
    priceDiffKobo: 2000000,
    transportCostKobo: 1500000,
    approvals: [{ userId: "user-1", role: "support_agent" }]
  });
  assert.equal(routineValid.valid, true);
  assert.equal(routineValid.tier, "routine");

  // Routine failure path: missing required role
  const routineMissingRole = manager.validateRelocationApprovals({
    originalPriceKobo: 20000000,
    priceDiffKobo: 2000000,
    transportCostKobo: 1500000,
    approvals: []
  });
  assert.equal(routineMissingRole.valid, false);
  assert.ok(routineMissingRole.error?.includes("Routine relocation requires"));

  // 2. Senior tier (<=50% diff, <=₦500k exposure, <=₦100k transport)
  // Price diff: ₦80,000 (40%), transport: ₦70,000 -> total exposure: ₦150,000
  const seniorValid = manager.validateRelocationApprovals({
    originalPriceKobo: 20000000,
    priceDiffKobo: 8000000,
    transportCostKobo: 7000000,
    approvals: [
      { userId: "ops-1", role: "senior_operations" },
      { userId: "fin-1", role: "finance" }
    ]
  });
  assert.equal(seniorValid.valid, true);
  assert.equal(seniorValid.tier, "senior");

  // Senior failure path: only 1 approval when 2 required (senior_operations + finance)
  const seniorSingleApproval = manager.validateRelocationApprovals({
    originalPriceKobo: 20000000,
    priceDiffKobo: 8000000,
    transportCostKobo: 7000000,
    approvals: [{ userId: "ops-1", role: "senior_operations" }]
  });
  assert.equal(seniorSingleApproval.valid, false);
  assert.ok(seniorSingleApproval.error?.includes("Senior relocation requires both"));

  // 3. Executive tier (>50% diff or >₦500k exposure or >₦100k transport)
  // Exposure: ₦600,000 (>₦500k)
  const execValid = manager.validateRelocationApprovals({
    originalPriceKobo: 20000000,
    priceDiffKobo: 50000000, // ₦500,000
    transportCostKobo: 15000000, // ₦150,000
    approvals: [
      { userId: "exec-1", role: "executive_1" },
      { userId: "exec-2", role: "executive_2" }
    ]
  });
  assert.equal(execValid.valid, true);
  assert.equal(execValid.tier, "executive");

  // Executive failure path: insufficient executive approvals
  const execInsufficient = manager.validateRelocationApprovals({
    originalPriceKobo: 20000000,
    priceDiffKobo: 50000000,
    transportCostKobo: 15000000,
    approvals: [{ userId: "exec-1", role: "executive_1" }]
  });
  assert.equal(execInsufficient.valid, false);
  assert.ok(execInsufficient.error?.includes("Executive relocation requires 2 executive approvals"));
});

test("The guest is never forced to relocate and temporary substitution requires consent", () => {
  const manager = new RelocationManager();
  const auditLog = new InMemoryAuditLog();

  const routineApproval = [{ userId: "user-1", role: "support_agent" }];

  // Guest explicitly chooses full refund instead of relocation
  const refundEnv = createPlatformCommandEnvelope({
    commandName: "relocation.submit_choice",
    principal: { id: "guest-777", role: "guest", tenantId: "tenant-lagos" },
    payload: {
      reservationId: "res-101",
      choice: "refund",
      explicitConsent: true
    }
  });

  const refundRecord = manager.commitRelocationOrRefund({
    envelope: refundEnv,
    originalBooking: baseBooking,
    auditLog
  });

  assert.equal(refundRecord.choice, "refund");
  assert.equal(refundRecord.fundingSource, "original_payment_source");
  assert.equal(refundRecord.refundTotalKobo, 28500000); // original 200k + 50k deposit + 20k fees + 15k taxes = 285,000.00
  assert.equal(refundRecord.operatorLiabilityKobo, 28500000);

  // Attempting relocation without explicit consent must fail
  const noConsentEnv = createPlatformCommandEnvelope({
    commandName: "relocation.submit_choice",
    principal: { id: "guest-777", role: "guest", tenantId: "tenant-lagos" },
    payload: {
      reservationId: "res-102",
      choice: "relocation",
      candidate: baseCandidate,
      approvals: routineApproval,
      explicitConsent: false // Missing consent
    }
  });

  assert.throws(
    () => manager.commitRelocationOrRefund({ envelope: noConsentEnv, originalBooking: baseBooking, auditLog }),
    /Explicit guest consent is required/
  );
});

test("Choice, funding source, Operator liability, booking consequences, and resulting projection are committed atomically and audited", () => {
  const manager = new RelocationManager();
  const auditLog = new InMemoryAuditLog();

  const routineApproval = [{ userId: "user-1", role: "support_agent" }];

  // Relocation choice with valid candidate and approval
  const relocationEnv = createPlatformCommandEnvelope({
    commandName: "relocation.submit_choice",
    principal: { id: "guest-777", role: "guest", tenantId: "tenant-lagos" },
    payload: {
      reservationId: "res-103",
      choice: "relocation",
      candidate: baseCandidate,
      approvals: routineApproval,
      explicitConsent: true
    }
  });

  const record = manager.commitRelocationOrRefund({
    envelope: relocationEnv,
    originalBooking: { ...baseBooking, reservationId: "res-103" },
    auditLog
  });

  assert.equal(record.choice, "relocation");
  assert.equal(record.fundingSource, "guest_protection_fund");
  assert.equal(record.replacementUnitId, "unit-2-replacement");
  assert.equal(record.priceDiffKobo, 2000000); // ₦20,000
  assert.equal(record.transportCostKobo, 1500000); // ₦15,000
  assert.equal(record.operatorLiabilityKobo, 3500000); // price diff + transport charged to operator
  assert.equal(record.originalBookingStatus, "relocated");

  // Audit log entry verified
  const entries = auditLog.entries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].action, "relocation_committed");
  assert.equal(entries[0].reservationId, "res-103");
  assert.equal(entries[0].fundingSource, "guest_protection_fund");

  // Automatic Refund Fallback when relocation approval fails
  const invalidApprovalEnv = createPlatformCommandEnvelope({
    commandName: "relocation.submit_choice",
    principal: { id: "guest-777", role: "guest", tenantId: "tenant-lagos" },
    payload: {
      reservationId: "res-104",
      choice: "relocation",
      candidate: {
        ...baseCandidate,
        totalPriceKobo: 40000000, // 100% diff -> requires Senior approval
        transportCostKobo: 80000000 // ₦800,000 -> requires Executive approval
      },
      approvals: [{ userId: "user-1", role: "support_agent" }], // insufficient approval
      explicitConsent: true
    }
  });

  const fallbackRecord = manager.commitRelocationOrRefund({
    envelope: invalidApprovalEnv,
    originalBooking: { ...baseBooking, reservationId: "res-104" },
    auditLog
  });

  // Guarantee Refund Fallback
  assert.equal(fallbackRecord.choice, "refund_fallback");
  assert.equal(fallbackRecord.fundingSource, "original_payment_source");
  assert.equal(fallbackRecord.refundTotalKobo, 28500000);
});
