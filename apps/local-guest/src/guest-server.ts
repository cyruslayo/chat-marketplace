import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { A2UI_V091_BASIC_CATALOG_ID, type A2UIComponent, type A2UIServerMessage, type JsonObject } from "@weaver/core";
import type { WebServerEventHandoff } from "@weaver/web";
import type { CommandPrincipal, TransitionTelemetryEvent } from "../../../packages/platform-core/src/index.js";
import {
  discoveryArtifactToA2UI,
  createWeaverWebAgentAdapter,
  bookingRequestArtifactToA2UI,
  conditionalOfferArtifactToA2UI,
  cardPaymentArtifactToA2UI,
  bookingContractArtifactToA2UI,
  unitDetailArtifactToA2UI,
  requestDraftArtifactToA2UI,
  REQUEST_DRAFT_REVIEW_EVENT,
  REQUEST_DRAFT_SUBMIT_EVENT,
  REQUEST_TO_BOOK_EVENT,
  SEE_ALL_DISCOVERY_EVENT,
  formatNgnKobo,
  type DiscoveryArtifactProjection,
} from "../../../apps/web-agent/src/index.js";
import { unitDetailArtifactFromProjection } from "../../../apps/web/src/unit-detail-artifact.js";
import {
  resolveDiscoveryServerEvent,
} from "../../../apps/web/src/discovery-actions.js";
import {
  conventionalBookingContractRoute,
  conventionalBookingRequestRoute,
  conventionalRequestDraftRoute,
  conventionalCardPaymentRoute,
  conventionalConditionalOfferRoute,
  conventionalSearchRoute,
} from "../../../apps/web/src/presentation.js";
import { resolveConditionalOfferServerEvent } from "../../../apps/web/src/conditional-offer-actions.js";
import { CARD_PAYMENT_INITIALIZE_CHECKOUT_EVENT, resolveCardPaymentServerEvent } from "../../../apps/web/src/card-payment-actions.js";
import { createStayQuote, isEligibleUnit, normalizePhotoUrls, type Unit } from "../../../domains/shortlet/src/index.js";
import { requestDraftArtifactFromProjection, requestDraftArtifactId } from "../../../apps/web/src/request-draft-artifact.js";
import type { RequestDraftArtifact } from "../../../apps/web/src/request-draft-artifact.js";
import type { CardPaymentApplication } from "../../../apps/web/src/card-payment-application.js";
import {
  LocalGuestEnvironment,
  LOCAL_GUEST_PORT,
  resetLocalGuestFixture,
} from "./fixture.js";
import {
  parseGuestProjection,
  type GuestPersistentProjection,
} from "./guest-projection.js";
import { hashSessionSecret } from "../../../domains/shortlet/src/index.js";
import { DirectPaystackClient, isApprovedPaystackCheckoutUrl, loadPaystackConfiguration, type PaystackClient } from "../../../domains/shortlet/src/index.js";
import { extractStayRequestFacts, mergeStayRequestContext, resolveStayRequestContext, type DiscoverySearchContext, type StayRequestFilters } from "./concierge.js";
import { handleGeminiTurn, type GeminiConciergeClient } from "./gemini-concierge.js";
import type { Content } from "@google/genai";
import { AssistantRuntime } from "./assistant/assistant-runtime.js";
import { ScriptedAssistantModel } from "./assistant/scripted-assistant-model.js";
import { GeminiInteractionsClient } from "./assistant/gemini-interactions-client.js";
import type { AssistantModelClient } from "./assistant/assistant-model.js";
import {
  ASSISTANT_CONFIRM_ACTION_EVENT,
  ASSISTANT_CANCEL_ACTION_EVENT,
} from "./assistant/pending-action-a2ui.js";

const SHORTLET_FOUNDATION_CSS = readFileSync(new URL("../../web/src/shortlet-foundations.css", import.meta.url), "utf8");

export interface GuestSurfacePayload {
  readonly surfaceId: string;
  readonly a2uiMessages: readonly A2UIServerMessage[];
  readonly mode?: "text" | "inline-surface" | "focused-surface";
  readonly status?: "active" | "superseded" | "stale" | "expired" | "deleted" | "fallback";
  readonly summary?: string;
  readonly textFallback?: string;
  readonly conventionalRoute?: string;
}

export interface GuestTimelineEntry {
  readonly role: "assistant" | "user";
  readonly text: string;
}

export interface GuestStateSnapshot {
  readonly ok: true;
  readonly threadId: string;
  readonly timeline: readonly GuestTimelineEntry[];
  readonly surfaces: readonly GuestSurfacePayload[];
}

export interface GuestTurnSuccess {
  readonly ok: true;
  readonly messages: readonly string[];
  readonly surfaces: readonly GuestSurfacePayload[];
}

export interface GuestRejection {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
}

export type GuestTurnResult = GuestTurnSuccess | GuestRejection;

const DISCOVERY_STAGE = "discovery";
const UNIT_STAGE = "unit";
const REQUEST_STAGE = "request";
const OFFER_STAGE = "offer";
const PAYMENT_STAGE = "payment";
const BOOKING_STAGE = "booking";

function unitDetailSurfaceId(threadId: string, discoveryRevision: number): string {
  // ADR-0074: a newly selected detail is a new surface lifecycle; Weaver rejects duplicate createSurface IDs.
  return `thread-${threadId}:unit:detail:${discoveryRevision}`;
}
const GUEST_PHONE_SUBMIT_EVENT = "shortlet.guest-contact.submit-phone";
const GUEST_EMAIL_SUBMIT_EVENT = "shortlet.guest-contact.submit-email";

const PENDING_ACTION_STAGE = "pending_action";
const SHELL_TELEMETRY_EVENTS = [
  "text-response-rendered", "inline-surface-rendered", "focused-surface-opened", "focused-surface-closed",
  "surface-replaced", "stale-surface-encountered", "expired-surface-encountered", "fallback-rendered",
  "conventional-route-fallback", "weaver-rendering-failure",
] as const;
type ShellTelemetryEvent = typeof SHELL_TELEMETRY_EVENTS[number];

/**
 * Explicit local allow-list of Weaver-generated action events (ADR-0072).
 * Everything else fails closed.
 */
const EVENT_STAGE_ALLOW_LIST: Readonly<Record<string, string>> = Object.freeze({
  "shortlet.discovery.view-unit": DISCOVERY_STAGE,
  [SEE_ALL_DISCOVERY_EVENT]: DISCOVERY_STAGE,
  [REQUEST_TO_BOOK_EVENT]: UNIT_STAGE,
  "shortlet.conditional-offer.accept": OFFER_STAGE,
  "shortlet.card-payment.initialize-checkout": PAYMENT_STAGE,
  "shortlet.card-payment.verify-return": PAYMENT_STAGE,
  [REQUEST_DRAFT_REVIEW_EVENT]: REQUEST_STAGE,
  [REQUEST_DRAFT_SUBMIT_EVENT]: REQUEST_STAGE,
  [GUEST_PHONE_SUBMIT_EVENT]: REQUEST_STAGE,
  [GUEST_EMAIL_SUBMIT_EVENT]: PAYMENT_STAGE,
  [ASSISTANT_CONFIRM_ACTION_EVENT]: PENDING_ACTION_STAGE,
  [ASSISTANT_CANCEL_ACTION_EVENT]: PENDING_ACTION_STAGE,
});

const THREAD_ID_PATTERN = /^g-[a-f0-9-]{6,64}$/;

interface GuestThreadState {
  readonly threadId: string;
  readonly geminiHistory: Content[];
  discoveryContext: DiscoverySearchContext | null;
  discoveryArtifact: DiscoveryArtifactProjection | null;
  discoverySurfaceId: string;
  discoveryRevision: number;
  unitDetail: { readonly unitId: string; readonly artifactId: string } | null;
  requestId: string | null;
  draftId: string | null;
  draftQuote: { readonly allInStayTotalKobo: number; readonly refundableSecurityDepositKobo: number; readonly amountDueNowKobo: number } | null;
  offerId: string | null;
  activeSurfaces: Map<string, string>;
  supersededSurfaces: Set<string>;
  geminiLastSearch: { readonly surfaceId: string; readonly a2uiMessages: readonly A2UIServerMessage[] } | null;
  timeline: GuestTimelineEntry[];
  lastSurfaces: GuestSurfacePayload[];
}

export class LocalGuestApp {
  #environment: LocalGuestEnvironment;
  readonly #threads = new Map<string, GuestThreadState>();
  readonly #geminiClient: GeminiConciergeClient | null;
  readonly #assistantRuntime: AssistantRuntime | null;

  constructor(
    environment: LocalGuestEnvironment,
    options: {
      readonly geminiClient?: GeminiConciergeClient;
      readonly assistantRuntime?: AssistantRuntime;
    } = {},
  ) {
    this.#environment = environment;
    this.#geminiClient = options.geminiClient ?? null;
    this.#assistantRuntime = options.assistantRuntime ?? null;
  }

  get environment(): LocalGuestEnvironment {
    return this.#environment;
  }

  get assistantRuntime(): AssistantRuntime | null {
    return this.#assistantRuntime;
  }

  async handleTurn(threadId: string, text: string): Promise<GuestTurnResult> {
    const result = await this.#handleTurn(threadId, text);
    const decorated = this.#decorateResult(result);
    if (decorated.ok) this.#rememberResult(threadId, text, decorated);
    return decorated;
  }

  async #handleTurn(threadId: string, text: string): Promise<GuestTurnResult> {
    if (!THREAD_ID_PATTERN.test(threadId)) {
      return { ok: false, code: "INVALID_THREAD", message: "Unknown conversation." };
    }

    if (this.#assistantRuntime) {
      const output = await this.#assistantRuntime.handleTurn(threadId, text);
      if (!output.ok) {
        return { ok: false, code: output.code ?? "CONCIERGE_UNAVAILABLE", message: output.message ?? "The assistant is unavailable." };
      }
      return {
        ok: true,
        messages: output.messages ?? (output.message ? [output.message] : []),
        surfaces: (output.surfaces ?? []) as readonly GuestSurfacePayload[],
      };
    }

