import type { CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import type { ConditionalBookingOffer } from "../../../domains/shortlet/src/index.js";

export const CONDITIONAL_OFFER_ARTIFACT_KIND = "shortlet.conditional-booking-offer";
export const CONDITIONAL_OFFER_SCHEMA_VERSION = "shortlet.conditional-booking-offer/v1";

export interface ConditionalOfferArtifactAction {
  readonly type: "accept";
  readonly artifactId: string;
  readonly offerId: string;
  readonly expectedStatus: "issued";
  readonly offerVersion: number;
  readonly projectionVersion: number;
  readonly confirmationToken: string;
}

export interface ConditionalOfferArtifact {
  readonly id: string;
  readonly kind: typeof CONDITIONAL_OFFER_ARTIFACT_KIND;
  readonly schemaVersion: typeof CONDITIONAL_OFFER_SCHEMA_VERSION;
  readonly projectionVersion: number;
  readonly domainReferences: readonly { readonly type: "conditional-offer" | "booking-request" | "unit"; readonly id: string }[];
  readonly policyVersions: Readonly<Record<string, string>>;
  readonly disclosures: readonly string[];
  readonly facts: {
    readonly offerId: string;
    readonly requestId: string;
    readonly unitId: string;
    readonly unitTitle: string;
    readonly status: ConditionalBookingOffer["status"];
    readonly offerVersion: number;
    readonly checkIn: string;
    readonly checkOut: string;
    readonly nights: number;
    readonly primaryGuestName: string;
    readonly occupants: readonly string[];
    readonly distinctPayerName?: string;
    readonly operatorName?: string;
    readonly currency: string;
    readonly allInStayTotalKobo: number;
    readonly refundableSecurityDepositKobo: number;
    readonly totalAmountDueNowKobo: number;
    readonly cancellationPolicy: { readonly type: string; readonly version: string; readonly summary: string };
    readonly guestConductRules: readonly string[];
    readonly paymentWindowExpiresAt: string;
    readonly aggregateVersions: Readonly<Record<string, string | number>>;
  };
  readonly amounts: readonly { readonly type: "all-in-stay-total" | "refundable-security-deposit" | "amount-due-now"; readonly amountKobo: number; readonly currency: string }[];
  readonly actions: readonly ConditionalOfferArtifactAction[];
  readonly acknowledgements: readonly string[];
  readonly sensitivity: "booking-sensitive";
}

export function conditionalOfferArtifactId(offerId: string): string {
  return `conditional-offer:${offerId}`;
}

function phase(status: ConditionalBookingOffer["status"]): number {
  return { issued: 1, accepted: 2, expired: 3, stale: 4, revoked: 5 }[status];
}

export function conditionalOfferArtifactFromOffer(
  offer: ConditionalBookingOffer,
  viewer: CommandPrincipal,
  now: Date,
): ConditionalOfferArtifact {
  const effectiveStatus = offer.status === "issued" && now.getTime() >= new Date(offer.paymentWindow.expiresAt).getTime()
    ? "expired"
    : offer.status;
  const projectionVersion = offer.offerVersion * 10 + phase(effectiveStatus);
  const id = conditionalOfferArtifactId(offer.offerId);
  const quote = offer.quote as { currency?: string; cancellationPolicy?: { type?: string; version?: string; policySummary?: string }; policyVersions?: Record<string, string> };
  const currency = quote.currency ?? "NGN";
  const canAccept = viewer.role === "guest"
    && !!viewer.id
    && viewer.id === offer.parties.primaryGuest.id
    && !!viewer.tenantId
    && !!offer.tenantId
    && viewer.tenantId === offer.tenantId
    && effectiveStatus === "issued"
    && !offer.tokenUsed;
  const facts = {
    offerId: offer.offerId,
    requestId: offer.requestId,
    unitId: offer.unitId,
    unitTitle: offer.unit.title,
    status: effectiveStatus,
    offerVersion: offer.offerVersion,
    checkIn: offer.dates.checkIn,
    checkOut: offer.dates.checkOut,
    nights: offer.dates.nights,
    primaryGuestName: offer.parties.primaryGuest.name,
    occupants: offer.occupants.map((occupant) => occupant.name),
    ...(offer.parties.distinctPayer ? { distinctPayerName: offer.parties.distinctPayer.name } : {}),
    ...(offer.parties.operator.name ? { operatorName: offer.parties.operator.name } : {}),
    currency,
    allInStayTotalKobo: quote && typeof offer.quote.allInStayTotalKobo === "number" ? offer.quote.allInStayTotalKobo : offer.totalAmountDueNowKobo - offer.refundableSecurityDepositKobo,
    refundableSecurityDepositKobo: offer.refundableSecurityDepositKobo,
    totalAmountDueNowKobo: offer.totalAmountDueNowKobo,
    cancellationPolicy: {
      type: quote.cancellationPolicy?.type ?? "standard",
      version: quote.cancellationPolicy?.version ?? offer.aggregateVersions.cancellationPolicyVersion,
      summary: quote.cancellationPolicy?.policySummary ?? "",
    },
    guestConductRules: [...offer.policies.guestConductRules],
    paymentWindowExpiresAt: offer.paymentWindow.expiresAt,
    aggregateVersions: { ...offer.aggregateVersions },
  };
  const actions: readonly ConditionalOfferArtifactAction[] = canAccept
    ? [{ type: "accept", artifactId: id, offerId: offer.offerId, expectedStatus: "issued", offerVersion: offer.offerVersion, projectionVersion, confirmationToken: offer.confirmationToken }]
    : [];
  return Object.freeze({
    id,
    kind: CONDITIONAL_OFFER_ARTIFACT_KIND,
    schemaVersion: CONDITIONAL_OFFER_SCHEMA_VERSION,
    projectionVersion,
    domainReferences: Object.freeze([
      Object.freeze({ type: "conditional-offer" as const, id: offer.offerId }),
      Object.freeze({ type: "booking-request" as const, id: offer.requestId }),
      Object.freeze({ type: "unit" as const, id: offer.unitId }),
    ]),
    policyVersions: Object.freeze({
      ...Object.fromEntries(Object.entries(offer.aggregateVersions).map(([key, value]) => [key, String(value)])),
      ...(quote.policyVersions ?? {}),
    }),
    disclosures: Object.freeze([...offer.disclosures]),
    facts: Object.freeze({ ...facts, occupants: Object.freeze(facts.occupants), guestConductRules: Object.freeze(facts.guestConductRules), aggregateVersions: Object.freeze(facts.aggregateVersions) }),
    amounts: Object.freeze([
      Object.freeze({ type: "all-in-stay-total" as const, amountKobo: facts.allInStayTotalKobo, currency }),
      Object.freeze({ type: "refundable-security-deposit" as const, amountKobo: facts.refundableSecurityDepositKobo, currency }),
      Object.freeze({ type: "amount-due-now" as const, amountKobo: facts.totalAmountDueNowKobo, currency }),
    ]),
    actions: Object.freeze(actions),
    acknowledgements: Object.freeze([]),
    sensitivity: "booking-sensitive",
  });
}
