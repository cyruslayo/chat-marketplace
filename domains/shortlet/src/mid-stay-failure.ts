import { createHash } from "node:crypto";
import type { BookingContract, Reservation } from "./card-payment.js";

export type MidStayFailureCategory = "safety_access_habitability" | "essential_amenity" | "material_advertised_amenity" | "minor_impact";
export type MidStayIncidentStatus = "reported" | "assessment_pending" | "cure_pending" | "human_review" | "remedy_determined" | "dismissed" | "closed";
export type CausationStatus = "established" | "not_established" | "under_review";
export type CureStatus = "not_cured" | "cured" | "under_review";

export interface NightlyLineItem { readonly nightDateIso: string; readonly rateKobo: number; }
export interface AttributableCharges { readonly cleaningFeeKobo?: number; readonly unprovidedServicesKobo?: number; readonly taxKobo?: number; }

/** Compatibility-only pure calculation input. Production commands use the provider seams below. */
export interface RemedyCalculationInput { category: MidStayFailureCategory; failureStartedAtIso: string; curedAtIso?: string; checkedAtIso?: string; affectedNightDates?: string[]; delayedReportingReason?: string; delayedReportingJustified?: boolean; overnightImpact?: boolean; nightlyLineItems: NightlyLineItem[]; attributableCharges?: AttributableCharges; }
export interface RemedyResult { category: MidStayFailureCategory; percentage: number; nightlyRefundKobo: number; attributableChargesRefundKobo: number; totalRefundKobo: number; reportingDelayExcused: boolean; cureWindowExceeded: boolean; }

export interface MidStayEvidenceProvider { assessEvidence(input: { reservationId: string; evidenceReferenceIds: readonly string[] }): { evidenceSetId: string; evidenceVersion: string; status: "sufficient" | "insufficient" | "requires_human_review"; safeSummary?: string }; }
export interface MidStayFailureAssessment { assessmentVersion: string; reservationId: string; evidenceSetId: string; contractVersion: number; category: MidStayFailureCategory; failureStartedAt: string; affectedNightDates: readonly string[]; unusedNightDates: readonly string[]; materiallyUnusableNightDates: readonly string[]; overnightImpact: boolean; materialIncident: boolean; causationVersion: string; causationStatus: CausationStatus; reportingDelayExcused: boolean; currentImpact: "none" | "ongoing" | "cured"; repeatedOrMaterialMinor: boolean; }
export interface MidStayFailureAssessmentProvider { assess(input: { reservationId: string; contract: BookingContract; evidence: ReturnType<MidStayEvidenceProvider["assessEvidence"]>; reportedAt: string; problemHint?: string }): MidStayFailureAssessment; }
export interface MidStayCureProvider { getStatus(input: { incidentId: string; reservationId: string }): { cureVersion: string; status: CureStatus; curedAt?: string }; }
export interface MidStayEconomics { economicsVersion: string; currency: "NGN"; nightlyLineItems: readonly NightlyLineItem[]; attributableUndeliveredChargesKobo: number; attributableRefundableTaxKobo: number; }
export interface MidStayEconomicsProvider { getEconomics(input: { reservationId: string; contract: BookingContract }): MidStayEconomics; }
export interface MidStayHumanDecision { decisionId: string; decisionVersion: string; incidentId: string; incidentVersion: number; assessmentVersion: string; evidenceVersion: string; economicsVersion: string; decision: "accept_remedy" | "dismiss"; valid: boolean; }
export interface MidStayHumanDecisionProvider { getDecision(input: { incidentId: string; reservationId: string }): MidStayHumanDecision | null; }
export interface ActiveStayState { version: string; status: "awaiting_access" | "verified_access" | "late_voluntary_arrival" | "failed_access" | "under_human_review"; }
export interface ActiveStayProvider { getStatus(reservationId: string): ActiveStayState; }

