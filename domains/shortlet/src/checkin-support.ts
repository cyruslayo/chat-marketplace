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

/**
 * ADR 0091: the documented basis a platform-support user gives when recording Verified Access. An owner's
 * declaration alone is not a basis (ADR 0022). Codes only; no free text (ADR 0075).
 */
export const SUPPORT_VERIFICATION_BASES = Object.freeze({
  guest_confirmed_directly: "The Guest confirmed access to me directly",
  staff_handover: "I or platform staff handed over access at the unit",
} as const);
export type SupportVerificationBasis = keyof typeof SUPPORT_VERIFICATION_BASES;
export function isSupportVerificationBasis(value: unknown): value is SupportVerificationBasis {
  return typeof value === "string" && Object.hasOwn(SUPPORT_VERIFICATION_BASES, value);
}

export interface StoredEvidence {
  readonly evidenceId: string;
  readonly source: "guest_confirmation" | "access_system_event" | "support_verification" | "operator_assertion";
  readonly basis?: SupportVerificationBasis;
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

/**
 * Why platform support closed a complaint that did not hold up (issue 10, decided 28 Sept 2026). An upheld complaint
 * is not dismissed: it stays open until a cancellation or remedy outcome is recorded (ADR 0089).
 */
export const COMPLAINT_DISMISSAL_REASONS = ["cured", "not_borne_out"] as const;
export type ComplaintDismissalReason = typeof COMPLAINT_DISMISSAL_REASONS[number];
export function isComplaintDismissalReason(value: unknown): value is ComplaintDismissalReason {
  return typeof value === "string" && (COMPLAINT_DISMISSAL_REASONS as readonly string[]).includes(value);
}

/** When the last complaint was dismissed, or null. The owner payable is not due before it (issue 10, ADR 0089). */
export function lastComplaintResolvedAt(complaints: readonly Pick<BlockingFulfilmentComplaint, "status" | "resolvedAt">[]): string | null {
  return complaints.reduce<string | null>((latest, complaint) => complaint.status === "resolved" && complaint.resolvedAt && (!latest || complaint.resolvedAt > latest) ? complaint.resolvedAt : latest, null);
}

export interface BlockingFulfilmentComplaint {
  readonly complaintId: string;
  readonly reservationId: string;
  readonly category: ComplaintCategory;
  readonly status: "open" | "under_human_review" | "resolved";
  readonly revenueHeld: true;
  /** Set when platform support dismisses the complaint (issue 10): when, and the fixed reason code. */
  readonly resolvedAt?: string;
  readonly resolution?: ComplaintDismissalReason;
  readonly safeSummary?: string;
  readonly evidenceReferences: readonly string[];
  readonly openedAt: string;
}

/** Everything the manager holds for one Reservation: ids, times, statuses and codes only (ADR 0075). */
export interface CheckInSupportState {
  readonly schedule: HumanSupportSchedule | null;
  readonly window: CheckInWindow | null;
  readonly evidence: readonly StoredEvidence[];
  readonly result: VerifiedAccessResult | null;
  readonly complaints: readonly BlockingFulfilmentComplaint[];
}

/** Durable check-in state, so Verified Access and open complaints survive a restart and are shared across processes. */
export interface CheckInSupportStore {
  load(reservationId: string): CheckInSupportState | null;
  save(reservationId: string, state: CheckInSupportState): void;
}

export class SqliteCheckInSupportStore implements CheckInSupportStore {
  readonly #database: import("node:sqlite").DatabaseSync;

  constructor(database: import("node:sqlite").DatabaseSync) {
    this.#database = database;
    this.#database.exec("CREATE TABLE IF NOT EXISTS checkin_support_state (reservation_id TEXT PRIMARY KEY, state_json TEXT NOT NULL)");
  }

  load(reservationId: string): CheckInSupportState | null {
    const row = this.#database.prepare("SELECT state_json FROM checkin_support_state WHERE reservation_id = $id").get({ $id: reservationId }) as { state_json?: unknown } | undefined;
    if (!row || typeof row.state_json !== "string") return null;
    try {
      const parsed: unknown = JSON.parse(row.state_json);
      if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { evidence?: unknown }).evidence) || !Array.isArray((parsed as { complaints?: unknown }).complaints)) return null;
      return parsed as CheckInSupportState;
    } catch { return null; }
  }

  save(reservationId: string, state: CheckInSupportState): void {
    this.#database.prepare("INSERT INTO checkin_support_state (reservation_id, state_json) VALUES ($id, $json) ON CONFLICT(reservation_id) DO UPDATE SET state_json = excluded.state_json").run({ $id: reservationId, $json: JSON.stringify(state) });
  }
}

