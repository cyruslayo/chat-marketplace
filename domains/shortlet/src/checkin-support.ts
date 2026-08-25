import type { CommandPrincipal, PlatformCommandEnvelope } from "../../../packages/platform-core/src/index.js";

export type CheckInSupportStatus = "scheduled" | "active" | "handoff_requested" | "human_owned" | "closed";
export type AccessStatus = "awaiting_access" | "verified_access" | "late_voluntary_arrival" | "failed_access" | "under_human_review";
export type ComplaintCategory = "access_failure" | "habitability_failure" | "substitution" | "safety_issue" | "authority_defect";

export interface CheckInWindow {
  readonly checkInDate: string;
  readonly earliestAccessTime: string;
  readonly latestPermittedArrival: string;
  readonly timezone: "Africa/Lagos";
}

export interface CheckInWindowProvider { getWindow(reservationId: string): CheckInWindow; }
export interface CheckInSupportAssignment { readonly assignedResponderId: string; readonly backupResponderId: string; readonly seniorEscalationId?: string; }
export interface CheckInSupportAssignmentProvider { assign(reservationId: string): CheckInSupportAssignment; }
export interface CheckInReservation { readonly reservationId: string; readonly primaryGuestId: string; readonly tenantId?: string; readonly status: "confirmed" | "cancelled" | "revoked"; }
export interface CheckInReservationProvider { getReservation(reservationId: string): CheckInReservation | null; }
export interface CheckInHumanOwnershipPort { requestHumanOwnership(input: { reservationId: string; category: ComplaintCategory; minimizedContext: { readonly complaintId?: string; readonly safeSummary?: string } }): void; }

export interface HumanSupportSchedule {
  readonly reservationId: string;
  readonly assignedResponderId: string;
  readonly backupResponderId: string;
  readonly activeFrom: string;
  readonly activeUntil: string;
  status: CheckInSupportStatus;
}

interface StoredEvidence {
  readonly evidenceId: string;
  readonly source: "guest_confirmation" | "access_system_event" | "support_verification" | "operator_assertion";
  readonly provisionedAt?: string;
  readonly validAccess: boolean;
  readonly positiveAtContractualCheckIn: boolean;
  readonly failedAccess: boolean;
}

export interface VerifiedAccessResult {
  readonly reservationId: string;
  readonly status: AccessStatus;
  readonly evidenceSource?: StoredEvidence["source"];
  readonly verifiedAt?: string;
  readonly protectionWindowStartsAt?: string;
}

export interface BlockingFulfilmentComplaint {
  readonly complaintId: string;
  readonly reservationId: string;
  readonly category: ComplaintCategory;
  readonly status: "open" | "under_human_review" | "resolved";
  readonly revenueHeld: true;
  readonly safeSummary?: string;
  readonly evidenceReferences: readonly string[];
  readonly openedAt: string;
}

const MIN_ARRIVAL_MINUTES = 14 * 60;
const MAX_ARRIVAL_MINUTES = 22 * 60;
const VALID_ROLES = new Set<CommandPrincipal["role"]>(["system", "admin", "authorized_staff"]);

function parseTime(value: string): number {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return -1;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}
function assertWindow(window: CheckInWindow): void {
  const start = parseTime(window.earliestAccessTime);
  const end = parseTime(window.latestPermittedArrival);
  if (window.timezone !== "Africa/Lagos" || start < MIN_ARRIVAL_MINUTES || end > MAX_ARRIVAL_MINUTES || start > end) {
    throw new Error("Contractual check-in window must be between 14:00 and 22:00 WAT");
  }
}
function absoluteLagos(date: string, time: string): string { return `${date}T${time}:00.000+01:00`; }
function isGuestFor(reservation: CheckInReservation, principal: CommandPrincipal): boolean {
  return principal.role === "guest" && !!principal.id && !!principal.tenantId && !!reservation.tenantId
    && principal.id === reservation.primaryGuestId && principal.tenantId === reservation.tenantId && reservation.status === "confirmed";
}