export interface MidStayIncidentRecord {
  readonly incidentId: string; readonly reservationId: string; readonly contractVersion: number; readonly incidentVersion: number;
  readonly status: MidStayIncidentStatus; readonly reportedAt: string; readonly evidenceSetId: string; readonly evidenceVersion: string; readonly evidenceStatus: "sufficient" | "insufficient" | "requires_human_review";
  readonly assessment?: MidStayFailureAssessment; readonly cure?: ReturnType<MidStayCureProvider["getStatus"]>; readonly economics?: MidStayEconomics;
  readonly remedy?: RemedyResult & { readonly attributableUndeliveredChargesKobo: number; readonly attributableRefundableTaxKobo: number; readonly currency: "NGN" };
  readonly humanOwned: boolean;
}
export interface MidStayIncidentRepository { findByReservationId(reservationId: string): MidStayIncidentRecord | null; findByIncidentId(incidentId: string): MidStayIncidentRecord | null; createIfAbsent(record: MidStayIncidentRecord): MidStayIncidentRecord; update(incidentId: string, expectedIncidentVersion: number, mutation: (current: MidStayIncidentRecord) => MidStayIncidentRecord): MidStayIncidentRecord; }
export class InMemoryMidStayIncidentRepository implements MidStayIncidentRepository {
  readonly #records = new Map<string, MidStayIncidentRecord>();
  findByReservationId(id: string) { return [...this.#records.values()].find((r) => r.reservationId === id) ?? null; }
  findByIncidentId(id: string) { return this.#records.get(id) ?? null; }
  createIfAbsent(record: MidStayIncidentRecord) { const existing = this.#records.get(record.incidentId); if (existing) { if (existing.reservationId !== record.reservationId) throw new Error("Incident identity mismatch"); return existing; } const byReservation = this.findByReservationId(record.reservationId); if (byReservation && byReservation.incidentId !== record.incidentId) throw new Error("Reservation already has a current incident"); this.#records.set(record.incidentId, Object.freeze({ ...record })); return record; }
  update(incidentId: string, expected: number, mutation: (current: MidStayIncidentRecord) => MidStayIncidentRecord) { const current = this.#records.get(incidentId); if (!current || current.incidentVersion !== expected) throw new Error("STALE_ACTION"); const next = mutation(current); if (next.incidentId !== current.incidentId || next.reservationId !== current.reservationId) throw new Error("Incident identity cannot change"); if (next.incidentVersion !== expected + 1) throw new Error("Invalid incident version"); this.#records.set(current.incidentId, Object.freeze({ ...next })); return next; }
}
export class MidStayBlockingComplaintQuery { constructor(private readonly repository: MidStayIncidentRepository) {} hasUnresolvedBlockingComplaint(reservationId: string): boolean { const incident = this.repository.findByReservationId(reservationId); return !!incident?.assessment?.materialIncident && !["dismissed", "closed"].includes(incident.status); } }

function percentage(category: MidStayFailureCategory, elapsedMs: number, overnight: boolean, repeatedMinor: boolean): number | null {
  if (category === "safety_access_habitability") return 100;
  if (category === "essential_amenity") { if (elapsedMs < 2 * 3600000) return 0; if (elapsedMs <= 6 * 3600000 && !overnight) return 25; return 50; }
  if (category === "material_advertised_amenity") { if (elapsedMs < 4 * 3600000) return 0; return elapsedMs <= 12 * 3600000 ? 10 : 20; }
  return repeatedMinor ? null : 0;
}
export function calculateAuthoritativeRemedy(input: { assessment: MidStayFailureAssessment; cure: ReturnType<MidStayCureProvider["getStatus"]>; economics: MidStayEconomics; now: Date }): RemedyResult & { attributableUndeliveredChargesKobo: number; attributableRefundableTaxKobo: number; currency: "NGN" } {
  const end = input.cure.status === "cured" && input.cure.curedAt ? new Date(input.cure.curedAt).getTime() : input.now.getTime();
  const elapsed = Math.max(0, end - new Date(input.assessment.failureStartedAt).getTime());
  const p = percentage(input.assessment.category, elapsed, input.assessment.overnightImpact, input.assessment.repeatedOrMaterialMinor);
  const eligible = input.assessment.category === "safety_access_habitability" ? new Set([...input.assessment.unusedNightDates, ...input.assessment.materiallyUnusableNightDates]) : new Set(input.assessment.affectedNightDates);
  const items = input.economics.nightlyLineItems.filter((item) => eligible.has(item.nightDateIso));
  const rate = p ?? 0; const nightly = items.reduce((sum, item) => sum + Math.floor(item.rateKobo * rate / 100), 0);
  const automatic = p !== null;
  return { category: input.assessment.category, percentage: automatic ? rate : 0, nightlyRefundKobo: nightly, attributableChargesRefundKobo: automatic ? input.economics.attributableUndeliveredChargesKobo + input.economics.attributableRefundableTaxKobo : 0, totalRefundKobo: nightly + (automatic ? input.economics.attributableUndeliveredChargesKobo + input.economics.attributableRefundableTaxKobo : 0), reportingDelayExcused: input.assessment.reportingDelayExcused, cureWindowExceeded: input.assessment.category === "safety_access_habitability" || (input.assessment.category === "essential_amenity" ? elapsed >= 2 * 3600000 : input.assessment.category === "material_advertised_amenity" ? elapsed >= 4 * 3600000 : false), attributableUndeliveredChargesKobo: input.economics.attributableUndeliveredChargesKobo, attributableRefundableTaxKobo: input.economics.attributableRefundableTaxKobo, currency: "NGN" };
}

export class MidStayFailureManager {
  calculateRemedy(input: RemedyCalculationInput): RemedyResult {
    const start = new Date(input.failureStartedAtIso).getTime(); const end = input.curedAtIso ? new Date(input.curedAtIso).getTime() : input.checkedAtIso ? new Date(input.checkedAtIso).getTime() : start;
    const p = percentage(input.category, Math.max(0, end - start), !!input.overnightImpact, false) ?? 0; const dates = new Set(input.affectedNightDates ?? input.nightlyLineItems.map((i) => i.nightDateIso)); const items = input.nightlyLineItems.filter((i) => dates.has(i.nightDateIso)); const nightly = items.reduce((sum, i) => sum + Math.floor(i.rateKobo * p / 100), 0); const charges = p === 100 ? (input.attributableCharges?.cleaningFeeKobo ?? 0) + (input.attributableCharges?.unprovidedServicesKobo ?? 0) + (input.attributableCharges?.taxKobo ?? 0) : 0;
    return { category: input.category, percentage: p, nightlyRefundKobo: nightly, attributableChargesRefundKobo: charges, totalRefundKobo: nightly + charges, reportingDelayExcused: !!input.delayedReportingReason && (input.category === "safety_access_habitability" || input.delayedReportingJustified === true), cureWindowExceeded: p > 0 };
  }
}
export function midStayIncidentId(reservationId: string): string { return `mid-stay-failure:${reservationId}`; }
export function midStayProjectionVersion(markers: unknown): string { return createHash("sha256").update(JSON.stringify(markers)).digest("hex"); }
export type { BookingContract, Reservation };
