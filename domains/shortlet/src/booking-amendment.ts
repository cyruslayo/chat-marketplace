import { PlatformCommandEnvelope } from "../../../packages/platform-core/src/index.js";
import { BookingContract, MockPSPVerifyResult } from "./card-payment.js";

export interface BookingAmendmentChanges {
  readonly dates?: { readonly checkIn: string; readonly checkOut: string };
  readonly occupants?: readonly { readonly name: string }[];
  readonly checkoutTime?: string; // HH:mm WAT (e.g. "12:00", "13:00", "14:00")
  readonly primaryGuestId?: string;
  readonly lateFirstAccessTime?: string; // HH:mm WAT
  readonly isHumanApprovedLateAccess?: boolean;
}

export interface FinancialAdjustment {
  readonly type: "additional_collection" | "refund" | "none";
  readonly amountKobo: number;
  readonly currency: "NGN";
}

export interface PendingAmendment {
  readonly amendmentId: string;
  readonly contractId: string;
  readonly requestedBy: string;
  readonly changes: BookingAmendmentChanges;
  readonly financialAdjustment: FinancialAdjustment;
  readonly originalContractVersion: number;
  status: "pending" | "committed" | "rejected";
  readonly createdAt: string;
}

export interface BookingAmendmentResult {
  readonly amendmentId: string;
  readonly contractId: string;
  readonly previousVersion: number;
  readonly newVersion: number;
  readonly status: "committed";
  readonly financialAdjustment: FinancialAdjustment;
  readonly updatedContract: BookingContract;
}

export interface BookingAmendmentDependencies {
  readonly contractRepository: {
    getContract(id: string): BookingContract;
    updateContract(contract: BookingContract): void;
  };
  readonly calendar?: {
    getAuthoritativeAvailability(unitId: string, checkIn: string, checkOut: string): { isAvailable: boolean };
    hasSameDayCheckInOnDate?(unitId: string, date: string): boolean;
  };
  readonly inspectionRepository?: {
    isPassedAndValid(unitId: string): boolean;
  };
  readonly authorityRepository?: {
    isAuthorityValid(unitId: string): boolean;
  };
  readonly audit?: {
    record(entry: Record<string, unknown>): void;
  };
}

export class BookingAmendmentManager {
  readonly #deps: BookingAmendmentDependencies;
  readonly #pendingAmendments = new Map<string, PendingAmendment>();

  constructor(deps: BookingAmendmentDependencies) {
    if (!deps.contractRepository) {
      throw new Error("contractRepository is required for BookingAmendmentManager");
    }
    this.#deps = deps;
  }

