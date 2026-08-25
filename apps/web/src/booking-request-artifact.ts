import type { CommandPrincipal } from "../../../packages/platform-core/src/index.js";

export const BOOKING_REQUEST_ARTIFACT_KIND = "shortlet.booking-request";
export const BOOKING_REQUEST_SCHEMA_VERSION = "shortlet.booking-request/v1";

export type BookingRequestActionType = "confirm" | "decline";

export interface BookingRequestArtifactAction {
  readonly type: BookingRequestActionType;
  readonly artifactId: string;
  readonly requestId: string;
  readonly expectedStatus: "disclosed";
  readonly projectionVersion: number;
}

export interface BookingRequestArtifact {
  readonly id: string;
  readonly kind: typeof BOOKING_REQUEST_ARTIFACT_KIND;
  readonly schemaVersion: typeof BOOKING_REQUEST_SCHEMA_VERSION;
  readonly projectionVersion: number;
  readonly domainReferences: readonly { readonly type: "booking-request" | "unit"; readonly id: string }[];
  readonly policyVersions: Readonly<Record<string, string>>;
  readonly disclosures: readonly string[];
  readonly facts: {
    readonly requestId: string;
    readonly unitId: string;
    readonly status: string;
    readonly checkIn: string;
    readonly checkOut: string;
    readonly nights: number;
    readonly primaryGuestName?: string;
    readonly occupants: readonly string[];
    readonly quote?: {
      readonly currency: string;
      readonly allInStayTotalKobo: number;
      readonly refundableSecurityDepositKobo: number;
      readonly totalAmountDueNowKobo: number;
    };
    readonly disclosedAt: string;
    readonly delivered: boolean;
    readonly deliveredAt: string | null;
    readonly deliveryDeadlineAt: string;
    readonly operatorResponseDeadlineAt: string;
  };
  readonly amounts: readonly {
    readonly type: "all-in-stay-total" | "refundable-security-deposit" | "amount-due-now";
    readonly amountKobo: number;
    readonly currency: string;
  }[];
  readonly actions: readonly BookingRequestArtifactAction[];
  readonly acknowledgements: readonly string[];
  readonly sensitivity: "booking-sensitive";
}

export interface BookingRequestProjectionInput {
  readonly requestId: string;
  readonly unitId: string;
  readonly tenantId?: string;
  readonly operatorId?: string;
  readonly primaryGuest?: { readonly id: string; readonly name: string };
  readonly occupants?: readonly { readonly name: string }[];
  readonly checkIn: string;
  readonly checkOut: string;
  readonly nights: number;
  readonly quote?: {
    readonly currency?: string;
    readonly allInStayTotalKobo?: number;
    readonly refundableSecurityDepositKobo?: number;
    readonly totalAmountDueNowKobo?: number;
    readonly policyVersions?: Readonly<Record<string, string>>;
    readonly disclosures?: readonly string[];
  };
  readonly disclosedAt: string;
  readonly delivered: boolean;
  readonly deliveredAt: string | null;
  readonly deliveryDeadlineAt: string;
  readonly operatorResponseDeadlineAt: string;
  readonly status: string;
}

function projectionVersion(request: BookingRequestProjectionInput): number {
  if (request.status === "disclosed") return request.delivered ? 3 : 2;
  const statusVersions: Readonly<Record<string, number>> = {
    draft: 1,
    confirmed: 4,
    declined: 5,
    expired: 6,
    delivery_failed: 7,
  };
  return statusVersions[request.status] ?? 0;
}

export function bookingRequestArtifactId(requestId: string): string {
  return `booking-request:${requestId}`;
}

export function bookingRequestArtifactFromRequest(
  request: BookingRequestProjectionInput,
  viewer: CommandPrincipal,
): BookingRequestArtifact {
  const id = bookingRequestArtifactId(request.requestId);
  const version = projectionVersion(request);
  const quote = request.quote;
  const safeQuote = quote && typeof quote.allInStayTotalKobo === "number"
    ? Object.freeze({
      currency: quote.currency ?? "NGN",
      allInStayTotalKobo: quote.allInStayTotalKobo,
      refundableSecurityDepositKobo: quote.refundableSecurityDepositKobo ?? 0,
      totalAmountDueNowKobo: quote.totalAmountDueNowKobo ?? quote.allInStayTotalKobo,
    })
    : undefined;
  const canDecide = viewer.role === "operator" && request.status === "disclosed" && request.delivered && request.operatorId === viewer.id
    && !!request.tenantId && request.tenantId === viewer.tenantId;
  const actions: readonly BookingRequestArtifactAction[] = canDecide
    ? ["confirm", "decline"].map((type) => Object.freeze({
      type: type as BookingRequestActionType,
      artifactId: id,
      requestId: request.requestId,
      expectedStatus: "disclosed" as const,
      projectionVersion: version,
    }))
    : [];
  const amounts = safeQuote
    ? [
      { type: "all-in-stay-total" as const, amountKobo: safeQuote.allInStayTotalKobo, currency: safeQuote.currency },
      { type: "refundable-security-deposit" as const, amountKobo: safeQuote.refundableSecurityDepositKobo, currency: safeQuote.currency },
      { type: "amount-due-now" as const, amountKobo: safeQuote.totalAmountDueNowKobo, currency: safeQuote.currency },
    ]
    : [];

  return Object.freeze({
    id,
    kind: BOOKING_REQUEST_ARTIFACT_KIND,
    schemaVersion: BOOKING_REQUEST_SCHEMA_VERSION,
    projectionVersion: version,
    domainReferences: Object.freeze([
      Object.freeze({ type: "booking-request" as const, id: request.requestId }),
      Object.freeze({ type: "unit" as const, id: request.unitId }),
    ]),
    policyVersions: Object.freeze({ ...(quote?.policyVersions ?? {}) }),
    disclosures: Object.freeze([...(quote?.disclosures ?? [])]),
    facts: Object.freeze({
      requestId: request.requestId,
      unitId: request.unitId,
      status: request.status,
      checkIn: request.checkIn,
      checkOut: request.checkOut,
      nights: request.nights,
      ...(viewer.role === "guest" && request.primaryGuest?.name ? { primaryGuestName: request.primaryGuest.name } : {}),
      occupants: Object.freeze(viewer.role === "guest" ? (request.occupants ?? []).map((occupant) => occupant.name) : []),
      ...(safeQuote ? { quote: safeQuote } : {}),
      disclosedAt: request.disclosedAt,
      delivered: request.delivered,
      deliveredAt: request.deliveredAt,
      deliveryDeadlineAt: request.deliveryDeadlineAt,
      operatorResponseDeadlineAt: request.operatorResponseDeadlineAt,
    }),
    amounts: Object.freeze(amounts.map((amount) => Object.freeze(amount))),
    actions: Object.freeze(actions),
    acknowledgements: Object.freeze([]),
    sensitivity: "booking-sensitive",
  });
}
