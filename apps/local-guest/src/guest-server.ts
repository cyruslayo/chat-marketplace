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
  BACK_TO_RESULTS_EVENT,
  SEE_ALL_DISCOVERY_EVENT,
  COMPARE_UNIT_EVENT,
  COMPARE_BACK_EVENT,
  compareArtifactToA2UI,
  compareFallbackText,
  formatNgnKobo,
  formatBookingDeadline,
  formatStayDates,
  guestRequestStatus,
  guestPaymentStatus,
  GUEST_GLOSSARY,
  GUEST_JOURNEY,
  GUEST_RECEIPTS,
  guestWaitingCopy,
  type GuestWaitingKind,
  type GuestCommittedWorkKind,
  guestNewConversationCopy,
  GUEST_NEW_CONVERSATION,
  accommodationProviderLine,
  guestOperatorName,
  guestReservationStatus,
  guestAmenityLabel,
  discoveryFallbackMessage,
  type DiscoveryArtifactProjection,
} from "../../../apps/web-agent/src/index.js";
import { unitDetailArtifactFromProjection } from "../../../apps/web/src/unit-detail-artifact.js";
import { errorPage, escapeHtml, icon, pageShell, prefersHtml } from "../../../apps/web/src/ui-kit.js";
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
  getConventionalBookingContractView,
  getConventionalBookingRequestView,
  getConventionalConditionalOfferView,
} from "../../../apps/web/src/presentation.js";
import { resolveConditionalOfferServerEvent } from "../../../apps/web/src/conditional-offer-actions.js";
import { CARD_PAYMENT_INITIALIZE_CHECKOUT_EVENT, resolveCardPaymentServerEvent } from "../../../apps/web/src/card-payment-actions.js";
import { createStayQuote, isEligibleUnit, normalizePhotoUrls, type Unit } from "../../../domains/shortlet/src/index.js";
import { requestDraftArtifactFromProjection, requestDraftArtifactId } from "../../../apps/web/src/request-draft-artifact.js";
import type { RequestDraftArtifact } from "../../../apps/web/src/request-draft-artifact.js";
import type { ConditionalOfferArtifact } from "../../../apps/web/src/conditional-offer-artifact.js";
import type { BookingContractArtifact } from "../../../apps/web/src/booking-contract-artifact.js";
import type { CardPaymentApplication } from "../../../apps/web/src/card-payment-application.js";
import {
  LocalGuestEnvironment,
  LOCAL_GUEST_PORT,
  resetLocalGuestFixture,
} from "./fixture.js";
import { projectJourney, type GuestJourney } from "./journey-rail.js";
import {
  parseGuestProjection,
  type GuestPersistentProjection,
} from "./guest-projection.js";
import { hashSessionSecret } from "../../../domains/shortlet/src/index.js";
import { DirectPaystackClient, isApprovedPaystackCheckoutUrl, loadPaystackConfiguration, type PaystackClient } from "../../../domains/shortlet/src/index.js";
import { applyCriteriaEdit, budgetLabel, quickRepliesFor, searchAreaFor, SEARCH_AREAS, type CriteriaEdit } from "./concierge.js";
import { amenityQuestions, extractStayRequestFacts, formatGuestDay, mergeStayRequestContext, resolveStayRequestContext, stayChangeRequested, unsupportedPreferenceNote, type DiscoverySearchContext, type StayRequestFilters } from "./concierge.js";
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
  readonly conventionalRouteLabel?: string;
  /** Issue 10: present only while the Guest waits on a server-owned deadline. */
  readonly waiting?: GuestWaitingState;
}

/**
 * Issue 10 / ADR-0079: the browser counts down from `serverNow` to
 * `deadlineAt`, both from the server, and never owns the deadline itself.
 */
export interface GuestWaitingState {
  readonly kind: GuestWaitingKind;
  readonly heading: string;
  readonly deadlineAt: string;
  /** The absolute WAT deadline (ADR-0078), shown alongside the countdown. */
  readonly deadlineText: string;
  readonly serverNow: string;
  readonly outcomes: readonly string[];
  readonly meanwhile: readonly string[];
}

export interface GuestTimelineEntry {
  /** "receipt" entries are completed-action markers, never assistant turns (issue 07). */
  readonly role: "assistant" | "user" | "receipt";
  readonly text: string;
}

export interface GuestStateSnapshot {
  readonly ok: true;
  readonly threadId: string;
  readonly timeline: readonly GuestTimelineEntry[];
  readonly surfaces: readonly GuestSurfacePayload[];
  /** Issue 08: the journey rail, derived from authoritative state on every read. */
  readonly journey?: GuestJourney;
  readonly criteria?: GuestCriteria;
}

export interface GuestTurnSuccess {
  readonly ok: true;
  readonly messages: readonly string[];
  /** Completed-action receipts, rendered as quiet timeline markers. */
  readonly receipts?: readonly string[];
  readonly surfaces: readonly GuestSurfacePayload[];
  readonly journey?: GuestJourney;
  readonly criteria?: GuestCriteria;
  /** Issue 11 AC3: one-tap answers to the criterion the reply just asked for. */
  readonly quickReplies?: readonly string[];
}

/**
 * Issue 03a: the server's current search criteria for the strip (ADR-0004).
 * `key` fingerprints them; an edit based on other criteria fails closed.
 */
export interface GuestCriteria {
  readonly key: string;
  readonly editable: boolean;
  readonly canUndo: boolean;
  readonly where?: { readonly area?: string; readonly label: string };
  readonly when?: { readonly checkIn?: string; readonly nights?: number; readonly label: string };
  readonly guests?: { readonly count: number; readonly label: string };
  /** Issue 03b: always an All-In Stay Total comparison; "About" until it can be quoted. */
  readonly budget?: { readonly naira: number; readonly per: "stay" | "night"; readonly label: string };
  readonly areas: readonly { readonly id: string; readonly label: string }[];
}

export interface GuestRejection {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
}

export type GuestTurnResult = GuestTurnSuccess | GuestRejection;

/** Issue 06b: the booking records that have an owner-checked conventional page (ADR-0080). */
export type ConventionalBookingPageKind = "draft" | "request" | "offer" | "contract";

/** Issue 13a: a live request, offer or Reservation in one of the Guest's threads. */
export interface GuestCommittedWork {
  readonly kind: GuestCommittedWorkKind;
  readonly threadId: string;
  readonly route: string;
  readonly unitTitle?: string;
}

export interface ConventionalBookingPage {
  readonly threadId: string;
  readonly summary: string;
  readonly textFallback: string;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Fails closed unless the record's Primary Guest and tenant are the principal's (ADR-0070). */
function primaryGuestIs(record: unknown, principal: CommandPrincipal): boolean {
  if (!isPlainRecord(record) || !isPlainRecord(record.primaryGuest)) return false;
  const guestId = record.primaryGuest.id;
  return typeof guestId === "string" && !!principal.id && guestId === principal.id
    && typeof record.tenantId === "string" && !!principal.tenantId && record.tenantId === principal.tenantId;
}

const DISCOVERY_STAGE = "discovery";
const UNIT_STAGE = "unit";
const REQUEST_STAGE = "request";
const OFFER_STAGE = "offer";
const PAYMENT_STAGE = "payment";
const BOOKING_STAGE = "booking";
/** Issue 13b: the two-up comparison opened from results. */
const COMPARE_STAGE = "compare";

function unitDetailSurfaceId(threadId: string, discoveryRevision: number): string {
  // ADR-0074: a newly selected detail is a new surface lifecycle; Weaver rejects duplicate createSurface IDs.
  return `thread-${threadId}:unit:detail:${discoveryRevision}`;
}
const GUEST_PHONE_SUBMIT_EVENT = "shortlet.guest-contact.submit-phone";
const GUEST_EMAIL_SUBMIT_EVENT = "shortlet.guest-contact.submit-email";

const PENDING_ACTION_STAGE = "pending_action";
/** Issue 03a: the criteria strip is shell chrome with one server-known id per thread. */
const CRITERIA_STAGE = "criteria";
export const CRITERIA_EDIT_EVENT = "shortlet.criteria.edit";
export const CRITERIA_UNDO_EVENT = "shortlet.criteria.undo";
const MAX_SEARCH_HISTORY = 11;

export function criteriaSurfaceId(threadId: string): string {
  return `thread-${threadId}:criteria`;
}

function criteriaKey(context: DiscoverySearchContext | null): string {
  return JSON.stringify([context?.city ?? null, context?.neighbourhood ?? null, context?.checkIn ?? null, context?.nights ?? null,
    context?.datesConfirmed ?? null, context?.partySize ?? null, context?.bedrooms ?? null, context?.pendingLocationChange?.label ?? null,
    context?.budget?.kobo ?? null, context?.budget?.per ?? null]);
}

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** An input sanity bound (safe kobo arithmetic), not a pricing policy. */
const MAX_BUDGET_NAIRA = 1_000_000_000;

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

/** Reads one strip edit; anything but the exact expected shape fails closed (ADR-0072). */
function readCriteriaEdit(context: Readonly<Record<string, unknown>>): CriteriaEdit | null {
  const keys = Object.keys(context).sort().join(",");
  if (context.field === "where" && keys === "area,basedOn,field" && typeof context.area === "string") return { field: "where", area: context.area };
  if (context.field === "when" && keys === "basedOn,checkIn,field,nights" && typeof context.checkIn === "string" && CALENDAR_DATE.test(context.checkIn)
    && !Number.isNaN(Date.parse(`${context.checkIn}T00:00:00Z`)) && new Date(`${context.checkIn}T00:00:00Z`).toISOString().startsWith(context.checkIn) && isPositiveInteger(context.nights)) {
    return { field: "when", checkIn: context.checkIn, nights: context.nights };
  }
  if (context.field === "guests" && keys === "basedOn,field,partySize" && isPositiveInteger(context.partySize)) return { field: "guests", partySize: context.partySize };
  // Issue 03b: a whole-naira budget, for the stay or per night; `clear` removes it.
  if (context.field === "budget" && keys === "basedOn,field,naira,per" && isPositiveInteger(context.naira) && context.naira <= MAX_BUDGET_NAIRA
    && (context.per === "stay" || context.per === "night")) {
    return { field: "budget", budget: { kobo: context.naira * 100, per: context.per } };
  }
  if (context.field === "budget" && keys === "basedOn,clear,field" && context.clear === true) return { field: "budget", budget: null };
  return null;
}
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
  [COMPARE_UNIT_EVENT]: DISCOVERY_STAGE,
  [COMPARE_BACK_EVENT]: COMPARE_STAGE,
  [REQUEST_TO_BOOK_EVENT]: UNIT_STAGE,
  [BACK_TO_RESULTS_EVENT]: UNIT_STAGE,
  "shortlet.conditional-offer.accept": OFFER_STAGE,
  "shortlet.card-payment.initialize-checkout": PAYMENT_STAGE,
  "shortlet.card-payment.verify-return": PAYMENT_STAGE,
  [REQUEST_DRAFT_REVIEW_EVENT]: REQUEST_STAGE,
  [REQUEST_DRAFT_SUBMIT_EVENT]: REQUEST_STAGE,
  [GUEST_PHONE_SUBMIT_EVENT]: REQUEST_STAGE,
  [GUEST_EMAIL_SUBMIT_EVENT]: PAYMENT_STAGE,
  [CRITERIA_EDIT_EVENT]: CRITERIA_STAGE,
  [CRITERIA_UNDO_EVENT]: CRITERIA_STAGE,
  [ASSISTANT_CONFIRM_ACTION_EVENT]: PENDING_ACTION_STAGE,
  [ASSISTANT_CANCEL_ACTION_EVENT]: PENDING_ACTION_STAGE,
});

const THREAD_ID_PATTERN = /^g-[a-f0-9-]{6,64}$/;

