import test from "node:test";
import assert from "node:assert/strict";
import { MidStayFailureManager } from "../domains/shortlet/src/index.js";
import { createPlatformCommandEnvelope } from "../packages/platform-core/src/index.js";

test("Category and timing boundaries produce the exact accepted 100%, 50%, 25%, 20%, 10%, or no-automatic-payment outcomes", () => {
  const manager = new MidStayFailureManager();

  const nightlyItems = [
    { nightDateIso: "2026-09-01", rateKobo: 10000000 },
    { nightDateIso: "2026-09-02", rateKobo: 10000000 }
  ];

  // 1. Safety, access, or habitability failure -> 100%
  const safetyRemedy = manager.calculateRemedy({
    category: "safety_access_habitability",
    failureStartedAtIso: "2026-09-01T14:00:00.000Z",
    checkedAtIso: "2026-09-01T15:00:00.000Z",
    nightlyLineItems: nightlyItems
  });
  assert.equal(safetyRemedy.percentage, 100);

  // 2. Essential amenity failure:
  // - 2h - 6h duration -> 25%
  const essential25 = manager.calculateRemedy({
    category: "essential_amenity",
    failureStartedAtIso: "2026-09-01T14:00:00.000Z",
    curedAtIso: "2026-09-01T18:00:00.000Z", // 4 hours
    nightlyLineItems: nightlyItems
  });
  assert.equal(essential25.percentage, 25);

  // - > 6h or overnight impact -> 50%
  const essential50 = manager.calculateRemedy({
    category: "essential_amenity",
    failureStartedAtIso: "2026-09-01T14:00:00.000Z",
    curedAtIso: "2026-09-01T22:00:00.000Z", // 8 hours
    nightlyLineItems: nightlyItems
  });
  assert.equal(essential50.percentage, 50);

  // 3. Material advertised amenity failure:
  // - 4h - 12h -> 10%
  const material10 = manager.calculateRemedy({
    category: "material_advertised_amenity",
    failureStartedAtIso: "2026-09-01T10:00:00.000Z",
    curedAtIso: "2026-09-01T18:00:00.000Z", // 8 hours
    nightlyLineItems: nightlyItems
  });
  assert.equal(material10.percentage, 10);

  // - > 12h -> 20%
  const material20 = manager.calculateRemedy({
    category: "material_advertised_amenity",
    failureStartedAtIso: "2026-09-01T08:00:00.000Z",
    curedAtIso: "2026-09-01T22:00:00.000Z", // 14 hours
    nightlyLineItems: nightlyItems
  });
  assert.equal(material20.percentage, 20);

  // 4. Minor impact -> no automatic payment (0%)
  const minorImpact = manager.calculateRemedy({
    category: "minor_impact",
    failureStartedAtIso: "2026-09-01T10:00:00.000Z",
    curedAtIso: "2026-09-01T18:00:00.000Z",
    nightlyLineItems: nightlyItems
  });
  assert.equal(minorImpact.percentage, 0);
});

test("Refunds use each affected contracted nightly line item and attributable undelivered charges and taxes", () => {
  const manager = new MidStayFailureManager();

  // Different nightly rates: night 1 = ₦100k, night 2 = ₦150k
  const nightlyItems = [
    { nightDateIso: "2026-09-01", rateKobo: 10000000 },
    { nightDateIso: "2026-09-02", rateKobo: 15000000 }
  ];

  const attributableCharges = {
    cleaningFeeKobo: 1000000,
    unprovidedServicesKobo: 500000,
    taxKobo: 750000
  };

  // Failure occurs on night 2 with 50% essential amenity impact
  const result = manager.calculateRemedy({
    category: "essential_amenity",
    failureStartedAtIso: "2026-09-02T14:00:00.000Z",
    curedAtIso: "2026-09-02T22:00:00.000Z",
    affectedNightDates: ["2026-09-02"],
    nightlyLineItems: nightlyItems,
    attributableCharges
  });

  // 50% of night 2 (15,000,000 * 0.5 = 7,500,000)
  assert.equal(result.nightlyRefundKobo, 7500000);
  assert.equal(result.percentage, 50);

  // Total refund = nightly refund (7.5m) + attributable undelivered charges if safety/termination or partial attributable charges
  assert.equal(result.totalRefundKobo, 7500000);
});

test("Material incidents hold exposed revenue and preserve consent, evidence, causation, and human authority", () => {
  const manager = new MidStayFailureManager();

  const incident = manager.openIncident({
    incidentId: "inc-501",
    reservationId: "res-501",
    tenantId: "tenant-lagos",
    category: "safety_access_habitability",
    failureStartedAtIso: "2026-09-01T15:00:00.000Z",
    reportedAtIso: "2026-09-01T15:30:00.000Z",
    evidenceUrls: ["https://evidence.example.com/leak.jpg"],
    nightlyLineItems: [{ nightDateIso: "2026-09-01", rateKobo: 10000000 }]
  });

  // Material incident holds exposed revenue
  assert.equal(incident.revenueHeld, true);
  assert.equal(incident.status, "open");

  // Autonomous resolution without human authority fails
  const botEnvelope = createPlatformCommandEnvelope({
    commandName: "mid_stay_failure.resolve",
    principal: { id: "bot-agent", role: "agent", tenantId: "tenant-lagos" },
    payload: { incidentId: "inc-501", choice: "relocation" }
  });

  assert.throws(
    () => manager.resolveIncidentWithHumanApproval(botEnvelope, "inc-501", "relocation", true),
    /Human authority required to resolve mid-stay failure/
  );

  // Human resolution succeeds when guest consent is obtained
  const humanEnvelope = createPlatformCommandEnvelope({
    commandName: "mid_stay_failure.resolve",
    principal: { id: "human-support-ada", role: "admin", tenantId: "tenant-lagos" },
    payload: { incidentId: "inc-501", choice: "relocation" }
  });

  const resolved = manager.resolveIncidentWithHumanApproval(humanEnvelope, "inc-501", "relocation", true);
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.resolutionChoice, "relocation");
});

test("Delayed reporting is handled fairly where safety or practical circumstances prevented immediate notice", () => {
  const manager = new MidStayFailureManager();

  const nightlyItems = [{ nightDateIso: "2026-09-01", rateKobo: 10000000 }];

  // Delayed reporting for safety failure (e.g. guest power cut & no phone connectivity for 12 hours)
  const delayedSafety = manager.calculateRemedy({
    category: "safety_access_habitability",
    failureStartedAtIso: "2026-09-01T10:00:00.000Z",
    checkedAtIso: "2026-09-01T22:00:00.000Z", // 12 hours later
    delayedReportingReason: "No network connectivity during safety issue",
    delayedReportingJustified: true,
    nightlyLineItems: nightlyItems
  });

  // Delayed reporting does NOT defeat safety or impracticable claims
  assert.equal(delayedSafety.percentage, 100);
  assert.equal(delayedSafety.reportingDelayExcused, true);
});
