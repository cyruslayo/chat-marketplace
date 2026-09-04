import type { A2UIServerMessage } from "@weaver/core";
import {
  discoveryArtifactToA2UI,
  bookingRequestArtifactToA2UI,
  conditionalOfferArtifactToA2UI,
  cardPaymentArtifactToA2UI,
  bookingContractArtifactToA2UI,
  unitDetailToA2UI,
} from "../../../web-agent/src/index.js";
import type { CommandPrincipal } from "../../../../packages/platform-core/src/index.js";
import {
  StayDateRange,
  toDiscoveryProjection,
  isEligibleUnit,
  allInStayTotalKobo,
} from "../../../../domains/shortlet/src/index.js";
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

export type AssistantDiagnosticStage =
  | "provider_request"
  | "provider_response"
  | "tool_execution"
  | "function_result_round_trip";

export interface AssistantDiagnosticEvent {
  readonly stage: AssistantDiagnosticStage;
  readonly round: number;
  readonly succeeded: boolean;
  readonly toolName?: string;
  readonly resultCount?: number;
  readonly errorClass?: string;
  readonly providerStatusCode?: number;
  readonly providerErrorCode?: string;
}

export interface AssistantRuntimeOptions {
  readonly onDiagnostic?: (event: AssistantDiagnosticEvent) => void;
}

interface AssistantEventContext {
  readonly actionId?: unknown;
  readonly threadId?: unknown;
  readonly surfaceId?: unknown;
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
  readonly #onDiagnostic?: (event: AssistantDiagnosticEvent) => void;
  readonly #threads = new Map<string, AssistantThreadState>();

  constructor(environment: LocalGuestEnvironment, modelClient: AssistantModelClient, options: AssistantRuntimeOptions = {}) {
    this.#environment = environment;
    this.#modelClient = modelClient;
    this.#onDiagnostic = options.onDiagnostic;
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
        guestActorId: this.#environment.config.guestId,
        tenantId: this.#environment.config.tenantId,
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
    let activeStage: AssistantDiagnosticStage = "provider_request";
    let activeToolName: string | undefined;

    try {
      while (round < MAX_ASSISTANT_TOOL_ROUNDS) {
        round++;

        const isFunctionResultContinuation = round > 1 && candidateHistory.at(-1)?.role === "tool_results";
        activeStage = isFunctionResultContinuation ? "function_result_round_trip" : "provider_request";
        const modelResponse = await this.#modelClient.generate({
          systemInstruction: ASSISTANT_SYSTEM_INSTRUCTION,
          tools: ASSISTANT_TOOL_DEFINITIONS,
          history: candidateHistory,
          timeoutMs: 20_000,
        });
        this.#diagnose({ stage: "provider_request", round, succeeded: true });
        if (isFunctionResultContinuation) {
          this.#diagnose({ stage: "function_result_round_trip", round, succeeded: true });
        }
        activeStage = "provider_response";
        this.#diagnose({ stage: activeStage, round, succeeded: true });

        // If model produced no tool calls, it is returning a natural language reply
        if (!modelResponse.toolCalls || modelResponse.toolCalls.length === 0) {
          finalAssistantReply = modelResponse.text?.trim() ?? "How can I assist you with your stay?";
          candidateHistory.push({
            role: "assistant",
            text: finalAssistantReply,
            rawStep: modelResponse.rawStep,
          });
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
          activeStage = "tool_execution";
          activeToolName = call.name;
          const toolContext: AssistantToolContext = {
            environment: this.#environment,
            taskState: candidateTaskState,
            threadId,
            userTextHistory,
            now: this.#environment.clock(),
            demoCheckIn: this.#environment.config.demoCheckIn,
          };

          const execution = executeAssistantTool(call.name, call.args, toolContext);
          const resultCount = getSafeResultCount(execution.result);
          this.#diagnose({
            stage: "tool_execution",
            round,
            toolName: call.name,
            succeeded: true,
            ...(resultCount !== undefined ? { resultCount } : {}),
          });
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

