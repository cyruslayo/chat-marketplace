/**
 * The guest's booking stage, derived from facts the thread already holds (issue 10, state-machines Track B: no behaviour change).
 * The stage is never stored as one value. Each function here is one derivation site's current rule, reproduced exactly; the site
 * builds its plain inputs and calls the function. Pure: no clock, no store, no thread. Persisted `activeStage` strings are never
 * renamed (state-machines PRD rule). Read ADR 0106 (cold restore re-derives, never re-mints) and ADR 0074 before changing a rule.
 */

/** Where the Guest is in the journey (issue 04a). `draft` is a Request Draft with no request sent yet. */
export const GUEST_STAGES = ["discovery", "unit", "draft", "request", "offer", "payment", "booking"] as const;

export type GuestStage = (typeof GUEST_STAGES)[number];

/** Surface stages: the keys of `thread.activeSurfaces`, and the values the persisted `activeStage` takes. */
export const DISCOVERY_STAGE = "discovery";
export const UNIT_STAGE = "unit";
export const REQUEST_STAGE = "request";
export const OFFER_STAGE = "offer";
export const PAYMENT_STAGE = "payment";
export const BOOKING_STAGE = "booking";
/** Issue 13b: the two-up comparison opened from results. */
export const COMPARE_STAGE = "compare";
/** Issue 14: a proposed replacement Request Draft awaiting the Guest's choice. */
export const DRAFT_REPLACEMENT_STAGE = "draft_replacement";

/** The plain facts the Guest stage is read from. `activeSurfaces` holds the stage keys with an active surface. */
export interface GuestStageInputs {
  readonly activeSurfaces: ReadonlySet<string>;
  readonly offerId: boolean;
  readonly requestId: boolean;
  readonly draftId: boolean;
  readonly unitDetail: boolean;
}

/** Site `#guestStage` (shortlet-app.ts): booking, payment, offer, request, draft, unit, else discovery. */
export function stageForGuestThread(inputs: GuestStageInputs): GuestStage {
  if (inputs.activeSurfaces.has(BOOKING_STAGE)) return "booking";
  if (inputs.activeSurfaces.has(PAYMENT_STAGE)) return "payment";
  if (inputs.offerId) return "offer";
  if (inputs.requestId) return "request";
  if (inputs.draftId) return "draft";
  if (inputs.unitDetail) return "unit";
  return "discovery";
}

/** Site `#stageForSurfaceId` (shortlet-app.ts): the stage a surface id belongs to, read from the id's segments. */
export function stageForSurfaceId(surfaceId: string): string | null {
  // Issue 13b: a comparison is restored as the results it was opened from.
  if (surfaceId.includes(":discovery:") || surfaceId.includes(":compare:")) return DISCOVERY_STAGE;
  if (surfaceId.includes(":request:replacement:")) return DRAFT_REPLACEMENT_STAGE;
  if (surfaceId.includes(":unit:")) return UNIT_STAGE;
  if (surfaceId.includes(":request:draft:") || surfaceId.includes(":request:review:")) return REQUEST_STAGE;
  if (surfaceId.includes(":request:req-") || surfaceId.includes(":request:")) return REQUEST_STAGE;
  if (surfaceId.includes(":offer:")) return OFFER_STAGE;
  if (surfaceId.includes(":payment:")) return PAYMENT_STAGE;
  if (surfaceId.includes(":booking:")) return BOOKING_STAGE;
  // The contact-details form belongs to the stage it was opened from (see `#contactSurface`).
  if (surfaceId.includes(":contact:phone:")) return REQUEST_STAGE;
  if (surfaceId.includes(":contact:email:")) return PAYMENT_STAGE;
  return null;
}

/** Site `#inferActiveStage` (shortlet-app.ts): the furthest active surface, used when the current surface id names no stage. */
export function inferActiveStage(activeSurfaces: ReadonlySet<string>): string | null {
  if (activeSurfaces.has(BOOKING_STAGE)) return BOOKING_STAGE;
  if (activeSurfaces.has(PAYMENT_STAGE)) return PAYMENT_STAGE;
  if (activeSurfaces.has(OFFER_STAGE)) return OFFER_STAGE;
  if (activeSurfaces.has(REQUEST_STAGE)) return REQUEST_STAGE;
  if (activeSurfaces.has(UNIT_STAGE)) return UNIT_STAGE;
  if (activeSurfaces.has(DISCOVERY_STAGE)) return DISCOVERY_STAGE;
  return null;
}

