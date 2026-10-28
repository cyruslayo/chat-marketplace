import { replacePendingProposal, type AssistantTaskState } from "./assistant-state.js";
import type { PendingAssistantAction } from "./pending-actions.js";
import { PENDING_ACTION_STAGE, retireOwnStages, type AssistantStageHandler, type StageTurnContext } from "./assistant-stage-handler.js";

/**
 * Issue 04: the shortlet pack's stage handlers. Each handler owns one stage name, the stages it retires, and the copy a
 * failed turn falls back to when its surface is the turn's first. The runtime names none of these stages (ADR 0099).
 */

export const DISCOVERY_STAGE = "discovery";
export const UNIT_STAGE = "unit";
export const REQUEST_STAGE = "request";
export const OFFER_STAGE = "offer";
export const PAYMENT_STAGE = "payment";
export const BOOKING_STAGE = "booking";

const DISCOVERY_FALLBACK = "Your current search results are ready below. You can refine them or open a stay.";
const UNIT_FALLBACK = "The selected stay details are ready below.";
const REQUEST_DRAFT_FALLBACK = "Your Request Draft is ready to review below. It has not been submitted.";

/**
 * ADR 0074: whether an open proposal still names the stay the search now holds. The stay, its unit, dates and party must all
 * be unchanged. A proposal without a stay reference (an offer or checkout action) has no stay to match, so a search removes it.
 */
export function proposalStillAuthorised(action: PendingAssistantAction | null | undefined, state: AssistantTaskState): boolean {
  if (!action) return true;
  const refs = action.authoritativeReferences;
  if (!refs.stayRef) return false;
  const stay = state.shortlist.find((candidate) => candidate.stayRef === refs.stayRef);
  return stay !== undefined
    && stay.unitId === refs.unitId
    && state.stayIntent.checkIn === refs.checkIn
    && state.stayIntent.checkOut === refs.checkOut
    && state.stayIntent.partySize === refs.partySize;
}

/**
 * A discovery search. It retires the previous search and details. A search that changes the proposed stay also removes the
 * open proposal (ADR 0074). An unchanged result keeps it.
 */
const discoveryHandler: AssistantStageHandler = {
  stage: DISCOVERY_STAGE,
  supersedes: [DISCOVERY_STAGE, UNIT_STAGE],
  project({ toolName, execution }, turn: StageTurnContext) {
    if (toolName !== "search_stays") return undefined;
    const { tx } = turn;
    if (!proposalStillAuthorised(tx.taskState.pendingAction, tx.taskState) && replacePendingProposal(tx.taskState, "search_changed")) {
      tx.supersede(PENDING_ACTION_STAGE);
    }
    retireOwnStages(discoveryHandler, turn);
    if (!execution.discoveryArtifact) {
      throw new Error("Authoritative discovery did not return an artifact");
    }
    tx.discoveryArtifactId = execution.discoveryArtifact.id;
    tx.discoveryArtifact = execution.discoveryArtifact;
    const surfaceId = `thread-${turn.threadId}:discovery:${execution.discoveryArtifact.id}`;
    tx.place(DISCOVERY_STAGE, surfaceId);
    turn.setStage("a2ui");
    return {
      surface: { surfaceId, a2uiMessages: turn.pack.discoverySurface(execution.discoveryArtifact, surfaceId) },
      fallbackMessage: DISCOVERY_FALLBACK,
    };
  },
};

/** Details of a stay the guest has in the shortlist. An unknown stay reference is claimed and places nothing. */
const unitHandler: AssistantStageHandler = {
  stage: UNIT_STAGE,
  supersedes: [DISCOVERY_STAGE, UNIT_STAGE],
  project({ toolName, args }, turn: StageTurnContext) {
    if (toolName !== "get_unit_details") return undefined;
    const { tx } = turn;
    const stayRef = String(args.stayRef ?? "").trim();
    const stay = tx.taskState.shortlist.find((candidate) => candidate.stayRef === stayRef);
    if (!stay) return {};
    const surfaceId = `thread-${turn.threadId}:unit:detail`;
    retireOwnStages(unitHandler, turn);
    tx.place(UNIT_STAGE, surfaceId);
    const checkIn = tx.taskState.stayIntent.checkIn ?? turn.environment.config.demoCheckIn;
    const checkOut = tx.taskState.stayIntent.checkOut ?? turn.environment.config.demoCheckOut;
    if (!checkOut) throw new Error("The selected stay has no checkout date");
    turn.setStage("a2ui");
    const a2uiMessages = turn.pack.unitDetailSurface({ unitId: stay.unitId, checkIn, checkOut, surfaceId });
    return { surface: { surfaceId, a2uiMessages }, fallbackMessage: UNIT_FALLBACK };
  },
};

/** A Request Draft the planner prepared. It replaces the search, the details and any earlier draft. */
const requestDraftHandler: AssistantStageHandler = {
  stage: REQUEST_STAGE,
  supersedes: [DISCOVERY_STAGE, UNIT_STAGE, REQUEST_STAGE],
  project({ execution }, turn: StageTurnContext) {
    const surface = execution.requestDraftSurface;
    if (!surface) return undefined;
    retireOwnStages(requestDraftHandler, turn);
    turn.tx.place(REQUEST_STAGE, surface.surfaceId);
    turn.setStage("a2ui");
    return { surface: { surfaceId: surface.surfaceId, a2uiMessages: surface.a2uiMessages }, fallbackMessage: REQUEST_DRAFT_FALLBACK };
  },
};

/** The projection handlers, in the order the runtime calls them. A claim by an earlier handler ends the search. */
export const SHORTLET_STAGE_HANDLERS: readonly AssistantStageHandler[] = [discoveryHandler, unitHandler, requestDraftHandler];
