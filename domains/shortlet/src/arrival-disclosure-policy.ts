import type { BookingContract, Reservation } from "./card-payment.js";

export interface ArrivalDisclosurePolicyInput {
  readonly contract: BookingContract;
  readonly reservation: ReservationLike;
  readonly now: Date;
}

export interface ReservationLike {
  readonly reservationId: string;
  readonly status: string;
}

/** Access instructions are locked unless a trusted caller explicitly approves them. */
export interface ArrivalDisclosurePolicy {
  /** The future check-in eligibility decision gates all protected arrival data. */
  canReleaseProtectedArrivalData?(input: ArrivalDisclosurePolicyInput): boolean;
  canReleaseAccessInstructions(input: ArrivalDisclosurePolicyInput): boolean;
}

export const failClosedArrivalDisclosurePolicy: ArrivalDisclosurePolicy = Object.freeze({
  canReleaseProtectedArrivalData: () => false,
  canReleaseAccessInstructions: () => false,
});

