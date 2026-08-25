import type { PlatformCommandEnvelope } from "../../../packages/platform-core/src/index.js";
import type { BookingContract } from "./card-payment.js";
import type { ArrivalDisclosurePolicy, ReservationLike } from "./arrival-disclosure-policy.js";
import { failClosedArrivalDisclosurePolicy } from "./arrival-disclosure-policy.js";

export const PROTECTED_RESOURCE_DENIAL = "Access denied or resource not found";

export interface ProtectedArrivalData {
  readonly contractId: string;
  readonly fullAddress?: string;
  readonly accessInstructions?: string;
  readonly locationReferenceId: string;
  readonly accessReferenceId: string;
}

export interface ContractRepository {
  findContractById(contractId: string): BookingContract | null;
  findArrivalDataByContractId(contractId: string): ProtectedArrivalData | null;
  findReservationById(reservationId: string): ReservationLike | null;
}

export interface ArrivalReleaseAudit {
  record(entry: {
    readonly type: "arrival_data.released";
    readonly contractId: string;
    readonly reservationId: string;
    readonly tenantId: string;
    readonly principalId: string;
    readonly releasedCategories: readonly ("address" | "access_instructions")[];
    readonly policyPermitted: boolean;
    readonly occurredAt: string;
  }): void;
}

export interface BookingContractView {
  readonly contractId: string;
  readonly reservationId: string;
  readonly offerId: string;
  readonly unitId: string;
  readonly parties: BookingContract["parties"];
  readonly dates: BookingContract["dates"];
  readonly occupants: BookingContract["occupants"];
  readonly money: {
    readonly allInStayTotalKobo?: number;
    readonly refundableSecurityDepositKobo?: number;
    readonly totalAmountDueNowKobo: number;
    readonly currency?: string;
  };
  readonly policies: BookingContract["policies"];
  readonly disclosures: readonly string[];
  readonly contractVersion: number;
  readonly addressAvailability: "locked" | "available";
  readonly accessAvailability: "locked" | "available";
  readonly locationReferenceId?: string;
  readonly accessReferenceId?: string;
  readonly projectionVersion: number;
  readonly checkout: NonNullable<BookingContract["checkout"]>;
}

export interface ProtectedArrivalView {
  readonly contractId: string;
  readonly reservationId: string;
  readonly locationReferenceId: string;
  readonly accessReferenceId: string;
  readonly addressAvailability: "locked" | "available";
  readonly accessAvailability: "locked" | "available";
  readonly fullAddress?: string;
  readonly accessInstructions?: string;
}

function isAuthorizedGuest(contract: BookingContract, envelope: PlatformCommandEnvelope<{ contractId: string }>): boolean {
  const principal = envelope.principal;
  return principal.role === "guest"
    && !!principal.id
    && principal.id === contract.parties.primaryGuest.id
    && !!contract.tenantId
    && !!principal.tenantId
    && principal.tenantId === contract.tenantId;
}

export class ContractAndArrivalReleaseManager {
  readonly #repository: ContractRepository;
  readonly #policy: ArrivalDisclosurePolicy;
  readonly #audit?: ArrivalReleaseAudit;

  constructor({ repository, policy = failClosedArrivalDisclosurePolicy, audit }: { repository: ContractRepository; policy?: ArrivalDisclosurePolicy; audit?: ArrivalReleaseAudit }) {
    if (!repository) throw new Error("repository is required for ContractAndArrivalReleaseManager");
    this.#repository = repository;
    this.#policy = policy;
    this.#audit = audit;
  }