export class CheckInSupportManager {
  readonly #schedules = new Map<string, HumanSupportSchedule>();
  readonly #windows = new Map<string, CheckInWindow>();
  readonly #evidence = new Map<string, StoredEvidence[]>();
  readonly #results = new Map<string, VerifiedAccessResult>();
  readonly #complaints = new Map<string, BlockingFulfilmentComplaint[]>();
  readonly #assignments: CheckInSupportAssignmentProvider;
  readonly #windowsProvider: CheckInWindowProvider;
  readonly #reservations?: CheckInReservationProvider;
  readonly #ownership?: CheckInHumanOwnershipPort;
  readonly #audit?: { record(entry: Record<string, unknown>): void };

  constructor(options: { windowProvider: CheckInWindowProvider; assignmentProvider: CheckInSupportAssignmentProvider; reservationProvider?: CheckInReservationProvider; humanOwnership?: CheckInHumanOwnershipPort; audit?: { record(entry: Record<string, unknown>): void } }) {
    this.#windowsProvider = options.windowProvider;
    this.#assignments = options.assignmentProvider;
    this.#reservations = options.reservationProvider;
    this.#ownership = options.humanOwnership;
    this.#audit = options.audit;
  }

  scheduleHumanSupport(envelope: PlatformCommandEnvelope<{ reservationId: string }>, clock: () => Date = () => new Date()): HumanSupportSchedule {
    if (!envelope || envelope.commandName !== "checkin_support.schedule") throw new Error("Invalid check-in support schedule command");
    if (!VALID_ROLES.has(envelope.principal.role)) throw new Error("Only trusted operational principals may schedule Human Incident Support");
    const window = this.#windowsProvider.getWindow(envelope.payload.reservationId);
    assertWindow(window);
    const assignment = this.#assignments.assign(envelope.payload.reservationId);
    if (!assignment.assignedResponderId || !assignment.backupResponderId) throw new Error("Human Incident Support coverage is incomplete");
    const schedule: HumanSupportSchedule = { reservationId: envelope.payload.reservationId, assignedResponderId: assignment.assignedResponderId, backupResponderId: assignment.backupResponderId, activeFrom: absoluteLagos(window.checkInDate, window.earliestAccessTime), activeUntil: absoluteLagos(window.checkInDate, window.latestPermittedArrival), status: "scheduled" };
    this.#schedules.set(schedule.reservationId, schedule); this.#windows.set(schedule.reservationId, window);
    this.#audit?.record({ type: "checkin_support.scheduled", reservationId: schedule.reservationId, scheduledAt: clock().toISOString() });
    return { ...schedule };
  }

  escalateIncident(envelope: PlatformCommandEnvelope<{ reservationId: string; category: ComplaintCategory }>, clock: () => Date = () => new Date()): HumanSupportSchedule {
    if (!envelope || envelope.commandName !== "checkin_support.escalate") throw new Error("Invalid check-in escalation command");
    const schedule = this.#schedules.get(envelope.payload.reservationId); if (!schedule) throw new Error("Support schedule not found");
    schedule.status = "handoff_requested";
    this.#ownership?.requestHumanOwnership({ reservationId: schedule.reservationId, category: envelope.payload.category, minimizedContext: {} });
    this.#audit?.record({ type: "checkin_support.escalated", reservationId: schedule.reservationId, escalatedAt: clock().toISOString() });
    return { ...schedule };
  }

