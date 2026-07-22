import { PlatformCommandEnvelope } from "../../../packages/platform-core/src/index.js";

export interface CheckInWindow {
  readonly checkInDate: string;
  readonly earliestAccessTime: string; // HH:mm WAT (between 14:00 and 22:00)
  readonly latestPermittedArrival: string; // HH:mm WAT (between earliestAccessTime and 22:00)
}

export interface HumanSupportSchedule {
  readonly reservationId: string;
  readonly assignedAgentId: string;
  readonly backupAgentId: string;
  readonly activeFrom: string;
  readonly activeUntil: string;
  status: "scheduled" | "active" | "escalated" | "closed";
}

export interface AccessEvidence {
  readonly evidenceId: string;
  readonly source:
    | "guest_confirmation"
    | "platform_code"
    | "access_system_event"
    | "support_verification"
    | "operator_assertion"
    | "chat_state";
  readonly timestamp: string;
  readonly details: Record<string, unknown>;
}

export interface VerifiedAccessResult {
  readonly reservationId: string;
  readonly status: "verified_access" | "failed_access" | "late_voluntary_arrival" | "pending_evidence";
  readonly evidenceSource: string;
  readonly verifiedAt: string;
  readonly protectionWindowStartsAt?: string;
}

export interface BlockingFulfilmentComplaint {
  readonly complaintId: string;
  readonly reservationId: string;
  readonly type: "access_failure" | "habitability_failure" | "substitution" | "safety_issue" | "authority_defect";
  status: "open" | "under_human_review" | "resolved";
  readonly revenueHeld: true;
  readonly details: Record<string, unknown>;
  readonly openedAt: string;
}

function parseTimeToMinutes(timeStr: string): number {
  const parts = timeStr.split(":");
  if (parts.length !== 2) return -1;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return -1;
  return h * 60 + m;
}

export class CheckInSupportManager {
  readonly #schedules = new Map<string, HumanSupportSchedule>();
  readonly #evidence = new Map<string, AccessEvidence[]>();
  readonly #accessResults = new Map<string, VerifiedAccessResult>();
  readonly #complaints = new Map<string, BlockingFulfilmentComplaint[]>();
  readonly #windows = new Map<string, CheckInWindow>();
  readonly #audit?: { record(entry: Record<string, unknown>): void };

  constructor(options?: { audit?: { record(entry: Record<string, unknown>): void } }) {
    this.#audit = options?.audit;
  }

