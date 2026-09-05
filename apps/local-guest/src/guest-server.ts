import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { A2UIServerMessage, JsonObject } from "@weaver/core";
import type { WebServerEventHandoff } from "@weaver/web";
import type { CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import {
  discoveryArtifactToA2UI,
  createWeaverWebAgentAdapter,
  bookingRequestArtifactToA2UI,
  conditionalOfferArtifactToA2UI,
  cardPaymentArtifactToA2UI,
  bookingContractArtifactToA2UI,
  unitDetailToA2UI,
  requestDraftArtifactToA2UI,
  REQUEST_DRAFT_REVIEW_EVENT,
  REQUEST_DRAFT_SUBMIT_EVENT,
  REQUEST_TO_BOOK_EVENT,
  SEE_ALL_DISCOVERY_EVENT,
  formatNgnKobo,
  type DiscoveryArtifactProjection,
} from "../../../apps/web-agent/src/index.js";
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
import { resolveCardPaymentServerEvent } from "../../../apps/web/src/card-payment-actions.js";
import { createStayQuote, type Unit } from "../../../domains/shortlet/src/index.js";
import { requestDraftArtifactFromProjection, requestDraftArtifactId } from "../../../apps/web/src/request-draft-artifact.js";
import type { RequestDraftArtifact } from "../../../apps/web/src/request-draft-artifact.js";
import type { CardPaymentApplication } from "../../../apps/web/src/card-payment-application.js";
import {
  LocalGuestEnvironment,
  LOCAL_GUEST_PORT,
  resetLocalGuestFixture,
  type LocalGuestFixtureConfig,
} from "./fixture.js";
import {
  parseGuestProjection,
  type GuestPersistentProjection,
} from "./guest-projection.js";
import { hashSessionSecret } from "../../../domains/shortlet/src/index.js";
import { interpretStayRequest } from "./concierge.js";
import { createGeminiConciergeClient, handleGeminiTurn, type GeminiConciergeClient } from "./gemini-concierge.js";
import type { Content } from "@google/genai";
import { AssistantRuntime } from "./assistant/assistant-runtime.js";
import { ScriptedAssistantModel } from "./assistant/scripted-assistant-model.js";
import { GeminiInteractionsClient } from "./assistant/gemini-interactions-client.js";
import type { AssistantModelClient } from "./assistant/assistant-model.js";
import {
  ASSISTANT_CONFIRM_ACTION_EVENT,
  ASSISTANT_CANCEL_ACTION_EVENT,
} from "./assistant/pending-action-a2ui.js";

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
  [ASSISTANT_CONFIRM_ACTION_EVENT]: PENDING_ACTION_STAGE,
  [ASSISTANT_CANCEL_ACTION_EVENT]: PENDING_ACTION_STAGE,
});

const THREAD_ID_PATTERN = /^g-[a-f0-9-]{6,64}$/;

