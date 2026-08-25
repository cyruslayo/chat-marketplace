import { createHash } from "node:crypto";
import type { PlatformCommandEnvelope, CommandPrincipal } from "../../../packages/platform-core/src/index.js";

export type VisitorMode = "prohibited" | "registered_8am_10pm";
export const LAUNCH_QUIET_HOURS = "22:00–08:00";
export const LAUNCH_TIMEZONE = "Africa/Lagos";

export interface UnitConductPolicy {
  readonly unitId: string;
  readonly visitorsMode: VisitorMode;
  readonly petsAllowed: boolean;
  readonly petTermsDisclosed?: boolean;
  readonly childrenRestriction?: { readonly inspectionEvidenceId: string; readonly summary: string };
  /** Legacy input retained only to fail closed; standardized rules are not configurable. */
  readonly childrenAllowed?: boolean;
  readonly quietHours?: string;
  readonly customCashFineKobo?: number;
}

export interface GuestConductRule {
  readonly id: "parties_events" | "commercial_use" | "occupancy" | "overnight_occupants" | "visitors" | "pets" | "children" | "smoking_vaping" | "quiet_hours" | "dangerous_unlawful" | "identity" | "identity_evidence" | "money_remedies";
  readonly summary: string;
}

export interface GuestConductPolicySnapshot {
  readonly ruleVersion: string;
  readonly rules: readonly GuestConductRule[];
  readonly visitorMode: VisitorMode;
  readonly petsAllowed: boolean;
  readonly petFriendlyTerms?: string;
  readonly children: { readonly allowed: boolean; readonly restriction?: string };
  readonly quietHours: { readonly start: "22:00"; readonly end: "08:00"; readonly timezone: typeof LAUNCH_TIMEZONE };
  readonly occupancyLimit: number;
  readonly overnightOccupantsNamed: true;
}

export interface IdentityComparisonRecord {
  readonly reservationId: string;
  readonly primaryGuestId: string;
  readonly comparisonStatus: "passed" | "failed" | "review_required";
  readonly comparisonVersion: string;
  readonly checkedAt: string;
  readonly retentionPermitted: boolean;
}

export interface EvidenceAssessment {
  readonly evidenceSetId: string;
  readonly version: string;
  readonly status: "accepted" | "rejected";
  readonly count: number;
  readonly category: "conduct" | "identity" | "inspection";
  readonly assessment: "remediable" | "severe" | "safety";
}
export interface GuestConductEvidenceProvider { assess(input: { reservationId: string; referenceIds: readonly string[] }): EvidenceAssessment; }
export interface GuestConductIdentityProvider { compare(input: { reservationId: string; primaryGuestId: string }): IdentityComparisonRecord; }
export interface GuestConductCureVerificationProvider { verify(input: { allegationId: string; evidenceSetId?: string }): { status: "verified" | "failed"; version: string }; }
export interface GuestConductHumanDecisionProvider { getDecision(input: { allegationId: string }): { decisionId: string; decisionVersion: string; decisionStatus: "approved"; action: "terminate_stay" | "charge_damage"; ruleVersion: string; evidenceVersion: string; authorizedHumanId: string }; }

export type AllegationState = "alleged" | "warning_issued" | "cure_pending" | "cured" | "human_review" | "protective_action" | "terminated" | "charge_referred" | "exonerated" | "closed";
export interface GuestConductAllegation {
  readonly allegationId: string; readonly reservationId: string; readonly ruleId: GuestConductRule["id"];
  readonly ruleVersion: string; readonly allegationVersion: number; readonly state: AllegationState;
  readonly safeSummary: string; readonly evidenceSetId: string; readonly evidenceVersion: string;
  readonly warningCode?: string; readonly cureWindowMinutes?: number; readonly cureDeadline?: string;
  readonly outcome?: "cured" | "human_review" | "stay_termination_authorized" | "charge_referred" | "exonerated";
  readonly humanOwned: boolean; readonly decisionVersion?: string;
}

