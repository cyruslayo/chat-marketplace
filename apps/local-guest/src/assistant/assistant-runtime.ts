import type { A2UIServerMessage } from "@weaver/core";
import {
  discoveryArtifactToA2UI,
  createWeaverWebAgentAdapter,
  bookingRequestArtifactToA2UI,
  conditionalOfferArtifactToA2UI,
  cardPaymentArtifactToA2UI,
  bookingContractArtifactToA2UI,
  unitDetailToA2UI,
} from "../../../web-agent/src/index.js";
import type { CommandPrincipal } from "../../../../packages/platform-core/src/index.js";
import type { LocalGuestEnvironment } from "../fixture.js";
import type {
  AssistantConversationStep,
  AssistantModelClient,
  AssistantToolCall,
  AssistantToolResult,
} from "./assistant-model.js";
import {
  ASSISTANT_SYSTEM_INSTRUCTION,
  ASSISTANT_TOOL_DEFINITIONS,
  executeAssistantTool,
  MAX_ASSISTANT_TOOL_ROUNDS,
  type AssistantToolContext,
} from "./assistant-tools.js";
import {
  cloneTaskState,
  createInitialTaskState,
  type AssistantTaskState,
  type AssistantThreadState,
} from "./assistant-state.js";
import {
  isExplicitConfirmation,
  isExplicitCancellation,
  type PendingAssistantAction,
} from "./pending-actions.js";
import {
  pendingActionToA2UI,
  ASSISTANT_CONFIRM_ACTION_EVENT,
  ASSISTANT_CANCEL_ACTION_EVENT,
} from "./pending-action-a2ui.js";

export interface AssistantTurnOutput {
  readonly ok: boolean;
  readonly code?: string;
  readonly message?: string;
  readonly messages?: readonly string[];
  readonly surfaces?: readonly { readonly surfaceId: string; readonly a2uiMessages: readonly unknown[] }[];
}

const DISCOVERY_STAGE = "discovery";
const UNIT_STAGE = "unit";
const PENDING_ACTION_STAGE = "pending_action";
const REQUEST_STAGE = "request";
const OFFER_STAGE = "offer";
const PAYMENT_STAGE = "payment";
const BOOKING_STAGE = "booking";

export class AssistantRuntime {
  readonly #environment: LocalGuestEnvironment;
  readonly #modelClient: AssistantModelClient;
  readonly #threads = new Map<string, AssistantThreadState>();

  constructor(environment: LocalGuestEnvironment, modelClient: AssistantModelClient) {
    this.#environment = environment;
    this.#modelClient = modelClient;
  }

  get environment(): LocalGuestEnvironment {
    return this.#environment;
  }

  reset(): void {
    this.#threads.clear();
  }

  getThread(threadId: string): AssistantThreadState {
    let thread = this.#threads.get(threadId);
    if (!thread) {
      thread = {
        threadId,
        conversationHistory: [],
        taskState: createInitialTaskState(),
        activeSurfaces: new Map(),
        supersededSurfaces: new Set(),
        discoveryArtifactId: null,
      };
      this.#threads.set(threadId, thread);
    }
    return thread;
  }

  async handleTurn(threadId: string, text: string): Promise<AssistantTurnOutput> {
    const thread = this.getThread(threadId);

    // 1. Transactional Candidates (Item 24)
    // Work on clones so provider/tool failures don't leave partial state
    const candidateTaskState = cloneTaskState(thread.taskState);
    const candidateHistory: AssistantConversationStep[] = [...thread.conversationHistory];
    const candidateSurfaces: { surfaceId: string; a2uiMessages: readonly unknown[] }[] = [];
    const candidateActiveSurfaces = new Map<string, string>(thread.activeSurfaces);
    const candidateSuperseded = new Set<string>(thread.supersededSurfaces);
    let candidateDiscoveryArtifactId = thread.discoveryArtifactId;

    const supersede = (stage: string) => {
      const surfaceId = candidateActiveSurfaces.get(stage);
      if (surfaceId) {
        candidateSuperseded.add(surfaceId);
        candidateActiveSurfaces.delete(stage);
      }
    };

    // 2. Check for Pending Action Confirmation in Natural Language (Item 13, 15)
    if (candidateTaskState.pendingAction && !candidateTaskState.pendingAction.executed) {
      if (isExplicitConfirmation(text)) {
        const execution = this.#executePendingAction(threadId, candidateTaskState.pendingAction, {
          candidateTaskState,
          candidateActiveSurfaces,
          candidateSuperseded,
          supersede,
        });

        if (!execution.ok) {
          return { ok: false, code: execution.code, message: execution.message };
        }

        // Action completed: commit state transaction
        thread.taskState = candidateTaskState;
        thread.conversationHistory.push({ role: "user", text });
        thread.conversationHistory.push({ role: "assistant", text: execution.message });
        thread.activeSurfaces = candidateActiveSurfaces;
        thread.supersededSurfaces = candidateSuperseded;

        return {
          ok: true,
          messages: [execution.message],
          surfaces: execution.surfaces,
        };
      }

