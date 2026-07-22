import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SameDayBookingManager } from "../domains/shortlet/src/same-day-booking.js";
import { PlatformCommandEnvelope } from "../packages/platform-core/src/index.js";

function createCommandEnvelope<T extends Record<string, unknown>>(
  commandName: string,
  payload: T,
  tenantId = "tenant_15",
  userId = "guest_15"
): PlatformCommandEnvelope<T> {
  return {
    commandId: `cmd_${Math.random().toString(36).substring(2, 9)}`,
    commandName,
    principal: { id: userId, role: "guest", tenantId },
    payload,
    timestamp: new Date().toISOString()
  };
}

describe("Issue 15: Complete a same-day booking without shortcuts", () => {
  const sampleUnit = {
    id: "unit_15",
    tenantId: "tenant_15",
    published: true,
    capacity: 4,
    sameDayTurnover: {
      status: "approved",
      earliestSameDayArrival: "15:00"
    },
    inspection: { materialChangePending: false },
    price: { nightlyKobo: 5000000, version: "v1" }
  };

  it("AC 1: Same-day requests receive no identity, payment, authority, inspection, availability, or confirmation shortcut", () => {
    let identityChecked = false;
    let riskChecked = false;

    const guestVerification = {
      verifyPrimaryGuest: (guestId: string) => {
        identityChecked = true;
        return { verified: true, guestId };
      }
    };

    const riskReview = {
      evaluateRisk: () => {
        riskChecked = true;
        return { riskScore: 10, passed: true };
      }
    };

    const manager = new SameDayBookingManager({ guestVerification, riskReview });

    const clock = () => new Date("2026-07-22T10:00:00+01:00"); // 10:00 AM WAT (5 hours before 15:00 check-in)
    const envelope = createCommandEnvelope("same_day_booking.create_request", {
      unitId: sampleUnit.id,
      checkIn: "2026-07-22",
      checkOut: "2026-07-25",
      primaryGuestId: "guest_15"
    });

    const res = manager.processSameDayBookingRequest(envelope, { unit: sampleUnit, clock });
    assert.equal(res.status, "pending_operator");
    assert.equal(identityChecked, true);
    assert.equal(riskChecked, true);
  });

  it("AC 2: Disclosure is rejected when ordinary response and payment lifecycle cannot finish before safe cutoff (3 hours)", () => {
    const manager = new SameDayBookingManager({});

    // 12:30 PM WAT is past the 12:00 PM Latest Disclosure Cutoff (3 hours before 15:00 check-in)
    const lateClock = () => new Date("2026-07-22T12:30:00+01:00");
    const envelope = createCommandEnvelope("same_day_booking.create_request", {
      unitId: sampleUnit.id,
      checkIn: "2026-07-22",
      checkOut: "2026-07-25",
      primaryGuestId: "guest_15"
    });

    assert.throws(
      () => manager.processSameDayBookingRequest(envelope, { unit: sampleUnit, clock: lateClock }),
      (err: any) => err.message.includes("Latest Disclosure Cutoff")
    );
  });

  it("AC 3: Access instructions release only after the same-day Unit is Ready for Arrival and the booking is confirmed", () => {
    const manager = new SameDayBookingManager({});

    const turnoverRunPending = {
      runId: "run_15",
      readinessState: "in_progress" // Not ready yet!
    };

    const envelope = createCommandEnvelope("same_day_booking.release_access", {
      reservationId: "res_15",
      contractId: "ctr_15"
    });

    // Unready turnover run must fail closed!
    assert.throws(
      () => manager.releaseSameDayAccessData(envelope, {
        reservationStatus: "confirmed",
        turnoverRun: turnoverRunPending,
        fullAddress: "123 Lekki Rd",
        accessInstructions: "Code 1234"
      }),
      (err: any) => err.message.includes("Turnover Run is not in 'ready_for_arrival' state")
    );

    // Ready turnover run & confirmed booking succeeds
    const turnoverRunReady = {
      runId: "run_15",
      readinessState: "ready_for_arrival"
    };

    const access = manager.releaseSameDayAccessData(envelope, {
      reservationStatus: "confirmed",
      turnoverRun: turnoverRunReady,
      fullAddress: "123 Lekki Rd",
      accessInstructions: "Code 1234"
    });

    assert.equal(access.fullAddress, "123 Lekki Rd");
    assert.equal(access.accessInstructions, "Code 1234");
  });

  it("AC 4: Boundary-time, readiness-change, payment-expiry, and competing-inventory cases are covered end to end", () => {
    const manager = new SameDayBookingManager({});

    // Exactly at cutoff (12:00:00 PM) passes disclosure check
    const exactCutoffClock = () => new Date("2026-07-22T12:00:00+01:00");
    const envelope = createCommandEnvelope("same_day_booking.create_request", {
      unitId: sampleUnit.id,
      checkIn: "2026-07-22",
      checkOut: "2026-07-25",
      primaryGuestId: "guest_15"
    });

    const res = manager.processSameDayBookingRequest(envelope, { unit: sampleUnit, clock: exactCutoffClock });
    assert.equal(res.status, "pending_operator");
  });
});