/**
 * The `activeStage` written with a saved thread (shortlet-app.ts `#persistThread`, `#persistRemoteThread`): the current surface's stage,
 * or the inferred one when that surface names none.
 */
export function persistedActiveStage(currentSurfaceId: string, activeSurfaces: ReadonlySet<string>): string | null {
  return stageForSurfaceId(currentSurfaceId) ?? inferActiveStage(activeSurfaces);
}

/** The journey rail's tail (shortlet-app.ts `#journeyFor`, after the offer and request branches). `null` when there is no rail. */
export interface JourneyTailInputs {
  readonly unitSurfaceActive: boolean;
  readonly draftId: boolean;
  /** `stageForSurfaceId` of the thread's last surface. */
  readonly lastSurfaceStage: string | null;
  readonly discoveryArtifact: boolean;
}

export function journeyTailStep(inputs: JourneyTailInputs): "stay" | "request" | "search" | null {
  if (inputs.unitSurfaceActive) return "stay";
  // A kept draft counts only while it is the surface on screen, not after a new search.
  if (inputs.draftId && inputs.lastSurfaceStage === REQUEST_STAGE) return "request";
  if (inputs.discoveryArtifact) return "search";
  return null;
}

/** The copy the timeline shows after a turn that wrote no typed reply (shortlet-app.ts `#safeAssistantTimelineMessage`). */
export interface TimelineCopyInputs {
  /** `stageForSurfaceId` of the thread's last surface. */
  readonly lastSurfaceStage: string | null;
  readonly draftId: boolean;
  readonly requestId: boolean;
  readonly offerId: boolean;
  readonly discoveryArtifact: boolean;
}

export function timelineCopyKey(inputs: TimelineCopyInputs): "draftReady" | "detailsReady" | "statusReady" | "results" | "clarification" {
  if (inputs.lastSurfaceStage === REQUEST_STAGE && inputs.draftId && !inputs.requestId) return "draftReady";
  if (inputs.lastSurfaceStage === UNIT_STAGE) return "detailsReady";
  if (inputs.requestId || inputs.offerId) return "statusReady";
  if (inputs.discoveryArtifact) return "results";
  return "clarification";
}

/** Site `dateShowBackFor` (shortlet-assistant-pack.ts): a Request Draft is open when a draft is held and no request or offer is. */
export interface DateShowBackInputs {
  readonly draftId: boolean;
  readonly requestId: boolean;
  readonly offerId: boolean;
}

export function dateShowBackStage(inputs: DateShowBackInputs): "draft" | "stay" {
  return inputs.draftId && !inputs.requestId && !inputs.offerId ? "draft" : "stay";
}

/** Site `shortletTaskSummary` (shortlet-assistant-pack.ts): the shortlet task's step on the shell rail. */
export interface ShortletTaskInputs {
  readonly contractOrReservation: boolean;
  readonly offerId: boolean;
  readonly requestOrDraft: boolean;
  readonly staySelected: boolean;
  /** The same fact `sentStage` reads: the held offer's status is accepted (issue 18, D3). */
  readonly offerAccepted: boolean;
}

export function shortletTaskStatus(inputs: ShortletTaskInputs): "confirmed" | "payment" | "offer" | "request" | "stay" | "search" {
  if (inputs.contractOrReservation) return "confirmed";
  if (inputs.offerId && inputs.offerAccepted) return "payment";
  if (inputs.offerId) return "offer";
  if (inputs.requestOrDraft) return "request";
  if (inputs.staySelected) return "stay";
  return "search";
}

/**
 * Site `sentStageFor` (shortlet-assistant-pack.ts), ADR 0005, 0060, 0080: the stage a sent stay is in. `offerAccepted` is read only when
 * an offer is held and no booking exists, as the site always did. Undefined before anything is sent.
 */
