export type CheckoutTime = "11:00" | "12:00" | "13:00" | "14:00";
export type LateCheckoutTime = Exclude<CheckoutTime, "11:00">;

export interface CheckoutOverstayDeps {
  hasSameDayArrival: (reservationId: string, checkoutDate: string) => boolean;
  hasMaintenanceOrInspection: (reservationId: string, checkoutDate: string) => boolean;
  hasTurnoverCapacity: (reservationId: string, checkoutDate: string) => boolean;
  hasSupportAvailability: (reservationId: string, checkoutDate: string) => boolean;
  operatorApproved: (reservationId: string, requestedTime: LateCheckoutTime) => boolean;
}
export interface LateCheckoutEligibilityResult { readonly eligible: boolean; readonly requestedTime: string; readonly reason?: string; }
export interface CheckoutSchedule { readonly reservationId: string; readonly contractualCheckoutTime: CheckoutTime; readonly contractualCheckoutIso: string; readonly accessExpiryIso: string; readonly turnoverStartIso: string; readonly depositClaimDeadlineIso: string; readonly remindersIso: readonly string[]; }
export type OverstayRemedyBasis = "late_checkout_pricing_or_evidenced_cost" | "one_nightly_amount_plus_evidenced_direct_losses";
export interface SafeEvidenceReference { readonly evidenceId: string; readonly source: string; }
export interface OverstayIncident { readonly incidentId: string; readonly reservationId: string; readonly status: "open_incident" | "resolved" | "escalated"; readonly evidenceReferences: readonly SafeEvidenceReference[]; readonly consequences: { readonly standardized: true; readonly duplicativeChargesProhibited: true; readonly arbitraryPenaltyProhibited: true; }; readonly remedyBasis: OverstayRemedyBasis; readonly humanSafetyEscalation: boolean; readonly targetQueue?: "Active-Stay Emergency Support (24/7)"; }

const LATE_TIMES: readonly LateCheckoutTime[] = ["12:00", "13:00", "14:00"];
const CHECKOUT_TIMES: readonly CheckoutTime[] = ["11:00", ...LATE_TIMES];
function validDate(value: string): boolean { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const parsed = new Date(`${value}T00:00:00.000Z`); return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value; }
function validTime(value: string): value is CheckoutTime { return CHECKOUT_TIMES.includes(value as CheckoutTime) && /^([01]\d|2[0-3]):[0-5]\d$/.test(value); }
function checkoutIso(date: string, time: CheckoutTime): string {
  if (!validDate(date) || !validTime(time)) throw new Error("Checkout date and time must be valid Africa/Lagos values");
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), hours - 1, minutes)).toISOString();
}

