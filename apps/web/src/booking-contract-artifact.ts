import type { CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import type { BookingContractView } from "../../../domains/shortlet/src/index.js";
import type { GuestConductPolicySnapshot } from "../../../domains/shortlet/src/index.js";
import { extensionStatusAt, noticeToEndTerms, type ExtensionRequestRecord } from "../../../domains/shortlet/src/index.js";

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
    readonly unitTitle?: string;
    readonly primaryGuest: { readonly id: string; readonly name: string };
    readonly accommodationProvider: { readonly id: string; readonly name?: string };
    readonly checkIn: string;
    readonly checkOut: string;
    readonly nights: number;
    readonly occupants: readonly string[];
    readonly allInStayTotalKobo?: number;
    readonly refundableSecurityDepositKobo?: number;
    readonly securityDeposit?: BookingContractView["money"]["securityDeposit"];
    readonly amountPaidKobo: number;
    readonly currency?: string;
    readonly paymentMethod: "fresh_card" | "bank_transfer";
    readonly cardMetadata?: { readonly brand: string; readonly last4: string };
    readonly cancellationPolicy?: { readonly type?: string; readonly version?: string; readonly summary?: string };
    /** Demo-launch issue 13: the demo Notice to End terms, present for an Extended Stay only (ADR 0092, ADR 0105). */
    readonly noticeToEndTerms?: string;
    /** Issue 18: the Notice to End recorded on this contract (ADR 0060), so a booking surface shows it instead of offering a second one. */
    readonly noticeToEnd?: { readonly newLastNight: string; readonly newCheckOut: string; readonly refundKobo: number; readonly owedKobo: number };
    /** Monthly-stays issue 09 (ADR 0092 Extensions): the latest extension request, its status read at the clock (expiry is lazy). */
    readonly extension?: { readonly status: "awaiting_operator" | "approved" | "declined" | "expired"; readonly extensionId: string; readonly addedNights: number; readonly addedAmountKobo: number; readonly newCheckOut: string; readonly periodDueDate: string; readonly responseDeadlineAt: string };
    /** Monthly-stays issue 09: an Extended Stay with no notice and no request awaiting may offer an extension (the card previews it). */
    readonly extensionOffered?: true;
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

/**
 * Monthly-stays issue 09: the extension facts the booking surface shows. The request's status is read at `now`, so a request past its
 * response window reads as expired without a background job (ADR 0106). An Extended Stay with no notice and nothing awaiting is offered.
 */
function extensionFacts(contract: { readonly extensionRequest?: ExtensionRequestRecord; readonly noticeToEnd?: unknown; readonly quote?: unknown; readonly policies: { readonly cancellationPolicy: unknown } }, now: Date): { readonly extension?: NonNullable<BookingContractArtifact["facts"]["extension"]>; readonly extensionOffered?: true } {
  const record = contract.extensionRequest;
  const status = extensionStatusAt(record, now);
  const extension = record && status ? {
    status,
    extensionId: record.extensionId,
    addedNights: record.addedNights,
    addedAmountKobo: record.addedAmountKobo,
    newCheckOut: record.newCheckOut,
    periodDueDate: record.addedPeriods[0]?.dueDate ?? record.newCheckOut,
    responseDeadlineAt: record.responseDeadlineAt,
  } : undefined;
  const offered = (contract.policies.cancellationPolicy as { readonly type?: unknown } | undefined)?.type === "extended"
    && (contract.quote as { readonly stayType?: unknown } | undefined)?.stayType === "extended"
    && contract.noticeToEnd === undefined
    && extensionStatusAt(contract.extensionRequest, now) !== "awaiting_operator";
  return { ...(extension ? { extension } : {}), ...(offered ? { extensionOffered: true as const } : {}) };
}

/** Issue 18: the Notice to End recorded on a Booking Contract, as the artifact carries it (ADR 0060). Absent when none is recorded. */
function recordedNotice(contract: object): { readonly newLastNight: string; readonly newCheckOut: string; readonly refundKobo: number; readonly owedKobo: number } | undefined {
  const record = contract as { readonly noticeToEnd?: { readonly newLastNight: string; readonly refundKobo?: number; readonly owedKobo?: number }; readonly dates?: { readonly checkOut: string } };
  if (!record.noticeToEnd || !record.dates) return undefined;
  return { newLastNight: record.noticeToEnd.newLastNight, newCheckOut: record.dates.checkOut, refundKobo: record.noticeToEnd.refundKobo ?? 0, owedKobo: record.noticeToEnd.owedKobo ?? 0 };
}

export function bookingContractArtifactId(contractId: string): string { return `booking-contract:${contractId}`; }

export function bookingContractArtifactFromView(view: BookingContractView, contract: { readonly paymentDetails: { readonly paymentMethod: "fresh_card" | "bank_transfer"; readonly amountKobo: number; readonly cardMetadata?: { readonly brand: string; readonly last4: string } }; readonly policies: { readonly cancellationPolicy: unknown; readonly guestConductRules: readonly string[]; readonly guestConductPolicy?: GuestConductPolicySnapshot }; readonly parties: BookingContractView["parties"]; readonly checkout?: BookingContractView["checkout"]; readonly financialSummary?: { readonly currentContractTotalKobo: number; readonly amendmentAdjustments: readonly { readonly amendmentId: string; readonly type: "additional_collection" | "refund" | "none"; readonly amountKobo: number; readonly currency: "NGN" }[] } }, _viewer: CommandPrincipal, options: { readonly demoTerms?: boolean; readonly now?: Date } = {}): BookingContractArtifact {
  const facts = {
    contractId: view.contractId, reservationId: view.reservationId, offerId: view.offerId, unitId: view.unitId,
    primaryGuest: Object.freeze({ ...view.parties.primaryGuest }), accommodationProvider: Object.freeze({ ...view.parties.operator }),
    checkIn: view.dates.checkIn, checkOut: view.dates.checkOut, nights: view.dates.nights,
    occupants: Object.freeze(view.occupants.map(({ name }) => name)),
    ...(view.money.allInStayTotalKobo === undefined ? {} : { allInStayTotalKobo: view.money.allInStayTotalKobo }),
    ...(view.money.refundableSecurityDepositKobo === undefined ? {} : { refundableSecurityDepositKobo: view.money.refundableSecurityDepositKobo }),
    ...(view.money.securityDeposit ? { securityDeposit: view.money.securityDeposit } : {}),
    amountPaidKobo: contract.paymentDetails.amountKobo, ...(view.money.currency ? { currency: view.money.currency } : {}),
    paymentMethod: contract.paymentDetails.paymentMethod, ...(contract.paymentDetails.cardMetadata ? { cardMetadata: Object.freeze({ ...contract.paymentDetails.cardMetadata }) } : {}),
    ...(safeCancellationPolicy(contract.policies.cancellationPolicy) ? { cancellationPolicy: safeCancellationPolicy(contract.policies.cancellationPolicy) } : {}),
    ...((contract.policies.cancellationPolicy as { readonly type?: unknown } | undefined)?.type === "extended" ? { noticeToEndTerms: noticeToEndTerms(options.demoTerms === true) } : {}),
    ...(recordedNotice(contract) ? { noticeToEnd: recordedNotice(contract) } : {}),
    ...extensionFacts(contract, options.now ?? new Date()),
    guestConductRules: Object.freeze(contract.policies.guestConductPolicy ? contract.policies.guestConductPolicy.rules.map((rule) => rule.summary) : [...contract.policies.guestConductRules]),
    ...(contract.policies.guestConductPolicy ? { guestConductPolicy: contract.policies.guestConductPolicy } : {}), contractVersion: view.contractVersion,
    checkout: Object.freeze({ time: view.checkout?.time ?? contract.checkout?.time ?? "11:00", timezone: view.checkout?.timezone ?? contract.checkout?.timezone ?? "Africa/Lagos", source: view.checkout?.source ?? contract.checkout?.source ?? "contractual" }),
    ...(contract.financialSummary ? { currentContractTotalKobo: contract.financialSummary.currentContractTotalKobo, amendmentAdjustments: Object.freeze(contract.financialSummary.amendmentAdjustments.map(({ amendmentId, type, amountKobo, currency }) => ({ amendmentId, type, amountKobo, currency }))) } : {}),
    addressAvailability: view.addressAvailability, accessAvailability: view.accessAvailability,
    ...(view.locationReferenceId ? { locationReferenceId: view.locationReferenceId } : {}), ...(view.accessReferenceId ? { accessReferenceId: view.accessReferenceId } : {}),
  };
  return Object.freeze({ id: bookingContractArtifactId(view.contractId), kind: BOOKING_CONTRACT_ARTIFACT_KIND, schemaVersion: BOOKING_CONTRACT_SCHEMA_VERSION, projectionVersion: view.projectionVersion, domainReferences: Object.freeze([{ type: "booking-contract" as const, id: view.contractId }, { type: "reservation" as const, id: view.reservationId }, { type: "unit" as const, id: view.unitId }]), policyVersions: Object.freeze({ ...(facts.cancellationPolicy?.version ? { cancellationPolicy: facts.cancellationPolicy.version } : {}), contract: String(view.contractVersion) }), disclosures: Object.freeze([...view.disclosures]), facts: Object.freeze(facts), sensitivity: "booking-sensitive" });
}
