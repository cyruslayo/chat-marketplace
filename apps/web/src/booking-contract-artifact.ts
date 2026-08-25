import type { CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import type { BookingContractView } from "../../../domains/shortlet/src/contract-release.js";
import type { GuestConductPolicySnapshot } from "../../../domains/shortlet/src/guest-conduct.js";

export const BOOKING_CONTRACT_ARTIFACT_KIND = "shortlet.booking-contract";
export const BOOKING_CONTRACT_SCHEMA_VERSION = "shortlet.booking-contract/v1";

export interface BookingContractArtifact {
  readonly id: string;
  readonly kind: typeof BOOKING_CONTRACT_ARTIFACT_KIND;
  readonly schemaVersion: typeof BOOKING_CONTRACT_SCHEMA_VERSION;
  readonly projectionVersion: number;
  readonly domainReferences: readonly { readonly type: "booking-contract" | "reservation" | "unit"; readonly id: string }[];
  readonly policyVersions: Readonly<Record<string, string>>;
  readonly disclosures: readonly string[];
  readonly facts: {
    readonly contractId: string;
    readonly reservationId: string;
    readonly offerId: string;
    readonly unitId: string;
    readonly primaryGuest: { readonly id: string; readonly name: string };
    readonly accommodationProvider: { readonly id: string; readonly name?: string };
    readonly checkIn: string;
    readonly checkOut: string;
    readonly nights: number;
    readonly occupants: readonly string[];
    readonly allInStayTotalKobo?: number;
    readonly refundableSecurityDepositKobo?: number;
    readonly amountPaidKobo: number;
    readonly currency?: string;
    readonly paymentMethod: "fresh_card" | "bank_transfer";
    readonly cardMetadata?: { readonly brand: string; readonly last4: string };
    readonly cancellationPolicy?: { readonly type?: string; readonly version?: string; readonly summary?: string };
    readonly guestConductRules: readonly string[];
    readonly guestConductPolicy?: GuestConductPolicySnapshot;
    readonly contractVersion: number;
    readonly checkout?: { readonly time: "11:00" | "12:00" | "13:00" | "14:00"; readonly timezone: "Africa/Lagos"; readonly source: "contractual" | "checkout_amendment" };
    readonly currentContractTotalKobo?: number;
    readonly amendmentAdjustments?: readonly { readonly amendmentId: string; readonly type: "additional_collection" | "refund" | "none"; readonly amountKobo: number; readonly currency: "NGN" }[];
    readonly addressAvailability: "locked" | "available";
    readonly accessAvailability: "locked" | "available";
    readonly locationReferenceId?: string;
    readonly accessReferenceId?: string;
  };
  readonly sensitivity: "booking-sensitive";
}

function safeCancellationPolicy(value: unknown): BookingContractArtifact["facts"]["cancellationPolicy"] {
  if (!value || typeof value !== "object") return undefined;
  const policy = value as Record<string, unknown>;
  const result = {
    ...(typeof policy.type === "string" ? { type: policy.type } : {}),
    ...(typeof policy.version === "string" ? { version: policy.version } : {}),
    ...(typeof policy.policySummary === "string" ? { summary: policy.policySummary } : {}),
  };
  return Object.keys(result).length ? Object.freeze(result) : undefined;
}

export function bookingContractArtifactId(contractId: string): string { return `booking-contract:${contractId}`; }

export function bookingContractArtifactFromView(view: BookingContractView, contract: { readonly paymentDetails: { readonly paymentMethod: "fresh_card" | "bank_transfer"; readonly amountKobo: number; readonly cardMetadata?: { readonly brand: string; readonly last4: string } }; readonly policies: { readonly cancellationPolicy: unknown; readonly guestConductRules: readonly string[]; readonly guestConductPolicy?: GuestConductPolicySnapshot }; readonly parties: BookingContractView["parties"]; readonly checkout?: BookingContractView["checkout"]; readonly financialSummary?: { readonly currentContractTotalKobo: number; readonly amendmentAdjustments: readonly { readonly amendmentId: string; readonly type: "additional_collection" | "refund" | "none"; readonly amountKobo: number; readonly currency: "NGN" }[] } }, _viewer: CommandPrincipal): BookingContractArtifact {
  const facts = {
    contractId: view.contractId, reservationId: view.reservationId, offerId: view.offerId, unitId: view.unitId,
    primaryGuest: Object.freeze({ ...view.parties.primaryGuest }), accommodationProvider: Object.freeze({ ...view.parties.operator }),
    checkIn: view.dates.checkIn, checkOut: view.dates.checkOut, nights: view.dates.nights,
    occupants: Object.freeze(view.occupants.map(({ name }) => name)),
    ...(view.money.allInStayTotalKobo === undefined ? {} : { allInStayTotalKobo: view.money.allInStayTotalKobo }),
    ...(view.money.refundableSecurityDepositKobo === undefined ? {} : { refundableSecurityDepositKobo: view.money.refundableSecurityDepositKobo }),
    amountPaidKobo: contract.paymentDetails.amountKobo, ...(view.money.currency ? { currency: view.money.currency } : {}),
    paymentMethod: contract.paymentDetails.paymentMethod, ...(contract.paymentDetails.cardMetadata ? { cardMetadata: Object.freeze({ ...contract.paymentDetails.cardMetadata }) } : {}),
    ...(safeCancellationPolicy(contract.policies.cancellationPolicy) ? { cancellationPolicy: safeCancellationPolicy(contract.policies.cancellationPolicy) } : {}),
    guestConductRules: Object.freeze(contract.policies.guestConductPolicy ? contract.policies.guestConductPolicy.rules.map((rule) => rule.summary) : [...contract.policies.guestConductRules]),
    ...(contract.policies.guestConductPolicy ? { guestConductPolicy: contract.policies.guestConductPolicy } : {}), contractVersion: view.contractVersion,
    checkout: Object.freeze({ time: view.checkout?.time ?? contract.checkout?.time ?? "11:00", timezone: view.checkout?.timezone ?? contract.checkout?.timezone ?? "Africa/Lagos", source: view.checkout?.source ?? contract.checkout?.source ?? "contractual" }),
    ...(contract.financialSummary ? { currentContractTotalKobo: contract.financialSummary.currentContractTotalKobo, amendmentAdjustments: Object.freeze(contract.financialSummary.amendmentAdjustments.map(({ amendmentId, type, amountKobo, currency }) => ({ amendmentId, type, amountKobo, currency }))) } : {}),
    addressAvailability: view.addressAvailability, accessAvailability: view.accessAvailability,
    ...(view.locationReferenceId ? { locationReferenceId: view.locationReferenceId } : {}), ...(view.accessReferenceId ? { accessReferenceId: view.accessReferenceId } : {}),
  };
  return Object.freeze({ id: bookingContractArtifactId(view.contractId), kind: BOOKING_CONTRACT_ARTIFACT_KIND, schemaVersion: BOOKING_CONTRACT_SCHEMA_VERSION, projectionVersion: view.projectionVersion, domainReferences: Object.freeze([{ type: "booking-contract" as const, id: view.contractId }, { type: "reservation" as const, id: view.reservationId }, { type: "unit" as const, id: view.unitId }]), policyVersions: Object.freeze({ ...(facts.cancellationPolicy?.version ? { cancellationPolicy: facts.cancellationPolicy.version } : {}), contract: String(view.contractVersion) }), disclosures: Object.freeze([...view.disclosures]), facts: Object.freeze(facts), sensitivity: "booking-sensitive" });
}
