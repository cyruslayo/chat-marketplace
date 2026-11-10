/**
 * Typed Pending Action model and confirmation detection (ADR-0072 / ADR-0080).
 *
 * Consequential actions (Request to Book, Accept Offer, Start Checkout)
 * require explicit confirmation before platform execution.
 */

import type { ConditionalBookingOffer } from "../../../../domains/shortlet/src/index.js";

export type PendingActionType = "request_to_book" | "accept_offer" | "start_checkout" | "give_notice" | "request_extension";

export interface PendingActionAuthoritativeReferences {
  readonly stayRef?: string;
  readonly unitId?: string;
  readonly checkIn?: string;
  readonly checkOut?: string;
  readonly partySize?: number;
  readonly stayTotalKobo?: number;
  readonly refundableDepositKobo?: number;
  readonly totalDueNowKobo?: number;
  readonly requestId?: string;
  readonly offerId?: string;
  readonly offerStatus?: ConditionalBookingOffer["status"];
  readonly offerVersion?: number;
  readonly projectionVersion?: number;
  /** Issue 18: the Notice to End the card previews, bound to the notice date and contract version it was shown with (ADR 0060). */
  readonly contractId?: string;
  readonly noticeDate?: string;
  readonly contractVersion?: number;
  readonly newLastNight?: string;
  readonly newCheckOut?: string;
  readonly refundKobo?: number;
  readonly owedKobo?: number;
  /** Monthly-stays issue 09: the extension the card previews, bound to the contract version and new checkout it was shown with (ADR 0060). */
  readonly addedNights?: number;
  readonly addedAmountKobo?: number;
  readonly periodDueDate?: string;
}

export interface PendingAssistantAction {
  readonly id: string; // opaque, e.g. "pa-..."
  readonly threadId: string;
  readonly guestActorId: string;
  readonly tenantId: string;
  readonly type: PendingActionType;
  readonly authoritativeReferences: PendingActionAuthoritativeReferences;
  readonly summary: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly executed: boolean;
}

const CONFIRMATION_AFFIRMATIVES = new Set([
  "yes",
  "yep",
  "yeah",
  "confirm",
  "confirmed",
  "go ahead",
  "proceed",
  "do it",
  "send it",
  "send request",
  "send the request",
  "yes send it",
  "yes send the request",
  "yes please",
  "accept",
  "accept offer",
  "accept it",
  "pay",
  "start payment",
  "continue",
  "ok",
  "okay",
  "sure",
  "yes proceed",
  "yes do it",
  "yes please do",
  "please proceed",
]);

const CANCELLATION_NEGATIVES = new Set([
  "no",
  "nope",
  "cancel",
  "abort",
  "stop",
  "don't",
  "dont",
  "not now",
  "nevermind",
  "never mind",
  "cancel that",
  "no cancel that",
  "no cancel",
]);

/**
 * Issue 18 AC3 (fail closed): the only pending-action types a typed "yes", "ok", "confirm" or "go ahead" may confirm. This is an
 * allow-list, so a new type is excluded until it is added here on purpose. A give_notice card is confirmed only by its button.
 */
const TEXT_CONFIRMABLE_ACTION_TYPES: ReadonlySet<PendingActionType> = new Set<PendingActionType>(["request_to_book", "accept_offer", "start_checkout"]);

export function isTextConfirmable(type: PendingActionType): boolean {
  return TEXT_CONFIRMABLE_ACTION_TYPES.has(type);
}

export function isExplicitConfirmation(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[.,!?;:'"]/g, "").replace(/\s+/g, " ");
  return CONFIRMATION_AFFIRMATIVES.has(normalized);
}

export function isExplicitCancellation(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[.,!?;:'"]/g, "").replace(/\s+/g, " ");
  return CANCELLATION_NEGATIVES.has(normalized);
}