const RULES: readonly GuestConductRule[] = Object.freeze([
  { id: "parties_events", summary: "Parties and events are prohibited." },
  { id: "commercial_use", summary: "Undisclosed commercial use is prohibited." },
  { id: "occupancy", summary: "Occupancy must not exceed the verified maximum." },
  { id: "overnight_occupants", summary: "Every overnight occupant must be named." },
  { id: "visitors", summary: "Visitors follow the unit's disclosed catalogue choice and count toward capacity." },
  { id: "pets", summary: "Pets are prohibited unless disclosed Pet Friendly terms apply." },
  { id: "children", summary: "Children are allowed unless a trusted inspection-supported restriction applies." },
  { id: "smoking_vaping", summary: "Indoor smoking and vaping are prohibited." },
  { id: "quiet_hours", summary: "Quiet hours are 22:00–08:00 Africa/Lagos." },
  { id: "dangerous_unlawful", summary: "Dangerous or unlawful conduct is prohibited." },
  { id: "identity", summary: "The Primary Guest presents approved credential/photo ID for visual comparison." },
  { id: "identity_evidence", summary: "Operators may not copy or retain identity evidence absent genuine legal requirement." },
  { id: "money_remedies", summary: "No arbitrary cash fines; remedies use warning, cure, evidence review, protection, human review, or termination by severity." }
]);

function policyMaterial(policy: Omit<GuestConductPolicySnapshot, "ruleVersion">): string { return JSON.stringify(policy); }
export function guestConductRuleVersion(policy: Omit<GuestConductPolicySnapshot, "ruleVersion">): string { return `guest-conduct/v1:${createHash("sha256").update(policyMaterial(policy)).digest("hex").slice(0, 16)}`; }
export function createGuestConductPolicySnapshot(input: { unitId: string; capacity: number; policy?: UnitConductPolicy }): GuestConductPolicySnapshot {
  const p = input.policy ?? { unitId: input.unitId, visitorsMode: "prohibited" as const, petsAllowed: false };
  const allowedKeys = new Set(["unitId", "visitorsMode", "petsAllowed", "petTermsDisclosed", "childrenRestriction", "childrenAllowed", "quietHours", "customCashFineKobo"]);
  if (Object.keys(p).some((key) => !allowedKeys.has(key))) throw new Error("Unit conduct policy contains unsupported policy options");
  if (p.unitId !== input.unitId) throw new Error("Unit conduct policy does not match unit");
  if (p.visitorsMode !== "prohibited" && p.visitorsMode !== "registered_8am_10pm") throw new Error("Unit conduct policy rejected: visitor mode is outside the platform catalogue");
  if (p.petsAllowed && p.petTermsDisclosed !== true) throw new Error("Pet Friendly terms must be disclosed");
  if (p.quietHours !== undefined && p.quietHours !== "22:00-08:00" && p.quietHours !== LAUNCH_QUIET_HOURS) throw new Error("Custom quiet hours are not permitted");
  if (p.customCashFineKobo !== undefined) throw new Error("Arbitrary cash fines or penalties are prohibited");
  if (p.childrenAllowed === false && !p.childrenRestriction) throw new Error("Children restrictions require trusted inspection evidence");
  const children = p.childrenRestriction ? { allowed: false, restriction: p.childrenRestriction.summary } : { allowed: true };
  const base = { rules: RULES, visitorMode: p.visitorsMode, petsAllowed: p.petsAllowed, ...(p.petsAllowed ? { petFriendlyTerms: "Disclosed Pet Friendly terms apply." } : {}), children, quietHours: { start: "22:00" as const, end: "08:00" as const, timezone: LAUNCH_TIMEZONE as "Africa/Lagos" }, occupancyLimit: input.capacity, overnightOccupantsNamed: true as const };
  return Object.freeze({ ...base, ruleVersion: guestConductRuleVersion(base) });
}

