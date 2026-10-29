import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { DEMO_TRUST_EXPIRES_ON, seedIssue01Units, type Unit } from "../domains/shortlet/src/browse.js";
import { getUnitOnboardingStatus } from "../domains/shortlet/src/onboarding.js";

// The offer check (ADR 0056, 0057, 0065; onboarding.ts) requires each trust record to outlast today plus the
// 90-night horizon and the 14-night stay: 104 days. The synthetic demo seeds must pass it at the staging clock and later,
// or no offer can be issued on staging. The expiry comes from one constant so the seeds refresh together.

/** The staging-like clock (27 Oct 2026) and a later one inside the same demo year. */
const CLOCKS = [new Date("2026-10-27T10:00:00Z"), new Date("2026-11-20T10:00:00Z")] as const;
/** The intentionally expired unit the browse seed keeps to exercise the expired-inspection path. */
const DELIBERATELY_EXPIRED = "unit-abuja-expired";

function blockersAt(unit: Unit, clock: Date): readonly string[] {
  return getUnitOnboardingStatus(unit, clock).blockers;
}

test("every demo unit in the local fixture passes the offer eligibility check at the staging clock and later", () => {
  const directory = mkdtempSync(join(tmpdir(), "demo-seed-expiry-"));
  try {
    for (const clock of CLOCKS) {
      const environment = LocalGuestEnvironment.openNode({ databasePath: join(directory, `fixture-${clock.getTime()}.sqlite`), clock: () => clock });
      try {
        const units = environment.unitRepository.findAll();
        assert.ok(units.length > 0, "the fixture seeds demo units");
        for (const unit of units) assert.deepEqual(blockersAt(unit, clock), [], `${unit.id} at ${clock.toISOString()}`);
      } finally { environment.close(); }
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("every demo unit from the browse seed passes the offer eligibility check at the staging clock and later", () => {
  for (const clock of CLOCKS) {
    const saved: Unit[] = [];
    seedIssue01Units({ save: (unit: Unit) => { saved.push(unit); } });
    const demoUnits = saved.filter((unit) => unit.id !== DELIBERATELY_EXPIRED);
    assert.ok(demoUnits.length > 0, "the browse seed holds demo units");
    for (const unit of demoUnits) assert.deepEqual(blockersAt(unit, clock), [], `${unit.id} at ${clock.toISOString()}`);
  }
});

test("a trust record that expires inside the 104-day window is blocked, as the old January and February seed dates were", () => {
  const saved: Unit[] = [];
  seedIssue01Units({ save: (unit: Unit) => { saved.push(unit); } });
  const seeded = saved.find((unit) => unit.id === "unit-lagos-001");
  assert.ok(seeded, "the browse seed holds the Ikeja demo unit");
  const oldDate = "2027-01-15";
  const withOldDates: Unit = {
    ...seeded,
    inspection: { ...seeded.inspection, expiresAt: oldDate },
    managementAuthority: { ...seeded.managementAuthority, expiresAt: oldDate },
    regulatory: {
      ...seeded.regulatory,
      licensing: { ...seeded.regulatory.licensing, expiresAt: oldDate },
      insurance: { ...seeded.regulatory.insurance, expiresAt: oldDate },
    },
  };
  const blockers = blockersAt(withOldDates, CLOCKS[0]);
  assert.ok(blockers.includes("Physical inspection expired or invalid"), "the old inspection date fails");
  assert.ok(blockers.includes("Management authority missing, invalid or expired"), "the old authority date fails");
  assert.ok(blockers.includes("Licensing missing, invalid or expired"), "the old licence date fails");
  assert.ok(blockers.includes("Insurance missing, invalid or expired"), "the old insurance date fails");
});

test("the demo trust-record expiry is about twelve months past the staging clock", () => {
  assert.equal(DEMO_TRUST_EXPIRES_ON, "2027-10-27");
});