      if (isExplicitCancellation(text)) {
        const action = candidateTaskState.pendingAction;
        candidateTaskState.pendingAction = null;
        supersede(PENDING_ACTION_STAGE);

        // Commit cancellation
        thread.taskState = candidateTaskState;
        thread.conversationHistory.push({ role: "user", text });
        thread.conversationHistory.push({ role: "assistant", text: "Action cancelled. Let me know how else I can help." });
        thread.activeSurfaces = candidateActiveSurfaces;
        thread.supersededSurfaces = candidateSuperseded;

        return {
          ok: true,
          messages: ["Action cancelled. Let me know how else I can help."],
          surfaces: [],
        };
      }
    }

    // 3. User message turn
    candidateHistory.push({ role: "user", text });

    const userTextHistory: string[] = candidateHistory
      .filter((s): s is Extract<AssistantConversationStep, { role: "user" }> => s.role === "user")
      .map((s) => s.text);

    let round = 0;
    let finalAssistantReply: string | undefined;

    try {
      while (round < MAX_ASSISTANT_TOOL_ROUNDS) {
        round++;

        const modelResponse = await this.#modelClient.generate({
          systemInstruction: ASSISTANT_SYSTEM_INSTRUCTION,
          tools: ASSISTANT_TOOL_DEFINITIONS,
          history: candidateHistory,
          timeoutMs: 20_000,
        });

        // If model produced no tool calls, it is returning a natural language reply
        if (!modelResponse.toolCalls || modelResponse.toolCalls.length === 0) {
          finalAssistantReply = modelResponse.text?.trim() ?? "How can I assist you with your stay?";
          candidateHistory.push({ role: "assistant", text: finalAssistantReply });
          break;
        }

        // Record tool calls into history
        candidateHistory.push({
          role: "tool_calls",
          calls: modelResponse.toolCalls,
          rawStep: modelResponse.rawStep,
        });

        const toolResults: AssistantToolResult[] = [];

        for (const call of modelResponse.toolCalls) {
          const toolContext: AssistantToolContext = {
            environment: this.#environment,
            taskState: candidateTaskState,
            threadId,
            userTextHistory,
            now: this.#environment.clock(),
            demoCheckIn: this.#environment.config.demoCheckIn,
          };

          const execution = executeAssistantTool(call.name, call.args, toolContext);
          toolResults.push({
            callId: call.id,
            name: call.name,
            result: execution.result,
          });

          // Handle UI generation for tools
          if (call.name === "search_stays") {
            const surfaceId = `thread-${threadId}:discovery:results`;
            // Supersede any previous search or details
            supersede(DISCOVERY_STAGE);
            supersede(UNIT_STAGE);

            const adapter = createWeaverWebAgentAdapter({
              query: this.#environment.discoveryQuery,
              createSurfaceId: () => surfaceId,
            });

            const searchFilters = {
              location: candidateTaskState.stayIntent.location ?? "Lagos",
              ...(candidateTaskState.stayIntent.neighbourhood ? { neighbourhood: candidateTaskState.stayIntent.neighbourhood } : {}),
              checkIn: candidateTaskState.stayIntent.checkIn,
              checkOut: candidateTaskState.stayIntent.checkOut,
              partySize: candidateTaskState.stayIntent.partySize,
            };

            const result = adapter.search(searchFilters);
            candidateDiscoveryArtifactId = result.artifact.id;
            candidateActiveSurfaces.set(DISCOVERY_STAGE, surfaceId);
            candidateSurfaces.push({ surfaceId, a2uiMessages: result.a2uiMessages });
          } else if (call.name === "get_unit_details") {
            const stayRef = String(call.args.stayRef ?? "").trim();
            const stay = candidateTaskState.shortlist.find((s) => s.stayRef === stayRef);
            if (stay) {
              const surfaceId = `thread-${threadId}:unit:detail`;
              supersede(DISCOVERY_STAGE);
              supersede(UNIT_STAGE);
              candidateActiveSurfaces.set(UNIT_STAGE, surfaceId);

              // Map stay to DiscoveryUnitProjection format
              const unitProjection: any = {
                id: stay.unitId,
                title: stay.title,
                location: { city: stay.city, neighbourhood: stay.neighbourhood },
                capacity: stay.capacity,
                amenities: stay.amenities,
                price: {
                  nightlyKobo: stay.nightlyKobo,
                  allInStayTotalKobo: stay.allInStayTotalKobo,
                  mandatoryFeesKobo: stay.mandatoryFeesKobo,
                  refundableSecurityDepositKobo: stay.refundableSecurityDepositKobo,
                  amountDueNowKobo: stay.amountDueNowKobo,
                  currency: "NGN",
                  pricingVersion: "price-v1",
                },
                trust: {
                  inspection: {
                    status: stay.inspectionStatus,
                    inspectedAt: "2026-01-15T00:00:00Z",
                    expiresAt: "2027-01-15T00:00:00Z",
                    scope: [],
                  },
                  managementAuthority: {
                    status: stay.managementAuthorityStatus,
                    verifiedAt: "2026-01-15T00:00:00Z",
                  },
                  occupancyModel: "entire-place",
                },
              };

              const a2uiMessages = unitDetailToA2UI({
                unit: unitProjection,
                checkIn: candidateTaskState.stayIntent.checkIn ?? this.#environment.config.demoCheckIn,
                checkOut: candidateTaskState.stayIntent.checkOut ?? "2026-09-13",
                surfaceId,
                action: {
                  artifactId: candidateDiscoveryArtifactId ?? "search-guest-demo-001",
                  unitId: stay.unitId,
                  projectionVersion: 1,
                },
              });

              candidateSurfaces.push({ surfaceId, a2uiMessages });
            }
          } else if (execution.pendingActionCreated) {
            // Consequential action proposed -> create confirmation card surface
            const action = execution.pendingActionCreated;
            const surfaceId = `thread-${threadId}:pending-action:${action.id}`;
            supersede(PENDING_ACTION_STAGE);
            candidateActiveSurfaces.set(PENDING_ACTION_STAGE, surfaceId);

            const a2uiMessages = pendingActionToA2UI({
              action,
              surfaceId,
            });
            candidateSurfaces.push({ surfaceId, a2uiMessages });
          }
        }

        candidateHistory.push({
          role: "tool_results",
          results: toolResults,
        });
      }

      if (!finalAssistantReply) {
        // Run one final step to get summary reply if bounded rounds reached
        const finalModelResponse = await this.#modelClient.generate({
          systemInstruction: ASSISTANT_SYSTEM_INSTRUCTION,
          tools: [],
          history: candidateHistory,
        });
        finalAssistantReply = finalModelResponse.text?.trim() ?? "I processed your request.";
        candidateHistory.push({ role: "assistant", text: finalAssistantReply });
      }

      // 4. Commit Transaction (Item 24)
      thread.taskState = candidateTaskState;
      thread.conversationHistory.length = 0;
      thread.conversationHistory.push(...candidateHistory);
      thread.activeSurfaces = candidateActiveSurfaces;
      thread.supersededSurfaces = candidateSuperseded;
      thread.discoveryArtifactId = candidateDiscoveryArtifactId;

      return {
        ok: true,
        messages: [finalAssistantReply],
        surfaces: candidateSurfaces,
      };
    } catch (error) {
      // Rollback: thread is not mutated on error
      return {
        ok: false,
        code: "CONCIERGE_UNAVAILABLE",
        message: "The concierge is temporarily unavailable. Please try again.",
      };
    }
  }

  handleAssistantEvent(threadId: string, eventName: string, context: any): AssistantTurnOutput {
    const thread = this.getThread(threadId);
    const candidateTaskState = cloneTaskState(thread.taskState);
    const candidateActiveSurfaces = new Map<string, string>(thread.activeSurfaces);
    const candidateSuperseded = new Set<string>(thread.supersededSurfaces);

    const supersede = (stage: string) => {
      const surfaceId = candidateActiveSurfaces.get(stage);
      if (surfaceId) {
        candidateSuperseded.add(surfaceId);
        candidateActiveSurfaces.delete(stage);
      }
    };

    if (eventName === ASSISTANT_CANCEL_ACTION_EVENT) {
      if (!candidateTaskState.pendingAction || candidateTaskState.pendingAction.id !== context?.actionId) {
        return { ok: false, code: "STALE_SURFACE", message: "That action is no longer active." };
      }
      candidateTaskState.pendingAction = null;
      supersede(PENDING_ACTION_STAGE);

      thread.taskState = candidateTaskState;
      thread.activeSurfaces = candidateActiveSurfaces;
      thread.supersededSurfaces = candidateSuperseded;

      return {
        ok: true,
        messages: ["Action cancelled."],
        surfaces: [],
      };
    }

    if (eventName === ASSISTANT_CONFIRM_ACTION_EVENT) {
      const action = candidateTaskState.pendingAction;
      if (!action || action.id !== context?.actionId || action.executed) {
        return { ok: false, code: "STALE_SURFACE", message: "That action is no longer active." };
      }

      const execution = this.#executePendingAction(threadId, action, {
        candidateTaskState,
        candidateActiveSurfaces,
        candidateSuperseded,
        supersede,
      });

      if (!execution.ok) {
        return { ok: false, code: execution.code, message: execution.message };
      }

      thread.taskState = candidateTaskState;
      thread.activeSurfaces = candidateActiveSurfaces;
      thread.supersededSurfaces = candidateSuperseded;

      return {
        ok: true,
        messages: [execution.message],
        surfaces: execution.surfaces,
      };
    }

    return { ok: false, code: "UNSUPPORTED_EVENT", message: "Unknown assistant action." };
  }

  #executePendingAction(
    threadId: string,
    action: PendingAssistantAction,
    context: {
      candidateTaskState: AssistantTaskState;
      candidateActiveSurfaces: Map<string, string>;
      candidateSuperseded: Set<string>;
      supersede: (stage: string) => void;
    },
  ): { ok: true; message: string; surfaces: { surfaceId: string; a2uiMessages: readonly unknown[] }[] } | { ok: false; code: string; message: string } {
    if (action.executed) {
      return { ok: false, code: "STALE_SURFACE", message: "This action was already executed." };
    }

    context.supersede(PENDING_ACTION_STAGE);

    switch (action.type) {
      case "request_to_book": {
        const refs = action.authoritativeReferences;
        if (!refs.unitId || !refs.checkIn || !refs.checkOut) {
          return { ok: false, code: "INVALID_CONTEXT", message: "Incomplete booking details." };
        }

        const environment = this.#environment;
        const guest: CommandPrincipal = environment.guestPrincipal();

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

        const disclosed = environment.bookingRequestApp.disclose(draft.draftId, guest);
        context.candidateTaskState.currentBookingRequestId = disclosed.requestId;

        // Local operator simulation via authorized representative (ADR-0082)
        const { offerId } = environment.simulateOperatorAcceptance(disclosed.requestId);
        context.candidateTaskState.currentOfferId = offerId;
        context.candidateTaskState.goal = "book_stay";
        context.candidateTaskState.pendingAction = null;

        const requestSurfaceId = `thread-${threadId}:request:${disclosed.requestId}`;
        const offerSurfaceId = `thread-${threadId}:offer:${offerId}`;
        context.supersede(UNIT_STAGE);
        context.candidateActiveSurfaces.set(REQUEST_STAGE, requestSurfaceId);
        context.candidateActiveSurfaces.set(OFFER_STAGE, offerSurfaceId);

        const requestArtifact = environment.bookingRequestApp.getArtifact(disclosed.requestId, guest);
        const offerArtifact = environment.conditionalOfferApp.getArtifact(offerId, guest);

        return {
          ok: true,
          message: "The host has accepted your request. Here is your booking offer.",
          surfaces: [
            {
              surfaceId: requestSurfaceId,
              a2uiMessages: bookingRequestArtifactToA2UI({ artifact: requestArtifact, surfaceId: requestSurfaceId }),
            },
            {
              surfaceId: offerSurfaceId,
              a2uiMessages: conditionalOfferArtifactToA2UI({ artifact: offerArtifact, surfaceId: offerSurfaceId }),
            },
          ],
        };
      }

      case "accept_offer": {
        const offerId = action.authoritativeReferences.offerId;
        if (!offerId) {
          return { ok: false, code: "INVALID_ARTIFACT", message: "No offer reference found." };
        }

        const offerArtifact = this.#environment.conditionalOfferApp.getArtifact(offerId, this.#environment.guestPrincipal());
        const acceptAction = offerArtifact.actions.find((a) => a.type === "accept");
        if (!acceptAction) {
          return { ok: false, code: "ACTION_NOT_AUTHORIZED", message: "Offer cannot be accepted in current state." };
        }

        // Accept offer through application command
        this.#environment.conditionalOfferApp.accept({
          offerId,
          confirmationToken: acceptAction.confirmationToken,
          expectedVersion: acceptAction.offerVersion,
          principal: this.#environment.guestPrincipal(),
        });

        const paymentSurfaceId = `thread-${threadId}:payment:${offerId}`;
        context.supersede(OFFER_STAGE);
        context.candidateActiveSurfaces.set(PAYMENT_STAGE, paymentSurfaceId);
        context.candidateTaskState.pendingAction = null;

        const paymentArtifact = this.#environment.cardPaymentApp.getArtifact(offerId, this.#environment.guestPrincipal());

        return {
          ok: true,
          message: "Offer accepted. Complete the secure card payment to confirm your booking.",
          surfaces: [
            {
              surfaceId: paymentSurfaceId,
              a2uiMessages: cardPaymentArtifactToA2UI({ artifact: paymentArtifact, surfaceId: paymentSurfaceId }),
            },
          ],
        };
      }

      case "start_checkout": {
        const offerId = action.authoritativeReferences.offerId;
        if (!offerId) {
          return { ok: false, code: "INVALID_ARTIFACT", message: "No payment reference found." };
        }

        let session = this.#environment.cardPaymentApp.manager.getCheckoutSession(offerId);
        if (!session) {
          session = this.#environment.cardPaymentApp.initializeCheckout(offerId, this.#environment.guestPrincipal());
        }

        let outcome = this.#environment.cardPaymentApp.verifyAndConfirm(session.pspReference, this.#environment.systemPrincipal());
        if (outcome.outcome === "deposit_required") {
          session = this.#environment.cardPaymentApp.initializeCheckout(offerId, this.#environment.guestPrincipal());
          outcome = this.#environment.cardPaymentApp.verifyAndConfirm(session.pspReference, this.#environment.systemPrincipal());
        }

        if (outcome.outcome !== "confirmed") {
          return { ok: false, code: "PAYMENT_NOT_CONFIRMED", message: "Payment could not be completed." };
        }

        this.#environment.contractRepository.recordConfirmedOutcome(outcome.reservation, outcome.bookingContract);

        const contractId = outcome.bookingContract.contractId;
        context.candidateTaskState.currentReservationId = outcome.reservation.reservationId;
        context.candidateTaskState.currentContractId = contractId;
        context.candidateTaskState.pendingAction = null;

        const paymentSurfaceId = `thread-${threadId}:payment:confirmed:${offerId}`;
        const bookingSurfaceId = `thread-${threadId}:booking:${contractId}`;
        context.supersede(PAYMENT_STAGE);
        context.candidateActiveSurfaces.set(BOOKING_STAGE, bookingSurfaceId);

        const paymentArtifact = this.#environment.cardPaymentApp.getArtifact(offerId, this.#environment.guestPrincipal());
        const contractArtifact = this.#environment.contractApp.getArtifact(contractId, this.#environment.guestPrincipal());

        return {
          ok: true,
          message: "Payment complete. Your booking is confirmed.",
          surfaces: [
            {
              surfaceId: paymentSurfaceId,
              a2uiMessages: cardPaymentArtifactToA2UI({ artifact: paymentArtifact, surfaceId: paymentSurfaceId }),
            },
            {
              surfaceId: bookingSurfaceId,
              a2uiMessages: bookingContractArtifactToA2UI({ artifact: contractArtifact, surfaceId: bookingSurfaceId }),
            },
          ],
        };
      }

      default:
        return { ok: false, code: "UNSUPPORTED_ACTION", message: "Unsupported action." };
    }
  }
}

