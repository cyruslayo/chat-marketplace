import type { CommandPrincipal } from "../../../../packages/platform-core/src/index.js";
import { replacePendingProposal, type AssistantTaskState } from "./assistant-state.js";
import { pendingProposalAuthorised } from "./assistant-platform.js";
import type { PendingAssistantAction } from "./pending-actions.js";
import { AssistantStaleProposalError, PENDING_ACTION_STAGE, retireOwnStages, type AssistantStageHandler, type StageTurnContext } from "./assistant-stage-handler.js";
import { UnitUnavailableError } from "../../../../domains/shortlet/src/index.js";

/**
 * Issue 04: the shortlet pack's stage handlers. Each handler owns one stage name, the stages it retires, the copy a failed
 * turn falls back to when its surface is the turn's first, and (for a consequential action) the confirmation it runs. The
 * runtime names none of these stages, kinds or copy (ADR 0099). It runs the authority checks (thread, actor, tenant, expiry,
 * already executed; ADR 0070, 0074, 0075) before any `confirm` here is called.
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
    if (!pendingProposalAuthorised(turn.pack, tx.taskState) && replacePendingProposal(tx.taskState, "search_changed")) {
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

/**
 * Confirms a proposed booking request: revalidates the Unit, dates and party, creates and discloses the request, then
 * presents the request and, when the operator accepts at once (the staging demo only, ADR 0105), the offer.
 */
const requestToBookHandler: AssistantStageHandler = {
  stage: REQUEST_STAGE,
  supersedes: [UNIT_STAGE],
  confirms: "request_to_book",
  confirm(action, turn: StageTurnContext) {
    const { tx, environment, threadId } = turn;
    const refs = action.authoritativeReferences;
    if (!refs.unitId || !refs.checkIn || !refs.checkOut) {
      return { ok: false, code: "INVALID_CONTEXT", message: "Incomplete booking details." };
    }

    const guest: CommandPrincipal = environment.guestPrincipal();

    // Pre-execution revalidation: re-read current Unit/discovery truth for the same Unit, dates, and party size.
    const verdict = turn.pack.revalidateProposal(action);
    if (!verdict.ok) {
      tx.clearPendingAction();
      return { ok: false, code: verdict.code, message: verdict.message };
    }

    let disclosed: ReturnType<typeof environment.bookingRequestApp.disclose>;
    try {
      const draft = environment.bookingRequestApp.createDraft(
        {
          unitId: refs.unitId,
          primaryGuest: { id: environment.config.guestId, name: environment.config.guestName },
          occupants: environment.demoOccupants(refs.partySize ?? 1),
          selfBookingAttestation: environment.selfBookingAttestation(),
          checkIn: refs.checkIn,
          checkOut: refs.checkOut,
        },
        guest,
      );

      disclosed = environment.bookingRequestApp.disclose(draft.draftId, guest);
    } catch (error) {
      // Issue 06: a Unit or date refusal is the stale-proposal case, reported as the typed error the runtime classifies. Any other
      // failure may follow a side effect and propagates unchanged: the runtime drops the proposal and never reports it as stale.
      if (error instanceof UnitUnavailableError) {
        throw new AssistantStaleProposalError("The unit is no longer available for those dates. Review the current options.");
      }
      throw error;
    }

    // POST-AUTHORITATIVE-COMMIT RECONCILIATION:
    // Booking request has committed. Record it authoritatively in working state.
    tx.taskState.currentBookingRequestId = disclosed.requestId;
    tx.taskState.goal = "book_stay";
    tx.clearPendingAction();

    const requestSurfaceId = `thread-${threadId}:request:${disclosed.requestId}`;
    retireOwnStages(requestToBookHandler, turn);
    tx.place(REQUEST_STAGE, requestSurfaceId);

    let requestArtifact: ReturnType<typeof environment.bookingRequestApp.getArtifact>;
    try {
      requestArtifact = environment.bookingRequestApp.getArtifact(disclosed.requestId, guest);
    } catch {
      // If artifact presentation read fails, retain authoritative commit truth
      return {
        ok: true,
        message: "Your booking request has been submitted to the host. You can check status at any time.",
        surfaces: [],
      };
    }

    // ADR 0041: production disclosure must wait for an authorized Operator's real confirmation. ADR 0105: the staging demo
    // is the only exception, and it accepts through the operator command path rather than the fixture simulator.
    if (environment.config.production && environment.config.demoRequestAcceptor?.delaySeconds !== 0) {
      return {
        ok: true,
        message: "Your booking request has been submitted to the host and is awaiting review.",
        surfaces: [
          {
            surfaceId: requestSurfaceId,
            a2uiMessages: turn.pack.bookingRequestSurface(requestArtifact, requestSurfaceId),
          },
        ],
      };
    }

    // Attempt local operator simulation
    try {
      const { offerId } = environment.config.demoRequestAcceptor === undefined
        ? environment.simulateOperatorAcceptance(disclosed.requestId)
        : environment.acceptDisclosedRequest(disclosed.requestId);
      tx.taskState.currentOfferId = offerId;
      const offerSurfaceId = `thread-${threadId}:offer:${offerId}`;
      tx.place(OFFER_STAGE, offerSurfaceId);

      const offerArtifact = environment.conditionalOfferApp.getArtifact(offerId, guest);

      return {
        ok: true,
        message: "The host has accepted your request. Here is your booking offer.",
        surfaces: [
          {
            surfaceId: requestSurfaceId,
            a2uiMessages: turn.pack.bookingRequestSurface(requestArtifact, requestSurfaceId),
          },
          {
            surfaceId: offerSurfaceId,
            a2uiMessages: turn.pack.conditionalOfferSurface(offerArtifact, offerSurfaceId),
          },
        ],
      };
    } catch {
      // If operator simulation or offer presentation fails, DO NOT pretend booking request was rolled back.
      // Disclose committed, request exists. Check if operator confirmed it before failure.
      let statusMessage = "Your booking request has been submitted to the host and is awaiting review.";
      try {
        const currentReq = environment.bookingRequestApp.getArtifact(disclosed.requestId, guest);
        if (currentReq.facts.status === "confirmed") {
          statusMessage = "Your booking request has been confirmed by the host. Preparing your booking offer.";
        }
      } catch {
        // Keep default message if read fails
      }
      return {
        ok: true,
        message: statusMessage,
        surfaces: [
          {
            surfaceId: requestSurfaceId,
            a2uiMessages: turn.pack.bookingRequestSurface(requestArtifact, requestSurfaceId),
          },
        ],
      };
    }
  },
};