/** Where the Guest is in the journey, for stage-aware free-text replies (issue 04a). */
type GuestStage = "discovery" | "unit" | "draft" | "request" | "offer" | "payment" | "booking";

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
  /** Issue 03a: the criteria of each executed search, oldest first (for "Undo last change"). */
  searchHistory: DiscoverySearchContext[];
  /** Issue 13b: the result picked for comparison. Presentation only, never persisted. */
  compareSelection: string | null;
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
    return this.#withJourney(threadId, decorated);
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
    // Issue 04a AC1: every message gets a reply for the stage the Guest is in,
    // including when a refresh re-presents the current surface.
    const stageReply = this.#stageReply(thread, text);
    if (refreshed) {
      if (!refreshed.ok) return refreshed;
      const messages = [...refreshed.messages, ...(stageReply ?? [])];
      return { ...refreshed, messages: messages.length > 0 ? messages : [this.#capabilityReply(this.#guestStage(thread), this.#currentUnit(thread))] };
    }
    if (stageReply) return { ok: true, messages: stageReply, surfaces: [] };
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
    // Issue 01: dates resolve against the injected clock and are never assumed.
    const facts = extractStayRequestFacts(text, { now: this.#environment.clock() });
    const merged = mergeStayRequestContext(previousContext, facts, text);
    thread.discoveryContext = merged.context;
    // Issue 02 AC3: an unfilterable preference is acknowledged on every reply.
    const note = unsupportedPreferenceNote(facts.unsupportedPreferences);
    const acknowledged = (result: GuestTurnResult): GuestTurnResult => note !== undefined && result.ok ? { ...result, messages: [...result.messages, note] } : result;
    if (merged.conflict) {
      // A location conflict is intentionally surfaced. No search runs until the
      // Guest resolves it, and every other accumulated constraint is retained.
      return acknowledged({ ok: true, messages: [merged.conflict.question], surfaces: [] });
    }
    const resolution = resolveStayRequestContext(merged.context, { now: this.#environment.clock() });
    if (resolution.kind !== "search") {
      // Clarifications, date confirmations and limit refusals never run a search.
      return acknowledged({ ok: true, messages: [resolution.reply], surfaces: [], ...(resolution.kind === "clarify" ? { quickReplies: quickRepliesFor(resolution.next) } : {}) });
    }

    const providedFacts = Object.keys(facts).some((key) => key !== "unsupportedPreferences") || merged.confirmedDates === true;
    const resolvedConflict = previousContext?.pendingLocationChange !== undefined && merged.context.pendingLocationChange === undefined;
    if (!providedFacts && !resolvedConflict && thread.discoveryArtifact) {
      // An unrelated turn must not replace the current authoritative results.
      return acknowledged({ ok: true, messages: ["Your current search results are still active. Tell me how you would like to refine them, for example: “Only show two-bedroom apartments”."], surfaces: [] });
    }

    return acknowledged(this.#executeDiscovery(thread, resolution.filters));
  }

  #guestStage(thread: GuestThreadState): GuestStage {
    if (thread.activeSurfaces.has(BOOKING_STAGE)) return "booking";
    if (thread.activeSurfaces.has(PAYMENT_STAGE)) return "payment";
    if (thread.offerId) return "offer";
    if (thread.requestId) return "request";
    if (thread.draftId) return "draft";
    if (thread.unitDetail) return "unit";
    return "discovery";
  }

  #currentUnit(thread: GuestThreadState): Unit | null {
    const unitId = thread.unitDetail?.unitId
      ?? (thread.requestId ? this.#environment.bookingRequestApp.getArtifact(thread.requestId, this.#environment.guestPrincipal()).facts.unitId : undefined);
    return unitId === undefined ? null : this.#environment.unitRepository.findById(unitId) as Unit | null;
  }

  /**
   * The deterministic reply for a free-text turn once an apartment is chosen.
   * Facility questions are answered only from `unit.amenities`; guest text is
   * untrusted and never echoed (ADR-0075). Returns null before booking starts
   * when the turn should continue as discovery.
   */
  #stageReply(thread: GuestThreadState, text: string): string[] | null {
    const stage = this.#guestStage(thread);
    const unit = this.#currentUnit(thread);
    const answers = unit === null ? [] : amenityQuestions(text).map((question) => {
      const listed = question.ids.find((id) => unit.amenities.includes(id));
      return listed === undefined
        ? `${question.label} isn't listed for ${unit.title}, so I can't confirm it.`
        : `Yes: ${unit.title} lists ${guestAmenityLabel(listed)}.`;
    });
    const facts = extractStayRequestFacts(text, { now: this.#environment.clock() });
    if (stage === "discovery" || stage === "unit" || stage === "draft") {
      // Draft changes belong to issue 14; a turn with new stay facts stays in discovery.
      const hasStayFacts = Object.keys(facts).some((key) => key !== "unsupportedPreferences");
      return answers.length > 0 && !hasStayFacts ? answers : null;
    }
    const change = stayChangeRequested(facts, text) ? [this.#changeExplanation(stage, unit)] : [];
    const replies = [...change, ...answers];
    return replies.length > 0 ? replies : [this.#capabilityReply(stage, unit)];
  }

  /** ADR-0005/0060: after submission nothing changes silently; say why or how. */
  #changeExplanation(stage: "request" | "offer" | "payment" | "booking", unit: Unit | null): string {
    const operator = guestOperatorName(unit?.operator?.name);
    if (stage === "request") return `A sent ${GUEST_GLOSSARY.bookingRequest} can't be changed while ${operator} reviews it. If ${operator} confirms, you can choose not to accept the offer at no cost and search again with new details. Nothing has been changed.`;
    if (stage === "offer") return `A ${GUEST_GLOSSARY.conditionalBookingOffer} can't be changed. You can choose not to accept it at no cost and search again with new details. Nothing has been changed.`;
    if (stage === "payment") return "An accepted offer can't be changed from this conversation. Nothing has been changed.";
    return `Changes to a confirmed ${GUEST_GLOSSARY.reservation} are made as a booking amendment, which re-checks availability and price. I can't start one from this conversation yet. Nothing has been changed.`;
  }

  #capabilityReply(stage: GuestStage, unit: Unit | null): string {
    const about = unit === null ? "" : ` I can also answer questions about ${unit.title}, such as parking or Wi-Fi.`;
    if (stage === "request") return `Your ${GUEST_GLOSSARY.bookingRequest} is with ${guestOperatorName(unit?.operator?.name)} for review; the details are in the workspace.${about}`;
    if (stage === "offer") return `Your ${GUEST_GLOSSARY.conditionalBookingOffer} is in the workspace. Review it and accept it there if it suits you.${about}`;
    if (stage === "payment") return `Your payment step is in the workspace.${about}`;
    if (stage === "booking") return `Your booking details are in the workspace.${about}`;
    return `Your current details are in the workspace.${about}`;
  }

  /**
   * Runs the authoritative discovery query for the accumulated context and
   * publishes its DiscoveryArtifact through the existing A2UI/Weaver surface.
   * The conversational layer never manufactures Units, prices or availability.
   */
  #executeDiscovery(thread: GuestThreadState, filters: StayRequestFilters, options: { readonly recordHistory?: boolean } = {}): GuestTurnResult {
    if (options.recordHistory !== false && thread.discoveryContext) {
      thread.searchHistory.push({ ...thread.discoveryContext });
      // A storage bound for the durable projection, not a Guest-facing policy.
      if (thread.searchHistory.length > MAX_SEARCH_HISTORY) thread.searchHistory.splice(0, thread.searchHistory.length - MAX_SEARCH_HISTORY);
    }
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
        `I found ${result.artifact.facts.results.length} eligible place${result.artifact.facts.results.length === 1 ? "" : "s"} in ${filters.location}${filters.maxPriceKobo === undefined ? "" : ` within your ${formatNgnKobo(filters.maxPriceKobo)} budget (${GUEST_GLOSSARY.allInStayTotal})`} for your stay from ${formatGuestDay(filters.checkIn)} to ${formatGuestDay(filters.checkOut)}. You can view the details below.`,
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
    return this.#withJourney(threadId, decorated);
  }

  async handleEventAsync(threadId: string, payload: unknown): Promise<GuestTurnResult> {
    const event = readEventPayload(payload);
    if (this.#environment.config.paystackClient && event?.name === "shortlet.card-payment.initialize-checkout") {
      const result = await this.#handlePaystackCardCheckout(threadId, event);
      const decorated = this.#decorateResult(result);
      if (decorated.ok) this.#rememberResult(threadId, undefined, decorated);
      return this.#withJourney(threadId, decorated);
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
      const checkoutAmount = artifact.facts.currentComponentAmountKobo ?? artifact.facts.allInStayTotalKobo ?? artifact.facts.amountDueNowKobo;
      const checkoutPurpose = artifact.facts.currentComponent === "security_deposit" ? GUEST_GLOSSARY.refundableSecurityDeposit : "stay payment";
      return { ok: true, messages: ["Hosted card checkout is ready. Payment has not succeeded; your booking details remain available when you return."], surfaces: [{ surfaceId, mode: "focused-surface", summary: "Payment handoff", conventionalRoute: `/payments/offers/${encodeURIComponent(thread.offerId!)}/continue`, conventionalRouteLabel: `Continue to ${checkoutPurpose} · ${formatNgnKobo(checkoutAmount)}`, textFallback: `You will leave Shortlet temporarily for hosted card checkout. ${artifact.facts.allInStayTotalKobo === undefined ? "" : `${GUEST_GLOSSARY.allInStayTotal}: ${formatNgnKobo(artifact.facts.allInStayTotalKobo)}. `}${artifact.facts.refundableSecurityDepositKobo ? `${GUEST_GLOSSARY.refundableSecurityDeposit} (separate): ${formatNgnKobo(artifact.facts.refundableSecurityDepositKobo)}. ` : ""}Next payment: ${formatNgnKobo(checkoutAmount)}. ${formatWAT(artifact.facts.paymentWindowExpiresAt)}. Payment has not succeeded and the booking is not confirmed. Your booking details will be retained when you return.`, a2uiMessages: cardPaymentArtifactToA2UI({ artifact, surfaceId }) }] };
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
    // The strip exists once the thread has criteria; its freshness is checked by `basedOn`.
    if (stage === CRITERIA_STAGE && thread.discoveryContext) thread.activeSurfaces.set(CRITERIA_STAGE, criteriaSurfaceId(thread.threadId));
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
      case COMPARE_UNIT_EVENT:
        return this.#handleCompare(thread, event);
      case COMPARE_BACK_EVENT:
        return this.#handleCompareBack(thread, event);
      case "shortlet.discovery.view-unit":
        return this.#handleViewUnit(thread, event);
      case REQUEST_TO_BOOK_EVENT:
        return this.#handleRequestToBook(thread, event);
      case BACK_TO_RESULTS_EVENT:
        return this.#handleBackToResults(thread, event);
      case CRITERIA_EDIT_EVENT:
        return this.#handleCriteriaEdit(thread, event);
      case CRITERIA_UNDO_EVENT:
        return this.#handleCriteriaUndo(thread, event);
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

  /**
   * Issue 06b: an owner-checked conventional booking page (ADR-0080 parity).
   * Every check fails closed to null: the principal must be this runtime's
   * Guest, the record must be correlated by one of the Guest's own threads,
   * and the domain record must name the Guest (ADR-0070). Reads go through the
   * conventional view functions, never an agent-only path (ADR-0072).
   */
  conventionalBookingPage(kind: ConventionalBookingPageKind, id: string, principal: CommandPrincipal): ConventionalBookingPage | null {
    const environment = this.#environment;
    const guest = environment.guestPrincipal();
    if (principal.role !== "guest" || !principal.id || principal.id !== guest.id || !principal.tenantId || principal.tenantId !== environment.config.tenantId || id === "") return null;
    try {
      for (const record of environment.interactionStore.findThreadsForPrincipal(principal.id, principal.tenantId)) {
        let projection: GuestPersistentProjection | null = null;
        try { projection = parseGuestProjection(JSON.parse(record.threadJson) as unknown); } catch { projection = null; }
        if (!projection) continue;
        const correlated = kind === "draft" ? projection.draftId === id
          : kind === "request" ? projection.requestId === id
            : kind === "offer" ? projection.offerId === id
              : !!projection.offerId && this.#snapshotContractId(projection.offerId) === id;
        if (!correlated) continue;
        const thread = this.#threads.get(record.threadId) ?? this.#loadThread(record.threadId);
        if (!thread) return null;
        return this.#bookingPage(thread, kind, id, principal);
      }
    } catch {
      return null;
    }
    return null;
  }

  /**
   * Issue 13a: the Guest's live committed work across all of their threads,
   * so a new conversation can say it is unaffected (ADR-0079). Read-only and
   * derived from the authoritative artifacts via the journey projection; an
   * unreadable, failed or expired record is never listed. Fails closed to an
   * empty list for any principal that is not this runtime's Guest (ADR-0070).
   */
  committedWork(principal: CommandPrincipal): GuestCommittedWork[] {
    const environment = this.#environment;
    const guest = environment.guestPrincipal();
    if (principal.role !== "guest" || !principal.id || principal.id !== guest.id || !principal.tenantId || principal.tenantId !== environment.config.tenantId) return [];
    const work: GuestCommittedWork[] = [];
    try {
      for (const record of environment.interactionStore.findThreadsForPrincipal(principal.id, principal.tenantId)) {
        const loaded = this.#threads.get(record.threadId) ?? this.#loadThread(record.threadId);
        if (!loaded || (!loaded.requestId && !loaded.offerId)) continue;
        // A thread records its offer only on its next refresh, and this read
        // never issues one (ADR-0079). Judge the durable offer for a confirmed
        // request so an expired offer is never called a live request.
        const offerId = loaded.offerId ?? (loaded.requestId ? environment.interactionStore.findConditionalOfferByRequestId(loaded.requestId)?.offerId ?? null : null);
        const thread: GuestThreadState = offerId === loaded.offerId ? loaded : { ...loaded, offerId };
        const journey = this.#journeyFor(thread);
        if (journey === undefined || journey.outcome !== undefined) continue;
        const unitTitle = this.#currentUnit(thread)?.title;
        const base = { threadId: thread.threadId, ...(unitTitle === undefined ? {} : { unitTitle }) };
        if (journey.current === "confirmed" && thread.offerId) {
          const contractId = this.#snapshotContractId(thread.offerId);
          if (contractId !== null) work.push({ ...base, kind: "reservation", route: conventionalBookingContractRoute(contractId) });
        } else if ((journey.current === "offer" || journey.current === "pay") && thread.offerId) {
          work.push({ ...base, kind: "offer", route: conventionalConditionalOfferRoute(thread.offerId) });
        } else if (journey.current === "request" && thread.requestId) {
          work.push({ ...base, kind: "request", route: conventionalBookingRequestRoute(thread.requestId) });
        }
      }
    } catch {
      return [];
    }
    return work;
  }

  #snapshotContractId(offerId: string): string | null {
    const snapshot = this.#environment.interactionStore.findBookingSnapshotByOfferId(offerId);
    if (!snapshot) return null;
    const contract: unknown = JSON.parse(snapshot.contractJson);
    return isPlainRecord(contract) && typeof contract.contractId === "string" ? contract.contractId : null;
  }

  #bookingPage(thread: GuestThreadState, kind: ConventionalBookingPageKind, id: string, principal: CommandPrincipal): ConventionalBookingPage | null {
    const environment = this.#environment;
    if (kind === "draft") {
      const draft: unknown = environment.bookingRequestApp.manager.getDraft(id);
      if (!isPlainRecord(draft) || !isPlainRecord(draft.primaryGuest) || draft.primaryGuest.id !== principal.id) return null;
      // The page mirrors the view the thread is on: the draft, or its review.
      const review = thread.activeSurfaces.get(REQUEST_STAGE)?.includes(":request:review:") === true;
      return { threadId: thread.threadId, summary: review ? "Request review" : "Request Draft", textFallback: this.#draftFallback(this.#draftArtifact(thread, review ? "review" : "draft")) };
    }
    if (kind === "request") {
      getConventionalBookingRequestView(environment.bookingRequestApp, id, principal);
      if (!primaryGuestIs(environment.bookingRequestApp.manager.getRequest(id), principal)) return null;
      const surface = this.#requestSurface(thread, id);
      return { threadId: thread.threadId, summary: surface.summary ?? GUEST_GLOSSARY.bookingRequest, textFallback: surface.textFallback ?? "" };
    }
    if (kind === "offer") {
      const offer = environment.conditionalOfferApp.manager.getOffer(id);
      const payerId = offer.parties.distinctPayer?.id;
      const isParty = !!principal.id && (offer.parties.primaryGuest.id === principal.id || (!!payerId && payerId === principal.id));
      if (!isParty || !offer.tenantId || offer.tenantId !== principal.tenantId) return null;
      const { artifact } = getConventionalConditionalOfferView(environment.conditionalOfferApp, id, principal);
      return { threadId: thread.threadId, summary: artifact.facts.status === "expired" ? `${GUEST_GLOSSARY.conditionalBookingOffer} expired` : GUEST_GLOSSARY.conditionalBookingOffer, textFallback: this.#offerFallback(artifact) };
    }
    // The contract view is authorized by the domain for the contract's parties.
    getConventionalBookingContractView(environment.contractApp, id, principal);
    return { threadId: thread.threadId, summary: "Reservation confirmed", textFallback: this.#confirmedBookingFallback(this.#contractArtifact(id)) };
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
    const journey = this.#journeyFor(thread);
    const criteria = this.#criteriaFor(thread);
    return {
      ok: true,
      threadId,
      timeline: [...thread.timeline],
      surfaces: this.#withWaiting(thread, normalized.surfaces),
      ...(journey === undefined ? {} : { journey }),
      ...(criteria === undefined ? {} : { criteria }),
    };
  }

  /**
   * Adds the response-time projections (journey rail, waiting state) to a
   * result. They are derived per response and never stored with the thread.
   */
  #withJourney(threadId: string, result: GuestTurnResult): GuestTurnResult {
    if (!result.ok || this.#assistantRuntime) return result;
    const thread = this.#threads.get(threadId);
    if (!thread) return result;
    const journey = this.#journeyFor(thread);
    const criteria = this.#criteriaFor(thread);
    const surfaces = this.#withWaiting(thread, result.surfaces);
    return { ...result, surfaces, ...(journey === undefined ? {} : { journey }), ...(criteria === undefined ? {} : { criteria }) };
  }

  #withWaiting(thread: GuestThreadState, surfaces: readonly GuestSurfacePayload[]): GuestSurfacePayload[] {
    return surfaces.map((surface, index) => {
      if (index !== surfaces.length - 1) return surface;
      const waiting = this.#waitingFor(thread, surface);
      return waiting === undefined ? surface : { ...surface, waiting };
    });
  }

  /**
   * Issue 10: the waiting state for the current surface, read from the
   * authoritative artifact so the deadline is the server's (ADR-0079). Only a
   * delivered request awaiting the Operator (ADR-0041) and an open Payment
   * Window (ADR-0044) wait on a deadline; everything else has none.
   */
  #waitingFor(thread: GuestThreadState, surface: GuestSurfacePayload): GuestWaitingState | undefined {
    if (surface.status !== undefined && surface.status !== "active") return undefined;
    const environment = this.#environment;
    const guest = environment.guestPrincipal();
    const now = environment.clock();
    const open = (deadlineAt: string): boolean => new Date(deadlineAt).getTime() > now.getTime();
    const state = (kind: GuestWaitingKind, deadlineAt: string, deadlineText: string): GuestWaitingState => {
      const copy = guestWaitingCopy(kind, this.#currentUnit(thread)?.operator?.name);
      return { kind, heading: copy.heading, deadlineAt, deadlineText, serverNow: now.toISOString(), outcomes: copy.outcomes, meanwhile: copy.meanwhile };
    };
    try {
      if (thread.requestId && !thread.offerId && surface.surfaceId === `thread-${thread.threadId}:request:${thread.requestId}`) {
        const facts = environment.bookingRequestApp.getArtifact(thread.requestId, guest).facts;
        if (facts.status !== "disclosed" || !facts.delivered || !open(facts.operatorResponseDeadlineAt)) return undefined;
        return state("operator-response", facts.operatorResponseDeadlineAt, `Response due by ${formatWAT(facts.operatorResponseDeadlineAt)}`);
      }
      if (thread.offerId && surface.surfaceId === `thread-${thread.threadId}:offer:${thread.offerId}`) {
        const facts = environment.conditionalOfferApp.getArtifact(thread.offerId, guest).facts;
        if (facts.status !== "issued" || !open(facts.paymentWindowExpiresAt)) return undefined;
        return state("offer-payment-window", facts.paymentWindowExpiresAt, formatBookingDeadline(facts.paymentWindowExpiresAt));
      }
      if (thread.offerId && surface.surfaceId.includes(":payment:")) {
        const facts = environment.cardPaymentApp.getArtifact(thread.offerId, guest).facts;
        // A payment already processing may be in its grace period (ADR-0044); it has no guest countdown.
        if (!["ready", "checkout_initiated", "deposit_required"].includes(facts.status) || surface.surfaceId.includes(":payment:result:") || !open(facts.paymentWindowExpiresAt)) return undefined;
        return state("payment-window", facts.paymentWindowExpiresAt, formatBookingDeadline(facts.paymentWindowExpiresAt));
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  /**
   * Issue 08: where the Guest is on the request-to-book journey (ADR-0005).
   * Read from the authoritative artifacts on every call, so a passed deadline
   * shows as expired without waiting for a background job. Reading never
   * issues a command (ADR-0079).
   */
  #journeyFor(thread: GuestThreadState): GuestJourney | undefined {
    const environment = this.#environment;
    const guest = environment.guestPrincipal();
    try {
      if (thread.offerId) {
        // ADR-0005: "Confirmed" only once the durable Booking Contract exists.
        if (environment.interactionStore.findBookingSnapshotByOfferId(thread.offerId)) return projectJourney("confirmed");
        const offer = environment.conditionalOfferApp.getArtifact(thread.offerId, guest).facts.status;
        if (offer === "accepted" || thread.activeSurfaces.has(PAYMENT_STAGE)) {
          const payment = environment.cardPaymentApp.getArtifact(thread.offerId, guest).facts.status;
          if (payment === "expired" || payment === "failed") {
            return projectJourney("pay", { kind: payment, label: guestPaymentStatus(payment).label.split(" · ")[0]! });
          }
          return projectJourney("pay");
        }
        if (offer === "expired") return projectJourney("offer", { kind: "expired", label: "Offer expired" });
        if (offer === "stale") return projectJourney("offer", { kind: "closed", label: "Offer no longer current" });
        if (offer === "revoked") return projectJourney("offer", { kind: "closed", label: "Offer withdrawn" });
        return projectJourney("offer");
      }
      if (thread.requestId) {
        const request = environment.bookingRequestApp.getArtifact(thread.requestId, guest).facts;
        const label = guestRequestStatus(request.status, request.delivered).label;
        if (request.status === "declined") return projectJourney("request", { kind: "declined", label });
        if (request.status === "expired") return projectJourney("request", { kind: "expired", label });
        if (request.status === "delivery_failed") return projectJourney("request", { kind: "not-delivered", label });
        return projectJourney("request");
      }
    } catch {
      // An unreadable record never shows progress it cannot prove.
      return undefined;
    }
    if (thread.activeSurfaces.has(UNIT_STAGE)) return projectJourney("stay");
    // A kept draft counts only while it is the surface on screen, not after a new search.
    if (thread.draftId && this.#stageForSurfaceId(thread.lastSurfaces.at(-1)?.surfaceId ?? "") === REQUEST_STAGE) return projectJourney("request");
    if (thread.discoveryArtifact) return projectJourney("search");
    return undefined;
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
      searchHistory: thread.searchHistory.map((context) => ({ ...context })),
    };
  }

  #stageForSurfaceId(surfaceId: string): string | null {
    // Issue 13b: a comparison is restored as the results it was opened from.
    if (surfaceId.includes(":discovery:") || surfaceId.includes(":compare:")) return DISCOVERY_STAGE;
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
      searchHistory: projection.searchHistory.map((context) => ({ ...context })),
      compareSelection: null,
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
            // ADR-0080: the restored unit keeps its conventional unit route.
            conventionalRoute: projection.discoveryArtifact.actions.find((action) => action.type === "view-unit" && action.unitId === unit.id)?.conventionalRoute,
            textFallback: `${unit.title}. ${unit.location.neighbourhood}, ${unit.location.city}. Entire Place; capacity ${unit.capacity} guests.`,
            a2uiMessages: unitDetailArtifactToA2UI({
              artifact: unitDetailArtifactFromProjection({ unit, ...this.#stayDatesFor(thread), projectionVersion: projection.discoveryArtifact.projectionVersion, viewer: environment.guestPrincipal() }),
              surfaceId: unitSurfaceId,
              backToResults: { artifactId: projection.discoveryArtifact.id },
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
          textFallback: this.#offerFallback(offerArtifact),
          a2uiMessages: conditionalOfferArtifactToA2UI({ artifact: offerArtifact, surfaceId: offerSurfaceId }),
        };
      }
      if (projection.activeStage === PAYMENT_STAGE && projection.offerId) {
        const snapshot = environment.interactionStore.findBookingSnapshotByOfferId(projection.offerId);
        if (snapshot) {
          try {
            const contract = JSON.parse(snapshot.contractJson) as { readonly contractId: string };
            const bookingSurfaceId = `thread-${thread.threadId}:booking:${contract.contractId}`;
            const contractArtifact = this.#contractArtifact(contract.contractId);
            thread.activeSurfaces.delete(PAYMENT_STAGE);
            thread.activeSurfaces.set(BOOKING_STAGE, bookingSurfaceId);
            return { surfaceId: bookingSurfaceId, mode: "focused-surface", summary: "Reservation confirmed", conventionalRoute: conventionalBookingContractRoute(contract.contractId), textFallback: this.#confirmedBookingFallback(contractArtifact), a2uiMessages: bookingContractArtifactToA2UI({ artifact: contractArtifact, surfaceId: bookingSurfaceId }) };
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
            const contractArtifact = this.#contractArtifact(contract.contractId);
            thread.activeSurfaces.delete(PAYMENT_STAGE);
            thread.activeSurfaces.set(BOOKING_STAGE, bookingSurfaceId);
            return { surfaceId: bookingSurfaceId, mode: "focused-surface", summary: "Reservation confirmed", conventionalRoute: conventionalBookingContractRoute(contract.contractId), textFallback: this.#confirmedBookingFallback(contractArtifact), a2uiMessages: bookingContractArtifactToA2UI({ artifact: contractArtifact, surfaceId: bookingSurfaceId }) };
          }
        }
        if (artifact.facts.status === "expired") {
          const expiredId = `thread-${thread.threadId}:payment:expired:${projection.offerId}`;
          thread.activeSurfaces.set(PAYMENT_STAGE, expiredId);
          return { ...this.#paymentSurface(thread, artifact, "Payment Window expired", expiredId), status: "expired", textFallback: `Payment window expired. Total to complete booking: ${formatNgnKobo(artifact.facts.amountDueNowKobo)}. No Reservation exists.` };
        }
        const storedSurfaceId = projection.activeSurfaceId ?? "";
        // The stored surface id is the authoritative pointer to the exact
        // server-owned presentation (ADR-0074): processing, deposit, checkout
        // and ready surfaces must restore to the same lifecycle state.
        if (storedSurfaceId.includes(":payment:result:") || artifact.facts.journeyStage === "stay_payment_processing") {
          const processingId = storedSurfaceId.includes(":payment:result:") ? storedSurfaceId : `thread-${thread.threadId}:payment:result:${projection.offerId}`;
          thread.activeSurfaces.set(PAYMENT_STAGE, processingId);
          return this.#paymentSurface(thread, artifact, "Checking payment", processingId);
        }
        if (artifact.facts.status === "deposit_required" || storedSurfaceId.includes(":deposit-")) {
          const depositId = `thread-${thread.threadId}:payment:deposit-ready:${projection.offerId}`;
          thread.activeSurfaces.set(PAYMENT_STAGE, depositId);
          return this.#paymentSurface(thread, artifact, `${GUEST_GLOSSARY.refundableSecurityDeposit} payment required`, depositId);
        }
        const session = environment.cardPaymentApp.manager.getCheckoutSession(projection.offerId);
        if (artifact.facts.status === "checkout_initiated" || (session && session.status === "initiated")) {
          const checkoutId = session?.checkoutId ?? (storedSurfaceId.includes(":checkout:") ? storedSurfaceId.split(":checkout:").at(-1) ?? "restored" : "restored");
          const checkoutSurfaceId = `thread-${thread.threadId}:payment:checkout:${checkoutId}`;
          thread.activeSurfaces.set(PAYMENT_STAGE, checkoutSurfaceId);
          return this.#paymentSurface(thread, artifact, "Payment handoff", checkoutSurfaceId);
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
          const contractArtifact = this.#contractArtifact(contract.contractId);
          thread.activeSurfaces.set(BOOKING_STAGE, bookingSurfaceId);
          return {
            surfaceId: bookingSurfaceId,
            mode: "focused-surface",
            summary: "Reservation confirmed",
            conventionalRoute: conventionalBookingContractRoute(contract.contractId),
            textFallback: this.#confirmedBookingFallback(contractArtifact),
            a2uiMessages: bookingContractArtifactToA2UI({ artifact: contractArtifact, surfaceId: bookingSurfaceId }),
          };
        }
      }
      if (projection.activeStage === DISCOVERY_STAGE && projection.discoveryArtifact) {
        thread.activeSurfaces.set(DISCOVERY_STAGE, projection.discoverySurfaceId);
        return discoverySurface(projection.discoveryArtifact, projection.discoverySurfaceId);
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
      searchHistory: [],
      compareSelection: null,
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
    this.#supersede(thread, COMPARE_STAGE);
    thread.compareSelection = null;
    // New results end the earlier stay's inspection; replies must not keep
    // answering about an apartment that is no longer on screen.
    thread.unitDetail = null;
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
    for (const receipt of result.receipts ?? []) thread.timeline.push({ role: "receipt", text: receipt });
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
      return { ok: false, code: "ACTION_NOT_AUTHORIZED", message: `That ${GUEST_GLOSSARY.unit} is not available.` };
    }

    const unitDetailArtifact = unitDetailArtifactFromProjection({ unit, ...this.#stayDatesFor(thread), projectionVersion: artifact.projectionVersion, viewer: this.#environment.guestPrincipal() });
    thread.unitDetail = { unitId: unit.id, artifactId: unitDetailArtifact.id };
    const surfaceId = unitDetailSurfaceId(thread.threadId, thread.discoveryRevision);
    // ADR-0074: selecting a Unit supersedes the discovery projection and its
    // generated actions. "Back to results" re-presents the same artifact as a
    // new surface lifecycle (issue 08).
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
          textFallback: `${unit.title}. ${unit.location.neighbourhood}, ${unit.location.city}. Entire Place; capacity ${unit.capacity} guests. ${GUEST_GLOSSARY.allInStayTotal}: ${unit.price.allInStayTotalKobo === null ? "not yet quoted" : formatNgnKobo(unit.price.allInStayTotalKobo)}. ${GUEST_GLOSSARY.refundableSecurityDeposit}: ${formatNgnKobo(unit.price.refundableSecurityDepositKobo)}. Inspection: ${unit.trust.inspection.status}; Management Authority: ${unit.trust.managementAuthority.status}.`,
          a2uiMessages: unitDetailArtifactToA2UI({ artifact: unitDetailArtifact, surfaceId, backToResults: { artifactId: artifact.id } }),
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
      messages: [`Here are all the matching ${GUEST_GLOSSARY.units}.`],
      surfaces: [{
        surfaceId,
        mode: "focused-surface",
        summary: "All discovery results",
        conventionalRoute: conventionalSearchRoute(filters),
        textFallback: discoveryFallbackMessage(artifact),
        a2uiMessages: discoveryArtifactToA2UI({ artifact, surfaceId, compareSelection: thread.compareSelection ?? undefined }),
      }],
    };
  }

  /**
   * Issue 13b: Compare on a result. The first pick re-presents the same
   * results with that stay marked; the same stay again un-picks it; a second
   * stay opens the two-up comparison. Presentation only: no domain command
   * runs (ADR-0072). Context is checked exactly against the stored artifact.
   */
  #handleCompare(thread: GuestThreadState, event: GuestEventPayload): GuestTurnResult {
    const artifact = thread.discoveryArtifact;
    const context = event.context;
    if (!artifact || !context || typeof context !== "object" || Array.isArray(context)
      || Object.keys(context).sort().join(",") !== "artifactId,unitId" || context.artifactId !== artifact.id || typeof context.unitId !== "string") {
      return { ok: false, code: "INVALID_CONTEXT", message: "Those search results are no longer available." };
    }
    const unitId = context.unitId;
    const unit = artifact.facts.results.find((candidate) => candidate.id === unitId);
    if (!unit || artifact.facts.results.length < 2) {
      return { ok: false, code: "INVALID_CONTEXT", message: `That ${GUEST_GLOSSARY.unit} is not in these results.` };
    }
    const selected = thread.compareSelection === null ? undefined : artifact.facts.results.find((candidate) => candidate.id === thread.compareSelection);
    const surfaceId = event.surfaceId;
    const results = (message: string): GuestTurnResult => ({
      ok: true,
      messages: [message],
      surfaces: [{
        ...discoverySurface(artifact, surfaceId, thread.compareSelection ?? undefined),
        ...(surfaceId.endsWith(":discovery:focused") ? { mode: "focused-surface" as const, summary: "All discovery results" } : {}),
      }],
    });
    if (selected === undefined) {
      thread.compareSelection = unit.id;
      return results(`Choose one more stay to compare with ${unit.title}.`);
    }
    if (selected.id === unit.id) {
      thread.compareSelection = null;
      return results(`${unit.title} is no longer selected to compare.`);
    }
    thread.compareSelection = null;
    const compareSurfaceId = `thread-${thread.threadId}:compare:${thread.discoveryRevision}`;
    // ADR-0074: the comparison replaces the results; "Back to results" re-presents them.
    this.#supersede(thread, DISCOVERY_STAGE);
    this.#supersede(thread, COMPARE_STAGE);
    thread.activeSurfaces.set(COMPARE_STAGE, compareSurfaceId);
    this.#emitTransition(thread, "unit.discovery.compared", { aggregateType: "discovery", aggregateId: artifact.id, surfaceId: compareSurfaceId });
    const units = [selected, unit] as const;
    return {
      ok: true,
      messages: [`Here are ${selected.title} and ${unit.title} side by side.`],
      surfaces: [{
        surfaceId: compareSurfaceId,
        mode: "focused-surface",
        summary: "Compare stays",
        conventionalRoute: conventionalSearchRoute(artifact.facts.filters),
        textFallback: compareFallbackText(units),
        a2uiMessages: compareArtifactToA2UI({ artifact, unitIds: [selected.id, unit.id], surfaceId: compareSurfaceId }),
      }],
    };
  }

  /** Issue 13b: leave the comparison for the same results (no new search, ADR-0079). */
  #handleCompareBack(thread: GuestThreadState, event: GuestEventPayload): GuestTurnResult {
    const artifact = thread.discoveryArtifact;
    const context = event.context;
    if (!artifact || !context || typeof context !== "object" || Array.isArray(context)
      || Object.keys(context).length !== 1 || context.artifactId !== artifact.id) {
      return { ok: false, code: "INVALID_CONTEXT", message: "Those search results are no longer available." };
    }
    this.#prepareDiscovery(thread);
    thread.activeSurfaces.set(DISCOVERY_STAGE, thread.discoverySurfaceId);
    this.#emitTransition(thread, "unit.discovery.results_restored", { aggregateType: "discovery", aggregateId: artifact.id, surfaceId: thread.discoverySurfaceId });
    return { ok: true, messages: ["Here are your search results again."], surfaces: [discoverySurface(artifact, thread.discoverySurfaceId)] };
  }

  /**
   * Issue 08: from stay detail, return to the results of the same search. The
   * stored artifact is re-presented, so the criteria and results are the ones
   * the Guest saw; no new search runs (ADR-0079). Every check fails closed.
   */
  #handleBackToResults(thread: GuestThreadState, event: GuestEventPayload): GuestTurnResult {
    // AC4 / ADR-0005: going back never touches a sent Booking Request or offer.
    if (thread.requestId || thread.offerId) return { ok: false, code: "STALE_SURFACE", message: "That action is no longer available; please use the current options." };
    const artifact = thread.discoveryArtifact;
    if (!artifact) return { ok: false, code: "INVALID_ARTIFACT", message: "No search is active for this conversation." };
    const context = event.context;
    if (!context || typeof context !== "object" || Array.isArray(context)
      || Object.keys(context).length !== 1 || context.artifactId !== artifact.id) {
      return { ok: false, code: "INVALID_CONTEXT", message: "Those search results are no longer available." };
    }
    // ADR-0074: a new discovery revision, so the old unit surface's actions go stale.
    this.#prepareDiscovery(thread);
    thread.unitDetail = null;
    thread.activeSurfaces.set(DISCOVERY_STAGE, thread.discoverySurfaceId);
    this.#emitTransition(thread, "unit.discovery.results_restored", { aggregateType: "discovery", aggregateId: artifact.id, surfaceId: thread.discoverySurfaceId });
    return { ok: true, messages: ["Here are your search results again."], surfaces: [discoverySurface(artifact, thread.discoverySurfaceId)] };
  }

  /**
   * A kept Request Draft is resumed only for the same apartment, dates and
   * party. After the Guest changes the search, Request to Book starts a new
   * draft: a Request Draft blocks nothing and promises nothing (CONTEXT.md),
   * so replacing it never releases or changes anything.
   */
  #draftMatchesStay(thread: GuestThreadState, unitId: string): boolean {
    if (!thread.draftId) return false;
    try {
      const draft = this.#environment.bookingRequestApp.manager.getDraft(thread.draftId);
      const stay = this.#stayDatesFor(thread);
      return draft.unitId === unitId && draft.checkIn === stay.checkIn && draft.checkOut === stay.checkOut
        && draft.occupants.length === this.#partySizeFor(thread);
    } catch {
      return false;
    }
  }

  /** Fails closed unless the edit is based on the criteria the server holds now. */
  #criteriaGuard(thread: GuestThreadState, event: GuestEventPayload): GuestRejection | null {
    if (thread.requestId || thread.offerId) {
      // ADR-0005: a sent Booking Request is never changed by a search edit.
      const stage = this.#guestStage(thread);
      const explained = stage === "request" || stage === "offer" || stage === "payment" || stage === "booking" ? stage : "request";
      return { ok: false, code: "CRITERIA_LOCKED", message: this.#changeExplanation(explained, this.#currentUnit(thread)) };
    }
    if (!event.context || event.context.basedOn !== criteriaKey(thread.discoveryContext)) {
      return { ok: false, code: "STALE_SURFACE", message: "Your search has changed since this was opened. Check the current search and try again." };
    }
    return null;
  }

  /**
   * Issue 03a AC2/AC3: one strip edit. The server applies it to its own
   * criteria and re-runs the authoritative search (ADR-0004); an edit that
   * breaks a stay limit is refused with the limit and changes nothing.
   */
  #handleCriteriaEdit(thread: GuestThreadState, event: GuestEventPayload): GuestTurnResult {
    const guard = this.#criteriaGuard(thread, event);
    if (guard) return guard;
    const edit = readCriteriaEdit(event.context ?? {});
    const next = edit === null ? null : applyCriteriaEdit(thread.discoveryContext, edit);
    if (next === null) return { ok: false, code: "INVALID_CRITERIA", message: "That change could not be applied. Check the value and try again." };
    const resolution = resolveStayRequestContext(next, { now: this.#environment.clock() });
    if (resolution.kind === "refuse") return { ok: false, code: "CRITERIA_REJECTED", message: resolution.reply };
    thread.discoveryContext = next;
    if (resolution.kind !== "search") return { ok: true, messages: [resolution.reply], surfaces: [], ...(resolution.kind === "clarify" ? { quickReplies: quickRepliesFor(resolution.next) } : {}) };
    return this.#executeDiscovery(thread, resolution.filters);
  }

  /** Issue 03a AC4: restores the previous search's criteria and re-runs it. */
  #handleCriteriaUndo(thread: GuestThreadState, event: GuestEventPayload): GuestTurnResult {
    const guard = this.#criteriaGuard(thread, event);
    if (guard) return guard;
    if (Object.keys(event.context ?? {}).length !== 1) return { ok: false, code: "INVALID_CRITERIA", message: "That change could not be applied. Check the value and try again." };
    const previous = thread.searchHistory.at(-2);
    if (!previous) return { ok: false, code: "NOTHING_TO_UNDO", message: "There is no earlier search to go back to." };
    const resolution = resolveStayRequestContext(previous, { now: this.#environment.clock() });
    // Dates that have since passed are refused like any other edit.
    if (resolution.kind !== "search") return { ok: false, code: "CRITERIA_REJECTED", message: resolution.reply };
    thread.searchHistory.pop();
    thread.discoveryContext = { ...previous };
    const result = this.#executeDiscovery(thread, resolution.filters, { recordHistory: false });
    return result.ok ? { ...result, messages: ["I've undone your last change.", ...result.messages] } : result;
  }

  /** Issue 03a AC1: the strip mirrors the server's criteria after every response. */
  #criteriaFor(thread: GuestThreadState): GuestCriteria | undefined {
    const context = thread.discoveryContext;
    if (!context) return undefined;
    const area = searchAreaFor(context);
    const where = context.city === undefined ? undefined : {
      ...(area === undefined ? {} : { area: area.id }),
      label: area?.label ?? [context.neighbourhood, context.city].filter(Boolean).join(", "),
    };
    const nights = context.nights;
    const nightsLabel = nights === undefined ? "" : `${nights} ${nights === 1 ? "night" : "nights"}`;
    const checkOut = context.checkIn !== undefined && nights !== undefined
      ? new Date(Date.parse(`${context.checkIn}T00:00:00Z`) + nights * 86_400_000).toISOString().slice(0, 10) : undefined;
    const whenLabel = context.checkIn !== undefined && checkOut !== undefined ? `${formatStayDates(context.checkIn, checkOut)} · ${nightsLabel}`
      : context.checkIn !== undefined ? `From ${formatGuestDay(context.checkIn)}` : nightsLabel;
    const when = whenLabel === "" ? undefined : {
      ...(context.checkIn === undefined ? {} : { checkIn: context.checkIn }),
      ...(nights === undefined ? {} : { nights }),
      label: context.checkIn !== undefined && context.datesConfirmed !== true ? `${whenLabel} (to confirm)` : whenLabel,
    };
    const guests = context.partySize === undefined ? undefined : { count: context.partySize, label: `${context.partySize} ${context.partySize === 1 ? "guest" : "guests"}` };
    const budgetText = budgetLabel(context);
    const budget = context.budget === undefined || budgetText === undefined ? undefined
      : { naira: Math.round(context.budget.kobo / 100), per: context.budget.per, label: budgetText };
    if (!where && !when && !guests && !budget) return undefined;
    return {
      key: criteriaKey(context),
      editable: !thread.requestId && !thread.offerId,
      canUndo: thread.searchHistory.length >= 2 && !thread.requestId && !thread.offerId,
      ...(where ? { where } : {}), ...(when ? { when } : {}), ...(guests ? { guests } : {}), ...(budget ? { budget } : {}),
      areas: SEARCH_AREAS.map(({ id, label }) => ({ id, label })),
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

    if (thread.draftId && this.#draftMatchesStay(thread, detail.unitId)) {
      const surfaceId = `thread-${thread.threadId}:request:draft:${thread.draftId}`;
      const artifact = this.#draftArtifact(thread, "draft");
      this.#supersede(thread, UNIT_STAGE);
      thread.activeSurfaces.set(REQUEST_STAGE, surfaceId);
      this.#emitTransition(thread, "request_draft.resumed", { aggregateType: "request_draft", aggregateId: thread.draftId, surfaceId });
      return { ok: true, messages: ["Your request is ready to continue."], surfaces: [{ surfaceId, mode: "focused-surface", summary: "Request Draft", conventionalRoute: conventionalRequestDraftRoute(thread.draftId), textFallback: this.#draftFallback(artifact), a2uiMessages: requestDraftArtifactToA2UI({ artifact, surfaceId }) }] };
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
      messages: [],
      receipts: [GUEST_RECEIPTS.draftCreated],
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
    if (!unit) throw new Error(`The selected ${GUEST_GLOSSARY.unit} is no longer available.`);
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
    const review = artifact.actions[0]?.type === "submit";
    const { facts } = artifact;
    // Issue 07 AC1: one reservation-status statement; ADR-0006 provider only on review.
    return `${guestReservationStatus("draft")}. ${facts.unitTitle}. ${review ? `${accommodationProviderLine(facts.operatorName)}. ` : ""}${formatStayDates(facts.checkIn, facts.checkOut)} · ${facts.nights} ${facts.nights === 1 ? "night" : "nights"} · ${facts.occupants.length} ${facts.occupants.length === 1 ? "guest" : "guests"}. ${GUEST_GLOSSARY.allInStayTotal}: ${formatNgnKobo(facts.allInStayTotalKobo)}. ${facts.refundableSecurityDepositKobo > 0 ? `${GUEST_GLOSSARY.refundableSecurityDeposit} (separate): ${formatNgnKobo(facts.refundableSecurityDepositKobo)}. ` : ""}${review ? `Total to complete booking if confirmed: ${formatNgnKobo(facts.amountDueNowKobo)}. ${GUEST_GLOSSARY.revalidation}. ` : "Review these details before you send the request. "}Cancellation terms: ${facts.cancellationPolicy.summary}.`;
  }

  #handleDraftReview(thread: GuestThreadState, event: GuestEventPayload): GuestTurnResult {
    if (!thread.draftId || event.context?.artifactId !== requestDraftArtifactId(thread.draftId) || event.context?.draftId !== thread.draftId) {
      return { ok: false, code: "INVALID_CONTEXT", message: "That Request Draft is no longer valid." };
    }
    if (!this.#environment.guestContactApp.get(this.#environment.guestPrincipal())?.phoneNumber) {
      // ADR-0085: collect a coordination contact only; Guest identity checks remain a check-in eligibility step.
      return this.#contactSurface(thread, "phone", { ...event.context, resumeAction: "review" });
    }
    const artifact = this.#draftArtifact(thread, "review");
    const surfaceId = `thread-${thread.threadId}:request:review:${thread.draftId}`;
    this.#supersede(thread, REQUEST_STAGE);
    thread.activeSurfaces.set(REQUEST_STAGE, surfaceId);
    this.#emitTransition(thread, "request_draft.review.opened", { aggregateType: "request_draft", aggregateId: thread.draftId, surfaceId });
    return {
      ok: true,
      messages: ["Review the complete request terms."],
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
      // Issue 07: the Operator is named where known; the surface carries the reservation status.
      return { ok: true, messages: [`Next, ${guestOperatorName(currentTerms.facts.operatorName)} will confirm availability before payment is due.`], receipts: [GUEST_RECEIPTS.requestSent], surfaces: [surface] };
    } catch (error) {
      const message = error instanceof Error ? error.message : "The Booking Request could not be submitted.";
      if (/phone number is required/i.test(message)) return this.#contactSurface(thread, "phone", event.context ?? {});
      this.#emitTransition(thread, "booking_request.delivery_failed", { aggregateType: "request_draft", aggregateId: thread.draftId, reasonCode: "REQUEST_DELIVERY_FAILED" });
      return { ok: false, code: "REQUEST_NOT_SUBMITTED", message };
    }
  }

  #contactSurface(thread: GuestThreadState, kind: "phone" | "email", resumeContext: JsonObject, input: { readonly value?: string; readonly error?: string } = {}): GuestTurnResult {
    const stage = kind === "phone" ? REQUEST_STAGE : PAYMENT_STAGE;
    const surfaceId = `thread-${thread.threadId}:contact:${kind}:${crypto.randomUUID()}`;
    this.#supersede(thread, stage);
    thread.activeSurfaces.set(stage, surfaceId);
    const contact = this.#environment.guestContactApp.get(this.#environment.guestPrincipal());
    const baseLabel = kind === "phone" ? "Phone number" : "Email address";
    const saveLabel = kind === "phone" ? "Save phone number" : "Save email address";
    const eventName = kind === "phone" ? GUEST_PHONE_SUBMIT_EVENT : GUEST_EMAIL_SUBMIT_EVENT;
    const components: A2UIComponent[] = [
      { id: "root", component: "Column", children: ["contact-title", "contact-help", "contact-value", ...(input.error ? ["contact-error"] : []), "contact-save"] },
      { id: "contact-title", component: "Text", text: baseLabel, variant: "h2" },
      { id: "contact-help", component: "Text", text: kind === "phone" ? "Required to send a Booking Request. Use a Nigerian mobile number in +234 format; for example +234 801 234 5678. Phone is for booking coordination, not identity verification." : "Required to start hosted card checkout and send a payment receipt. This email is not your account identity." },
      { id: "contact-value", component: "TextField", label: baseLabel, value: { path: "/contactValue" }, accessibility: { label: baseLabel } },
      ...(input.error ? [{ id: "contact-error", component: "Text" as const, text: input.error }] : []),
      { id: "contact-save", component: "Button", child: "contact-save-label", variant: "primary", action: { event: { name: eventName, context: { ...resumeContext, contactValue: { path: "/contactValue" }, expectedRevision: contact?.revision ?? 0 } } }, accessibility: { label: saveLabel } },
      { id: "contact-save-label", component: "Text", text: saveLabel },
    ];
    const currentValue = input.value ?? (kind === "phone" ? contact?.phoneNumber : contact?.contactEmail) ?? "";
    const prompt = input.error ? "Please correct the field below." : kind === "phone" ? "Add a phone number to send your Booking Request." : "Add an email address to continue to payment.";
    return { ok: true, messages: [prompt], surfaces: [{ surfaceId, mode: "focused-surface", summary: baseLabel, conventionalRoute: `/guest/contact?kind=${kind}`, conventionalRouteLabel: kind === "phone" ? "Edit phone number" : "Edit email address", textFallback: `${baseLabel} is required. ${kind === "phone" ? "Use a Nigerian mobile number, for example +234 801 234 5678." : "It is used for checkout and your receipt."} Open Contact details to save it.`, a2uiMessages: [{ version: "v0.9.1", createSurface: { surfaceId, catalogId: A2UI_V091_BASIC_CATALOG_ID } }, { version: "v0.9.1", updateDataModel: { surfaceId, path: "/contactValue", value: currentValue } }, { version: "v0.9.1", updateComponents: { surfaceId, components } }] }] };
  }

  #handlePhoneSubmit(thread: GuestThreadState, event: GuestEventPayload): GuestTurnResult {
    const value = event.context?.contactValue;
    if (typeof value !== "string") return { ok: false, code: "INVALID_INPUT", message: "Phone number is required." };
    try { this.#environment.guestContactApp.submitPhone({ phoneNumber: value, expectedRevision: Number(event.context?.expectedRevision ?? 0) }, this.#environment.guestPrincipal()); }
    catch (error) {
      const { contactValue: _contactValue, expectedRevision: _expectedRevision, ...resumeContext } = event.context ?? {};
      return this.#contactSurface(thread, "phone", resumeContext, { value, error: error instanceof Error ? error.message : "Phone number could not be saved." });
    }
    const { contactValue: _contactValue, expectedRevision: _expectedRevision, resumeAction, ...resumeContext } = event.context ?? {};
    return resumeAction === "review"
      ? this.#handleDraftReview(thread, { ...event, name: REQUEST_DRAFT_REVIEW_EVENT, context: resumeContext })
      : this.#handleDraftSubmit(thread, { ...event, context: resumeContext });
  }

  #handleEmailSubmit(thread: GuestThreadState, event: GuestEventPayload): GuestTurnResult {
    const value = event.context?.contactValue;
    if (typeof value !== "string") return { ok: false, code: "INVALID_INPUT", message: "Email address is required." };
    try { this.#environment.guestContactApp.submitEmail({ contactEmail: value, expectedRevision: Number(event.context?.expectedRevision ?? 0) }, this.#environment.guestPrincipal()); }
    catch (error) {
      const { contactValue: _contactValue, expectedRevision: _expectedRevision, ...resumeContext } = event.context ?? {};
      return this.#contactSurface(thread, "email", resumeContext, { value, error: error instanceof Error ? error.message : "Email address could not be saved." });
    }
    // Resume the server-issued payment action after the contact application
    // commits the email. The browser-provided contact value is not a payment
    // command and cannot alter the authoritative amount or currency.
    const { contactValue: _contactValue, expectedRevision: _expectedRevision, ...paymentContext } = event.context ?? {};
    return this.#handleCardCheckout(thread, { ...event, name: CARD_PAYMENT_INITIALIZE_CHECKOUT_EVENT, context: paymentContext });
  }

  #requestSurface(thread: GuestThreadState, requestId: string): GuestSurfacePayload {
    const baseArtifact = this.#environment.bookingRequestApp.getArtifact(requestId, this.#environment.guestPrincipal());
    const unit = this.#environment.unitRepository.findById(baseArtifact.facts.unitId);
    const artifact = unit ? { ...baseArtifact, facts: { ...baseArtifact.facts, unitTitle: unit.title } } : baseArtifact;
    const status = guestRequestStatus(artifact.facts.status, artifact.facts.delivered);
    const surfaceId = `thread-${thread.threadId}:request:${requestId}`;
    return {
      surfaceId,
      mode: "focused-surface",
      summary: status.label,
      conventionalRoute: conventionalBookingRequestRoute(requestId),
      textFallback: `${status.label}. ${artifact.facts.unitTitle ?? `Your selected ${GUEST_GLOSSARY.unit}`}. Stay: ${formatStayDates(artifact.facts.checkIn, artifact.facts.checkOut)} (${artifact.facts.nights} nights). ${artifact.facts.quote ? `${GUEST_GLOSSARY.allInStayTotal}: ${formatNgnKobo(artifact.facts.quote.allInStayTotalKobo)}. ${artifact.facts.quote.refundableSecurityDepositKobo > 0 ? `${GUEST_GLOSSARY.refundableSecurityDeposit} (separate): ${formatNgnKobo(artifact.facts.quote.refundableSecurityDepositKobo)}. ` : ""}` : ""}${artifact.facts.status === "disclosed" && artifact.facts.delivered ? `Operator response deadline: ${formatWAT(artifact.facts.operatorResponseDeadlineAt)}.` : ""} ${status.detail}`,
      a2uiMessages: bookingRequestArtifactToA2UI({ artifact, surfaceId }),
    };
  }

  #contractArtifact(contractId: string): BookingContractArtifact {
    const artifact = this.#environment.contractApp.getArtifact(contractId, this.#environment.guestPrincipal());
    const unit = this.#environment.unitRepository.findById(artifact.facts.unitId);
    return unit ? { ...artifact, facts: { ...artifact.facts, unitTitle: unit.title } } : artifact;
  }

  #confirmedBookingFallback(artifact: BookingContractArtifact): string {
    const access = artifact.facts.accessAvailability === "available"
      ? "Access details are in secure booking details."
      : "Check-in details will be shared when they are ready. A confirmed booking does not itself grant physical access.";
    const depositCollected = artifact.facts.securityDeposit?.status === "held" && (artifact.facts.refundableSecurityDepositKobo ?? 0) > 0;
    return `Booking confirmed for ${artifact.facts.unitTitle ?? "your stay"}. ${formatStayDates(artifact.facts.checkIn, artifact.facts.checkOut)} · ${artifact.facts.nights} ${artifact.facts.nights === 1 ? "night" : "nights"}; ${artifact.facts.occupants.length} ${artifact.facts.occupants.length === 1 ? "guest" : "guests"}. ${artifact.facts.amountPaidKobo ? `Stay payment verified: ${formatNgnKobo(artifact.facts.amountPaidKobo)}. ` : ""}${depositCollected ? `${GUEST_GLOSSARY.refundableSecurityDeposit} collected: ${formatNgnKobo(artifact.facts.refundableSecurityDepositKobo!)}. ` : ""}${access} Your booking reference and full contract are in booking details.`;
  }

  #offerFallback(artifact: ConditionalOfferArtifact): string {
    const status = artifact.facts.status === "issued" ? "Offer available · Operator confirmed availability"
      : artifact.facts.status === "accepted" ? "Offer accepted · Payment required"
        : artifact.facts.status === "expired" ? "Offer expired"
          : artifact.facts.status === "stale" ? "Offer no longer current" : "Offer withdrawn";
    return `${status}. ${artifact.facts.unitTitle}. ${formatStayDates(artifact.facts.checkIn, artifact.facts.checkOut)} · ${artifact.facts.nights} ${artifact.facts.nights === 1 ? "night" : "nights"}. ${GUEST_GLOSSARY.allInStayTotal}: ${formatNgnKobo(artifact.facts.allInStayTotalKobo)}. ${artifact.facts.refundableSecurityDepositKobo > 0 ? `${GUEST_GLOSSARY.refundableSecurityDeposit} (separate): ${formatNgnKobo(artifact.facts.refundableSecurityDepositKobo)}. ` : ""}Total to complete booking: ${formatNgnKobo(artifact.facts.totalAmountDueNowKobo)}. ${formatBookingDeadline(artifact.facts.paymentWindowExpiresAt)}. ${guestReservationStatus(artifact.facts.status === "issued" ? "offer-issued" : artifact.facts.status === "accepted" ? "offer-accepted" : "offer-closed")}`;
  }

  #confirmedBookingSurface(thread: GuestThreadState): GuestSurfacePayload | null {
    if (!thread.offerId) return null;
    const snapshot = this.#environment.interactionStore.findBookingSnapshotByOfferId(thread.offerId);
    if (!snapshot) return null;
    try {
      const contract = JSON.parse(snapshot.contractJson) as { readonly contractId: string };
      const bookingSurfaceId = `thread-${thread.threadId}:booking:${contract.contractId}`;
      const contractArtifact = this.#contractArtifact(contract.contractId);
      this.#supersede(thread, PAYMENT_STAGE);
      thread.activeSurfaces.set(BOOKING_STAGE, bookingSurfaceId);
      return {
        surfaceId: bookingSurfaceId,
        mode: "focused-surface",
        summary: "Reservation confirmed",
        conventionalRoute: conventionalBookingContractRoute(contract.contractId),
        textFallback: this.#confirmedBookingFallback(contractArtifact),
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
          messages: ["The Conditional Booking Offer expired. Payment authority has been removed."],
          surfaces: [{
            surfaceId,
            mode: "focused-surface",
            summary: "Conditional Booking Offer expired",
            status: "expired",
            conventionalRoute: conventionalConditionalOfferRoute(thread.offerId),
            textFallback: this.#offerFallback(offer),
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
          const contractArtifact = this.#contractArtifact(contract.contractId);
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
              textFallback: this.#confirmedBookingFallback(contractArtifact),
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
        return { ok: true, messages: ["The Payment Window expired. Payment authority has been removed; no Reservation exists."], surfaces: [{ ...this.#paymentSurface(thread, payment, "Payment Window expired", surfaceId), status: "expired", textFallback: `Payment window expired. Total to complete booking: ${formatNgnKobo(payment.facts.amountDueNowKobo)}. No Reservation exists.` }] };
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
      return { ok: true, messages: ["Operator confirmed availability. Review the Conditional Booking Offer; payment is still required."], surfaces: [{ surfaceId, mode: "focused-surface", summary: "Conditional Booking Offer", conventionalRoute: conventionalConditionalOfferRoute(offerId), textFallback: this.#offerFallback(offerArtifact), a2uiMessages: conditionalOfferArtifactToA2UI({ artifact: offerArtifact, surfaceId }) }] };
    }
    if (["declined", "expired", "delivery_failed"].includes(artifact.facts.status)) {
      this.#supersede(thread, REQUEST_STAGE);
      const type = artifact.facts.status === "declined" ? "booking_request.declined" : artifact.facts.status === "expired" ? "booking_request.timed_out" : "booking_request.delivery_failed";
      this.#emitTransition(thread, type, { aggregateType: "booking_request", aggregateId: thread.requestId, reasonCode: artifact.facts.status === "declined" ? "OPERATOR_DECLINED" : artifact.facts.status === "expired" ? "OPERATOR_TIMEOUT" : "REQUEST_DELIVERY_FAILED" });
      return { ok: true, messages: [artifact.facts.status === "declined" ? "The Operator declined the request. No payment was taken." : artifact.facts.status === "expired" ? "The Booking Request expired before the Operator responded." : "The Booking Request could not be delivered."], surfaces: [{ ...this.#requestSurface(thread, thread.requestId), mode: "inline-surface", summary: "Request outcome", status: "fallback" }] };
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
      messages: ["Complete the secure card payment to confirm your booking."],
      receipts: [GUEST_RECEIPTS.offerAccepted],
      surfaces: [
        this.#paymentSurface(thread, paymentArtifact, "Payment required", paymentSurfaceId),
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
    const checkoutAmount = artifact.facts.currentComponentAmountKobo ?? (artifact.facts.currentComponent === "security_deposit" ? artifact.facts.refundableSecurityDepositKobo : artifact.facts.allInStayTotalKobo) ?? artifact.facts.amountDueNowKobo;
    const checkoutPurpose = artifact.facts.currentComponent === "security_deposit" ? GUEST_GLOSSARY.refundableSecurityDeposit : "stay payment";
    return { ok: true, messages: ["Payment checkout is ready. Payment has not succeeded; your booking details remain available when you return."], surfaces: [{ surfaceId, mode: "focused-surface", summary: "Payment handoff", conventionalRoute: conventionalCardPaymentRoute(thread.offerId), conventionalRouteLabel: `Continue to ${checkoutPurpose} · ${formatNgnKobo(checkoutAmount)}`, textFallback: `Payment handoff ready for ${artifact.facts.unit}, ${formatStayDates(artifact.facts.checkIn, artifact.facts.checkOut)}. ${artifact.facts.allInStayTotalKobo === undefined ? "" : `${GUEST_GLOSSARY.allInStayTotal}: ${formatNgnKobo(artifact.facts.allInStayTotalKobo)}. `}${artifact.facts.refundableSecurityDepositKobo ? `${GUEST_GLOSSARY.refundableSecurityDeposit} (separate): ${formatNgnKobo(artifact.facts.refundableSecurityDepositKobo)}. ` : ""}Next payment: ${formatNgnKobo(checkoutAmount)}. ${formatWAT(artifact.facts.paymentWindowExpiresAt)}. Payment has not succeeded and the booking is not confirmed. Your booking details will be retained when you return.`, a2uiMessages: cardPaymentArtifactToA2UI({ artifact, surfaceId }) }] };
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
        return { ok: true, messages: [`Payment verified for the stay. A separate ${GUEST_GLOSSARY.refundableSecurityDeposit} payment is required before a Reservation can exist.`], surfaces: [this.#paymentSurface(thread, artifact, `${GUEST_GLOSSARY.refundableSecurityDeposit} payment required`, surfaceId)] };
      }
      const contractArtifact = this.#contractArtifact(outcome.bookingContract.contractId);
      const bookingSurfaceId = `thread-${thread.threadId}:booking:${outcome.bookingContract.contractId}`;
      this.#supersede(thread, PAYMENT_STAGE);
      thread.activeSurfaces.set(BOOKING_STAGE, bookingSurfaceId);
      this.#emitTransition(thread, "payment.verified", { aggregateType: "payment", aggregateId: thread.offerId, nextState: "verified", surfaceId: bookingSurfaceId });
      this.#emitTransition(thread, "reservation.confirmed", { aggregateType: "reservation", aggregateId: outcome.reservation.reservationId, correlationId: thread.offerId, nextState: "confirmed" });
      return { ok: true, messages: [], receipts: [GUEST_RECEIPTS.paymentVerified], surfaces: [{ surfaceId: bookingSurfaceId, mode: "focused-surface", summary: "Reservation confirmed", conventionalRoute: conventionalBookingContractRoute(outcome.bookingContract.contractId), textFallback: this.#confirmedBookingFallback(contractArtifact), a2uiMessages: bookingContractArtifactToA2UI({ artifact: contractArtifact, surfaceId: bookingSurfaceId }) }] };
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
    const processing = artifact.facts.journeyStage === "stay_payment_processing" || artifact.facts.journeyStage === "deposit_payment_processing";
    const status = guestPaymentStatus(artifact.facts.status, processing);
    const currentAmount = artifact.facts.currentComponentAmountKobo ?? (artifact.facts.status === "ready" ? artifact.facts.allInStayTotalKobo : undefined);
    const routeLabel = processing ? "Return to payment status"
      : artifact.facts.status === "ready" ? "Open payment details"
        : artifact.facts.status === "checkout_initiated" ? `Continue to ${artifact.facts.currentComponent === "security_deposit" ? GUEST_GLOSSARY.refundableSecurityDeposit : "stay payment"} · ${formatNgnKobo(currentAmount ?? artifact.facts.amountDueNowKobo)}`
          : artifact.facts.status === "deposit_required" ? `Continue to ${GUEST_GLOSSARY.refundableSecurityDeposit} · ${formatNgnKobo(currentAmount ?? artifact.facts.refundableSecurityDepositKobo ?? artifact.facts.amountDueNowKobo)}`
            : "View payment status";
    return { surfaceId, mode: "focused-surface", summary, conventionalRoute: conventionalCardPaymentRoute(thread.offerId!), conventionalRouteLabel: routeLabel, textFallback: `${status.label}. ${artifact.facts.unit}, ${formatStayDates(artifact.facts.checkIn, artifact.facts.checkOut)}. ${artifact.facts.allInStayTotalKobo === undefined ? "" : `${GUEST_GLOSSARY.allInStayTotal}: ${formatNgnKobo(artifact.facts.allInStayTotalKobo)}. `}${artifact.facts.refundableSecurityDepositKobo ? `${GUEST_GLOSSARY.refundableSecurityDeposit} (separate): ${formatNgnKobo(artifact.facts.refundableSecurityDepositKobo)}. ` : ""}${currentAmount === undefined ? "" : `Current payment: ${formatNgnKobo(currentAmount)}. `}${formatWAT(artifact.facts.paymentWindowExpiresAt)}. ${status.detail}`, a2uiMessages: cardPaymentArtifactToA2UI({ artifact, surfaceId }) };
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
  return formatBookingDeadline(iso).replace(/^Pay by /, "");
}

/** The discovery surface for a stored artifact; restoring and going back present it identically. */
function discoverySurface(artifact: DiscoveryArtifactProjection, surfaceId: string, compareSelection?: string): GuestSurfacePayload {
  return {
    surfaceId,
    mode: "inline-surface",
    summary: discoverySummary(artifact.facts.filters),
    // ADR-0080: the re-presented fallback keeps the same criteria as the live one.
    conventionalRoute: conventionalSearchRoute(artifact.facts.filters),
    textFallback: discoveryFallbackMessage(artifact),
    a2uiMessages: discoveryArtifactToA2UI({ artifact, surfaceId, compareSelection }),
  };
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
<html lang="en-NG" data-theme="system">
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
    .skip-link { position: absolute; left: var(--space-2); top: -100px; z-index: var(--layer-skip-link); background: var(--surface); color: var(--text); padding: var(--space-2) var(--space-3); border: 2px solid var(--focus); border-radius: var(--radius-control); }
    .skip-link:focus { top: var(--space-2); }
    .app { width: 100%; max-width: var(--layout-conversation-max); height: 100dvh; height: 100svh; min-height: 0; margin: 0 auto; display: flex; flex-direction: column; }
    header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding: max(var(--space-3), env(safe-area-inset-top)) var(--layout-gutter-mobile) var(--space-3); border-bottom: 1px solid var(--border); background: var(--surface); }
    header h1 { margin: 0; font-family: var(--font-display); font-size: 1.25rem; line-height: 1.2; font-weight: 600; letter-spacing: -0.005em; }
    .header-identity { display: flex; align-items: center; min-height: var(--control-min-target); color: var(--text); text-decoration: none; }
    .header-note { color: var(--text-muted); font-size: var(--font-size-small); white-space: nowrap; }
    /* Issue 13a: the header controls wrap rather than scroll at 320px (ADR-0078). */
    .header-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-2); min-width: 0; }
    .header-plus { display: none; }
    /* The visible label shortens on phones; the accessible name stays "New conversation" (WCAG 2.5.3). */
    @media (max-width: 29.999rem) {
      .header-plus { display: inline; margin-inline-end: 0.25em; }
      .header-long { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    }
    #new-conversation-confirm { display: grid; gap: var(--space-3); padding: var(--space-3) var(--layout-gutter-mobile); border-bottom: 1px solid var(--border); background: var(--surface); }
    #new-conversation-confirm[hidden] { display: none; }
    #new-conversation-confirm h2 { margin: 0; font-size: var(--font-size-h3, 1.125rem); }
    .new-conversation-items p { margin: 0 0 var(--space-2); }
    .new-conversation-actions, .committed-work { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; }
    .committed-work { margin: 0 0 var(--space-3); color: var(--color-text-secondary); font-size: var(--font-size-small); }
    .committed-work p { margin: 0; }
    /* Issue 08: one compact line; it scrolls inside itself, never the page (ADR-0078). */
    #journey-rail { padding: var(--space-2) var(--layout-gutter-mobile); border-bottom: 1px solid var(--border); background: var(--surface); }
    #journey-rail[hidden] { display: none; }
    /* position: relative keeps the visually hidden state text inside the scroller. */
    #journey-rail ol { position: relative; display: flex; align-items: center; gap: var(--space-2); margin: 0; padding: 0; list-style: none; overflow-x: auto; scrollbar-width: none; }
    #journey-rail li { flex: none; display: flex; align-items: center; gap: var(--space-2); color: var(--color-text-secondary); font-size: var(--font-size-small); line-height: var(--font-line-small); white-space: nowrap; }
    #journey-rail li + li::before { content: ""; inline-size: var(--space-3); border-top: 1px solid var(--border); }
    #journey-rail li[data-state="done"] { color: var(--text); }
    #journey-rail li[data-state="current"] { color: var(--accent); font-weight: 650; }
    #journey-rail li[data-state="failed"] { color: var(--color-warning); font-weight: 650; }
    #journey-rail li[data-state="failed"][data-tone="danger"] { color: var(--color-danger); }
    @media (max-width: 29.999rem) { #journey-rail ol, #journey-rail li { gap: var(--space-1); } #journey-rail li + li::before { inline-size: var(--space-2); } }
    main { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    /* ADR-0078: keep the conversation independently scrollable at the 320px launch viewport. */
    #transcript { flex: 1 1 0; min-height: 22dvh; padding: var(--space-6) var(--layout-gutter-mobile) var(--space-4); display: flex; flex-direction: column; gap: var(--space-3); overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; }
    .conversation-heading { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    .turn { display: flex; flex-direction: column; gap: var(--space-1); }
    .turn.user { align-items: flex-end; }
    .bubble { max-width: min(88%, 70ch); padding: var(--space-2) var(--space-3); border-radius: var(--radius-card); font-size: var(--font-size-body); line-height: var(--font-line-body); white-space: pre-wrap; overflow-wrap: anywhere; }
    .turn.assistant .bubble { max-width: 72ch; padding-inline: 0; color: var(--text); }
    .turn.user .bubble { background: var(--surface-soft); color: var(--text); }
    .retry-action { align-self: flex-start; min-height: 44px; }
    .historical-summary { width: 100%; display: flex; align-items: center; gap: var(--space-2); color: var(--color-text-secondary); font-size: var(--font-size-small); line-height: var(--font-line-small); padding: var(--space-2) 0; border-top: 1px solid var(--border); }
    #empty-state { max-width: 70ch; padding-block: var(--space-3) var(--space-6); }
    #empty-state h2 { margin: 0 0 var(--space-2); font-family: var(--font-display); font-size: var(--font-size-h1); line-height: var(--font-line-h1); font-weight: 600; }
    #empty-state p { max-width: 64ch; margin: 0; color: var(--color-text-secondary); }
    .prompt-suggestions { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-3); }
    .quick-replies { display: flex; flex-wrap: wrap; gap: var(--space-2); }
    .quick-reply { min-width: var(--control-min-target); justify-content: center; }
    #workspace-region { min-height: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; padding: 0 var(--layout-gutter-mobile) var(--space-4); }
    #active-workspace { background: var(--color-surface-elevated); border: 1px solid var(--border); border-radius: var(--radius-workspace); padding: var(--space-4); box-shadow: var(--elevation-active); }
    #active-workspace[hidden], #workspace-region[hidden], #workspace-reopen[hidden], #empty-state[hidden] { display: none; }
    .workspace-heading { display: flex; justify-content: flex-start; align-items: flex-start; gap: var(--space-3); margin-bottom: var(--space-2); }
    .workspace-heading--inline-surface { margin-bottom: 0; }
    .workspace-heading-text { min-width: 0; display: grid; gap: var(--space-1); }
    .workspace-title { margin: 0; font-size: var(--font-size-h3); line-height: var(--font-line-h3); font-weight: 650; overflow-wrap: anywhere; }
    .eyebrow { color: var(--accent); font-size: var(--font-size-metadata); font-weight: 650; }
    .workspace-close, #workspace-reopen, .contact-link { display: inline-flex; min-height: var(--control-min-target); align-items: center; justify-content: center; padding: var(--space-2) var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-control); color: var(--text); background: var(--surface); text-decoration: none; cursor: pointer; }
    .contact-link { color: var(--color-text-secondary); font-size: var(--font-size-small); }
    .workspace-close:hover, #workspace-reopen:hover, .contact-link:hover { border-color: var(--accent); }
    .workspace-status { margin: 0 0 var(--space-3); color: var(--color-text-secondary); font-size: var(--font-size-small); }
    .workspace-status[data-status="stale"], .workspace-status[data-status="expired"], .workspace-status[data-status="deleted"], .workspace-status[data-status="fallback"] { padding: var(--space-2) var(--space-3); border-inline-start: 3px dashed var(--color-warning); background: var(--color-warning-surface); color: var(--color-warning); }
    .waiting-panel { display: grid; gap: var(--space-2); margin: 0 0 var(--space-4); padding: var(--space-3); border: 1px solid var(--color-border-subtle); border-inline-start: 4px solid var(--color-info); border-radius: var(--radius-card); background: var(--color-info-surface); }
    .waiting-panel h3 { margin: 0; font-size: var(--font-size-h3); line-height: var(--font-line-h3); font-weight: 650; }
    .waiting-panel p, .waiting-panel ul { margin: 0; }
    .waiting-panel ul { display: grid; gap: var(--space-1); padding-inline-start: var(--space-5); }
    .waiting-deadline { font-weight: 600; font-variant-numeric: tabular-nums; }
    .waiting-countdown { color: var(--color-info); }
    .waiting-label { color: var(--color-text-secondary); font-size: var(--font-size-small); font-weight: 600; }
    .waiting-meanwhile { color: var(--color-text-secondary); }
    .weaver-mount { min-width: 0; max-width: 100%; overflow: visible; }
    .workspace-arrival { animation: workspace-enter var(--duration-base) var(--ease-enter) both; }
    @keyframes workspace-enter { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
    .weaver-mount h1[data-a2ui-component="Text"] { font-size: var(--font-size-display) !important; line-height: var(--font-line-display) !important; font-weight: 700 !important; margin: 0 !important; }
    .weaver-mount h2[data-a2ui-component="Text"] { font-size: var(--font-size-h2) !important; line-height: var(--font-line-h2) !important; font-weight: 650 !important; margin: 0 !important; }
    .weaver-mount h3[data-a2ui-component="Text"] { font-size: var(--font-size-h3) !important; line-height: var(--font-line-h3) !important; font-weight: 650 !important; margin: 0 !important; }
    .weaver-mount img { display: block; width: 100%; max-width: 100%; height: auto; min-height: 120px; aspect-ratio: 4 / 3; object-fit: cover; border-radius: var(--radius-card); background: var(--surface-soft); }
    .photo-fallback { width: 100%; min-width: 0; min-height: 120px; aspect-ratio: 4 / 3; display: grid; place-items: center; padding: var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-card); background: var(--surface-soft); color: var(--color-text-secondary); text-align: center; }
    .weaver-mount small[data-a2ui-component="Text"] { margin: 0 !important; color: var(--color-text-secondary); font-size: var(--font-size-small) !important; font-style: normal !important; line-height: var(--font-line-small); }
    .weaver-mount p[data-a2ui-component="Text"] { margin: 0 !important; }
    .weaver-mount button[data-a2ui-variant="primary"] { min-width: var(--control-min-target); min-height: var(--control-min-target); font: 600 var(--font-size-label)/var(--font-line-label) var(--font-sans); }
    .weaver-mount button[data-a2ui-variant="primary"]:hover { --a2ui-color-primary: var(--color-action-hover); }
    .weaver-mount button[data-a2ui-variant="primary"]:active { --a2ui-color-primary: var(--color-action-pressed); }
    .weaver-mount button[data-loading="true"] { display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2); cursor: progress; }
    .weaver-mount button[data-loading="true"]::before { content: ""; inline-size: 1em; block-size: 1em; flex: none; border: 2px solid currentColor; border-inline-end-color: transparent; border-radius: var(--radius-round); animation: ui-spin 700ms linear infinite; }
    .weaver-mount button.guest-action:not([data-a2ui-variant="primary"]) { min-width: var(--control-min-target); min-height: var(--control-min-target); padding: var(--space-2) var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--surface); color: var(--text); font: 600 var(--font-size-label)/var(--font-line-label) var(--font-sans); cursor: pointer; }
    .weaver-mount button.guest-action:not([data-a2ui-variant="primary"]):hover { border-color: var(--accent); background: var(--surface-soft); }
    .weaver-mount .guest-field { width: 100%; min-width: 0; min-height: var(--control-min-field); padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--surface); color: var(--text); font-size: 1rem; }
    .guest-status { display: block; max-width: 70ch; margin: var(--space-2) 0 !important; padding: var(--space-2) var(--space-3); border: 1px solid currentColor; border-inline-start-width: 4px; border-radius: var(--radius-control); color: var(--color-info); background: var(--color-info-surface); font-weight: 600; }
    .guest-status--success { color: var(--color-success); background: var(--color-success-surface); }
    .guest-status--warning { color: var(--color-warning); background: var(--color-warning-surface); }
    .guest-status--danger { color: var(--color-danger); background: var(--color-danger-surface); }
    .empty-state-title { margin-block: var(--space-2); }
    .stay-grid { display: grid !important; grid-template-columns: minmax(0, 1fr); gap: var(--space-4) !important; min-width: 0; }
    .stay-card { min-width: 0; overflow: hidden; margin: 0 !important; padding: 0 !important; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-card); background: var(--surface); }
    .stay-card__body { display: grid !important; min-width: 0; gap: var(--space-2) !important; padding: var(--space-3); }
    .stay-card__body > * { min-width: 0; margin: 0 !important; }
    .stay-card__body > img { width: 100% !important; max-width: none !important; margin: 0 !important; object-fit: cover !important; }
    .stay-card__title { margin: 0 !important; font-family: var(--font-display); font-size: var(--font-size-h3) !important; line-height: var(--font-line-h3) !important; font-weight: 600 !important; }
    .stay-card__location, .stay-card__amenities { color: var(--color-text-secondary); }
    .stay-card__fit { color: var(--color-success); font-weight: 600; }
    .stay-card__facts { margin: 0; color: var(--color-text-secondary); }
    .stay-card__price-area { display: grid !important; gap: var(--space-1) !important; margin: 0 !important; }
    .stay-card__price-area > * { margin: 0 !important; }
    .stay-card__price-label { color: var(--color-text-secondary); font-size: var(--font-size-small) !important; line-height: var(--font-line-small) !important; }
    .stay-card__price-total, .stay-card__body h3.stay-card__price-total { margin: 0 !important; font-family: var(--font-display); font-size: var(--font-size-money-total) !important; line-height: var(--font-line-money-total) !important; font-variant-numeric: tabular-nums; }
    .stay-card__action { width: 100%; margin-top: var(--space-2); }
    .stay-card__compare { width: 100%; }
    /* Issue 13b: one row per attribute, one cell per stay, aligned by row. */
    .compare-row { display: grid !important; grid-template-columns: repeat(2, minmax(0, 1fr)) !important; gap: var(--space-3) !important; margin: 0 0 var(--space-3) !important; }
    .compare-cell { min-width: 0; margin: 0 !important; padding: var(--space-2) var(--space-3) !important; border: 1px solid var(--border); border-radius: var(--radius-control); overflow-wrap: anywhere; }
    .compare-cell > * { margin: 0 !important; }
    .compare-cell__unit { display: block; color: var(--color-text-secondary); }
    /* AC3 / ADR-0078: at narrow widths the stays stack under each attribute. */
    @media (max-width: 29.999rem) { .compare-row { grid-template-columns: minmax(0, 1fr) !important; gap: var(--space-2) !important; } }
    .unit-detail-root { display: grid !important; min-width: 0; gap: var(--space-4) !important; }
    .unit-gallery { display: grid; min-width: 0; grid-template-columns: minmax(0, 1fr); gap: var(--space-2); }
    .unit-gallery > img { width: 100% !important; max-width: none !important; min-width: 0; margin: 0 !important; object-fit: cover !important; }
    .unit-gallery--fallback { padding: var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-card); background: var(--surface-soft); }
    .unit-photo-missing { display: grid; min-height: 10rem; place-items: center; margin: 0; color: var(--color-text-secondary); text-align: center; }
    .unit-overview { display: grid; min-width: 0; gap: var(--space-2); }
    .unit-overview > * { margin: 0 !important; }
    .unit-title { margin: 0 !important; overflow-wrap: anywhere; font-family: var(--font-display); font-size: var(--font-size-h2) !important; line-height: var(--font-line-h2) !important; font-weight: 600 !important; }
    .unit-location, .unit-dates { color: var(--color-text-secondary); }
    .unit-facts { margin: 0 !important; font-weight: 600; }
    .unit-price-group { display: grid; gap: var(--space-2); padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-card); background: var(--surface-soft); }
    .unit-price-group > * { margin: 0 !important; }
    .unit-price-label { color: var(--color-text-secondary); font-size: var(--font-size-small) !important; line-height: var(--font-line-small) !important; }
    .unit-price-total { margin: 0 !important; font-family: var(--font-display); font-size: var(--font-size-money-total) !important; line-height: var(--font-line-money-total) !important; font-variant-numeric: tabular-nums; }
    .unit-description, .unit-amenities, .unit-supporting-info { display: grid; min-width: 0; gap: var(--space-2); padding-top: var(--space-3); border-top: 1px solid var(--border); }
    .unit-description > :first-child, .unit-amenities > :first-child { margin: 0 !important; font-size: var(--font-size-h3) !important; line-height: var(--font-line-h3) !important; }
    .unit-description p { margin: 0 !important; max-width: 70ch; }
    .unit-amenities [data-a2ui-component="Column"] { display: flex !important; flex-wrap: wrap !important; gap: var(--space-2) !important; }
    .unit-amenities [data-a2ui-component="Column"] > * { max-width: 100%; margin: 0 !important; padding: var(--space-1) var(--space-2); border: 1px solid var(--border); border-radius: var(--radius-small); background: var(--surface); overflow-wrap: anywhere; }
    .unit-supporting-info { color: var(--color-text-secondary); }
    .unit-supporting-info > * { margin: 0 !important; }
    .unit-actions { display: flex; min-width: 0; flex-wrap: wrap; gap: var(--space-2); }
    .unit-actions button { flex: 1 1 14rem; }
    .surface-fallback { border-inline-start: 4px solid var(--color-warning); padding: var(--space-1) 0 var(--space-1) var(--space-3); }
    .surface-fallback p { margin: 0 0 var(--space-2); }
    .fallback-link { display: inline-flex; align-items: center; min-height: var(--control-min-target); color: var(--accent); font-weight: 650; }
    .guest-field-error { margin: var(--space-2) 0 !important; color: var(--color-danger); }
    #workspace-reopen { margin: 0 var(--layout-gutter-mobile) var(--space-4); width: calc(100% - 2 * var(--layout-gutter-mobile)); justify-content: flex-start; text-align: start; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
    /* Issue 03a: the criteria strip sits above the composer; chips wrap, never scroll the page (ADR-0078). */
    #criteria-strip { display: grid; gap: var(--space-2); padding: var(--space-2) var(--layout-gutter-mobile) 0; border-top: 1px solid var(--border); background: var(--surface); }
    #criteria-strip[hidden], #criteria-editor[hidden] { display: none; }
    .criteria-chips { display: flex; flex-wrap: wrap; gap: var(--space-2); min-width: 0; }
    .criteria-chip { position: relative; min-height: var(--control-min-target); min-width: var(--control-min-target); justify-content: center; max-width: 100%; overflow-wrap: anywhere; text-align: start; }
    /* Narrow screens keep the field names for screen readers only, so the strip stays short. */
    @media (max-width: 29.999rem) { .criteria-chip { padding-inline: var(--space-2); font-size: var(--font-size-small); } .criteria-chip .criteria-chip-name { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; } }
    .criteria-chip .criteria-chip-name { color: var(--color-text-secondary); font-weight: 400; }
    .criteria-chip[aria-expanded="true"] { border-color: var(--color-action); }
    .criteria-undo { min-height: var(--control-min-target); padding-inline: var(--space-2); border: 0; background: none; color: var(--accent); font-weight: 650; text-decoration: underline; cursor: pointer; }
    #criteria-editor { display: grid; gap: var(--space-2); padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-card); background: var(--color-surface-elevated); }
    #criteria-editor .ui-field { display: grid; gap: var(--space-1); min-width: 0; }
    #criteria-editor input, #criteria-editor select { width: 100%; min-width: 0; min-height: var(--control-min-field); }
    .criteria-editor-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
    .criteria-editor-actions button { min-height: var(--control-min-target); }
    .criteria-status { margin: 0; color: var(--color-danger); font-size: var(--font-size-small); }
    #criteria-panel { display: grid; gap: var(--space-2); min-width: 0; }
    /*
     * Review decision (M3): on phones the strip is a one-line summary of the
     * filled criteria with an "Edit search" toggle; the chips, editor and undo
     * open under it. Wider screens always show the chips.
     */
    .criteria-compact { display: none; }
    @media (max-width: 47.999rem) {
      .criteria-compact { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
      .criteria-summary { flex: 1; min-width: 0; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-text-secondary); font-size: var(--font-size-small); }
      .criteria-toggle { flex: none; min-height: var(--control-min-target); }
      #criteria-strip:not([data-expanded="true"]) #criteria-panel { display: none; }
    }
    .criteria-status:empty { display: none; }
    form#composer { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: var(--space-2); padding: var(--space-2) var(--layout-gutter-mobile) max(var(--space-4), env(safe-area-inset-bottom)); border-top: 1px solid var(--border); background: var(--surface); position: sticky; bottom: 0; z-index: 10; }
    #composer-label { grid-column: 1 / -1; color: var(--color-text-secondary); font-size: var(--font-size-small); line-height: var(--font-line-small); font-weight: 600; }
    #composer-input { min-width: 0; width: 100%; min-height: var(--control-min-field); padding: var(--space-2) var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-control); font-size: 1rem; background: var(--bg); color: var(--text); }
    #composer-submit { min-height: var(--control-min-field); }
    form#composer[data-focused="true"] { gap: var(--space-1) var(--space-2); padding-block: var(--space-1) max(var(--space-2), env(safe-area-inset-bottom)); background: var(--bg); }
    form#composer[data-focused="true"] #composer-label { font-weight: 400; }
    form#composer[data-focused="true"] #composer-input { min-height: 2.75rem; background: var(--surface); }
    form#composer[data-focused="true"] #composer-submit { min-height: 2.75rem; }
    #composer-submit:disabled { background: var(--surface-soft); cursor: progress; }
    #working-status { grid-column: 1 / -1; margin: 0; color: var(--color-text-secondary); font-size: var(--font-size-small); }
    @media (min-width: 48rem) {
      #transcript, #workspace-region, form#composer, #journey-rail, #criteria-strip { padding-left: var(--layout-gutter-tablet); padding-right: var(--layout-gutter-tablet); }
      .unit-gallery--mosaic { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .unit-gallery--mosaic img:first-of-type { grid-column: 1 / -1; }
    }
    @media (min-width: 64rem) { .app { max-width: var(--layout-conversation-max); } #transcript, #workspace-region, form#composer, #journey-rail, #criteria-strip { padding-left: var(--layout-gutter-desktop); padding-right: var(--layout-gutter-desktop); } }
    @media (max-width: 47.999rem) { .header-note { display: none; } #active-workspace[data-mode="focused-surface"] { scroll-margin-block: var(--space-3); } }
    /*
     * Issue 09 AC1: at 64rem and wider, an open workspace takes the second
     * column beside the transcript, starting at the top (no dead space). The
     * strip and composer stay under the transcript so chat remains live.
     */
    @media (min-width: 64rem) {
      .app:has(#active-workspace:not([hidden])) { max-width: var(--layout-app-max); }
      main:has(#active-workspace:not([hidden])) {
        display: grid;
        grid-template-columns: minmax(22rem, 1fr) minmax(0, 1.25fr);
        grid-template-rows: minmax(0, 1fr) auto auto auto;
        grid-template-areas: "transcript workspace" "reopen workspace" "strip workspace" "composer workspace";
      }
      main:has(#active-workspace:not([hidden])) > #transcript { grid-area: transcript; }
      main:has(#active-workspace:not([hidden])) > #workspace-reopen { grid-area: reopen; }
      main:has(#active-workspace:not([hidden])) > #criteria-strip { grid-area: strip; }
      main:has(#active-workspace:not([hidden])) > form#composer { grid-area: composer; }
      main:has(#active-workspace:not([hidden])) > #workspace-region { grid-area: workspace; min-height: 0; padding-block: var(--space-4); border-inline-start: 1px solid var(--border); }
    }
    /*
     * Issue 09 AC2: below 64rem a focused workspace is a full-screen sheet
     * above the conversation. It stops at the composer, which stays usable
     * (AC3); header Back and browser Back both close it.
     */
    @media (max-width: 63.999rem) {
      #workspace-region:has(> #active-workspace[data-mode="focused-surface"][data-status="active"]:not([hidden])) {
        position: fixed; inset: 0 0 var(--composer-block-size, 0px) 0; z-index: var(--layer-sticky); padding: max(var(--space-3), env(safe-area-inset-top)) var(--layout-gutter-mobile) var(--space-4); background: var(--bg);
      }
      #workspace-region:has(> #active-workspace[data-mode="focused-surface"][data-status="active"]:not([hidden])) .workspace-heading--focused-surface { position: sticky; top: calc(-1 * var(--space-3)); z-index: 1; margin-inline: calc(-1 * var(--space-4)); padding: var(--space-2) var(--space-4); background: var(--color-surface-elevated); }
      form#composer { z-index: calc(var(--layer-sticky) + 1); }
    }
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
      <div class="header-actions">
        <button id="new-conversation" class="contact-link" type="button"><span class="header-plus" aria-hidden="true">+</span><span>New<span class="header-long"> conversation</span></span></button>
        <a class="contact-link" href="/guest/contact">Contact details</a>
      </div>
    </header>
    <section id="new-conversation-confirm" role="group" aria-labelledby="new-conversation-heading" hidden>
      <h2 id="new-conversation-heading">${GUEST_NEW_CONVERSATION.confirmHeading}</h2>
      <div class="new-conversation-items"></div>
      <div class="new-conversation-actions">
        <button id="new-conversation-start" class="ui-button ui-button--primary" type="button">${GUEST_NEW_CONVERSATION.confirm}</button>
        <button id="new-conversation-cancel" class="ui-button" type="button">${GUEST_NEW_CONVERSATION.cancel}</button>
      </div>
    </section>
    <nav id="journey-rail" aria-label="${GUEST_JOURNEY.railLabel}" hidden><ol></ol></nav>
    <main id="main-content" tabindex="-1">
      <section id="transcript" role="log" aria-live="polite" aria-relevant="additions" aria-labelledby="conversation-heading">
        <h2 id="conversation-heading" class="conversation-heading">Conversation</h2>
        <section id="empty-state" aria-labelledby="empty-state-heading">
          <h2 id="empty-state-heading">Find a place to stay</h2>
          <p>Start with a city, your dates (or length of stay), and number of guests. We’ll find available entire-place stays and guide you through requesting one.</p>
          <div class="prompt-suggestions">
            <button class="prompt-suggestion ui-chip" type="button" data-prompt="I’m looking for a stay in Abuja">Explore Abuja</button>
            <button class="prompt-suggestion ui-chip" type="button" data-prompt="I’m looking for a stay in Lagos">Explore Lagos</button>
          </div>
        </section>
      </section>
      <section id="workspace-region" aria-label="Current stay details" hidden>
        <div id="active-workspace" hidden></div>
      </section>
      <button id="workspace-reopen" type="button" hidden>Return to your current stay details</button>
      <section id="criteria-strip" aria-label="Your search" hidden>
        <div class="criteria-compact">
          <p id="criteria-summary" class="criteria-summary"></p>
          <button id="criteria-toggle" class="criteria-toggle ui-button ui-button--quiet" type="button" aria-expanded="false" aria-controls="criteria-panel">Edit search</button>
        </div>
        <div id="criteria-panel">
          <div class="criteria-chips"></div>
          <form id="criteria-editor" hidden novalidate></form>
        </div>
        <p id="criteria-status" class="criteria-status" role="alert"></p>
      </section>
      <form id="composer" method="post" action="/conversation" aria-label="Message the concierge">
        <input type="hidden" name="threadId" value="" />
        <label id="composer-label" for="composer-input">Your message</label>
        <input id="composer-input" name="message" type="text" autocomplete="off" enterkeyhint="send"
               placeholder="Area, dates, guests" aria-describedby="composer-hint" />
        <span id="composer-hint" class="sr-only">Share a city or neighbourhood, dates or nights, and number of guests.</span>
        <button id="composer-submit" class="ui-button ui-button--primary" type="submit">Send</button>
        <p id="working-status" hidden></p>
      </form>
    </main>
    <div id="announcer" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
    <div id="error-announcer" class="sr-only" role="alert" aria-live="assertive" aria-atomic="true"></div>
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
  const photos = normalizePhotoUrls(unit.photoUrls);
  const photoMarkup = photos.length === 0
    ? `<p class="ui-image-frame" role="status">Photos are not available for this ${GUEST_GLOSSARY.unit} yet.</p>`
    : `<div class="unit-page-gallery" aria-label="Photos of ${escapeHtml(unit.title)}">${photos.map((url, index) => `<div class="ui-image-frame"><img src="${escapeHtml(photoUrl ? photoUrl(url) : url)}" alt="Photo ${index + 1} of ${escapeHtml(unit.title)}" loading="${index === 0 ? "eager" : "lazy"}" decoding="async" width="800" height="600" referrerpolicy="no-referrer"></div>`).join("")}</div>`;
  return pageShell({
    title: unit.title,
    style: ".unit-page-gallery{display:grid;gap:var(--space-3)}@media (min-width:48rem){.unit-page-gallery{grid-template-columns:repeat(2,minmax(0,1fr))}.unit-page-gallery>:first-child{grid-column:1/-1}}.ui-panel p{margin:0}.unit-page-description{white-space:pre-line}",
    body: `<header class="ui-page__header"><p class="ui-eyebrow">Entire place</p><h1>${escapeHtml(unit.title)}</h1><p>${escapeHtml(unit.location.neighbourhood)}, ${escapeHtml(unit.location.city)}</p></header>${photoMarkup}<section class="ui-panel" aria-label="Stay facts"><div><p class="ui-field__hint">Price per night (indicative)</p><p class="ui-money-total">${formatNgnKobo(unit.price.nightlyKobo)} <span class="ui-money-metadata">per night</span></p></div><p class="ui-money-metadata">Bedrooms: ${unit.bedrooms ?? "Not provided"} · Bathrooms: ${unit.bathrooms} · Capacity: ${unit.capacity} guests · Entire Place</p><p class="unit-page-description">${escapeHtml(unit.description)}</p><div class="ui-row"><a class="ui-button ui-button--primary" href="/">Continue to Request to Book</a></div></section>`,
  });
}

const MAX_TURN_TEXT_LENGTH = 2000;

/**
 * Issue 06c: the server-rendered conversation for browsers without
 * JavaScript. Surfaces are shown by their text fallback and conventional
 * route (ADR-0080), with the same link label the client uses.
 */
const JOURNEY_STATE_TEXT: Readonly<Record<GuestJourney["steps"][number]["state"], string>> = {
  done: "completed", current: "current step", failed: "not completed", upcoming: "not started",
};

/** Issue 08 / ADR-0080: the no-JS page shows the same journey rail as the live shell. */
function renderJourneyRailHtml(journey: GuestJourney | undefined): string {
  if (!journey) return "";
  const steps = journey.steps.map((step) => `<li data-state="${step.state}"${step.state === "current" ? " aria-current=\"step\"" : ""}>${escapeHtml(step.label)}<span class="journey-state"> (${JOURNEY_STATE_TEXT[step.state]})</span></li>`).join("");
  return `<nav class="no-js-journey" aria-label="${GUEST_JOURNEY.railLabel}"><ol>${steps}</ol></nav>`;
}

/** Issue 10 / ADR-0080: without JavaScript the absolute deadline stands in for the countdown. */
function renderWaitingHtml(waiting: GuestWaitingState | undefined): string {
  if (!waiting) return "";
  const list = (items: readonly string[]): string => `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  return `<div class="no-js-waiting" data-waiting="${waiting.kind}"><h3>${escapeHtml(waiting.heading)}</h3><p>${escapeHtml(waiting.deadlineText)}</p><p>What happens next</p>${list(waiting.outcomes)}${list(waiting.meanwhile)}</div>`;
}

export function renderNoScriptConversationHtml(input: { readonly threadId: string; readonly timeline: readonly GuestTimelineEntry[]; readonly surfaces: readonly GuestSurfacePayload[]; readonly journey?: GuestJourney; readonly error?: string; readonly draft?: string; readonly committedWork?: readonly GuestCommittedWork[] }): string {
  const turns = input.timeline.map((entry) => entry.role === "receipt"
    ? `<li class="no-js-receipt" data-role="receipt"><p>${icon("check")} ${escapeHtml(entry.text)}</p></li>`
    : `<li class="ui-panel no-js-turn" data-role="${entry.role}"><p class="ui-eyebrow">${entry.role === "user" ? "You" : "Shortlet Concierge"}</p><p>${escapeHtml(entry.text)}</p></li>`).join("");
  const surfaces = input.surfaces.filter((surface) => surface.status !== "deleted" && surface.status !== "superseded").map((surface) => `<section class="ui-panel" aria-label="${escapeHtml(surface.summary ?? "Current details")}">${surface.summary ? `<h2>${escapeHtml(surface.summary)}</h2>` : ""}${surface.textFallback ? `<p>${escapeHtml(surface.textFallback)}</p>` : ""}${renderWaitingHtml(surface.waiting)}${surface.conventionalRoute ? `<a class="ui-button ui-button--primary" href="${escapeHtml(surface.conventionalRoute)}">${escapeHtml(surface.conventionalRouteLabel ?? "Open full details")}</a>` : ""}</section>`).join("");
  const error = input.error ? `<p id="composer-error" class="ui-field__error" role="alert">${escapeHtml(input.error)}</p>` : "";
  // Issue 13a / ADR-0080: a new conversation without JavaScript still says the
  // Guest's live work elsewhere is unaffected, and links to it.
  const committed = input.timeline.length > 0 ? "" : (input.committedWork ?? []).filter((work) => work.threadId !== input.threadId).map((work) => {
    const copy = guestNewConversationCopy(work.kind, work.unitTitle);
    return `<section class="ui-panel committed-work" data-kind="${work.kind}"><p>${escapeHtml(copy.stillActive)}</p><a class="ui-button" href="${escapeHtml(work.route)}">${escapeHtml(copy.link)}</a></section>`;
  }).join("");
  return pageShell({
    title: "Conversation · Shortlet",
    width: "narrow",
    style: ".no-js-transcript{list-style:none;margin:0;padding:0;display:grid;gap:var(--space-3)}.no-js-transcript p,.ui-panel p{margin:0}.ui-panel h2{margin:0;font-size:var(--font-size-h3);line-height:var(--font-line-h3)}.no-js-turn[data-role=user]{background:var(--surface-soft)}.no-js-receipt p{display:flex;gap:var(--space-2);align-items:center;color:var(--color-text-secondary)}.no-js-journey ol{display:flex;flex-wrap:wrap;gap:var(--space-1) var(--space-3);margin:0;padding:0;list-style:none;font-size:var(--font-size-small)}.no-js-journey li{color:var(--color-text-secondary)}.no-js-journey li[data-state=current],.no-js-journey li[data-state=failed]{color:var(--color-text);font-weight:650}.journey-state{position:absolute;inline-size:1px;block-size:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}",
    body: `<header class="ui-page__header" data-page="conversation"><p class="ui-eyebrow">Shortlet</p><h1>Conversation</h1><p><a class="ui-button" href="/conversation">${GUEST_NEW_CONVERSATION.control}</a></p></header>${committed}${renderJourneyRailHtml(input.journey)}${turns ? `<ol class="no-js-transcript" aria-label="Conversation">${turns}</ol>` : ""}${surfaces}<form class="ui-panel" method="post" action="/conversation" aria-label="Message the concierge"><div class="ui-field"><label class="ui-field__label" for="composer-input">Your message</label><p class="ui-field__hint" id="composer-hint">Share a city or neighbourhood, dates or nights, and number of guests.</p><input id="composer-input" name="message" type="text" autocomplete="off" enterkeyhint="send" maxlength="${MAX_TURN_TEXT_LENGTH}" required aria-describedby="composer-hint${error ? " composer-error" : ""}"${error ? " aria-invalid=\"true\"" : ""} value="${escapeHtml(input.draft ?? "")}">${error}</div><input type="hidden" name="threadId" value="${escapeHtml(input.threadId)}"><button class="ui-button ui-button--primary ui-button--block" type="submit">Send</button></form>`,
  });
}

/** The booking routes built by `apps/web/src/presentation.ts`; drafts are matched before requests. */
const CONVENTIONAL_BOOKING_ROUTES: readonly (readonly [ConventionalBookingPageKind, RegExp])[] = [
  ["draft", /^\/booking-requests\/drafts\/([^/]+)$/],
  ["request", /^\/booking-requests\/([^/]+)$/],
  ["offer", /^\/conditional-offers\/([^/]+)$/],
  ["contract", /^\/booking-contracts\/([^/]+)$/],
];

function matchConventionalBookingRoute(pathname: string): { readonly kind: ConventionalBookingPageKind; readonly encodedId: string } | null {
  for (const [kind, pattern] of CONVENTIONAL_BOOKING_ROUTES) {
    const match = pattern.exec(pathname);
    if (match && !(kind === "request" && match[1] === "drafts")) return { kind, encodedId: match[1]! };
  }
  return null;
}

export function renderConventionalBookingHtml(page: ConventionalBookingPage): string {
  return pageShell({
    title: `${page.summary} · Shortlet`,
    width: "narrow",
    style: ".ui-panel p{margin:0}",
    body: `<header class="ui-page__header" data-page="booking-record"><p class="ui-eyebrow">Your booking</p><h1>${escapeHtml(page.summary)}</h1></header><section class="ui-panel"><p>${escapeHtml(page.textFallback)}</p><a class="ui-button ui-button--primary ui-button--block" href="/?threadId=${encodeURIComponent(page.threadId)}">Back to your conversation</a></section>`,
  });
}

/** Only the criteria `conventionalSearchRoute` builds for the guest app; anything else fails closed (ADR-0080). */
const SEARCH_TEXT_KEYS = ["location", "neighbourhood", "checkIn", "checkOut"] as const;
const SEARCH_COUNT_KEYS = ["partySize", "bedrooms"] as const;

export function parseConventionalSearchQuery(params: URLSearchParams): Readonly<Record<string, string | number>> | null {
  const filters: Record<string, string | number> = {};
  for (const [key, value] of params) {
    // Issue 03b: the form's budget (whole naira) is optional, so an empty one means none.
    if (key === "budget") {
      if (value.trim() === "") continue;
      if (!/^\d{1,10}$/.test(value) || Number(value) < 1 || params.has("maxPriceKobo") || params.getAll("budget").length > 1) return null;
      filters.maxPriceKobo = Number(value) * 100;
      continue;
    }
    if (Object.hasOwn(filters, key) || value.trim() === "") return null;
    if (key === "maxPriceKobo") {
      if (!/^\d{1,12}$/.test(value) || Number(value) < 1) return null;
      filters.maxPriceKobo = Number(value);
      continue;
    }
    if (key === "area") {
      // Issue 03a / ADR-0080: the search form's Where field, from the same list as the strip.
      const area = SEARCH_AREAS.find((candidate) => candidate.id === value);
      if (!area || params.has("location") || params.has("neighbourhood") || params.getAll("area").length > 1) return null;
      filters.location = area.city;
      if (area.neighbourhood !== undefined) filters.neighbourhood = area.neighbourhood;
    } else if ((SEARCH_TEXT_KEYS as readonly string[]).includes(key)) filters[key] = value.trim();
    else if ((SEARCH_COUNT_KEYS as readonly string[]).includes(key) && /^\d{1,3}$/.test(value)) filters[key] = Number(value);
    else return null;
  }
  return filters;
}

export function renderConventionalSearchHtml(artifact: DiscoveryArtifactProjection): string {
  const cards = artifact.facts.results.map((unit) => {
    const route = artifact.actions.find((action) => action.type === "view-unit" && action.unitId === unit.id)?.conventionalRoute ?? `/stays/${encodeURIComponent(unit.id)}`;
    const total = unit.price.allInStayTotalKobo === null ? "not yet quoted" : formatNgnKobo(unit.price.allInStayTotalKobo);
    return `<li class="ui-panel" data-unit-id="${escapeHtml(unit.id)}"><h2><a href="${escapeHtml(route)}">${escapeHtml(unit.title)}</a></h2><p>${escapeHtml(unit.location.neighbourhood)}, ${escapeHtml(unit.location.city)} · Entire Place · capacity ${unit.capacity} guests</p><p class="ui-money-total">${GUEST_GLOSSARY.allInStayTotal}: ${total}</p><p class="ui-money-metadata">${GUEST_GLOSSARY.refundableSecurityDeposit} (separate): ${formatNgnKobo(unit.price.refundableSecurityDepositKobo)}</p><a class="ui-button" href="${escapeHtml(route)}">${GUEST_GLOSSARY.viewUnit}<span class="sr-only">: ${escapeHtml(unit.title)}</span></a></li>`;
  }).join("");
  const { checkIn, checkOut } = artifact.facts.filters;
  const stay = typeof checkIn === "string" && typeof checkOut === "string" ? formatStayDates(checkIn, checkOut) : "";
  const summary = [discoverySummary(artifact.facts.filters).replace(/^Search updated( · )?/, ""), stay].filter(Boolean).join(" · ");
  const filters = artifact.facts.filters as Readonly<Record<string, unknown>>;
  const currentArea = SEARCH_AREAS.find((area) => area.city === filters.location && area.neighbourhood === filters.neighbourhood)?.id;
  const text = (value: unknown): string => typeof value === "string" ? escapeHtml(value) : "";
  // Issue 03a / ADR-0080: the strip's Where, When and Guests, editable without JavaScript.
  const form = `<form class="ui-panel search-form" method="get" action="/stays/search" aria-label="Change your search">`
    + `<div class="ui-field"><label class="ui-field__label" for="search-area">Where</label><select class="ui-input" id="search-area" name="area" required>${SEARCH_AREAS.map((area) => `<option value="${area.id}"${area.id === currentArea ? " selected" : ""}>${escapeHtml(area.label)}</option>`).join("")}</select></div>`
    + `<div class="ui-field"><label class="ui-field__label" for="search-check-in">Arrival date</label><input class="ui-input" id="search-check-in" name="checkIn" type="date" required value="${text(filters.checkIn)}"></div>`
    + `<div class="ui-field"><label class="ui-field__label" for="search-check-out">Departure date</label><input class="ui-input" id="search-check-out" name="checkOut" type="date" required value="${text(filters.checkOut)}"></div>`
    + `<div class="ui-field"><label class="ui-field__label" for="search-guests">Guests</label><input class="ui-input" id="search-guests" name="partySize" type="number" min="1" inputmode="numeric" required value="${typeof filters.partySize === "number" ? filters.partySize : ""}"></div>`
    + `<div class="ui-field"><label class="ui-field__label" for="search-budget">Budget for the stay (₦, optional)</label><p class="ui-field__hint" id="search-budget-hint">Compared with the ${GUEST_GLOSSARY.allInStayTotal}. The ${GUEST_GLOSSARY.refundableSecurityDeposit} is separate.</p><input class="ui-input" id="search-budget" name="budget" type="number" min="1" step="1" inputmode="numeric" aria-describedby="search-budget-hint" value="${typeof filters.maxPriceKobo === "number" ? Math.round(filters.maxPriceKobo / 100) : ""}"></div>`
    + `<button class="ui-button ui-button--primary" type="submit">Update search</button></form>`;
  return pageShell({
    title: "Search results · Shortlet",
    style: ".search-form{display:grid;gap:var(--space-3)}.stay-results{list-style:none;margin:0;padding:0;display:grid;gap:var(--space-3)}.stay-results h2{margin:0;font-size:var(--font-size-h3);line-height:var(--font-line-h3)}.stay-results p{margin:0}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}",
    body: `<header class="ui-page__header" data-page="stay-search"><p class="ui-eyebrow">Search results</p><h1>${escapeHtml(discoveryFallbackMessage(artifact))}</h1>${summary ? `<p>${escapeHtml(summary)}</p>` : ""}</header>${form}${cards ? `<ul class="stay-results">${cards}</ul>` : ""}<p><a class="ui-button ui-button--primary" href="/">Back to your conversation</a></p>`,
  });
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

export function renderGuestContactHtml(contact: { phoneNumber: string | null; contactEmail: string | null; revision: number } | null, error = "", kind: "phone" | "email" | "both" = "both", entered: { readonly phoneNumber?: string; readonly contactEmail?: string } = {}): string {
  const safe = escapeHtml;
  const phoneError = kind === "phone" ? error : "";
  const emailError = kind === "email" ? error : "";
  const phoneValue = entered.phoneNumber ?? contact?.phoneNumber ?? "";
  const emailValue = entered.contactEmail ?? contact?.contactEmail ?? "";
  const phoneForm = kind === "email" ? "" : `<form class="ui-panel" method="post" action="/guest/contact/phone"><div class="ui-field"><label class="ui-field__label" for="phoneNumber">Phone number <span aria-hidden="true">*</span></label><p class="ui-field__hint" id="phoneNumber-help">Required before you send a Booking Request. Use a Nigerian mobile number: +234 E.164 format. Example: +234 801 234 5678 or 0801 234 5678. This is for booking coordination, not identity verification.</p><input id="phoneNumber" name="phoneNumber" type="tel" inputmode="tel" autocomplete="tel" enterkeyhint="done" maxlength="32" required aria-describedby="phoneNumber-help${phoneError ? " phoneNumber-error" : ""}"${phoneError ? " aria-invalid=\"true\"" : ""} value="${safe(phoneValue)}">${phoneError ? `<p id="phoneNumber-error" class="ui-field__error" role="alert">${safe(phoneError)}</p>` : ""}</div><input type="hidden" name="expectedRevision" value="${contact?.revision ?? 0}"><button class="ui-button ui-button--primary ui-button--block" type="submit">Save phone number</button></form>`;
  const emailForm = kind === "phone" ? "" : `<form class="ui-panel" method="post" action="/guest/contact/email"><div class="ui-field"><label class="ui-field__label" for="contactEmail">Email address <span aria-hidden="true">*</span></label><p class="ui-field__hint" id="contactEmail-help">Required to initialize hosted card checkout and send your payment receipt. This email is not your account identity.</p><input id="contactEmail" name="contactEmail" type="email" inputmode="email" autocomplete="email" enterkeyhint="done" maxlength="254" required aria-describedby="contactEmail-help${emailError ? " contactEmail-error" : ""}"${emailError ? " aria-invalid=\"true\"" : ""} value="${safe(emailValue)}">${emailError ? `<p id="contactEmail-error" class="ui-field__error" role="alert">${safe(emailError)}</p>` : ""}</div><input type="hidden" name="expectedRevision" value="${contact?.revision ?? 0}"><button class="ui-button ui-button--primary ui-button--block" type="submit">Save email address</button></form>`;
  const generalError = error && kind === "both" ? `<p class="ui-banner ui-banner--danger" role="alert">${icon("alert")}<span>${safe(error)}</span></p>` : "";
  return pageShell({
    title: "Guest contact",
    width: "narrow",
    body: `<header class="ui-page__header"><h1>Guest contact</h1><p>Used only to coordinate your booking and payment.</p></header>${generalError}${phoneForm}${emailForm}`,
  });
}

const PAGE_ERROR_COPY: Readonly<Record<string, { readonly title: string; readonly message: string }>> = {
  AUTHENTICATION_REQUIRED: { title: "Open this from your conversation", message: "This page needs the browser session you used to chat with the concierge. Return to the conversation and follow the link from there." },
  INVALID_OFFER: { title: "This payment link isn't valid", message: "The link is incomplete or has been changed. Return to the conversation for the current booking status." },
  PAYMENT_OFFER_NOT_FOUND: { title: "We couldn't find this booking offer", message: "It may have expired or belong to a different conversation. Return to the conversation for the current booking status." },
  PAYMENT_CONTINUATION_REJECTED: { title: "Payment can't continue right now", message: "No payment was taken. The offer may have expired or already been paid. Return to the conversation for the current booking status." },
  PAYSTACK_UNAVAILABLE: { title: "Card checkout is unavailable", message: "No payment was taken. Try again in a few minutes from your conversation." },
  INVALID_CHECKOUT_URL: { title: "Card checkout is unavailable", message: "No payment was taken. Try again in a few minutes from your conversation." },
  LOCAL_PAYMENT_INVALID: { title: "This demo payment link isn't valid", message: "Start the payment again from your conversation." },
  INVALID_BOOKING_LINK: { title: "This booking link isn't valid", message: "The link is incomplete or has been changed. Return to the conversation for the current booking status." },
  BOOKING_RECORD_NOT_FOUND: { title: "We couldn't find this booking", message: "It may belong to a different conversation. Return to the conversation for the current booking status." },
  INVALID_CONVERSATION: { title: "This conversation link isn't valid", message: "The link is incomplete or has been changed. Start again from the conversation." },
  SEARCH_INVALID: { title: "This search link isn't valid", message: "The link is incomplete or has been changed. Return to the conversation and search again." },
};

/** Page routes answer browser navigations with a styled page and API clients with JSON. */
function sendPageError(req: IncomingMessage, res: ServerResponse, status: number, code: string): void {
  const copy = PAGE_ERROR_COPY[code];
  if (!copy || !prefersHtml(req.headers.accept)) { sendJson(res, status, { ok: false, code }); return; }
  res.writeHead(status, GUEST_HTML_HEADERS);
  res.end(errorPage({ status, code, title: copy.title, message: copy.message, action: { href: "/", label: "Back to your conversation" } }));
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
  // Issue 06c: "same-origin" (not "no-referrer") so a same-origin form post
  // carries a real Origin for browserOriginAccepted; cross-origin requests
  // still send no referrer.
  "Referrer-Policy": "same-origin",
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

    // ADR-0080: conventional search parity. Matched before the unit route so
    // "search" is never read as a unit id.
    if (req.method === "GET" && url.pathname === "/stays/search") {
      const filters = parseConventionalSearchQuery(url.searchParams);
      let artifact: DiscoveryArtifactProjection | null = null;
      try { artifact = filters === null ? null : app.environment.discoveryQuery.search(filters); } catch { artifact = null; }
      if (!artifact) { sendPageError(req, res, 400, "SEARCH_INVALID"); return; }
      res.writeHead(200, GUEST_HTML_HEADERS);
      res.end(renderConventionalSearchHtml(artifact));
      return;
    }

    const conventionalUnitMatch = /^\/stays\/([^/]+)$/.exec(url.pathname);
    if (req.method === "GET" && conventionalUnitMatch) {
      let unitId: string;
      try { unitId = decodeURIComponent(conventionalUnitMatch[1]!); } catch { res.writeHead(400, { "Content-Type": "text/plain" }); res.end("Invalid apartment"); return; }
      const unit = app.environment.unitRepository.findById(unitId);
      if (!unit || !isEligibleUnit(unit, app.environment.clock())) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("Apartment not found"); return; }
      res.writeHead(200, GUEST_HTML_HEADERS);
      res.end(renderConventionalUnitDetailHtml(unit, options.localPhotoUrl));
      return;
    }

    const bookingPageMatch = req.method === "GET" ? matchConventionalBookingRoute(url.pathname) : null;
    if (bookingPageMatch) {
      // ADR-0070/0080: booking records are never public. Unlike /stays/*,
      // these routes need the owner's browser session and re-check ownership.
      const session = resolveBrowserSession(env, browserSessions, readGuestSession(req), sessionScopedGuestPrincipals ? undefined : app.environment.config.guestId);
      if (!session) { sendPageError(req, res, 401, "AUTHENTICATION_REQUIRED"); return; }
      let recordId: string;
      try { recordId = decodeURIComponent(bookingPageMatch.encodedId); } catch { sendPageError(req, res, 400, "INVALID_BOOKING_LINK"); return; }
      const principal: CommandPrincipal = { id: session.principalId, role: "guest", tenantId: session.tenantId };
      const bookingPage = app.conventionalBookingPage(bookingPageMatch.kind, recordId, principal);
      if (!bookingPage) { sendPageError(req, res, 404, "BOOKING_RECORD_NOT_FOUND"); return; }
      res.writeHead(200, GUEST_HTML_HEADERS);
      res.end(renderConventionalBookingHtml(bookingPage));
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
      if (!session) { sendPageError(req, res, 401, "AUTHENTICATION_REQUIRED"); return; }
      let offerId: string;
      try { offerId = decodeURIComponent(paymentPageMatch[1]!); } catch { sendPageError(req, res, 400, "INVALID_OFFER"); return; }
      try {
        const principal: CommandPrincipal = { id: session.principalId, role: "guest", tenantId: session.tenantId };
        const artifact = app.environment.cardPaymentApp.getArtifact(offerId, principal);
        const processing = artifact.facts.journeyStage === "stay_payment_processing" || artifact.facts.journeyStage === "deposit_payment_processing";
        const status = guestPaymentStatus(artifact.facts.status, processing);
        const contactEmailMissing = !app.environment.guestContactApp.get(principal)?.contactEmail;
        const threadId = findGuestThreadForOffer(app.environment, offerId, principal);
        const href = contactEmailMissing && artifact.facts.status === "ready"
          ? "/guest/contact?kind=email"
          : processing && threadId
            ? `/?threadId=${encodeURIComponent(threadId)}`
            : `/payments/offers/${encodeURIComponent(offerId)}/continue`;
        const label = contactEmailMissing && artifact.facts.status === "ready"
          ? "Add email address to continue"
          : processing
            ? "Return to booking status"
            : options.localPayment
              ? "Continue to local demo payment"
              : "Continue to hosted card checkout";
        const canContinue = artifact.actions.length > 0 && (artifact.facts.status !== "ready" || contactEmailMissing || !processing);
        const escapeHtmlText = escapeHtml;
        const componentAmount = artifact.facts.currentComponentAmountKobo ?? (artifact.facts.status === "ready" ? artifact.facts.allInStayTotalKobo : artifact.facts.refundableSecurityDepositKobo);
        const componentLabel = artifact.facts.status === "deposit_required" || artifact.facts.currentComponent === "security_deposit" ? `Next payment · ${GUEST_GLOSSARY.refundableSecurityDeposit}` : "Next payment · stay payment";
        const facts = [
          `<p class="payment-unit">${escapeHtmlText(artifact.facts.unit)}</p>`,
          `<p>Stay: ${escapeHtmlText(formatStayDates(artifact.facts.checkIn, artifact.facts.checkOut))}</p>`,
          ...(artifact.facts.allInStayTotalKobo === undefined ? [] : [`<p>${GUEST_GLOSSARY.allInStayTotal}: ${formatNgnKobo(artifact.facts.allInStayTotalKobo)}</p>`]),
          ...(artifact.facts.refundableSecurityDepositKobo === undefined || artifact.facts.refundableSecurityDepositKobo <= 0 ? [] : [`<p>${GUEST_GLOSSARY.refundableSecurityDeposit} (separate): ${formatNgnKobo(artifact.facts.refundableSecurityDepositKobo)}</p>`]),
          `<p class="ui-money-total">Total to complete booking: ${formatNgnKobo(artifact.facts.amountDueNowKobo)}</p>`,
          ...(componentAmount === undefined ? [] : [`<p>${componentLabel}: ${formatNgnKobo(componentAmount)}</p>`]),
          `<p>${formatWAT(artifact.facts.paymentWindowExpiresAt)}</p>`,
          `<p>${escapeHtmlText(status.detail)}</p>`,
        ].join("");
        res.writeHead(200, GUEST_HTML_HEADERS);
        res.end(pageShell({
          title: `${status.label} · Shortlet`,
          width: "narrow",
          style: ".payment-unit{font-family:var(--font-display);font-size:var(--font-size-h3);line-height:var(--font-line-h3);font-weight:600}.ui-panel p{margin:0}",
          body: `<header class="ui-page__header"><p class="ui-eyebrow">Booking payment</p><h1>${escapeHtmlText(status.label)}</h1></header><section class="ui-panel">${facts}${canContinue ? `<a class="ui-button ui-button--primary ui-button--block" href="${href}">${label}</a>` : ""}</section>`,
        }));
      } catch { sendPageError(req, res, 404, "PAYMENT_OFFER_NOT_FOUND"); }
      return;
    }

    const continuationMatch = /^\/payments\/offers\/([^/]+)\/continue$/.exec(url.pathname);
    if (req.method === "GET" && continuationMatch) {
      // ADR-0087: payment initialization is a server-owned continuation, not
      // a browser-selected amount, currency, reference, callback, or URL.
      const session = resolveBrowserSession(env, browserSessions, readGuestSession(req), sessionScopedGuestPrincipals ? undefined : app.environment.config.guestId);
      if (!session) { sendPageError(req, res, 401, "AUTHENTICATION_REQUIRED"); return; }
      let offerId: string;
      try { offerId = decodeURIComponent(continuationMatch[1]!); } catch { sendPageError(req, res, 400, "INVALID_OFFER"); return; }
      try {
        const principal: CommandPrincipal = { id: session.principalId, role: "guest", tenantId: session.tenantId };
        if (options.localPayment) {
          app.environment.cardPaymentApp.getArtifact(offerId, principal);
          const checkout = app.environment.cardPaymentApp.manager.getCheckoutSession(offerId) ?? app.environment.cardPaymentApp.initializeCheckout(offerId, principal);
          res.writeHead(303, { Location: `/payments/local/checkout?reference=${encodeURIComponent(checkout.pspReference)}` }); res.end();
          return;
        }
        if (!paystackClient) { sendPageError(req, res, 503, "PAYSTACK_UNAVAILABLE"); return; }
        const checkout = await app.environment.cardPaymentApp.initializePaystackCheckout(offerId, principal, paystackClient);
        if (!isApprovedPaystackCheckoutUrl(checkout.checkoutUrl)) { sendPageError(req, res, 502, "INVALID_CHECKOUT_URL"); return; }
        res.writeHead(303, { Location: checkout.checkoutUrl }); res.end();
      } catch {
        sendPageError(req, res, 400, "PAYMENT_CONTINUATION_REJECTED");
      }
      return;
    }

    if (options.localPayment && req.method === "GET" && url.pathname === "/payments/local/checkout") {
      const session = resolveBrowserSession(env, browserSessions, readGuestSession(req), sessionScopedGuestPrincipals ? undefined : app.environment.config.guestId);
      const reference = url.searchParams.get("reference");
      const checkout = reference ? app.environment.cardPaymentApp.manager.getCheckoutSessionByReference(reference) : null;
      if (!session || !reference || !checkout) { sendPageError(req, res, 400, "LOCAL_PAYMENT_INVALID"); return; }
      res.writeHead(200, GUEST_HTML_HEADERS);
      res.end(pageShell({
        title: "Local demo payment",
        width: "narrow",
        body: `<header class="ui-page__header"><p class="ui-eyebrow">Local pilot only</p><h1>Local demo payment</h1><p>This deterministic local provider verifies the authoritative amount without collecting card details.</p></header><form class="ui-panel" method="post" action="/payments/local/complete"><input type="hidden" name="reference" value="${reference.replace(/[&<>'"]/g, "")}"><button class="ui-button ui-button--primary ui-button--block" type="submit">Complete local payment</button></form>`,
      }));
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
        let submittedValue = "";
        const contactKind = url.pathname.endsWith("/phone") ? "phone" : "email";
        try {
          const form = await readFormBody(req);
          const expectedRevision = Number(form.get("expectedRevision"));
          if (contactKind === "phone") { submittedValue = form.get("phoneNumber") ?? ""; app.environment.guestContactApp.submitPhone({ phoneNumber: submittedValue, ...(Number.isInteger(expectedRevision) ? { expectedRevision } : {}) }, contactPrincipal); }
          else { submittedValue = form.get("contactEmail") ?? ""; app.environment.guestContactApp.submitEmail({ contactEmail: submittedValue, ...(Number.isInteger(expectedRevision) ? { expectedRevision } : {}) }, contactPrincipal); }
          res.writeHead(303, { Location: "/guest/contact" }); res.end(); return;
        } catch (error) {
          res.writeHead(400, GUEST_HTML_HEADERS);
          res.end(renderGuestContactHtml(app.environment.guestContactApp.get(contactPrincipal), error instanceof Error ? error.message : "Contact could not be saved", contactKind, contactKind === "phone" ? { phoneNumber: submittedValue } : { contactEmail: submittedValue }));
          return;
        }
      }
    }

    if (url.pathname === "/conversation" && (req.method === "GET" || req.method === "POST")) {
      // Issue 06c / ADR-0080: the composer works without JavaScript. The turn
      // runs through the same handleTurn as /api/turn, and the browser session
      // must own the thread (ADR-0070). Message text is never logged (ADR-0075).
      const session = resolveBrowserSession(env, browserSessions, readGuestSession(req), sessionScopedGuestPrincipals ? undefined : app.environment.config.guestId);
      if (req.method === "GET") {
        if (!session) { sendPageError(req, res, 401, "AUTHENTICATION_REQUIRED"); return; }
        // Issue 13a: no thread id starts a new, empty conversation. Only an id
        // is minted; nothing is written and no earlier work changes (ADR-0079).
        if (!url.searchParams.has("threadId")) {
          res.writeHead(303, { Location: `/conversation?threadId=${encodeURIComponent(`g-${crypto.randomUUID()}`)}` });
          res.end();
          return;
        }
        const threadId = url.searchParams.get("threadId") ?? "";
        if (!THREAD_ID_PATTERN.test(threadId)) { sendPageError(req, res, 400, "INVALID_CONVERSATION"); return; }
        const state = session.threadIds.has(threadId) ? app.getState(threadId) : undefined;
        const committedWork = app.committedWork({ id: session.principalId, role: "guest", tenantId: session.tenantId });
        res.writeHead(200, GUEST_HTML_HEADERS);
        res.end(renderNoScriptConversationHtml({ threadId, timeline: state?.timeline ?? [], surfaces: state?.surfaces ?? [], journey: state?.journey, committedWork }));
        return;
      }
      if (!browserOriginAccepted(req, options.publicOrigin)) { res.writeHead(403); res.end("Origin rejected"); return; }
      let form: URLSearchParams;
      try { form = await readFormBody(req); } catch { sendPageError(req, res, 400, "INVALID_CONVERSATION"); return; }
      const submittedThreadId = form.get("threadId") ?? "";
      if (submittedThreadId !== "" && !THREAD_ID_PATTERN.test(submittedThreadId)) { sendPageError(req, res, 400, "INVALID_CONVERSATION"); return; }
      const threadId = submittedThreadId === "" ? `g-${crypto.randomUUID()}` : submittedThreadId;
      if (!session || !bindBrowserThread(app.environment, browserSessions, req, threadId, true)) { sendPageError(req, res, 401, "AUTHENTICATION_REQUIRED"); return; }
      const text = form.get("message") ?? "";
      if (text.trim() === "" || text.length > MAX_TURN_TEXT_LENGTH) {
        const state = app.getState(threadId);
        res.writeHead(400, GUEST_HTML_HEADERS);
        res.end(renderNoScriptConversationHtml({ threadId, timeline: state?.timeline ?? [], surfaces: state?.surfaces ?? [], journey: state?.journey, error: "Type a short message to send.", draft: text.slice(0, MAX_TURN_TEXT_LENGTH) }));
        return;
      }
      const result = await app.handleTurn(threadId, text);
      if (!result.ok) {
        // The same rejection the JavaScript client announces, keeping the draft.
        const state = app.getState(threadId);
        res.writeHead(422, GUEST_HTML_HEADERS);
        res.end(renderNoScriptConversationHtml({ threadId, timeline: state?.timeline ?? [], surfaces: state?.surfaces ?? [], journey: state?.journey, error: result.message, draft: text }));
        return;
      }
      // Post/redirect/get: refreshing the transcript never re-sends the turn.
      res.writeHead(303, { Location: `/conversation?threadId=${encodeURIComponent(threadId)}` });
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/committed-work") {
      // Issue 13a: principal-scoped, never keyed by a client-supplied thread id.
      const session = resolveBrowserSession(app.environment, browserSessions, readGuestSession(req), sessionScopedGuestPrincipals ? undefined : app.environment.config.guestId);
      if (!session) {
        sendJson(res, 401, { ok: false, code: "AUTHENTICATION_REQUIRED", message: "Conversation access requires an active browser session." });
        return;
      }
      sendJson(res, 200, { ok: true, committedWork: app.committedWork({ id: session.principalId, role: "guest", tenantId: session.tenantId }) });
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