            if (!execution.discoveryArtifact) {
              throw new Error("Authoritative discovery did not return an artifact");
            }
            candidateDiscoveryArtifactId = execution.discoveryArtifact.id;
            candidateActiveSurfaces.set(DISCOVERY_STAGE, surfaceId);
            candidateSurfaces.push({
              surfaceId,
              a2uiMessages: discoveryArtifactToA2UI({ artifact: execution.discoveryArtifact, surfaceId }),
            });
          } else if (call.name === "get_unit_details") {
            const stayRef = String(call.args.stayRef ?? "").trim();
            const stay = candidateTaskState.shortlist.find((s) => s.stayRef === stayRef);
            if (stay) {
              const surfaceId = `thread-${threadId}:unit:detail`;
              supersede(DISCOVERY_STAGE);
              supersede(UNIT_STAGE);
              candidateActiveSurfaces.set(UNIT_STAGE, surfaceId);

              const unit = this.#environment.unitRepository.findById(stay.unitId);
              if (!unit) throw new Error("The selected Unit no longer exists");
              const checkIn = candidateTaskState.stayIntent.checkIn ?? this.#environment.config.demoCheckIn;
              const checkOut = candidateTaskState.stayIntent.checkOut ?? this.#environment.config.demoCheckOut;
              if (!checkOut) throw new Error("The selected stay has no checkout date");
              const unitProjection = toDiscoveryProjection(
                unit,
                new StayDateRange(checkIn, checkOut, this.#environment.clock()),
              );

              const a2uiMessages = unitDetailToA2UI({
                unit: unitProjection,
                checkIn,
                checkOut,
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
        activeStage = "function_result_round_trip";
        activeToolName = undefined;
      }

      if (!finalAssistantReply) {
        // Run one final step to get summary reply if bounded rounds reached
        round++;
        activeStage = "function_result_round_trip";
        const finalModelResponse = await this.#modelClient.generate({
          systemInstruction: ASSISTANT_SYSTEM_INSTRUCTION,
          tools: [],
          history: candidateHistory,
        });
        this.#diagnose({ stage: "provider_request", round, succeeded: true });
        this.#diagnose({ stage: "function_result_round_trip", round, succeeded: true });
        activeStage = "provider_response";
        this.#diagnose({ stage: activeStage, round, succeeded: true });
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
      this.#diagnose(createFailureDiagnostic(activeStage, round, activeToolName, error));
      // Rollback: thread is not mutated on error
      return {
        ok: false,
        code: "CONCIERGE_UNAVAILABLE",
        message: "The concierge is temporarily unavailable. Please try again.",
      };
    }
  }

  #diagnose(event: AssistantDiagnosticEvent): void {
    try {
      this.#onDiagnostic?.(event);
    } catch {
      // Diagnostics are observational and must never affect the authoritative flow.
    }
  }

  handleAssistantEvent(threadId: string, eventName: string, context: AssistantEventContext | null | undefined): AssistantTurnOutput {
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

    if (eventName === ASSISTANT_CONFIRM_ACTION_EVENT || eventName === ASSISTANT_CANCEL_ACTION_EVENT) {
      // ADR-0074: only the current authoritative surface retains action authority.
      const activeSurfaceId = candidateActiveSurfaces.get(PENDING_ACTION_STAGE);
      if (!activeSurfaceId || context?.surfaceId !== activeSurfaceId) {
        return { ok: false, code: "STALE_SURFACE", message: "That action is no longer active." };
      }
    }

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
    // ADR-0070/ADR-0074/ADR-0075: interaction authority is scoped and expires fail closed.
    const thread = this.#threads.get(threadId);
    const expiresAt = Date.parse(action.expiresAt);
    if (action.threadId !== threadId
      || !thread
      || action.guestActorId !== thread.guestActorId
      || action.tenantId !== thread.tenantId
      || !Number.isFinite(expiresAt)
      || expiresAt <= this.#environment.clock().getTime()) {
      return { ok: false, code: "STALE_SURFACE", message: "This action has expired or is no longer authorized." };
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

        // Pre-execution revalidation: re-read current Unit/discovery truth for the same Unit, dates, and party size
        const currentUnit = environment.unitRepository.findById(refs.unitId);
        if (!currentUnit) {
          context.candidateTaskState.pendingAction = null;
          return { ok: false, code: "STALE_SURFACE", message: "The requested accommodation is no longer available. Please explore current stays." };
        }

        let dateRange: StayDateRange;
        try {
          dateRange = new StayDateRange(refs.checkIn, refs.checkOut, environment.clock());
        } catch {
          context.candidateTaskState.pendingAction = null;
          return { ok: false, code: "STALE_SURFACE", message: "The stay dates are no longer valid. Please select current dates." };
        }

        const partySize = refs.partySize ?? 1;
        const eligible = isEligibleUnit(currentUnit, environment.clock(), dateRange);
        const capacityOk = currentUnit.capacity >= partySize;
        const notBlocked = !currentUnit.blockedDates?.some((range: any) => dateRange.overlaps(range));

        if (!eligible || !capacityOk || !notBlocked) {
          context.candidateTaskState.pendingAction = null;
          return { ok: false, code: "STALE_SURFACE", message: "This stay is no longer available for your dates and party size. Please choose another stay." };
        }

        // Verify displayed pricing is still consistent
        const currentStayTotal = allInStayTotalKobo(currentUnit, dateRange);
        if (refs.stayTotalKobo !== undefined && currentStayTotal !== null && refs.stayTotalKobo !== currentStayTotal) {
          context.candidateTaskState.pendingAction = null;
          return { ok: false, code: "STALE_SURFACE", message: "Pricing for this stay has changed. Please review the updated quote." };
        }
        if (refs.refundableDepositKobo !== undefined && currentUnit.price?.refundableSecurityDepositKobo !== refs.refundableDepositKobo) {
          context.candidateTaskState.pendingAction = null;
          return { ok: false, code: "STALE_SURFACE", message: "The security deposit requirement has changed. Please review the updated quote." };
        }

        const draft = environment.bookingRequestApp.createDraft(
          {
            unitId: refs.unitId,
            primaryGuest: { id: environment.config.guestId, name: environment.config.guestName },
            occupants: environment.demoOccupants(partySize),
            selfBookingAttestation: environment.selfBookingAttestation(),
            checkIn: refs.checkIn,
            checkOut: refs.checkOut,
          },
          guest,
        );

        const disclosed = environment.bookingRequestApp.disclose(draft.draftId, guest);

        // POST-AUTHORITATIVE-COMMIT RECONCILIATION:
        // Booking request has committed. Record it authoritatively in working state.
        context.candidateTaskState.currentBookingRequestId = disclosed.requestId;
        context.candidateTaskState.goal = "book_stay";
        context.candidateTaskState.pendingAction = null;

        const requestSurfaceId = `thread-${threadId}:request:${disclosed.requestId}`;
        context.supersede(UNIT_STAGE);
        context.candidateActiveSurfaces.set(REQUEST_STAGE, requestSurfaceId);

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

        // Attempt local operator simulation
        try {
          const { offerId } = environment.simulateOperatorAcceptance(disclosed.requestId);
          context.candidateTaskState.currentOfferId = offerId;
          const offerSurfaceId = `thread-${threadId}:offer:${offerId}`;
          context.candidateActiveSurfaces.set(OFFER_STAGE, offerSurfaceId);

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
                a2uiMessages: bookingRequestArtifactToA2UI({ artifact: requestArtifact, surfaceId: requestSurfaceId }),
              },
            ],
          };
        }
      }

      case "accept_offer": {
        const refs = action.authoritativeReferences;
        const offerId = refs.offerId;
        if (!offerId) {
          return { ok: false, code: "INVALID_ARTIFACT", message: "No offer reference found." };
        }

        const offerArtifact = this.#environment.conditionalOfferApp.getArtifact(offerId, this.#environment.guestPrincipal());
        if (refs.offerStatus !== offerArtifact.facts.status
          || refs.offerVersion !== offerArtifact.facts.offerVersion
          || refs.projectionVersion !== offerArtifact.projectionVersion
          || refs.stayTotalKobo !== offerArtifact.facts.allInStayTotalKobo
          || refs.refundableDepositKobo !== offerArtifact.facts.refundableSecurityDepositKobo
          || refs.totalDueNowKobo !== offerArtifact.facts.totalAmountDueNowKobo) {
          context.candidateTaskState.pendingAction = null;
          return { ok: false, code: "STALE_SURFACE", message: "The offer changed. Review the current offer before accepting." };
        }
        const acceptAction = offerArtifact.actions.find((a) => a.type === "accept");
        if (!acceptAction) {
          context.candidateTaskState.pendingAction = null;
          return { ok: false, code: "ACTION_NOT_AUTHORIZED", message: "Offer cannot be accepted in current state." };
        }

        // Accept offer through authoritative application command
        this.#environment.conditionalOfferApp.accept({
          offerId,
          confirmationToken: acceptAction.confirmationToken,
          expectedVersion: acceptAction.offerVersion,
          principal: this.#environment.guestPrincipal(),
        });

        // POST-AUTHORITATIVE-COMMIT RECONCILIATION:
        // Offer acceptance committed. Pending action consumed, cannot replay.
        context.candidateTaskState.pendingAction = null;

        const paymentSurfaceId = `thread-${threadId}:payment:${offerId}`;
        context.supersede(OFFER_STAGE);
        context.candidateActiveSurfaces.set(PAYMENT_STAGE, paymentSurfaceId);

        try {
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
        } catch {
          // If payment presentation fails, retain accepted state authoritatively
          return {
            ok: true,
            message: "Offer accepted successfully. Proceed to payment checkout.",
            surfaces: [],
          };
        }
      }

      case "start_checkout": {
        const refs = action.authoritativeReferences;
        const offerId = refs.offerId;
        if (!offerId) {
          return { ok: false, code: "INVALID_ARTIFACT", message: "No payment reference found." };
        }

        // Revalidate start_checkout against current authoritative card-payment artifact
        let paymentArtifact;
        try {
          paymentArtifact = this.#environment.cardPaymentApp.getArtifact(offerId, this.#environment.guestPrincipal());
        } catch {
          context.candidateTaskState.pendingAction = null;
          return { ok: false, code: "STALE_SURFACE", message: "Payment checkout is no longer available for this offer." };
        }

        if (refs.offerId !== offerId
          || (refs.projectionVersion !== undefined && refs.projectionVersion !== paymentArtifact.projectionVersion)
          || (refs.stayTotalKobo !== undefined && refs.stayTotalKobo !== paymentArtifact.facts.allInStayTotalKobo)
          || (refs.refundableDepositKobo !== undefined && refs.refundableDepositKobo !== paymentArtifact.facts.refundableSecurityDepositKobo)
          || (refs.totalDueNowKobo !== undefined && refs.totalDueNowKobo !== paymentArtifact.facts.amountDueNowKobo)) {
          context.candidateTaskState.pendingAction = null;
          return { ok: false, code: "STALE_SURFACE", message: "Payment details or amounts have changed. Please review the updated checkout." };
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

        // Authoritatively commit to contract repository
        this.#environment.contractRepository.recordConfirmedOutcome(outcome.reservation, outcome.bookingContract);

        // POST-AUTHORITATIVE-COMMIT RECONCILIATION:
        // Payment committed. Reservation and contract recorded. Action consumed, cannot replay.
        const contractId = outcome.bookingContract.contractId;
        context.candidateTaskState.currentReservationId = outcome.reservation.reservationId;
        context.candidateTaskState.currentContractId = contractId;
        context.candidateTaskState.pendingAction = null;

        const paymentSurfaceId = `thread-${threadId}:payment:confirmed:${offerId}`;
        const bookingSurfaceId = `thread-${threadId}:booking:${contractId}`;
        context.supersede(PAYMENT_STAGE);
        context.candidateActiveSurfaces.set(BOOKING_STAGE, bookingSurfaceId);

        try {
          const updatedPaymentArtifact = this.#environment.cardPaymentApp.getArtifact(offerId, this.#environment.guestPrincipal());
          const contractArtifact = this.#environment.contractApp.getArtifact(contractId, this.#environment.guestPrincipal());

          return {
            ok: true,
            message: "Payment complete. Your booking is confirmed.",
            surfaces: [
              {
                surfaceId: paymentSurfaceId,
                a2uiMessages: cardPaymentArtifactToA2UI({ artifact: updatedPaymentArtifact, surfaceId: paymentSurfaceId }),
              },
              {
                surfaceId: bookingSurfaceId,
                a2uiMessages: bookingContractArtifactToA2UI({ artifact: contractArtifact, surfaceId: bookingSurfaceId }),
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
      }

      default:
        return { ok: false, code: "UNSUPPORTED_ACTION", message: "Unsupported action." };
    }
  }
}

function getSafeResultCount(result: unknown): number | undefined {
  if (typeof result !== "object" || result === null || !("resultCount" in result)) return undefined;
  const count = result.resultCount;
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? count : undefined;
}

function createFailureDiagnostic(
  stage: AssistantDiagnosticStage,
  round: number,
  toolName: string | undefined,
  error: unknown,
): AssistantDiagnosticEvent {
  const record = typeof error === "object" && error !== null ? error as Record<string, unknown> : undefined;
  const statusCandidate = record?.status ?? record?.statusCode;
  const codeCandidate = record?.code;
  const safeStatus = typeof statusCandidate === "number"
    && Number.isSafeInteger(statusCandidate)
    && statusCandidate >= 100
    && statusCandidate <= 599
    ? statusCandidate
    : undefined;
  const safeCode = typeof codeCandidate === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(codeCandidate)
    ? codeCandidate
    : undefined;
  return {
    stage,
    round,
    succeeded: false,
    ...(toolName ? { toolName } : {}),
    errorClass: error instanceof Error ? error.constructor.name : typeof error,
    ...(safeStatus !== undefined ? { providerStatusCode: safeStatus } : {}),
    ...(safeCode !== undefined ? { providerErrorCode: safeCode } : {}),
  };
}