  /**
   * ADR 0030, ADR 0031 & AC 1: Schedule Human Support for check-in window (14:00 - 22:00 WAT boundary).
   */
  scheduleHumanSupport(
    envelope: PlatformCommandEnvelope<{
      reservationId: string;
      checkInWindow: CheckInWindow;
      assignedAgentId: string;
      backupAgentId: string;
    }>,
    clock: () => Date = () => new Date()
  ): HumanSupportSchedule {
    if (!envelope || envelope.commandName !== "checkin_support.schedule") {
      throw new Error("Invalid envelope: commandName must be 'checkin_support.schedule'");
    }

    const { reservationId, checkInWindow, assignedAgentId, backupAgentId } = envelope.payload;
    if (!assignedAgentId || !backupAgentId) {
      throw new Error("Assigned agent and backup agent are required for Human Incident Support");
    }

    // Boundary check (14:00 to 22:00 WAT)
    const startMins = parseTimeToMinutes(checkInWindow.earliestAccessTime);
    const endMins = parseTimeToMinutes(checkInWindow.latestPermittedArrival);
    const minMins = 14 * 60; // 14:00
    const maxMins = 22 * 60; // 22:00

    if (startMins < minMins || endMins > maxMins || startMins > endMins) {
      throw new Error(
        `Contractual check-in window must be between 14:00 and 22:00 WAT (got ${checkInWindow.earliestAccessTime} - ${checkInWindow.latestPermittedArrival})`
      );
    }

    const now = clock();
    const schedule: HumanSupportSchedule = {
      reservationId,
      assignedAgentId,
      backupAgentId,
      activeFrom: `${checkInWindow.checkInDate}T${checkInWindow.earliestAccessTime}:00.000Z`,
      activeUntil: `${checkInWindow.checkInDate}T${checkInWindow.latestPermittedArrival}:00.000Z`,
      status: "scheduled"
    };

    this.#schedules.set(reservationId, schedule);
    this.#windows.set(reservationId, checkInWindow);

    if (this.#audit) {
      this.#audit.record({
        type: "checkin_support.scheduled",
        reservationId,
        assignedAgentId,
        backupAgentId,
        checkInWindow,
        scheduledAt: now.toISOString()
      });
    }

    return { ...schedule };
  }

  /**
   * AC 1: Escalate incident to assigned/backup support.
   */
  escalateIncident(
    envelope: PlatformCommandEnvelope<{ reservationId: string; reason: string }>,
    clock: () => Date = () => new Date()
  ): HumanSupportSchedule {
    if (!envelope || envelope.commandName !== "checkin_support.escalate") {
      throw new Error("Invalid envelope: commandName must be 'checkin_support.escalate'");
    }

    const { reservationId, reason } = envelope.payload;
    const schedule = this.#schedules.get(reservationId);
    if (!schedule) {
      throw new Error(`Support schedule not found for reservation '${reservationId}'`);
    }

    schedule.status = "escalated";
    const now = clock();

    if (this.#audit) {
      this.#audit.record({
        type: "checkin_support.escalated",
        reservationId,
        reason,
        escalatedAt: now.toISOString()
      });
    }

    return { ...schedule };
  }

  /**
   * ADR 0022 & AC 2, AC 4: Verified Access evaluation based on independent evidence hierarchy.
   */
  submitAccessEvidence(
    envelope: PlatformCommandEnvelope<{ reservationId: string; evidence: AccessEvidence }>,
    clock: () => Date = () => new Date()
  ): VerifiedAccessResult {
    if (!envelope || envelope.commandName !== "checkin_support.submit_evidence") {
      throw new Error("Invalid envelope: commandName must be 'checkin_support.submit_evidence'");
    }

    const { reservationId, evidence } = envelope.payload;
    if (evidence.source === "operator_assertion" || evidence.source === "chat_state") {
      throw new Error("Verified Access cannot be declared by Operator assertion or chat state alone");
    }

    const list = this.#evidence.get(reservationId) ?? [];
    list.push(evidence);
    this.#evidence.set(reservationId, list);

    const now = clock();
    let status: VerifiedAccessResult["status"] = "verified_access";

    if (evidence.details?.accessFailed === true) {
      status = "failed_access";
    } else if (evidence.details?.isLateVoluntaryArrival === true) {
      status = "late_voluntary_arrival";
    }

    const result: VerifiedAccessResult = {
      reservationId,
      status,
      evidenceSource: evidence.source,
      verifiedAt: now.toISOString(),
      protectionWindowStartsAt: status !== "failed_access" ? now.toISOString() : undefined
    };

    this.#accessResults.set(reservationId, result);

    if (this.#audit) {
      this.#audit.record({
        type: "checkin_support.access_evidence_submitted",
        reservationId,
        evidenceSource: evidence.source,
        status,
        submittedAt: now.toISOString()
      });
    }

    return result;
  }

  /**
   * ADR 0021, ADR 0076 & AC 3: Open Blocking Fulfilment Complaint holding revenue.
   */
  raiseBlockingComplaint(
    envelope: PlatformCommandEnvelope<{
      reservationId: string;
      type: BlockingFulfilmentComplaint["type"];
      details: Record<string, unknown>;
    }>,
    clock: () => Date = () => new Date()
  ): BlockingFulfilmentComplaint {
    if (!envelope || envelope.commandName !== "checkin_support.raise_complaint") {
      throw new Error("Invalid envelope: commandName must be 'checkin_support.raise_complaint'");
    }

    const { reservationId, type, details } = envelope.payload;
    const now = clock();
    const complaintId = `cmpl_${now.getTime()}_${Math.random().toString(36).slice(2, 6)}`;

    const complaint: BlockingFulfilmentComplaint = {
      complaintId,
      reservationId,
      type,
      status: "open",
      revenueHeld: true,
      details,
      openedAt: now.toISOString()
    };

    const list = this.#complaints.get(reservationId) ?? [];
    list.push(complaint);
    this.#complaints.set(reservationId, list);

    if (this.#audit) {
      this.#audit.record({
        type: "checkin_support.blocking_complaint_raised",
        complaintId,
        reservationId,
        complaintType: type,
        revenueHeld: true,
        raisedAt: now.toISOString()
      });
    }

    return complaint;
  }

  /**
   * AC 1 & AC 3: Project full auditable status for check-in support.
   */
  projectCheckInStatus(reservationId: string): {
    readonly reservationId: string;
    readonly checkInWindow?: CheckInWindow;
    readonly supportOwnership: HumanSupportSchedule;
    readonly accessResult?: VerifiedAccessResult;
    readonly activeComplaints: readonly BlockingFulfilmentComplaint[];
    readonly revenueHeld: boolean;
  } {
    const supportOwnership = this.#schedules.get(reservationId);
    if (!supportOwnership) {
      throw new Error(`No check-in support scheduled for reservation '${reservationId}'`);
    }

    const checkInWindow = this.#windows.get(reservationId);
    const accessResult = this.#accessResults.get(reservationId);
    const complaints = this.#complaints.get(reservationId) ?? [];
    const revenueHeld = complaints.some((c) => c.status !== "resolved" && c.revenueHeld);

    return {
      reservationId,
      checkInWindow,
      supportOwnership: { ...supportOwnership },
      accessResult: accessResult ? { ...accessResult } : undefined,
      activeComplaints: Object.freeze(complaints.map((c) => ({ ...c }))),
      revenueHeld
    };
  }
}
