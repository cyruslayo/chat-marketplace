import { PlatformCommandEnvelope } from "../../../packages/platform-core/src/index.js";

export type VisitorMode = "prohibited" | "registered_8am_10pm";

export interface UnitConductPolicy {
  unitId: string;
  visitorsMode: VisitorMode;
  petsAllowed: boolean;
  petTermsDisclosed?: boolean;
  childrenAllowed: boolean;
  quietHours: string; // "22:00-08:00"
  customCashFineKobo?: number;
}

export interface IdentityCheckRecord {
  reservationId: string;
  primaryGuestId: string;
  visualComparisonPassed: boolean;
  operatorCopiedId: boolean;
  legalAuthorityProvided?: boolean;
  legalAuthorityReference?: string;
  checkedAtIso: string;
}

export interface GuestConductAllegation {
  allegationId: string;
  reservationId: string;
  tenantId: string;
  ruleBreached: string;
  evidenceUrls: string[];
  reportedAtIso: string;
  status: "alleged" | "warning_issued" | "cured" | "escalated" | "terminated" | "exonerated";
  ruleVersion: string;
  warningDetails?: string;
  cureWindowMinutes?: number;
  issuedAtIso?: string;
  outcome?: string;
  authorizedHumanId?: string;
}

export interface ConsequentialActionResult {
  allegationId: string;
  action: "terminate_stay" | "charge_damage";
  authorizedHumanId: string;
  status: "executed";
  executedAtIso: string;
}

export interface GuestConductProjection {
  allegationId: string;
  reservationId: string;
  ruleVersion: string;
  allegationState: "alleged" | "warning_issued" | "cured" | "escalated" | "terminated" | "exonerated";
  ruleBreached: string;
  warningDetails?: string;
  cureWindowMinutes?: number;
  outcome?: string;
}

/**
 * ADR 0059, ADR 0012, ADR 0072, ADR 0076:
 * Enforces standardized guest conduct rules, photo ID visual comparison without unauthorized copying,
 * Platform Command Envelope for consequential actions with human authority, and unified projections.
 */
export class GuestConductManager {
  readonly #allegations = new Map<string, GuestConductAllegation>();
  readonly #identityChecks = new Map<string, IdentityCheckRecord>();

  /**
   * ADR 0059:
   * Validates unit conduct policy within platform catalogue. Prohibits arbitrary cash fines.
   */
  validateUnitConductPolicy(policy: UnitConductPolicy): UnitConductPolicy {
    if (policy.customCashFineKobo !== undefined && policy.customCashFineKobo > 0) {
      throw new Error("Arbitrary cash fines or penalties are prohibited under platform guest conduct policy");
    }

    if (policy.visitorsMode !== "prohibited" && policy.visitorsMode !== "registered_8am_10pm") {
      throw new Error("Unit conduct policy rejected: Visitors or pets terms outside platform catalogue");
    }

    if (policy.petsAllowed && !policy.petTermsDisclosed) {
      throw new Error("Unit conduct policy rejected: Visitors or pets terms outside platform catalogue");
    }

    return { ...policy };
  }

  /**
   * ADR 0059 & ADR 0012:
   * Visual comparison of ID at check-in. Operators cannot copy ID evidence without legal authority.
   */
  recordIdentityCheck(params: {
    reservationId: string;
    primaryGuestId: string;
    visualComparisonPassed: boolean;
    operatorCopiedId: boolean;
    legalAuthorityProvided?: boolean;
    legalAuthorityReference?: string;
  }): IdentityCheckRecord {
    if (!params.visualComparisonPassed) {
      throw new Error("Identity check failed: Primary guest visual comparison failed");
    }

    if (params.operatorCopiedId && !params.legalAuthorityProvided) {
      throw new Error("Operators cannot copy or retain identity evidence without legal authority");
    }

    const record: IdentityCheckRecord = {
      ...params,
      checkedAtIso: new Date().toISOString()
    };

    this.#identityChecks.set(params.reservationId, record);
    return record;
  }

  /**
   * ADR 0059:
   * Report an alleged guest conduct breach with evidence.
   */
  reportBreach(params: {
    allegationId: string;
    reservationId: string;
    tenantId: string;
    ruleBreached: string;
    evidenceUrls: string[];
    reportedAtIso: string;
  }): GuestConductAllegation {
    if (!params.evidenceUrls || params.evidenceUrls.length === 0) {
      throw new Error("Guest conduct allegation requires evidence");
    }

    const record: GuestConductAllegation = {
      ...params,
      status: "alleged",
      ruleVersion: "v1.0"
    };

    this.#allegations.set(params.allegationId, record);
    return { ...record };
  }

  /**
   * ADR 0059:
   * Issue warning and cure window.
   */
  issueWarningAndCure(params: {
    allegationId: string;
    cureWindowMinutes: number;
    warningDetails: string;
    issuedAtIso: string;
  }): GuestConductAllegation {
    const allegation = this.#allegations.get(params.allegationId);
    if (!allegation) throw new Error(`Allegation not found: ${params.allegationId}`);

    allegation.status = "warning_issued";
    allegation.cureWindowMinutes = params.cureWindowMinutes;
    allegation.warningDetails = params.warningDetails;
    allegation.issuedAtIso = params.issuedAtIso;

    return { ...allegation };
  }

  /**
   * ADR 0072 & ADR 0076:
   * Consequential termination or charge requires Platform Command Envelope, evidence, policy, and authorized human decision.
   */
  executeConsequentialAction(envelope: PlatformCommandEnvelope<any>): ConsequentialActionResult {
    if (envelope.commandName !== "guest_conduct.consequential_action") {
      throw new Error(`Invalid command name: ${envelope.commandName}`);
    }

    // Fail closed: Principal role MUST be admin/human reviewer, NOT agent or system
    if (!envelope.principal || (envelope.principal.role !== "admin" && envelope.principal.role !== "operator")) {
      throw new Error("Consequential termination or charge requires an authorized human decision");
    }

    const { allegationId, action, reason, evidenceUrls, policyReference } = envelope.payload ?? {};
    if (!allegationId || !action || !reason || !evidenceUrls || evidenceUrls.length === 0 || !policyReference) {
      throw new Error("Consequential action requires allegationId, action, reason, evidence, and policyReference");
    }

    const allegation = this.#allegations.get(allegationId);
    if (!allegation) throw new Error(`Allegation not found: ${allegationId}`);

    allegation.status = action === "terminate_stay" ? "terminated" : "escalated";
    allegation.outcome = `${action}: ${reason}`;
    allegation.authorizedHumanId = envelope.principal.id;

    return {
      allegationId,
      action,
      authorizedHumanId: envelope.principal.id,
      status: "executed",
      executedAtIso: new Date().toISOString()
    };
  }

  /**
   * ADR 0059:
   * Unified projection for Guest, Operator, and Support.
   */
  getProjection(allegationId: string, _role: "guest" | "operator" | "support"): GuestConductProjection {
    const allegation = this.#allegations.get(allegationId);
    if (!allegation) throw new Error(`Allegation not found: ${allegationId}`);

    return {
      allegationId: allegation.allegationId,
      reservationId: allegation.reservationId,
      ruleVersion: allegation.ruleVersion,
      allegationState: allegation.status,
      ruleBreached: allegation.ruleBreached,
      warningDetails: allegation.warningDetails,
      cureWindowMinutes: allegation.cureWindowMinutes,
      outcome: allegation.outcome
    };
  }
}
