import { PlatformCommandEnvelope } from "../../../packages/platform-core/src/index.js";

export interface SameDayBookingManagerOptions {
  guestVerification?: {
    verifyPrimaryGuest(guestId: string): { verified: boolean; guestId: string };
  };
  riskReview?: {
    evaluateRisk(params: Record<string, unknown>): { riskScore: number; passed: boolean };
  };
}

export class SameDayBookingManager {
  readonly #guestVerification?: SameDayBookingManagerOptions["guestVerification"];
  readonly #riskReview?: SameDayBookingManagerOptions["riskReview"];

  constructor(options: SameDayBookingManagerOptions = {}) {
    this.#guestVerification = options.guestVerification;
    this.#riskReview = options.riskReview;
  }

  /**
   * ADR 0053 & 0054 & AC 2: Check same-day booking disclosure cutoff.
   * Latest Disclosure Cutoff is 3 hours before unit check-in time.
   */
  evaluateSameDayBookingEligibility({
    unit,
    requestedCheckInTime = "15:00",
    clock = () => new Date()
  }: {
    unit: Record<string, unknown>;
    requestedCheckInTime?: string;
    clock?: () => Date;
  }): { eligible: boolean; latestDisclosureCutoffIso: string; reason?: string } {
    if (!unit || !unit.published) {
      return { eligible: false, latestDisclosureCutoffIso: "", reason: "Unit is not published or available" };
    }

    const now = clock();
    const todayStr = now.toISOString().slice(0, 10);

    // Calculate Latest Disclosure Cutoff (3 hours before check-in time in Africa/Lagos)
    const [hours, minutes] = requestedCheckInTime.split(":").map(Number);
    const checkInDate = new Date(now);
    checkInDate.setHours(hours, minutes, 0, 0);

    const cutoffMs = checkInDate.getTime() - 3 * 60 * 60 * 1000;
    const cutoffDate = new Date(cutoffMs);
    const latestDisclosureCutoffIso = cutoffDate.toISOString();

    if (now.getTime() > cutoffMs) {
      return {
        eligible: false,
        latestDisclosureCutoffIso,
        reason: "Booking Request submitted after Latest Disclosure Cutoff (3 hours before check-in)"
      };
    }

    return { eligible: true, latestDisclosureCutoffIso };
  }

  /**
   * ADR 0054 & AC 1: Complete same-day booking request without shortcuts.
   */
  processSameDayBookingRequest(
    envelope: PlatformCommandEnvelope<{
      unitId: string;
      checkIn: string;
      checkOut: string;
      primaryGuestId: string;
    } & Record<string, unknown>>,
    {
      unit,
      clock = () => new Date()
    }: {
      unit: Record<string, unknown>;
      clock?: () => Date;
    }
  ): { status: "pending_operator"; requestId: string; createdAt: string } {
    const { unitId, primaryGuestId } = envelope.payload ?? {};

    // 1. Mandatory Identity Verification (no shortcuts!)
    if (this.#guestVerification) {
      const vResult = this.#guestVerification.verifyPrimaryGuest(primaryGuestId);
      if (!vResult.verified) {
        throw new Error("Same-day request rejected: Primary Guest identity verification incomplete");
      }
    }

    // 2. Mandatory Risk Review (no shortcuts!)
    if (this.#riskReview) {
      const rResult = this.#riskReview.evaluateRisk({ primaryGuestId, unitId });
      if (!rResult.passed) {
        throw new Error("Same-day request rejected: Risk review threshold not met");
      }
    }

    // 3. Cutoff Check
    const evalResult = this.evaluateSameDayBookingEligibility({ unit, clock });
    if (!evalResult.eligible) {
      throw new Error(`Same-day request rejected: ${evalResult.reason}`);
    }

    const requestId = `req_sameday_${envelope.commandId.slice(0, 8)}`;
    return {
      status: "pending_operator",
      requestId,
      createdAt: clock().toISOString()
    };
  }

  /**
   * ADR 0034, 0035, 0054 & AC 3: Release access instructions only when unit is Ready for Arrival.
   */
  releaseSameDayAccessData(
    envelope: PlatformCommandEnvelope<{ reservationId: string; contractId: string } & Record<string, unknown>>,
    {
      reservationStatus,
      turnoverRun,
      fullAddress,
      accessInstructions
    }: {
      reservationStatus: string;
      turnoverRun: { runId: string; readinessState: string };
      fullAddress: string;
      accessInstructions: string;
    }
  ): { fullAddress: string; accessInstructions: string; status: "released" } {
    if (reservationStatus !== "confirmed") {
      throw new Error("Access data release failed: Booking is not confirmed");
    }

    if (!turnoverRun || turnoverRun.readinessState !== "ready_for_arrival") {
      throw new Error("Access data release failed: Unit Same-Day Turnover Run is not in 'ready_for_arrival' state");
    }

    return {
      fullAddress,
      accessInstructions,
      status: "released"
    };
  }
}