    const thread = this.#threads.get(threadId) ?? this.#loadThread(threadId) ?? this.#createThread(threadId);
    const refreshed = this.#refreshWorkflow(thread);
    if (refreshed) {
      if (refreshed.ok && refreshed.surfaces.length > 0) this.#rememberResult(threadId, undefined, refreshed);
      return refreshed;
    }
    if (thread.offerId || thread.activeSurfaces.has(PAYMENT_STAGE) || thread.activeSurfaces.has(BOOKING_STAGE)) {
      return { ok: true, messages: ["Your current booking workspace remains active. Complete or return from that workflow to continue."], surfaces: [] };
    }
    if (this.#geminiClient) {
      try {
        const live = await handleGeminiTurn({
          client: this.#geminiClient,
          history: thread.geminiHistory,
          text,
          demoCheckIn: this.#environment.config.demoCheckIn,
          now: this.#environment.clock(),
          search: (filters) => {
            this.#prepareDiscovery(thread);
            const adapter = createWeaverWebAgentAdapter({
              query: { search: (query) => this.#environment.discoveryQuery.search(query) },
              createSurfaceId: () => thread.discoverySurfaceId,
            });
            const result = adapter.search({ ...filters });
            thread.discoveryArtifact = result.artifact;
            thread.activeSurfaces.set(DISCOVERY_STAGE, thread.discoverySurfaceId);
            this.#emitTransition(thread, "unit.discovery.results_produced", { aggregateType: "discovery", aggregateId: result.artifact.id, surfaceId: thread.discoverySurfaceId });
            thread.geminiLastSearch = result;
            return {
              resultCount: result.artifact.facts.results.length,
              location: filters.location,
              ...(filters.neighbourhood ? { neighbourhood: filters.neighbourhood } : {}),
              checkIn: filters.checkIn,
              checkOut: filters.checkOut,
            };
          },
        });
        if (live.kind === "clarify") return { ok: true, messages: [live.reply], surfaces: [] };
        const result = thread.geminiLastSearch;
        if (!result) throw new Error("Gemini search did not produce a discovery surface");
        return {
          ok: true,
          messages: [live.reply],
          surfaces: [{
            surfaceId: result.surfaceId,
            a2uiMessages: result.a2uiMessages,
            mode: "inline-surface",
            summary: discoverySummary(thread.discoveryArtifact?.facts.filters),
            conventionalRoute: conventionalSearchRoute({}),
          }],
        };
      } catch {
        return { ok: false, code: "CONCIERGE_UNAVAILABLE", message: "The concierge is temporarily unavailable. Please try again." };
      }
    }

    const previousContext = thread.discoveryContext;
    const facts = extractStayRequestFacts(text);
    const merged = mergeStayRequestContext(previousContext, facts, text);
    thread.discoveryContext = merged.context;
    if (merged.conflict) {
      // A location conflict is intentionally surfaced. No search runs until the
      // Guest resolves it, and every other accumulated constraint is retained.
      return { ok: true, messages: [merged.conflict.question], surfaces: [] };
    }
    const resolution = resolveStayRequestContext(merged.context, { demoCheckIn: this.#environment.config.demoCheckIn });
    if (resolution.kind === "clarify") {
      return { ok: true, messages: [resolution.reply], surfaces: [] };
    }

    const providedFacts = Object.keys(facts).length > 0;
    const resolvedConflict = previousContext?.pendingLocationChange !== undefined && merged.context.pendingLocationChange === undefined;
    if (!providedFacts && !resolvedConflict && thread.discoveryArtifact) {
      // An unrelated turn must not replace the current authoritative results.
      return { ok: true, messages: ["Your current search results are still active. Tell me how you would like to refine them, for example: “Only show two-bedroom apartments”."], surfaces: [] };
    }

    return this.#executeDiscovery(thread, resolution.filters);
  }

  /**
   * Runs the authoritative discovery query for the accumulated context and
   * publishes its DiscoveryArtifact through the existing A2UI/Weaver surface.
   * The conversational layer never manufactures Units, prices or availability.
   */
  #executeDiscovery(thread: GuestThreadState, filters: StayRequestFilters): GuestTurnResult {
    this.#prepareDiscovery(thread);
    const adapter = createWeaverWebAgentAdapter({
      query: { search: (query) => this.#environment.discoveryQuery.search(query) },
      createSurfaceId: () => thread.discoverySurfaceId,
    });
    const result = adapter.search({ ...filters });
    thread.discoveryArtifact = result.artifact;
    thread.activeSurfaces.set(DISCOVERY_STAGE, thread.discoverySurfaceId);
    this.#emitTransition(thread, "unit.discovery.results_produced", { aggregateType: "discovery", aggregateId: result.artifact.id, surfaceId: thread.discoverySurfaceId });

    return {
      ok: true,
      messages: [
        `I found ${result.artifact.facts.results.length} eligible place${result.artifact.facts.results.length === 1 ? "" : "s"} in ${filters.location} for your stay ${filters.checkIn} to ${filters.checkOut}. You can view the details below.`,
      ],
      surfaces: [{
        surfaceId: result.surfaceId,
        a2uiMessages: result.a2uiMessages,
        mode: "inline-surface",
        summary: discoverySummary({ location: filters.location, neighbourhood: filters.neighbourhood, partySize: filters.partySize }),
        textFallback: result.fallback.message,
        conventionalRoute: result.fallback.conventionalRoute,
      }],
    };
  }

  handleEvent(threadId: string, payload: unknown): GuestTurnResult {
    const result = this.#handleEvent(threadId, payload);
    const decorated = this.#decorateResult(result);
    if (decorated.ok) this.#rememberResult(threadId, undefined, decorated);
    return decorated;
  }

  async handleEventAsync(threadId: string, payload: unknown): Promise<GuestTurnResult> {
    const event = readEventPayload(payload);
    if (this.#environment.config.paystackClient && event?.name === "shortlet.card-payment.initialize-checkout") {
      const result = await this.#handlePaystackCardCheckout(threadId, event);
      const decorated = this.#decorateResult(result);
      if (decorated.ok) this.#rememberResult(threadId, undefined, decorated);
      return decorated;
    }
    return this.handleEvent(threadId, payload);
  }

  async #handlePaystackCardCheckout(threadId: string, event: GuestEventPayload): Promise<GuestTurnResult> {
    if (!this.#environment.config.paystackClient) return { ok: false, code: "PAYSTACK_UNAVAILABLE", message: "Secure card checkout is unavailable." };
    if (!threadId || !THREAD_ID_PATTERN.test(threadId)) return { ok: false, code: "INVALID_THREAD", message: "Unknown conversation." };
    const thread = this.#threads.get(threadId) ?? this.#loadThread(threadId);
    if (!thread) return { ok: false, code: "UNKNOWN_THREAD", message: "Unknown conversation." };
    const activeSurfaceId = thread.activeSurfaces.get(PAYMENT_STAGE);
    if (!activeSurfaceId || activeSurfaceId !== event.surfaceId) return { ok: false, code: "STALE_SURFACE", message: "That action is no longer available; please use the current options." };
    const resolved = resolveCardPaymentServerEvent({ event: this.#handoff(event), application: this.#environment.cardPaymentApp, principal: this.#environment.guestPrincipal() });
    if (!resolved.ok) return resolved;
    try {
      const session = await this.#environment.cardPaymentApp.initializePaystackCheckout(thread.offerId!, this.#environment.guestPrincipal(), this.#environment.config.paystackClient);
      const artifact = this.#environment.cardPaymentApp.getArtifact(thread.offerId!, this.#environment.guestPrincipal());
      const surfaceId = `thread-${thread.threadId}:payment:checkout:${session.checkoutId}`;
      this.#supersede(thread, PAYMENT_STAGE);
      thread.activeSurfaces.set(PAYMENT_STAGE, surfaceId);
      this.#emitTransition(thread, "payment.handoff.opened", { aggregateType: "payment", aggregateId: thread.offerId!, surfaceId });
      this.#emitTransition(thread, "payment.attempt.initialized", { aggregateType: "payment_attempt", aggregateId: session.checkoutId, correlationId: thread.offerId! });
      return { ok: true, messages: ["Secure checkout is ready. Payment credentials stay on the PSP-hosted page; return here for backend verification."], surfaces: [{ surfaceId, mode: "focused-surface", summary: "Payment handoff", conventionalRoute: `/payments/offers/${encodeURIComponent(thread.offerId!)}/continue`, textFallback: `Payment status: ${artifact.facts.status}. Amount Due Now: ${formatNgnKobo(artifact.facts.amountDueNowKobo)}. Payment deadline: ${formatWAT(artifact.facts.paymentWindowExpiresAt)}. Continue at the secure Paystack checkout: ${session.checkoutUrl}`, a2uiMessages: cardPaymentArtifactToA2UI({ artifact, surfaceId }) }] };
    } catch (error) {
      if (/email address is required/i.test(error instanceof Error ? error.message : "")) return this.#contactSurface(thread, "email", event.context ?? {});
      return { ok: false, code: "ACTION_NOT_AUTHORIZED", message: "The secure card checkout could not be started." };
    }
  }

  #handleEvent(threadId: string, payload: unknown): GuestTurnResult {
    const event = readEventPayload(payload);
    if (!event) {
      return { ok: false, code: "INVALID_EVENT", message: "The action could not be processed." };
    }
    if (!THREAD_ID_PATTERN.test(threadId)) {
      return { ok: false, code: "INVALID_THREAD", message: "Unknown conversation." };
    }

    if (this.#assistantRuntime) {
      if (event.name === ASSISTANT_CONFIRM_ACTION_EVENT || event.name === ASSISTANT_CANCEL_ACTION_EVENT) {
        const output = this.#assistantRuntime.handleAssistantEvent(threadId, event.name, event.context);
        if (!output.ok) {
          return { ok: false, code: output.code ?? "UNSUPPORTED_EVENT", message: output.message ?? "The action failed." };
        }
        return {
          ok: true,
          messages: output.messages ?? (output.message ? [output.message] : []),
          surfaces: (output.surfaces ?? []) as readonly GuestSurfacePayload[],
        };
      }
    }

    const thread = this.#threads.get(threadId) ?? this.#loadThread(threadId);
    if (!thread) {
      return { ok: false, code: "UNKNOWN_THREAD", message: "Unknown conversation." };
    }

    const stage = EVENT_STAGE_ALLOW_LIST[event.name];
    if (!stage) {
      return { ok: false, code: "UNSUPPORTED_EVENT", message: "That action is not available." };
    }
    const activeSurfaceId = thread.activeSurfaces.get(stage);
    if (!activeSurfaceId || activeSurfaceId !== event.surfaceId) {
      const duplicate = event.name === "shortlet.card-payment.verify-return" && thread.activeSurfaces.has(BOOKING_STAGE);
      this.#emitTransition(thread, duplicate ? "interaction.duplicate_command_rejected" : "interaction.stale_surface_rejected", {
        aggregateType: duplicate ? "payment" : "interaction_surface",
        aggregateId: duplicate ? thread.offerId ?? thread.threadId : event.surfaceId,
        surfaceId: event.surfaceId,
        reasonCode: duplicate ? "DUPLICATE_COMMAND" : "STALE_SURFACE",
      });
      return {
        ok: false,
        code: "STALE_SURFACE",
        message: "That action is no longer available; please use the current options.",
      };
    }

    switch (event.name) {
      case SEE_ALL_DISCOVERY_EVENT:
        return this.#handleSeeAllDiscovery(thread, event);
      case "shortlet.discovery.view-unit":
        return this.#handleViewUnit(thread, event);
      case REQUEST_TO_BOOK_EVENT:
        return this.#handleRequestToBook(thread, event);
      case "shortlet.conditional-offer.accept":
        return this.#handleOfferAccept(thread, event);
      case "shortlet.card-payment.initialize-checkout":
        return this.#handleCardCheckout(thread, event);
      case "shortlet.card-payment.verify-return":
        return this.#handlePaymentReturn(thread, event);
      case REQUEST_DRAFT_REVIEW_EVENT:
        return this.#handleDraftReview(thread, event);
      case REQUEST_DRAFT_SUBMIT_EVENT:
        return this.#handleDraftSubmit(thread, event);
      case GUEST_PHONE_SUBMIT_EVENT:
        return this.#handlePhoneSubmit(thread, event);
      case GUEST_EMAIL_SUBMIT_EVENT:
        return this.#handleEmailSubmit(thread, event);
      default:
        return { ok: false, code: "UNSUPPORTED_EVENT", message: "That action is not available." };
    }
  }

  reset(): void {
    this.#threads.clear();
    this.#assistantRuntime?.reset();
    const config = this.#environment.config;
    this.#environment.close();
    resetLocalGuestFixture(config.databasePath);
    this.#environment = new LocalGuestEnvironment(config);
  }

  getState(threadId: string): GuestStateSnapshot | undefined {
    const thread = this.#threads.get(threadId) ?? this.#loadThread(threadId);
    if (!thread) return undefined;
    const priorSurfaceId = thread.lastSurfaces.at(-1)?.surfaceId;
    const refreshed = this.#refreshWorkflow(thread);
    const decorated = refreshed ? this.#decorateResult(refreshed) : null;
    if (decorated?.ok && decorated.surfaces.length > 0) {
      thread.lastSurfaces = [...decorated.surfaces];
      this.#rememberResult(threadId, undefined, decorated);
    }
    const normalized = this.#decorateResult({ ok: true, messages: [], surfaces: thread.lastSurfaces });
    if (!normalized.ok) return undefined;
    thread.lastSurfaces = [...normalized.surfaces];
    if (priorSurfaceId !== undefined && thread.lastSurfaces.at(-1)?.surfaceId !== priorSurfaceId) {
      this.#emitTransition(thread, "interaction.cross_tab_recovery_occurred", { aggregateType: "interaction_thread", aggregateId: threadId });
    }
    return {
      ok: true,
      threadId,
      timeline: [...thread.timeline],
      surfaces: [...normalized.surfaces],
    };
  }

  recordShellTelemetry(event: unknown): boolean {
    if (typeof event !== "string" || !(SHELL_TELEMETRY_EVENTS as readonly string[]).includes(event)) return false;
    try { this.#environment.telemetry.track({ type: `interaction.${event as ShellTelemetryEvent}` }); } catch { /* telemetry is non-blocking */ }
    return true;
  }

  #emitTransition(thread: GuestThreadState, type: string, fields: Omit<TransitionTelemetryEvent, "type" | "eventVersion" | "timestamp" | "transitionKey" | "tenantId" | "principalId" | "threadId"> = {}): void {
    const aggregateId = fields.aggregateId ?? fields.correlationId;
    const event: TransitionTelemetryEvent = {
      type, eventVersion: "1", timestamp: this.#environment.clock().toISOString(),
      tenantId: this.#environment.config.tenantId, principalId: this.#environment.guestPrincipal().id,
      threadId: thread.threadId, transitionKey: `${type}:${thread.threadId}:${fields.aggregateType ?? "interaction"}:${aggregateId ?? "none"}`,
      ...(aggregateId === undefined ? {} : { aggregateId }), ...fields,
    };
    try { this.#environment.telemetry.trackTransition(event); } catch { /* telemetry cannot block a Guest action */ }
  }

  #persistThread(thread: GuestThreadState): void {
    const environment = this.#environment;
    const current = thread.lastSurfaces.at(-1);
    const activeStage = this.#stageForSurfaceId(current?.surfaceId ?? "") ?? this.#inferActiveStage(thread);
    environment.interactionStore.saveThread({
      threadId: thread.threadId,
      principalId: environment.guestPrincipal().id,
      tenantId: environment.config.tenantId,
      threadJson: JSON.stringify(this.#projectionFor(thread, activeStage)),
    });
  }

  #projectionFor(thread: GuestThreadState, activeStage: string | null): GuestPersistentProjection {
    const current = thread.lastSurfaces.at(-1);
    return {
      version: 1,
      timeline: thread.timeline.map(({ role, text }) => ({ role, text })),
      discoveryContext: thread.discoveryContext === null ? null : { ...thread.discoveryContext },
      discoveryArtifact: thread.discoveryArtifact,
      discoverySurfaceId: thread.discoverySurfaceId,
      discoveryRevision: thread.discoveryRevision,
      unitDetail: thread.unitDetail ? { unitId: thread.unitDetail.unitId, artifactId: thread.unitDetail.artifactId } : null,
      draftId: thread.draftId,
      draftQuote: thread.draftQuote ? { ...thread.draftQuote } : null,
      requestId: thread.requestId,
      offerId: thread.offerId,
      activeStage,
      activeSurfaceId: current?.surfaceId ?? null,
    };
  }

  #stageForSurfaceId(surfaceId: string): string | null {
    if (surfaceId.includes(":discovery:")) return DISCOVERY_STAGE;
    if (surfaceId.includes(":unit:")) return UNIT_STAGE;
    if (surfaceId.includes(":request:draft:") || surfaceId.includes(":request:review:")) return REQUEST_STAGE;
    if (surfaceId.includes(":request:req-") || surfaceId.includes(":request:")) return REQUEST_STAGE;
    if (surfaceId.includes(":offer:")) return OFFER_STAGE;
    if (surfaceId.includes(":payment:")) return PAYMENT_STAGE;
    if (surfaceId.includes(":booking:")) return BOOKING_STAGE;
    return null;
  }