/** ADR 0032/0033/0034/0060: the single framework-neutral checkout authority. */
export class CheckoutOverstayManager {
  readonly #deps: CheckoutOverstayDeps;
  readonly #incidents = new Map<string, OverstayIncident>();
  constructor(deps: CheckoutOverstayDeps) { this.#deps = deps; }
  evaluateLateCheckoutEligibility(input: { reservationId: string; requestedTime: string; checkoutDate: string; currentCheckoutTime?: CheckoutTime }): LateCheckoutEligibilityResult {
    const { reservationId, requestedTime, checkoutDate, currentCheckoutTime = "11:00" } = input;
    if (!validDate(checkoutDate)) return { eligible: false, requestedTime, reason: "Invalid checkout date." };
    if (!LATE_TIMES.includes(requestedTime as LateCheckoutTime)) return { eligible: false, requestedTime, reason: "Late checkout capped at 14:00 WAT. Only 12:00, 13:00, or 14:00 WAT increments available." };
    if (!validTime(currentCheckoutTime) || requestedTime <= currentCheckoutTime) return { eligible: false, requestedTime, reason: "Requested checkout time must be later than the authoritative effective checkout." };
    if (this.#deps.hasSameDayArrival(reservationId, checkoutDate)) return { eligible: false, requestedTime, reason: "Late checkout is prohibited for same-day incoming reservation." };
    if (this.#deps.hasMaintenanceOrInspection(reservationId, checkoutDate)) return { eligible: false, requestedTime, reason: "Conflicting maintenance or inspection scheduled." };
    if (!this.#deps.hasTurnoverCapacity(reservationId, checkoutDate)) return { eligible: false, requestedTime, reason: "Turnover capacity not available for late checkout." };
    if (!this.#deps.hasSupportAvailability(reservationId, checkoutDate)) return { eligible: false, requestedTime, reason: "Platform human support not available for requested timeframe." };
    if (!this.#deps.operatorApproved(reservationId, requestedTime as LateCheckoutTime)) return { eligible: false, requestedTime, reason: "Operator declined late checkout request." };
    return { eligible: true, requestedTime };
  }
  calculateCheckoutSchedule(input: { reservationId: string; checkoutDate: string; contractualCheckoutTime?: string }): CheckoutSchedule {
    const time = input.contractualCheckoutTime ?? "11:00";
    if (!validTime(time)) throw new Error("Checkout time must be 11:00, 12:00, 13:00, or 14:00 WAT");
    const iso = checkoutIso(input.checkoutDate, time);
    const deadline = new Date(iso).getTime();
    return { reservationId: input.reservationId, contractualCheckoutTime: time, contractualCheckoutIso: iso, accessExpiryIso: iso, turnoverStartIso: iso, depositClaimDeadlineIso: new Date(deadline + 86400000).toISOString(), remindersIso: [new Date(deadline - 3600000).toISOString()] };
  }
  processCheckoutExtensionRequest(request: { reservationId: string; method: string; note?: string; amountKobo?: number }): void {
    if (request.method === "informal_chat") throw new Error("Informal messages cannot amend checkout. Material terms change only through versioned platform amendments.");
    if (request.method === "cash_or_direct_transfer") throw new Error("Cash or direct transfers cannot extend checkout or create charges.");
    if (request.method !== "versioned_amendment") throw new Error(`Unsupported extension method: ${request.method}`);
  }
  openOverstayIncident(input: { reservationId: string; checkoutDate: string; contractualCheckoutTime: string; currentIso: string; evidenceReferences?: readonly SafeEvidenceReference[] }): OverstayIncident {
    const schedule = this.calculateCheckoutSchedule({ reservationId: input.reservationId, checkoutDate: input.checkoutDate, contractualCheckoutTime: input.contractualCheckoutTime });
    const currentTime = new Date(input.currentIso).getTime();
    if (!Number.isFinite(currentTime)) throw new Error("Current time must be a valid ISO timestamp.");
    if (currentTime <= new Date(schedule.contractualCheckoutIso).getTime()) throw new Error("Overstay cannot open at or before the effective checkout deadline.");
    const incidentId = `overstay:${input.reservationId}`;
    const existing = this.#incidents.get(incidentId);
    if (existing) return { ...existing, remedyBasis: new Date(input.currentIso).getTime() > new Date(`${input.checkoutDate}T13:00:00.000Z`).getTime() ? "one_nightly_amount_plus_evidenced_direct_losses" : existing.remedyBasis };
    const references = (input.evidenceReferences ?? []).filter((reference) => /^[A-Za-z0-9:_-]{1,80}$/.test(reference.evidenceId) && /^[A-Za-z0-9:_-]{1,80}$/.test(reference.source));
    const incident: OverstayIncident = { incidentId, reservationId: input.reservationId, status: "open_incident", evidenceReferences: references.map(({ evidenceId, source }) => ({ evidenceId, source })), consequences: { standardized: true, duplicativeChargesProhibited: true, arbitraryPenaltyProhibited: true }, remedyBasis: new Date(input.currentIso).getTime() > new Date(`${input.checkoutDate}T13:00:00.000Z`).getTime() ? "one_nightly_amount_plus_evidenced_direct_losses" : "late_checkout_pricing_or_evidenced_cost", humanSafetyEscalation: false };
    this.#incidents.set(incidentId, incident); return { ...incident };
  }
  escalateOverstaySafetyIncident(incidentId: string, assessment: { requiresHumanSafetyEscalation: boolean; assessmentVersion: string }): OverstayIncident {
    const incident = this.#incidents.get(incidentId); if (!incident) throw new Error(`Incident not found: ${incidentId}`);
    const requiresEscalation = assessment.requiresHumanSafetyEscalation;
    if (requiresEscalation) { const next = { ...incident, status: "escalated" as const, humanSafetyEscalation: true, targetQueue: "Active-Stay Emergency Support (24/7)" as const }; this.#incidents.set(incidentId, next); return { ...next }; }
    return { ...incident };
  }
}
export { checkoutIso as effectiveCheckoutIso };
