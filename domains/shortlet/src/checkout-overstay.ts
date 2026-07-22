export interface CheckoutOverstayDeps {
  hasSameDayArrival: (reservationId: string, checkoutDate: string) => boolean;
  hasMaintenanceOrInspection: (reservationId: string, checkoutDate: string) => boolean;
  hasTurnoverCapacity: (reservationId: string, checkoutDate: string) => boolean;
  hasSupportAvailability: (reservationId: string, checkoutDate: string) => boolean;
  operatorApproved: (reservationId: string, requestedTime: string) => boolean;
}

export interface LateCheckoutEligibilityResult {
  eligible: boolean;
  requestedTime: string;
  feeKobo: number;
  reason?: string;
}

export interface CheckoutSchedule {
  reservationId: string;
  contractualCheckoutTime: string;
  contractualCheckoutIso: string;
  accessExpiryIso: string;
  turnoverStartIso: string;
  depositClaimDeadlineIso: string;
  remindersIso: string[];
}

export interface OverstayIncident {
  incidentId: string;
  reservationId: string;
  status: "open_incident" | "resolved" | "escalated";
  evidence: Record<string, unknown>;
  consequences: {
    standardized: true;
    duplicativeChargesProhibited: true;
    maxChargeKobo?: number;
  };
  humanSafetyEscalation: boolean;
  targetQueue?: string;
}

/**
 * ADR 0032, ADR 0033, ADR 0034, ADR 0060:
 * Enforces Contractual Checkout (11:00 AM WAT), Late Checkout eligibility (up to 14:00 WAT),
 * and standardized overstay incident management.
 */
export class CheckoutOverstayManager {
  readonly #deps: CheckoutOverstayDeps;
  readonly #incidents = new Map<string, OverstayIncident>();

  constructor(deps: CheckoutOverstayDeps) {
    this.#deps = deps;
  }

  /**
   * ADR 0033 & ADR 0034:
   * Late checkout capped at 14:00 WAT (2:00 PM WAT). Prohibited if same-day arrival exists.
   */
  evaluateLateCheckoutEligibility({
    reservationId,
    requestedTime,
    checkoutDate
  }: {
    reservationId: string;
    requestedTime: string;
    checkoutDate: string;
  }): LateCheckoutEligibilityResult {
    const validTimes = ["12:00", "13:00", "14:00"];

    if (!validTimes.includes(requestedTime)) {
      return {
        eligible: false,
        requestedTime,
        feeKobo: 0,
        reason: "Late checkout capped at 14:00 WAT. Only 12:00, 13:00, or 14:00 WAT increments available."
      };
    }

    if (this.#deps.hasSameDayArrival(reservationId, checkoutDate)) {
      return {
        eligible: false,
        requestedTime,
        feeKobo: 0,
        reason: "Late checkout is prohibited for same-day incoming reservation."
      };
    }

    if (this.#deps.hasMaintenanceOrInspection(reservationId, checkoutDate)) {
      return {
        eligible: false,
        requestedTime,
        feeKobo: 0,
        reason: "Conflicting maintenance or inspection scheduled."
      };
    }

    if (!this.#deps.hasTurnoverCapacity(reservationId, checkoutDate)) {
      return {
        eligible: false,
        requestedTime,
        feeKobo: 0,
        reason: "Turnover capacity not available for late checkout."
      };
    }

    if (!this.#deps.hasSupportAvailability(reservationId, checkoutDate)) {
      return {
        eligible: false,
        requestedTime,
        feeKobo: 0,
        reason: "Platform human support not available for requested timeframe."
      };
    }

    if (!this.#deps.operatorApproved(reservationId, requestedTime)) {
      return {
        eligible: false,
        requestedTime,
        feeKobo: 0,
        reason: "Operator declined late checkout request."
      };
    }

    const feeMap: Record<string, number> = {
      "12:00": 500000, // ₦5,000
      "13:00": 1000000, // ₦10,000
      "14:00": 1500000 // ₦15,000
    };

    return {
      eligible: true,
      requestedTime,
      feeKobo: feeMap[requestedTime] ?? 500000
    };
  }