export interface SentStageInputs {
  readonly bookingHeld: boolean;
  readonly offerId: boolean;
  readonly requestId: boolean;
  readonly offerAccepted: () => boolean;
}

export function sentStage(inputs: SentStageInputs): "request" | "offer" | "payment" | "booking" | undefined {
  if (inputs.bookingHeld) return "booking";
  if (inputs.offerId) return inputs.offerAccepted() ? "payment" : "offer";
  if (inputs.requestId) return "request";
  return undefined;
}

/**
 * Site `#journeyFor` (shortlet-app.ts), the offer and request branches. Each read is lazy, in the same order and only where the site
 * always made it, so a read that throws still ends the rail as it did (the caller keeps the try). `null` when the thread holds neither an
 * offer nor a request: the rail then continues with `journeyTailStep`.
 */
export interface JourneyRailFacts {
  readonly offerId: boolean;
  readonly requestId: boolean;
  readonly paymentSurfaceActive: boolean;
  readonly bookingSnapshotHeld: () => boolean;
  readonly offerStatus: () => string;
  readonly paymentStatus: () => string;
  readonly requestFacts: () => { readonly status: string; readonly delivered: boolean };
}

export type JourneyRailDecision =
  | { readonly step: "confirmed" }
  | { readonly step: "pay"; readonly failure?: "expired" | "failed" }
  | { readonly step: "offer"; readonly outcome?: "expired" | "stale" | "revoked" }
  | { readonly step: "request"; readonly status: string; readonly delivered: boolean; readonly outcome?: "declined" | "expired" | "delivery_failed" };

export function journeyRailStep(facts: JourneyRailFacts): JourneyRailDecision | null {
  // ADR-0005: "Confirmed" only once the durable Booking Contract exists.
  if (facts.offerId) {
    if (facts.bookingSnapshotHeld()) return { step: "confirmed" };
    const offer = facts.offerStatus();
    if (offer === "accepted" || facts.paymentSurfaceActive) {
      const payment = facts.paymentStatus();
      if (payment === "expired" || payment === "failed") return { step: "pay", failure: payment };
      return { step: "pay" };
    }
    if (offer === "expired") return { step: "offer", outcome: "expired" };
    if (offer === "stale") return { step: "offer", outcome: "stale" };
    if (offer === "revoked") return { step: "offer", outcome: "revoked" };
    return { step: "offer" };
  }
  if (facts.requestId) {
    const request = facts.requestFacts();
    const outcome = request.status === "declined" || request.status === "expired" || request.status === "delivery_failed" ? request.status : undefined;
    return { step: "request", status: request.status, delivered: request.delivered, ...(outcome === undefined ? {} : { outcome }) };
  }
  return null;
}

/**
 * Site `#restoreCurrentSurface` (shortlet-app.ts): which stage branch the restore runs, from the persisted stage and the facts the guards
 * always read. The branch bodies (surface building, id re-keying, fallthrough) stay in the method. Guards are tested in the same order.
 */
export interface RestoreStageInputs {
  readonly activeStage: string | null;
  readonly unitDetail: boolean;
  readonly discoveryArtifact: boolean;
  readonly draftId: boolean;
  readonly requestId: boolean;
  readonly offerId: boolean;
}

export type RestoreBranch = "unit" | "draft" | "request" | "offer" | "payment" | "booking" | "discovery";

export function restoreStage(inputs: RestoreStageInputs): RestoreBranch | null {
  if (inputs.activeStage === UNIT_STAGE && inputs.unitDetail && inputs.discoveryArtifact) return "unit";
  if (inputs.activeStage === REQUEST_STAGE && inputs.draftId && !inputs.requestId) return "draft";
  if (inputs.activeStage === REQUEST_STAGE && inputs.requestId) return "request";
  if (inputs.activeStage === OFFER_STAGE && inputs.offerId) return "offer";
  if (inputs.activeStage === PAYMENT_STAGE && inputs.offerId) return "payment";
  if (inputs.activeStage === BOOKING_STAGE) return "booking";
  if (inputs.activeStage === DISCOVERY_STAGE && inputs.discoveryArtifact) return "discovery";
  return null;
}