export class GuestConductManager {
  readonly #allegations = new Map<string, GuestConductAllegation>();
  readonly #commands = new Set<string>();
  readonly #decisions = new Set<string>();
  validateUnitConductPolicy(policy: UnitConductPolicy): UnitConductPolicy { createGuestConductPolicySnapshot({ unitId: policy.unitId, capacity: 1, policy }); return { ...policy }; }
  reportTrusted(input: { commandId: string; reservationId: string; ruleId: GuestConductRule["id"]; contract: GuestConductPolicySnapshot; evidence: EvidenceAssessment; safeSummary: string }): GuestConductAllegation {
    if (this.#commands.has(input.commandId)) return this.get(`allegation:${input.reservationId}:${input.commandId}`);
    const rule = input.contract.rules.find((candidate) => candidate.id === input.ruleId);
    if (!rule) throw new Error("Allegation rule is not present in the captured contract");
    if (input.evidence.status !== "accepted" || input.evidence.count < 1) throw new Error("Trusted evidence is required");
    const allegationId = `allegation:${input.reservationId}:${input.commandId}`;
    const severe = input.evidence.assessment === "severe" || input.evidence.assessment === "safety";
    const record: GuestConductAllegation = Object.freeze({ allegationId, reservationId: input.reservationId, ruleId: input.ruleId, ruleVersion: input.contract.ruleVersion, allegationVersion: 1, state: severe ? "human_review" as const : "alleged" as const, safeSummary: `Alleged breach of contracted rule: ${rule.summary}`, evidenceSetId: input.evidence.evidenceSetId, evidenceVersion: input.evidence.version, humanOwned: severe });
    this.#commands.add(input.commandId); this.#allegations.set(allegationId, record); return record;
  }
  get(allegationId: string): GuestConductAllegation { const value = this.#allegations.get(allegationId); if (!value) throw new Error("Allegation not found"); return value; }
  issuePolicyWarning(allegationId: string, commandId: string, clock = new Date()): GuestConductAllegation {
    const current = this.get(allegationId); if (this.#commands.has(commandId)) return current; if (current.humanOwned) return current;
    const next = Object.freeze({ ...current, allegationVersion: current.allegationVersion + 1, state: "cure_pending" as const, warningCode: "CONDUCT_CURE_REQUIRED", cureWindowMinutes: 30, cureDeadline: new Date(clock.getTime() + 30 * 60_000).toISOString() }); this.#commands.add(commandId); this.#allegations.set(allegationId, next); return next;
  }
  verifyCure(allegationId: string, commandId: string, verification: { status: "verified" | "failed" }): GuestConductAllegation { const current = this.get(allegationId); if (this.#commands.has(commandId)) return current; this.#commands.add(commandId); if (verification.status !== "verified") return current; const next = Object.freeze({ ...current, allegationVersion: current.allegationVersion + 1, state: "cured" as const, outcome: "cured" as const }); this.#allegations.set(allegationId, next); return next; }
  applyHumanDecision(envelope: PlatformCommandEnvelope<{ allegationId: string; expectedAllegationVersion: number; ruleVersion: string; evidenceVersion: string }>, decision: ReturnType<GuestConductHumanDecisionProvider["getDecision"]>): GuestConductAllegation {
    if (envelope.commandName !== "guest_conduct.apply_reviewed_decision") throw new Error("Unsupported guest conduct command");
    if (!envelope.principal.id || !["authorized_staff", "admin"].includes(envelope.principal.role)) throw new Error("Authorized human decision required");
    const current = this.get(envelope.payload.allegationId); if (current.allegationVersion !== envelope.payload.expectedAllegationVersion || current.ruleVersion !== envelope.payload.ruleVersion || current.evidenceVersion !== envelope.payload.evidenceVersion) throw new Error("STALE_ACTION");
    if (decision.decisionStatus !== "approved" || decision.authorizedHumanId !== envelope.principal.id || decision.ruleVersion !== current.ruleVersion || decision.evidenceVersion !== current.evidenceVersion) throw new Error("Trusted decision binding mismatch");
    if (this.#decisions.has(decision.decisionId)) return current;
    this.#decisions.add(decision.decisionId);
    const outcome = decision.action === "terminate_stay" ? "stay_termination_authorized" as const : "charge_referred" as const;
    const next = Object.freeze({ ...current, allegationVersion: current.allegationVersion + 1, state: decision.action === "terminate_stay" ? "terminated" as const : "charge_referred" as const, outcome, humanOwned: true, decisionVersion: decision.decisionVersion }); this.#allegations.set(current.allegationId, next); return next;
  }
  getProjection(allegationId: string, _role: "guest" | "operator" | "support"): GuestConductAllegation { return this.get(allegationId); }
  getProjectionForReservation(reservationId: string): GuestConductAllegation | undefined { return [...this.#allegations.values()].find((item) => item.reservationId === reservationId); }
}
