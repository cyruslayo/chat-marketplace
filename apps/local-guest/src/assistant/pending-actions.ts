/**
 * Typed Pending Action model and confirmation detection (ADR-0072 / ADR-0080).
 *
 * Consequential actions (Request to Book, Accept Offer, Start Checkout)
 * require explicit confirmation before platform execution.
 */

export type PendingActionType = "request_to_book" | "accept_offer" | "start_checkout";

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
  readonly projectionVersion?: number;
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

export function isExplicitConfirmation(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[.,!?;:'"]/g, "").replace(/\s+/g, " ");
  return CONFIRMATION_AFFIRMATIVES.has(normalized);
}

export function isExplicitCancellation(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[.,!?;:'"]/g, "").replace(/\s+/g, " ");
  return CANCELLATION_NEGATIVES.has(normalized);
}