  #inferActiveStage(thread: GuestThreadState): string | null {
    if (thread.activeSurfaces.has(BOOKING_STAGE)) return BOOKING_STAGE;
    if (thread.activeSurfaces.has(PAYMENT_STAGE)) return PAYMENT_STAGE;
    if (thread.activeSurfaces.has(OFFER_STAGE)) return OFFER_STAGE;
    if (thread.activeSurfaces.has(REQUEST_STAGE)) return REQUEST_STAGE;
    if (thread.activeSurfaces.has(UNIT_STAGE)) return UNIT_STAGE;
    if (thread.activeSurfaces.has(DISCOVERY_STAGE)) return DISCOVERY_STAGE;
    return null;
  }

  /**
   * Loads a thread from the durable store when it is not already resident in
   * memory (restart). The stored projection is validated; an invalid or
   * cross-principal projection fails closed. No command is issued while
   * loading: the current surface is re-derived from authoritative domain
   * state, and an already-existing offer/request is only read, never created.
   */
  #loadThread(threadId: string): GuestThreadState | null {
    const existing = this.#threads.get(threadId);
    if (existing) return existing;
    const environment = this.#environment;
    const record = environment.interactionStore.findThread(threadId);
    if (!record) return null;
    if (record.principalId !== environment.guestPrincipal().id || record.tenantId !== environment.config.tenantId) {
      return null;
    }
    let projection: GuestPersistentProjection | null = null;
    try {
      projection = parseGuestProjection(JSON.parse(record.threadJson) as unknown);
    } catch {
      projection = null;
    }
    if (!projection) return null;

    const thread: GuestThreadState = {
      threadId,
      geminiHistory: [],
      discoveryContext: projection.discoveryContext === null ? null : { ...projection.discoveryContext },
      discoveryArtifact: projection.discoveryArtifact ? structuredClone(projection.discoveryArtifact) : null,
      discoverySurfaceId: projection.discoverySurfaceId,
      discoveryRevision: projection.discoveryRevision,
      unitDetail: projection.unitDetail ? { ...projection.unitDetail } : null,
      requestId: projection.requestId,
      draftId: projection.draftId,
      draftQuote: projection.draftQuote ? { ...projection.draftQuote } : null,
      offerId: projection.offerId,
      activeSurfaces: new Map(),
      supersededSurfaces: new Set(),
      geminiLastSearch: null,
      timeline: projection.timeline.map(({ role, text }) => ({ role, text })),
      lastSurfaces: [],
    };
    this.#threads.set(threadId, thread);
    const restored = this.#restoreCurrentSurface(thread, projection);
    if (restored) {
      thread.lastSurfaces = [restored];
      this.#emitTransition(thread, "interaction.restart_restoration_succeeded", { aggregateType: "interaction_thread", aggregateId: threadId });
    }
    return thread;
  }

  /**
   * Re-derives the current presentation from the authoritative domain state
   * that the stored projection correlates. Stale or expired lifecycle state is
   * preserved fail-closed by the underlying artifact builders (lazy expiry
   * against the current clock).
   */
  #restoreCurrentSurface(thread: GuestThreadState, projection: GuestPersistentProjection): GuestSurfacePayload | null {
    const environment = this.#environment;
    const surfaceId = projection.activeSurfaceId;
    if (!surfaceId) return null;
    try {
      if (projection.activeStage === UNIT_STAGE && projection.unitDetail && projection.discoveryArtifact) {
        const unit = projection.discoveryArtifact.facts.results.find((candidate) => candidate.id === projection.unitDetail?.unitId);
        if (unit) {
          const unitSurfaceId = unitDetailSurfaceId(thread.threadId, projection.discoveryRevision);
          thread.activeSurfaces.set(UNIT_STAGE, unitSurfaceId);
          return {
            surfaceId: unitSurfaceId,
            mode: "focused-surface",
            summary: `${unit.title} details`,
            conventionalRoute: conventionalBookingRequestRoute(""),
            textFallback: `${unit.title}. ${unit.location.neighbourhood}, ${unit.location.city}. Entire Place; capacity ${unit.capacity} guests.`,
            a2uiMessages: unitDetailArtifactToA2UI({
              artifact: unitDetailArtifactFromProjection({ unit, ...this.#stayDatesFor(thread), projectionVersion: projection.discoveryArtifact.projectionVersion, viewer: environment.guestPrincipal() }),
              surfaceId: unitSurfaceId,
            }),
          };
        }
      }
      if (projection.activeStage === REQUEST_STAGE && projection.draftId && !projection.requestId) {
        // Draft or review: rebuild the current draft artifact surface. The
        // stored surface id distinguishes draft from review.
        const review = surfaceId.includes(":request:review:");
        const artifact = this.#draftArtifact(thread, review ? "review" : "draft");
        const draftSurfaceId = review
          ? `thread-${thread.threadId}:request:review:${projection.draftId}`
          : `thread-${thread.threadId}:request:draft:${projection.draftId}`;
        thread.activeSurfaces.set(REQUEST_STAGE, draftSurfaceId);
        return {
          surfaceId: draftSurfaceId,
          mode: "focused-surface",
          summary: review ? "Request review" : "Request Draft",
          conventionalRoute: conventionalRequestDraftRoute(projection.draftId),
          textFallback: this.#draftFallback(artifact),
          a2uiMessages: requestDraftArtifactToA2UI({ artifact, surfaceId: draftSurfaceId }),
        };
      }
      if (projection.activeStage === REQUEST_STAGE && projection.requestId) {
        const artifact = environment.bookingRequestApp.getArtifact(projection.requestId, environment.guestPrincipal());
        if (["declined", "expired", "delivery_failed"].includes(artifact.facts.status)) {
          const outcomeSurface = { ...this.#requestSurface(thread, projection.requestId), mode: "inline-surface", summary: "Request outcome", status: "fallback" } as GuestSurfacePayload;
          thread.activeSurfaces.delete(REQUEST_STAGE);
          return outcomeSurface;
        }
        const requestSurface = this.#requestSurface(thread, projection.requestId);
        thread.activeSurfaces.set(REQUEST_STAGE, requestSurface.surfaceId);
        return requestSurface;
      }
      if (projection.activeStage === OFFER_STAGE && projection.offerId) {
        // Never issue a new offer during restoration; only present the one the
        // durable store already correlates.
        const offerArtifact = environment.conditionalOfferApp.getArtifact(projection.offerId, environment.guestPrincipal());
        const offerSurfaceId = `thread-${thread.threadId}:offer:${projection.offerId}`;
        thread.activeSurfaces.set(OFFER_STAGE, offerSurfaceId);
        return {
          surfaceId: offerSurfaceId,
          mode: "focused-surface",
          summary: offerArtifact.facts.status === "expired" ? "Conditional Booking Offer expired" : "Conditional Booking Offer",
          status: offerArtifact.facts.status === "expired" ? "expired" : "active",
          conventionalRoute: conventionalConditionalOfferRoute(projection.offerId),
          textFallback: `Conditional Booking Offer for ${offerArtifact.facts.unitTitle}. Amount Due Now: ${formatNgnKobo(offerArtifact.facts.totalAmountDueNowKobo)}. Payment deadline: ${formatWAT(offerArtifact.facts.paymentWindowExpiresAt)}.`,
          a2uiMessages: conditionalOfferArtifactToA2UI({ artifact: offerArtifact, surfaceId: offerSurfaceId }),
        };
      }
      if (projection.activeStage === PAYMENT_STAGE && projection.offerId) {
        const snapshot = environment.interactionStore.findBookingSnapshotByOfferId(projection.offerId);
        if (snapshot) {
          try {
            const contract = JSON.parse(snapshot.contractJson) as { readonly contractId: string };
            const bookingSurfaceId = `thread-${thread.threadId}:booking:${contract.contractId}`;
            const contractArtifact = environment.contractApp.getArtifact(contract.contractId, environment.guestPrincipal());
            thread.activeSurfaces.delete(PAYMENT_STAGE);
            thread.activeSurfaces.set(BOOKING_STAGE, bookingSurfaceId);
            return { surfaceId: bookingSurfaceId, mode: "focused-surface", summary: "Reservation confirmed", conventionalRoute: conventionalBookingContractRoute(contract.contractId), textFallback: `Reservation confirmed for ${contractArtifact.facts.checkIn} to ${contractArtifact.facts.checkOut}. Reservation reference: ${contractArtifact.facts.reservationId}.`, a2uiMessages: bookingContractArtifactToA2UI({ artifact: contractArtifact, surfaceId: bookingSurfaceId }) };
          } catch {
            // Keep the payment surface until the durable Contract can be read.
          }
        }
        const artifact = environment.cardPaymentApp.getArtifact(projection.offerId, environment.guestPrincipal());
        if (artifact.facts.status === "confirmed") {
          const snapshot = environment.interactionStore.findBookingSnapshotByOfferId(projection.offerId);
          if (snapshot) {
            const contract = JSON.parse(snapshot.contractJson) as { contractId: string };
            const bookingSurfaceId = `thread-${thread.threadId}:booking:${contract.contractId}`;
            const contractArtifact = environment.contractApp.getArtifact(contract.contractId, environment.guestPrincipal());
            thread.activeSurfaces.delete(PAYMENT_STAGE);
            thread.activeSurfaces.set(BOOKING_STAGE, bookingSurfaceId);
            return { surfaceId: bookingSurfaceId, mode: "focused-surface", summary: "Reservation confirmed", conventionalRoute: conventionalBookingContractRoute(contract.contractId), textFallback: `Reservation confirmed for ${contractArtifact.facts.checkIn} to ${contractArtifact.facts.checkOut}. Reservation reference: ${contractArtifact.facts.reservationId}.`, a2uiMessages: bookingContractArtifactToA2UI({ artifact: contractArtifact, surfaceId: bookingSurfaceId }) };
          }
        }
        if (artifact.facts.status === "expired") {
          const expiredId = `thread-${thread.threadId}:payment:expired:${projection.offerId}`;
          thread.activeSurfaces.set(PAYMENT_STAGE, expiredId);
          return { ...this.#paymentSurface(thread, artifact, "Payment Window expired", expiredId), status: "expired", textFallback: `Payment Window expired. Amount Due Now: ${formatNgnKobo(artifact.facts.amountDueNowKobo)}. No Reservation exists.` };
        }
        const storedSurfaceId = projection.activeSurfaceId ?? "";
        // The stored surface id is the authoritative pointer to the exact
        // server-owned presentation (ADR-0074): processing, deposit, checkout
        // and ready surfaces must restore to the same lifecycle state.
        if (storedSurfaceId.includes(":payment:result:") || artifact.facts.journeyStage === "stay_payment_processing") {
          const processingId = storedSurfaceId.includes(":payment:result:") ? storedSurfaceId : `thread-${thread.threadId}:payment:result:${projection.offerId}`;
          thread.activeSurfaces.set(PAYMENT_STAGE, processingId);
          return { ...this.#paymentSurface(thread, artifact, "Payment processing", processingId), textFallback: `Payment status: ${artifact.facts.status}. Amount Due Now: ${formatNgnKobo(artifact.facts.amountDueNowKobo)}. Payment deadline: ${formatWAT(artifact.facts.paymentWindowExpiresAt)}.` };
        }
        if (artifact.facts.status === "deposit_required" || storedSurfaceId.includes(":deposit-")) {
          const depositId = `thread-${thread.threadId}:payment:deposit-ready:${projection.offerId}`;
          thread.activeSurfaces.set(PAYMENT_STAGE, depositId);
          return { ...this.#paymentSurface(thread, artifact, "Refundable Security Deposit payment required", depositId), textFallback: `Payment status: deposit_required. Amount Due Now: ${formatNgnKobo(artifact.facts.amountDueNowKobo)}. Payment deadline: ${formatWAT(artifact.facts.paymentWindowExpiresAt)}.` };
        }
        const session = environment.cardPaymentApp.manager.getCheckoutSession(projection.offerId);
        if (artifact.facts.status === "checkout_initiated" || (session && session.status === "initiated")) {
          const checkoutId = session?.checkoutId ?? (storedSurfaceId.includes(":checkout:") ? storedSurfaceId.split(":checkout:").at(-1) ?? "restored" : "restored");
          const checkoutSurfaceId = `thread-${thread.threadId}:payment:checkout:${checkoutId}`;
          thread.activeSurfaces.set(PAYMENT_STAGE, checkoutSurfaceId);
          return { ...this.#paymentSurface(thread, artifact, "Payment handoff", checkoutSurfaceId), textFallback: `Payment status: ${artifact.facts.status}. Amount Due Now: ${formatNgnKobo(artifact.facts.amountDueNowKobo)}. Payment deadline: ${formatWAT(artifact.facts.paymentWindowExpiresAt)}.` };
        }
        const readyId = storedSurfaceId.includes(":payment:ready:") ? storedSurfaceId : `thread-${thread.threadId}:payment:ready:${projection.offerId}`;
        thread.activeSurfaces.set(PAYMENT_STAGE, readyId);
        return { ...this.#paymentSurface(thread, artifact, "Secure payment", readyId) };
      }
      if (projection.activeStage === BOOKING_STAGE) {
        const snapshot = environment.interactionStore.findBookingSnapshotByOfferId(projection.offerId ?? "");
        if (snapshot) {
          const contract = JSON.parse(snapshot.contractJson) as { contractId: string; offerId: string };
          const bookingSurfaceId = surfaceId.includes(":booking:")
            ? surfaceId
            : `thread-${thread.threadId}:booking:${contract.contractId}`;
          const contractArtifact = environment.contractApp.getArtifact(contract.contractId, environment.guestPrincipal());
          thread.activeSurfaces.set(BOOKING_STAGE, bookingSurfaceId);
          return {
            surfaceId: bookingSurfaceId,
            mode: "focused-surface",
            summary: "Reservation confirmed",
            conventionalRoute: conventionalBookingContractRoute(contract.contractId),
            textFallback: `Reservation confirmed for ${contractArtifact.facts.checkIn} to ${contractArtifact.facts.checkOut}. Reservation reference: ${contractArtifact.facts.reservationId}.`,
            a2uiMessages: bookingContractArtifactToA2UI({ artifact: contractArtifact, surfaceId: bookingSurfaceId }),
          };
        }
      }
      if (projection.activeStage === DISCOVERY_STAGE && projection.discoveryArtifact) {
        const artifact = projection.discoveryArtifact;
        const discoverySurfaceId = projection.discoverySurfaceId;
        thread.activeSurfaces.set(DISCOVERY_STAGE, discoverySurfaceId);
        return {
          surfaceId: discoverySurfaceId,
          mode: "inline-surface",
          summary: discoverySummary(artifact.facts.filters),
          conventionalRoute: conventionalSearchRoute({}),
          textFallback: artifact.facts.results.length === 0 ? "No eligible Units match those requirements." : `Found ${artifact.facts.results.length} eligible Units.`,
          a2uiMessages: discoveryArtifactToA2UI({ artifact, surfaceId: discoverySurfaceId }),
        };
      }
      return null;
    } catch {
      // A current-domain validation failure during restoration keeps the
      // thread non-actionable rather than starting a new workflow.
      this.#emitTransition(thread, "interaction.restart_restoration_failed", { aggregateType: "interaction_thread", aggregateId: thread.threadId, reasonCode: "RESTORATION_FAILED" });
      return null;
    }
  }

  #createThread(threadId: string): GuestThreadState {
    const thread: GuestThreadState = {
      threadId,
      discoveryContext: null,
      discoveryArtifact: null,
      discoverySurfaceId: `thread-${threadId}:discovery:results`,
      discoveryRevision: 0,
      unitDetail: null,
      requestId: null,
      draftId: null,
      draftQuote: null,
      offerId: null,
      activeSurfaces: new Map(),
      supersededSurfaces: new Set(),
      geminiHistory: [],
      geminiLastSearch: null,
      timeline: [],
      lastSurfaces: [],
    };
    this.#threads.set(threadId, thread);
    return thread;
  }

  #supersede(thread: GuestThreadState, stage: string): void {
    const surfaceId = thread.activeSurfaces.get(stage);
    if (surfaceId) {
      thread.supersededSurfaces.add(surfaceId);
      thread.activeSurfaces.delete(stage);
    }
  }

  #prepareDiscovery(thread: GuestThreadState): void {
    this.#supersede(thread, UNIT_STAGE);
    this.#supersede(thread, DISCOVERY_STAGE);
    thread.discoveryRevision += 1;
    thread.discoverySurfaceId = thread.discoveryRevision === 1
      ? `thread-${thread.threadId}:discovery:results`
      : `thread-${thread.threadId}:discovery:results:${thread.discoveryRevision}`;
  }

  #rememberResult(threadId: string, userText: string | undefined, result: GuestTurnResult & { readonly ok: true }): void {
    const thread = this.#threads.get(threadId) ?? this.#loadThread(threadId) ?? this.#createThread(threadId);
    if (userText !== undefined) thread.timeline.push({ role: "user", text: userText });
    for (const message of result.messages) {
      // Refresh paths can re-present the same outcome message (ADR-0074);
      // avoid duplicating an identical assistant message at the tail.
      const tail = thread.timeline.at(-1);
      if (tail?.role === "assistant" && tail.text === message) continue;
      thread.timeline.push({ role: "assistant", text: message });
    }
    // A text-only turn changes the transcript but does not supersede the
    // current server-backed workspace (ADR-0074).
    if (result.surfaces.length > 0) thread.lastSurfaces = [...result.surfaces];
    try {
      if (result.messages.length > 0) this.#environment.telemetry.track({ type: "interaction.text-response-rendered" });
      for (const surface of result.surfaces) {
        this.#environment.telemetry.track({ type: `interaction.${surface.mode ?? "surface"}-rendered` });
        if (surface.surfaceId.includes(":booking:")) {
          this.#emitTransition(thread, "reservation.summary.rendered", { aggregateType: "reservation", aggregateId: surface.surfaceId.split(":booking:").at(-1), surfaceId: surface.surfaceId });
        }
      }
    } catch { /* presentation telemetry is best-effort */ }
    this.#persistThread(thread);
  }

  #decorateResult(result: GuestTurnResult): GuestTurnResult {
    if (!result.ok) return result;
    return {
      ...result,
      surfaces: result.surfaces.map((surface) => ({
        ...surface,
        mode: surface.mode ?? (surface.surfaceId.includes(":unit:") || surface.surfaceId.includes(":request:") || surface.surfaceId.includes(":offer:") || surface.surfaceId.includes(":payment:") || surface.surfaceId.includes(":booking:") ? "focused-surface" : "inline-surface"),
        status: surface.status ?? "active",
        summary: surface.summary ?? "Current conversation workspace",
      })),
    };
  }

  #handoff(event: GuestEventPayload): WebServerEventHandoff {
    return {
      message: {
        version: "v0.9.1",
        action: {
          name: event.name,
          surfaceId: event.surfaceId,
          sourceComponentId: event.sourceComponentId,
          timestamp: event.timestamp,
          context: event.context ?? ({} as JsonObject),
        },
      },
    };
  }

  #handleViewUnit(thread: GuestThreadState, event: GuestEventPayload): GuestTurnResult {
    const artifact = thread.discoveryArtifact;
    if (!artifact) {
      return { ok: false, code: "INVALID_ARTIFACT", message: "No search is active for this conversation." };
    }
    // Server-side validation against the authoritative discovery artifact;
    // arbitrary client-supplied Unit IDs fail closed here.
    const authoritative = {
      id: artifact.id,
      kind: artifact.kind,
      schemaVersion: artifact.schemaVersion,
      projectionVersion: artifact.projectionVersion,
      actions: artifact.actions
        .filter((action) => action.type === "view-unit")
        .map((action) => ({ type: "view-unit" as const, unitId: action.unitId, conventionalRoute: action.conventionalRoute })),
    };
    const resolved = resolveDiscoveryServerEvent({ event: this.#handoff(event), artifact: authoritative });
    if (!resolved.ok) {
      return { ok: false, code: resolved.code, message: resolved.message };
    }
    const unit = artifact.facts.results.find((candidate) => candidate.id === resolved.effect.unitId);
    if (!unit) {
      return { ok: false, code: "ACTION_NOT_AUTHORIZED", message: "That unit is not available." };
    }

    const unitDetailArtifact = unitDetailArtifactFromProjection({ unit, ...this.#stayDatesFor(thread), projectionVersion: artifact.projectionVersion, viewer: this.#environment.guestPrincipal() });
    thread.unitDetail = { unitId: unit.id, artifactId: unitDetailArtifact.id };
    const surfaceId = unitDetailSurfaceId(thread.threadId, thread.discoveryRevision);
    // ADR-0074: selecting a Unit supersedes the discovery projection and its
    // generated actions; the linear demo has no valid back-navigation state.
    this.#supersede(thread, DISCOVERY_STAGE);
    thread.activeSurfaces.set(UNIT_STAGE, surfaceId);
    this.#emitTransition(thread, "unit.selected", { aggregateType: "unit", aggregateId: unit.id, surfaceId });
    this.#emitTransition(thread, "unit.inspection.opened", { aggregateType: "unit", aggregateId: unit.id, surfaceId });
    return {
      ok: true,
      messages: [`Here are the details for ${unit.title}.`],
      surfaces: [
        {
          surfaceId,
          mode: "focused-surface",
          summary: `${unit.title} details`,
          conventionalRoute: resolved.effect.route,
          textFallback: `${unit.title}. ${unit.location.neighbourhood}, ${unit.location.city}. Entire Place; capacity ${unit.capacity} guests. All-In Stay Total: ${unit.price.allInStayTotalKobo === null ? "not yet quoted" : formatNgnKobo(unit.price.allInStayTotalKobo)}. Refundable Security Deposit: ${formatNgnKobo(unit.price.refundableSecurityDepositKobo)}. Inspection: ${unit.trust.inspection.status}; Management Authority: ${unit.trust.managementAuthority.status}.`,
          a2uiMessages: unitDetailArtifactToA2UI({ artifact: unitDetailArtifact, surfaceId }),
        },
      ],
    };
  }

  #handleSeeAllDiscovery(thread: GuestThreadState, event: GuestEventPayload): GuestTurnResult {
    const artifact = thread.discoveryArtifact;
    const context = event.context;
    if (!artifact || !context || typeof context !== "object" || Array.isArray(context)
      || Object.keys(context).length !== 1 || context.artifactId !== artifact.id) {
      return { ok: false, code: "INVALID_CONTEXT", message: "That discovery workspace is no longer valid." };
    }
    const surfaceId = `thread-${thread.threadId}:discovery:focused`;
    this.#supersede(thread, DISCOVERY_STAGE);
    thread.activeSurfaces.set(DISCOVERY_STAGE, surfaceId);
    const filters = artifact.facts.filters;
    return {
      ok: true,
      messages: ["Here are all the matching Units."],
      surfaces: [{
        surfaceId,
        mode: "focused-surface",
        summary: "All discovery results",
        conventionalRoute: conventionalSearchRoute(filters),
        textFallback: artifact.facts.results.length === 0
          ? "No eligible Units match those requirements."
          : `Found ${artifact.facts.results.length} eligible Units.`,
        a2uiMessages: discoveryArtifactToA2UI({ artifact, surfaceId }),
      }],
    };
  }

  #handleRequestToBook(thread: GuestThreadState, event: GuestEventPayload): GuestTurnResult {
    const detail = thread.unitDetail;
    const context = event.context;
    if (!detail || !context || typeof context !== "object"
      || (context as Record<string, unknown>).artifactId !== detail.artifactId
      || (context as Record<string, unknown>).unitId !== detail.unitId) {
      return { ok: false, code: "INVALID_CONTEXT", message: "That request is no longer valid." };
    }
    if (thread.requestId || thread.offerId) return { ok: false, code: "STALE_SURFACE", message: "A Booking Request already exists for this conversation." };

    if (thread.draftId) {
      const surfaceId = `thread-${thread.threadId}:request:draft:${thread.draftId}`;
      const artifact = this.#draftArtifact(thread, "draft");
      this.#supersede(thread, UNIT_STAGE);
      thread.activeSurfaces.set(REQUEST_STAGE, surfaceId);
      this.#emitTransition(thread, "request_draft.resumed", { aggregateType: "request_draft", aggregateId: thread.draftId, surfaceId });
      return { ok: true, messages: ["Your existing Request Draft is ready to continue. Dates are not reserved."], surfaces: [{ surfaceId, mode: "focused-surface", summary: "Request Draft", conventionalRoute: conventionalRequestDraftRoute(thread.draftId), textFallback: this.#draftFallback(artifact), a2uiMessages: requestDraftArtifactToA2UI({ artifact, surfaceId }) }] };
    }

    const environment = this.#environment;
    const guest: CommandPrincipal = environment.guestPrincipal();
    const draft = environment.bookingRequestApp.createDraft(
      {
        unitId: detail.unitId,
        primaryGuest: { id: environment.guestPrincipal().id, name: environment.config.guestName },
        occupants: environment.demoOccupants(this.#partySizeFor(thread)),
        selfBookingAttestation: environment.selfBookingAttestation(),
        ...this.#stayDatesFor(thread),
      },
      guest,
    );
    thread.draftId = draft.draftId;
    const requestSurfaceId = `thread-${thread.threadId}:request:draft:${draft.draftId}`;
    this.#supersede(thread, UNIT_STAGE);
    thread.activeSurfaces.set(REQUEST_STAGE, requestSurfaceId);
    const artifact = this.#draftArtifact(thread, "draft");
    thread.draftQuote = { allInStayTotalKobo: artifact.facts.allInStayTotalKobo, refundableSecurityDepositKobo: artifact.facts.refundableSecurityDepositKobo, amountDueNowKobo: artifact.facts.amountDueNowKobo };
    this.#emitTransition(thread, "request_draft.created", { aggregateType: "request_draft", aggregateId: draft.draftId, surfaceId: requestSurfaceId });

    return {
      ok: true,
      messages: ["Your Request Draft is ready. Dates are not reserved until you submit a revalidated Booking Request."],
      surfaces: [
        { surfaceId: requestSurfaceId, mode: "focused-surface", summary: "Request Draft", conventionalRoute: conventionalRequestDraftRoute(draft.draftId), textFallback: this.#draftFallback(artifact), a2uiMessages: requestDraftArtifactToA2UI({ artifact, surfaceId: requestSurfaceId }) },
      ],
    };
  }

  #draftArtifact(thread: GuestThreadState, view: "draft" | "review"): RequestDraftArtifact {
    if (!thread.draftId) throw new Error("No Request Draft is active");
    const draft = this.#environment.bookingRequestApp.manager.getDraft(thread.draftId) as {
      readonly draftId: string; readonly unitId: string; readonly primaryGuest: { readonly name: string };
      readonly occupants: readonly { readonly name: string }[]; readonly checkIn: string; readonly checkOut: string;
    };
    const unit = this.#environment.unitRepository.findById(draft.unitId) as Unit | null;
    if (!unit) throw new Error("The selected Unit is no longer available.");
    const quote = createStayQuote({
      unit,
      checkIn: draft.checkIn,
      checkOut: draft.checkOut,
      partySize: draft.occupants.length || 1,
      clock: this.#environment.clock,
    });
    return requestDraftArtifactFromProjection({
      draftId: draft.draftId,
      unitId: unit.id,
      unitTitle: unit.title,
      operatorName: unit.operator.name,
      checkIn: quote.checkIn,
      checkOut: quote.checkOut,
      nights: quote.nights,
      primaryGuestName: draft.primaryGuest.name,
      occupants: draft.occupants.map((occupant) => occupant.name),
      allInStayTotalKobo: quote.allInStayTotalKobo,
      refundableSecurityDepositKobo: quote.refundableSecurityDepositKobo,
      amountDueNowKobo: quote.totalAmountDueNowKobo,
      cancellationPolicy: { type: quote.cancellationPolicy.type, version: quote.cancellationPolicy.version, summary: quote.cancellationPolicy.policySummary },
      view,
      policyVersions: quote.policyVersions,
      disclosures: quote.disclosures,
    }, this.#environment.guestPrincipal());
  }

  #draftFallback(artifact: RequestDraftArtifact): string {
    return `${artifact.facts.unitTitle}. Stay: ${artifact.facts.checkIn} to ${artifact.facts.checkOut} (${artifact.facts.nights} nights). All-In Stay Total: ${formatNgnKobo(artifact.facts.allInStayTotalKobo)}. Refundable Security Deposit: ${formatNgnKobo(artifact.facts.refundableSecurityDepositKobo)}. Amount Due Now if confirmed: ${formatNgnKobo(artifact.facts.amountDueNowKobo)}. Inventory is not reserved.`;
  }

  #handleDraftReview(thread: GuestThreadState, event: GuestEventPayload): GuestTurnResult {
    if (!thread.draftId || event.context?.artifactId !== requestDraftArtifactId(thread.draftId) || event.context?.draftId !== thread.draftId) {
      return { ok: false, code: "INVALID_CONTEXT", message: "That Request Draft is no longer valid." };
    }
    const artifact = this.#draftArtifact(thread, "review");
    const surfaceId = `thread-${thread.threadId}:request:review:${thread.draftId}`;
    this.#supersede(thread, REQUEST_STAGE);
    thread.activeSurfaces.set(REQUEST_STAGE, surfaceId);
    this.#emitTransition(thread, "request_draft.review.opened", { aggregateType: "request_draft", aggregateId: thread.draftId, surfaceId });
    return {
      ok: true,
      messages: ["Review the complete request terms. Nothing is reserved until you submit."],
      surfaces: [{ surfaceId, mode: "focused-surface", summary: "Request review", conventionalRoute: conventionalRequestDraftRoute(thread.draftId), textFallback: this.#draftFallback(artifact), a2uiMessages: requestDraftArtifactToA2UI({ artifact, surfaceId }) }],
    };
  }

  #handleDraftSubmit(thread: GuestThreadState, event: GuestEventPayload): GuestTurnResult {
    if (!thread.draftId || event.context?.artifactId !== requestDraftArtifactId(thread.draftId) || event.context?.draftId !== thread.draftId) {
      return { ok: false, code: "STALE_SURFACE", message: "That Request review is no longer current." };
    }
    const currentTerms = this.#draftArtifact(thread, "review");
    if (!thread.draftQuote || thread.draftQuote.allInStayTotalKobo !== currentTerms.facts.allInStayTotalKobo || thread.draftQuote.refundableSecurityDepositKobo !== currentTerms.facts.refundableSecurityDepositKobo || thread.draftQuote.amountDueNowKobo !== currentTerms.facts.amountDueNowKobo) {
      return { ok: false, code: "QUOTE_CHANGED", message: "The price or deposit changed before submission. Review the updated material terms and submit again." };
    }
    try {
      this.#emitTransition(thread, "booking_request.submission.attempted", { aggregateType: "request_draft", aggregateId: thread.draftId, surfaceId: event.surfaceId });
      const disclosed = this.#environment.bookingRequestApp.disclose(thread.draftId, this.#environment.guestPrincipal(), this.#environment.config.autoDeliverRequests !== false);
      thread.requestId = disclosed.requestId;
      this.#supersede(thread, REQUEST_STAGE);
      const surface = this.#requestSurface(thread, disclosed.requestId);
      thread.activeSurfaces.set(REQUEST_STAGE, surface.surfaceId);
      this.#emitTransition(thread, "booking_request.submitted", { aggregateType: "booking_request", aggregateId: disclosed.requestId, correlationId: thread.draftId, surfaceId: surface.surfaceId });
      return { ok: true, messages: ["Booking Request submitted. No Reservation exists yet; the Operator must respond."], surfaces: [surface] };
    } catch (error) {
      const message = error instanceof Error ? error.message : "The Booking Request could not be submitted.";
      if (/phone number is required/i.test(message)) return this.#contactSurface(thread, "phone", event.context ?? {});
      this.#emitTransition(thread, "booking_request.delivery_failed", { aggregateType: "request_draft", aggregateId: thread.draftId, reasonCode: "REQUEST_DELIVERY_FAILED" });
      return { ok: false, code: "REQUEST_NOT_SUBMITTED", message };
    }
  }

  #contactSurface(thread: GuestThreadState, kind: "phone" | "email", resumeContext: JsonObject): GuestTurnResult {
    const stage = kind === "phone" ? REQUEST_STAGE : PAYMENT_STAGE;
    const surfaceId = `thread-${thread.threadId}:contact:${kind}`;
    this.#supersede(thread, stage);
    thread.activeSurfaces.set(stage, surfaceId);
    const contact = this.#environment.guestContactApp.get(this.#environment.guestPrincipal());
    const label = kind === "phone" ? "Phone number" : "Email address for payment and booking receipt";
    const eventName = kind === "phone" ? GUEST_PHONE_SUBMIT_EVENT : GUEST_EMAIL_SUBMIT_EVENT;
    const components: A2UIComponent[] = [
      { id: "root", component: "Column", children: ["contact-title", "contact-help", "contact-value", "contact-save"] },
      { id: "contact-title", component: "Text", text: label, variant: "h2" },
      { id: "contact-help", component: "Text", text: kind === "phone" ? "We may use this for booking coordination. This does not verify ownership." : "Required before payment continuation. This does not verify ownership." },
      { id: "contact-value", component: "TextField", label, value: { path: "/contactValue" } },
      { id: "contact-save", component: "Button", child: "contact-save-label", variant: "primary", action: { event: { name: eventName, context: { ...resumeContext, contactValue: { path: "/contactValue" }, expectedRevision: contact?.revision ?? 0 } } }, accessibility: { label: `Save ${label}` } },
      { id: "contact-save-label", component: "Text", text: `Save ${label}` },
    ];
    return { ok: true, messages: [kind === "phone" ? "Add a phone number before submitting this Booking Request." : "Add an email address before continuing to payment."], surfaces: [{ surfaceId, mode: "focused-surface", summary: label, conventionalRoute: `/guest/contact?kind=${kind}`, textFallback: `${label} is required. Open Contact details to save it.`, a2uiMessages: [{ version: "v0.9.1", createSurface: { surfaceId, catalogId: A2UI_V091_BASIC_CATALOG_ID } }, { version: "v0.9.1", updateDataModel: { surfaceId, path: "/contactValue", value: "" } }, { version: "v0.9.1", updateComponents: { surfaceId, components } }] }] };
  }

  #handlePhoneSubmit(thread: GuestThreadState, event: GuestEventPayload): GuestTurnResult {
    const value = event.context?.contactValue;
    if (typeof value !== "string") return { ok: false, code: "INVALID_INPUT", message: "Phone number is required." };
    try { this.#environment.guestContactApp.submitPhone({ phoneNumber: value, expectedRevision: Number(event.context?.expectedRevision ?? 0) }, this.#environment.guestPrincipal()); }
    catch (error) { return { ok: false, code: "INVALID_CONTACT", message: error instanceof Error ? error.message : "Phone number could not be saved." }; }
    return this.#handleDraftSubmit(thread, { ...event, context: event.context });
  }

  #handleEmailSubmit(thread: GuestThreadState, event: GuestEventPayload): GuestTurnResult {
    const value = event.context?.contactValue;
    if (typeof value !== "string") return { ok: false, code: "INVALID_INPUT", message: "Email address is required." };
    try { this.#environment.guestContactApp.submitEmail({ contactEmail: value, expectedRevision: Number(event.context?.expectedRevision ?? 0) }, this.#environment.guestPrincipal()); }
    catch (error) { return { ok: false, code: "INVALID_CONTACT", message: error instanceof Error ? error.message : "Email address could not be saved." }; }
    // Resume the server-issued payment action after the contact application
    // commits the email. The browser-provided contact value is not a payment
    // command and cannot alter the authoritative amount or currency.
    const { contactValue: _contactValue, expectedRevision: _expectedRevision, ...paymentContext } = event.context ?? {};
    return this.#handleCardCheckout(thread, { ...event, name: CARD_PAYMENT_INITIALIZE_CHECKOUT_EVENT, context: paymentContext });
  }

  #requestSurface(thread: GuestThreadState, requestId: string): GuestSurfacePayload {
    const artifact = this.#environment.bookingRequestApp.getArtifact(requestId, this.#environment.guestPrincipal());
    const surfaceId = `thread-${thread.threadId}:request:${requestId}`;
    return {
      surfaceId,
      mode: "focused-surface",
      summary: "Booking Request status",
      conventionalRoute: conventionalBookingRequestRoute(requestId),
      textFallback: `Booking Request status: ${artifact.facts.status}. Stay: ${artifact.facts.checkIn} to ${artifact.facts.checkOut}. Operator response deadline: ${formatWAT(artifact.facts.operatorResponseDeadlineAt)}. No Reservation exists yet.`,
      a2uiMessages: bookingRequestArtifactToA2UI({ artifact, surfaceId }),
    };
  }

  #confirmedBookingSurface(thread: GuestThreadState): GuestSurfacePayload | null {
    if (!thread.offerId) return null;
    const snapshot = this.#environment.interactionStore.findBookingSnapshotByOfferId(thread.offerId);
    if (!snapshot) return null;
    try {
      const contract = JSON.parse(snapshot.contractJson) as { readonly contractId: string };
      const bookingSurfaceId = `thread-${thread.threadId}:booking:${contract.contractId}`;
      const contractArtifact = this.#environment.contractApp.getArtifact(contract.contractId, this.#environment.guestPrincipal());
      this.#supersede(thread, PAYMENT_STAGE);
      thread.activeSurfaces.set(BOOKING_STAGE, bookingSurfaceId);
      return {
        surfaceId: bookingSurfaceId,
        mode: "focused-surface",
        summary: "Reservation confirmed",
        conventionalRoute: conventionalBookingContractRoute(contract.contractId),
        textFallback: `Reservation confirmed for ${contractArtifact.facts.checkIn} to ${contractArtifact.facts.checkOut}. Reservation reference: ${contractArtifact.facts.reservationId}.`,
        a2uiMessages: bookingContractArtifactToA2UI({ artifact: contractArtifact, surfaceId: bookingSurfaceId }),
      };
    } catch {
      return null;
    }
  }

  #refreshWorkflow(thread: GuestThreadState): GuestTurnResult | null {
    const confirmedSurface = this.#confirmedBookingSurface(thread);
    if (confirmedSurface) return { ok: true, messages: [], surfaces: [confirmedSurface] };
    if (thread.offerId && thread.activeSurfaces.has(OFFER_STAGE)) {
      const offer = this.#environment.conditionalOfferApp.getArtifact(thread.offerId, this.#environment.guestPrincipal());
      if (offer.facts.status === "expired") {
        const surfaceId = `thread-${thread.threadId}:offer:${thread.offerId}`;
        thread.activeSurfaces.set(OFFER_STAGE, surfaceId);
        this.#emitTransition(thread, "conditional_booking_offer.expired", { aggregateType: "conditional_booking_offer", aggregateId: thread.offerId, reasonCode: "OFFER_EXPIRED", surfaceId });
        return {
          ok: true,
          messages: ["The Conditional Booking Offer expired. Payment authority has been removed; no Reservation exists."],
          surfaces: [{
            surfaceId,
            mode: "focused-surface",
            summary: "Conditional Booking Offer expired",
            status: "expired",
            conventionalRoute: conventionalConditionalOfferRoute(thread.offerId),
            textFallback: `Conditional Booking Offer for ${offer.facts.unitTitle}. Payment Window expired. No Reservation exists.`,
            a2uiMessages: conditionalOfferArtifactToA2UI({ artifact: offer, surfaceId }),
          }],
        };
      }
    }
    if (thread.offerId && thread.activeSurfaces.has(PAYMENT_STAGE)) {
      const snapshot = this.#environment.interactionStore.findBookingSnapshotByOfferId(thread.offerId);
      if (snapshot) {
        try {
          const contract = JSON.parse(snapshot.contractJson) as { readonly contractId: string };
          const bookingSurfaceId = `thread-${thread.threadId}:booking:${contract.contractId}`;
          const contractArtifact = this.#environment.contractApp.getArtifact(contract.contractId, this.#environment.guestPrincipal());
          this.#supersede(thread, PAYMENT_STAGE);
          thread.activeSurfaces.set(BOOKING_STAGE, bookingSurfaceId);
          return {
            ok: true,
            messages: [],
            surfaces: [{
              surfaceId: bookingSurfaceId,
              mode: "focused-surface",
              summary: "Reservation confirmed",
              conventionalRoute: conventionalBookingContractRoute(contract.contractId),
              textFallback: `Reservation confirmed for ${contractArtifact.facts.checkIn} to ${contractArtifact.facts.checkOut}. Reservation reference: ${contractArtifact.facts.reservationId}.`,
              a2uiMessages: bookingContractArtifactToA2UI({ artifact: contractArtifact, surfaceId: bookingSurfaceId }),
            }],
          };
        } catch {
          // Keep the payment surface until the durable Contract can be read.
        }
      }
      const payment = this.#environment.cardPaymentApp.getArtifact(thread.offerId, this.#environment.guestPrincipal());
      if (payment.facts.status === "expired") {
        const surfaceId = `thread-${thread.threadId}:payment:expired:${thread.offerId}`;
        this.#supersede(thread, PAYMENT_STAGE);
        thread.activeSurfaces.set(PAYMENT_STAGE, surfaceId);
        this.#emitTransition(thread, "payment.expired", { aggregateType: "payment_window", aggregateId: thread.offerId, reasonCode: "PAYMENT_EXPIRED", surfaceId });
        return { ok: true, messages: ["The Payment Window expired. Payment authority has been removed; no Reservation exists."], surfaces: [{ ...this.#paymentSurface(thread, payment, "Payment Window expired", surfaceId), status: "expired", textFallback: `Payment Window expired. Amount Due Now: ${formatNgnKobo(payment.facts.amountDueNowKobo)}. No Reservation exists.` }] };
      }
    }
    if (!thread.requestId || thread.offerId) return null;
    const artifact = this.#environment.bookingRequestApp.getArtifact(thread.requestId, this.#environment.guestPrincipal());
    if (artifact.facts.status === "confirmed") {
      // ADR-0079: never issue a second Conditional Booking Offer for a request
      // that already has one. The refresh path adopts an existing durable
      // offer instead of repeating the issuance command.
      const durableOffer = this.#environment.interactionStore.findConditionalOfferByRequestId(thread.requestId);
      let offerId = durableOffer?.offerId ?? null;
      if (offerId === null) {
        try {
          const offer = this.#environment.conditionalOfferApp.issue(thread.requestId, this.#environment.representativePrincipal());
          offerId = offer.offerId;
        } catch {
          offerId = null;
        }
      }
      if (offerId === null) return { ok: true, messages: ["The Operator confirmed availability, but the Conditional Booking Offer could not be prepared."], surfaces: [this.#requestSurface(thread, thread.requestId)] };
      thread.offerId = offerId;
      this.#supersede(thread, REQUEST_STAGE);
      const surfaceId = `thread-${thread.threadId}:offer:${offerId}`;
      thread.activeSurfaces.set(OFFER_STAGE, surfaceId);
      const offerArtifact = this.#environment.conditionalOfferApp.getArtifact(offerId, this.#environment.guestPrincipal());
      this.#emitTransition(thread, "booking_request.confirmed", { aggregateType: "booking_request", aggregateId: thread.requestId, nextState: "confirmed", correlationId: offerId });
      this.#emitTransition(thread, "conditional_booking_offer.shown", { aggregateType: "conditional_booking_offer", aggregateId: offerId, correlationId: thread.requestId, surfaceId });
      return { ok: true, messages: ["Operator confirmed availability. Review the Conditional Booking Offer; payment is still required."], surfaces: [{ surfaceId, mode: "focused-surface", summary: "Conditional Booking Offer", conventionalRoute: conventionalConditionalOfferRoute(offerId), textFallback: `Conditional Booking Offer for ${offerArtifact.facts.unitTitle}. Amount Due Now: ${formatNgnKobo(offerArtifact.facts.totalAmountDueNowKobo)}. Payment deadline: ${formatWAT(offerArtifact.facts.paymentWindowExpiresAt)}.`, a2uiMessages: conditionalOfferArtifactToA2UI({ artifact: offerArtifact, surfaceId }) }] };
    }
    if (["declined", "expired", "delivery_failed"].includes(artifact.facts.status)) {
      this.#supersede(thread, REQUEST_STAGE);
      const type = artifact.facts.status === "declined" ? "booking_request.declined" : artifact.facts.status === "expired" ? "booking_request.timed_out" : "booking_request.delivery_failed";
      this.#emitTransition(thread, type, { aggregateType: "booking_request", aggregateId: thread.requestId, reasonCode: artifact.facts.status === "declined" ? "OPERATOR_DECLINED" : artifact.facts.status === "expired" ? "OPERATOR_TIMEOUT" : "REQUEST_DELIVERY_FAILED" });
      return { ok: true, messages: [artifact.facts.status === "declined" ? "The Operator declined the request. No Reservation was created and no payment was taken." : artifact.facts.status === "expired" ? "The Booking Request expired. Inventory is no longer reserved and no Reservation exists." : "The Booking Request could not be delivered successfully. Nothing remains reserved; this was not an Operator decline."], surfaces: [{ ...this.#requestSurface(thread, thread.requestId), mode: "inline-surface", summary: "Request outcome", status: "fallback" }] };
    }
    return { ok: true, messages: [], surfaces: [this.#requestSurface(thread, thread.requestId)] };
  }

  #handleOfferAccept(thread: GuestThreadState, event: GuestEventPayload): GuestTurnResult {
    if (!thread.offerId) {
      return { ok: false, code: "INVALID_ARTIFACT", message: "No offer is active for this conversation." };
    }
    this.#emitTransition(thread, "conditional_booking_offer.acceptance_attempted", { aggregateType: "conditional_booking_offer", aggregateId: thread.offerId, surfaceId: event.surfaceId });
    const resolved = resolveConditionalOfferServerEvent({
      event: this.#handoff(event),
      application: this.#environment.conditionalOfferApp,
      principal: this.#environment.guestPrincipal(),
    });
    if (!resolved.ok) {
      this.#emitTransition(thread, "conditional_booking_offer.stale_action_rejected", { aggregateType: "conditional_booking_offer", aggregateId: thread.offerId, reasonCode: "STALE_ACTION", surfaceId: event.surfaceId });
      return { ok: false, code: resolved.code, message: resolved.message };
    }

    const offerId = thread.offerId;
    const paymentSurfaceId = `thread-${thread.threadId}:payment:ready:${offerId}`;
    this.#supersede(thread, OFFER_STAGE);
    thread.activeSurfaces.set(PAYMENT_STAGE, paymentSurfaceId);
    this.#emitTransition(thread, "conditional_booking_offer.accepted", { aggregateType: "conditional_booking_offer", aggregateId: offerId, nextState: "accepted", surfaceId: paymentSurfaceId });

    const paymentArtifact = this.#environment.cardPaymentApp.getArtifact(offerId, this.#environment.guestPrincipal());
    return {
      ok: true,
      messages: ["Offer accepted. Complete the secure card payment to confirm your booking."],
      surfaces: [
        { surfaceId: paymentSurfaceId, mode: "focused-surface", summary: "Secure payment", conventionalRoute: conventionalCardPaymentRoute(offerId), textFallback: `Payment status: ${paymentArtifact.facts.status}. ${paymentArtifact.facts.unit}. Stay: ${paymentArtifact.facts.checkIn} to ${paymentArtifact.facts.checkOut}. Amount Due Now: ${formatNgnKobo(paymentArtifact.facts.amountDueNowKobo)}. Payment deadline: ${paymentArtifact.facts.paymentWindowExpiresAt}.`, a2uiMessages: cardPaymentArtifactToA2UI({ artifact: paymentArtifact, surfaceId: paymentSurfaceId }) },
      ],
    };
  }

  #handleCardCheckout(thread: GuestThreadState, event: GuestEventPayload): GuestTurnResult {
    if (!thread.offerId) {
      return { ok: false, code: "INVALID_ARTIFACT", message: "No payment is active for this conversation." };
    }
    const environment = this.#environment;
    // The contact application owns email validation and persistence. Present
    // its generated input surface before resolving the payment command so the
    // payment resolver never has to infer a missing contact from a swallowed
    // application error.
    if (!environment.guestContactApp.get(environment.guestPrincipal())?.contactEmail) {
      return this.#contactSurface(thread, "email", event.context ?? {});
    }
    const resolved = resolveCardPaymentServerEvent({
      event: this.#handoff(event),
      application: environment.cardPaymentApp,
      principal: environment.guestPrincipal(),
    });
    if (!resolved.ok) {
      if (/email address is required/i.test(resolved.message)) return this.#contactSurface(thread, "email", event.context ?? {});
      return { ok: false, code: resolved.code, message: resolved.message };
    }

    const session = environment.cardPaymentApp.manager.getCheckoutSession(thread.offerId);
    if (!session) {
      return { ok: false, code: "INVALID_ARTIFACT", message: "No checkout session is active." };
    }
    const artifact = environment.cardPaymentApp.getArtifact(thread.offerId, environment.guestPrincipal());
    const surfaceId = `thread-${thread.threadId}:payment:checkout:${session.checkoutId}`;
    this.#supersede(thread, PAYMENT_STAGE);
    thread.activeSurfaces.set(PAYMENT_STAGE, surfaceId);
    this.#emitTransition(thread, "payment.handoff.opened", { aggregateType: "payment", aggregateId: thread.offerId, surfaceId });
    this.#emitTransition(thread, "payment.attempt.initialized", { aggregateType: "payment_attempt", aggregateId: session.checkoutId, correlationId: thread.offerId });
    return { ok: true, messages: ["Secure checkout is ready. Payment credentials stay on the PSP-hosted page; return here for backend verification."], surfaces: [{ surfaceId, mode: "focused-surface", summary: "Payment handoff", conventionalRoute: conventionalCardPaymentRoute(thread.offerId), textFallback: `Payment status: ${artifact.facts.status}. Amount Due Now: ${formatNgnKobo(artifact.facts.amountDueNowKobo)}. Payment deadline: ${formatWAT(artifact.facts.paymentWindowExpiresAt)}. Continue at the secure PSP checkout: ${session.checkoutUrl}`, a2uiMessages: cardPaymentArtifactToA2UI({ artifact, surfaceId }) }] };
  }

  #handlePaymentReturn(thread: GuestThreadState, event: GuestEventPayload): GuestTurnResult {
    if (!thread.offerId || event.context?.artifactId !== `card-payment:${thread.offerId}` || event.context?.offerId !== thread.offerId) return { ok: false, code: "STALE_SURFACE", message: "That payment handoff is no longer current." };
    const environment = this.#environment;
    const current = environment.cardPaymentApp.getArtifact(thread.offerId, environment.guestPrincipal());
    if (current.facts.status !== "checkout_initiated" || event.context?.projectionVersion !== current.projectionVersion) return { ok: false, code: "STALE_SURFACE", message: "That payment handoff is no longer current." };
    const session = environment.cardPaymentApp.manager.getCheckoutSession(thread.offerId);
    if (!session) return { ok: false, code: "INVALID_ARTIFACT", message: "No active payment attempt was found." };
    this.#emitTransition(thread, "payment.return.received", { aggregateType: "payment", aggregateId: thread.offerId, surfaceId: event.surfaceId });
    try {
      const outcome = environment.cardPaymentApp.verifyAndConfirm(session.pspReference, environment.systemPrincipal());
      if (outcome.outcome === "deposit_required") {
        const artifact = environment.cardPaymentApp.getArtifact(thread.offerId, environment.guestPrincipal());
        const surfaceId = `thread-${thread.threadId}:payment:deposit-ready:${thread.offerId}`;
        this.#supersede(thread, PAYMENT_STAGE);
        thread.activeSurfaces.set(PAYMENT_STAGE, surfaceId);
        this.#emitTransition(thread, "payment.verified", { aggregateType: "payment", aggregateId: thread.offerId, nextState: "deposit_required", surfaceId });
        return { ok: true, messages: ["Payment verified for the stay. A separate Refundable Security Deposit payment is required before a Reservation can exist."], surfaces: [this.#paymentSurface(thread, artifact, "Refundable Security Deposit payment required", surfaceId)] };
      }
      const contractArtifact = environment.contractApp.getArtifact(outcome.bookingContract.contractId, environment.guestPrincipal());
      const bookingSurfaceId = `thread-${thread.threadId}:booking:${outcome.bookingContract.contractId}`;
      this.#supersede(thread, PAYMENT_STAGE);
      thread.activeSurfaces.set(BOOKING_STAGE, bookingSurfaceId);
      this.#emitTransition(thread, "payment.verified", { aggregateType: "payment", aggregateId: thread.offerId, nextState: "verified", surfaceId: bookingSurfaceId });
      this.#emitTransition(thread, "reservation.confirmed", { aggregateType: "reservation", aggregateId: outcome.reservation.reservationId, correlationId: thread.offerId, nextState: "confirmed" });
      return { ok: true, messages: ["Payment verified and the Reservation was committed. Your stay is confirmed."], surfaces: [{ surfaceId: bookingSurfaceId, mode: "focused-surface", summary: "Reservation confirmed", conventionalRoute: conventionalBookingContractRoute(outcome.bookingContract.contractId), textFallback: `Reservation confirmed for ${contractArtifact.facts.checkIn} to ${contractArtifact.facts.checkOut}. Reservation reference: ${contractArtifact.facts.reservationId}.`, a2uiMessages: bookingContractArtifactToA2UI({ artifact: contractArtifact, surfaceId: bookingSurfaceId }) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Payment verification did not complete.";
      const artifact = environment.cardPaymentApp.getArtifact(thread.offerId, environment.guestPrincipal());
      const surfaceId = `thread-${thread.threadId}:payment:result:${Date.now()}`;
      this.#supersede(thread, PAYMENT_STAGE);
      thread.activeSurfaces.set(PAYMENT_STAGE, surfaceId);
       if (/processing|grace/i.test(message)) { this.#emitTransition(thread, "payment.processing", { aggregateType: "payment", aggregateId: thread.offerId, reasonCode: "PAYMENT_PROCESSING", surfaceId }); return { ok: true, messages: ["Payment is still processing. It has not succeeded and no Reservation exists yet."], surfaces: [this.#paymentSurface(thread, artifact, "Payment processing", surfaceId)] }; }
       if (/late|expired|deadline/i.test(message)) this.#emitTransition(thread, "payment.late_payment.detected", { aggregateType: "payment", aggregateId: thread.offerId, reasonCode: /expired|deadline/i.test(message) ? "PAYMENT_EXPIRED" : "LATE_PAYMENT", surfaceId });
       else this.#emitTransition(thread, "payment.failed", { aggregateType: "payment", aggregateId: thread.offerId, reasonCode: "PAYMENT_FAILED", surfaceId });
       return { ok: true, messages: [`Payment was not verified. No Reservation was created. ${message}`], surfaces: [this.#paymentSurface(thread, artifact, "Payment verification result", surfaceId)] };
    }
  }

  #paymentSurface(thread: GuestThreadState, artifact: ReturnType<CardPaymentApplication["getArtifact"]>, summary: string, surfaceId: string): GuestSurfacePayload {
    return { surfaceId, mode: "focused-surface", summary, conventionalRoute: conventionalCardPaymentRoute(thread.offerId!), textFallback: `Payment status: ${artifact.facts.status}. Amount Due Now: ${formatNgnKobo(artifact.facts.amountDueNowKobo)}. Payment deadline: ${formatWAT(artifact.facts.paymentWindowExpiresAt)}.`, a2uiMessages: cardPaymentArtifactToA2UI({ artifact, surfaceId }) };
  }

  #partySizeFor(thread: GuestThreadState): number {
    const filters = thread.discoveryArtifact?.facts.filters;
    return typeof filters?.partySize === "number" && Number.isInteger(filters.partySize) && filters.partySize >= 1
      ? filters.partySize
      : 1;
  }

  #stayDatesFor(thread: GuestThreadState): { readonly checkIn: string; readonly checkOut: string } {
    const filters = thread.discoveryArtifact?.facts.filters;
    if (typeof filters?.checkIn !== "string" || typeof filters.checkOut !== "string") {
      throw new Error("Discovery dates are required for the booking journey");
    }
    return { checkIn: filters.checkIn, checkOut: filters.checkOut };
  }
}

interface GuestEventPayload {
  readonly name: string;
  readonly surfaceId: string;
  readonly sourceComponentId: string;
  readonly timestamp: string;
  readonly context: JsonObject | null;
}

function readEventPayload(payload: unknown): GuestEventPayload | undefined {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const record = payload as Record<string, unknown>;
  if (typeof record.name !== "string" || record.name.trim() === "") return undefined;
  if (typeof record.surfaceId !== "string" || record.surfaceId.trim() === "") return undefined;
  const context: JsonObject | null =
    record.context !== null && typeof record.context === "object" && !Array.isArray(record.context)
      ? (record.context as JsonObject)
      : null;
  return {
    name: record.name,
    surfaceId: record.surfaceId,
    sourceComponentId: typeof record.sourceComponentId === "string" ? record.sourceComponentId : "unknown",
    timestamp: typeof record.timestamp === "string" ? record.timestamp : new Date().toISOString(),
    context,
  };
}

function formatWAT(iso: string): string {
  return new Intl.DateTimeFormat("en-NG", {
    timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short", hour12: false,
  }).format(new Date(iso)) + " WAT";
}

function discoverySummary(filters: unknown): string {
  if (filters === null || typeof filters !== "object" || Array.isArray(filters)) return "Search results";
  const record = filters as Record<string, unknown>;
  const location = typeof record.location === "string" ? record.location.trim() : "";
  const neighbourhood = typeof record.neighbourhood === "string" ? record.neighbourhood.trim() : "";
  const partySize = typeof record.partySize === "number" && Number.isSafeInteger(record.partySize) && record.partySize > 0
    ? `${record.partySize} guests` : "";
  const place = [neighbourhood, location].filter(Boolean).join(", ");
  return ["Search updated", place, partySize].filter(Boolean).join(" · ");
}

export function renderGuestShellHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Shortlet Concierge</title>
  <link rel="stylesheet" href="/shortlet-foundations.css">
  <style>
    :root {
      --bg: var(--color-canvas); --surface: var(--color-surface); --surface-soft: var(--color-surface-subtle);
      --border: var(--color-border); --text: var(--color-text); --text-muted: var(--color-text-muted);
      --accent: var(--color-action); --accent-hover: var(--color-action-hover); --user-bubble: var(--color-action);
      --focus: var(--color-focus); --danger: var(--color-danger);
    }
    * { box-sizing: border-box; }
    html { background: var(--bg); }
    body { background: var(--bg); color: var(--text); font-family: var(--font-sans); margin: 0; line-height: 1.5; }
    button, input { font: inherit; }
    button, a { -webkit-tap-highlight-color: transparent; }
    :focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
    .skip-link { position: absolute; left: 8px; top: -100px; z-index: 30; background: var(--surface); color: var(--text); padding: 10px 14px; border: 2px solid var(--focus); border-radius: 8px; }
    .skip-link:focus { top: 8px; }
    .app { width: 100%; max-width: var(--layout-conversation-max); min-height: 100dvh; min-height: 100svh; margin: 0 auto; display: flex; flex-direction: column; }
    header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding: max(var(--space-3), env(safe-area-inset-top)) var(--layout-gutter-mobile) var(--space-3); border-bottom: 1px solid var(--border); background: var(--surface); }
    header h1 { font-size: var(--font-size-label); line-height: var(--font-line-label); margin: 0; font-weight: 700; }
    .header-identity { display: flex; align-items: center; min-height: var(--control-min-target); color: var(--text); text-decoration: none; }
    .header-note { color: var(--text-muted); font-size: var(--font-size-small); white-space: nowrap; }
    main { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    #transcript { flex: 1; min-height: 22dvh; padding: var(--space-6) var(--layout-gutter-mobile) var(--space-4); display: flex; flex-direction: column; gap: var(--space-3); overflow: visible; }
    .conversation-heading { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    .turn { display: flex; flex-direction: column; gap: var(--space-1); }
    .turn.user { align-items: flex-end; }
    .bubble { max-width: min(88%, 70ch); padding: var(--space-2) var(--space-3); border-radius: var(--radius-card); font-size: var(--font-size-body); line-height: var(--font-line-body); white-space: pre-wrap; overflow-wrap: anywhere; }
    .turn.assistant .bubble { max-width: 72ch; padding-inline: 0; color: var(--text); }
    .turn.user .bubble { background: var(--surface-soft); color: var(--text); }
    .historical-summary { width: 100%; display: flex; align-items: center; gap: var(--space-2); color: var(--color-text-secondary); font-size: var(--font-size-small); line-height: var(--font-line-small); padding: var(--space-2) 0; border-top: 1px solid var(--border); }
    .historical-summary::before { content: "Past"; flex: none; color: var(--color-text-muted); font-size: var(--font-size-metadata); font-weight: 600; }
    #empty-state { max-width: 70ch; padding-block: var(--space-3) var(--space-6); }
    #empty-state h2 { margin: 0 0 var(--space-2); font-size: var(--font-size-h2); line-height: var(--font-line-h2); }
    #empty-state p { max-width: 64ch; margin: 0; color: var(--color-text-secondary); }
    .prompt-suggestions { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-3); }
    .prompt-suggestion { min-height: var(--control-min-target); padding: var(--space-2) var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--surface); color: var(--text); cursor: pointer; }
    #workspace-region { padding: 0 var(--layout-gutter-mobile) var(--space-4); }
    #active-workspace { background: var(--color-surface-elevated); border: 1px solid var(--border); border-radius: var(--radius-workspace); padding: var(--space-4); box-shadow: var(--elevation-active); }
    #active-workspace[data-mode="focused-surface"] { min-height: min(68dvh, 680px); }
    #active-workspace[hidden], #workspace-region[hidden], #workspace-reopen[hidden], #empty-state[hidden] { display: none; }
    .workspace-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-3); margin-bottom: var(--space-2); }
    .workspace-heading-text { min-width: 0; display: grid; gap: var(--space-1); }
    .workspace-title { margin: 0; font-size: var(--font-size-h3); line-height: var(--font-line-h3); font-weight: 650; overflow-wrap: anywhere; }
    .eyebrow { color: var(--accent); font-size: var(--font-size-metadata); font-weight: 650; }
    .workspace-close, #workspace-reopen, .contact-link { display: inline-flex; min-height: var(--control-min-target); align-items: center; justify-content: center; padding: var(--space-2) var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-control); color: var(--text); background: var(--surface); text-decoration: none; cursor: pointer; }
    .contact-link { color: var(--color-text-secondary); font-size: var(--font-size-small); }
    .workspace-close:hover, #workspace-reopen:hover, .contact-link:hover { border-color: var(--accent); }
    .workspace-status { margin: 0 0 var(--space-3); color: var(--color-text-secondary); font-size: var(--font-size-small); }
    .workspace-status[data-status="stale"], .workspace-status[data-status="expired"], .workspace-status[data-status="deleted"], .workspace-status[data-status="fallback"] { padding: var(--space-2) var(--space-3); border-inline-start: 3px dashed var(--color-warning); background: var(--color-warning-surface); color: var(--color-warning); }
    .weaver-mount { min-width: 0; max-width: 100%; overflow: visible; }
    .weaver-mount img { display: block; width: 100%; max-width: 100%; height: auto; min-height: 120px; aspect-ratio: 4 / 3; object-fit: cover; border-radius: var(--radius-card); background: var(--surface-soft); }
    .photo-fallback { width: 100%; min-height: 120px; aspect-ratio: 4 / 3; display: grid; place-items: center; padding: var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-card); background: var(--surface-soft); color: var(--text-muted); text-align: center; }
    .weaver-mount small[data-a2ui-component="Text"] { color: var(--color-text-secondary); font-size: var(--font-size-small) !important; font-style: normal !important; line-height: var(--font-line-small); }
    .weaver-mount button[data-a2ui-variant="primary"] { min-width: var(--control-min-target); min-height: var(--control-min-target); border-color: var(--color-action) !important; background-color: var(--color-action) !important; color: var(--color-surface) !important; font: 600 var(--font-size-label)/var(--font-line-label) var(--font-sans); }
    .weaver-mount button[data-a2ui-variant="primary"]:hover { background-color: var(--color-action-hover) !important; }
    .weaver-mount button[data-a2ui-variant="primary"]:active { background-color: var(--color-action-pressed) !important; }
    .surface-fallback { border-inline-start: 4px solid var(--color-warning); padding: var(--space-1) 0 var(--space-1) var(--space-3); }
    .surface-fallback p { margin: 0 0 var(--space-2); }
    .fallback-link { display: inline-flex; align-items: center; min-height: var(--control-min-target); color: var(--accent); font-weight: 650; }
    #workspace-reopen { margin: 0 var(--layout-gutter-mobile) var(--space-4); width: calc(100% - 2 * var(--layout-gutter-mobile)); justify-content: flex-start; text-align: start; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
    form#composer { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: var(--space-2); padding: var(--space-2) var(--layout-gutter-mobile) max(var(--space-4), env(safe-area-inset-bottom)); border-top: 1px solid var(--border); background: var(--surface); position: sticky; bottom: 0; z-index: 10; }
    #composer-label { grid-column: 1 / -1; color: var(--color-text-secondary); font-size: var(--font-size-small); line-height: var(--font-line-small); font-weight: 600; }
    #composer-input { min-width: 0; width: 100%; min-height: var(--control-min-field); padding: var(--space-2) var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-control); font-size: 1rem; background: var(--bg); color: var(--text); }
    #composer-submit { min-height: var(--control-min-field); min-width: var(--control-min-target); padding: var(--space-2) var(--space-4); border: 1px solid var(--color-action); border-radius: var(--radius-control); background: var(--accent); color: var(--color-surface); font-weight: 650; cursor: pointer; }
    #composer-submit:hover:not(:disabled) { background: var(--accent-hover); }
    #composer-submit:disabled { border-style: dashed; background: var(--surface-soft); color: var(--color-text-secondary); cursor: progress; }
    #working-status { grid-column: 1 / -1; margin: 0; color: var(--color-text-secondary); font-size: var(--font-size-small); }
    @media (min-width: 48rem) { #transcript, #workspace-region, form#composer { padding-left: var(--layout-gutter-tablet); padding-right: var(--layout-gutter-tablet); } }
    @media (min-width: 64rem) { .app { max-width: var(--layout-conversation-max); } #transcript, #workspace-region, form#composer { padding-left: var(--layout-gutter-desktop); padding-right: var(--layout-gutter-desktop); } }
    @media (max-width: 47.999rem) { .header-note { display: none; } #active-workspace[data-mode="focused-surface"] { min-height: min(76dvh, 680px); scroll-margin-block: var(--space-3); } }
    @media (max-height: 520px) { header { position: static; } #transcript { min-height: 0; } form#composer { position: sticky; } }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; } }
  </style>
</head>
<body>
  <a class="skip-link" href="#main-content">Skip to conversation</a>
  <div class="app">
    <header>
      <a class="header-identity" href="/" aria-label="Shortlet home"><h1>Shortlet</h1></a>
      <span class="header-note">Abuja · Lagos</span>
      <a class="contact-link" href="/guest/contact">Contact details</a>
    </header>
    <main id="main-content" tabindex="-1">
      <section id="transcript" aria-labelledby="conversation-heading">
        <h2 id="conversation-heading" class="conversation-heading">Conversation</h2>
        <section id="empty-state" aria-labelledby="empty-state-heading">
          <h2 id="empty-state-heading">Find a place to stay</h2>
          <p>Tell us whether you’re looking in Abuja or Lagos, your dates or length of stay, and how many guests. The concierge can help find entire-place stays and guide your request.</p>
          <div class="prompt-suggestions">
            <button class="prompt-suggestion" type="button" data-prompt="I’m looking for a stay in Abuja">Explore Abuja</button>
            <button class="prompt-suggestion" type="button" data-prompt="I’m looking for a stay in Lagos">Explore Lagos</button>
          </div>
        </section>
      </section>
      <section id="workspace-region" aria-label="Current workspace" hidden>
        <div id="active-workspace" hidden></div>
      </section>
      <button id="workspace-reopen" type="button" hidden></button>
    </main>
    <div id="announcer" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
    <form id="composer" aria-label="Message the concierge">
      <label id="composer-label" for="composer-input">Your message</label>
      <input id="composer-input" name="message" type="text" autocomplete="off" enterkeyhint="send"
             placeholder="Area, dates, guests" aria-describedby="composer-hint" />
      <span id="composer-hint" class="sr-only">Share a city or neighbourhood, dates or nights, and number of guests.</span>
      <button id="composer-submit" type="submit">Send</button>
      <p id="working-status" hidden></p>
    </form>
  </div>
  <script src="/client.js" defer></script>
</body>
</html>`;
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw === "" ? {} : JSON.parse(raw));
      } catch (error) {
        reject(error instanceof Error ? error : new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

export function renderConventionalUnitDetailHtml(unit: Unit, photoUrl?: (url: string) => string): string {
  const safe = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
  const photos = normalizePhotoUrls(unit.photoUrls);
  const photoMarkup = photos.length === 0
    ? `<p class="photo-fallback" role="status">Photos are not available for this Unit yet.</p>`
    : `<div class="gallery" aria-label="Photos of ${safe(unit.title)}">${photos.map((url, index) => `<img src="${safe(photoUrl ? photoUrl(url) : url)}" alt="Photo ${index + 1} of ${safe(unit.title)}" loading="${index === 0 ? "eager" : "lazy"}" decoding="async" width="800" height="600" referrerpolicy="no-referrer">`).join("")}</div>`;
  return `<!doctype html><html lang="en-NG"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safe(unit.title)}</title><link rel="stylesheet" href="/shortlet-foundations.css"><style>main{width:min(100% - 2 * var(--layout-gutter-mobile),var(--layout-workspace-max));margin:0 auto;padding:24px 0 40px}h1{font-size:var(--font-size-h1);line-height:var(--font-line-h1);margin:0 0 8px}p{margin:8px 0}.muted{color:var(--color-text-muted)}.description{white-space:pre-line}.gallery{display:grid;gap:12px;margin-top:20px}.gallery img{display:block;width:100%;height:auto;aspect-ratio:4/3;object-fit:cover;border-radius:var(--radius-card);background:var(--color-surface-subtle)}.photo-fallback{display:grid;place-items:center;min-height:120px;padding:18px;border-radius:var(--radius-card);background:var(--color-surface-subtle);color:var(--color-text-secondary);text-align:center}a{display:inline-flex;align-items:center;min-height:var(--control-min-target);margin-top:22px;color:var(--color-action);font-weight:700}</style></head><body><main><h1>${safe(unit.title)}</h1><p>${safe(unit.location.neighbourhood)}, ${safe(unit.location.city)}</p><p>Price: ${formatNgnKobo(unit.price.nightlyKobo)} per night</p><p class="muted">Bedrooms: ${unit.bedrooms ?? "Not provided"} · Bathrooms: ${unit.bathrooms} · Capacity: ${unit.capacity} guests · Entire Place</p><p class="description">${safe(unit.description)}</p>${photoMarkup}<a href="/">Continue to Request to Book</a></main></body></html>`;
}

function readRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function readFormBody(req: IncomingMessage): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => { let body = ""; req.setEncoding("utf8"); req.on("data", (chunk) => { body += chunk; if (body.length > 4096) reject(new Error("Form is too large")); }); req.on("end", () => resolve(new URLSearchParams(body))); req.on("error", reject); });
}

export function renderGuestContactHtml(contact: { phoneNumber: string | null; contactEmail: string | null; revision: number } | null, error = "", kind: "phone" | "email" | "both" = "both"): string {
  const safe = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
  const phoneForm = kind === "email" ? "" : `<form method="post" action="/guest/contact/phone"><label for="phoneNumber">Phone number</label><p>We may use this for booking coordination.</p><input id="phoneNumber" name="phoneNumber" type="tel" inputmode="tel" autocomplete="tel" maxlength="32" required value="${safe(contact?.phoneNumber ?? "")}"><input type="hidden" name="expectedRevision" value="${contact?.revision ?? 0}"><button type="submit">Save phone number</button></form>`;
  const emailForm = kind === "phone" ? "" : `<form method="post" action="/guest/contact/email"><label for="contactEmail">Email address for payment and booking receipt</label><input id="contactEmail" name="contactEmail" type="email" inputmode="email" autocomplete="email" maxlength="254" required value="${safe(contact?.contactEmail ?? "")}"><input type="hidden" name="expectedRevision" value="${contact?.revision ?? 0}"><button type="submit">Save email address</button></form>`;
  return `<!doctype html><html lang="en-NG"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Guest contact</title><link rel="stylesheet" href="/shortlet-foundations.css"><style>body{padding:var(--layout-gutter-mobile)}main{max-width:420px;margin:auto}form{margin:20px 0}label{display:block;font-weight:700;margin-bottom:6px}input,button{box-sizing:border-box;width:100%;min-height:var(--control-min-field);font:inherit;padding:10px;border-radius:var(--radius-control)}button{margin-top:10px}.error{color:var(--color-danger)}</style></head><body><main><h1>Guest contact</h1>${error ? `<p class="error" role="alert">${safe(error)}</p>` : ""}${phoneForm}${emailForm}</main></body></html>`;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

const GUEST_SESSION_COOKIE = "shortlet_guest_session";
const GUEST_SESSION_PATTERN = /^gs-[a-f0-9-]{36}$/;

function readGuestSession(req: IncomingMessage): string | null | undefined {
  const header = req.headers.cookie;
  if (typeof header !== "string") return undefined;
  const value = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${GUEST_SESSION_COOKIE}=`))?.slice(GUEST_SESSION_COOKIE.length + 1);
  if (value === undefined) return undefined;
  return GUEST_SESSION_PATTERN.test(value) ? value : null;
}

function issueGuestSession(res: ServerResponse, secureCookie: boolean): string {
  const sessionId = `gs-${crypto.randomUUID()}`;
  res.setHeader("Set-Cookie", `${GUEST_SESSION_COOKIE}=${sessionId};${secureCookie ? " Secure;" : ""} HttpOnly; SameSite=Lax; Path=/`);
  return sessionId;
}

function browserOriginAccepted(req: IncomingMessage, publicOrigin: string | undefined): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  const expected = publicOrigin ?? `http://${req.headers.host ?? "localhost"}`;
  if (origin === "null" && publicOrigin) {
    const configured = safePublicOrigin(publicOrigin);
    return configured !== null
      && configured.protocol === "http:"
      && (configured.hostname === "127.0.0.1" || configured.hostname === "localhost")
      && req.headers["sec-fetch-site"] === "same-origin";
  }
  return origin === expected;
}

function safePublicOrigin(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * Resolves a browser session against the durable session-binding table
 * (ADR-0070/0075). A syntactically valid cookie is never enough: its salted
 * hash must match a stored binding whose principal/tenant match the current
 * environment. The raw session secret is never persisted, so a database leak
 * cannot replay a bearer cookie; only the salted hash is stored and compared.
 */
function resolveBrowserSession(
  env: LocalGuestEnvironment,
  cache: Map<string, BrowserSession>,
  sessionId: string | null | undefined,
  expectedPrincipalId?: string,
): BrowserSession | null {
  if (sessionId === null || typeof sessionId !== "string") return null;
  const sessionKey = hashSessionSecret(sessionId);
  const cached = cache.get(sessionKey);
  if (cached) {
    if ((expectedPrincipalId !== undefined && cached.principalId !== expectedPrincipalId) || cached.tenantId !== env.config.tenantId) return null;
    return cached;
  }
  const binding = env.interactionStore.findSessionBinding(sessionKey);
  if (!binding) return null;
  if ((expectedPrincipalId !== undefined && binding.principalId !== expectedPrincipalId) || binding.tenantId !== env.config.tenantId) return null;
  const session: BrowserSession = {
    sessionKey,
    principalId: binding.principalId,
    tenantId: binding.tenantId,
    // The thread set is derived from the durable principal-scoped threads; the
    // browser session itself never authorizes a thread id on its own.
    threadIds: new Set(env.interactionStore.findThreadsForPrincipal(binding.principalId, binding.tenantId).map((thread) => thread.threadId)),
  };
  cache.set(sessionKey, session);
  return session;
}

function bindBrowserThread(
  env: LocalGuestEnvironment,
  cache: Map<string, BrowserSession>,
  req: IncomingMessage,
  threadId: string,
  requireSession = false,
): boolean {
  const sessionId = readGuestSession(req);
  if (sessionId === null) return false;
  if (sessionId === undefined) {
    if (requireSession) return false;
    // No browser session cookie at all: the deterministic demo accepts an
    // anonymous turn (legacy local behavior). The thread is still persisted
    // under the demo principal so it is restorable.
    const principal = env.guestPrincipal();
    const record = env.interactionStore.findThread(threadId);
    if (record) {
      env.interactionStore.saveThread({
        threadId,
        principalId: principal.id,
        tenantId: env.config.tenantId,
        threadJson: record.threadJson,
      });
    }
    return true;
  }
  const session = resolveBrowserSession(env, cache, sessionId, env.config.guestId);
  if (!session) return false;
  // The thread row is owned by the principal/tenant (ADR-0070); persisting it
  // makes the thread re-derivable after a restart by the same session binding.
  const record = env.interactionStore.findThread(threadId);
  if (record) {
    if (record.principalId !== session.principalId || record.tenantId !== session.tenantId) return false;
    env.interactionStore.saveThread({
      threadId,
      principalId: session.principalId,
      tenantId: session.tenantId,
      threadJson: record.threadJson,
    });
  }
  session.threadIds.add(threadId);
  return true;
}

function registerBrowserSession(
  env: LocalGuestEnvironment,
  cache: Map<string, BrowserSession>,
  sessionId: string,
  principalId = env.config.guestId,
): BrowserSession {
  const sessionKey = hashSessionSecret(sessionId);
  const session: BrowserSession = {
    sessionKey,
    principalId,
    tenantId: env.config.tenantId,
    threadIds: new Set(),
  };
  cache.set(sessionKey, session);
  // Persist the binding (hash only, never the raw secret) so a restarted
  // application instance can re-authenticate the same browser session.
  env.interactionStore.saveSessionBinding({
    sessionId: sessionKey,
    sessionSecretHash: sessionKey,
    principalId,
    tenantId: env.config.tenantId,
  });
  return session;
}

interface BrowserSession {
  readonly sessionKey: string;
  readonly principalId: string;
  readonly tenantId: string;
  readonly threadIds: Set<string>;
}

const GUEST_HTML_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  // ADR-0078: serve the local accessible foundation while keeping remote styles disallowed.
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
} as const;

function findGuestThreadForOffer(env: LocalGuestEnvironment, offerId: string, principal: { readonly id: string; readonly tenantId?: string }): string | null {
  if (!principal.tenantId) return null;
  for (const thread of env.interactionStore.findThreadsForPrincipal(principal.id, principal.tenantId)) {
    try {
      const projection: unknown = JSON.parse(thread.threadJson);
      if (projection !== null && typeof projection === "object" && !Array.isArray(projection) && (projection as { offerId?: unknown }).offerId === offerId) return thread.threadId;
    } catch {
      // Corrupt thread projections are not eligible callback targets.
    }
  }
  return null;
}

export interface LocalGuestServerHandle {
  readonly port: number;
  readonly app: LocalGuestApp;
  /** The live environment; a fresh one is installed by /api/reset. */
  readonly environment: LocalGuestEnvironment;
  listen(): Promise<number>;
  close(): Promise<void>;
}

export function startLocalGuestServer(options: {
  port?: number;
  environment?: LocalGuestEnvironment;
  clientScriptPath?: string;
  geminiClient?: GeminiConciergeClient;
  modelClient?: AssistantModelClient;
  conciergeMode?: "deterministic" | "gemini" | "assistant-offline";
  paystackClient?: PaystackClient;
  /** Production-only deployment controls. Local fixture defaults remain unchanged. */
  production?: boolean;
  publicOrigin?: string;
  secureCookie?: boolean;
  sessionScopedGuestPrincipals?: boolean;
  /** Explicit local-pilot control; never enabled by production composition. */
  localPayment?: boolean;
  /** Explicit local-pilot photo mapping for synthetic, same-process assets. */
  localPhotoUrl?: (url: string) => string;
  fixtureRoutes?: boolean;
} = {}): LocalGuestServerHandle {
  const port = options.port ?? LOCAL_GUEST_PORT;
  const rawMode = options.conciergeMode ?? process.env.CONCIERGE_MODE;
  const mode: "deterministic" | "gemini" | "assistant-offline" =
    rawMode === "gemini"
      ? "gemini"
      : rawMode === "assistant-offline"
        ? "assistant-offline"
        : "deterministic";

  const configuredPaystack = options.paystackClient ?? (() => {
    const configuration = loadPaystackConfiguration();
    return configuration ? new DirectPaystackClient(configuration) : undefined;
  })();
  const production = options.production === true;
  const fixtureRoutes = options.fixtureRoutes ?? !production;
  if (production && (options.localPayment || options.localPhotoUrl)) throw new Error("Production Guest composition cannot mount local pilot controls");
  const sessionScopedGuestPrincipals = options.sessionScopedGuestPrincipals === true;
  if (production && !options.publicOrigin) throw new Error("Production Guest server requires SHORTLET_PUBLIC_ORIGIN");
  const secureCookie = options.secureCookie ?? production;
  const env = options.environment ?? new LocalGuestEnvironment({
    initialGuestPhoneNumber: null,
    initialGuestContactEmail: null,
    production,
    deterministicPsp: !production,
    ...(configuredPaystack === undefined ? {} : { paystackClient: configuredPaystack }),
  });
  const paystackClient = configuredPaystack ?? env.config.paystackClient;

  let assistantRuntime: AssistantRuntime | undefined;
  let assistantModelClient: AssistantModelClient | undefined;
  let geminiClient: GeminiConciergeClient | undefined;

  if (mode === "assistant-offline") {
    assistantModelClient = options.modelClient ?? new ScriptedAssistantModel();
    assistantRuntime = new AssistantRuntime(env, assistantModelClient);
  } else if (mode === "gemini") {
    if (options.modelClient) {
      assistantModelClient = options.modelClient;
    } else {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("CONCIERGE_MODE=gemini requires GEMINI_API_KEY");
      }
      assistantModelClient = new GeminiInteractionsClient({ apiKey, model: process.env.GEMINI_MODEL?.trim() || undefined });
    }
    assistantRuntime = new AssistantRuntime(env, assistantModelClient);
  }

  const defaultApp = new LocalGuestApp(env, { geminiClient, assistantRuntime });
  const browserSessions = new Map<string, BrowserSession>();
  const sessionRuntimes = new Map<string, { readonly environment: LocalGuestEnvironment; readonly app: LocalGuestApp }>();
  const runtimeForSession = (session: BrowserSession): { readonly environment: LocalGuestEnvironment; readonly app: LocalGuestApp } => {
    if (!sessionScopedGuestPrincipals) return { environment: env, app: defaultApp };
    const existing = sessionRuntimes.get(session.sessionKey);
    if (existing) return existing;
    const runtimeEnvironment = new LocalGuestEnvironment({
      ...env.config,
      guestId: session.principalId,
      initialGuestPhoneNumber: null,
      initialGuestContactEmail: null,
      production,
      deterministicPsp: !production,
      ...(paystackClient === undefined ? {} : { paystackClient }),
    });
    const runtime = {
      environment: runtimeEnvironment,
      app: new LocalGuestApp(runtimeEnvironment, {
        ...(assistantModelClient ? { assistantRuntime: new AssistantRuntime(runtimeEnvironment, assistantModelClient) } : {}),
      }),
    };
    sessionRuntimes.set(session.sessionKey, runtime);
    return runtime;
  };
  const clientScriptPath = options.clientScriptPath
    ?? join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "client.js");

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const rawSession = readGuestSession(req);
    let requestSession: BrowserSession | null = null;
    if (rawSession !== undefined && rawSession !== null) {
      requestSession = resolveBrowserSession(env, browserSessions, rawSession, sessionScopedGuestPrincipals ? undefined : env.config.guestId);
      if (!requestSession && sessionScopedGuestPrincipals && url.pathname !== "/client.js" && !url.pathname.startsWith("/stays/")) {
        sendJson(res, 401, { ok: false, code: "AUTHENTICATION_REQUIRED" });
        return;
      }
    }
    const requestRuntime = requestSession ? runtimeForSession(requestSession) : { environment: env, app: defaultApp };
    // This shadowed application is the same existing Guest application code,
    // selected by the server-owned browser session in production.
    const app = requestRuntime.app;

    if (req.method === "GET" && url.pathname === "/shortlet-foundations.css") {
      res.writeHead(200, { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=3600" });
      res.end(SHORTLET_FOUNDATION_CSS);
      return;
    }

    if (req.method === "GET" && url.pathname === "/") {
      if (rawSession === null) {
        // A malformed session cookie is rejected, never silently replaced.
        res.writeHead(401, { "Content-Type": "text/plain" });
        res.end("Unauthorized");
        return;
      }
      if (rawSession === undefined) {
        const sessionId = issueGuestSession(res, secureCookie);
        const principalId = sessionScopedGuestPrincipals ? `guest-${crypto.randomUUID()}` : app.environment.config.guestId;
        const registered = registerBrowserSession(env, browserSessions, sessionId, principalId);
        if (sessionScopedGuestPrincipals) runtimeForSession(registered);
      } else {
        // A well-formed cookie must resolve to a durable binding; an unknown
        // id is rejected rather than silently minted into a new session.
        const resolved = resolveBrowserSession(app.environment, browserSessions, rawSession, sessionScopedGuestPrincipals ? undefined : app.environment.config.guestId);
        if (!resolved) {
          res.writeHead(401, { "Content-Type": "text/plain" });
          res.end("Unauthorized");
          return;
        }
      }
      res.writeHead(200, GUEST_HTML_HEADERS);
      res.end(renderGuestShellHtml());
      return;
    }

    const conventionalUnitMatch = /^\/stays\/([^/]+)$/.exec(url.pathname);
    if (req.method === "GET" && conventionalUnitMatch) {
      let unitId: string;
      try { unitId = decodeURIComponent(conventionalUnitMatch[1]!); } catch { res.writeHead(400, { "Content-Type": "text/plain" }); res.end("Invalid Unit"); return; }
      const unit = app.environment.unitRepository.findById(unitId);
      if (!unit || !isEligibleUnit(unit, app.environment.clock())) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("Unit not found"); return; }
      res.writeHead(200, GUEST_HTML_HEADERS);
      res.end(renderConventionalUnitDetailHtml(unit, options.localPhotoUrl));
      return;
    }

    if (req.method === "GET" && url.pathname === "/client.js") {
      try {
        const script = readFileSync(clientScriptPath, "utf8");
        res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
        res.end(script);
      } catch {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Guest client bundle missing; run npm run guest:local to build it.");
      }
      return;
    }

    const paymentPageMatch = /^\/payments\/offers\/([^/]+)$/.exec(url.pathname);
    if (req.method === "GET" && paymentPageMatch) {
      const session = resolveBrowserSession(env, browserSessions, readGuestSession(req), sessionScopedGuestPrincipals ? undefined : app.environment.config.guestId);
      if (!session) { sendJson(res, 401, { ok: false, code: "AUTHENTICATION_REQUIRED" }); return; }
      let offerId: string;
      try { offerId = decodeURIComponent(paymentPageMatch[1]!); } catch { sendJson(res, 400, { ok: false, code: "INVALID_OFFER" }); return; }
      try {
        const principal: CommandPrincipal = { id: session.principalId, role: "guest", tenantId: session.tenantId };
        const artifact = app.environment.cardPaymentApp.getArtifact(offerId, principal);
        const label = options.localPayment ? "Continue to local demo payment" : "Continue to secure checkout";
        res.writeHead(200, GUEST_HTML_HEADERS);
        res.end(`<!doctype html><html lang="en-NG"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payment continuation</title><link rel="stylesheet" href="/shortlet-foundations.css"><style>main{max-width:560px;margin:auto;padding:32px var(--layout-gutter-mobile)}a{display:inline-flex;align-items:center;min-height:var(--control-min-target);padding:0 20px;border-radius:var(--radius-control);background:var(--color-action);color:var(--color-surface);font-weight:700;text-decoration:none}</style></head><body><main><h1>Payment continuation</h1><p>Authoritative amount due now: ${formatNgnKobo(artifact.facts.amountDueNowKobo)}.</p><a href="/payments/offers/${encodeURIComponent(offerId)}/continue">${label}</a></main></body></html>`);
      } catch { sendJson(res, 404, { ok: false, code: "PAYMENT_OFFER_NOT_FOUND" }); }
      return;
    }

    const continuationMatch = /^\/payments\/offers\/([^/]+)\/continue$/.exec(url.pathname);
    if (req.method === "GET" && continuationMatch) {
      // ADR-0087: payment initialization is a server-owned continuation, not
      // a browser-selected amount, currency, reference, callback, or URL.
      const session = resolveBrowserSession(env, browserSessions, readGuestSession(req), sessionScopedGuestPrincipals ? undefined : app.environment.config.guestId);
      if (!session) { sendJson(res, 401, { ok: false, code: "AUTHENTICATION_REQUIRED" }); return; }
      let offerId: string;
      try { offerId = decodeURIComponent(continuationMatch[1]!); } catch { sendJson(res, 400, { ok: false, code: "INVALID_OFFER" }); return; }
      try {
        const principal: CommandPrincipal = { id: session.principalId, role: "guest", tenantId: session.tenantId };
        if (options.localPayment) {
          app.environment.cardPaymentApp.getArtifact(offerId, principal);
          const checkout = app.environment.cardPaymentApp.manager.getCheckoutSession(offerId) ?? app.environment.cardPaymentApp.initializeCheckout(offerId, principal);
          res.writeHead(303, { Location: `/payments/local/checkout?reference=${encodeURIComponent(checkout.pspReference)}` }); res.end();
          return;
        }
        if (!paystackClient) { sendJson(res, 503, { ok: false, code: "PAYSTACK_UNAVAILABLE" }); return; }
        const checkout = await app.environment.cardPaymentApp.initializePaystackCheckout(offerId, principal, paystackClient);
        if (!isApprovedPaystackCheckoutUrl(checkout.checkoutUrl)) { sendJson(res, 502, { ok: false, code: "INVALID_CHECKOUT_URL" }); return; }
        res.writeHead(303, { Location: checkout.checkoutUrl }); res.end();
      } catch {
        sendJson(res, 400, { ok: false, code: "PAYMENT_CONTINUATION_REJECTED" });
      }
      return;
    }

    if (options.localPayment && req.method === "GET" && url.pathname === "/payments/local/checkout") {
      const session = resolveBrowserSession(env, browserSessions, readGuestSession(req), sessionScopedGuestPrincipals ? undefined : app.environment.config.guestId);
      const reference = url.searchParams.get("reference");
      const checkout = reference ? app.environment.cardPaymentApp.manager.getCheckoutSessionByReference(reference) : null;
      if (!session || !reference || !checkout) { sendJson(res, 400, { ok: false, code: "LOCAL_PAYMENT_INVALID" }); return; }
      res.writeHead(200, GUEST_HTML_HEADERS);
      res.end(`<!doctype html><html lang="en-NG"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local demo payment</title><link rel="stylesheet" href="/shortlet-foundations.css"><style>main{max-width:560px;margin:auto;padding:32px var(--layout-gutter-mobile)}button{min-height:var(--control-min-target);padding:0 20px;border:1px solid var(--color-action);border-radius:var(--radius-control);background:var(--color-action);color:var(--color-surface);font-weight:700}</style></head><body><main><h1>Local demo payment</h1><p>This deterministic local provider verifies the authoritative amount without collecting card details.</p><form method="post" action="/payments/local/complete"><input type="hidden" name="reference" value="${reference.replace(/[&<>'"]/g, "")}"><button type="submit">Complete local payment</button></form></main></body></html>`);
      return;
    }

    if (options.localPayment && req.method === "POST" && url.pathname === "/payments/local/complete") {
      if (!browserOriginAccepted(req, options.publicOrigin)) { res.writeHead(403); res.end("Origin rejected"); return; }
      const session = resolveBrowserSession(env, browserSessions, readGuestSession(req), sessionScopedGuestPrincipals ? undefined : app.environment.config.guestId);
      if (!session) { sendJson(res, 401, { ok: false, code: "AUTHENTICATION_REQUIRED" }); return; }
      const params = new URLSearchParams((await readRawBody(req)).toString("utf8"));
      const reference = params.get("reference");
      const checkout = reference ? app.environment.cardPaymentApp.manager.getCheckoutSessionByReference(reference) : null;
      if (!reference || !checkout) { sendJson(res, 400, { ok: false, code: "LOCAL_PAYMENT_INVALID" }); return; }
      const principal: CommandPrincipal = { id: session.principalId, role: "guest", tenantId: session.tenantId };
      try {
        const offer = app.environment.conditionalOfferApp.manager.getOffer(checkout.offerId);
        const expectedPayerId = offer.parties.distinctPayer?.id ?? offer.parties.primaryGuest.id;
        if (!principal.id || principal.id !== expectedPayerId || !principal.tenantId || principal.tenantId !== offer.tenantId) throw new Error("Local payment is not authorized for this Guest");
        app.environment.cardPaymentApp.getArtifact(checkout.offerId, principal);
        const threadId = findGuestThreadForOffer(app.environment, checkout.offerId, principal);
        if (!threadId) throw new Error("Local payment thread is unavailable");
        app.environment.cardPaymentApp.verifyAndConfirm(reference, app.environment.systemPrincipal());
        res.writeHead(303, { Location: `/?threadId=${encodeURIComponent(threadId)}` }); res.end();
      } catch { sendJson(res, 400, { ok: false, code: "LOCAL_PAYMENT_REJECTED" }); }
      return;
    }

    if (req.method === "GET" && url.pathname === "/payments/paystack/callback") {
      // ADR-0087: a callback is only a return signal; verification below is
      // the sole path allowed to advance the existing payment transition.
      if (!paystackClient) { sendJson(res, 503, { ok: false, code: "PAYSTACK_UNAVAILABLE" }); return; }
      const session = resolveBrowserSession(env, browserSessions, readGuestSession(req), sessionScopedGuestPrincipals ? undefined : app.environment.config.guestId);
      const reference = url.searchParams.get("reference");
      if (!session || !reference) { sendJson(res, 400, { ok: false, code: "PAYMENT_CALLBACK_INVALID" }); return; }
      const checkout = app.environment.cardPaymentApp.manager.getCheckoutSessionByReference(reference);
      if (!checkout) { sendJson(res, 400, { ok: false, code: "PAYMENT_CALLBACK_UNKNOWN" }); return; }
      const principal: CommandPrincipal = { id: session.principalId, role: "guest", tenantId: session.tenantId };
      try {
        // Resolving the artifact first binds the provider reference to the
        // authenticated Guest and tenant before any server verification.
        const callbackOffer = app.environment.conditionalOfferApp.manager.getOffer(checkout.offerId);
        const expectedPayerId = callbackOffer.parties.distinctPayer?.id ?? callbackOffer.parties.primaryGuest.id;
        if (!principal.id || principal.id !== expectedPayerId || !principal.tenantId || !callbackOffer.tenantId || principal.tenantId !== callbackOffer.tenantId) throw new Error("Payment callback is not authorized for this Guest");
        app.environment.cardPaymentApp.getArtifact(checkout.offerId, principal);
        const threadId = findGuestThreadForOffer(app.environment, checkout.offerId, principal);
        if (!threadId) { sendJson(res, 404, { ok: false, code: "PAYMENT_CALLBACK_THREAD_UNKNOWN" }); return; }
        await app.environment.cardPaymentApp.verifyAndConfirmPaystack(reference, app.environment.systemPrincipal(), paystackClient);
        res.writeHead(303, { Location: `/?threadId=${encodeURIComponent(threadId)}` }); res.end();
      } catch {
        const threadId = findGuestThreadForOffer(app.environment, checkout.offerId, principal);
        if (threadId) { res.writeHead(303, { Location: `/?threadId=${encodeURIComponent(threadId)}` }); res.end(); }
        else sendJson(res, 400, { ok: false, code: "PAYMENT_CALLBACK_REJECTED" });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/webhooks/paystack") {
      // ADR-0087: validate the raw signed body before parsing event meaning.
      if (!paystackClient) { sendJson(res, 503, { ok: false, code: "PAYSTACK_UNAVAILABLE" }); return; }
      try {
        const rawBody = await readRawBody(req);
        if (!paystackClient.verifyWebhookSignature(rawBody, typeof req.headers["x-paystack-signature"] === "string" ? req.headers["x-paystack-signature"] : undefined)) { sendJson(res, 401, { ok: false, code: "INVALID_WEBHOOK_SIGNATURE" }); return; }
        const parsed: unknown = JSON.parse(rawBody.toString("utf8"));
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) { sendJson(res, 400, { ok: false, code: "INVALID_WEBHOOK" }); return; }
        const event = parsed as { event?: unknown; data?: unknown };
        if (event.event !== "charge.success") { sendJson(res, 200, { ok: true, ignored: true }); return; }
        const data = event.data !== null && typeof event.data === "object" && !Array.isArray(event.data) ? event.data as { reference?: unknown } : undefined;
        if (typeof data?.reference !== "string" || data.reference === "") { sendJson(res, 400, { ok: false, code: "INVALID_WEBHOOK" }); return; }
        const checkout = app.environment.cardPaymentApp.manager.getCheckoutSessionByReference(data.reference);
        if (!checkout) { sendJson(res, 200, { ok: true, ignored: true }); return; }
        try { await app.environment.cardPaymentApp.verifyAndConfirmPaystack(data.reference, app.environment.systemPrincipal(), paystackClient); } catch { /* the authoritative unresolved/failed state is retained */ }
        sendJson(res, 200, { ok: true });
      } catch {
        sendJson(res, 400, { ok: false, code: "INVALID_WEBHOOK" });
      }
      return;
    }

    if (url.pathname === "/guest/contact" || url.pathname === "/guest/contact/phone" || url.pathname === "/guest/contact/email") {
      const session = resolveBrowserSession(env, browserSessions, readGuestSession(req), sessionScopedGuestPrincipals ? undefined : app.environment.config.guestId);
      if (!session) { res.writeHead(401, { "Content-Type": "text/plain" }); res.end("Unauthorized"); return; }
      const contactPrincipal: CommandPrincipal = { id: session.principalId, role: "guest", tenantId: session.tenantId };
      if (req.method === "GET" && url.pathname === "/guest/contact") { const kind = url.searchParams.get("kind"); const requestedKind = kind === "phone" || kind === "email" ? kind : "both"; res.writeHead(200, GUEST_HTML_HEADERS); res.end(renderGuestContactHtml(app.environment.guestContactApp.get(contactPrincipal), "", requestedKind)); return; }
      if (req.method === "POST") {
        if (!browserOriginAccepted(req, options.publicOrigin)) { res.writeHead(403); res.end("Origin rejected"); return; }
        try {
          const form = await readFormBody(req);
          const expectedRevision = Number(form.get("expectedRevision"));
          if (url.pathname.endsWith("/phone")) app.environment.guestContactApp.submitPhone({ phoneNumber: form.get("phoneNumber") ?? "", ...(Number.isInteger(expectedRevision) ? { expectedRevision } : {}) }, contactPrincipal);
          else app.environment.guestContactApp.submitEmail({ contactEmail: form.get("contactEmail") ?? "", ...(Number.isInteger(expectedRevision) ? { expectedRevision } : {}) }, contactPrincipal);
          res.writeHead(303, { Location: "/guest/contact" }); res.end(); return;
        } catch (error) { res.writeHead(400, GUEST_HTML_HEADERS); res.end(renderGuestContactHtml(app.environment.guestContactApp.get(contactPrincipal), error instanceof Error ? error.message : "Contact could not be saved")); return; }
      }
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      const threadId = url.searchParams.get("threadId");
      if (!threadId || !THREAD_ID_PATTERN.test(threadId)) {
        sendJson(res, 400, { ok: false, code: "INVALID_THREAD", message: "Unknown conversation." });
        return;
      }
      // ADR-0070/0075: a syntactically valid opaque thread ID is not an
      // ownership claim; browser refresh must present the server-issued
      // session binding before any projection is returned.
      const sessionId = readGuestSession(req);
      const session = resolveBrowserSession(app.environment, browserSessions, sessionId);
      if (!session) {
        sendJson(res, 401, { ok: false, code: "AUTHENTICATION_REQUIRED", message: "Conversation access requires an active browser session." });
        return;
      }
      if (!session.threadIds.has(threadId)) {
        sendJson(res, 200, { ok: true, threadId, timeline: [], surfaces: [] });
        return;
      }
      const state = app.getState(threadId);
      if (!state) {
        sendJson(res, 200, { ok: true, threadId, timeline: [], surfaces: [] });
        return;
      }
      sendJson(res, 200, state);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/telemetry") {
      if (!browserOriginAccepted(req, options.publicOrigin)) { res.writeHead(403); res.end("Origin rejected"); return; }
      try {
        const body = await readJsonBody(req);
        const event = body !== null && typeof body === "object" && !Array.isArray(body)
          ? (body as { event?: unknown }).event
          : undefined;
        const accepted = app.recordShellTelemetry(event);
        sendJson(res, accepted ? 200 : 400, { ok: accepted });
      } catch {
        sendJson(res, 400, { ok: false, code: "INVALID_TELEMETRY" });
      }
      return;
    }

    if (req.method === "POST" && (url.pathname === "/api/turn" || url.pathname === "/api/event" || (fixtureRoutes && url.pathname === "/api/reset"))) {
      if (!browserOriginAccepted(req, options.publicOrigin)) { res.writeHead(403); res.end("Origin rejected"); return; }
      try {
        const body = await readJsonBody(req);
        if (fixtureRoutes && url.pathname === "/api/reset") {
          app.reset();
          browserSessions.clear();
          sendJson(res, 200, { ok: true });
          return;
        }
        const threadId = (body as { threadId?: unknown }).threadId;
        if (typeof threadId !== "string") {
          sendJson(res, 400, { ok: false, code: "INVALID_THREAD", message: "threadId is required." });
          return;
        }
        if (!bindBrowserThread(app.environment, browserSessions, req, threadId, sessionScopedGuestPrincipals)) {
          sendJson(res, 401, { ok: false, code: "AUTHENTICATION_REQUIRED", message: "Conversation access requires an active browser session." });
          return;
        }
        if (url.pathname === "/api/turn") {
          const text = (body as { text?: unknown }).text;
          if (typeof text !== "string" || text.trim() === "" || text.length > 2000) {
            sendJson(res, 400, { ok: false, code: "INVALID_INPUT", message: "A short message is required." });
            return;
          }
          sendJson(res, 200, await app.handleTurn(threadId, text));
          return;
        }
        sendJson(res, 200, await app.handleEventAsync(threadId, body));
      } catch (error) {
        sendJson(res, 500, {
          ok: false,
          code: "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : "Unexpected server error.",
        });
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  });

  return {
    port,
    app: defaultApp,
    get environment() {
      return defaultApp.environment;
    },
    listen: () =>
      new Promise<number>((resolve) => {
        server.listen(port, "127.0.0.1", () => {
          const addr = server.address();
          const actualPort = typeof addr === "object" && addr ? addr.port : port;
          resolve(actualPort);
        });
      }),
    close: () =>
      new Promise<void>((resolve) => {
        for (const runtime of sessionRuntimes.values()) runtime.environment.close();
        defaultApp.environment.close();
        // Fetch clients may leave keep-alive sockets open after a response;
        // close them before waiting for the server callback so test and CLI
        // shutdowns are deterministic.
        server.closeIdleConnections?.();
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