/** Accepts a conditional offer through the authoritative command, after the offer's version and amounts are rechecked. */
const acceptOfferHandler: AssistantStageHandler = {
  stage: PAYMENT_STAGE,
  supersedes: [OFFER_STAGE],
  confirms: "accept_offer",
  confirm(action, turn: StageTurnContext) {
    const { tx, environment, threadId } = turn;
    const refs = action.authoritativeReferences;
    const offerId = refs.offerId;
    if (!offerId) {
      return { ok: false, code: "INVALID_ARTIFACT", message: "No offer reference found." };
    }

    const offerArtifact = environment.conditionalOfferApp.getArtifact(offerId, environment.guestPrincipal());
    if (refs.offerStatus !== offerArtifact.facts.status
      || refs.offerVersion !== offerArtifact.facts.offerVersion
      || refs.projectionVersion !== offerArtifact.projectionVersion
      || refs.stayTotalKobo !== offerArtifact.facts.allInStayTotalKobo
      || refs.refundableDepositKobo !== offerArtifact.facts.refundableSecurityDepositKobo
      || refs.totalDueNowKobo !== offerArtifact.facts.totalAmountDueNowKobo) {
      tx.clearPendingAction();
      return { ok: false, code: "STALE_SURFACE", message: "The offer changed. Review the current offer before accepting." };
    }
    const acceptAction = offerArtifact.actions.find((a) => a.type === "accept");
    if (!acceptAction) {
      tx.clearPendingAction();
      return { ok: false, code: "ACTION_NOT_AUTHORIZED", message: "Offer cannot be accepted in current state." };
    }

    // Accept offer through authoritative application command
    environment.conditionalOfferApp.accept({
      offerId,
      confirmationToken: acceptAction.confirmationToken,
      expectedVersion: acceptAction.offerVersion,
      principal: environment.guestPrincipal(),
    });

    // POST-AUTHORITATIVE-COMMIT RECONCILIATION:
    // Offer acceptance committed. Pending action consumed, cannot replay.
    tx.clearPendingAction();

    const paymentSurfaceId = `thread-${threadId}:payment:${offerId}`;
    retireOwnStages(acceptOfferHandler, turn);
    tx.place(PAYMENT_STAGE, paymentSurfaceId);

    try {
      const paymentArtifact = environment.cardPaymentApp.getArtifact(offerId, environment.guestPrincipal());
      return {
        ok: true,
        message: "Offer accepted. Complete the secure card payment to confirm your booking.",
        surfaces: [
          {
            surfaceId: paymentSurfaceId,
            a2uiMessages: turn.pack.cardPaymentSurface(paymentArtifact, paymentSurfaceId),
          },
        ],
      };
    } catch {
      // If payment presentation fails, retain accepted state authoritatively
      return {
        ok: true,
        message: "Offer accepted successfully. Proceed to payment checkout.",
        surfaces: [],
      };
    }
  },
};