interface GuestThreadState {
  readonly threadId: string;
  readonly geminiHistory: Content[];
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
            summary: "Discovery results",
            conventionalRoute: conventionalSearchRoute({}),
          }],
        };
      } catch {
        return { ok: false, code: "CONCIERGE_UNAVAILABLE", message: "The concierge is temporarily unavailable. Please try again." };
      }
    }

    const interpretation = interpretStayRequest(text, {
      demoCheckIn: this.#environment.config.demoCheckIn,
      demoCheckOut: this.#environment.config.demoCheckOut,
    });

    if (interpretation.kind === "clarify") {
      return { ok: true, messages: [interpretation.reply], surfaces: [] };
    }

    this.#prepareDiscovery(thread);
    const adapter = createWeaverWebAgentAdapter({
      query: { search: (filters) => this.#environment.discoveryQuery.search(filters) },
      createSurfaceId: () => thread.discoverySurfaceId,
    });
    const result = adapter.search({ ...interpretation.filters });
    thread.discoveryArtifact = result.artifact;
    thread.activeSurfaces.set(DISCOVERY_STAGE, thread.discoverySurfaceId);

    return {
      ok: true,
      messages: [
        `I found ${result.artifact.facts.results.length} eligible place${result.artifact.facts.results.length === 1 ? "" : "s"} in ${interpretation.filters.location} for your stay ${interpretation.filters.checkIn} to ${interpretation.filters.checkOut}. You can view the details below.`,
      ],
      surfaces: [{
        surfaceId: result.surfaceId,
        a2uiMessages: result.a2uiMessages,
        mode: "inline-surface",
        summary: "Discovery results",
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
    const refreshed = this.#refreshWorkflow(thread);
    const decorated = refreshed ? this.#decorateResult(refreshed) : null;
    if (decorated?.ok && decorated.surfaces.length > 0) {
      thread.lastSurfaces = [...decorated.surfaces];
      this.#rememberResult(threadId, undefined, decorated);
    }
    const normalized = this.#decorateResult({ ok: true, messages: [], surfaces: thread.lastSurfaces });
    if (!normalized.ok) return undefined;
    thread.lastSurfaces = [...normalized.surfaces];
    return {
      ok: true,
      threadId,
      timeline: [...thread.timeline],
      surfaces: [...normalized.surfaces],
    };
  }

  recordShellTelemetry(event: unknown): boolean {
    if (typeof event !== "string" || !(SHELL_TELEMETRY_EVENTS as readonly string[]).includes(event)) return false;
    this.#environment.telemetry.track({ type: `interaction.${event as ShellTelemetryEvent}` });
    return true;
  }

  #persistThread(thread: GuestThreadState): void {
    const environment = this.#environment;
    const current = thread.lastSurfaces.at(-1);
    const activeStage = this.#stageForSurfaceId(current?.surfaceId ?? "") ?? this.#inferActiveStage(thread);
    environment.interactionStore.saveThread({
      threadId: thread.threadId,
      principalId: environment.config.guestId,
      tenantId: environment.config.tenantId,
      threadJson: JSON.stringify(this.#projectionFor(thread, activeStage)),
    });
  }

  #projectionFor(thread: GuestThreadState, activeStage: string | null): GuestPersistentProjection {
    const current = thread.lastSurfaces.at(-1);
    return {
      version: 1,
      timeline: thread.timeline.map(({ role, text }) => ({ role, text })),
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
    if (record.principalId !== environment.config.guestId || record.tenantId !== environment.config.tenantId) {
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
    if (restored) thread.lastSurfaces = [restored];
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
          const unitSurfaceId = `thread-${thread.threadId}:unit:detail`;
          thread.activeSurfaces.set(UNIT_STAGE, unitSurfaceId);
          return {
            surfaceId: unitSurfaceId,
            mode: "focused-surface",
            summary: `${unit.title} details`,
            conventionalRoute: conventionalBookingRequestRoute(""),
            textFallback: `${unit.title}. ${unit.location.neighbourhood}, ${unit.location.city}. Entire Place; capacity ${unit.capacity} guests.`,
            a2uiMessages: unitDetailToA2UI({
              unit,
              ...this.#stayDatesFor(thread),
              surfaceId: unitSurfaceId,
              action: { artifactId: projection.discoveryArtifact.id, unitId: unit.id, projectionVersion: projection.discoveryArtifact.projectionVersion },
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
        const artifact = environment.cardPaymentApp.getArtifact(projection.offerId, environment.guestPrincipal());
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
          summary: "Discovery results",
          conventionalRoute: conventionalSearchRoute({}),
          textFallback: artifact.facts.results.length === 0 ? "No eligible Units match those requirements." : `Found ${artifact.facts.results.length} eligible Units.`,
          a2uiMessages: discoveryArtifactToA2UI({ artifact, surfaceId: discoverySurfaceId }),
        };
      }
      return null;
    } catch {
      // A current-domain validation failure during restoration keeps the
      // thread non-actionable rather than starting a new workflow.
      return null;
    }
  }

  #createThread(threadId: string): GuestThreadState {
    const thread: GuestThreadState = {
      threadId,
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
    if (result.messages.length > 0) this.#environment.telemetry.track({ type: "interaction.text-response-rendered" });
    for (const surface of result.surfaces) {
      this.#environment.telemetry.track({ type: `interaction.${surface.mode ?? "surface"}-rendered` });
    }
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

    thread.unitDetail = { unitId: unit.id, artifactId: artifact.id };
    const surfaceId = `thread-${thread.threadId}:unit:detail`;
    // ADR-0074: selecting a Unit supersedes the discovery projection and its
    // generated actions; the linear demo has no valid back-navigation state.
    this.#supersede(thread, DISCOVERY_STAGE);
    thread.activeSurfaces.set(UNIT_STAGE, surfaceId);
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
          a2uiMessages: unitDetailToA2UI({
            unit,
            ...this.#stayDatesFor(thread),
            surfaceId,
            action: { artifactId: artifact.id, unitId: unit.id, projectionVersion: artifact.projectionVersion },
          }),
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
      return { ok: true, messages: ["Your existing Request Draft is ready to continue. Dates are not reserved."], surfaces: [{ surfaceId, mode: "focused-surface", summary: "Request Draft", conventionalRoute: conventionalRequestDraftRoute(thread.draftId), textFallback: this.#draftFallback(artifact), a2uiMessages: requestDraftArtifactToA2UI({ artifact, surfaceId }) }] };
    }

    const environment = this.#environment;
    const guest: CommandPrincipal = environment.guestPrincipal();
    const draft = environment.bookingRequestApp.createDraft(
      {
        unitId: detail.unitId,
        primaryGuest: { id: environment.config.guestId, name: environment.config.guestName },
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
      guestIdentityVerified: this.#environment.config.guestIdentityVerified !== false,
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
      const disclosed = this.#environment.bookingRequestApp.disclose(thread.draftId, this.#environment.guestPrincipal(), this.#environment.config.autoDeliverRequests !== false);
      thread.requestId = disclosed.requestId;
      this.#supersede(thread, REQUEST_STAGE);
      const surface = this.#requestSurface(thread, disclosed.requestId);
      thread.activeSurfaces.set(REQUEST_STAGE, surface.surfaceId);
      return { ok: true, messages: ["Booking Request submitted. No Reservation exists yet; the Operator must respond."], surfaces: [surface] };
    } catch (error) {
      const message = error instanceof Error ? error.message : "The Booking Request could not be submitted.";
      return { ok: false, code: /verification|Primary Guest/i.test(message) ? "VERIFICATION_REQUIRED" : "REQUEST_NOT_SUBMITTED", message };
    }
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

  #refreshWorkflow(thread: GuestThreadState): GuestTurnResult | null {
    if (thread.offerId && thread.activeSurfaces.has(OFFER_STAGE)) {
      const offer = this.#environment.conditionalOfferApp.getArtifact(thread.offerId, this.#environment.guestPrincipal());
      if (offer.facts.status === "expired") {
        const surfaceId = `thread-${thread.threadId}:offer:${thread.offerId}`;
        thread.activeSurfaces.set(OFFER_STAGE, surfaceId);
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
      const payment = this.#environment.cardPaymentApp.getArtifact(thread.offerId, this.#environment.guestPrincipal());
      if (payment.facts.status === "expired") {
        const surfaceId = `thread-${thread.threadId}:payment:expired:${thread.offerId}`;
        this.#supersede(thread, PAYMENT_STAGE);
        thread.activeSurfaces.set(PAYMENT_STAGE, surfaceId);
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
      return { ok: true, messages: ["Operator confirmed availability. Review the Conditional Booking Offer; payment is still required."], surfaces: [{ surfaceId, mode: "focused-surface", summary: "Conditional Booking Offer", conventionalRoute: conventionalConditionalOfferRoute(offerId), textFallback: `Conditional Booking Offer for ${offerArtifact.facts.unitTitle}. Amount Due Now: ${formatNgnKobo(offerArtifact.facts.totalAmountDueNowKobo)}. Payment deadline: ${formatWAT(offerArtifact.facts.paymentWindowExpiresAt)}.`, a2uiMessages: conditionalOfferArtifactToA2UI({ artifact: offerArtifact, surfaceId }) }] };
    }
    if (["declined", "expired", "delivery_failed"].includes(artifact.facts.status)) {
      this.#supersede(thread, REQUEST_STAGE);
      return { ok: true, messages: [artifact.facts.status === "declined" ? "The Operator declined the request. No Reservation was created and no payment was taken." : artifact.facts.status === "expired" ? "The Booking Request expired. Inventory is no longer reserved and no Reservation exists." : "The Booking Request could not be delivered successfully. Nothing remains reserved; this was not an Operator decline."], surfaces: [{ ...this.#requestSurface(thread, thread.requestId), mode: "inline-surface", summary: "Request outcome", status: "fallback" }] };
    }
    return { ok: true, messages: [], surfaces: [this.#requestSurface(thread, thread.requestId)] };
  }

  #handleOfferAccept(thread: GuestThreadState, event: GuestEventPayload): GuestTurnResult {
    if (!thread.offerId) {
      return { ok: false, code: "INVALID_ARTIFACT", message: "No offer is active for this conversation." };
    }
    const resolved = resolveConditionalOfferServerEvent({
      event: this.#handoff(event),
      application: this.#environment.conditionalOfferApp,
      principal: this.#environment.guestPrincipal(),
    });
    if (!resolved.ok) {
      return { ok: false, code: resolved.code, message: resolved.message };
    }

    const offerId = thread.offerId;
    const paymentSurfaceId = `thread-${thread.threadId}:payment:ready:${offerId}`;
    this.#supersede(thread, OFFER_STAGE);
    thread.activeSurfaces.set(PAYMENT_STAGE, paymentSurfaceId);

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
    const resolved = resolveCardPaymentServerEvent({
      event: this.#handoff(event),
      application: environment.cardPaymentApp,
      principal: environment.guestPrincipal(),
    });
    if (!resolved.ok) {
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
    return { ok: true, messages: ["Secure checkout is ready. Payment credentials stay on the PSP-hosted page; return here for backend verification."], surfaces: [{ surfaceId, mode: "focused-surface", summary: "Payment handoff", conventionalRoute: conventionalCardPaymentRoute(thread.offerId), textFallback: `Payment status: ${artifact.facts.status}. Amount Due Now: ${formatNgnKobo(artifact.facts.amountDueNowKobo)}. Payment deadline: ${formatWAT(artifact.facts.paymentWindowExpiresAt)}. Continue at the secure PSP checkout: ${session.checkoutUrl}`, a2uiMessages: cardPaymentArtifactToA2UI({ artifact, surfaceId }) }] };
  }

  #handlePaymentReturn(thread: GuestThreadState, event: GuestEventPayload): GuestTurnResult {
    if (!thread.offerId || event.context?.artifactId !== `card-payment:${thread.offerId}` || event.context?.offerId !== thread.offerId) return { ok: false, code: "STALE_SURFACE", message: "That payment handoff is no longer current." };
    const environment = this.#environment;
    const current = environment.cardPaymentApp.getArtifact(thread.offerId, environment.guestPrincipal());
    if (current.facts.status !== "checkout_initiated" || event.context?.projectionVersion !== current.projectionVersion) return { ok: false, code: "STALE_SURFACE", message: "That payment handoff is no longer current." };
    const session = environment.cardPaymentApp.manager.getCheckoutSession(thread.offerId);
    if (!session) return { ok: false, code: "INVALID_ARTIFACT", message: "No active payment attempt was found." };
    try {
      const outcome = environment.cardPaymentApp.verifyAndConfirm(session.pspReference, environment.systemPrincipal());
      if (outcome.outcome === "deposit_required") {
        const artifact = environment.cardPaymentApp.getArtifact(thread.offerId, environment.guestPrincipal());
        const surfaceId = `thread-${thread.threadId}:payment:deposit-ready:${thread.offerId}`;
        this.#supersede(thread, PAYMENT_STAGE);
        thread.activeSurfaces.set(PAYMENT_STAGE, surfaceId);
        return { ok: true, messages: ["Payment verified for the stay. A separate Refundable Security Deposit payment is required before a Reservation can exist."], surfaces: [this.#paymentSurface(thread, artifact, "Refundable Security Deposit payment required", surfaceId)] };
      }
      environment.contractRepository.recordConfirmedOutcome(outcome.reservation, outcome.bookingContract);
      const contractArtifact = environment.contractApp.getArtifact(outcome.bookingContract.contractId, environment.guestPrincipal());
      const bookingSurfaceId = `thread-${thread.threadId}:booking:${outcome.bookingContract.contractId}`;
      this.#supersede(thread, PAYMENT_STAGE);
      thread.activeSurfaces.set(BOOKING_STAGE, bookingSurfaceId);
      return { ok: true, messages: ["Payment verified and the Reservation was committed. Your stay is confirmed."], surfaces: [{ surfaceId: bookingSurfaceId, mode: "focused-surface", summary: "Reservation confirmed", conventionalRoute: conventionalBookingContractRoute(outcome.bookingContract.contractId), textFallback: `Reservation confirmed for ${contractArtifact.facts.checkIn} to ${contractArtifact.facts.checkOut}. Reservation reference: ${contractArtifact.facts.reservationId}.`, a2uiMessages: bookingContractArtifactToA2UI({ artifact: contractArtifact, surfaceId: bookingSurfaceId }) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Payment verification did not complete.";
      const artifact = environment.cardPaymentApp.getArtifact(thread.offerId, environment.guestPrincipal());
      const surfaceId = `thread-${thread.threadId}:payment:result:${Date.now()}`;
      this.#supersede(thread, PAYMENT_STAGE);
      thread.activeSurfaces.set(PAYMENT_STAGE, surfaceId);
      if (/processing|grace/i.test(message)) return { ok: true, messages: ["Payment is still processing. It has not succeeded and no Reservation exists yet."], surfaces: [this.#paymentSurface(thread, artifact, "Payment processing", surfaceId)] };
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

export function renderGuestShellHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Shortlet Concierge</title>
  <style>
    :root {
      --bg: #f5f5f0; --surface: #fff; --surface-soft: #ecece5;
      --border: #d8d8cf; --text: #1c2520; --text-muted: #5e6a63;
      --accent: #0c6b4f; --accent-hover: #09563f; --user-bubble: #145f4a;
      --focus: #b45f06; --danger: #a83232;
    }
    * { box-sizing: border-box; }
    html { background: var(--bg); }
    body { background: var(--bg); color: var(--text); font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; line-height: 1.5; }
    button, input { font: inherit; }
    button, a { -webkit-tap-highlight-color: transparent; }
    :focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; }
    .skip-link { position: absolute; left: 8px; top: -100px; z-index: 30; background: var(--surface); color: var(--text); padding: 10px 14px; border: 2px solid var(--focus); border-radius: 8px; }
    .skip-link:focus { top: 8px; }
    .app { width: 100%; max-width: 760px; min-height: 100dvh; margin: 0 auto; display: flex; flex-direction: column; }
    header {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: max(14px, env(safe-area-inset-top)) 20px 14px;
      border-bottom: 1px solid var(--border); background: color-mix(in srgb, var(--surface) 94%, transparent);
      position: sticky; top: 0; z-index: 10; backdrop-filter: blur(12px);
    }
    header h1 { font-size: 18px; letter-spacing: -0.02em; margin: 0; font-weight: 750; }
    .header-note { color: var(--text-muted); font-size: 12px; white-space: nowrap; }
    main { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    #transcript { flex: 1; min-height: 35dvh; padding: 24px 20px 12px; display: flex; flex-direction: column; gap: 14px; overflow: auto; overscroll-behavior: contain; }
    .turn { display: flex; flex-direction: column; gap: 4px; }
    .turn.user { align-items: flex-end; }
    .bubble { max-width: min(88%, 620px); padding: 11px 14px; border-radius: 16px; font-size: 16px; white-space: pre-wrap; overflow-wrap: anywhere; }
    .turn.assistant .bubble { background: var(--surface); border: 1px solid var(--border); border-top-left-radius: 5px; }
    .turn.user .bubble { background: var(--user-bubble); color: #fff; border-top-right-radius: 5px; }
    .historical-summary { width: 100%; color: var(--text-muted); font-size: 13px; padding: 9px 12px; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
    #workspace-region { padding: 0 20px 14px; }
    #active-workspace { background: var(--surface); border: 1px solid var(--border); border-radius: 18px; padding: 16px; box-shadow: 0 8px 24px rgba(20, 40, 30, 0.07); }
    #active-workspace[data-mode="focused-surface"] { min-height: min(68dvh, 680px); }
    .workspace-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 8px; }
    .workspace-heading-text { min-width: 0; display: grid; gap: 2px; }
    .workspace-heading-text strong { font-size: 17px; overflow-wrap: anywhere; }
    .eyebrow { color: var(--accent); font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .workspace-close, #workspace-reopen { min-height: 44px; padding: 9px 12px; border: 1px solid var(--border); border-radius: 10px; color: var(--text); background: var(--surface-soft); cursor: pointer; }
    .workspace-close:hover, #workspace-reopen:hover { border-color: var(--accent); }
    .workspace-status { margin: 0 0 12px; color: var(--text-muted); font-size: 13px; }
    .status-stale, .status-expired, .status-deleted, .status-fallback { color: var(--danger); }
    .weaver-mount { min-width: 0; overflow-x: auto; }
    .surface-fallback { border-left: 4px solid var(--focus); padding: 4px 0 4px 12px; }
    .surface-fallback p { margin: 0 0 10px; }
    .fallback-link { color: var(--accent); font-weight: 700; }
    #workspace-reopen { margin: 0 20px 14px; width: calc(100% - 40px); text-align: left; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
    form#composer { display: flex; align-items: flex-end; gap: 10px; padding: 12px 20px max(16px, env(safe-area-inset-bottom)); border-top: 1px solid var(--border); background: var(--surface); position: sticky; bottom: 0; z-index: 10; }
    #composer-input { min-width: 0; flex: 1; min-height: 48px; padding: 11px 14px; border: 1px solid var(--border); border-radius: 12px; font-size: 16px; background: var(--bg); color: var(--text); }
    #composer-submit { min-height: 48px; min-width: 70px; padding: 10px 16px; border: 0; border-radius: 12px; background: var(--accent); color: #fff; font-weight: 750; cursor: pointer; }
    #composer-submit:hover { background: var(--accent-hover); }
    #composer-submit:disabled, #composer-input:disabled { cursor: wait; opacity: .65; }
    @media (min-width: 700px) { #transcript { padding-left: 32px; padding-right: 32px; } #workspace-region { padding-left: 32px; padding-right: 32px; } form#composer { padding-left: 32px; padding-right: 32px; } }
    @media (max-width: 420px) { header { padding-left: 14px; padding-right: 14px; } .header-note { display: none; } #transcript { padding: 18px 14px 10px; } #workspace-region { padding-left: 14px; padding-right: 14px; } #active-workspace { padding: 13px; border-radius: 15px; } form#composer { padding-left: 14px; padding-right: 14px; } #workspace-reopen { margin-left: 14px; width: calc(100% - 28px); margin-right: 14px; } .bubble { max-width: 94%; } }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; } }
  </style>
</head>
<body>
  <a class="skip-link" href="#composer-input">Skip to message composer</a>
  <div class="app">
    <header>
      <h1>Shortlet Concierge</h1>
      <span class="header-note">Local demo · A clearer way to find your stay</span>
    </header>
    <main>
      <section id="transcript" aria-label="Conversation history"></section>
      <section id="workspace-region" aria-label="Current workspace" hidden>
        <div id="active-workspace" hidden></div>
      </section>
      <button id="workspace-reopen" type="button" hidden></button>
    </main>
    <div id="announcer" class="sr-only" role="status" aria-live="polite"></div>
    <form id="composer" aria-label="Message the concierge">
      <input id="composer-input" type="text" autocomplete="off"
             placeholder="Where would you like to stay?" aria-label="Message the concierge" />
      <button id="composer-submit" type="submit">Send</button>
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

function issueGuestSession(res: ServerResponse): string {
  const sessionId = `gs-${crypto.randomUUID()}`;
  res.setHeader("Set-Cookie", `${GUEST_SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Lax; Path=/`);
  return sessionId;
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
): BrowserSession | null {
  if (sessionId === null || typeof sessionId !== "string") return null;
  const sessionKey = hashSessionSecret(sessionId);
  const cached = cache.get(sessionKey);
  if (cached) {
    if (cached.principalId !== env.config.guestId || cached.tenantId !== env.config.tenantId) return null;
    return cached;
  }
  const binding = env.interactionStore.findSessionBinding(sessionKey);
  if (!binding) return null;
  if (binding.principalId !== env.config.guestId || binding.tenantId !== env.config.tenantId) return null;
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
): boolean {
  const sessionId = readGuestSession(req);
  if (sessionId === null) return false;
  if (sessionId === undefined) {
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
  const session = resolveBrowserSession(env, cache, sessionId);
  if (!session) return false;
  session.threadIds.add(threadId);
  // The thread row is owned by the principal/tenant (ADR-0070); persisting it
  // makes the thread re-derivable after a restart by the same session binding.
  const record = env.interactionStore.findThread(threadId);
  if (record) {
    env.interactionStore.saveThread({
      threadId,
      principalId: session.principalId,
      tenantId: session.tenantId,
      threadJson: record.threadJson,
    });
  }
  return true;
}

function registerBrowserSession(
  env: LocalGuestEnvironment,
  cache: Map<string, BrowserSession>,
  sessionId: string,
): BrowserSession {
  const principal = env.guestPrincipal();
  const sessionKey = hashSessionSecret(sessionId);
  const session: BrowserSession = {
    sessionKey,
    principalId: principal.id,
    tenantId: env.config.tenantId,
    threadIds: new Set(),
  };
  cache.set(sessionKey, session);
  // Persist the binding (hash only, never the raw secret) so a restarted
  // application instance can re-authenticate the same browser session.
  env.interactionStore.saveSessionBinding({
    sessionId: sessionKey,
    sessionSecretHash: sessionKey,
    principalId: principal.id,
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
} = {}): LocalGuestServerHandle {
  const port = options.port ?? LOCAL_GUEST_PORT;
  const rawMode = options.conciergeMode ?? process.env.CONCIERGE_MODE;
  const mode: "deterministic" | "gemini" | "assistant-offline" =
    rawMode === "gemini"
      ? "gemini"
      : rawMode === "assistant-offline"
        ? "assistant-offline"
        : "deterministic";

  const env = options.environment ?? new LocalGuestEnvironment();

  let assistantRuntime: AssistantRuntime | undefined;
  let geminiClient: GeminiConciergeClient | undefined;

  if (mode === "assistant-offline") {
    const modelClient = options.modelClient ?? new ScriptedAssistantModel();
    assistantRuntime = new AssistantRuntime(env, modelClient);
  } else if (mode === "gemini") {
    if (options.modelClient) {
      assistantRuntime = new AssistantRuntime(env, options.modelClient);
    } else {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("CONCIERGE_MODE=gemini requires GEMINI_API_KEY");
      }
      const client = new GeminiInteractionsClient({ apiKey });
      assistantRuntime = new AssistantRuntime(env, client);
    }
  }

  const app = new LocalGuestApp(env, { geminiClient, assistantRuntime });
  const browserSessions = new Map<string, BrowserSession>();
  const clientScriptPath = options.clientScriptPath
    ?? join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "client.js");

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (req.method === "GET" && url.pathname === "/") {
      const rawSession = readGuestSession(req);
      if (rawSession === null) {
        // A malformed session cookie is rejected, never silently replaced.
        res.writeHead(401, { "Content-Type": "text/plain" });
        res.end("Unauthorized");
        return;
      }
      if (rawSession !== undefined) {
        // A well-formed cookie must resolve to a durable binding; an unknown
        // id is rejected rather than silently minted into a new session.
        const resolved = resolveBrowserSession(app.environment, browserSessions, rawSession);
        if (!resolved) {
          res.writeHead(401, { "Content-Type": "text/plain" });
          res.end("Unauthorized");
          return;
        }
      } else {
        registerBrowserSession(app.environment, browserSessions, issueGuestSession(res));
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderGuestShellHtml());
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

    if (req.method === "POST" && (url.pathname === "/api/turn" || url.pathname === "/api/event" || url.pathname === "/api/reset")) {
      try {
        const body = await readJsonBody(req);
        if (url.pathname === "/api/reset") {
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
        if (!bindBrowserThread(app.environment, browserSessions, req, threadId)) {
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
        sendJson(res, 200, app.handleEvent(threadId, body));
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
    app,
    get environment() {
      return app.environment;
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
        app.environment.close();
        // Fetch clients may leave keep-alive sockets open after a response;
        // close them before waiting for the server callback so test and CLI
        // shutdowns are deterministic.
        server.closeIdleConnections?.();
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
