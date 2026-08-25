import type { CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import type { BookingContract, CardCheckoutSession, Reservation } from "../../../domains/shortlet/src/index.js";

export const CARD_PAYMENT_ARTIFACT_KIND = "shortlet.card-payment";
export const CARD_PAYMENT_SCHEMA_VERSION = "shortlet.card-payment/v1";
export type CardPaymentStatus = "ready" | "checkout_initiated" | "confirmed" | "expired" | "failed";

export interface CardPaymentAction {
  readonly type: "initialize_checkout";
  readonly artifactId: string;
  readonly offerId: string;
  readonly expectedStatus: "ready";
  readonly projectionVersion: number;
}

export interface CardPaymentArtifact {
  readonly id: string;
  readonly kind: typeof CARD_PAYMENT_ARTIFACT_KIND;
  readonly schemaVersion: typeof CARD_PAYMENT_SCHEMA_VERSION;
  readonly projectionVersion: number;
  readonly facts: {
    readonly offerId: string;
    readonly status: CardPaymentStatus;
    readonly unit: string;
    readonly unitId: string;
    readonly checkIn: string;
    readonly checkOut: string;
    readonly amountDueNowKobo: number;
    readonly currency: "NGN";
    readonly paymentWindowExpiresAt: string;
    readonly expectedPayerName?: string;
    readonly checkoutId?: string;
    readonly checkoutUrl?: string;
    readonly expiresAt?: string;
    readonly reservationId?: string;
    readonly contractId?: string;
    readonly contractVersion?: number;
    readonly amountPaidKobo?: number;
    readonly paidAt?: string;
    readonly cardMetadata?: { readonly brand: string; readonly last4: string };
  };
  readonly actions: readonly CardPaymentAction[];
  readonly sensitivity: "booking-sensitive";
}

export function cardPaymentArtifactId(offerId: string): string {
  return `card-payment:${offerId}`;
}

export function cardPaymentArtifactFromState({
  offer,
  viewer,
  session,
  reservation,
  contract,
  now,
}: {
  readonly offer: { offerId: string; unitId: string; unit: { title: string }; dates: { checkIn: string; checkOut: string }; totalAmountDueNowKobo: number; paymentWindow: { expiresAt: string }; status: string; parties: { primaryGuest: { id: string; name: string }; distinctPayer?: { id: string; name: string } | null }; tenantId?: string };
  readonly viewer: CommandPrincipal;
  readonly session?: CardCheckoutSession;
  readonly reservation?: Reservation;
  readonly contract?: BookingContract;
  readonly now: Date;
}): CardPaymentArtifact {
  const id = cardPaymentArtifactId(offer.offerId);
  const expired = now.getTime() >= new Date(offer.paymentWindow.expiresAt).getTime();
  const status: CardPaymentStatus = contract && reservation ? "confirmed" : session?.status === "failed" ? "failed" : session && (session.status === "completed" || session.status === "initiated") && !expired ? (session.status === "completed" ? "confirmed" : "checkout_initiated") : expired ? "expired" : "ready";
  const payer = offer.parties.distinctPayer ?? offer.parties.primaryGuest;
  const canInitialize = status === "ready" && viewer.role === "guest" && !!viewer.id && viewer.id === payer.id && !!viewer.tenantId && !!offer.tenantId && viewer.tenantId === offer.tenantId;
  const facts: CardPaymentArtifact["facts"] = {
    offerId: offer.offerId,
    status,
    unit: offer.unit.title,
    unitId: offer.unitId,
    checkIn: offer.dates.checkIn,
    checkOut: offer.dates.checkOut,
    amountDueNowKobo: offer.totalAmountDueNowKobo,
    currency: "NGN",
    paymentWindowExpiresAt: offer.paymentWindow.expiresAt,
    ...(canInitialize ? { expectedPayerName: payer.name } : {}),
    ...(session && status === "checkout_initiated" ? { checkoutId: session.checkoutId, checkoutUrl: session.checkoutUrl, expiresAt: session.expiresAt } : {}),
    ...(contract && reservation && status === "confirmed" ? {
      reservationId: reservation.reservationId,
      contractId: contract.contractId,
      contractVersion: contract.contractVersion,
      amountPaidKobo: contract.paymentDetails.amountKobo,
      paidAt: contract.paymentDetails.paidAt,
      ...(contract.paymentDetails.cardMetadata ? { cardMetadata: contract.paymentDetails.cardMetadata } : {}),
    } : {}),
  };
  const actions: readonly CardPaymentAction[] = canInitialize ? [{ type: "initialize_checkout", artifactId: id, offerId: offer.offerId, expectedStatus: "ready", projectionVersion: 1 }] : [];
  return Object.freeze({ id, kind: CARD_PAYMENT_ARTIFACT_KIND, schemaVersion: CARD_PAYMENT_SCHEMA_VERSION, projectionVersion: status === "ready" ? 1 : status === "checkout_initiated" ? 2 : status === "confirmed" ? 3 : status === "expired" ? 4 : 5, facts: Object.freeze(facts), actions: Object.freeze(actions), sensitivity: "booking-sensitive" });
}