  /**
   * ADR 0032 & ADR 0033:
   * Calculate exact WAT timestamps for checkout, access expiry, turnover start, deposit claim deadline.
   */
  calculateCheckoutSchedule({
    reservationId,
    checkoutDate,
    contractualCheckoutTime = "11:00"
  }: {
    reservationId: string;
    checkoutDate: string;
    contractualCheckoutTime?: string;
  }): CheckoutSchedule {
    // Lagos is UTC+1 (WAT)
    const [hoursStr, minutesStr] = contractualCheckoutTime.split(":");
    const hours = parseInt(hoursStr, 10);
    const minutes = parseInt(minutesStr, 10);

    const utcHours = hours - 1;
    const checkoutDateObj = new Date(`${checkoutDate}T${String(utcHours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00.000Z`);
    const contractualCheckoutIso = checkoutDateObj.toISOString();

    // Deposit claim deadline is 24h after contractual checkout (ADR 0016 & ADR 0032)
    const depositClaimDeadlineObj = new Date(checkoutDateObj.getTime() + 24 * 60 * 60 * 1000);

    // Reminders 1h before checkout
    const reminderObj = new Date(checkoutDateObj.getTime() - 60 * 60 * 1000);

    return {
      reservationId,
      contractualCheckoutTime,
      contractualCheckoutIso,
      accessExpiryIso: contractualCheckoutIso,
      turnoverStartIso: contractualCheckoutIso,
      depositClaimDeadlineIso: depositClaimDeadlineObj.toISOString(),
      remindersIso: [reminderObj.toISOString()]
    };
  }

  /**
   * ADR 0060:
   * Prohibit informal messages, cash, or direct bank transfer extensions.
   */
  processCheckoutExtensionRequest(request: {
    reservationId: string;
    method: string;
    note?: string;
    amountKobo?: number;
  }): void {
    if (request.method === "informal_chat") {
      throw new Error("Informal messages cannot amend checkout. Material terms change only through versioned platform amendments.");
    }

    if (request.method === "cash_or_direct_transfer") {
      throw new Error("Cash or direct transfers cannot extend checkout or create charges.");
    }

    if (request.method !== "versioned_amendment") {
      throw new Error(`Unsupported extension method: ${request.method}`);
    }
  }

  /**
   * ADR 0033 & ADR 0060:
   * Standardized overstay incident creation.
   */
  openOverstayIncident({
    reservationId,
    checkoutDate,
    contractualCheckoutTime,
    currentIso,
    evidence
  }: {
    reservationId: string;
    checkoutDate: string;
    contractualCheckoutTime: string;
    currentIso: string;
    evidence: Record<string, unknown>;
  }): OverstayIncident {
    const incidentId = `inc_overstay_${reservationId}`;
    const incident: OverstayIncident = {
      incidentId,
      reservationId,
      status: "open_incident",
      evidence,
      consequences: {
        standardized: true,
        duplicativeChargesProhibited: true,
        maxChargeKobo: 5000000 // 1 nightly amount maximum cap for unauthorized overstay
      },
      humanSafetyEscalation: false
    };

    this.#incidents.set(incidentId, incident);
    return { ...incident };
  }

  /**
   * ADR 0030: Escalate safety threats to Active-Stay Emergency Support.
   */
  escalateOverstaySafetyIncident(
    incidentId: string,
    details: { safetyThreatReported: boolean; details: string }
  ): OverstayIncident {
    const incident = this.#incidents.get(incidentId);
    if (!incident) {
      throw new Error(`Incident not found: ${incidentId}`);
    }

    if (details.safetyThreatReported) {
      incident.status = "escalated";
      incident.humanSafetyEscalation = true;
      incident.targetQueue = "Active-Stay Emergency Support (24/7)";
    }

    return { ...incident };
  }
}