/** Starts card checkout for an accepted offer and confirms it once the payment is verified and the contract recorded. */
const startCheckoutHandler: AssistantStageHandler = {
  stage: BOOKING_STAGE,
  supersedes: [PAYMENT_STAGE],
  confirms: "start_checkout",
  confirm(action, turn: StageTurnContext) {
    const { tx, environment, threadId } = turn;
    const refs = action.authoritativeReferences;
    const offerId = refs.offerId;
    if (!offerId) {
      return { ok: false, code: "INVALID_ARTIFACT", message: "No payment reference found." };
    }

    // Revalidate start_checkout against current authoritative card-payment artifact
    let paymentArtifact;
    try {
      paymentArtifact = environment.cardPaymentApp.getArtifact(offerId, environment.guestPrincipal());
    } catch {
      tx.clearPendingAction();
      return { ok: false, code: "STALE_SURFACE", message: "Payment checkout is no longer available for this offer." };
    }

    if (refs.offerId !== offerId
      || (refs.projectionVersion !== undefined && refs.projectionVersion !== paymentArtifact.projectionVersion)
      || (refs.stayTotalKobo !== undefined && refs.stayTotalKobo !== paymentArtifact.facts.allInStayTotalKobo)
      || (refs.refundableDepositKobo !== undefined && refs.refundableDepositKobo !== paymentArtifact.facts.refundableSecurityDepositKobo)
      || (refs.totalDueNowKobo !== undefined && refs.totalDueNowKobo !== paymentArtifact.facts.amountDueNowKobo)) {
      tx.clearPendingAction();
      return { ok: false, code: "STALE_SURFACE", message: "Payment details or amounts have changed. Please review the updated checkout." };
    }

    let session = environment.cardPaymentApp.getCheckoutSession(offerId);
    if (!session) {
      session = environment.cardPaymentApp.initializeCheckout(offerId, environment.guestPrincipal());
    }

    let outcome = environment.cardPaymentApp.verifyAndConfirm(session.pspReference, environment.systemPrincipal());
    if (outcome.outcome === "deposit_required") {
      session = environment.cardPaymentApp.initializeCheckout(offerId, environment.guestPrincipal());
      outcome = environment.cardPaymentApp.verifyAndConfirm(session.pspReference, environment.systemPrincipal());
    }

    if (outcome.outcome !== "confirmed") {
      return { ok: false, code: "PAYMENT_NOT_CONFIRMED", message: "Payment could not be completed." };
    }

    // Authoritatively commit to contract repository
    environment.contractRepository.recordConfirmedOutcome(outcome.reservation, outcome.bookingContract);

    // POST-AUTHORITATIVE-COMMIT RECONCILIATION:
    // Payment committed. Reservation and contract recorded. Action consumed, cannot replay.
    const contractId = outcome.bookingContract.contractId;
    tx.taskState.currentReservationId = outcome.reservation.reservationId;
    tx.taskState.currentContractId = contractId;
    tx.clearPendingAction();

    const paymentSurfaceId = `thread-${threadId}:payment:confirmed:${offerId}`;
    const bookingSurfaceId = `thread-${threadId}:booking:${contractId}`;
    retireOwnStages(startCheckoutHandler, turn);
    tx.place(BOOKING_STAGE, bookingSurfaceId);

    try {
      const updatedPaymentArtifact = environment.cardPaymentApp.getArtifact(offerId, environment.guestPrincipal());
      const contractArtifact = environment.contractApp.getArtifact(contractId, environment.guestPrincipal());

      return {
        ok: true,
        message: "Payment complete. Your booking is confirmed.",
        surfaces: [
          {
            surfaceId: paymentSurfaceId,
            a2uiMessages: turn.pack.cardPaymentSurface(updatedPaymentArtifact, paymentSurfaceId),
          },
          {
            surfaceId: bookingSurfaceId,
            a2uiMessages: turn.pack.bookingContractSurface(contractArtifact, bookingSurfaceId),
          },
        ],
      };
    } catch {
      // If contract/payment presentation fails, payment/contract truth is retained
      return {
        ok: true,
        message: `Payment complete. Your booking is confirmed under contract reference ${contractId}.`,
        surfaces: [],
      };
    }
  },
};

/**
 * The shortlet handlers, in the order the runtime calls them. A claim by an earlier projection handler ends the search. The
 * confirm handlers are found by their `confirms` kind, after the runtime's authority checks.
 */
export const SHORTLET_STAGE_HANDLERS: readonly AssistantStageHandler[] = [
  discoveryHandler,
  unitHandler,
  requestDraftHandler,
  requestToBookHandler,
  acceptOfferHandler,
  startCheckoutHandler,
];
