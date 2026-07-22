import { PlatformCommandEnvelope } from "../../../packages/platform-core/src/index.js";

export type MidStayFailureCategory =
  | "safety_access_habitability"
  | "essential_amenity"
  | "material_advertised_amenity"
  | "minor_impact";

export interface NightlyLineItem {
  nightDateIso: string;
  rateKobo: number;
}

export interface AttributableCharges {
  cleaningFeeKobo?: number;
  unprovidedServicesKobo?: number;
  taxKobo?: number;
}

export interface RemedyCalculationInput {
  category: MidStayFailureCategory;
  failureStartedAtIso: string;
  curedAtIso?: string;
  checkedAtIso?: string;
  affectedNightDates?: string[];
  delayedReportingReason?: string;
  delayedReportingJustified?: boolean;
  overnightImpact?: boolean;
  nightlyLineItems: NightlyLineItem[];
  attributableCharges?: AttributableCharges;
}

export interface RemedyResult {
  category: MidStayFailureCategory;
  percentage: number; // 100, 50, 25, 20, 10, or 0
  nightlyRefundKobo: number;
  attributableChargesRefundKobo: number;
  totalRefundKobo: number;
  reportingDelayExcused: boolean;
  cureWindowExceeded: boolean;
}

export interface MidStayIncidentRecord {
  incidentId: string;
  reservationId: string;
  tenantId: string;
  category: MidStayFailureCategory;
  failureStartedAtIso: string;
  reportedAtIso: string;
  evidenceUrls: string[];
  status: "open" | "resolved" | "dismissed";
  revenueHeld: boolean;
  nightlyLineItems: NightlyLineItem[];
  attributableCharges?: AttributableCharges;
  resolutionChoice?: "refund" | "relocation";
  resolvedAtIso?: string;
  authorizedHumanId?: string;
}

/**
 * ADR 0061, ADR 0021, ADR 0027, ADR 0028, ADR 0029, ADR 0063:
 * Mid-stay failure classification, cure windows, remedy calculation matrix, revenue hold,
 * guest relocation vs refund choice, and human authority.
 */
export class MidStayFailureManager {
  readonly #incidents = new Map<string, MidStayIncidentRecord>();

  /**
   * ADR 0061:
   * Calculates per-night remedy percentage & refund amounts based on category & timing boundaries.
   */
  calculateRemedy(input: RemedyCalculationInput): RemedyResult {
    const startTime = new Date(input.failureStartedAtIso).getTime();
    const endTime = input.curedAtIso
      ? new Date(input.curedAtIso).getTime()
      : input.checkedAtIso
      ? new Date(input.checkedAtIso).getTime()
      : Date.now();

    const durationHours = Math.max(0, (endTime - startTime) / (3600 * 1000));

    let reportingDelayExcused = false;
    if (input.delayedReportingReason) {
      // Safety/habitability claims or justified practical circumstances excuse delayed reporting (ADR 0061)
      if (input.category === "safety_access_habitability" || input.delayedReportingJustified) {
        reportingDelayExcused = true;
      }
    }

    let percentage = 0;
    let cureWindowExceeded = false;

    if (input.category === "safety_access_habitability") {
      percentage = 100;
      cureWindowExceeded = true;
    } else if (input.category === "essential_amenity") {
      // 2-hour cure window
      if (durationHours > 2) {
        cureWindowExceeded = true;
        if (durationHours > 6 || input.overnightImpact) {
          percentage = 50;
        } else {
          percentage = 25;
        }
      } else {
        percentage = 0;
      }
    } else if (input.category === "material_advertised_amenity") {
      // 4-hour cure window
      if (durationHours > 4) {
        cureWindowExceeded = true;
        if (durationHours > 12) {
          percentage = 20;
        } else {
          percentage = 10;
        }
      } else {
        percentage = 0;
      }
    } else if (input.category === "minor_impact") {
      // No automatic payment
      percentage = 0;
      cureWindowExceeded = durationHours > 24;
    }

    // Determine affected nights
    let affectedItems = input.nightlyLineItems;
    if (input.affectedNightDates && input.affectedNightDates.length > 0) {
      affectedItems = input.nightlyLineItems.filter((item) => input.affectedNightDates!.includes(item.nightDateIso));
    }

    let nightlyRefundKobo = 0;
    for (const item of affectedItems) {
      nightlyRefundKobo += Math.floor(item.rateKobo * (percentage / 100));
    }

    let attributableChargesRefundKobo = 0;
    if (percentage === 100 && input.attributableCharges) {
      attributableChargesRefundKobo += input.attributableCharges.cleaningFeeKobo ?? 0;
      attributableChargesRefundKobo += input.attributableCharges.unprovidedServicesKobo ?? 0;
      attributableChargesRefundKobo += input.attributableCharges.taxKobo ?? 0;
    }

    const totalRefundKobo = nightlyRefundKobo + attributableChargesRefundKobo;

    return {
      category: input.category,
      percentage,
      nightlyRefundKobo,
      attributableChargesRefundKobo,
      totalRefundKobo,
      reportingDelayExcused,
      cureWindowExceeded
    };
  }

  /**
   * ADR 0021 & ADR 0061:
   * Open incident and hold exposed revenue.
   */
  openIncident(params: {
    incidentId: string;
    reservationId: string;
    tenantId: string;
    category: MidStayFailureCategory;
    failureStartedAtIso: string;
    reportedAtIso: string;
    evidenceUrls: string[];
    nightlyLineItems: NightlyLineItem[];
    attributableCharges?: AttributableCharges;
  }): MidStayIncidentRecord {
    if (!params.evidenceUrls || params.evidenceUrls.length === 0) {
      throw new Error("Mid-stay failure incident requires evidence");
    }

    const record: MidStayIncidentRecord = {
      ...params,
      status: "open",
      revenueHeld: true // Material incident holds exposed revenue (ADR 0061)
    };

    this.#incidents.set(params.incidentId, record);
    return { ...record };
  }

  /**
   * ADR 0028, ADR 0029, ADR 0072:
   * Resolves incident with human authority and guest consent for relocation vs refund.
   */
  resolveIncidentWithHumanApproval(
    envelope: PlatformCommandEnvelope<any>,
    incidentId: string,
    choice: "refund" | "relocation",
    guestConsentGiven: boolean
  ): MidStayIncidentRecord {
    if (envelope.commandName !== "mid_stay_failure.resolve") {
      throw new Error(`Invalid command name: ${envelope.commandName}`);
    }

    // Fail closed: Principal role MUST be admin/human reviewer, NOT agent or system
    if (!envelope.principal || (envelope.principal.role !== "admin" && envelope.principal.role !== "operator")) {
      throw new Error("Human authority required to resolve mid-stay failure");
    }

    if (!guestConsentGiven) {
      throw new Error("Guest consent required for mid-stay failure resolution choice");
    }

    const incident = this.#incidents.get(incidentId);
    if (!incident) throw new Error(`Incident not found: ${incidentId}`);

    incident.status = "resolved";
    incident.resolutionChoice = choice;
    incident.resolvedAtIso = new Date().toISOString();
    incident.authorizedHumanId = envelope.principal.id;

    return { ...incident };
  }
}
