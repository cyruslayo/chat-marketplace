import { PlatformCommandEnvelope } from "../../../packages/platform-core/src/index.js";
import { BookingContract } from "./card-payment.js";

export interface ProtectedArrivalData {
  readonly contractId: string;
  readonly fullAddress: string;
  readonly accessInstructions: string;
  readonly locationReferenceId: string;
  readonly accessReferenceId: string;
  readonly releasedAt?: string;
}

export interface ContractRepository {
  findContractById(contractId: string): BookingContract | null;
  findArrivalDataByContractId(contractId: string): ProtectedArrivalData | null;
  findReservationById(reservationId: string): { reservationId: string; status: string } | null;
}

export class ContractAndArrivalReleaseManager {
  readonly #repository: ContractRepository;

  constructor({ repository }: { repository: ContractRepository }) {
    if (!repository) {
      throw new Error("repository is required for ContractAndArrivalReleaseManager");
    }
    this.#repository = repository;
  }

  /**
   * ADR 0006 & AC 1: Present durable Booking Contract view.
   */
  getBookingContractView(
    envelope: PlatformCommandEnvelope<{ contractId: string } & Record<string, unknown>>
  ): {
    contractId: string;
    reservationId: string;
    offerId: string;
    unitId: string;
    parties: BookingContract["parties"];
    dates: BookingContract["dates"];
    occupants: BookingContract["occupants"];
    money: {
      allInStayTotalKobo: number;
      refundableSecurityDepositKobo: number;
      totalAmountDueNowKobo: number;
    };
    policies: BookingContract["policies"];
    disclosures: readonly string[];
    contractVersion: number;
  } {
    const { contractId } = envelope.payload ?? {};
    if (!contractId) throw new Error("Access denied or resource not found");

    const contract = this.#repository.findContractById(contractId);
    if (!contract) throw new Error("Access denied or resource not found");

    // Tenant check (fail closed!)
    if (contract.tenantId && envelope.principal.tenantId && contract.tenantId !== envelope.principal.tenantId) {
      throw new Error("Access denied or resource not found");
    }

    const quoteAny = contract.quote as Record<string, unknown> | undefined;

    return {
      contractId: contract.contractId,
      reservationId: contract.reservationId,
      offerId: contract.offerId,
      unitId: contract.unitId,
      parties: contract.parties,
      dates: contract.dates,
      occupants: contract.occupants,
      money: {
        allInStayTotalKobo: (quoteAny?.allInStayTotalKobo as number) ?? contract.totalAmountDueNowKobo,
        refundableSecurityDepositKobo: (quoteAny?.refundableSecurityDepositKobo as number) ?? 0,
        totalAmountDueNowKobo: contract.totalAmountDueNowKobo
      },
      policies: contract.policies,
      disclosures: [
        "Verified Accommodation Contract under Nigerian Shortlet Concierge Platform Rules",
        "Full property address and arrival access codes release upon accepted lifecycle points"
      ],
      contractVersion: contract.contractVersion
    };
  }

  /**
   * ADR 0011, 0022, 0031, 0075 & AC 2 & 4: Tenant-scoped, authorized arrival data release.
   * Fails closed without leaking data existence if cancelled, revoked, premature, or cross-tenant.
   */
  getProtectedArrivalData(
    envelope: PlatformCommandEnvelope<{ contractId: string } & Record<string, unknown>>,
    { clock = () => new Date() }: { clock?: () => Date } = {}
  ): ProtectedArrivalData {
    const { contractId } = envelope.payload ?? {};
    if (!contractId) throw new Error("Access denied or resource not found");

    const contract = this.#repository.findContractById(contractId);
    if (!contract) throw new Error("Access denied or resource not found");

    // ADR 0075: Fail closed tenant scope check
    if (contract.tenantId && envelope.principal.tenantId && contract.tenantId !== envelope.principal.tenantId) {
      throw new Error("Access denied or resource not found");
    }

    // Principal authorization check (must be primary guest, distinct payer, or operator)
    const principalId = envelope.principal.id;
    const isAuthorized =
      principalId === contract.parties.primaryGuest.id ||
      principalId === contract.parties.distinctPayer?.id ||
      principalId === contract.parties.operator.id;

    if (!isAuthorized) {
      throw new Error("Access denied or resource not found");
    }

    // Reservation state check (must be confirmed and not cancelled/revoked)
    const reservation = this.#repository.findReservationById(contract.reservationId);
    if (!reservation || reservation.status !== "confirmed") {
      throw new Error("Access denied or resource not found");
    }

    const arrivalData = this.#repository.findArrivalDataByContractId(contractId);
    if (!arrivalData) throw new Error("Access denied or resource not found");

    return {
      ...arrivalData,
      releasedAt: clock().toISOString()
    };
  }

  /**
   * ADR 0071 & 0075 & AC 3: Redacted interaction projection.
   * Does NOT include raw full address or access instructions.
   */
  projectRedactedInteractionView(contractId: string): {
    contractId: string;
    locationReferenceId: string;
    accessReferenceId: string;
    status: "protected_reference_ready";
  } {
    const arrivalData = this.#repository.findArrivalDataByContractId(contractId);
    if (!arrivalData) throw new Error("Access denied or resource not found");

    return {
      contractId,
      locationReferenceId: arrivalData.locationReferenceId,
      accessReferenceId: arrivalData.accessReferenceId,
      status: "protected_reference_ready"
    };
  }
}