  #assertReservation(reservationId: string, principal: CommandPrincipal): CheckInReservation {
    const reservation = this.#reservations?.getReservation(reservationId);
    if (!reservation || !isGuestFor(reservation, principal)) throw new Error("Access denied or reservation not found");
    return reservation;
  }
  #requireScheduled(reservationId: string): void { if (!this.#schedules.has(reservationId)) throw new Error("Human Incident Support is not scheduled"); }
  #evaluate(reservationId: string, now: Date): VerifiedAccessResult {
    const list = this.#evidence.get(reservationId) ?? [];
    const failures = list.some((e) => e.failedAccess);
    const valid = list.filter((e) => e.validAccess);
    const conflict = failures && valid.length > 0;
    if (conflict) return { reservationId, status: "under_human_review" };
    if (failures) return { reservationId, status: "failed_access" };
    const evidence = valid.at(-1);
    if (!evidence) return { reservationId, status: "awaiting_access" };
    const window = this.#windows.get(reservationId); if (!window) throw new Error("Check-in window unavailable");
    const contractual = new Date(absoluteLagos(window.checkInDate, window.earliestAccessTime)).getTime();
    const provisioned = new Date(evidence.provisionedAt ?? now.toISOString()).getTime();
    const late = evidence.positiveAtContractualCheckIn;
    const start = late ? contractual : Math.max(contractual, provisioned);
    const result: VerifiedAccessResult = { reservationId, status: late ? "late_voluntary_arrival" : "verified_access", evidenceSource: evidence.source, verifiedAt: now.toISOString(), protectionWindowStartsAt: new Date(start).toISOString() };
    return result;
  }
  #record(reservationId: string, evidence: StoredEvidence, clock: () => Date): VerifiedAccessResult {
    this.#requireScheduled(reservationId); const list = this.#evidence.get(reservationId) ?? []; list.push(evidence); this.#evidence.set(reservationId, list);
    const result = this.#evaluate(reservationId, clock()); this.#results.set(reservationId, result);
    this.#audit?.record({ type: "checkin_support.evidence_recorded", reservationId, evidenceSource: evidence.source, status: result.status, recordedAt: clock().toISOString() });
    if (result.status === "failed_access" || result.status === "under_human_review") this.#ownership?.requestHumanOwnership({ reservationId, category: "access_failure", minimizedContext: {} });
    return { ...result };
  }
  confirmGuestAccess(envelope: PlatformCommandEnvelope<{ reservationId: string }>, clock: () => Date = () => new Date()): VerifiedAccessResult {
    if (!envelope || envelope.commandName !== "checkin_support.confirm_access") throw new Error("Invalid guest access confirmation command");
    if (Object.keys(envelope.payload).some((key) => key !== "reservationId")) throw new Error("Guest access confirmation accepts only reservationId");
    this.#assertReservation(envelope.payload.reservationId, envelope.principal);
    const now = clock(); return this.#record(envelope.payload.reservationId, { evidenceId: envelope.commandId, source: "guest_confirmation", validAccess: true, failedAccess: false, positiveAtContractualCheckIn: false, provisionedAt: now.toISOString() }, clock);
  }
  recordAccessSystemEvidence(envelope: PlatformCommandEnvelope<{ reservationId: string; provisionedAt: string; validAccess: boolean; failedAccess: boolean }>, clock: () => Date = () => new Date()): VerifiedAccessResult {
    if (!envelope || envelope.commandName !== "checkin_support.access_system_event" || envelope.principal.role !== "system") throw new Error("Trusted access-system evidence is required");
    return this.#record(envelope.payload.reservationId, { evidenceId: envelope.commandId, source: "access_system_event", ...envelope.payload, positiveAtContractualCheckIn: false }, clock);
  }
  recordSupportVerification(envelope: PlatformCommandEnvelope<{ reservationId: string; provisionedAt?: string; validAccess: boolean; failedAccess: boolean; positiveAtContractualCheckIn: boolean }>, clock: () => Date = () => new Date()): VerifiedAccessResult {
    if (!envelope || envelope.commandName !== "checkin_support.support_verification" || !["system", "admin", "authorized_staff"].includes(envelope.principal.role)) throw new Error("Authorized support verification is required");
    return this.#record(envelope.payload.reservationId, { evidenceId: envelope.commandId, source: "support_verification", ...envelope.payload }, clock);
  }
  recordOperatorAssertion(envelope: PlatformCommandEnvelope<{ reservationId: string }>): VerifiedAccessResult {
    if (!envelope || envelope.commandName !== "checkin_support.operator_assertion" || envelope.principal.role !== "operator") throw new Error("Operator assertion requires an Operator principal");
    const list = this.#evidence.get(envelope.payload.reservationId) ?? []; list.push({ evidenceId: envelope.commandId, source: "operator_assertion", validAccess: false, failedAccess: false, positiveAtContractualCheckIn: false }); this.#evidence.set(envelope.payload.reservationId, list);
    const result = { reservationId: envelope.payload.reservationId, status: "awaiting_access" as const }; this.#results.set(envelope.payload.reservationId, result); return result;
  }
  raiseBlockingComplaint(envelope: PlatformCommandEnvelope<{ reservationId: string; category: ComplaintCategory; safeSummary?: string; evidenceReferences?: readonly string[] }>, clock: () => Date = () => new Date()): BlockingFulfilmentComplaint {
    if (!envelope || envelope.commandName !== "checkin_support.report_problem") throw new Error("Invalid blocking complaint command");
    this.#assertReservation(envelope.payload.reservationId, envelope.principal); this.#requireScheduled(envelope.payload.reservationId);
    const existing = (this.#complaints.get(envelope.payload.reservationId) ?? []).find((c) => c.status !== "resolved" && c.category === envelope.payload.category);
    if (existing) return { ...existing };
    const now = clock(); const complaint: BlockingFulfilmentComplaint = { complaintId: `cmpl_${envelope.payload.reservationId}_${envelope.payload.category}`, reservationId: envelope.payload.reservationId, category: envelope.payload.category, status: "open", revenueHeld: true, ...(envelope.payload.safeSummary ? { safeSummary: envelope.payload.safeSummary.slice(0, 500) } : {}), evidenceReferences: Object.freeze([...(envelope.payload.evidenceReferences ?? [])].slice(0, 10)), openedAt: now.toISOString() };
    this.#complaints.set(envelope.payload.reservationId, [...(this.#complaints.get(envelope.payload.reservationId) ?? []), complaint]);
    this.#ownership?.requestHumanOwnership({ reservationId: complaint.reservationId, category: complaint.category, minimizedContext: { complaintId: complaint.complaintId, ...(complaint.safeSummary ? { safeSummary: complaint.safeSummary } : {}) } });
    this.#audit?.record({ type: "checkin_support.blocking_complaint_raised", complaintId: complaint.complaintId, reservationId: complaint.reservationId, complaintType: complaint.category, raisedAt: complaint.openedAt });
    return { ...complaint };
  }
  hasUnresolvedBlockingComplaint(reservationId: string): boolean { return (this.#complaints.get(reservationId) ?? []).some((c) => c.status !== "resolved"); }
  projectCheckInStatusForGuest(reservationId: string, principal: CommandPrincipal) {
    const reservation = this.#reservations?.getReservation(reservationId);
    if (!reservation || !isGuestFor(reservation, principal)) throw new Error("Access denied or reservation not found");
    return this.projectCheckInStatus(reservationId);
  }
  projectCheckInStatus(reservationId: string): { readonly reservationId: string; readonly checkInWindow: CheckInWindow; readonly supportOwnership: HumanSupportSchedule; readonly accessResult: VerifiedAccessResult; readonly activeComplaints: readonly BlockingFulfilmentComplaint[]; readonly revenueHeld: boolean } {
    const schedule = this.#schedules.get(reservationId); const window = this.#windows.get(reservationId); if (!schedule || !window) throw new Error("No check-in support scheduled");
    const result = this.#results.get(reservationId) ?? { reservationId, status: "awaiting_access" as const }; const complaints = this.#complaints.get(reservationId) ?? [];
    return { reservationId, checkInWindow: { ...window }, supportOwnership: { ...schedule }, accessResult: { ...result }, activeComplaints: Object.freeze(complaints.map((c) => ({ ...c }))), revenueHeld: this.hasUnresolvedBlockingComplaint(reservationId) };
  }
}