/** CONTEXT.md Check-In Protection Window: the 24 hours after Verified Access (ADR 0022). */
export const CHECK_IN_PROTECTION_WINDOW_HOURS = 24;

/**
 * ADR 0089: the owner payable becomes due 24 hours after Verified Access, provided no Blocking Fulfilment
 * Complaint is open. The window starts at the later of contractual check-in and access provision (ADR 0022).
 */
export function ownerPayableDueAt(protectionWindowStartsAt: string): string {
  return new Date(Date.parse(protectionWindowStartsAt) + CHECK_IN_PROTECTION_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
}

const MIN_ARRIVAL_MINUTES = 14 * 60;
const MAX_ARRIVAL_MINUTES = 22 * 60;

/**
 * A unit's Contractual Check-In Window (ADR 0031): earliest access and latest permitted arrival, Africa/Lagos,
 * inside 2:00 PM–10:00 PM. Units publish it; offers and Booking Contracts capture it as a snapshot.
 */
export interface ContractualCheckInWindow {
  readonly earliestAccessTime: string;
  readonly latestPermittedArrival: string;
  readonly timezone: "Africa/Lagos";
}

/** The window if it is well formed and inside the ADR 0031 boundary; otherwise null. */
export function contractualCheckInWindow(value: unknown): ContractualCheckInWindow | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.earliestAccessTime !== "string" || typeof candidate.latestPermittedArrival !== "string" || candidate.timezone !== "Africa/Lagos") return null;
  const start = parseTime(candidate.earliestAccessTime);
  const end = parseTime(candidate.latestPermittedArrival);
  if (start < MIN_ARRIVAL_MINUTES || end > MAX_ARRIVAL_MINUTES || start > end) return null;
  return Object.freeze({ earliestAccessTime: candidate.earliestAccessTime, latestPermittedArrival: candidate.latestPermittedArrival, timezone: "Africa/Lagos" });
}
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
  readonly #store?: CheckInSupportStore;

  constructor(options: { windowProvider: CheckInWindowProvider; assignmentProvider: CheckInSupportAssignmentProvider; reservationProvider?: CheckInReservationProvider; humanOwnership?: CheckInHumanOwnershipPort; audit?: { record(entry: Record<string, unknown>): void }; store?: CheckInSupportStore }) {
    this.#windowsProvider = options.windowProvider;
    this.#assignments = options.assignmentProvider;
    this.#reservations = options.reservationProvider;
    this.#ownership = options.humanOwnership;
    this.#audit = options.audit;
    this.#store = options.store;
  }

  /** Re-reads one Reservation's state from the store, so another process's writes are seen (no stale cache). */
  #hydrate(reservationId: string): void {
    const state = this.#store?.load(reservationId);
    if (!state) return;
    if (state.schedule) this.#schedules.set(reservationId, { ...state.schedule }); else this.#schedules.delete(reservationId);
    if (state.window) this.#windows.set(reservationId, state.window); else this.#windows.delete(reservationId);
    this.#evidence.set(reservationId, [...state.evidence]);
    if (state.result) this.#results.set(reservationId, state.result); else this.#results.delete(reservationId);
    this.#complaints.set(reservationId, [...state.complaints]);
  }

  #persist(reservationId: string): void {
    this.#store?.save(reservationId, {
      schedule: this.#schedules.get(reservationId) ?? null,
      window: this.#windows.get(reservationId) ?? null,
      evidence: this.#evidence.get(reservationId) ?? [],
      result: this.#results.get(reservationId) ?? null,
      complaints: this.#complaints.get(reservationId) ?? [],
    });
  }

  scheduleHumanSupport(envelope: PlatformCommandEnvelope<{ reservationId: string }>, clock: () => Date = () => new Date()): HumanSupportSchedule {
    if (!envelope || envelope.commandName !== "checkin_support.schedule") throw new Error("Invalid check-in support schedule command");
    if (!VALID_ROLES.has(envelope.principal.role)) throw new Error("Only trusted operational principals may schedule Human Incident Support");
    const window = this.#windowsProvider.getWindow(envelope.payload.reservationId);
    assertWindow(window);
    const assignment = this.#assignments.assign(envelope.payload.reservationId);
    if (!assignment.assignedResponderId || !assignment.backupResponderId) throw new Error("Human Incident Support coverage is incomplete");
    const schedule: HumanSupportSchedule = { reservationId: envelope.payload.reservationId, assignedResponderId: assignment.assignedResponderId, backupResponderId: assignment.backupResponderId, activeFrom: absoluteLagos(window.checkInDate, window.earliestAccessTime), activeUntil: absoluteLagos(window.checkInDate, window.latestPermittedArrival), status: "scheduled" };
    this.#schedules.set(schedule.reservationId, schedule); this.#windows.set(schedule.reservationId, window); this.#persist(schedule.reservationId);
    this.#audit?.record({ type: "checkin_support.scheduled", reservationId: schedule.reservationId, scheduledAt: clock().toISOString() });
    return { ...schedule };
  }

  escalateIncident(envelope: PlatformCommandEnvelope<{ reservationId: string; category: ComplaintCategory }>, clock: () => Date = () => new Date()): HumanSupportSchedule {
    if (!envelope || envelope.commandName !== "checkin_support.escalate") throw new Error("Invalid check-in escalation command");
    this.#hydrate(envelope.payload.reservationId);
    const schedule = this.#schedules.get(envelope.payload.reservationId); if (!schedule) throw new Error("Support schedule not found");
    schedule.status = "handoff_requested"; this.#persist(schedule.reservationId);
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
    const result = this.#evaluate(reservationId, clock()); this.#results.set(reservationId, result); this.#persist(reservationId);
    this.#audit?.record({ type: "checkin_support.evidence_recorded", reservationId, evidenceSource: evidence.source, status: result.status, recordedAt: clock().toISOString() });
    if (result.status === "failed_access" || result.status === "under_human_review") this.#ownership?.requestHumanOwnership({ reservationId, category: "access_failure", minimizedContext: {} });
    return { ...result };
  }
  confirmGuestAccess(envelope: PlatformCommandEnvelope<{ reservationId: string }>, clock: () => Date = () => new Date()): VerifiedAccessResult {
    if (!envelope || envelope.commandName !== "checkin_support.confirm_access") throw new Error("Invalid guest access confirmation command");
    if (Object.keys(envelope.payload).some((key) => key !== "reservationId")) throw new Error("Guest access confirmation accepts only reservationId");
    this.#assertReservation(envelope.payload.reservationId, envelope.principal); this.#hydrate(envelope.payload.reservationId);
    const now = clock(); return this.#record(envelope.payload.reservationId, { evidenceId: envelope.commandId, source: "guest_confirmation", validAccess: true, failedAccess: false, positiveAtContractualCheckIn: false, provisionedAt: now.toISOString() }, clock);
  }
  recordAccessSystemEvidence(envelope: PlatformCommandEnvelope<{ reservationId: string; provisionedAt: string; validAccess: boolean; failedAccess: boolean }>, clock: () => Date = () => new Date()): VerifiedAccessResult {
    if (!envelope || envelope.commandName !== "checkin_support.access_system_event" || envelope.principal.role !== "system") throw new Error("Trusted access-system evidence is required");
    this.#hydrate(envelope.payload.reservationId);
    return this.#record(envelope.payload.reservationId, { evidenceId: envelope.commandId, source: "access_system_event", ...envelope.payload, positiveAtContractualCheckIn: false }, clock);
  }
  recordSupportVerification(envelope: PlatformCommandEnvelope<{ reservationId: string; provisionedAt?: string; validAccess: boolean; failedAccess: boolean; positiveAtContractualCheckIn: boolean; basis?: SupportVerificationBasis }>, clock: () => Date = () => new Date()): VerifiedAccessResult {
    if (!envelope || envelope.commandName !== "checkin_support.support_verification" || !["system", "admin", "authorized_staff"].includes(envelope.principal.role)) throw new Error("Authorized support verification is required");
    if (envelope.payload.basis !== undefined && !isSupportVerificationBasis(envelope.payload.basis)) throw new Error("Unknown support verification basis");
    this.#hydrate(envelope.payload.reservationId);
    if (envelope.payload.validAccess) {
      // ADR 0091: Verified Access is recorded once, and never before the Contractual Check-In Window begins.
      const current = this.#results.get(envelope.payload.reservationId)?.status;
      if (current === "verified_access" || current === "late_voluntary_arrival") throw new Error("Verified Access is already recorded for this Reservation");
      const window = this.#windows.get(envelope.payload.reservationId);
      if (window && clock().getTime() < new Date(absoluteLagos(window.checkInDate, window.earliestAccessTime)).getTime()) throw new Error("Verified Access cannot be recorded before the Contractual Check-In Window begins");
    }
    return this.#record(envelope.payload.reservationId, { evidenceId: envelope.commandId, source: "support_verification", ...envelope.payload }, clock);
  }
  recordOperatorAssertion(envelope: PlatformCommandEnvelope<{ reservationId: string }>): VerifiedAccessResult {
    if (!envelope || envelope.commandName !== "checkin_support.operator_assertion" || envelope.principal.role !== "operator") throw new Error("Operator assertion requires an Operator principal");
    this.#hydrate(envelope.payload.reservationId);
    const list = this.#evidence.get(envelope.payload.reservationId) ?? []; list.push({ evidenceId: envelope.commandId, source: "operator_assertion", validAccess: false, failedAccess: false, positiveAtContractualCheckIn: false }); this.#evidence.set(envelope.payload.reservationId, list);
    const result = { reservationId: envelope.payload.reservationId, status: "awaiting_access" as const }; this.#results.set(envelope.payload.reservationId, result); this.#persist(envelope.payload.reservationId); return result;
  }
  raiseBlockingComplaint(envelope: PlatformCommandEnvelope<{ reservationId: string; category: ComplaintCategory; safeSummary?: string; evidenceReferences?: readonly string[] }>, clock: () => Date = () => new Date()): BlockingFulfilmentComplaint {
    if (!envelope || envelope.commandName !== "checkin_support.report_problem") throw new Error("Invalid blocking complaint command");
    this.#assertReservation(envelope.payload.reservationId, envelope.principal); this.#hydrate(envelope.payload.reservationId); this.#requireScheduled(envelope.payload.reservationId);
    const existing = (this.#complaints.get(envelope.payload.reservationId) ?? []).find((c) => c.status !== "resolved" && c.category === envelope.payload.category);
    if (existing) return { ...existing };
    const now = clock(); const complaint: BlockingFulfilmentComplaint = { complaintId: this.#complaintId(envelope.payload.reservationId, envelope.payload.category), reservationId: envelope.payload.reservationId, category: envelope.payload.category, status: "open", revenueHeld: true, ...(envelope.payload.safeSummary ? { safeSummary: envelope.payload.safeSummary.slice(0, 500) } : {}), evidenceReferences: Object.freeze([...(envelope.payload.evidenceReferences ?? [])].slice(0, 10)), openedAt: now.toISOString() };
    this.#complaints.set(envelope.payload.reservationId, [...(this.#complaints.get(envelope.payload.reservationId) ?? []), complaint]); this.#persist(envelope.payload.reservationId);
    this.#ownership?.requestHumanOwnership({ reservationId: complaint.reservationId, category: complaint.category, minimizedContext: { complaintId: complaint.complaintId, ...(complaint.safeSummary ? { safeSummary: complaint.safeSummary } : {}) } });
    this.#audit?.record({ type: "checkin_support.blocking_complaint_raised", complaintId: complaint.complaintId, reservationId: complaint.reservationId, complaintType: complaint.category, raisedAt: complaint.openedAt });
    return { ...complaint };
  }
  /**
   * ADR 0091: platform support reports a Blocking Fulfilment Complaint for a Reservation it supports.
   * A fixed category only; no summary text (ADR 0075). Idempotent per open category, like the Guest path.
   */
  reportBlockingComplaintAsSupport(envelope: PlatformCommandEnvelope<{ reservationId: string; category: ComplaintCategory }>, clock: () => Date = () => new Date()): BlockingFulfilmentComplaint {
    if (!envelope || envelope.commandName !== "checkin_support.support_report_problem" || !VALID_ROLES.has(envelope.principal.role)) throw new Error("Authorized support is required to report a blocking complaint");
    if (Object.keys(envelope.payload).some((key) => key !== "reservationId" && key !== "category")) throw new Error("Support complaints accept only reservationId and category");
    this.#hydrate(envelope.payload.reservationId); this.#requireScheduled(envelope.payload.reservationId);
    const existing = (this.#complaints.get(envelope.payload.reservationId) ?? []).find((c) => c.status !== "resolved" && c.category === envelope.payload.category);
    if (existing) return { ...existing };
    const now = clock(); const complaint: BlockingFulfilmentComplaint = { complaintId: this.#complaintId(envelope.payload.reservationId, envelope.payload.category), reservationId: envelope.payload.reservationId, category: envelope.payload.category, status: "open", revenueHeld: true, evidenceReferences: Object.freeze([]), openedAt: now.toISOString() };
    this.#complaints.set(envelope.payload.reservationId, [...(this.#complaints.get(envelope.payload.reservationId) ?? []), complaint]); this.#persist(envelope.payload.reservationId);
    this.#ownership?.requestHumanOwnership({ reservationId: complaint.reservationId, category: complaint.category, minimizedContext: { complaintId: complaint.complaintId } });
    this.#audit?.record({ type: "checkin_support.blocking_complaint_raised", complaintId: complaint.complaintId, reservationId: complaint.reservationId, complaintType: complaint.category, raisedAt: complaint.openedAt, source: "support" });
    return { ...complaint };
  }
  /**
   * Issue 10: platform support dismisses an open complaint that did not hold up, with a fixed reason and no free text
   * (ADR 0075, 0091). Unknown or already-closed complaints are refused.
   */
  dismissBlockingComplaintAsSupport(envelope: PlatformCommandEnvelope<{ reservationId: string; complaintId: string; reason: ComplaintDismissalReason }>, clock: () => Date = () => new Date()): BlockingFulfilmentComplaint {
    if (!envelope || envelope.commandName !== "checkin_support.support_dismiss_complaint" || !VALID_ROLES.has(envelope.principal.role)) throw new Error("Authorized support is required to dismiss a blocking complaint");
    if (Object.keys(envelope.payload).some((key) => !["reservationId", "complaintId", "reason"].includes(key))) throw new Error("Complaint dismissal accepts only reservationId, complaintId and reason");
    if (!isComplaintDismissalReason(envelope.payload.reason)) throw new Error("Unknown complaint dismissal reason");
    this.#hydrate(envelope.payload.reservationId);
    const complaints = this.#complaints.get(envelope.payload.reservationId) ?? [];
    const complaint = complaints.find((candidate) => candidate.complaintId === envelope.payload.complaintId);
    if (!complaint) throw new Error("Blocking complaint not found");
    if (complaint.status === "resolved") throw new Error("Blocking complaint is already resolved");
    const resolved: BlockingFulfilmentComplaint = { ...complaint, status: "resolved", resolvedAt: clock().toISOString(), resolution: envelope.payload.reason };
    this.#complaints.set(envelope.payload.reservationId, complaints.map((candidate) => candidate === complaint ? resolved : candidate)); this.#persist(envelope.payload.reservationId);
    this.#audit?.record({ type: "checkin_support.blocking_complaint_dismissed", complaintId: resolved.complaintId, reservationId: resolved.reservationId, reason: envelope.payload.reason, resolvedAt: resolved.resolvedAt, source: "support" });
    return { ...resolved };
  }
  /** One id per complaint: a category reported again after a dismissal gets a numbered id. */
  #complaintId(reservationId: string, category: ComplaintCategory): string {
    const base = `cmpl_${reservationId}_${category}`;
    const taken = new Set((this.#complaints.get(reservationId) ?? []).map((complaint) => complaint.complaintId));
    let id = base;
    for (let n = 2; taken.has(id); n += 1) id = `${base}_${n}`;
    return id;
  }
  hasUnresolvedBlockingComplaint(reservationId: string): boolean { this.#hydrate(reservationId); return (this.#complaints.get(reservationId) ?? []).some((c) => c.status !== "resolved"); }
  projectCheckInStatusForGuest(reservationId: string, principal: CommandPrincipal) {
    const reservation = this.#reservations?.getReservation(reservationId);
    if (!reservation || !isGuestFor(reservation, principal)) throw new Error("Access denied or reservation not found");
    return this.projectCheckInStatus(reservationId);
  }
  projectCheckInStatus(reservationId: string): { readonly reservationId: string; readonly checkInWindow: CheckInWindow; readonly supportOwnership: HumanSupportSchedule; readonly accessResult: VerifiedAccessResult; readonly activeComplaints: readonly BlockingFulfilmentComplaint[]; readonly revenueHeld: boolean } {
    this.#hydrate(reservationId);
    const schedule = this.#schedules.get(reservationId); const window = this.#windows.get(reservationId); if (!schedule || !window) throw new Error("No check-in support scheduled");
    const result = this.#results.get(reservationId) ?? { reservationId, status: "awaiting_access" as const }; const complaints = this.#complaints.get(reservationId) ?? [];
    return { reservationId, checkInWindow: { ...window }, supportOwnership: { ...schedule }, accessResult: { ...result }, activeComplaints: Object.freeze(complaints.map((c) => ({ ...c }))), revenueHeld: this.hasUnresolvedBlockingComplaint(reservationId) };
  }
}