  #authorizedContract(envelope: PlatformCommandEnvelope<{ contractId: string }>, commandName: string): BookingContract {
    if (!envelope || envelope.commandName !== commandName) throw new Error(PROTECTED_RESOURCE_DENIAL);
    const contractId = envelope.payload?.contractId;
    if (!contractId) throw new Error(PROTECTED_RESOURCE_DENIAL);
    const contract = this.#repository.findContractById(contractId);
    if (!contract || !isAuthorizedGuest(contract, envelope)) throw new Error(PROTECTED_RESOURCE_DENIAL);
    return contract;
  }

  #arrivalState(contract: BookingContract, reservation: ReservationLike | null, arrival: ProtectedArrivalData | null, now: Date) {
    const confirmed = reservation?.reservationId === contract.reservationId && reservation.status === "confirmed";
    const addressAvailable = confirmed && !!arrival?.fullAddress;
    const accessPermitted = confirmed && !!arrival && this.#policy.canReleaseAccessInstructions({ contract, reservation: reservation as ReservationLike, now });
    const accessAvailable = accessPermitted && !!arrival?.accessInstructions;
    return { confirmed, addressAvailable, accessAvailable, accessPermitted };
  }

  getAuthorizedContractForApplication(envelope: PlatformCommandEnvelope<{ contractId: string }>): BookingContract {
    return this.#authorizedContract(envelope, "contract.get_view");
  }

  getBookingContractView(envelope: PlatformCommandEnvelope<{ contractId: string }>): BookingContractView {
    const contract = this.#authorizedContract(envelope, "contract.get_view");
    const reservation = this.#repository.findReservationById(contract.reservationId);
    const arrival = this.#repository.findArrivalDataByContractId(contract.contractId);
    const state = this.#arrivalState(contract, reservation, arrival, new Date(envelope.timestamp));
    const quote = contract.quote && typeof contract.quote === "object" ? contract.quote as Record<string, unknown> : undefined;
    const allIn = typeof quote?.allInStayTotalKobo === "number" ? quote.allInStayTotalKobo : undefined;
    const deposit = typeof quote?.refundableSecurityDepositKobo === "number" ? quote.refundableSecurityDepositKobo : undefined;
    const currency = typeof quote?.currency === "string" ? quote.currency : undefined;
    const projectionVersion = `${contract.contractVersion}|${reservation?.status ?? "missing"}|${state.addressAvailable ? "address" : "locked"}|${state.accessAvailable ? "access" : "locked"}`;
    const numericVersion = Number.parseInt(Buffer.from(projectionVersion).toString("hex").slice(0, 12), 16);
    const checkout = contract.checkout ?? { time: "11:00" as const, timezone: "Africa/Lagos" as const, source: "contractual" as const };
    return Object.freeze({
      contractId: contract.contractId, reservationId: contract.reservationId, offerId: contract.offerId, unitId: contract.unitId,
      parties: contract.parties, dates: contract.dates, occupants: contract.occupants,
      money: { ...(allIn === undefined ? {} : { allInStayTotalKobo: allIn }), ...(deposit === undefined ? {} : { refundableSecurityDepositKobo: deposit }), totalAmountDueNowKobo: contract.totalAmountDueNowKobo, ...(currency ? { currency } : {}) },
      policies: contract.policies, disclosures: Object.freeze([...(contract.disclosures ?? [])]), contractVersion: contract.contractVersion,
      addressAvailability: state.addressAvailable ? "available" : "locked", accessAvailability: state.accessAvailable ? "available" : "locked",
      ...(arrival?.locationReferenceId ? { locationReferenceId: arrival.locationReferenceId } : {}),
      ...(arrival?.accessReferenceId ? { accessReferenceId: arrival.accessReferenceId } : {}),
      projectionVersion: numericVersion,
      checkout,
    });
  }

  getProtectedArrivalData(envelope: PlatformCommandEnvelope<{ contractId: string }>): ProtectedArrivalView {
    const contract = this.#authorizedContract(envelope, "arrival_data.get_protected");
    const reservation = this.#repository.findReservationById(contract.reservationId);
    const arrival = this.#repository.findArrivalDataByContractId(contract.contractId);
    const state = this.#arrivalState(contract, reservation, arrival, new Date(envelope.timestamp));
    if (!arrival || !state.confirmed) throw new Error(PROTECTED_RESOURCE_DENIAL);
    const releasedCategories: ("address" | "access_instructions")[] = [];
    if (state.addressAvailable) releasedCategories.push("address");
    if (state.accessAvailable) releasedCategories.push("access_instructions");
    if (this.#audit && contract.tenantId) {
      this.#audit.record({ type: "arrival_data.released", contractId: contract.contractId, reservationId: contract.reservationId, tenantId: contract.tenantId, principalId: envelope.principal.id, releasedCategories, policyPermitted: state.accessPermitted, occurredAt: new Date(envelope.timestamp).toISOString() });
    }
    return Object.freeze({ contractId: contract.contractId, reservationId: contract.reservationId, locationReferenceId: arrival.locationReferenceId, accessReferenceId: arrival.accessReferenceId, addressAvailability: state.addressAvailable ? "available" : "locked", accessAvailability: state.accessAvailable ? "available" : "locked", ...(state.addressAvailable && arrival.fullAddress ? { fullAddress: arrival.fullAddress } : {}), ...(state.accessAvailable && arrival.accessInstructions ? { accessInstructions: arrival.accessInstructions } : {}) });
  }

  projectRedactedInteractionView(envelope: PlatformCommandEnvelope<{ contractId: string }>): BookingContractView {
    return this.getBookingContractView(envelope);
  }
}