  /**
   * ADR 0060 & AC 1, AC 2, AC 3: Request versioned amendment with full revalidation.
   */
  requestAmendment(
    envelope: PlatformCommandEnvelope<{
      contractId: string;
      changes: BookingAmendmentChanges;
    }>,
    clock: () => Date = () => new Date()
  ): PendingAmendment {
    if (!envelope || envelope.commandName !== "booking_amendment.request") {
      throw new Error("Invalid envelope: commandName must be 'booking_amendment.request'");
    }

    const { contractId, changes } = envelope.payload;
    const contract = this.#deps.contractRepository.getContract(contractId);
    const now = clock();

    // Cross-tenant check
    if (contract.tenantId && envelope.principal.tenantId && contract.tenantId !== envelope.principal.tenantId) {
      throw new Error("Cross-tenant contract access denied");
    }

    // AC 2 & ADR 0012: Primary Guest replacement is strictly prohibited!
    if (changes.primaryGuestId && changes.primaryGuestId !== contract.parties.primaryGuest.id) {
      throw new Error(
        `Primary Guest replacement is prohibited (contract primary guest: '${contract.parties.primaryGuest.id}', attempted: '${changes.primaryGuestId}')`
      );
    }

    // AC 2 & ADR 0031: Late first access after 22:00 WAT requires explicit human approval
    if (changes.lateFirstAccessTime) {
      const parts = changes.lateFirstAccessTime.split(":");
      const hours = parseInt(parts[0], 10);
      if (hours >= 22 && !changes.isHumanApprovedLateAccess) {
        throw new Error("Late first access after 22:00 WAT is a human-approved exception only");
      }
    }

    // AC 1 & ADR 0060: Date changes & extension deadlines
    const originalCheckInMs = new Date(`${contract.dates.checkIn}T14:00:00.000Z`).getTime();
    const originalCheckOutMs = new Date(`${contract.dates.checkOut}T11:00:00.000Z`).getTime();

    if (changes.dates?.checkIn && changes.dates.checkIn !== contract.dates.checkIn) {
      // Date changes must begin at least 24 hours before check-in
      const deadline = originalCheckInMs - 24 * 60 * 60 * 1000;
      if (now.getTime() > deadline) {
        throw new Error("Date changes must begin at least 24 hours before check-in");
      }
    }

    const isExtension =
      changes.dates?.checkOut &&
      new Date(changes.dates.checkOut).getTime() > new Date(contract.dates.checkOut).getTime();

    if (isExtension) {
      // Extension request must begin by 18:00 WAT (6:00 PM) the day before checkout
      const dayBeforeCheckout = new Date(originalCheckOutMs - 24 * 60 * 60 * 1000);
      const cutoffStr = `${dayBeforeCheckout.toISOString().slice(0, 10)}T18:00:00.000Z`;
      const extensionDeadline = new Date(cutoffStr).getTime();
      if (now.getTime() > extensionDeadline) {
        throw new Error("Extension request must begin by 6:00 PM (18:00 WAT) the day before checkout");
      }
    }

    // Revalidate stay limits (ADR 0023: max 14 nights)
    const checkIn = changes.dates?.checkIn ?? contract.dates.checkIn;
    const checkOut = changes.dates?.checkOut ?? contract.dates.checkOut;
    const nights = Math.round(
      (new Date(checkOut).getTime() - new Date(checkIn).getTime()) / (24 * 60 * 60 * 1000)
    );

    if (nights > 14) {
      throw new Error(`Stay length exceeds the maximum launch limit of 14 nights (requested ${nights} nights)`);
    }

    // Revalidate booking horizon (ADR 0055: max 90 days from current clock)
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    if (new Date(checkIn).getTime() - now.getTime() > ninetyDaysMs) {
      throw new Error("Check-in date exceeds the 90-day booking horizon");
    }

    // Revalidate Late Checkout (ADR 0032/0033: capped at 14:00 WAT, no same-day check-in)
    if (changes.checkoutTime) {
      const parts = changes.checkoutTime.split(":");
      const hour = parseInt(parts[0], 10);
      if (hour > 14) {
        throw new Error("Late checkout cannot exceed 14:00 WAT");
      }
      if (this.#deps.calendar?.hasSameDayCheckInOnDate) {
        const hasSameDay = this.#deps.calendar.hasSameDayCheckInOnDate(contract.unitId, checkOut);
        if (hasSameDay) {
          throw new Error("Late checkout is unavailable when a same-day turnover check-in is scheduled");
        }
      }
    }

    // Revalidate Availability
    if (this.#deps.calendar && changes.dates) {
      const avail = this.#deps.calendar.getAuthoritativeAvailability(contract.unitId, checkIn, checkOut);
      if (!avail.isAvailable) {
        throw new Error("Unit dates are unavailable for requested amendment");
      }
    }

    // Revalidate Inspection (ADR 0056)
    if (this.#deps.inspectionRepository) {
      const passed = this.#deps.inspectionRepository.isPassedAndValid(contract.unitId);
      if (!passed) {
        throw new Error("Physical inspection verification failed for unit");
      }
    }

    // Revalidate Authority (ADR 0057)
    if (this.#deps.authorityRepository) {
      const valid = this.#deps.authorityRepository.isAuthorityValid(contract.unitId);
      if (!valid) {
        throw new Error("Management authority verification failed for unit");
      }
    }

    // Calculate Financial Adjustment
    const originalNights = contract.dates.nights;
    const nightlyRateKobo = contract.paymentDetails.amountKobo / originalNights;
    const diffNights = nights - originalNights;

    let adjustmentType: FinancialAdjustment["type"] = "none";
    let adjustmentAmount = 0;

    if (diffNights > 0) {
      adjustmentType = "additional_collection";
      adjustmentAmount = diffNights * nightlyRateKobo;
    } else if (diffNights < 0) {
      adjustmentType = "refund";
      adjustmentAmount = Math.abs(diffNights) * nightlyRateKobo;
    }

    const amendmentId = `amend_${now.getTime()}_${Math.random().toString(36).slice(2, 6)}`;
    const pending: PendingAmendment = {
      amendmentId,
      contractId: contract.contractId,
      requestedBy: envelope.principal.id,
      changes,
      financialAdjustment: {
        type: adjustmentType,
        amountKobo: adjustmentAmount,
        currency: "NGN"
      },
      originalContractVersion: contract.contractVersion,
      status: "pending",
      createdAt: now.toISOString()
    };

    this.#pendingAmendments.set(amendmentId, pending);

    if (this.#deps.audit) {
      this.#deps.audit.record({
        type: "booking_amendment.requested",
        amendmentId,
        contractId: contract.contractId,
        changes,
        financialAdjustment: pending.financialAdjustment,
        requestedAt: now.toISOString()
      });
    }

    return pending;
  }

  /**
   * ADR 0060 & AC 3: Commit amendment atomically upon payment or refund confirmation.
   */
  commitAmendment(
    envelope: PlatformCommandEnvelope<{
      amendmentId: string;
      pspPaymentResult?: MockPSPVerifyResult;
    }>,
    clock: () => Date = () => new Date()
  ): BookingAmendmentResult {
    if (!envelope || envelope.commandName !== "booking_amendment.commit") {
      throw new Error("Invalid envelope: commandName must be 'booking_amendment.commit'");
    }

    const { amendmentId, pspPaymentResult } = envelope.payload;
    const pending = this.#pendingAmendments.get(amendmentId);
    if (!pending) {
      throw new Error(`Pending amendment '${amendmentId}' not found`);
    }

    if (pending.status !== "pending") {
      throw new Error(`Amendment '${amendmentId}' is already ${pending.status}`);
    }

    // Verify payment if additional collection is required
    if (pending.financialAdjustment.type === "additional_collection") {
      if (!pspPaymentResult || !pspPaymentResult.verified || pspPaymentResult.status !== "success") {
        pending.status = "rejected";
        throw new Error("Amendment commit failed: Payment verification unsuccessful");
      }
    }

    const contract = this.#deps.contractRepository.getContract(pending.contractId);
    const newVersion = contract.contractVersion + 1;
    const now = clock();

    const newCheckIn = pending.changes.dates?.checkIn ?? contract.dates.checkIn;
    const newCheckOut = pending.changes.dates?.checkOut ?? contract.dates.checkOut;
    const newNights = Math.round(
      (new Date(newCheckOut).getTime() - new Date(newCheckIn).getTime()) / (24 * 60 * 60 * 1000)
    );

    const updatedContract: BookingContract = {
      ...contract,
      dates: {
        checkIn: newCheckIn,
        checkOut: newCheckOut,
        nights: newNights
      },
      occupants: pending.changes.occupants ? [...pending.changes.occupants] : contract.dates ? contract.occupants : contract.occupants,
      contractVersion: newVersion
    };

    pending.status = "committed";
    this.#deps.contractRepository.updateContract(updatedContract);

    if (this.#deps.audit) {
      this.#deps.audit.record({
        type: "booking_amendment.committed",
        amendmentId,
        contractId: contract.contractId,
        previousVersion: contract.contractVersion,
        newVersion,
        committedAt: now.toISOString()
      });
    }

    return {
      amendmentId,
      contractId: contract.contractId,
      previousVersion: contract.contractVersion,
      newVersion,
      status: "committed",
      financialAdjustment: pending.financialAdjustment,
      updatedContract
    };
  }

  /**
   * AC 4: Reject informal chat messages or operator promises.
   */
  rejectInformalChatAlteration(_envelope: PlatformCommandEnvelope<{ chatMessage: string }>): {
    readonly rejected: true;
    readonly reason: string;
  } {
    return {
      rejected: true,
      reason: "Informal chat messages or operator promises cannot alter contractual state"
    };
  }
}
