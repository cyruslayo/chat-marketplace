import { createStayQuote, StayDateRange, type Unit } from "../../../../domains/shortlet/src/index.js";
import { draftReplacementToA2UI, type DraftReplacementProposal } from "../../../web-agent/src/index.js";
import { draftReplacementTerms, draftReplacementUnavailable, DRAFT_REPLACEMENT_PROPOSED_COPY, type DraftReplacementStay, type PendingDraftReplacement } from "../draft-replacement.js";
import type { LocalGuestEnvironment } from "../fixture.js";
import type { DraftRevisionRequest } from "./assistant-platform.js";
import type { AssistantTaskState } from "./assistant-state.js";
import { AssistantStayDetailsError } from "./date-tokens.js";

/**
 * Issue 13a (ADR 0106, 2 Nov 2026 classifier decision; ADR 0080): a nights or party change while the guest holds an open
 * Request Draft is a draft revision, not a search. The planner's call is read here; the replacement is quoted by the shared
 * deterministic quote (`draftReplacementTerms`, ADR 0015), and nothing changes until the guest accepts it.
 */

const DAY_MS = 86_400_000;

/** Nights between two ISO dates, or undefined when either is not a date. */
function nightsOf(checkIn: string, checkOut: string): number | undefined {
  const nights = Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / DAY_MS);
  return Number.isFinite(nights) ? nights : undefined;
}

/**
 * The draft revision the planner's search call asks for, or undefined when the call is an ordinary search. A call is a draft
 * revision only when the draft is open, the area is unchanged, no date is given (relative dates are 13b), and nights or
 * party size differ from the draft's own.
 */
export function draftRevisionRequest(input: {
  readonly environment: LocalGuestEnvironment;
  readonly taskState: AssistantTaskState;
  readonly city: string;
  readonly neighbourhood: string | undefined;
  /** The check-in the guest's own words or confirmed show-back give (ADR 0106, 2 Nov 2026). Undefined keeps the draft's own check-in. */
  readonly checkIn: string | undefined;
  readonly nights: number;
  readonly partySize: number;
}): DraftRevisionRequest | undefined {
  const { environment, taskState, city, neighbourhood } = input;
  const draftId = taskState.currentDraftId;
  if (!draftId || taskState.currentBookingRequestId || taskState.currentOfferId || taskState.stayIntent.pendingLocation) return undefined;
  if (city !== taskState.stayIntent.location || neighbourhood !== taskState.stayIntent.neighbourhood) return undefined;
  let draft;
  try {
    draft = environment.bookingRequestApp.getDraft(draftId);
  } catch {
    // Fail closed: a draft the shell cannot read is not revised; the call stays an ordinary search.
    return undefined;
  }
  const draftNights = nightsOf(draft.checkIn, draft.checkOut);
  const draftGuests = draft.occupants.length;
  if (draftNights === undefined) return undefined;
  const checkIn = input.checkIn ?? draft.checkIn;
  const { nights, partySize } = input;
  if (checkIn === draft.checkIn && nights === draftNights && partySize === draftGuests) return undefined;
  return {
    draftId,
    checkIn,
    nights,
    partySize,
    city,
    ...(neighbourhood === undefined ? {} : { neighbourhood }),
  };
}

export interface DraftRevisionProposal {
  readonly surfaceId: string;
  readonly a2uiMessages: readonly unknown[];
  readonly fallbackMessage: string;
  readonly pending: PendingDraftReplacement;
}

/**
 * Quotes the revised stay and builds the replacement the guest must accept. Returns the unchanged-draft refusal copy when the
 * Unit can't take the stay. Throws AssistantStayDetailsError (a rejected tool call, ADR 0106) for a stay the length rules refuse.
 */
export function proposeDraftRevision(input: {
  readonly environment: LocalGuestEnvironment;
  readonly threadId: string;
  readonly taskState: AssistantTaskState;
  readonly change: DraftRevisionRequest;
  readonly now: Date;
}): DraftRevisionProposal | { readonly unavailable: string } {
  const { environment, threadId, taskState, change, now } = input;
  const draft = environment.bookingRequestApp.getDraft(change.draftId);
  const checkOut = new Date(`${change.checkIn}T00:00:00Z`);
  checkOut.setUTCDate(checkOut.getUTCDate() + change.nights);
  const checkOutIso = checkOut.toISOString().slice(0, 10);
  try {
    new StayDateRange(change.checkIn, checkOutIso, now, environment.extendedStayPolicy);
  } catch (error) {
    throw new AssistantStayDetailsError(error instanceof Error ? error.message : "The stay length is not allowed.");
  }
  const stay: DraftReplacementStay = {
    location: change.city,
    ...(change.neighbourhood === undefined ? {} : { neighbourhood: change.neighbourhood }),
    checkIn: change.checkIn,
    checkOut: checkOutIso,
    partySize: change.partySize,
  };
  const proposed = draftReplacementTerms(environment, draft.unitId, stay);
  if (proposed === null) return { unavailable: draftReplacementUnavailable(environment, draft.unitId, stay) };

  const unit = environment.unitRepository.findById(draft.unitId) as Unit | null;
  if (!unit) return { unavailable: draftReplacementUnavailable(environment, draft.unitId, stay) };
  const current = createStayQuote({
    unit,
    checkIn: draft.checkIn,
    checkOut: draft.checkOut,
    partySize: draft.occupants.length,
    ...(environment.extendedStayPolicy ? { extendedStayPolicy: environment.extendedStayPolicy } : {}),
    demoTerms: environment.config.demo === true,
    clock: environment.clock,
  });
  const basedOn = JSON.stringify([draft.draftId, draft.unitId, proposed]);
  const proposal: DraftReplacementProposal = {
    draftId: draft.draftId,
    basedOn,
    unitTitle: unit.title,
    current: {
      checkIn: current.checkIn,
      checkOut: current.checkOut,
      nights: current.nights,
      partySize: draft.occupants.length,
      allInStayTotalKobo: current.allInStayTotalKobo,
      refundableSecurityDepositKobo: current.refundableSecurityDepositKobo,
      amountDueNowKobo: current.totalAmountDueNowKobo,
    },
    proposed,
  };
  const surfaceId = `thread-${threadId}:request:replacement:${draft.draftId}`;
  const bedrooms = taskState.stayIntent.bedrooms;
  const pending: PendingDraftReplacement = {
    basedOnDraftId: draft.draftId,
    basedOn,
    unitId: draft.unitId,
    stay,
    filters: { ...stay, ...(bedrooms === undefined ? {} : { bedrooms }) },
    context: {
      city: change.city,
      ...(change.neighbourhood === undefined ? {} : { neighbourhood: change.neighbourhood }),
      nights: change.nights,
      partySize: change.partySize,
      checkIn: change.checkIn,
      datesConfirmed: true,
      ...(bedrooms === undefined ? {} : { bedrooms }),
    },
    proposed,
    surfaceId,
  };
  return {
    surfaceId,
    a2uiMessages: draftReplacementToA2UI({ proposal, surfaceId }),
    fallbackMessage: DRAFT_REPLACEMENT_PROPOSED_COPY,
    pending,
  };
}
