import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type {
  HttpRequestLike,
  HttpResponseLike,
} from "../../../packages/platform-core/src/http-like.js";
import { createHash, timingSafeEqual } from "node:crypto";
import {
  A2UI_V091_BASIC_CATALOG_ID,
  type A2UIComponent,
  type A2UIServerMessage,
  type JsonObject,
} from "@cylayo/weaver-core";
import type { WebServerEventHandoff } from "@cylayo/weaver-web";
import type {
  CommandPrincipal,
  TransitionTelemetryEvent,
} from "../../../packages/platform-core/src/index.js";
import type { AssetLoader } from "../../../packages/platform-core/src/asset-loader.js";
import { nodeAssetLoader } from "../../../packages/platform-core/src/node-asset-loader.js";
import { GUEST_HTML_SECURITY_HEADERS } from "../../../packages/platform-core/src/security-headers.js";
import { createGuestShell, type StaticAsset } from "./guest-shell.js";
import { extendedStayDraftFacts } from "../../web-agent/src/extended-stay-presentation.js";
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
  COMMERCE_CHECKOUT_CONFIRM_ACTION,
  COMPARE_UNIT_EVENT,
  DRAFT_REPLACEMENT_ACCEPT_EVENT,
  DRAFT_REPLACEMENT_KEEP_EVENT,
  draftReplacementToA2UI,
  draftReplacementFallback,
  type DraftStayTerms,
  COMPARE_BACK_EVENT,
  compareArtifactToA2UI,
  compareFallbackText,
  formatNgnKobo,
  formatBookingDeadline,
  formatStayDates,
  guestRequestStatus,
  guestPaymentStatus,
  GUEST_FACT_LABELS,
  GUEST_GLOSSARY,
  GUEST_JOURNEY,
  GUEST_RECEIPTS,
  unitTiles,
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
import { unitDetailArtifactFromProjection, unitDetailArtifactId } from "../../../apps/web/src/unit-detail-artifact.js";
import {
  errorPage,
  escapeHtml,
  icon,
  pageShell,
  prefersHtml,
} from "../../../apps/web/src/ui-kit.js";
import {
  appFrameHtml,
  bankDetailsCardHtml,
  deadlineBannerHtml,
  formatWAT,
  paymentChoiceHtml,
  paymentLayoutHtml,
  paymentOutcomeBannerHtml,
  paymentRecoveryActionsHtml,
  paymentScreenHtml,
  priceBreakdownHtml,
  stayCardHtml,
  stayTicketHtml,
  transferSummaryHtml,
  uploadCardHtml,
  type KitStatusTone,
  unitAboutHtml,
  unitIndicativePriceHtml,
  unitTilesHtml,
  type StayTicketFacts,
} from "./guest-kit.js";
import { resolveDiscoveryServerEvent } from "../../../apps/web/src/discovery-actions.js";
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
import {
  CARD_PAYMENT_INITIALIZE_CHECKOUT_EVENT,
  resolveCardPaymentServerEvent,
} from "../../../apps/web/src/card-payment-actions.js";
import {
  createStayQuote,
  isEligibleUnit,
  normalizePhotoUrls,
  type Unit,
} from "../../../domains/shortlet/src/index.js";
import {
  LISTING_GALLERY_STYLE,
  listingGalleryHtml,
} from "./listing-gallery.js";
import {
  requestDraftArtifactFromProjection,
  requestDraftArtifactId,
} from "../../../apps/web/src/request-draft-artifact.js";
import type { RequestDraftArtifact } from "../../../apps/web/src/request-draft-artifact.js";
import {
  draftScreenContent,
  requestScreenContent,
  type RequestScreenContent,
} from "../../web-agent/src/request-presentation.js";
import {
  appBarHtml,
  confirmationScreenHtml,
  offerScreenHtml,
  railHtml,
  requestScreenHtml,
  signInOfferHtml,
  type SignInOfferContent,
} from "./guest-kit.js";
import {
  paymentScreenContent,
  type PaymentScreenContent,
} from "../../web-agent/src/payment-presentation.js";
import {
  offerScreenContent,
  type OfferScreenContent,
} from "../../web-agent/src/offer-presentation.js";
import {
  confirmationContent,
  type ConfirmationContent,
} from "../../web-agent/src/confirmation-presentation.js";
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
  type PersistedAssistantContext,
  type GuestPersistentProjection,
} from "./guest-projection.js";
import {
  anonymousGuestIdentity,
  authorizesPrincipalOwner,
  authorizesBookingRequest,
  hashSessionSecret,
  type GuestIdentity,
} from "../../../domains/shortlet/src/index.js";
import { multipartBoundary, multipartFile } from "./multipart.js";
import { DEFAULT_RECEIPT_MAX_BYTES } from "./fixture.js";
import { createPlatformCommandEnvelope as createManualTransferCommand } from "../../../packages/platform-core/src/index.js";
import {
  ManualTransferError,
  type ManualTransfer,
} from "../../../domains/shortlet/src/index.js";
import {
  BankTransferProviderError,
  type BankTransferCheckoutSession,
} from "../../../domains/shortlet/src/index.js";
import {
  applyCriteriaEdit,
  budgetLabel,
  quickRepliesFor,
  searchAreaFor,
  SEARCH_AREAS,
  type CriteriaEdit,
} from "./concierge.js";
import {
  amenityQuestions,
  extractStayRequestFacts,
  formatGuestDay,
  mergeStayRequestContext,
  resolveStayRequestContext,
  stayChangeRequested,
  unsupportedPreferenceNote,
  viewResultIntent,
  type DiscoverySearchContext,
  type StayRequestFilters,
} from "./concierge.js";
import {
  handleGeminiTurn,
  type GeminiConciergeClient,
} from "./gemini-concierge.js";
import type { Content } from "@google/genai";
import {
  AssistantRuntime,
  type AssistantControlOutcome,
  type AssistantShortletRestoreInput,
  type AssistantTaskRailEntry,
  type AssistantVertical,
} from "./assistant/assistant-runtime.js";
import { ASSISTANT_CONTROL_COPY } from "./assistant/control-copy.js";
import type { AssistantStayReference, AssistantTaskState } from "./assistant/assistant-state.js";
import { redactSensitiveData } from "../../../packages/platform-core/src/redaction.js";
import {
  TASK_START_EVENT,
  TASK_SWITCH_EVENT,
} from "./assistant/assistant-platform.js";
import { ScriptedAssistantModel } from "./assistant/scripted-assistant-model.js";
import {
  createConciergeModelClient,
  loadConciergeConfiguration,
} from "./assistant/concierge-configuration.js";
import {
  BudgetedModelClient,
  type ModelCallBudget,
} from "./assistant/model-call-budget.js";
import type { AssistantModelClient } from "./assistant/assistant-model.js";
import {
  ASSISTANT_CONFIRM_ACTION_EVENT,
  ASSISTANT_CANCEL_ACTION_EVENT,
} from "./assistant/pending-action-a2ui.js";
import { GUEST_ACCOUNT_COPY, GUEST_ASSISTANT_COPY } from "../../web-agent/src/guest-content.js";
import { SqliteGuestContactRepository, type GuestContactSource } from "../../../domains/shortlet/src/index.js";
import {
  GuestContactOwnedByAccountError,
  normalizeNigerianPhoneNumber,
  type GuestAccount,
} from "../../../domains/shortlet/src/index.js";
import { SlidingWindowRateLimiter } from "../../pilot/src/rate-limiter.js";
import type { ConditionalBookingOffer } from "../../../domains/shortlet/src/index.js";
import {
  GUEST_ACCOUNT_POLICY_DEFAULTS,
  GuestAccountAuthorityError,
  normalizeContactEmail,
  revokeGuestAccountWithoutKey,
  type GuestAccountSession,
} from "../../../domains/shortlet/src/index.js";
import {
  renderOfferNotFoundHtml,
  renderAccountHtml,
  renderEmailChangeCodeHtml,
  ACCOUNT_PAGE_HEADERS,
  accountNoticeFrom,
  type AccountPageInput,
  renderRateLimitedHtml,
  renderSignInCodeHtml,
  renderSignInHtml,
  renderSignInUnavailableHtml,
  type AccountFormError,
} from "./guest-account-pages.js";

export function committedWorkScope(
  env: LocalGuestEnvironment,
  principal: CommandPrincipal,
  identity?: GuestIdentity,
): readonly string[] | null {
  if (
    principal.role !== "guest" ||
    !principal.id ||
    !principal.tenantId ||
    principal.tenantId !== env.config.tenantId
  )
    return null;
  if (identity?.accountGuestId !== undefined) {
    return identity.tenantId === principal.tenantId &&
      identity.principalIds.includes(principal.id)
      ? identity.principalIds
      : null;
  }
  return principal.id === env.guestPrincipal().id ? [principal.id] : null;
}

export interface GuestSurfacePayload {
  readonly surfaceId: string;
  readonly a2uiMessages: readonly A2UIServerMessage[];
  readonly mode?: "text" | "inline-surface" | "focused-surface";
  readonly status?:
    | "active"
    | "superseded"
    | "stale"
    | "expired"
    | "deleted"
    | "fallback";
  readonly summary?: string;
  readonly textFallback?: string;
  readonly conventionalRoute?: string;
  readonly conventionalRouteLabel?: string;
  /** Issue 10: present only while the Guest waits on a server-owned deadline. */
  readonly waiting?: GuestWaitingState;
  readonly requestScreen?: RequestScreenContent;
  readonly confirmation?: ConfirmationContent;
  readonly offerScreen?: OfferScreenContent;
  /** Issue 09: the shared payment screen content for a pending card payment. */
  readonly paymentScreen?: PaymentScreenContent;
  /** Issue 08: the sign-in offer after a request is sent or a booking is confirmed; computed per response, never stored. */
  readonly signInOffer?: SignInOfferContent;
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

/** Slice 26: a task in the shell task rail, projected from the assistant runtime. */
export type GuestTask = AssistantTaskRailEntry;
/** Slice 26: a registered vertical offered by a starter card. */
export type GuestVertical = AssistantVertical;

export interface GuestStateSnapshot {
  readonly ok: true;
  readonly threadId: string;
  readonly timeline: readonly GuestTimelineEntry[];
  readonly surfaces: readonly GuestSurfacePayload[];
  /** Issue 08: the journey rail, derived from authoritative state on every read. */
  readonly journey?: GuestJourney;
  readonly criteria?: GuestCriteria;
  /** Slice 26: the shell task rail, present only when the assistant runtime has tasks. */
  readonly tasks?: readonly GuestTask[];
  readonly verticals?: readonly GuestVertical[];
}

export interface GuestTurnSuccess {
  readonly discardUserInput?: boolean;
  /** Indicates that the AssistantRuntime owns this turn's in-memory conversation state. */
  readonly assistantManaged?: boolean;
  readonly assistantControlOutcome?: AssistantControlOutcome;
  readonly ok: true;
  readonly messages: readonly string[];
  /** Completed-action receipts, rendered as quiet timeline markers. */
  readonly receipts?: readonly string[];
  readonly surfaces: readonly GuestSurfacePayload[];
  readonly journey?: GuestJourney;
  readonly criteria?: GuestCriteria;
  /** Issue 11 AC3: one-tap answers to the criterion the reply just asked for. */
  readonly quickReplies?: readonly string[];
  /** Slice 26: the shell task rail, present only when the assistant runtime has tasks. */
  readonly tasks?: readonly GuestTask[];
  readonly verticals?: readonly GuestVertical[];
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
  readonly when?: {
    readonly checkIn?: string;
    readonly nights?: number;
    readonly label: string;
  };
  readonly guests?: { readonly count: number; readonly label: string };
  /** Issue 03b: always an All-In Stay Total comparison; "About" until it can be quoted. */
  readonly budget?: {
    readonly naira: number;
    readonly per: "stay" | "night";
    readonly label: string;
  };
  readonly areas: readonly { readonly id: string; readonly label: string }[];
}

export interface GuestRejection {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
}

export type GuestTurnResult = GuestTurnSuccess | GuestRejection;

/** Issue 06b: the booking records that have an owner-checked conventional page (ADR-0080). */
export type ConventionalBookingPageKind =
  | "draft"
  | "request"
  | "offer"
  | "contract";

/** Issue 13a: a live request, offer or Reservation in one of the Guest's threads. */
export interface GuestCommittedWork {
  readonly kind: GuestCommittedWorkKind;
  readonly threadId: string;
  readonly route: string;
  readonly unitTitle?: string;
}

export interface ConventionalBookingPage {
  readonly threadId: string;
  /** The thread's journey rail, from the same projection the chat uses. */
  readonly journey?: GuestJourney;
  readonly summary: string;
  readonly textFallback: string;
  readonly stay?: ConventionalStayDetails;
  readonly requestScreen?: RequestScreenContent;
  readonly confirmation?: ConfirmationContent;
  readonly offerScreen?: OfferScreenContent;
  /** Issue 08: shown beneath the request-sent or confirmation screen, for an anonymous browser only. */
  readonly signInOffer?: SignInOfferContent;
}

export interface ConventionalStayDetails {
  readonly unitTitle: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly nights: number;
  readonly guestCount: number;
  readonly allInStayTotalKobo?: number;
  readonly refundableSecurityDepositKobo?: number;
  readonly amountDueNowKobo?: number;
  /** True while the amount is due only once the owner accepts: a request, or its review before sending. */
  readonly amountDueNowIsConditional?: boolean;
  readonly amountPaidKobo?: number;
}

export type GuestStayTicketFacts = StayTicketFacts;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Fails closed unless the record's Primary Guest and tenant are the principal's (ADR-0070). */
function primaryGuestIs(record: unknown, principal: CommandPrincipal): boolean {
  if (!isPlainRecord(record) || !isPlainRecord(record.primaryGuest))
    return false;
  const guestId = record.primaryGuest.id;
  return (
    typeof guestId === "string" &&
    !!principal.id &&
    guestId === principal.id &&
    typeof record.tenantId === "string" &&
    !!principal.tenantId &&
    record.tenantId === principal.tenantId
  );
}

const DISCOVERY_STAGE = "discovery";
const UNIT_STAGE = "unit";
const REQUEST_STAGE = "request";
const OFFER_STAGE = "offer";
const PAYMENT_STAGE = "payment";
const BOOKING_STAGE = "booking";
/** Issue 13b: the two-up comparison opened from results. */
const COMPARE_STAGE = "compare";
/** Issue 14: a proposed replacement Request Draft awaiting the Guest's choice. */
const DRAFT_REPLACEMENT_STAGE = "draft_replacement";

function unitDetailSurfaceId(
  threadId: string,
  discoveryRevision: number,
): string {
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
  return JSON.stringify([
    context?.city ?? null,
    context?.neighbourhood ?? null,
    context?.checkIn ?? null,
    context?.nights ?? null,
    context?.datesConfirmed ?? null,
    context?.partySize ?? null,
    context?.bedrooms ?? null,
    context?.pendingLocationChange?.label ?? null,
    context?.budget?.kobo ?? null,
    context?.budget?.per ?? null,
  ]);
}

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** An input sanity bound (safe kobo arithmetic), not a pricing policy. */
const MAX_BUDGET_NAIRA = 1_000_000_000;

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

/** Reads one strip edit; anything but the exact expected shape fails closed (ADR-0072). */
function readCriteriaEdit(
  context: Readonly<Record<string, unknown>>,
): CriteriaEdit | null {
  const keys = Object.keys(context).sort().join(",");
  if (
    context.field === "where" &&
    keys === "area,basedOn,field" &&
    typeof context.area === "string"
  )
    return { field: "where", area: context.area };
  if (
    context.field === "when" &&
    keys === "basedOn,checkIn,field,nights" &&
    typeof context.checkIn === "string" &&
    CALENDAR_DATE.test(context.checkIn) &&
    !Number.isNaN(Date.parse(`${context.checkIn}T00:00:00Z`)) &&
    new Date(`${context.checkIn}T00:00:00Z`)
      .toISOString()
      .startsWith(context.checkIn) &&
    isPositiveInteger(context.nights)
  ) {
    return { field: "when", checkIn: context.checkIn, nights: context.nights };
  }
  if (
    context.field === "guests" &&
    keys === "basedOn,field,partySize" &&
    isPositiveInteger(context.partySize)
  )
    return { field: "guests", partySize: context.partySize };
  // Issue 03b: a whole-naira budget, for the stay or per night; `clear` removes it.
  if (
    context.field === "budget" &&
    keys === "basedOn,field,naira,per" &&
    isPositiveInteger(context.naira) &&
    context.naira <= MAX_BUDGET_NAIRA &&
    (context.per === "stay" || context.per === "night")
  ) {
    return {
      field: "budget",
      budget: { kobo: context.naira * 100, per: context.per },
    };
  }
  if (
    context.field === "budget" &&
    keys === "basedOn,clear,field" &&
    context.clear === true
  )
    return { field: "budget", budget: null };
  return null;
}
const SHELL_TELEMETRY_EVENTS = [
  "text-response-rendered",
  "inline-surface-rendered",
  "focused-surface-opened",
  "focused-surface-closed",
  "surface-replaced",
  "stale-surface-encountered",
  "expired-surface-encountered",
  "fallback-rendered",
  "conventional-route-fallback",
  "weaver-rendering-failure",
] as const;
type ShellTelemetryEvent = (typeof SHELL_TELEMETRY_EVENTS)[number];

/**
 * Explicit local allow-list of Weaver-generated action events (ADR-0072).
 * Everything else fails closed.
 */
const EVENT_STAGE_ALLOW_LIST: Readonly<Record<string, string>> = Object.freeze({
  "shortlet.discovery.view-unit": DISCOVERY_STAGE,
  [SEE_ALL_DISCOVERY_EVENT]: DISCOVERY_STAGE,
  [COMPARE_UNIT_EVENT]: DISCOVERY_STAGE,
  [COMPARE_BACK_EVENT]: COMPARE_STAGE,
  [DRAFT_REPLACEMENT_ACCEPT_EVENT]: DRAFT_REPLACEMENT_STAGE,
  [DRAFT_REPLACEMENT_KEEP_EVENT]: DRAFT_REPLACEMENT_STAGE,
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

export const THREAD_ID_PATTERN = /^g-[a-f0-9-]{6,64}$/;

/** Where the Guest is in the journey, for stage-aware free-text replies (issue 04a). */
type GuestStage =
  | "discovery"
  | "unit"
  | "draft"
  | "request"
  | "offer"
  | "payment"
  | "booking";

interface GuestThreadState {
  readonly threadId: string;
  readonly geminiHistory: Content[];
  discoveryContext: DiscoverySearchContext | null;
  discoveryArtifact: DiscoveryArtifactProjection | null;
  /** ADR 0106: the id the guest's current discovery card names; a cold restore keeps it (see `#assistantContextSearch`). */
  discoveryArtifactId: string | null;
  discoverySurfaceId: string;
  discoveryRevision: number;
  unitDetail: { readonly unitId: string; readonly artifactId: string } | null;
  requestId: string | null;
  draftId: string | null;
  draftQuote: {
    readonly allInStayTotalKobo: number;
    readonly refundableSecurityDepositKobo: number;
    readonly amountDueNowKobo: number;
  } | null;
  offerId: string | null;
  activeSurfaces: Map<string, string>;
  supersededSurfaces: Set<string>;
  geminiLastSearch: {
    readonly surfaceId: string;
    readonly a2uiMessages: readonly A2UIServerMessage[];
  } | null;
  timeline: GuestTimelineEntry[];
  lastSurfaces: GuestSurfacePayload[];
  /** Issue 03a: the criteria of each executed search, oldest first (for "Undo last change"). */
  searchHistory: DiscoverySearchContext[];
  assistantContext: PersistedAssistantContext | null;
  /** Issue 13b: the result picked for comparison. Presentation only, never persisted. */
  compareSelection: string | null;
  /** Issue 14: a change to the draft's stay that awaits a date confirmation. In memory only. */
  draftChangeContext: DiscoverySearchContext | null;
  /** Issue 14: the proposed replacement Request Draft. In memory only; a restart shows the current draft. */
  pendingDraftReplacement: PendingDraftReplacement | null;
}

function isDiscoveryArtifactProjection(value: unknown): value is DiscoveryArtifactProjection {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.kind !== "string" || typeof record.schemaVersion !== "string" || typeof record.projectionVersion !== "number" || !Array.isArray(record.actions)) return false;
  if (typeof record.facts !== "object" || record.facts === null || Array.isArray(record.facts)) return false;
  return Array.isArray((record.facts as Record<string, unknown>).results);
}

/** The stay a replacement Request Draft would cover (issue 14). */
interface DraftReplacementStay {
  readonly location: string;
  readonly neighbourhood?: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly partySize: number;
}

interface PendingDraftReplacement {
  readonly basedOnDraftId: string;
  readonly basedOn: string;
  readonly unitId: string;
  readonly stay: DraftReplacementStay;
  readonly filters: StayRequestFilters;
  readonly context: DiscoverySearchContext;
  readonly proposed: DraftStayTerms;
  readonly surfaceId: string;
}

export class LocalGuestApp {
  #environment: LocalGuestEnvironment;
  readonly #threads = new Map<string, GuestThreadState>();
  readonly #geminiClient: GeminiConciergeClient | null;
  readonly #assistantRuntime: AssistantRuntime | null;
  readonly #modelCallBudget: ModelCallBudget | null;

  constructor(
    environment: LocalGuestEnvironment,
    options: {
      readonly geminiClient?: GeminiConciergeClient;
      readonly assistantRuntime?: AssistantRuntime;
      /** Issue 19: once the daily cap is spent, new turns use the deterministic concierge (ADR 0080). */
      readonly modelCallBudget?: ModelCallBudget;
    } = {},
  ) {
    this.#environment = environment;
    this.#geminiClient = options.geminiClient ?? null;
    this.#assistantRuntime = options.assistantRuntime ?? null;
    this.#modelCallBudget = options.modelCallBudget ?? null;
  }

  get environment(): LocalGuestEnvironment {
    return this.#environment;
  }

  get assistantRuntime(): AssistantRuntime | null {
    return this.#assistantRuntime;
  }

  #taskRailFor(threadId: string): readonly GuestTask[] {
    return this.#assistantRuntime?.getTaskRail(threadId) ?? [];
  }

  #resolveStayRequestContext(context: DiscoverySearchContext, now: Date) {
    return resolveStayRequestContext(context, {
      now,
      ...(this.#environment.extendedStayPolicy ? { extendedStayPolicy: this.#environment.extendedStayPolicy } : {}),
    });
  }

  #verticals(): readonly GuestVertical[] {
    return this.#assistantRuntime?.registeredVerticals() ?? [];
  }

  /** Assistant surfaces are authoritative projections; the shell renders them, never as fallback. */
  #assistantSurfaces(surfaces: readonly { readonly surfaceId: string; readonly a2uiMessages: readonly unknown[] }[]): GuestSurfacePayload[] {
    return surfaces.map((surface) => ({
      surfaceId: surface.surfaceId,
      a2uiMessages: surface.a2uiMessages as GuestSurfacePayload["a2uiMessages"],
      status: "active" as const,
    }));
  }

  #assistantResult(output: {
    readonly modelHandled?: boolean;
    readonly discardUserInput?: boolean;
    readonly messages?: readonly string[];
    readonly message?: string;
    readonly surfaces?: readonly { readonly surfaceId: string; readonly a2uiMessages: readonly unknown[] }[];
    readonly tasks?: readonly AssistantTaskRailEntry[];
    readonly controlOutcome?: AssistantControlOutcome;
  }): GuestTurnResult {
    return {
      ok: true,
      // Assistant prompts and model turns are never written to the guest timeline.
      discardUserInput: true,
      assistantManaged: true,
      ...(output.controlOutcome === undefined ? {} : { assistantControlOutcome: output.controlOutcome }),
      messages: output.messages ?? (output.message ? [output.message] : []),
      surfaces: this.#assistantSurfaces(output.surfaces ?? []),
      ...(output.tasks === undefined || output.tasks.length === 0
        ? {}
        : { tasks: output.tasks, verticals: this.#verticals() }),
    };
  }

  async handleTurn(threadId: string, text: string): Promise<GuestTurnResult> {
    await this.#hydrateRemoteContact();
    if (this.#environment.guestDataIsRemote && !this.#threads.has(threadId)) await this.#loadRemoteThread(threadId);
    const storedThread = this.#threads.get(threadId) ?? (this.#environment.guestDataIsRemote ? null : this.#loadThread(threadId));
    if (storedThread) this.#restoreAssistantFromGuestThread(threadId, storedThread);
    const result = await this.#handleTurn(threadId, text);
    const decorated = this.#decorateResult(result);
    if (decorated.ok) {
      this.#rememberResult(threadId, decorated.discardUserInput ? undefined : text, decorated);
      if (this.#environment.guestDataIsRemote) await this.#persistRemoteThread(threadId);
    }
    await this.#flushRemoteContact();
    return this.#withJourney(threadId, decorated);
  }

  async #handleTurn(threadId: string, text: string): Promise<GuestTurnResult> {
    if (!THREAD_ID_PATTERN.test(threadId)) {
      return {
        ok: false,
        code: "INVALID_THREAD",
        message: "Unknown conversation.",
      };
    }

    // ADR 0072/0080: pending confirmations and cancellations are resolved before any model request.
    if (this.#assistantRuntime) {
      const output = await this.#assistantRuntime.handleTurn(threadId, text);
      if (output.ok) {
        if (output.modelHandled) this.#modelCallBudget?.recordTurn("model");
        return this.#assistantResult(output);
      }
      if (!output.providerUnavailable) {
        return {
          ok: false,
          code: output.code ?? "CONCIERGE_UNAVAILABLE",
          message: output.message ?? "The assistant is unavailable.",
        };
      }
    }

    if (this.#assistantRuntime) this.#modelCallBudget?.recordTurn("fallback");

    const thread =
      this.#threads.get(threadId) ??
      (this.#environment.guestDataIsRemote ? null : this.#loadThread(threadId)) ??
      this.#createThread(threadId);
    const refreshed = this.#refreshWorkflow(thread);
    // Issue 04a AC1: every message gets a reply for the stage the Guest is in,
    // including when a refresh re-presents the current surface.
    const stageReply = this.#stageReply(thread, text);
    if (refreshed) {
      if (!refreshed.ok) return refreshed;
      const messages = [...refreshed.messages, ...(stageReply ?? [])];
      return {
        ...refreshed,
        messages:
          messages.length > 0
            ? messages
            : [
                this.#capabilityReply(
                  this.#guestStage(thread),
                  this.#currentUnit(thread),
                ),
              ],
      };
    }
    if (stageReply) return { ok: true, messages: stageReply, surfaces: [] };
    const replacement = this.#proposeDraftReplacement(thread, text);
    if (replacement) return replacement;
    if (this.#geminiClient) {
      try {
        const live = await handleGeminiTurn({
          client: this.#geminiClient,
          history: thread.geminiHistory,
          text,
          demoCheckIn: this.#environment.config.demoCheckIn,
          ...(this.#environment.extendedStayPolicy ? { extendedStayPolicy: this.#environment.extendedStayPolicy } : {}),
          now: this.#environment.clock(),
          search: (filters) => {
            this.#prepareDiscovery(thread);
            const adapter = createWeaverWebAgentAdapter({
              query: {
                search: (query) =>
                  this.#environment.discoveryQuery.search(query),
              },
              createSurfaceId: () => thread.discoverySurfaceId,
            });
            const result = adapter.search({ ...filters });
            thread.discoveryArtifact = result.artifact;
            thread.activeSurfaces.set(
              DISCOVERY_STAGE,
              thread.discoverySurfaceId,
            );
            this.#emitTransition(thread, "unit.discovery.results_produced", {
              aggregateType: "discovery",
              aggregateId: result.artifact.id,
              surfaceId: thread.discoverySurfaceId,
            });
            thread.geminiLastSearch = result;
            return {
              resultCount: result.artifact.facts.results.length,
              location: filters.location,
              ...(filters.neighbourhood
                ? { neighbourhood: filters.neighbourhood }
                : {}),
              checkIn: filters.checkIn,
              checkOut: filters.checkOut,
            };
          },
        });
        if (live.kind === "clarify")
          return { ok: true, messages: [live.reply], surfaces: [] };
        const result = thread.geminiLastSearch;
        if (!result)
          throw new Error("Gemini search did not produce a discovery surface");
        return {
          ok: true,
          messages: [live.reply],
          surfaces: [
            {
              surfaceId: result.surfaceId,
              a2uiMessages: result.a2uiMessages,
              mode: "inline-surface",
              summary: discoverySummary(
                thread.discoveryArtifact?.facts.filters,
              ),
              conventionalRoute: conventionalSearchRoute({}),
            },
          ],
        };
      } catch {
        return {
          ok: false,
          code: "CONCIERGE_UNAVAILABLE",
          message:
            "The concierge is temporarily unavailable. Please try again.",
        };
      }
    }

    const previousContext = thread.discoveryContext;
    // Issue 01: dates resolve against the injected clock and are never assumed.
    const facts = extractStayRequestFacts(text, {
      now: this.#environment.clock(),
    });
    const merged = mergeStayRequestContext(previousContext, facts, text);
    thread.discoveryContext = merged.context;
    // Issue 02 AC3: an unfilterable preference is acknowledged on every reply.
    const note = unsupportedPreferenceNote(facts.unsupportedPreferences);
    const acknowledged = (result: GuestTurnResult): GuestTurnResult =>
      note !== undefined && result.ok
        ? { ...result, messages: [...result.messages, note] }
        : result;
    if (merged.conflict) {
      // A location conflict is intentionally surfaced. No search runs until the
      // Guest resolves it, and every other accumulated constraint is retained.
      return acknowledged({
        ok: true,
        messages: [merged.conflict.question],
        surfaces: [],
      });
    }
    const resolution = this.#resolveStayRequestContext(merged.context, this.#environment.clock());
    if (resolution.kind !== "search") {
      // Clarifications, date confirmations and limit refusals never run a search.
      return acknowledged({
        ok: true,
        messages: [resolution.reply],
        surfaces: [],
        ...(resolution.kind === "clarify"
          ? { quickReplies: quickRepliesFor(resolution.next) }
          : {}),
      });
    }

    const providedFacts =
      Object.keys(facts).some((key) => key !== "unsupportedPreferences") ||
      merged.confirmedDates === true;
    const resolvedConflict =
      previousContext?.pendingLocationChange !== undefined &&
      merged.context.pendingLocationChange === undefined;
    if (!providedFacts && !resolvedConflict && thread.discoveryArtifact) {
      // Issue 10 (C4): "show me the apartment" opens a result, or asks which one, instead of being ignored.
      const viewIntent = viewResultIntent(text);
      if (viewIntent)
        return acknowledged(
          this.#viewResultFromChat(
            thread,
            thread.discoveryArtifact,
            viewIntent.position,
          ),
        );
      // An unrelated turn must not replace the current authoritative results.
      return acknowledged({
        ok: true,
        messages: [
          "Your current search results are still active. Tell me how you would like to refine them, for example: “Only show two-bedroom apartments”.",
        ],
        surfaces: [],
      });
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
    const unitId =
      thread.unitDetail?.unitId ??
      (thread.requestId
        ? this.#environment.bookingRequestApp.getArtifact(
            thread.requestId,
            this.#environment.guestPrincipal(),
          ).facts.unitId
        : undefined);
    return unitId === undefined
      ? null
      : (this.#environment.unitRepository.findById(unitId) as Unit | null);
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
    const answers =
      unit === null
        ? []
        : amenityQuestions(text).map((question) => {
            const listed = question.ids.find((id) =>
              unit.amenities.includes(id),
            );
            return listed === undefined
              ? `${question.label} isn't listed for ${unit.title}, so I can't confirm it.`
              : `Yes: ${unit.title} lists ${guestAmenityLabel(listed)}.`;
          });
    const facts = extractStayRequestFacts(text, {
      now: this.#environment.clock(),
    });
    if (stage === "discovery" || stage === "unit" || stage === "draft") {
      // Draft changes belong to issue 14; a turn with new stay facts stays in discovery.
      const hasStayFacts = Object.keys(facts).some(
        (key) => key !== "unsupportedPreferences",
      );
      return answers.length > 0 && !hasStayFacts ? answers : null;
    }
    const change = stayChangeRequested(facts, text)
      ? [this.#changeExplanation(stage, unit)]
      : [];
    const replies = [...change, ...answers];
    return replies.length > 0 ? replies : [this.#capabilityReply(stage, unit)];
  }

  /** ADR-0005/0060: after submission nothing changes silently; say why or how. */
  #changeExplanation(
    stage: "request" | "offer" | "payment" | "booking",
    unit: Unit | null,
  ): string {
    const operator = guestOperatorName(unit?.operator?.name);
    if (stage === "request")
      return `A sent ${GUEST_GLOSSARY.bookingRequest} can't be changed while ${operator} reviews it. If ${operator} confirms, you can choose not to accept the offer at no cost and search again with new details. Nothing has been changed.`;
    if (stage === "offer")
      return `A ${GUEST_GLOSSARY.conditionalBookingOffer} can't be changed. You can choose not to accept it at no cost and search again with new details. Nothing has been changed.`;
    if (stage === "payment")
      return "An accepted offer can't be changed from this conversation. Nothing has been changed.";
    return `Changes to a confirmed ${GUEST_GLOSSARY.reservation} are made as a booking amendment, which re-checks availability and price. I can't start one from this conversation yet. Nothing has been changed.`;
  }

  #capabilityReply(stage: GuestStage, unit: Unit | null): string {
    const about =
      unit === null
        ? ""
        : ` I can also answer questions about ${unit.title}, such as parking or Wi-Fi.`;
    if (stage === "request")
      return `Your ${GUEST_GLOSSARY.bookingRequest} is with ${guestOperatorName(unit?.operator?.name)} for review; the details are in the workspace.${about}`;
    if (stage === "offer")
      return `Your ${GUEST_GLOSSARY.conditionalBookingOffer} is in the workspace. Review it and accept it there if it suits you.${about}`;
    if (stage === "payment")
      return `Your payment step is in the workspace.${about}`;
    if (stage === "booking")
      return `Your booking details are in the workspace.${about}`;
    return `Your current details are in the workspace.${about}`;
  }

  /**
   * Runs the authoritative discovery query for the accumulated context and
   * publishes its DiscoveryArtifact through the existing A2UI/Weaver surface.
   * The conversational layer never manufactures Units, prices or availability.
   */
  #executeDiscovery(
    thread: GuestThreadState,
    filters: StayRequestFilters,
    options: { readonly recordHistory?: boolean } = {},
  ): GuestTurnResult {
    if (options.recordHistory !== false && thread.discoveryContext) {
      thread.searchHistory.push({ ...thread.discoveryContext });
      // A storage bound for the durable projection, not a Guest-facing policy.
      if (thread.searchHistory.length > MAX_SEARCH_HISTORY)
        thread.searchHistory.splice(
          0,
          thread.searchHistory.length - MAX_SEARCH_HISTORY,
        );
    }
    this.#prepareDiscovery(thread);
    const adapter = createWeaverWebAgentAdapter({
      query: {
        search: (query) => this.#environment.discoveryQuery.search(query),
      },
      createSurfaceId: () => thread.discoverySurfaceId,
    });
    const result = adapter.search({ ...filters });
    thread.discoveryArtifact = result.artifact;
    // ADR 0106: the results on screen name this artifact, so a cold restore keeps this id.
    thread.discoveryArtifactId = result.artifact.id;
    thread.activeSurfaces.set(DISCOVERY_STAGE, thread.discoverySurfaceId);
    this.#emitTransition(thread, "unit.discovery.results_produced", {
      aggregateType: "discovery",
      aggregateId: result.artifact.id,
      surfaceId: thread.discoverySurfaceId,
    });

    return {
      ok: true,
      messages: [
        `I found ${result.artifact.facts.results.length} eligible place${result.artifact.facts.results.length === 1 ? "" : "s"} in ${filters.location}${filters.maxPriceKobo === undefined ? "" : ` within your ${formatNgnKobo(filters.maxPriceKobo)} budget (${GUEST_GLOSSARY.allInStayTotal})`} for your stay from ${formatGuestDay(filters.checkIn)} to ${formatGuestDay(filters.checkOut)}. You can view the details below.`,
      ],
      surfaces: [
        {
          surfaceId: result.surfaceId,
          a2uiMessages: result.a2uiMessages,
          mode: "inline-surface",
          summary: discoverySummary({
            location: filters.location,
            neighbourhood: filters.neighbourhood,
            partySize: filters.partySize,
          }),
          textFallback: result.fallback.message,
          conventionalRoute: result.fallback.conventionalRoute,
        },
      ],
    };
  }

  handleEvent(threadId: string, payload: unknown): GuestTurnResult {
    const stored = this.#threads.get(threadId) ?? (this.#environment.guestDataIsRemote ? null : this.#loadThread(threadId));
    if (stored) this.#restoreAssistantFromGuestThread(threadId, stored);
    const result = this.#handleEvent(threadId, payload);
    const decorated = this.#decorateResult(result);
    if (decorated.ok) this.#rememberResult(threadId, undefined, decorated);
    return this.#withJourney(threadId, decorated);
  }

  async handleEventAsync(
    threadId: string,
    payload: unknown,
  ): Promise<GuestTurnResult> {
    await this.#hydrateRemoteContact();
    if (this.#environment.guestDataIsRemote && !this.#threads.has(threadId)) await this.#loadRemoteThread(threadId);
    const stored = this.#threads.get(threadId) ?? (this.#environment.guestDataIsRemote ? null : this.#loadThread(threadId));
    if (stored) this.#restoreAssistantFromGuestThread(threadId, stored);
    const event = readEventPayload(payload);
    if (
      this.#environment.payments &&
      event?.name === "shortlet.card-payment.initialize-checkout"
    ) {
      const result = await this.#handlePaystackCardCheckout(threadId, event);
      const decorated = this.#decorateResult(result);
      if (decorated.ok) {
        this.#rememberResult(threadId, undefined, decorated);
        if (this.#environment.guestDataIsRemote) await this.#persistRemoteThread(threadId);
      }
      await this.#flushRemoteContact();
      return this.#withJourney(threadId, decorated);
    }
    const result = this.#decorateResult(this.#handleEvent(threadId, payload));
    // ADR 0093: keep each durable work projection current for reads through any linked principal; remote compositions persist it below.
    if (result.ok) this.#rememberResult(threadId, undefined, result);
    if (result.ok && this.#environment.guestDataIsRemote) await this.#persistRemoteThread(threadId);
    await this.#flushRemoteContact();
    return this.#withJourney(threadId, result);
  }

  async #handlePaystackCardCheckout(
    threadId: string,
    event: GuestEventPayload,
  ): Promise<GuestTurnResult> {
    if (!this.#environment.payments)
      return {
        ok: false,
        code: "PAYSTACK_UNAVAILABLE",
        message: "Secure card checkout is unavailable.",
      };
    if (!threadId || !THREAD_ID_PATTERN.test(threadId))
      return {
        ok: false,
        code: "INVALID_THREAD",
        message: "Unknown conversation.",
      };
    const thread = this.#threads.get(threadId) ?? (this.#environment.guestDataIsRemote ? null : this.#loadThread(threadId));
    if (!thread)
      return {
        ok: false,
        code: "UNKNOWN_THREAD",
        message: "Unknown conversation.",
      };
    const activeSurfaceId = thread.activeSurfaces.get(PAYMENT_STAGE);
    if (!activeSurfaceId || activeSurfaceId !== event.surfaceId)
      return {
        ok: false,
        code: "STALE_SURFACE",
        message:
          "That action is no longer available; please use the current options.",
      };
    const resolved = resolveCardPaymentServerEvent({
      event: this.#handoff(event),
      application: this.#environment.cardPaymentApp,
      principal: this.#environment.guestPrincipal(),
    });
    if (!resolved.ok) return resolved;
    try {
      const session =
        await this.#environment.cardPaymentApp.initializePaystackCheckout(
          thread.offerId!,
          this.#environment.guestPrincipal(),
          this.#environment.payments,
        );
      const artifact = this.#environment.cardPaymentApp.getArtifact(
        thread.offerId!,
        this.#environment.guestPrincipal(),
      );
      const surfaceId = `thread-${thread.threadId}:payment:checkout:${session.checkoutId}`;
      this.#supersede(thread, PAYMENT_STAGE);
      thread.activeSurfaces.set(PAYMENT_STAGE, surfaceId);
      this.#emitTransition(thread, "payment.handoff.opened", {
        aggregateType: "payment",
        aggregateId: thread.offerId!,
        surfaceId,
      });
      this.#emitTransition(thread, "payment.attempt.initialized", {
        aggregateType: "payment_attempt",
        aggregateId: session.checkoutId,
        correlationId: thread.offerId!,
      });
      const checkoutAmount =
        artifact.facts.currentComponentAmountKobo ??
        artifact.facts.allInStayTotalKobo ??
        artifact.facts.amountDueNowKobo;
      const checkoutPurpose =
        artifact.facts.currentComponent === "security_deposit"
          ? GUEST_GLOSSARY.refundableSecurityDeposit
          : "stay payment";
      return {
        ok: true,
        messages: [
          "Hosted card checkout is ready. Payment has not succeeded; your booking details remain available when you return.",
        ],
        surfaces: [
          {
            surfaceId,
            mode: "focused-surface",
            summary: "Payment handoff",
            conventionalRoute: `/payments/offers/${encodeURIComponent(thread.offerId!)}/continue`,
            conventionalRouteLabel: `Continue to ${checkoutPurpose} · ${formatNgnKobo(checkoutAmount)}`,
            textFallback: `You will leave Shortlet temporarily for hosted card checkout. ${artifact.facts.allInStayTotalKobo === undefined ? "" : `${GUEST_GLOSSARY.allInStayTotal}: ${formatNgnKobo(artifact.facts.allInStayTotalKobo)}. `}${artifact.facts.refundableSecurityDepositKobo ? `${GUEST_GLOSSARY.refundableSecurityDeposit} (separate): ${formatNgnKobo(artifact.facts.refundableSecurityDepositKobo)}. ` : ""}Next payment: ${formatNgnKobo(checkoutAmount)}. ${formatWAT(artifact.facts.paymentWindowExpiresAt)}. Payment has not succeeded and the booking is not confirmed. Your booking details will be retained when you return.`,
            a2uiMessages: cardPaymentArtifactToA2UI({ artifact, surfaceId }),
          },
        ],
      };
    } catch (error) {
      if (
        /email address is required/i.test(
          error instanceof Error ? error.message : "",
        )
      )
        return this.#contactSurface(thread, "email", event.context ?? {});
      return {
        ok: false,
        code: "ACTION_NOT_AUTHORIZED",
        message: "The secure card checkout could not be started.",
      };
    }
  }

  #handleEvent(threadId: string, payload: unknown): GuestTurnResult {
    const event = readEventPayload(payload);
    if (!event) {
      return {
        ok: false,
        code: "INVALID_EVENT",
        message: "The action could not be processed.",
      };
    }
    if (!THREAD_ID_PATTERN.test(threadId)) {
      return {
        ok: false,
        code: "INVALID_THREAD",
        message: "Unknown conversation.",
      };
    }

    if (this.#assistantRuntime) {
      if (
        event.name === ASSISTANT_CONFIRM_ACTION_EVENT ||
        event.name === ASSISTANT_CANCEL_ACTION_EVENT ||
        event.name === TASK_START_EVENT ||
        event.name === TASK_SWITCH_EVENT ||
        event.name === COMMERCE_CHECKOUT_CONFIRM_ACTION
      ) {
        const output = this.#assistantRuntime.handleAssistantEvent(
          threadId,
          event.name,
          event.context,
        );
        if (!output.ok) {
          return {
            ok: false,
            code: output.code ?? "UNSUPPORTED_EVENT",
            message: output.message ?? "The action failed.",
          };
        }
        return this.#assistantResult(output);
      }
    }

    const thread = this.#threads.get(threadId) ?? (this.#environment.guestDataIsRemote ? null : this.#loadThread(threadId));
    if (!thread) {
      return {
        ok: false,
        code: "UNKNOWN_THREAD",
        message: "Unknown conversation.",
      };
    }

    const stage = EVENT_STAGE_ALLOW_LIST[event.name];
    if (!stage) {
      return {
        ok: false,
        code: "UNSUPPORTED_EVENT",
        message: "That action is not available.",
      };
    }
    // The strip exists once the thread has criteria; its freshness is checked by `basedOn`.
    if (stage === CRITERIA_STAGE && thread.discoveryContext)
      thread.activeSurfaces.set(
        CRITERIA_STAGE,
        criteriaSurfaceId(thread.threadId),
      );
    const activeSurfaceId = thread.activeSurfaces.get(stage);
    // Guest UI consistency issue 05: the comparison offers a View per stay; it is the same authoritative view-unit event, sent from the current comparison.
    const viewFromComparison =
      event.name === "shortlet.discovery.view-unit" &&
      thread.activeSurfaces.get(COMPARE_STAGE) === event.surfaceId;
    if (
      !viewFromComparison &&
      (!activeSurfaceId || activeSurfaceId !== event.surfaceId)
    ) {
      const duplicate =
        event.name === "shortlet.card-payment.verify-return" &&
        thread.activeSurfaces.has(BOOKING_STAGE);
      this.#emitTransition(
        thread,
        duplicate
          ? "interaction.duplicate_command_rejected"
          : "interaction.stale_surface_rejected",
        {
          aggregateType: duplicate ? "payment" : "interaction_surface",
          aggregateId: duplicate
            ? (thread.offerId ?? thread.threadId)
            : event.surfaceId,
          surfaceId: event.surfaceId,
          reasonCode: duplicate ? "DUPLICATE_COMMAND" : "STALE_SURFACE",
        },
      );
      return {
        ok: false,
        code: "STALE_SURFACE",
        message:
          "That action is no longer available; please use the current options.",
      };
    }

    switch (event.name) {
      case SEE_ALL_DISCOVERY_EVENT:
        return this.#handleSeeAllDiscovery(thread, event);
      case COMPARE_UNIT_EVENT:
        return this.#handleCompare(thread, event);
      case COMPARE_BACK_EVENT:
        return this.#handleCompareBack(thread, event);
      case DRAFT_REPLACEMENT_ACCEPT_EVENT:
        return this.#handleDraftReplacementAccept(thread, event);
      case DRAFT_REPLACEMENT_KEEP_EVENT:
        return this.#handleDraftReplacementKeep(thread, event);
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
        return {
          ok: false,
          code: "UNSUPPORTED_EVENT",
          message: "That action is not available.",
        };
    }
  }

  reset(): void {
    this.#threads.clear();
    this.#assistantRuntime?.reset();
    const config = this.#environment.config;
    this.#environment.close();
    resetLocalGuestFixture(config.databasePath);
    this.#environment = LocalGuestEnvironment.openNode(config);
  }

  /**
   * Issue 06b: an owner-checked conventional booking page (ADR-0080 parity).
   * Every check fails closed to null: the principal must be this runtime's
   * Guest, the record must be correlated by one of the Guest's own threads,
   * and the domain record must name the Guest (ADR-0070). Reads go through the
   * conventional view functions, never an agent-only path (ADR-0072).
   */
  async conventionalBookingPage(
    kind: ConventionalBookingPageKind,
    id: string,
    principal: CommandPrincipal,
  ): Promise<ConventionalBookingPage | null> {
    const environment = this.#environment;
    const guest = environment.guestPrincipal();
    if (
      principal.role !== "guest" ||
      !principal.id ||
      principal.id !== guest.id ||
      !principal.tenantId ||
      principal.tenantId !== environment.config.tenantId ||
      id === ""
    )
      return null;
    try {
      for (const record of await environment.guestData.findThreadsForPrincipal(
        principal.id,
        principal.tenantId,
      )) {
        let projection: GuestPersistentProjection | null = null;
        try {
          projection = parseGuestProjection(
            JSON.parse(record.threadJson) as unknown,
          );
        } catch {
          projection = null;
        }
        if (!projection) continue;
        const correlated =
          kind === "draft"
            ? projection.draftId === id
            : kind === "request"
              ? projection.requestId === id
              : kind === "offer"
                ? projection.offerId === id
                : !!projection.offerId &&
                  this.#snapshotContractId(projection.offerId) === id;
        if (!correlated) continue;
        const thread =
          this.#threads.get(record.threadId) ??
          (environment.guestDataIsRemote ? await this.#loadRemoteThread(record.threadId) : this.#loadThread(record.threadId));
        if (!thread) return null;
        const page = this.#bookingPage(thread, kind, id, principal);
        const journey = this.#journeyFor(thread);
        return page === null || journey === undefined
          ? page
          : { ...page, journey };
      }
    } catch {
      return null;
    }
    return null;
  }

  /**
   * Guest UI consistency issue 03: the journey rail for a standalone page. Only the Guest's own thread resolves
   * (ADR-0070); anything else is undefined, and the page then shows no rail rather than someone else's progress.
   */
  async journeyForThread(
    threadId: string,
    principal: CommandPrincipal,
  ): Promise<GuestJourney | undefined> {
    const environment = this.#environment;
    const guest = environment.guestPrincipal();
    if (
      principal.role !== "guest" ||
      !principal.id ||
      principal.id !== guest.id ||
      !principal.tenantId ||
      principal.tenantId !== environment.config.tenantId
    )
      return undefined;
    if (
      !(await environment.guestData.findThreadsForPrincipal(principal.id, principal.tenantId))
        .some((record) => record.threadId === threadId)
    )
      return undefined;
    const thread = this.#threads.get(threadId) ?? (environment.guestDataIsRemote ? await this.#loadRemoteThread(threadId) : this.#loadThread(threadId));
    return thread === null ? undefined : this.#journeyFor(thread);
  }

  /** ADR-0072/0080: conventional forms resolve the same current action and handler as Weaver. */
  async conventionalRequestAction(
    id: string,
    action: "review" | "submit",
    surfaceId: string,
    principal: CommandPrincipal,
  ): Promise<GuestTurnResult> {
    const page = await this.conventionalBookingPage("draft", id, principal);
    const thread = page === null ? undefined : this.#threads.get(page.threadId);
    if (
      !page ||
      !thread ||
      thread.requestId ||
      thread.offerId ||
      !surfaceId ||
      thread.activeSurfaces.get(REQUEST_STAGE) !== surfaceId ||
      page.requestScreen?.primary.surfaceId !== surfaceId ||
      page.requestScreen.state !== (action === "review" ? "draft" : "review")
    ) {
      return {
        ok: false,
        code: "STALE_SURFACE",
        message:
          "That action is no longer available; please use the current options.",
      };
    }
    const candidate = this.#draftArtifact(
      thread,
      action === "review" ? "draft" : "review",
    ).actions[0];
    if (!candidate || candidate.type !== action)
      return {
        ok: false,
        code: "ACTION_NOT_AUTHORIZED",
        message: "That action is not available.",
      };
    return this.handleEventAsync(page.threadId, {
      name:
        action === "review"
          ? REQUEST_DRAFT_REVIEW_EVENT
          : REQUEST_DRAFT_SUBMIT_EVENT,
      surfaceId,
      sourceComponentId: "request-form",
      timestamp: this.#environment.clock().toISOString(),
      context: {
        artifactId: candidate.artifactId,
        draftId: candidate.draftId,
        expectedStatus: candidate.expectedStatus,
        projectionVersion: candidate.projectionVersion,
      },
    });
  }

  /** ADR-0072/0080: the native form resolves current server authority, then reuses the Weaver command handler. */
  async conventionalOfferAccept(
    id: string,
    surfaceId: string,
    principal: CommandPrincipal,
  ): Promise<GuestTurnResult> {
    const page = await this.conventionalBookingPage("offer", id, principal);
    const thread = page ? this.#threads.get(page.threadId) : undefined;
    if (
      !page ||
      !thread ||
      !surfaceId ||
      thread.activeSurfaces.get(OFFER_STAGE) !== surfaceId ||
      page.offerScreen?.accept?.surfaceId !== surfaceId
    ) {
      return {
        ok: false,
        code: "STALE_SURFACE",
        message:
          "That action is no longer available; please use the current options.",
      };
    }
    const action = this.#environment.conditionalOfferApp.getArtifact(
      id,
      principal,
    ).actions[0];
    if (!action)
      return {
        ok: false,
        code: "ACTION_NOT_AUTHORIZED",
        message: "That action is not available.",
      };
    return this.handleEventAsync(page.threadId, {
      name: "shortlet.conditional-offer.accept",
      surfaceId,
      sourceComponentId: "offer-form",
      timestamp: this.#environment.clock().toISOString(),
      context: {
        artifactId: action.artifactId,
        offerId: action.offerId,
        expectedStatus: action.expectedStatus,
        offerVersion: action.offerVersion,
        projectionVersion: action.projectionVersion,
        confirmationToken: action.confirmationToken,
      },
    });
  }

  async conventionalOfferSearch(
    id: string,
    principal: CommandPrincipal,
  ): Promise<string | null> {
    const page = await this.conventionalBookingPage("offer", id, principal);
    const thread = page ? this.#threads.get(page.threadId) : undefined;
    if (!page?.offerScreen?.searchPath || !thread?.discoveryArtifact)
      return null;
    return conventionalSearchRoute(thread.discoveryArtifact.facts.filters);
  }

  async conventionalRequestSearch(
    id: string,
    principal: CommandPrincipal,
  ): Promise<string | null> {
    const page = await this.conventionalBookingPage("request", id, principal);
    const thread = page === null ? undefined : this.#threads.get(page.threadId);
    if (
      !page ||
      !thread?.discoveryArtifact ||
      page.requestScreen?.state !== "not-accepted"
    )
      return null;
    return conventionalSearchRoute(thread.discoveryArtifact.facts.filters);
  }

  /**
   * Issue 13a: the Guest's live committed work across all of their threads,
   * so a new conversation can say it is unaffected (ADR-0079). Read-only and
   * derived from the authoritative artifacts via the journey projection; an
   * unreadable, failed or expired record is never listed. Fails closed to an
   * empty list for any principal that is not this runtime's Guest (ADR-0070).
   */
  async committedWork(
    principal: CommandPrincipal,
    identity?: GuestIdentity,
  ): Promise<GuestCommittedWork[]> {
    const environment = this.#environment;
    const scope = committedWorkScope(environment, principal, identity);
    if (scope === null || !principal.tenantId) return [];
    const work: GuestCommittedWork[] = [];
    // The conversations to consider: every thread of the scope's principals, then, for each Booking Request the account
    // holds by claim (ADR 0093), only that request's conversation, owned by its Primary Guest. Nothing else of that
    // principal is listed.
    const candidates: { threadId: string; principalId: string; claimedRequestId: string | null }[] = [];
    for (const record of await environment.guestData.findThreadsForPrincipals(
      scope,
      principal.tenantId,
    ))
      candidates.push({ threadId: record.threadId, principalId: record.principalId, claimedRequestId: null });
    for (const requestId of identity?.claimedRequestIds ?? []) {
      const request = environment.interactionStore.findBookingRequest(requestId);
      if (!request || request.tenantId !== principal.tenantId) continue;
      for (const record of await environment.guestData.findThreadsForPrincipal(
        request.primaryGuestId,
        principal.tenantId,
      ))
        candidates.push({ threadId: record.threadId, principalId: record.principalId, claimedRequestId: requestId });
    }
    const listed = new Set<string>();
    try {
      for (const record of candidates) {
        if (listed.has(record.threadId)) continue;
        const owner: CommandPrincipal = {
          id: record.principalId,
          role: "guest",
          tenantId: principal.tenantId,
        };
        const owners = record.claimedRequestId === null ? scope : [record.principalId];
        const loaded =
          this.#threads.get(record.threadId) ??
          (environment.guestDataIsRemote ? await this.#loadRemoteThread(record.threadId, owners) : this.#loadThread(record.threadId, owners));
        if (!loaded || (!loaded.requestId && !loaded.offerId)) continue;
        if (record.claimedRequestId !== null && loaded.requestId !== record.claimedRequestId) continue;
        listed.add(record.threadId);
        // A thread records its offer only on its next refresh, and this read
        // never issues one (ADR-0079). Judge the durable offer for a confirmed
        // request so an expired offer is never called a live request.
        const offerId =
          loaded.offerId ??
          (loaded.requestId
            ? (environment.interactionStore.findConditionalOfferByRequestId(
                loaded.requestId,
              )?.offerId ?? null)
            : null);
        const thread: GuestThreadState =
          offerId === loaded.offerId ? loaded : { ...loaded, offerId };
        const journey = this.#journeyFor(thread, owner);
        if (journey === undefined || journey.outcome !== undefined) continue;
        const unitTitle = this.#currentUnit(thread)?.title;
        const base = {
          threadId: thread.threadId,
          ...(unitTitle === undefined ? {} : { unitTitle }),
        };
        if (journey.current === "confirmed" && thread.offerId) {
          const contractId = this.#snapshotContractId(thread.offerId);
          if (contractId !== null)
            work.push({
              ...base,
              kind: "reservation",
              route: conventionalBookingContractRoute(contractId),
            });
        } else if (
          (journey.current === "offer" || journey.current === "pay") &&
          thread.offerId
        ) {
          work.push({
            ...base,
            kind: "offer",
            route: conventionalConditionalOfferRoute(thread.offerId),
          });
        } else if (journey.current === "request" && thread.requestId) {
          work.push({
            ...base,
            kind: "request",
            route: conventionalBookingRequestRoute(thread.requestId),
          });
        }
      }
    } catch {
      return [];
    }
    return work;
  }

  #snapshotContractId(offerId: string): string | null {
    const snapshot =
      this.#environment.interactionStore.findBookingSnapshotByOfferId(offerId);
    if (!snapshot) return null;
    const contract: unknown = JSON.parse(snapshot.contractJson);
    return isPlainRecord(contract) && typeof contract.contractId === "string"
      ? contract.contractId
      : null;
  }

  #bookingPage(
    thread: GuestThreadState,
    kind: ConventionalBookingPageKind,
    id: string,
    principal: CommandPrincipal,
  ): ConventionalBookingPage | null {
    const environment = this.#environment;
    if (kind === "draft") {
      const draft: unknown = environment.bookingRequestApp.getDraft(id);
      if (
        !isPlainRecord(draft) ||
        !isPlainRecord(draft.primaryGuest) ||
        draft.primaryGuest.id !== principal.id
      )
        return null;
      // The page mirrors the view the thread is on: the draft, or its review.
      const review =
        thread.activeSurfaces
          .get(REQUEST_STAGE)
          ?.includes(":request:review:") === true;
      const artifact = this.#draftArtifact(thread, review ? "review" : "draft");
      // ADR-0074/0078: historical links remain readable, but a sent request removes the draft's material authority.
      const surfaceId =
        thread.requestId || thread.offerId
          ? ""
          : (thread.activeSurfaces.get(REQUEST_STAGE) ?? "");
      return {
        threadId: thread.threadId,
        requestScreen: draftScreenContent(
          artifact,
          conventionalRequestDraftRoute(id),
          surfaceId,
          thread.threadId,
        ),
        summary: review ? "Request review" : "Request Draft",
        textFallback: this.#draftFallback(artifact),
        stay: {
          unitTitle: artifact.facts.unitTitle,
          checkIn: artifact.facts.checkIn,
          checkOut: artifact.facts.checkOut,
          nights: artifact.facts.nights,
          guestCount: artifact.facts.occupants.length,
          allInStayTotalKobo: artifact.facts.allInStayTotalKobo,
          refundableSecurityDepositKobo:
            artifact.facts.refundableSecurityDepositKobo,
          amountDueNowIsConditional: true,
          ...(review
            ? { amountDueNowKobo: artifact.facts.amountDueNowKobo }
            : {}),
        },
      };
    }
    if (kind === "request") {
      getConventionalBookingRequestView(
        environment.bookingRequestApp,
        id,
        principal,
      );
      if (
        !primaryGuestIs(
          environment.bookingRequestApp.getRequest(id),
          principal,
        )
      )
        return null;
      const surface = this.#requestSurface(thread, id);
      const artifact = environment.bookingRequestApp.getArtifact(id, principal);
      const unit = environment.unitRepository.findById(artifact.facts.unitId);
      return {
        threadId: thread.threadId,
        requestScreen: requestScreenContent(
          artifact,
          conventionalBookingRequestRoute(id),
          unit?.operator.name,
        ),
        summary: surface.summary ?? GUEST_GLOSSARY.bookingRequest,
        textFallback: surface.textFallback ?? "",
        stay: {
          unitTitle: unit?.title ?? `Your selected ${GUEST_GLOSSARY.unit}`,
          checkIn: artifact.facts.checkIn,
          checkOut: artifact.facts.checkOut,
          nights: artifact.facts.nights,
          guestCount: artifact.facts.occupants.length,
          ...(artifact.facts.quote
            ? {
                allInStayTotalKobo: artifact.facts.quote.allInStayTotalKobo,
                refundableSecurityDepositKobo:
                  artifact.facts.quote.refundableSecurityDepositKobo,
                amountDueNowKobo: artifact.facts.quote.totalAmountDueNowKobo,
                amountDueNowIsConditional: true,
              }
            : {}),
        },
      };
    }
    if (kind === "offer") {
      const offer = environment.conditionalOfferApp.getOffer(id);
      const payerId = offer.parties.distinctPayer?.id;
      const isParty =
        !!principal.id &&
        (offer.parties.primaryGuest.id === principal.id ||
          (!!payerId && payerId === principal.id));
      if (!isParty || !offer.tenantId || offer.tenantId !== principal.tenantId)
        return null;
      const { artifact } = getConventionalConditionalOfferView(
        environment.conditionalOfferApp,
        id,
        principal,
      );
      return {
        threadId: thread.threadId,
        offerScreen: offerScreenContent(
          artifact,
          conventionalConditionalOfferRoute(id),
          thread.activeSurfaces.get(OFFER_STAGE) ?? "",
          environment.clock(),
          formatNgnKobo(artifact.facts.totalAmountDueNowKobo),
        ),
        summary:
          artifact.facts.status === "expired"
            ? `${GUEST_GLOSSARY.conditionalBookingOffer} expired`
            : GUEST_GLOSSARY.conditionalBookingOffer,
        textFallback: this.#offerFallback(artifact),
        stay: {
          unitTitle: artifact.facts.unitTitle,
          checkIn: artifact.facts.checkIn,
          checkOut: artifact.facts.checkOut,
          nights: artifact.facts.nights,
          guestCount: artifact.facts.occupants.length,
          allInStayTotalKobo: artifact.facts.allInStayTotalKobo,
          refundableSecurityDepositKobo:
            artifact.facts.refundableSecurityDepositKobo,
          amountDueNowKobo: artifact.facts.totalAmountDueNowKobo,
        },
      };
    }
    // The contract view is authorized by the domain for the contract's parties.
    getConventionalBookingContractView(environment.contractApp, id, principal);
    const artifact = this.#contractArtifact(id);
    return {
      threadId: thread.threadId,
      confirmation: confirmationContent(
        artifact,
        thread.threadId,
        conventionalBookingContractRoute(id),
        this.#confirmedBookingFallback(artifact),
      ),
      summary: "Reservation confirmed",
      textFallback: this.#confirmedBookingFallback(artifact),
      stay: {
        unitTitle: artifact.facts.unitTitle ?? `Your ${GUEST_GLOSSARY.unit}`,
        checkIn: artifact.facts.checkIn,
        checkOut: artifact.facts.checkOut,
        nights: artifact.facts.nights,
        guestCount: artifact.facts.occupants.length,
        ...(artifact.facts.allInStayTotalKobo === undefined
          ? {}
          : { allInStayTotalKobo: artifact.facts.allInStayTotalKobo }),
        ...(artifact.facts.refundableSecurityDepositKobo === undefined
          ? {}
          : {
              refundableSecurityDepositKobo:
                artifact.facts.refundableSecurityDepositKobo,
            }),
        amountPaidKobo: artifact.facts.amountPaidKobo,
      },
    };
  }

  getState(threadId: string): GuestStateSnapshot | undefined {
    const thread = this.#threads.get(threadId) ?? (this.#environment.guestDataIsRemote ? null : this.#loadThread(threadId));
    if (!thread) return undefined;
    this.#rebuildAssistantDiscovery(thread);
    this.#refreshAssistantSurface(thread);
    this.#restoreAssistantFromGuestThread(threadId, thread);
    const priorSurfaceId = thread.lastSurfaces.at(-1)?.surfaceId;
    const refreshed = this.#refreshWorkflow(thread);
    const decorated = refreshed ? this.#decorateResult(refreshed) : null;
    if (decorated?.ok && decorated.surfaces.length > 0) {
      thread.lastSurfaces = [...decorated.surfaces];
      this.#rememberResult(threadId, undefined, decorated);
    }
    const normalized = this.#decorateResult({
      ok: true,
      messages: [],
      surfaces: thread.lastSurfaces,
    });
    if (!normalized.ok) return undefined;
    thread.lastSurfaces = [...normalized.surfaces];
    if (
      priorSurfaceId !== undefined &&
      thread.lastSurfaces.at(-1)?.surfaceId !== priorSurfaceId
    ) {
      this.#emitTransition(thread, "interaction.cross_tab_recovery_occurred", {
        aggregateType: "interaction_thread",
        aggregateId: threadId,
      });
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
      ...(this.#assistantRuntime?.hasThread(threadId) ? { tasks: this.#assistantRuntime.getTaskRail(threadId), verticals: this.#verticals() } : {}),
    };
  }

  /**
   * Adds the response-time projections (journey rail, waiting state) to a
   * result. They are derived per response and never stored with the thread.
   */
  #withJourney(threadId: string, result: GuestTurnResult): GuestTurnResult {
    if (!result.ok) return result;
    const thread = this.#threads.get(threadId);
    if (!thread) return result;
    // Issue 03a AC1 applies to assistant responses too: a chip edit must return the strip it just changed.
    const criteria = this.#criteriaFor(thread);
    if (this.#assistantRuntime) return criteria === undefined ? result : { ...result, criteria };
    const journey = this.#journeyFor(thread);
    const surfaces = this.#withWaiting(thread, result.surfaces);
    return {
      ...result,
      surfaces,
      ...(journey === undefined ? {} : { journey }),
      ...(criteria === undefined ? {} : { criteria }),
    };
  }

  #withWaiting(
    thread: GuestThreadState,
    surfaces: readonly GuestSurfacePayload[],
  ): GuestSurfacePayload[] {
    return surfaces.map((surface, index) => {
      if (index !== surfaces.length - 1) return surface;
      const waiting = this.#waitingFor(thread, surface);
      const draftView = surface.surfaceId.includes(":request:draft:")
        ? "draft"
        : surface.surfaceId.includes(":request:review:")
          ? "review"
          : undefined;
      const content =
        draftView && thread.draftId
          ? draftScreenContent(
              this.#draftArtifact(thread, draftView),
              conventionalRequestDraftRoute(thread.draftId),
              surface.surfaceId,
              thread.threadId,
            )
          : thread.requestId &&
              surface.surfaceId ===
                `thread-${thread.threadId}:request:${thread.requestId}`
            ? requestScreenContent(
                this.#environment.bookingRequestApp.getArtifact(
                  thread.requestId,
                  this.#environment.guestPrincipal(),
                ),
                conventionalBookingRequestRoute(thread.requestId),
                this.#currentUnit(thread)?.operator.name,
              )
            : undefined;
      const contractId = thread.offerId
        ? this.#snapshotContractId(thread.offerId)
        : null;
      const contract =
        contractId &&
        surface.surfaceId === `thread-${thread.threadId}:booking:${contractId}`
          ? this.#contractArtifact(contractId)
          : undefined;
      const confirmation = contract
        ? confirmationContent(
            contract,
            thread.threadId,
            conventionalBookingContractRoute(contract.facts.contractId),
            this.#confirmedBookingFallback(contract),
          )
        : undefined;
      const offer =
        thread.offerId &&
        surface.surfaceId ===
          `thread-${thread.threadId}:offer:${thread.offerId}`
          ? this.#environment.conditionalOfferApp.getArtifact(
              thread.offerId,
              this.#environment.guestPrincipal(),
            )
          : undefined;
      const paymentScreen = this.#paymentScreenFor(thread, surface);
      const offerScreen = offer
        ? offerScreenContent(
            offer,
            conventionalConditionalOfferRoute(offer.facts.offerId),
            surface.surfaceId,
            this.#environment.clock(),
            formatNgnKobo(offer.facts.totalAmountDueNowKobo),
          )
        : undefined;
      return {
        ...surface,
        ...(waiting === undefined ? {} : { waiting }),
        ...(content === undefined ? {} : { requestScreen: content }),
        ...(confirmation === undefined ? {} : { confirmation }),
        ...(offerScreen === undefined ? {} : { offerScreen }),
        ...(paymentScreen === undefined ? {} : { paymentScreen }),
      };
    });
  }

  /**
   * Issue 09: the shared payment screen for a pending card payment, read from the authoritative artifact on every
   * response (ADR-0079). Closed, processing and confirmed payments keep their existing surfaces.
   */
  #paymentScreenFor(
    thread: GuestThreadState,
    surface: GuestSurfacePayload,
  ): PaymentScreenContent | undefined {
    if (
      !thread.offerId ||
      !surface.surfaceId.includes(":payment:") ||
      surface.surfaceId.includes(":payment:result:") ||
      (surface.status !== undefined && surface.status !== "active")
    )
      return undefined;
    try {
      const environment = this.#environment;
      const content = paymentScreenContent(
        environment.cardPaymentApp.getArtifact(
          thread.offerId,
          environment.guestPrincipal(),
        ),
        environment.clock(),
        `/payments/offers/${encodeURIComponent(thread.offerId)}`,
        this.#currentUnit(thread)?.operator?.name,
      );
      return content.state === "closed" ? undefined : content;
    } catch {
      return undefined;
    }
  }

  /**
   * Issue 10: the waiting state for the current surface, read from the
   * authoritative artifact so the deadline is the server's (ADR-0079). Only a
   * delivered request awaiting the Operator (ADR-0041) and an open Payment
   * Window (ADR-0044) wait on a deadline; everything else has none.
   */
  #waitingFor(
    thread: GuestThreadState,
    surface: GuestSurfacePayload,
  ): GuestWaitingState | undefined {
    if (surface.status !== undefined && surface.status !== "active")
      return undefined;
    const environment = this.#environment;
    const guest = environment.guestPrincipal();
    const now = environment.clock();
    const open = (deadlineAt: string): boolean =>
      new Date(deadlineAt).getTime() > now.getTime();
    const state = (
      kind: GuestWaitingKind,
      deadlineAt: string,
      deadlineText: string,
    ): GuestWaitingState => {
      const copy = guestWaitingCopy(
        kind,
        this.#currentUnit(thread)?.operator?.name,
      );
      return {
        kind,
        heading: copy.heading,
        deadlineAt,
        deadlineText,
        serverNow: now.toISOString(),
        outcomes: copy.outcomes,
        meanwhile: copy.meanwhile,
      };
    };
    try {
      if (
        thread.requestId &&
        !thread.offerId &&
        surface.surfaceId ===
          `thread-${thread.threadId}:request:${thread.requestId}`
      ) {
        const facts = environment.bookingRequestApp.getArtifact(
          thread.requestId,
          guest,
        ).facts;
        if (
          facts.status !== "disclosed" ||
          !facts.delivered ||
          !open(facts.operatorResponseDeadlineAt)
        )
          return undefined;
        return state(
          "operator-response",
          facts.operatorResponseDeadlineAt,
          `Response due by ${formatWAT(facts.operatorResponseDeadlineAt)}`,
        );
      }
      if (
        thread.offerId &&
        surface.surfaceId ===
          `thread-${thread.threadId}:offer:${thread.offerId}`
      ) {
        const facts = environment.conditionalOfferApp.getArtifact(
          thread.offerId,
          guest,
        ).facts;
        if (facts.status !== "issued" || !open(facts.paymentWindowExpiresAt))
          return undefined;
        return state(
          "offer-payment-window",
          facts.paymentWindowExpiresAt,
          formatBookingDeadline(facts.paymentWindowExpiresAt),
        );
      }
      if (thread.offerId && surface.surfaceId.includes(":payment:")) {
        const facts = environment.cardPaymentApp.getArtifact(
          thread.offerId,
          guest,
        ).facts;
        // A payment already processing may be in its grace period (ADR-0044); it has no guest countdown.
        if (
          !["ready", "checkout_initiated", "deposit_required"].includes(
            facts.status,
          ) ||
          surface.surfaceId.includes(":payment:result:") ||
          !open(facts.paymentWindowExpiresAt)
        )
          return undefined;
        return state(
          "payment-window",
          facts.paymentWindowExpiresAt,
          formatBookingDeadline(facts.paymentWindowExpiresAt),
        );
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
  #journeyFor(
    thread: GuestThreadState,
    viewer?: CommandPrincipal,
  ): GuestJourney | undefined {
    const environment = this.#environment;
    // The viewer is the thread's owner: a Linked Principal's own offers and requests are read as that principal (ADR 0093).
    const guest = viewer ?? environment.guestPrincipal();
    try {
      if (thread.offerId) {
        // ADR-0005: "Confirmed" only once the durable Booking Contract exists.
        if (
          environment.interactionStore.findBookingSnapshotByOfferId(
            thread.offerId,
          )
        )
          return projectJourney("confirmed");
        const offer = environment.conditionalOfferApp.getArtifact(
          thread.offerId,
          guest,
        ).facts.status;
        if (offer === "accepted" || thread.activeSurfaces.has(PAYMENT_STAGE)) {
          const payment = environment.cardPaymentApp.getArtifact(
            thread.offerId,
            guest,
          ).facts.status;
          if (payment === "expired" || payment === "failed") {
            return projectJourney("pay", {
              kind: payment,
              label: guestPaymentStatus(payment).label.split(" · ")[0]!,
            });
          }
          return projectJourney("pay");
        }
        if (offer === "expired")
          return projectJourney("offer", {
            kind: "expired",
            label: "Offer expired",
          });
        if (offer === "stale")
          return projectJourney("offer", {
            kind: "closed",
            label: "Offer no longer current",
          });
        if (offer === "revoked")
          return projectJourney("offer", {
            kind: "closed",
            label: "Offer withdrawn",
          });
        return projectJourney("offer");
      }
      if (thread.requestId) {
        const request = environment.bookingRequestApp.getArtifact(
          thread.requestId,
          guest,
        ).facts;
        const label = guestRequestStatus(
          request.status,
          request.delivered,
        ).label;
        if (request.status === "declined")
          return projectJourney("request", { kind: "declined", label });
        if (request.status === "expired")
          return projectJourney("request", { kind: "expired", label });
        if (request.status === "delivery_failed")
          return projectJourney("request", { kind: "not-delivered", label });
        return projectJourney("request");
      }
    } catch {
      // An unreadable record never shows progress it cannot prove.
      return undefined;
    }
    if (thread.activeSurfaces.has(UNIT_STAGE)) return projectJourney("stay");
    // A kept draft counts only while it is the surface on screen, not after a new search.
    if (
      thread.draftId &&
      this.#stageForSurfaceId(thread.lastSurfaces.at(-1)?.surfaceId ?? "") ===
        REQUEST_STAGE
    )
      return projectJourney("request");
    if (thread.discoveryArtifact) return projectJourney("search");
    return undefined;
  }

  recordShellTelemetry(event: unknown): boolean {
    if (
      typeof event !== "string" ||
      !(SHELL_TELEMETRY_EVENTS as readonly string[]).includes(event)
    )
      return false;
    try {
      this.#environment.telemetry.track({
        type: `interaction.${event as ShellTelemetryEvent}`,
      });
    } catch {
      /* telemetry is non-blocking */
    }
    return true;
  }

  #emitTransition(
    thread: GuestThreadState,
    type: string,
    fields: Omit<
      TransitionTelemetryEvent,
      | "type"
      | "eventVersion"
      | "timestamp"
      | "transitionKey"
      | "tenantId"
      | "principalId"
      | "threadId"
    > = {},
  ): void {
    const aggregateId = fields.aggregateId ?? fields.correlationId;
    const event: TransitionTelemetryEvent = {
      type,
      eventVersion: "1",
      timestamp: this.#environment.clock().toISOString(),
      tenantId: this.#environment.config.tenantId,
      principalId: this.#environment.guestPrincipal().id,
      threadId: thread.threadId,
      transitionKey: `${type}:${thread.threadId}:${fields.aggregateType ?? "interaction"}:${aggregateId ?? "none"}`,
      ...(aggregateId === undefined ? {} : { aggregateId }),
      ...fields,
    };
    try {
      this.#environment.telemetry.trackTransition(event);
    } catch {
      /* telemetry cannot block a Guest action */
    }
  }

  #persistThread(thread: GuestThreadState): void {
    const environment = this.#environment;
    if (environment.guestDataIsRemote) return;
    // ADR 0004 / 0070 / 0093: a read or a refresh never changes a conversation's owner. A saved conversation this runtime
    // does not own (a linked principal's) is not written at all; only a new conversation is saved under this runtime.
    const saved = environment.interactionStore.findThread(thread.threadId);
    if (
      saved &&
      (saved.principalId !== environment.guestPrincipal().id ||
        saved.tenantId !== environment.config.tenantId)
    )
      return;
    const current = thread.lastSurfaces.at(-1);
    const activeStage =
      this.#stageForSurfaceId(current?.surfaceId ?? "") ??
      this.#inferActiveStage(thread);
    environment.interactionStore.saveThread({
      threadId: thread.threadId,
      principalId: environment.guestPrincipal().id,
      tenantId: environment.config.tenantId,
      threadJson: JSON.stringify(this.#projectionFor(thread, activeStage)),
    });
  }

  #projectionFor(
    thread: GuestThreadState,
    activeStage: string | null,
    forCurrentRestore = false,
  ): GuestPersistentProjection {
    const current = thread.lastSurfaces.at(-1);
    return {
      version: 1,
      timeline: thread.timeline.map(({ role, text }) => ({ role, text })),
      discoveryContext:
        thread.discoveryContext === null
          ? null
          : { ...thread.discoveryContext },
      // ADR 0075/0077: Assistant searches persist safe criteria, not listing prose; current artifacts are re-queried on restore.
      discoveryArtifact: thread.assistantContext && !forCurrentRestore ? null : thread.discoveryArtifact,
      discoveryArtifactId: thread.discoveryArtifactId,
      discoverySurfaceId: thread.discoverySurfaceId,
      discoveryRevision: thread.discoveryRevision,
      unitDetail: thread.unitDetail
        ? {
            unitId: thread.unitDetail.unitId,
            artifactId: thread.unitDetail.artifactId,
          }
        : null,
      draftId: thread.draftId,
      draftQuote: thread.draftQuote ? { ...thread.draftQuote } : null,
      requestId: thread.requestId,
      offerId: thread.offerId,
      activeStage,
      activeSurfaceId: current?.surfaceId ?? null,
      searchHistory: thread.searchHistory.map((context) => ({ ...context })),
      assistantContext: thread.assistantContext,
    };
  }

  #assistantRestoreProjection(thread: GuestThreadState, activeStage: string | null, activeSurfaceId?: string | null): GuestPersistentProjection {
    const projection = this.#projectionFor(thread, activeStage, true);
    return { ...projection, ...(activeSurfaceId === undefined ? {} : { activeSurfaceId }) };
  }

  #stageForSurfaceId(surfaceId: string): string | null {
    // Issue 13b: a comparison is restored as the results it was opened from.
    if (surfaceId.includes(":discovery:") || surfaceId.includes(":compare:"))
      return DISCOVERY_STAGE;
    if (surfaceId.includes(":unit:")) return UNIT_STAGE;
    if (
      surfaceId.includes(":request:draft:") ||
      surfaceId.includes(":request:review:")
    )
      return REQUEST_STAGE;
    if (surfaceId.includes(":request:req-") || surfaceId.includes(":request:"))
      return REQUEST_STAGE;
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
  #loadThread(
    threadId: string,
    principalIds?: readonly string[],
  ): GuestThreadState | null {
    if (this.#environment.guestDataIsRemote) return null;
    const existing = this.#threads.get(threadId);
    if (existing) return existing;
    const environment = this.#environment;
    const record = environment.interactionStore.findThread(threadId);
    if (!record) return null;
    return this.#hydrateThreadRecord(record, principalIds);
  }

  async getStateAsync(threadId: string): Promise<GuestStateSnapshot | undefined> {
    await this.#hydrateRemoteContact();
    if (this.#environment.guestDataIsRemote && !this.#threads.has(threadId)) await this.#loadRemoteThread(threadId);
    const state = this.getState(threadId);
    if (this.#environment.guestDataIsRemote) await this.#persistRemoteThread(threadId);
    return state;
  }

  async #hydrateRemoteContact(): Promise<void> {
    const environment = this.#environment;
    if (!environment.guestDataIsRemote || !environment.remoteGuestContacts) return;
    const principal = environment.guestPrincipal();
    if (!principal.tenantId) return;
    environment.remoteGuestContacts.hydrate(await environment.guestData.findContact(principal.id, principal.tenantId));
  }

  async #flushRemoteContact(): Promise<void> {
    const environment = this.#environment;
    const cache = environment.remoteGuestContacts;
    if (!environment.guestDataIsRemote || !cache) return;
    const pending = cache.takePending();
    if (!pending) return;
    const saved = pending.kind === "phone"
      ? await environment.guestData.savePhone(pending.input)
      : await environment.guestData.saveEmail(pending.input);
    cache.accept(saved);
  }

  async #loadRemoteThread(threadId: string, principalIds?: readonly string[]): Promise<GuestThreadState | null> {
    const existing = this.#threads.get(threadId);
    if (existing) return existing;
    const record = await this.#environment.guestData.findThread(threadId);
    return record ? this.#hydrateThreadRecord(record, principalIds) : null;
  }

  async #persistRemoteThread(threadId: string): Promise<void> {
    const thread = this.#threads.get(threadId);
    if (!thread) return;
    const environment = this.#environment;
    const principalId = environment.guestPrincipal().id;
    const existing = await environment.guestData.findThread(threadId);
    if (existing && (existing.principalId !== principalId || existing.tenantId !== environment.config.tenantId)) return;
    const current = thread.lastSurfaces.at(-1);
    const activeStage = this.#stageForSurfaceId(current?.surfaceId ?? "") ?? this.#inferActiveStage(thread);
    await environment.guestData.saveThread({
      threadId, principalId, tenantId: environment.config.tenantId,
      threadJson: JSON.stringify(this.#projectionFor(thread, activeStage)),
    });
  }

  #hydrateThreadRecord(
    record: { readonly threadId: string; readonly principalId: string; readonly tenantId: string; readonly threadJson: string },
    principalIds?: readonly string[],
  ): GuestThreadState | null {
    const threadId = record.threadId;
    const environment = this.#environment;
    // Callers that list an account's work pass the account's principal set, which the store already scoped (ADR 0093).
    const owners = principalIds ?? [environment.guestPrincipal().id];
    if (
      !owners.includes(record.principalId) ||
      record.tenantId !== environment.config.tenantId
    ) {
      return null;
    }
    let projection: GuestPersistentProjection | null = null;
    try {
      projection = parseGuestProjection(
        JSON.parse(record.threadJson) as unknown,
      );
    } catch {
      projection = null;
    }
    if (!projection) return null;

    const thread: GuestThreadState = {
      threadId,
      geminiHistory: [],
      discoveryContext:
        projection.discoveryContext === null
          ? null
          : { ...projection.discoveryContext },
      discoveryArtifact: projection.discoveryArtifact
        ? structuredClone(projection.discoveryArtifact)
        : null,
      discoveryArtifactId: projection.discoveryArtifactId,
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
      searchHistory: projection.searchHistory.map((context) => ({
        ...context,
      })),
      assistantContext: projection.assistantContext,
      compareSelection: null,
      draftChangeContext: null,
      pendingDraftReplacement: null,
    };
    this.#threads.set(threadId, thread);
    this.#rebuildAssistantDiscovery(thread);
    const restoredProjection = thread.assistantContext
      ? { ...this.#assistantRestoreProjection(thread, projection.activeStage, projection.activeSurfaceId), discoverySurfaceId: projection.discoverySurfaceId, discoveryRevision: projection.discoveryRevision }
      : projection;
    const restored = this.#restoreCurrentSurface(thread, restoredProjection);
    if (restored) {
      thread.lastSurfaces = [restored];
      this.#emitTransition(
        thread,
        "interaction.restart_restoration_succeeded",
        { aggregateType: "interaction_thread", aggregateId: threadId },
      );
    }
    return thread;
  }

  /**
   * Re-derives the current presentation from the authoritative domain state
   * that the stored projection correlates. Stale or expired lifecycle state is
   * preserved fail-closed by the underlying artifact builders (lazy expiry
   * against the current clock).
   */
  #restoreCurrentSurface(
    thread: GuestThreadState,
    projection: GuestPersistentProjection,
  ): GuestSurfacePayload | null {
    const environment = this.#environment;
    const surfaceId = projection.activeSurfaceId;
    if (!surfaceId) return null;
    try {
      if (
        projection.activeStage === UNIT_STAGE &&
        projection.unitDetail &&
        projection.discoveryArtifact
      ) {
        const unit = projection.discoveryArtifact.facts.results.find(
          (candidate) => candidate.id === projection.unitDetail?.unitId,
        );
        if (unit) {
          // ADR 0106: a unit the planner opened keeps the surface id the guest holds; a shell-opened unit keeps its own id.
          const unitSurfaceId = surfaceId.includes(":unit:")
            ? surfaceId
            : unitDetailSurfaceId(thread.threadId, projection.discoveryRevision);
          thread.activeSurfaces.set(UNIT_STAGE, unitSurfaceId);
          return {
            surfaceId: unitSurfaceId,
            mode: "focused-surface",
            summary: `${unit.title} details`,
            // ADR-0080: the restored unit keeps its conventional unit route.
            conventionalRoute: projection.discoveryArtifact.actions.find(
              (action) =>
                action.type === "view-unit" && action.unitId === unit.id,
            )?.conventionalRoute,
            textFallback: `${unit.title}. ${unit.location.neighbourhood}, ${unit.location.city}. Entire Place; capacity ${unit.capacity} guests.`,
            a2uiMessages: unitDetailArtifactToA2UI({
              demo: environment.config.demo === true,
              artifact: unitDetailArtifactFromProjection({
                unit,
                ...this.#stayDatesFor(thread),
                projectionVersion:
                  projection.discoveryArtifact.projectionVersion,
                viewer: environment.guestPrincipal(),
              }),
              surfaceId: unitSurfaceId,
              backToResults: { artifactId: projection.discoveryArtifact.id },
            }),
          };
        }
      }
      if (
        projection.activeStage === REQUEST_STAGE &&
        projection.draftId &&
        !projection.requestId
      ) {
        // Draft or review: rebuild the current draft artifact surface. The
        // stored surface id distinguishes draft from review.
        const review = surfaceId.includes(":request:review:");
        const artifact = this.#draftArtifact(
          thread,
          review ? "review" : "draft",
        );
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
          a2uiMessages: requestDraftArtifactToA2UI({
            artifact,
            surfaceId: draftSurfaceId,
          }),
        };
      }
      if (projection.activeStage === REQUEST_STAGE && projection.requestId) {
        const artifact = environment.bookingRequestApp.getArtifact(
          projection.requestId,
          environment.guestPrincipal(),
        );
        if (
          ["declined", "expired", "delivery_failed"].includes(
            artifact.facts.status,
          )
        ) {
          const outcomeSurface = {
            ...this.#requestSurface(thread, projection.requestId),
            mode: "inline-surface",
            summary: "Request outcome",
            status: "active",
          } as GuestSurfacePayload;
          thread.activeSurfaces.delete(REQUEST_STAGE);
          return outcomeSurface;
        }
        const requestSurface = this.#requestSurface(
          thread,
          projection.requestId,
        );
        thread.activeSurfaces.set(REQUEST_STAGE, requestSurface.surfaceId);
        return requestSurface;
      }
      if (projection.activeStage === OFFER_STAGE && projection.offerId) {
        // Never issue a new offer during restoration; only present the one the
        // durable store already correlates.
        const offerArtifact = environment.conditionalOfferApp.getArtifact(
          projection.offerId,
          environment.guestPrincipal(),
        );
        const offerSurfaceId = `thread-${thread.threadId}:offer:${projection.offerId}`;
        thread.activeSurfaces.set(OFFER_STAGE, offerSurfaceId);
        return {
          surfaceId: offerSurfaceId,
          mode: "focused-surface",
          summary:
            offerArtifact.facts.status === "expired"
              ? "Conditional Booking Offer expired"
              : "Conditional Booking Offer",
          status:
            offerArtifact.facts.status === "expired" ? "expired" : "active",
          conventionalRoute: conventionalConditionalOfferRoute(
            projection.offerId,
          ),
          textFallback: this.#offerFallback(offerArtifact),
          a2uiMessages: conditionalOfferArtifactToA2UI({
            artifact: offerArtifact,
            surfaceId: offerSurfaceId,
          }),
        };
      }
      if (projection.activeStage === PAYMENT_STAGE && projection.offerId) {
        const snapshot =
          environment.interactionStore.findBookingSnapshotByOfferId(
            projection.offerId,
          );
        if (snapshot) {
          try {
            const contract = JSON.parse(snapshot.contractJson) as {
              readonly contractId: string;
            };
            const bookingSurfaceId = `thread-${thread.threadId}:booking:${contract.contractId}`;
            const contractArtifact = this.#contractArtifact(
              contract.contractId,
            );
            thread.activeSurfaces.delete(PAYMENT_STAGE);
            thread.activeSurfaces.set(BOOKING_STAGE, bookingSurfaceId);
            return {
              surfaceId: bookingSurfaceId,
              mode: "focused-surface",
              summary: "Reservation confirmed",
              conventionalRoute: conventionalBookingContractRoute(
                contract.contractId,
              ),
              textFallback: this.#confirmedBookingFallback(contractArtifact),
              a2uiMessages: bookingContractArtifactToA2UI({
                artifact: contractArtifact,
                surfaceId: bookingSurfaceId,
              }),
            };
          } catch {
            // Keep the payment surface until the durable Contract can be read.
          }
        }
        const artifact = environment.cardPaymentApp.getArtifact(
          projection.offerId,
          environment.guestPrincipal(),
        );
        if (artifact.facts.status === "confirmed") {
          const snapshot =
            environment.interactionStore.findBookingSnapshotByOfferId(
              projection.offerId,
            );
          if (snapshot) {
            const contract = JSON.parse(snapshot.contractJson) as {
              contractId: string;
            };
            const bookingSurfaceId = `thread-${thread.threadId}:booking:${contract.contractId}`;
            const contractArtifact = this.#contractArtifact(
              contract.contractId,
            );
            thread.activeSurfaces.delete(PAYMENT_STAGE);
            thread.activeSurfaces.set(BOOKING_STAGE, bookingSurfaceId);
            return {
              surfaceId: bookingSurfaceId,
              mode: "focused-surface",
              summary: "Reservation confirmed",
              conventionalRoute: conventionalBookingContractRoute(
                contract.contractId,
              ),
              textFallback: this.#confirmedBookingFallback(contractArtifact),
              a2uiMessages: bookingContractArtifactToA2UI({
                artifact: contractArtifact,
                surfaceId: bookingSurfaceId,
              }),
            };
          }
        }
        if (artifact.facts.status === "expired") {
          const expiredId = `thread-${thread.threadId}:payment:expired:${projection.offerId}`;
          thread.activeSurfaces.set(PAYMENT_STAGE, expiredId);
          return {
            ...this.#paymentSurface(
              thread,
              artifact,
              "Payment Window expired",
              expiredId,
            ),
            status: "expired",
            textFallback: `Payment window expired. ${GUEST_FACT_LABELS.amountDueNow}: ${formatNgnKobo(artifact.facts.amountDueNowKobo)}. No Reservation exists.`,
          };
        }
        const storedSurfaceId = projection.activeSurfaceId ?? "";
        // The stored surface id is the authoritative pointer to the exact
        // server-owned presentation (ADR-0074): processing, deposit, checkout
        // and ready surfaces must restore to the same lifecycle state.
        if (
          storedSurfaceId.includes(":payment:result:") ||
          artifact.facts.journeyStage === "stay_payment_processing"
        ) {
          const processingId = storedSurfaceId.includes(":payment:result:")
            ? storedSurfaceId
            : `thread-${thread.threadId}:payment:result:${projection.offerId}`;
          thread.activeSurfaces.set(PAYMENT_STAGE, processingId);
          return this.#paymentSurface(
            thread,
            artifact,
            "Checking payment",
            processingId,
          );
        }
        if (
          artifact.facts.status === "deposit_required" ||
          storedSurfaceId.includes(":deposit-")
        ) {
          const depositId = `thread-${thread.threadId}:payment:deposit-ready:${projection.offerId}`;
          thread.activeSurfaces.set(PAYMENT_STAGE, depositId);
          return this.#paymentSurface(
            thread,
            artifact,
            `${GUEST_GLOSSARY.refundableSecurityDeposit} payment required`,
            depositId,
          );
        }
        const session = environment.cardPaymentApp.getCheckoutSession(
          projection.offerId,
        );
        if (
          artifact.facts.status === "checkout_initiated" ||
          (session && session.status === "initiated")
        ) {
          const checkoutId =
            session?.checkoutId ??
            (storedSurfaceId.includes(":checkout:")
              ? (storedSurfaceId.split(":checkout:").at(-1) ?? "restored")
              : "restored");
          const checkoutSurfaceId = `thread-${thread.threadId}:payment:checkout:${checkoutId}`;
          thread.activeSurfaces.set(PAYMENT_STAGE, checkoutSurfaceId);
          return this.#paymentSurface(
            thread,
            artifact,
            "Payment handoff",
            checkoutSurfaceId,
          );
        }
        const readyId = storedSurfaceId.includes(":payment:ready:")
          ? storedSurfaceId
          : `thread-${thread.threadId}:payment:ready:${projection.offerId}`;
        thread.activeSurfaces.set(PAYMENT_STAGE, readyId);
        return {
          ...this.#paymentSurface(thread, artifact, "Secure payment", readyId),
        };
      }
      if (projection.activeStage === BOOKING_STAGE) {
        const snapshot =
          environment.interactionStore.findBookingSnapshotByOfferId(
            projection.offerId ?? "",
          );
        if (snapshot) {
          const contract = JSON.parse(snapshot.contractJson) as {
            contractId: string;
            offerId: string;
          };
          const bookingSurfaceId = surfaceId.includes(":booking:")
            ? surfaceId
            : `thread-${thread.threadId}:booking:${contract.contractId}`;
          const contractArtifact = this.#contractArtifact(contract.contractId);
          thread.activeSurfaces.set(BOOKING_STAGE, bookingSurfaceId);
          return {
            surfaceId: bookingSurfaceId,
            mode: "focused-surface",
            summary: "Reservation confirmed",
            conventionalRoute: conventionalBookingContractRoute(
              contract.contractId,
            ),
            textFallback: this.#confirmedBookingFallback(contractArtifact),
            a2uiMessages: bookingContractArtifactToA2UI({
              artifact: contractArtifact,
              surfaceId: bookingSurfaceId,
            }),
          };
        }
      }
      if (
        projection.activeStage === DISCOVERY_STAGE &&
        projection.discoveryArtifact
      ) {
        thread.activeSurfaces.set(
          DISCOVERY_STAGE,
          projection.discoverySurfaceId,
        );
        return discoverySurface(
          projection.discoveryArtifact,
          projection.discoverySurfaceId,
          this.#environment.config.demo === true,
        );
      }
      return null;
    } catch {
      // A current-domain validation failure during restoration keeps the
      // thread non-actionable rather than starting a new workflow.
      this.#emitTransition(thread, "interaction.restart_restoration_failed", {
        aggregateType: "interaction_thread",
        aggregateId: thread.threadId,
        reasonCode: "RESTORATION_FAILED",
      });
      return null;
    }
  }

  #createThread(threadId: string): GuestThreadState {
    const thread: GuestThreadState = {
      threadId,
      discoveryContext: null,
      discoveryArtifact: null,
      discoveryArtifactId: null,
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
      assistantContext: null,
      compareSelection: null,
      draftChangeContext: null,
      pendingDraftReplacement: null,
    };
    this.#threads.set(threadId, thread);
    return thread;
  }

  #assistantContextFromState(state: AssistantTaskState): PersistedAssistantContext | null {
    const city = state.stayIntent.location;
    if (city !== "Lagos" && city !== "Abuja") return null;
    const knownNeighbourhoods = new Set(this.#environment.unitRepository.findAll().map((unit) => unit.location.neighbourhood));
    const neighbourhood = state.stayIntent.neighbourhood;
    const amenityIds = new Set(this.#environment.unitRepository.findAll().flatMap((unit) => unit.amenities));
    const requiredAmenities = state.stayIntent.requiredAmenities?.filter((amenity) => amenityIds.has(amenity) && /^[A-Za-z0-9_-]{1,48}$/.test(amenity)).slice(0, 16);
    const selectedStay = state.selectedStayRef ? state.shortlist.find((stay) => stay.stayRef === state.selectedStayRef) : undefined;
    return {
      city,
      ...(neighbourhood && knownNeighbourhoods.has(neighbourhood) ? { neighbourhood } : {}),
      ...(state.stayIntent.checkIn && /^\d{4}-\d{2}-\d{2}$/.test(state.stayIntent.checkIn) ? { checkIn: state.stayIntent.checkIn } : {}),
      ...(typeof state.stayIntent.isDemoDate === "boolean" ? { isDemoDate: state.stayIntent.isDemoDate } : {}),
      ...(state.stayIntent.checkOut && /^\d{4}-\d{2}-\d{2}$/.test(state.stayIntent.checkOut) ? { checkOut: state.stayIntent.checkOut } : {}),
      ...(Number.isSafeInteger(state.stayIntent.nights) && (state.stayIntent.nights ?? 0) > 0 ? { nights: state.stayIntent.nights } : {}),
      ...(Number.isSafeInteger(state.stayIntent.partySize) && (state.stayIntent.partySize ?? 0) > 0 ? { partySize: state.stayIntent.partySize } : {}),
      ...(Number.isSafeInteger(state.stayIntent.bedrooms) && (state.stayIntent.bedrooms ?? -1) >= 0 ? { bedrooms: state.stayIntent.bedrooms } : {}),
      ...(Number.isSafeInteger(state.stayIntent.maxBudgetKobo) && (state.stayIntent.maxBudgetKobo ?? -1) >= 0 ? { maxBudgetKobo: state.stayIntent.maxBudgetKobo } : {}),
      ...(requiredAmenities?.length ? { requiredAmenities } : {}),
      ...(selectedStay ? { selectedUnitId: selectedStay.unitId } : {}),
    };
  }

  /**
   * Makes the discovery artifact for an assistant context the thread's authoritative one. A planner search leaves its artifact in
   * the runtime and the sync adopts that artifact; a cold restore re-queries the context (ADR 0077/0080) and passes the persisted
   * `keepArtifactId`, so the re-queried facts take over the id the guest's card already names (ADR 0106).
   */
  #assistantContextSearch(
    thread: GuestThreadState,
    context: PersistedAssistantContext,
    currentArtifact?: DiscoveryArtifactProjection,
    keepArtifactId: string | null = null,
  ): void {
    const filters = {
      location: context.city,
      ...(context.neighbourhood ? { neighbourhood: context.neighbourhood } : {}),
      ...(context.checkIn && context.checkOut ? { checkIn: context.checkIn, checkOut: context.checkOut } : {}),
      ...(context.partySize === undefined ? {} : { partySize: context.partySize }),
      ...(context.bedrooms === undefined ? {} : { bedrooms: context.bedrooms }),
      ...(context.maxBudgetKobo === undefined ? {} : { maxPriceKobo: context.maxBudgetKobo }),
      ...(context.requiredAmenities?.length ? { requiredAmenities: context.requiredAmenities } : {}),
    };
    try {
      // ADR 0077/0080: cold start rebuilds current facts from the authorized domain query.
      const currentFilters = currentArtifact?.facts.filters;
      const matchesContext = currentArtifact !== undefined
        && currentFilters?.location === context.city
        && (context.neighbourhood === undefined || currentFilters.neighbourhood === context.neighbourhood)
        && (context.checkIn === undefined || currentFilters.checkIn === context.checkIn)
        && (context.checkOut === undefined || currentFilters.checkOut === context.checkOut);
      let artifact: DiscoveryArtifactProjection;
      if (currentArtifact !== undefined && matchesContext) artifact = currentArtifact;
      else {
        const searched = this.#environment.discoveryQuery.search(filters);
        // ADR 0106: a rebuild for the persisted context keeps the id the guest's card names. Only the facts are re-queried.
        artifact = keepArtifactId === null ? searched : { ...searched, id: keepArtifactId };
      }
      thread.discoveryArtifact = artifact;
      thread.discoveryArtifactId = artifact.id;
      thread.discoveryContext = {
        city: context.city,
        ...(context.neighbourhood ? { neighbourhood: context.neighbourhood } : {}),
        ...(context.checkIn ? { checkIn: context.checkIn, datesConfirmed: true } : {}),
        ...(context.nights === undefined ? {} : { nights: context.nights }),
        ...(context.partySize === undefined ? {} : { partySize: context.partySize }),
        ...(context.bedrooms === undefined ? {} : { bedrooms: context.bedrooms }),
        ...(context.maxBudgetKobo === undefined ? {} : { budget: { kobo: context.maxBudgetKobo, per: "stay" as const } }),
      };
      thread.searchHistory = [thread.discoveryContext];
      // ADR 0106: the detail's artifact is the unit-detail artifact the detail card's Request to Book names, never the discovery artifact.
      thread.unitDetail = context.selectedUnitId && thread.discoveryArtifact.facts.results.some((unit) => unit.id === context.selectedUnitId)
        ? { unitId: context.selectedUnitId, artifactId: unitDetailArtifactId(context.selectedUnitId, thread.discoveryArtifact.projectionVersion) }
        : null;
    } catch {
      thread.discoveryArtifact = null;
      thread.discoveryArtifactId = null;
      thread.unitDetail = null;
    }
  }

  #rebuildAssistantDiscovery(thread: GuestThreadState): void {
    if (!thread.assistantContext) return;
    const runtime = this.#assistantRuntime;
    const currentArtifact = runtime?.hasThread(thread.threadId) ? runtime.getThread(thread.threadId).discoveryArtifact : undefined;
    this.#assistantContextSearch(
      thread,
      thread.assistantContext,
      isDiscoveryArtifactProjection(currentArtifact) ? currentArtifact : undefined,
      thread.discoveryArtifactId,
    );
  }

  #refreshAssistantSurface(thread: GuestThreadState): void {
    if (!thread.assistantContext) return;
    const surfaceId = thread.lastSurfaces.at(-1)?.surfaceId ?? "";
    const stage = this.#stageForSurfaceId(surfaceId);
    if (!stage) return;
    const restored = this.#restoreCurrentSurface(thread, this.#assistantRestoreProjection(thread, stage));
    if (restored) thread.lastSurfaces = [restored];
  }

  #safeAssistantTimelineMessage(thread: GuestThreadState): string {
    const stage = this.#stageForSurfaceId(thread.lastSurfaces.at(-1)?.surfaceId ?? "");
    if (stage === REQUEST_STAGE && thread.draftId && !thread.requestId) return GUEST_ASSISTANT_COPY.draftReady;
    if (stage === UNIT_STAGE) return GUEST_ASSISTANT_COPY.detailsReady;
    if (thread.requestId || thread.offerId) return GUEST_ASSISTANT_COPY.statusReady;
    if (thread.discoveryArtifact) {
      const count = thread.discoveryArtifact.facts.results.length;
      return GUEST_ASSISTANT_COPY.results(count, thread.assistantContext?.neighbourhood ?? thread.assistantContext?.city ?? "your selected area");
    }
    return GUEST_ASSISTANT_COPY.safeClarification;
  }

  #restoreAssistantFromGuestThread(threadId: string, thread: GuestThreadState): void {
    const runtime = this.#assistantRuntime;
    const context = thread.assistantContext;
    if (!runtime || !context || runtime.hasThread(threadId)) return;
    // ADR 0070/0075/0093: load only the owner-checked, minimal projection; never restore model or provider history.
    if (!thread.discoveryArtifact) this.#rebuildAssistantDiscovery(thread);
    const results = thread.discoveryArtifact?.facts.results ?? [];
    const shortlist: AssistantStayReference[] = results.map((unit, index) => ({
      stayRef: `stay-${index + 1}`,
      unitId: unit.id,
      title: unit.title,
      city: unit.location.city,
      neighbourhood: unit.location.neighbourhood,
      capacity: unit.capacity,
      bedrooms: unit.bedrooms,
      amenities: [...unit.amenities],
      nightlyKobo: unit.price.nightlyKobo,
      allInStayTotalKobo: unit.price.allInStayTotalKobo,
      mandatoryFeesKobo: unit.price.mandatoryFeesKobo,
      refundableSecurityDepositKobo: unit.price.refundableSecurityDepositKobo,
      amountDueNowKobo: unit.price.amountDueNowKobo,
      inspectionStatus: unit.trust.inspection.status,
      managementAuthorityStatus: unit.trust.managementAuthority.status,
    }));
    const selected = context.selectedUnitId ? shortlist.find((stay) => stay.unitId === context.selectedUnitId) : undefined;
    let currentContractId: string | undefined;
    let currentReservationId: string | undefined;
    if (thread.offerId) {
      const snapshot = this.#environment.interactionStore.findBookingSnapshotByOfferId(thread.offerId);
      if (snapshot) {
        try {
          const booking = JSON.parse(snapshot.contractJson) as { contractId?: unknown; reservationId?: unknown };
          if (typeof booking.contractId === "string") currentContractId = booking.contractId;
          if (typeof booking.reservationId === "string") currentReservationId = booking.reservationId;
        } catch { /* Invalid persisted metadata cannot restore domain status. */ }
      }
    }
    const state: AssistantTaskState = {
      goal: shortlist.length ? "find_stay" : null,
      stayIntent: {
        location: context.city,
        ...(context.neighbourhood ? { neighbourhood: context.neighbourhood } : {}),
        ...(context.checkIn ? { checkIn: context.checkIn } : {}),
        ...(typeof context.isDemoDate === "boolean" ? { isDemoDate: context.isDemoDate } : {}),
        ...(context.checkOut ? { checkOut: context.checkOut } : {}),
        ...(context.nights === undefined ? {} : { nights: context.nights }),
        ...(context.partySize === undefined ? {} : { partySize: context.partySize }),
        ...(context.bedrooms === undefined ? {} : { bedrooms: context.bedrooms }),
        ...(context.maxBudgetKobo === undefined ? {} : { maxBudgetKobo: context.maxBudgetKobo }),
        ...(context.requiredAmenities ? { requiredAmenities: context.requiredAmenities } : {}),
      },
      shortlist,
      ...(selected ? { selectedStayRef: selected.stayRef } : {}),
      ...(thread.draftId ? { currentDraftId: thread.draftId } : {}),
      ...(thread.requestId ? { currentBookingRequestId: thread.requestId } : {}),
      ...(thread.offerId ? { currentOfferId: thread.offerId } : {}),
      ...(currentReservationId ? { currentReservationId } : {}),
      ...(currentContractId ? { currentContractId } : {}),
      pendingAction: null,
    };
    const canonicalUserFacts = context.isDemoDate === false
      ? [context.checkIn, context.checkOut].filter((fact): fact is string => typeof fact === "string")
      : [];
    // ADR 0106: the runtime and the shell share one authoritative discovery artifact after a restore.
    runtime.restoreShortletState(threadId, {
      principalId: this.#environment.guestPrincipal().id,
      tenantId: this.#environment.config.tenantId,
      taskState: state,
      canonicalUserFacts,
      ...(thread.discoveryArtifact ? { discoveryArtifact: thread.discoveryArtifact } : {}),
    });
  }

  #syncAssistantPersistence(threadId: string, thread: GuestThreadState): void {
    // ADR 0099/0101: persist only the active Shortlet pack's canonical filters and domain references through this host boundary.
    const runtime = this.#assistantRuntime;
    if (!runtime?.hasThread(threadId)) return;
    const assistant = runtime.getThread(threadId);
    const activeTask = assistant.tasks.find((task) => task.taskId === assistant.activeTaskId);
    if (activeTask?.domain !== "shortlet") return;
    const context = this.#assistantContextFromState(assistant.taskState);
    if (context) {
      thread.assistantContext = context;
      const runtimeArtifact = isDiscoveryArtifactProjection(assistant.discoveryArtifact) ? assistant.discoveryArtifact : undefined;
      this.#assistantContextSearch(thread, context, runtimeArtifact ?? thread.discoveryArtifact ?? undefined);
    }
    if (assistant.taskState.currentDraftId) thread.draftId = assistant.taskState.currentDraftId;
    if (assistant.taskState.currentBookingRequestId) thread.requestId = assistant.taskState.currentBookingRequestId;
    if (assistant.taskState.currentOfferId) thread.offerId = assistant.taskState.currentOfferId;
    if (thread.draftId) {
      try {
        const quote = this.#draftArtifact(thread, "draft").facts;
        thread.draftQuote = { allInStayTotalKobo: quote.allInStayTotalKobo, refundableSecurityDepositKobo: quote.refundableSecurityDepositKobo, amountDueNowKobo: quote.amountDueNowKobo };
      } catch { thread.draftQuote = null; }
    } else thread.draftQuote = null;
    const selected = assistant.taskState.selectedStayRef;
    if (selected && thread.discoveryArtifact) {
      const ref = assistant.taskState.shortlist.find((stay) => stay.stayRef === selected);
      const unit = ref ? thread.discoveryArtifact.facts.results.find((candidate) => candidate.id === ref.unitId) : undefined;
      // ADR 0106: the same unit-detail artifact id `#openUnitDetail` issues, so the detail's Request to Book stays authorized.
      thread.unitDetail = unit ? { unitId: unit.id, artifactId: unitDetailArtifactId(unit.id, thread.discoveryArtifact.projectionVersion) } : null;
    } else if (!selected) thread.unitDetail = null;
    const activeSurface = assistant.lastSurfaces.at(-1);
    const stage = activeSurface ? this.#stageForSurfaceId(activeSurface.surfaceId) : null;
    // ADR 0106: the planner's discovery card is the shell's current discovery surface. Adopting its id keeps the id the
    // guest holds, the id a restore presents, and the id the View guard accepts the same; a superseded search's id is stale.
    if (activeSurface && stage === DISCOVERY_STAGE) thread.discoverySurfaceId = activeSurface.surfaceId;
    // ADR 0106: a unit the planner opens is the shell's active unit surface, so the guest's next action on that card is authorized
    // and the discovery card it came from goes stale, as the planner's own bookkeeping says.
    if (activeSurface && stage === UNIT_STAGE) {
      this.#supersede(thread, DISCOVERY_STAGE);
      this.#supersede(thread, COMPARE_STAGE);
      thread.activeSurfaces.set(UNIT_STAGE, activeSurface.surfaceId);
    }
    if (stage && thread.assistantContext) {
      this.#refreshAssistantSurface(thread);
    }
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
    // Issue 14 / M3: a new search forgets the draft on screen, so its Review
    // and Submit go stale. Resuming the same stay re-presents it.
    if (!thread.requestId && !thread.offerId)
      this.#supersede(thread, REQUEST_STAGE);
    this.#supersede(thread, DRAFT_REPLACEMENT_STAGE);
    thread.draftChangeContext = null;
    thread.pendingDraftReplacement = null;
    // New results end the earlier stay's inspection; replies must not keep
    // answering about an apartment that is no longer on screen.
    thread.unitDetail = null;
    thread.discoveryRevision += 1;
    thread.discoverySurfaceId =
      thread.discoveryRevision === 1
        ? `thread-${thread.threadId}:discovery:results`
        : `thread-${thread.threadId}:discovery:results:${thread.discoveryRevision}`;
  }

  #rememberResult(
    threadId: string,
    userText: string | undefined,
    result: GuestTurnResult & { readonly ok: true },
  ): void {
    const thread =
      this.#threads.get(threadId) ??
      (this.#environment.guestDataIsRemote ? null : this.#loadThread(threadId)) ??
      this.#createThread(threadId);
    if (userText !== undefined)
      thread.timeline.push({ role: "user", text: redactSensitiveData(userText) as string });
    if (result.surfaces.length > 0) thread.lastSurfaces = [...result.surfaces];
    if (result.assistantManaged) this.#syncAssistantPersistence(threadId, thread);
    else if (this.#assistantRuntime?.hasThread(threadId)) {
      const unitId = thread.unitDetail?.unitId;
      if (unitId) {
        this.#assistantRuntime.selectShortletUnit(threadId, unitId);
        if (thread.assistantContext) thread.assistantContext = { ...thread.assistantContext, selectedUnitId: unitId };
      } else {
        this.#assistantRuntime.clearShortletSelection(threadId);
        if (thread.assistantContext?.selectedUnitId) {
          const { selectedUnitId: _selectedUnitId, ...context } = thread.assistantContext;
          thread.assistantContext = context;
        }
      }
    }
    const messages = this.#assistantRuntime?.hasThread(threadId)
      ? result.messages.length > 0
        ? [this.#assistantTimelineMessage(result, thread)]
        : []
      : result.messages;
    for (const message of messages) {
      // Refresh paths can re-present the same outcome message (ADR-0074);
      // avoid duplicating an identical assistant message at the tail.
      const tail = thread.timeline.at(-1);
      if (tail?.role === "assistant" && tail.text === message) continue;
      thread.timeline.push({ role: "assistant", text: message });
    }
    for (const receipt of result.receipts ?? [])
      thread.timeline.push({ role: "receipt", text: receipt });
    // A text-only turn changes the transcript but does not supersede the
    // current server-backed workspace (ADR-0074).
    try {
      if (result.messages.length > 0)
        this.#environment.telemetry.track({
          type: "interaction.text-response-rendered",
        });
      for (const surface of result.surfaces) {
        this.#environment.telemetry.track({
          type: `interaction.${surface.mode ?? "surface"}-rendered`,
        });
        if (surface.surfaceId.includes(":booking:")) {
          this.#emitTransition(thread, "reservation.summary.rendered", {
            aggregateType: "reservation",
            aggregateId: surface.surfaceId.split(":booking:").at(-1),
            surfaceId: surface.surfaceId,
          });
        }
      }
    } catch {
      /* presentation telemetry is best-effort */
    }
    if (!this.#environment.guestDataIsRemote) this.#persistThread(thread);
  }

  #assistantTimelineMessage(result: GuestTurnSuccess, thread: GuestThreadState): string {
    switch (result.assistantControlOutcome) {
      case "scope_redirect": return ASSISTANT_CONTROL_COPY.redirect;
      case "scope_unavailable":
      case "quota_refusal":
      case "model_handling_failure":
      case "guard_failure": return ASSISTANT_CONTROL_COPY.unavailable;
      case "support_guidance":
        // This plan renders only fixed support copy from the Shortlet pack; no model prose enters the timeline.
        return result.messages[0] === GUEST_ASSISTANT_COPY.activeStayEmergencySupport
          ? GUEST_ASSISTANT_COPY.activeStayEmergencySupport
          : GUEST_ASSISTANT_COPY.generalSupport;
      case "no_current_booking": return GUEST_ASSISTANT_COPY.noCurrentBooking;
      case "rejected_plan_fallback":
      case "tool_denial":
      case "successful_model_handling":
      case undefined: return this.#safeAssistantTimelineMessage(thread);
    }
  }

  #decorateResult(result: GuestTurnResult): GuestTurnResult {
    if (!result.ok) return result;
    return {
      ...result,
      surfaces: result.surfaces.map((surface) => ({
        ...surface,
        mode:
          surface.mode ??
          (surface.surfaceId.includes(":unit:") ||
          surface.surfaceId.includes(":request:") ||
          surface.surfaceId.includes(":offer:") ||
          surface.surfaceId.includes(":payment:") ||
          surface.surfaceId.includes(":booking:")
            ? "focused-surface"
            : "inline-surface"),
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

  #handleViewUnit(
    thread: GuestThreadState,
    event: GuestEventPayload,
  ): GuestTurnResult {
    const artifact = thread.discoveryArtifact;
    if (!artifact) {
      return {
        ok: false,
        code: "INVALID_ARTIFACT",
        message: "No search is active for this conversation.",
      };
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
        .map((action) => ({
          type: "view-unit" as const,
          unitId: action.unitId,
          conventionalRoute: action.conventionalRoute,
        })),
    };
    const resolved = resolveDiscoveryServerEvent({
      event: this.#handoff(event),
      artifact: authoritative,
    });
    if (!resolved.ok) {
      return { ok: false, code: resolved.code, message: resolved.message };
    }
    const unit = artifact.facts.results.find(
      (candidate) => candidate.id === resolved.effect.unitId,
    );
    if (!unit) {
      return {
        ok: false,
        code: "ACTION_NOT_AUTHORIZED",
        message: `That ${GUEST_GLOSSARY.unit} is not available.`,
      };
    }
    return this.#openUnitDetail(thread, artifact, unit, resolved.effect.route);
  }

  /**
   * A typed request to open a result. The Unit is chosen from the authoritative results in the order they are shown;
   * with several results and none named, the concierge asks which one rather than guessing.
   */
  #viewResultFromChat(
    thread: GuestThreadState,
    artifact: DiscoveryArtifactProjection,
    position: number | "last" | null,
  ): GuestTurnResult {
    const results = artifact.facts.results;
    const ordinalLabels = ["The first one", "The second one", "The third one"];
    const askWhich = (message: string): GuestTurnResult => ({
      ok: true,
      messages: [message],
      surfaces: [],
      quickReplies: ordinalLabels.slice(
        0,
        Math.min(results.length, ordinalLabels.length),
      ),
    });
    if (results.length === 0) {
      return {
        ok: true,
        messages: [
          `There is no ${GUEST_GLOSSARY.unit} to show for this search yet. Tell me how you would like to change it.`,
        ],
        surfaces: [],
      };
    }
    const index =
      position === "last"
        ? results.length - 1
        : position === null
          ? results.length === 1
            ? 0
            : -1
          : position - 1;
    if (position === null && index === -1) {
      return askWhich(
        `I found ${results.length} places. Which one would you like to see? Say “the first one” or “the second one”, or choose ${GUEST_GLOSSARY.viewUnit} on a result.`,
      );
    }
    const unit = results[index];
    if (!unit) {
      return askWhich(
        `This search has ${results.length} ${results.length === 1 ? "place" : "places"}. Which one would you like to see?`,
      );
    }
    const route =
      artifact.actions.find(
        (action) => action.type === "view-unit" && action.unitId === unit.id,
      )?.conventionalRoute ?? `/stays/${encodeURIComponent(unit.id)}`;
    return this.#openUnitDetail(thread, artifact, unit, route);
  }

  /**
   * Opens a Unit from the authoritative discovery artifact, for the generated View action and for the same request
   * typed in chat (issue 10, finding C4). Callers pick the Unit from `artifact.facts.results`, never from client input.
   */
  #openUnitDetail(
    thread: GuestThreadState,
    artifact: DiscoveryArtifactProjection,
    unit: DiscoveryArtifactProjection["facts"]["results"][number],
    route: string,
  ): GuestTurnResult {
    // ADR 0015: the all-in price needs the stay dates. Without them the guest is asked for dates; no detail opens and no
    // selection is recorded, so the thread stays usable.
    const filters = artifact.facts.filters;
    if (typeof filters?.checkIn !== "string" || typeof filters.checkOut !== "string") {
      return { ok: true, messages: [GUEST_ASSISTANT_COPY.unitDatesClarification], surfaces: [] };
    }
    const unitDetailArtifact = unitDetailArtifactFromProjection({
      unit,
      ...this.#stayDatesFor(thread),
      projectionVersion: artifact.projectionVersion,
      viewer: this.#environment.guestPrincipal(),
    });
    thread.unitDetail = { unitId: unit.id, artifactId: unitDetailArtifact.id };
    const surfaceId = unitDetailSurfaceId(
      thread.threadId,
      thread.discoveryRevision,
    );
    // ADR-0074: selecting a Unit supersedes the discovery projection and its
    // generated actions. "Back to results" re-presents the same artifact as a
    // new surface lifecycle (issue 08).
    this.#supersede(thread, DISCOVERY_STAGE);
    this.#supersede(thread, COMPARE_STAGE);
    thread.activeSurfaces.set(UNIT_STAGE, surfaceId);
    this.#emitTransition(thread, "unit.selected", {
      aggregateType: "unit",
      aggregateId: unit.id,
      surfaceId,
    });
    this.#emitTransition(thread, "unit.inspection.opened", {
      aggregateType: "unit",
      aggregateId: unit.id,
      surfaceId,
    });
    return {
      ok: true,
      messages: [`Here are the details for ${unit.title}.`],
      surfaces: [
        {
          surfaceId,
          mode: "focused-surface",
          summary: `${unit.title} details`,
          conventionalRoute: route,
          textFallback: `${unit.title}. ${unit.location.neighbourhood}, ${unit.location.city}. Entire Place; capacity ${unit.capacity} guests. ${GUEST_GLOSSARY.allInStayTotal}: ${unit.price.allInStayTotalKobo === null ? "not yet quoted" : formatNgnKobo(unit.price.allInStayTotalKobo)}. ${GUEST_GLOSSARY.refundableSecurityDeposit}: ${formatNgnKobo(unit.price.refundableSecurityDepositKobo)}. Inspection: ${unit.trust.inspection.status}; Management Authority: ${unit.trust.managementAuthority.status}.`,
          a2uiMessages: unitDetailArtifactToA2UI({
            artifact: unitDetailArtifact,
            surfaceId,
            backToResults: { artifactId: artifact.id },
            demo: this.#environment.config.demo === true,
          }),
        },
      ],
    };
  }

  #handleSeeAllDiscovery(
    thread: GuestThreadState,
    event: GuestEventPayload,
  ): GuestTurnResult {
    const artifact = thread.discoveryArtifact;
    const context = event.context;
    if (
      !artifact ||
      !context ||
      typeof context !== "object" ||
      Array.isArray(context) ||
      Object.keys(context).length !== 1 ||
      context.artifactId !== artifact.id
    ) {
      return {
        ok: false,
        code: "INVALID_CONTEXT",
        message: "That discovery workspace is no longer valid.",
      };
    }
    const surfaceId = `thread-${thread.threadId}:discovery:focused`;
    this.#supersede(thread, DISCOVERY_STAGE);
    thread.activeSurfaces.set(DISCOVERY_STAGE, surfaceId);
    const filters = artifact.facts.filters;
    return {
      ok: true,
      messages: [`Here are all the matching ${GUEST_GLOSSARY.units}.`],
      surfaces: [
        {
          surfaceId,
          mode: "focused-surface",
          summary: "All discovery results",
          conventionalRoute: conventionalSearchRoute(filters),
          textFallback: discoveryFallbackMessage(artifact),
          a2uiMessages: discoveryArtifactToA2UI({
            artifact,
            surfaceId,
            compareSelection: thread.compareSelection ?? undefined,
            demo: this.#environment.config.demo === true,
          }),
        },
      ],
    };
  }

  /**
   * Issue 13b: Compare on a result. The first pick re-presents the same
   * results with that stay marked; the same stay again un-picks it; a second
   * stay opens the two-up comparison. Presentation only: no domain command
   * runs (ADR-0072). Context is checked exactly against the stored artifact.
   */
  #handleCompare(
    thread: GuestThreadState,
    event: GuestEventPayload,
  ): GuestTurnResult {
    const artifact = thread.discoveryArtifact;
    const context = event.context;
    if (
      !artifact ||
      !context ||
      typeof context !== "object" ||
      Array.isArray(context) ||
      Object.keys(context).sort().join(",") !== "artifactId,unitId" ||
      context.artifactId !== artifact.id ||
      typeof context.unitId !== "string"
    ) {
      return {
        ok: false,
        code: "INVALID_CONTEXT",
        message: "Those search results are no longer available.",
      };
    }
    const unitId = context.unitId;
    const unit = artifact.facts.results.find(
      (candidate) => candidate.id === unitId,
    );
    if (!unit || artifact.facts.results.length < 2) {
      return {
        ok: false,
        code: "INVALID_CONTEXT",
        message: `That ${GUEST_GLOSSARY.unit} is not in these results.`,
      };
    }
    const selected =
      thread.compareSelection === null
        ? undefined
        : artifact.facts.results.find(
            (candidate) => candidate.id === thread.compareSelection,
          );
    const surfaceId = event.surfaceId;
    const results = (message: string): GuestTurnResult => ({
      ok: true,
      messages: [message],
      surfaces: [
        {
          ...discoverySurface(
            artifact,
            surfaceId,
            this.#environment.config.demo === true,
            thread.compareSelection ?? undefined,
          ),
          ...(surfaceId.endsWith(":discovery:focused")
            ? {
                mode: "focused-surface" as const,
                summary: "All discovery results",
              }
            : {}),
        },
      ],
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
    this.#emitTransition(thread, "unit.discovery.compared", {
      aggregateType: "discovery",
      aggregateId: artifact.id,
      surfaceId: compareSurfaceId,
    });
    const units = [selected, unit] as const;
    return {
      ok: true,
      messages: [`Here are ${selected.title} and ${unit.title} side by side.`],
      surfaces: [
        {
          surfaceId: compareSurfaceId,
          mode: "focused-surface",
          summary: "Compare stays",
          conventionalRoute: conventionalSearchRoute(artifact.facts.filters),
          textFallback: compareFallbackText(units),
          a2uiMessages: compareArtifactToA2UI({
            artifact,
            unitIds: [selected.id, unit.id],
            surfaceId: compareSurfaceId,
          }),
        },
      ],
    };
  }

  /** Issue 13b: leave the comparison for the same results (no new search, ADR-0079). */
  #handleCompareBack(
    thread: GuestThreadState,
    event: GuestEventPayload,
  ): GuestTurnResult {
    const artifact = thread.discoveryArtifact;
    const context = event.context;
    if (
      !artifact ||
      !context ||
      typeof context !== "object" ||
      Array.isArray(context) ||
      Object.keys(context).length !== 1 ||
      context.artifactId !== artifact.id
    ) {
      return {
        ok: false,
        code: "INVALID_CONTEXT",
        message: "Those search results are no longer available.",
      };
    }
    this.#prepareDiscovery(thread);
    thread.activeSurfaces.set(DISCOVERY_STAGE, thread.discoverySurfaceId);
    this.#emitTransition(thread, "unit.discovery.results_restored", {
      aggregateType: "discovery",
      aggregateId: artifact.id,
      surfaceId: thread.discoverySurfaceId,
    });
    return {
      ok: true,
      messages: ["Here are your search results again."],
      surfaces: [discoverySurface(artifact, thread.discoverySurfaceId, this.#environment.config.demo === true)],
    };
  }

  /**
   * Issue 08: from stay detail, return to the results of the same search. The
   * stored artifact is re-presented, so the criteria and results are the ones
   * the Guest saw; no new search runs (ADR-0079). Every check fails closed.
   */
  #handleBackToResults(
    thread: GuestThreadState,
    event: GuestEventPayload,
  ): GuestTurnResult {
    // AC4 / ADR-0005: going back never touches a sent Booking Request or offer.
    if (thread.requestId || thread.offerId)
      return {
        ok: false,
        code: "STALE_SURFACE",
        message:
          "That action is no longer available; please use the current options.",
      };
    const artifact = thread.discoveryArtifact;
    if (!artifact)
      return {
        ok: false,
        code: "INVALID_ARTIFACT",
        message: "No search is active for this conversation.",
      };
    const context = event.context;
    if (
      !context ||
      typeof context !== "object" ||
      Array.isArray(context) ||
      Object.keys(context).length !== 1 ||
      context.artifactId !== artifact.id
    ) {
      return {
        ok: false,
        code: "INVALID_CONTEXT",
        message: "Those search results are no longer available.",
      };
    }
    // ADR-0074: a new discovery revision, so the old unit surface's actions go stale.
    this.#prepareDiscovery(thread);
    thread.unitDetail = null;
    thread.activeSurfaces.set(DISCOVERY_STAGE, thread.discoverySurfaceId);
    this.#emitTransition(thread, "unit.discovery.results_restored", {
      aggregateType: "discovery",
      aggregateId: artifact.id,
      surfaceId: thread.discoverySurfaceId,
    });
    return {
      ok: true,
      messages: ["Here are your search results again."],
      surfaces: [discoverySurface(artifact, thread.discoverySurfaceId, this.#environment.config.demo === true)],
    };
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
      const draft = this.#environment.bookingRequestApp.getDraft(
        thread.draftId,
      );
      const stay = this.#stayDatesFor(thread);
      return (
        draft.unitId === unitId &&
        draft.checkIn === stay.checkIn &&
        draft.checkOut === stay.checkOut &&
        draft.occupants.length === this.#partySizeFor(thread)
      );
    } catch {
      return false;
    }
  }

  /** Fails closed unless the edit is based on the criteria the server holds now. */
  #criteriaGuard(
    thread: GuestThreadState,
    event: GuestEventPayload,
  ): GuestRejection | null {
    if (thread.requestId || thread.offerId) {
      // ADR-0005: a sent Booking Request is never changed by a search edit.
      const stage = this.#guestStage(thread);
      const explained =
        stage === "request" ||
        stage === "offer" ||
        stage === "payment" ||
        stage === "booking"
          ? stage
          : "request";
      return {
        ok: false,
        code: "CRITERIA_LOCKED",
        message: this.#changeExplanation(explained, this.#currentUnit(thread)),
      };
    }
    if (
      !event.context ||
      event.context.basedOn !== criteriaKey(thread.discoveryContext)
    ) {
      return {
        ok: false,
        code: "STALE_SURFACE",
        message:
          "Your search has changed since this was opened. Check the current search and try again.",
      };
    }
    return null;
  }

  /**
   * Issue 03a AC2/AC3: one strip edit. The server applies it to its own
   * criteria and re-runs the authoritative search (ADR-0004); an edit that
   * breaks a stay limit is refused with the limit and changes nothing.
   */
  #handleCriteriaEdit(
    thread: GuestThreadState,
    event: GuestEventPayload,
  ): GuestTurnResult {
    const guard = this.#criteriaGuard(thread, event);
    if (guard) return guard;
    const edit = readCriteriaEdit(event.context ?? {});
    const next =
      edit === null ? null : applyCriteriaEdit(thread.discoveryContext, edit);
    if (next === null)
      return {
        ok: false,
        code: "INVALID_CRITERIA",
        message:
          "That change could not be applied. Check the value and try again.",
      };
    const resolution = this.#resolveStayRequestContext(next, this.#environment.clock());
    if (resolution.kind === "refuse")
      return {
        ok: false,
        code: "CRITERIA_REJECTED",
        message: resolution.reply,
      };
    thread.discoveryContext = next;
    this.#recordAssistantStayChip(thread, edit, next);
    if (resolution.kind !== "search")
      return {
        ok: true,
        messages: [resolution.reply],
        surfaces: [],
        ...(resolution.kind === "clarify"
          ? { quickReplies: quickRepliesFor(resolution.next) }
          : {}),
      };
    return this.#executeDiscovery(thread, resolution.filters);
  }

  /**
   * ADR 0106: the date and guest chips are structured guest input. A confirmed check-in, its nights and a party size are
   * recorded in the assistant's task state, so the next planner turn sees them and the assistant's persisted context
   * keeps them. A relative or unconfirmed date is not recorded.
   */
  #recordAssistantStayChip(
    thread: GuestThreadState,
    edit: CriteriaEdit | null,
    next: DiscoverySearchContext,
  ): void {
    const runtime = this.#assistantRuntime;
    if (!runtime || !runtime.hasThread(thread.threadId) || edit === null) return;
    const facts =
      edit.field === "when"
        ? {
            ...(next.checkIn !== undefined && next.datesConfirmed !== false
              ? { checkIn: next.checkIn }
              : {}),
            nights: edit.nights,
          }
        : edit.field === "guests"
          ? { partySize: edit.partySize }
          : null;
    if (facts === null || !runtime.recordGuestStay(thread.threadId, facts)) return;
    const context = this.#assistantContextFromState(
      runtime.getThread(thread.threadId).taskState,
    );
    if (context) thread.assistantContext = context;
  }

  /** Issue 03a AC4: restores the previous search's criteria and re-runs it. */
  #handleCriteriaUndo(
    thread: GuestThreadState,
    event: GuestEventPayload,
  ): GuestTurnResult {
    const guard = this.#criteriaGuard(thread, event);
    if (guard) return guard;
    if (Object.keys(event.context ?? {}).length !== 1)
      return {
        ok: false,
        code: "INVALID_CRITERIA",
        message:
          "That change could not be applied. Check the value and try again.",
      };
    const previous = thread.searchHistory.at(-2);
    if (!previous)
      return {
        ok: false,
        code: "NOTHING_TO_UNDO",
        message: "There is no earlier search to go back to.",
      };
    const resolution = this.#resolveStayRequestContext(previous, this.#environment.clock());
    // Dates that have since passed are refused like any other edit.
    if (resolution.kind !== "search")
      return {
        ok: false,
        code: "CRITERIA_REJECTED",
        message: resolution.reply,
      };
    thread.searchHistory.pop();
    thread.discoveryContext = { ...previous };
    const result = this.#executeDiscovery(thread, resolution.filters, {
      recordHistory: false,
    });
    return result.ok
      ? {
          ...result,
          messages: ["I've undone your last change.", ...result.messages],
        }
      : result;
  }

  /** Issue 03a AC1: the strip mirrors the server's criteria after every response. */
  #criteriaFor(thread: GuestThreadState): GuestCriteria | undefined {
    const context = thread.discoveryContext;
    if (!context) return undefined;
    const area = searchAreaFor(context);
    const where =
      context.city === undefined
        ? undefined
        : {
            ...(area === undefined ? {} : { area: area.id }),
            label:
              area?.label ??
              [context.neighbourhood, context.city].filter(Boolean).join(", "),
          };
    const nights = context.nights;
    const nightsLabel =
      nights === undefined
        ? ""
        : `${nights} ${nights === 1 ? "night" : "nights"}`;
    const checkOut =
      context.checkIn !== undefined && nights !== undefined
        ? new Date(
            Date.parse(`${context.checkIn}T00:00:00Z`) + nights * 86_400_000,
          )
            .toISOString()
            .slice(0, 10)
        : undefined;
    const whenLabel =
      context.checkIn !== undefined && checkOut !== undefined
        ? `${formatStayDates(context.checkIn, checkOut)} · ${nightsLabel}`
        : context.checkIn === undefined
          ? nightsLabel
          : `From ${formatGuestDay(context.checkIn)}`;
    const when =
      whenLabel === ""
        ? undefined
        : {
            ...(context.checkIn === undefined
              ? {}
              : { checkIn: context.checkIn }),
            ...(nights === undefined ? {} : { nights }),
            label:
              context.checkIn !== undefined && context.datesConfirmed !== true
                ? `${whenLabel} (to confirm)`
                : whenLabel,
          };
    const guests =
      context.partySize === undefined
        ? undefined
        : {
            count: context.partySize,
            label: `${context.partySize} ${context.partySize === 1 ? "guest" : "guests"}`,
          };
    const budgetText = budgetLabel(context);
    const budget =
      context.budget === undefined || budgetText === undefined
        ? undefined
        : {
            naira: Math.round(context.budget.kobo / 100),
            per: context.budget.per,
            label: budgetText,
          };
    if (!where && !when && !guests && !budget) return undefined;
    return {
      key: criteriaKey(context),
      editable: !thread.requestId && !thread.offerId,
      canUndo:
        thread.searchHistory.length >= 2 &&
        !thread.requestId &&
        !thread.offerId,
      ...(where ? { where } : {}),
      ...(when ? { when } : {}),
      ...(guests ? { guests } : {}),
      ...(budget ? { budget } : {}),
      areas: SEARCH_AREAS.map(({ id, label }) => ({ id, label })),
    };
  }

  #handleRequestToBook(
    thread: GuestThreadState,
    event: GuestEventPayload,
  ): GuestTurnResult {
    const detail = thread.unitDetail;
    const context = event.context;
    if (
      !detail ||
      !context ||
      typeof context !== "object" ||
      (context as Record<string, unknown>).artifactId !== detail.artifactId ||
      (context as Record<string, unknown>).unitId !== detail.unitId
    ) {
      return {
        ok: false,
        code: "INVALID_CONTEXT",
        message: "That request is no longer valid.",
      };
    }
    if (thread.requestId || thread.offerId)
      return {
        ok: false,
        code: "STALE_SURFACE",
        message: "A Booking Request already exists for this conversation.",
      };

    if (thread.draftId && this.#draftMatchesStay(thread, detail.unitId)) {
      const surfaceId = `thread-${thread.threadId}:request:draft:${thread.draftId}`;
      const artifact = this.#draftArtifact(thread, "draft");
      this.#supersede(thread, UNIT_STAGE);
      thread.activeSurfaces.set(REQUEST_STAGE, surfaceId);
      this.#emitTransition(thread, "request_draft.resumed", {
        aggregateType: "request_draft",
        aggregateId: thread.draftId,
        surfaceId,
      });
      return {
        ok: true,
        messages: ["Your request is ready to continue."],
        surfaces: [
          {
            surfaceId,
            mode: "focused-surface",
            summary: "Request Draft",
            conventionalRoute: conventionalRequestDraftRoute(thread.draftId),
            textFallback: this.#draftFallback(artifact),
            a2uiMessages: requestDraftArtifactToA2UI({ artifact, surfaceId }),
          },
        ],
      };
    }

    const environment = this.#environment;
    const guest: CommandPrincipal = environment.guestPrincipal();
    const draft = environment.bookingRequestApp.createDraft(
      {
        unitId: detail.unitId,
        primaryGuest: {
          id: environment.guestPrincipal().id,
          name: environment.config.guestName,
        },
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
    thread.draftQuote = {
      allInStayTotalKobo: artifact.facts.allInStayTotalKobo,
      refundableSecurityDepositKobo:
        artifact.facts.refundableSecurityDepositKobo,
      amountDueNowKobo: artifact.facts.amountDueNowKobo,
    };
    this.#emitTransition(thread, "request_draft.created", {
      aggregateType: "request_draft",
      aggregateId: draft.draftId,
      surfaceId: requestSurfaceId,
    });

    return {
      ok: true,
      messages: [],
      receipts: [GUEST_RECEIPTS.draftCreated],
      surfaces: [
        {
          surfaceId: requestSurfaceId,
          mode: "focused-surface",
          summary: "Request Draft",
          conventionalRoute: conventionalRequestDraftRoute(draft.draftId),
          textFallback: this.#draftFallback(artifact),
          a2uiMessages: requestDraftArtifactToA2UI({
            artifact,
            surfaceId: requestSurfaceId,
          }),
        },
      ],
    };
  }

  #draftArtifact(
    thread: GuestThreadState,
    view: "draft" | "review",
  ): RequestDraftArtifact {
    if (!thread.draftId) throw new Error("No Request Draft is active");
    const draft = this.#environment.bookingRequestApp.getDraft(
      thread.draftId,
    ) as {
      readonly draftId: string;
      readonly unitId: string;
      readonly primaryGuest: { readonly name: string };
      readonly occupants: readonly { readonly name: string }[];
      readonly checkIn: string;
      readonly checkOut: string;
      readonly selfBookingAttestation: {
        readonly accepted: boolean;
        readonly version: string;
      };
    };
    const unit = this.#environment.unitRepository.findById(
      draft.unitId,
    ) as Unit | null;
    if (!unit)
      throw new Error(
        `The selected ${GUEST_GLOSSARY.unit} is no longer available.`,
      );
    const quote = createStayQuote({
      unit,
      checkIn: draft.checkIn,
      checkOut: draft.checkOut,
      partySize: draft.occupants.length || 1,
      ...(this.#environment.extendedStayPolicy ? { extendedStayPolicy: this.#environment.extendedStayPolicy } : {}),
      clock: this.#environment.clock,
    });
    return requestDraftArtifactFromProjection(
      {
        draftId: draft.draftId,
        unitId: unit.id,
        unitTitle: unit.title,
        operatorName: unit.operator.name,
        checkIn: quote.checkIn,
        checkOut: quote.checkOut,
        nights: quote.nights,
        primaryGuestName: draft.primaryGuest.name,
        occupants: draft.occupants.map((occupant) => occupant.name),
        selfBookingAttestation: draft.selfBookingAttestation,
        allInStayTotalKobo: quote.allInStayTotalKobo,
        refundableSecurityDepositKobo: quote.refundableSecurityDepositKobo,
        amountDueNowKobo: quote.totalAmountDueNowKobo,
        ...extendedStayDraftFacts(quote),
        cancellationPolicy: {
          type: quote.cancellationPolicy.type,
          version: quote.cancellationPolicy.version,
          summary: quote.cancellationPolicy.policySummary,
        },
        view,
        policyVersions: quote.policyVersions,
        disclosures: quote.disclosures,
      },
      this.#environment.guestPrincipal(),
    );
  }

  /**
   * Issue 14 AC3: "make it 3 nights" on a Request Draft proposes a re-quoted
   * replacement that needs the Guest's confirmation. A draft blocks nothing
   * and promises nothing (CONTEXT.md), so this is not an ADR-0060 amendment;
   * the replacement quote may be accepted or declined without penalty
   * (ADR-0015). Returns null when the turn is not a change to the draft's
   * stay, so a new place still runs a new search.
   */
  #proposeDraftReplacement(
    thread: GuestThreadState,
    text: string,
  ): GuestTurnResult | null {
    const onScreen = thread.activeSurfaces.get(REQUEST_STAGE) ?? "";
    if (
      !thread.draftId ||
      thread.requestId ||
      thread.offerId ||
      !(
        onScreen.includes(":request:draft:") ||
        onScreen.includes(":request:review:")
      )
    )
      return null;
    const now = this.#environment.clock();
    const facts = extractStayRequestFacts(text, { now });
    if (facts.location !== undefined) return null;
    // A date check lasts one turn, as its reply says: "yes", or different
    // dates. Any other turn drops it, so a later change never builds on
    // dates the Guest didn't confirm.
    const pendingDates = thread.draftChangeContext;
    thread.draftChangeContext = null;
    const onPending =
      pendingDates === null
        ? null
        : mergeStayRequestContext(pendingDates, facts, text);
    const merged =
      onPending !== null &&
      (onPending.confirmedDates === true || facts.dates !== undefined)
        ? onPending
        : mergeStayRequestContext(thread.discoveryContext, facts, text);
    const changed =
      facts.nights !== undefined ||
      facts.partySize !== undefined ||
      facts.dates !== undefined ||
      merged.confirmedDates === true;
    if (!changed || merged.conflict) return null;
    const unchanged = "Your Request Draft is unchanged.";
    const resolution = this.#resolveStayRequestContext(merged.context, now);
    if (resolution.kind === "confirm") {
      // Issue 01: relative dates are confirmed before anything is quoted. The
      // wording is the discovery check's, but "yes" updates the draft here.
      thread.draftChangeContext = merged.context;
      const { checkIn, checkOut, partySize } = resolution.filters;
      const nights = Math.round(
        (Date.parse(`${checkOut}T00:00:00Z`) -
          Date.parse(`${checkIn}T00:00:00Z`)) /
          86_400_000,
      );
      return {
        ok: true,
        messages: [
          `Just to check: arriving ${formatGuestDay(checkIn)} and leaving ${formatGuestDay(checkOut)} (${nights} ${nights === 1 ? "night" : "nights"}), ${partySize} ${partySize === 1 ? "guest" : "guests"}. Shall I show your Request Draft with these dates? Reply "yes", or tell me different dates.`,
          unchanged,
        ],
        surfaces: [],
      };
    }
    // The 14-night and 90-day refusals are the discovery ones, unchanged.
    if (resolution.kind !== "search")
      return {
        ok: true,
        messages: [resolution.reply, unchanged],
        surfaces: [],
      };
    const draft = this.#environment.bookingRequestApp.getDraft(
      thread.draftId,
    );
    const { filters } = resolution;
    const stay: DraftReplacementStay = {
      location: filters.location,
      ...(filters.neighbourhood === undefined
        ? {}
        : { neighbourhood: filters.neighbourhood }),
      checkIn: filters.checkIn,
      checkOut: filters.checkOut,
      partySize: filters.partySize,
    };
    if (
      stay.checkIn === draft.checkIn &&
      stay.checkOut === draft.checkOut &&
      stay.partySize === draft.occupants.length
    ) {
      return {
        ok: true,
        messages: [
          `Your Request Draft already covers ${formatStayDates(stay.checkIn, stay.checkOut)} for ${stay.partySize} ${stay.partySize === 1 ? "guest" : "guests"}.`,
        ],
        surfaces: [],
      };
    }
    const proposal = this.#replacementTerms(draft.unitId, stay);
    if (proposal === null)
      return {
        ok: true,
        messages: [this.#replacementUnavailable(draft.unitId, stay), unchanged],
        surfaces: [],
      };
    return this.#presentDraftReplacement(
      thread,
      {
        unitId: draft.unitId,
        stay,
        filters,
        context: merged.context,
        proposed: proposal,
      },
      "Here is your Request Draft with the new details. It changes only if you choose “Use the new details”.",
    );
  }

  /** ADR-0015: the same deterministic quote as the draft; null when the unit can't take the stay. */
  #replacementTerms(
    unitId: string,
    stay: DraftReplacementStay,
  ): DraftStayTerms | null {
    const environment = this.#environment;
    // Revalidate availability and capacity for the stay itself, not budget or bedroom preferences.
    const results = environment.discoveryQuery.search({ ...stay }).facts
      .results;
    const unit = environment.unitRepository.findById(unitId) as Unit | null;
    if (!unit || !results.some((candidate) => candidate.id === unitId))
      return null;
    const quote = createStayQuote({
      unit,
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      partySize: stay.partySize,
      ...(environment.extendedStayPolicy ? { extendedStayPolicy: environment.extendedStayPolicy } : {}),
      clock: environment.clock,
    });
    return {
      checkIn: quote.checkIn,
      checkOut: quote.checkOut,
      nights: quote.nights,
      partySize: stay.partySize,
      allInStayTotalKobo: quote.allInStayTotalKobo,
      refundableSecurityDepositKobo: quote.refundableSecurityDepositKobo,
      amountDueNowKobo: quote.totalAmountDueNowKobo,
    };
  }

  #replacementUnavailable(unitId: string, stay: DraftReplacementStay): string {
    const title =
      (this.#environment.unitRepository.findById(unitId) as Unit | null)
        ?.title ?? `This ${GUEST_GLOSSARY.unit}`;
    return `${title} isn't available for ${formatStayDates(stay.checkIn, stay.checkOut)} for ${stay.partySize} ${stay.partySize === 1 ? "guest" : "guests"}.`;
  }

  #presentDraftReplacement(
    thread: GuestThreadState,
    change: Omit<
      PendingDraftReplacement,
      "basedOnDraftId" | "basedOn" | "surfaceId"
    >,
    message: string,
  ): GuestTurnResult {
    const draftId = thread.draftId;
    if (!draftId) throw new Error("No Request Draft is active");
    const current = this.#draftArtifact(thread, "draft").facts;
    const surfaceId = `thread-${thread.threadId}:request:replacement:${draftId}`;
    const basedOn = JSON.stringify([draftId, change.unitId, change.proposed]);
    this.#supersede(thread, DRAFT_REPLACEMENT_STAGE);
    thread.activeSurfaces.set(DRAFT_REPLACEMENT_STAGE, surfaceId);
    thread.pendingDraftReplacement = {
      ...change,
      basedOnDraftId: draftId,
      basedOn,
      surfaceId,
    };
    this.#emitTransition(thread, "request_draft.replacement_proposed", {
      aggregateType: "request_draft",
      aggregateId: draftId,
      surfaceId,
    });
    const proposal = {
      draftId,
      basedOn,
      unitTitle: current.unitTitle,
      current: {
        checkIn: current.checkIn,
        checkOut: current.checkOut,
        nights: current.nights,
        partySize: current.occupants.length,
        allInStayTotalKobo: current.allInStayTotalKobo,
        refundableSecurityDepositKobo: current.refundableSecurityDepositKobo,
        amountDueNowKobo: current.amountDueNowKobo,
      },
      proposed: change.proposed,
    };
    return {
      ok: true,
      messages: [message],
      surfaces: [
        {
          surfaceId,
          mode: "focused-surface",
          summary: "Change Request Draft",
          conventionalRoute: conventionalRequestDraftRoute(draftId),
          textFallback: draftReplacementFallback(proposal),
          a2uiMessages: draftReplacementToA2UI({ proposal, surfaceId }),
        },
      ],
    };
  }

  /** The current draft surface, re-presented as it was (draft or review). */
  #currentDraftSurface(thread: GuestThreadState): GuestSurfacePayload {
    const draftId = thread.draftId;
    if (!draftId) throw new Error("No Request Draft is active");
    const surfaceId =
      thread.activeSurfaces.get(REQUEST_STAGE) ??
      `thread-${thread.threadId}:request:draft:${draftId}`;
    const review = surfaceId.includes(":request:review:");
    thread.activeSurfaces.set(REQUEST_STAGE, surfaceId);
    const artifact = this.#draftArtifact(thread, review ? "review" : "draft");
    return {
      surfaceId,
      mode: "focused-surface",
      summary: review ? "Request review" : "Request Draft",
      conventionalRoute: conventionalRequestDraftRoute(draftId),
      textFallback: this.#draftFallback(artifact),
      a2uiMessages: requestDraftArtifactToA2UI({ artifact, surfaceId }),
    };
  }

  /**
   * Issue 14: accepting the replacement re-checks the stay and the quote
   * (ADR-0015), then creates a new Request Draft through the platform
   * command (ADR-0072). The old draft's surfaces go stale; the old draft
   * blocked nothing, so nothing is released. Every check fails closed.
   */
  #handleDraftReplacementAccept(
    thread: GuestThreadState,
    event: GuestEventPayload,
  ): GuestTurnResult {
    const pending = thread.pendingDraftReplacement;
    const context = event.context;
    if (
      !pending ||
      !thread.draftId ||
      thread.requestId ||
      thread.offerId ||
      !isPlainRecord(context) ||
      Object.keys(context).sort().join(",") !== "basedOn,draftId" ||
      context.draftId !== thread.draftId ||
      pending.basedOnDraftId !== thread.draftId ||
      context.basedOn !== pending.basedOn
    ) {
      return {
        ok: false,
        code: "INVALID_CONTEXT",
        message: "That change to your Request Draft is no longer valid.",
      };
    }
    const fresh = this.#replacementTerms(pending.unitId, pending.stay);
    if (fresh === null) {
      thread.pendingDraftReplacement = null;
      this.#supersede(thread, DRAFT_REPLACEMENT_STAGE);
      return {
        ok: true,
        messages: [
          this.#replacementUnavailable(pending.unitId, pending.stay),
          "Your Request Draft is unchanged.",
        ],
        surfaces: [this.#currentDraftSurface(thread)],
      };
    }
    if (JSON.stringify(fresh) !== JSON.stringify(pending.proposed)) {
      return this.#presentDraftReplacement(
        thread,
        { ...pending, proposed: fresh },
        "The price changed before you chose. Here are the updated details; your Request Draft is unchanged until you choose.",
      );
    }
    const environment = this.#environment;
    const guest = environment.guestPrincipal();
    const replaced = thread.draftId;
    const draft = environment.bookingRequestApp.createDraft(
      {
        unitId: pending.unitId,
        primaryGuest: { id: guest.id, name: environment.config.guestName },
        occupants: environment.demoOccupants(pending.stay.partySize),
        selfBookingAttestation: environment.selfBookingAttestation(),
        checkIn: pending.stay.checkIn,
        checkOut: pending.stay.checkOut,
      },
      guest,
    );
    this.#supersede(thread, REQUEST_STAGE);
    this.#supersede(thread, DRAFT_REPLACEMENT_STAGE);
    thread.pendingDraftReplacement = null;
    // The conversation's criteria and stored results follow the accepted stay,
    // so the criteria strip, undo and resuming the draft all agree.
    if (thread.discoveryContext) {
      thread.searchHistory.push({ ...thread.discoveryContext });
      if (thread.searchHistory.length > MAX_SEARCH_HISTORY)
        thread.searchHistory.splice(
          0,
          thread.searchHistory.length - MAX_SEARCH_HISTORY,
        );
    }
    thread.discoveryContext = pending.context;
    thread.discoveryArtifact = environment.discoveryQuery.search({
      ...pending.filters,
    });
    thread.draftId = draft.draftId;
    const surfaceId = `thread-${thread.threadId}:request:draft:${draft.draftId}`;
    thread.activeSurfaces.set(REQUEST_STAGE, surfaceId);
    const artifact = this.#draftArtifact(thread, "draft");
    thread.draftQuote = {
      allInStayTotalKobo: artifact.facts.allInStayTotalKobo,
      refundableSecurityDepositKobo:
        artifact.facts.refundableSecurityDepositKobo,
      amountDueNowKobo: artifact.facts.amountDueNowKobo,
    };
    this.#emitTransition(thread, "request_draft.replaced", {
      aggregateType: "request_draft",
      aggregateId: draft.draftId,
      correlationId: replaced,
      surfaceId,
    });
    const { stay } = pending;
    return {
      ok: true,
      messages: [
        `Your Request Draft now covers ${formatStayDates(stay.checkIn, stay.checkOut)} for ${stay.partySize} ${stay.partySize === 1 ? "guest" : "guests"}. Review it before you send it.`,
      ],
      receipts: [GUEST_RECEIPTS.draftUpdated],
      surfaces: [
        {
          surfaceId,
          mode: "focused-surface",
          summary: "Request Draft",
          conventionalRoute: conventionalRequestDraftRoute(draft.draftId),
          textFallback: this.#draftFallback(artifact),
          a2uiMessages: requestDraftArtifactToA2UI({ artifact, surfaceId }),
        },
      ],
    };
  }

  /** Issue 14: keeping the current draft is free and changes nothing (ADR-0015). */
  #handleDraftReplacementKeep(
    thread: GuestThreadState,
    event: GuestEventPayload,
  ): GuestTurnResult {
    const pending = thread.pendingDraftReplacement;
    const context = event.context;
    if (
      !pending ||
      !thread.draftId ||
      !isPlainRecord(context) ||
      Object.keys(context).join(",") !== "draftId" ||
      context.draftId !== thread.draftId ||
      pending.basedOnDraftId !== thread.draftId
    ) {
      return {
        ok: false,
        code: "INVALID_CONTEXT",
        message: "That change to your Request Draft is no longer valid.",
      };
    }
    thread.pendingDraftReplacement = null;
    this.#supersede(thread, DRAFT_REPLACEMENT_STAGE);
    this.#emitTransition(thread, "request_draft.replacement_declined", {
      aggregateType: "request_draft",
      aggregateId: thread.draftId,
      surfaceId: event.surfaceId,
    });
    return {
      ok: true,
      messages: ["Your Request Draft is unchanged."],
      surfaces: [this.#currentDraftSurface(thread)],
    };
  }

  #draftFallback(artifact: RequestDraftArtifact): string {
    const review = artifact.actions[0]?.type === "submit";
    const { facts } = artifact;
    // Issue 07 AC1: one reservation-status statement; ADR-0006 provider only on review.
    return `${guestReservationStatus("draft")}. ${facts.unitTitle}. ${review ? `${accommodationProviderLine(facts.operatorName)}. ` : ""}${formatStayDates(facts.checkIn, facts.checkOut)} · ${facts.nights} ${facts.nights === 1 ? "night" : "nights"} · ${facts.occupants.length} ${facts.occupants.length === 1 ? "guest" : "guests"}. ${GUEST_GLOSSARY.allInStayTotal}: ${formatNgnKobo(facts.allInStayTotalKobo)}. ${facts.refundableSecurityDepositKobo > 0 ? `${GUEST_GLOSSARY.refundableSecurityDeposit} (separate): ${formatNgnKobo(facts.refundableSecurityDepositKobo)}. ` : ""}${review ? `${GUEST_FACT_LABELS.ifRequestAccepted}. ${GUEST_FACT_LABELS.amountDueNow}: ${formatNgnKobo(facts.amountDueNowKobo)}. ${GUEST_GLOSSARY.revalidation}. ` : "Review these details before you send the request. "}Cancellation terms: ${facts.cancellationPolicy.summary}.`;
  }

  #handleDraftReview(
    thread: GuestThreadState,
    event: GuestEventPayload,
  ): GuestTurnResult {
    if (
      !thread.draftId ||
      event.context?.artifactId !== requestDraftArtifactId(thread.draftId) ||
      event.context?.draftId !== thread.draftId
    ) {
      return {
        ok: false,
        code: "INVALID_CONTEXT",
        message: "That Request Draft is no longer valid.",
      };
    }
    if (
      !this.#environment.guestContactApp.get(this.#environment.guestPrincipal())
        ?.phoneNumber
    ) {
      // ADR-0085: collect a coordination contact only; Guest identity checks remain a check-in eligibility step.
      return this.#contactSurface(thread, "phone", {
        ...event.context,
        resumeAction: "review",
      });
    }
    const artifact = this.#draftArtifact(thread, "review");
    const surfaceId = `thread-${thread.threadId}:request:review:${thread.draftId}`;
    this.#supersede(thread, REQUEST_STAGE);
    thread.activeSurfaces.set(REQUEST_STAGE, surfaceId);
    this.#emitTransition(thread, "request_draft.review.opened", {
      aggregateType: "request_draft",
      aggregateId: thread.draftId,
      surfaceId,
    });
    return {
      ok: true,
      messages: ["Review the complete request terms."],
      surfaces: [
        {
          surfaceId,
          mode: "focused-surface",
          summary: "Request review",
          conventionalRoute: conventionalRequestDraftRoute(thread.draftId),
          textFallback: this.#draftFallback(artifact),
          a2uiMessages: requestDraftArtifactToA2UI({ artifact, surfaceId }),
        },
      ],
    };
  }

  #handleDraftSubmit(
    thread: GuestThreadState,
    event: GuestEventPayload,
  ): GuestTurnResult {
    if (
      !thread.draftId ||
      event.context?.artifactId !== requestDraftArtifactId(thread.draftId) ||
      event.context?.draftId !== thread.draftId
    ) {
      return {
        ok: false,
        code: "STALE_SURFACE",
        message: "That Request review is no longer current.",
      };
    }
    const currentTerms = this.#draftArtifact(thread, "review");
    if (
      !thread.draftQuote ||
      thread.draftQuote.allInStayTotalKobo !==
        currentTerms.facts.allInStayTotalKobo ||
      thread.draftQuote.refundableSecurityDepositKobo !==
        currentTerms.facts.refundableSecurityDepositKobo ||
      thread.draftQuote.amountDueNowKobo !== currentTerms.facts.amountDueNowKobo
    ) {
      return {
        ok: false,
        code: "QUOTE_CHANGED",
        message:
          "The price or deposit changed before submission. Review the updated material terms and submit again.",
      };
    }
    try {
      this.#emitTransition(thread, "booking_request.submission.attempted", {
        aggregateType: "request_draft",
        aggregateId: thread.draftId,
        surfaceId: event.surfaceId,
      });
      const disclosed = this.#environment.bookingRequestApp.disclose(
        thread.draftId,
        this.#environment.guestPrincipal(),
        this.#environment.config.autoDeliverRequests !== false,
      );
      thread.requestId = disclosed.requestId;
      this.#supersede(thread, REQUEST_STAGE);
      const surface = this.#requestSurface(thread, disclosed.requestId);
      thread.activeSurfaces.set(REQUEST_STAGE, surface.surfaceId);
      this.#emitTransition(thread, "booking_request.submitted", {
        aggregateType: "booking_request",
        aggregateId: disclosed.requestId,
        correlationId: thread.draftId,
        surfaceId: surface.surfaceId,
      });
      // ADR 0105: the staging demo accepts the submitted request through the operator command path, then the Guest sees the
      // Conditional Booking Offer the same way a confirmed request presents it (the refresh path issues or adopts it).
      if (this.#environment.config.demoRequestAcceptor?.delaySeconds === 0) {
        this.#environment.acceptDisclosedRequest(disclosed.requestId);
        const offered = this.#refreshWorkflow(thread);
        if (offered !== null) return offered;
      }
      // Issue 07: the Operator is named where known; the surface carries the reservation status.
      return {
        ok: true,
        messages: [
          `Next, ${guestOperatorName(currentTerms.facts.operatorName)} will confirm availability before payment is due.`,
        ],
        receipts: [GUEST_RECEIPTS.requestSent],
        surfaces: [surface],
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "The Booking Request could not be submitted.";
      if (/phone number is required/i.test(message))
        return this.#contactSurface(thread, "phone", event.context ?? {});
      this.#emitTransition(thread, "booking_request.delivery_failed", {
        aggregateType: "request_draft",
        aggregateId: thread.draftId,
        reasonCode: "REQUEST_DELIVERY_FAILED",
      });
      return { ok: false, code: "REQUEST_NOT_SUBMITTED", message };
    }
  }

  #contactSurface(
    thread: GuestThreadState,
    kind: "phone" | "email",
    resumeContext: JsonObject,
    input: { readonly value?: string; readonly error?: string } = {},
  ): GuestTurnResult {
    const stage = kind === "phone" ? REQUEST_STAGE : PAYMENT_STAGE;
    const surfaceId = `thread-${thread.threadId}:contact:${kind}:${crypto.randomUUID()}`;
    this.#supersede(thread, stage);
    thread.activeSurfaces.set(stage, surfaceId);
    const contact = this.#environment.guestContactApp.get(
      this.#environment.guestPrincipal(),
    );
    const baseLabel = kind === "phone" ? "Phone number" : "Email address";
    const saveLabel =
      kind === "phone" ? "Save phone number" : "Save email address";
    const eventName =
      kind === "phone" ? GUEST_PHONE_SUBMIT_EVENT : GUEST_EMAIL_SUBMIT_EVENT;
    const components: A2UIComponent[] = [
      {
        id: "root",
        component: "Column",
        children: [
          "contact-title",
          "contact-help",
          "contact-value",
          ...(input.error ? ["contact-error"] : []),
          "contact-save",
        ],
      },
      {
        id: "contact-title",
        component: "Text",
        text: baseLabel,
        variant: "h2",
      },
      {
        id: "contact-help",
        component: "Text",
        text:
          kind === "phone"
            ? "Required to send a Booking Request. Use a Nigerian mobile number in +234 format; for example +234 801 234 5678. Phone is for booking coordination, not identity verification."
            : "Required to start hosted card checkout and send a payment receipt. This email is not your account identity.",
      },
      {
        id: "contact-value",
        component: "TextField",
        label: baseLabel,
        value: { path: "/contactValue" },
        accessibility: { label: baseLabel },
      },
      ...(input.error
        ? [
            {
              id: "contact-error",
              component: "Text" as const,
              text: input.error,
            },
          ]
        : []),
      {
        id: "contact-save",
        component: "Button",
        child: "contact-save-label",
        variant: "primary",
        action: {
          event: {
            name: eventName,
            context: {
              ...resumeContext,
              contactValue: { path: "/contactValue" },
              expectedRevision: contact?.revision ?? 0,
            },
          },
        },
        accessibility: { label: saveLabel },
      },
      { id: "contact-save-label", component: "Text", text: saveLabel },
    ];
    const currentValue =
      input.value ??
      (kind === "phone" ? contact?.phoneNumber : contact?.contactEmail) ??
      "";
    const prompt = input.error
      ? "Please correct the field below."
      : kind === "phone"
        ? "Add a phone number to send your Booking Request."
        : "Add an email address to continue to payment.";
    return {
      ok: true,
      messages: [prompt],
      surfaces: [
        {
          surfaceId,
          mode: "focused-surface",
          summary: baseLabel,
          conventionalRoute: `/guest/contact?kind=${kind}`,
          conventionalRouteLabel:
            kind === "phone" ? "Edit phone number" : "Edit email address",
          textFallback: `${baseLabel} is required. ${kind === "phone" ? "Use a Nigerian mobile number, for example +234 801 234 5678." : "It is used for checkout and your receipt."} Open Contact details to save it.`,
          a2uiMessages: [
            {
              version: "v0.9.1",
              createSurface: {
                surfaceId,
                catalogId: A2UI_V091_BASIC_CATALOG_ID,
              },
            },
            {
              version: "v0.9.1",
              updateDataModel: {
                surfaceId,
                path: "/contactValue",
                value: currentValue,
              },
            },
            { version: "v0.9.1", updateComponents: { surfaceId, components } },
          ],
        },
      ],
    };
  }

  #handlePhoneSubmit(
    thread: GuestThreadState,
    event: GuestEventPayload,
  ): GuestTurnResult {
    const value = event.context?.contactValue;
    if (typeof value !== "string")
      return {
        ok: false,
        code: "INVALID_INPUT",
        message: "Phone number is required.",
      };
    try {
      this.#environment.guestContactApp.submitPhone(
        {
          phoneNumber: value,
          expectedRevision: Number(event.context?.expectedRevision ?? 0),
        },
        this.#environment.guestPrincipal(),
      );
    } catch (error) {
      const {
        contactValue: _contactValue,
        expectedRevision: _expectedRevision,
        ...resumeContext
      } = event.context ?? {};
      return this.#contactSurface(thread, "phone", resumeContext, {
        value,
        error:
          error instanceof Error
            ? error.message
            : "Phone number could not be saved.",
      });
    }
    const {
      contactValue: _contactValue,
      expectedRevision: _expectedRevision,
      resumeAction,
      ...resumeContext
    } = event.context ?? {};
    return resumeAction === "review"
      ? this.#handleDraftReview(thread, {
          ...event,
          name: REQUEST_DRAFT_REVIEW_EVENT,
          context: resumeContext,
        })
      : this.#handleDraftSubmit(thread, { ...event, context: resumeContext });
  }

  #handleEmailSubmit(
    thread: GuestThreadState,
    event: GuestEventPayload,
  ): GuestTurnResult {
    const value = event.context?.contactValue;
    if (typeof value !== "string")
      return {
        ok: false,
        code: "INVALID_INPUT",
        message: "Email address is required.",
      };
    try {
      this.#environment.guestContactApp.submitEmail(
        {
          contactEmail: value,
          expectedRevision: Number(event.context?.expectedRevision ?? 0),
        },
        this.#environment.guestPrincipal(),
      );
    } catch (error) {
      const {
        contactValue: _contactValue,
        expectedRevision: _expectedRevision,
        ...resumeContext
      } = event.context ?? {};
      return this.#contactSurface(thread, "email", resumeContext, {
        value,
        error:
          error instanceof GuestContactOwnedByAccountError
            ? GUEST_ACCOUNT_COPY.errors.emailOwnedByAccount
            : error instanceof Error
              ? error.message
              : "Email address could not be saved.",
      });
    }
    // Resume the server-issued payment action after the contact application
    // commits the email. The browser-provided contact value is not a payment
    // command and cannot alter the authoritative amount or currency.
    const {
      contactValue: _contactValue,
      expectedRevision: _expectedRevision,
      ...paymentContext
    } = event.context ?? {};
    return this.#handleCardCheckout(thread, {
      ...event,
      name: CARD_PAYMENT_INITIALIZE_CHECKOUT_EVENT,
      context: paymentContext,
    });
  }

  #requestSurface(
    thread: GuestThreadState,
    requestId: string,
  ): GuestSurfacePayload {
    const baseArtifact = this.#environment.bookingRequestApp.getArtifact(
      requestId,
      this.#environment.guestPrincipal(),
    );
    const unit = this.#environment.unitRepository.findById(
      baseArtifact.facts.unitId,
    );
    const artifact = unit
      ? {
          ...baseArtifact,
          facts: { ...baseArtifact.facts, unitTitle: unit.title },
        }
      : baseArtifact;
    const status = guestRequestStatus(
      artifact.facts.status,
      artifact.facts.delivered,
    );
    const surfaceId = `thread-${thread.threadId}:request:${requestId}`;
    return {
      surfaceId,
      mode: "focused-surface",
      summary: status.label,
      conventionalRoute: conventionalBookingRequestRoute(requestId),
      textFallback: `${status.label}. ${artifact.facts.unitTitle ?? `Your selected ${GUEST_GLOSSARY.unit}`}. Stay: ${formatStayDates(artifact.facts.checkIn, artifact.facts.checkOut)} (${artifact.facts.nights} nights). ${artifact.facts.quote ? `${GUEST_GLOSSARY.allInStayTotal}: ${formatNgnKobo(artifact.facts.quote.allInStayTotalKobo)}. ${artifact.facts.quote.refundableSecurityDepositKobo > 0 ? `${GUEST_GLOSSARY.refundableSecurityDeposit} (separate): ${formatNgnKobo(artifact.facts.quote.refundableSecurityDepositKobo)}. ` : ""}${GUEST_FACT_LABELS.ifRequestAccepted}. ${GUEST_FACT_LABELS.amountDueNow}: ${formatNgnKobo(artifact.facts.quote.totalAmountDueNowKobo)}. ` : ""}${artifact.facts.status === "disclosed" && artifact.facts.delivered ? `Operator response deadline: ${formatWAT(artifact.facts.operatorResponseDeadlineAt)}.` : ""} ${status.detail}`,
      a2uiMessages: bookingRequestArtifactToA2UI({ artifact, surfaceId }),
    };
  }

  #contractArtifact(contractId: string): BookingContractArtifact {
    const artifact = this.#environment.contractApp.getArtifact(
      contractId,
      this.#environment.guestPrincipal(),
    );
    const unit = this.#environment.unitRepository.findById(
      artifact.facts.unitId,
    );
    return unit
      ? { ...artifact, facts: { ...artifact.facts, unitTitle: unit.title } }
      : artifact;
  }

  #confirmedBookingFallback(artifact: BookingContractArtifact): string {
    const access =
      artifact.facts.accessAvailability === "available"
        ? "Access details are in secure booking details."
        : "Check-in details will be shared when they are ready. A confirmed booking does not itself grant physical access.";
    const depositCollected =
      artifact.facts.securityDeposit?.status === "held" &&
      (artifact.facts.refundableSecurityDepositKobo ?? 0) > 0;
    return `Booking confirmed for ${artifact.facts.unitTitle ?? "your stay"}. ${formatStayDates(artifact.facts.checkIn, artifact.facts.checkOut)} · ${artifact.facts.nights} ${artifact.facts.nights === 1 ? "night" : "nights"}; ${artifact.facts.occupants.length} ${artifact.facts.occupants.length === 1 ? "guest" : "guests"}. ${artifact.facts.amountPaidKobo ? `${GUEST_FACT_LABELS.amountPaid}: ${formatNgnKobo(artifact.facts.amountPaidKobo)}. ` : ""}${depositCollected ? `${GUEST_GLOSSARY.refundableSecurityDeposit} collected: ${formatNgnKobo(artifact.facts.refundableSecurityDepositKobo!)}. ` : ""}${access} Your booking reference and full contract are in booking details.`;
  }

  #offerFallback(artifact: ConditionalOfferArtifact): string {
    const status =
      artifact.facts.status === "issued"
        ? "Offer available · Operator confirmed availability"
        : artifact.facts.status === "accepted"
          ? "Offer accepted · Payment required"
          : artifact.facts.status === "expired"
            ? "Offer expired"
            : artifact.facts.status === "stale"
              ? "Offer no longer current"
              : "Offer withdrawn";
    return `${status}. ${artifact.facts.unitTitle}. ${formatStayDates(artifact.facts.checkIn, artifact.facts.checkOut)} · ${artifact.facts.nights} ${artifact.facts.nights === 1 ? "night" : "nights"}. ${GUEST_GLOSSARY.allInStayTotal}: ${formatNgnKobo(artifact.facts.allInStayTotalKobo)}. ${artifact.facts.refundableSecurityDepositKobo > 0 ? `${GUEST_GLOSSARY.refundableSecurityDeposit} (separate): ${formatNgnKobo(artifact.facts.refundableSecurityDepositKobo)}. ` : ""}${GUEST_FACT_LABELS.amountDueNow}: ${formatNgnKobo(artifact.facts.totalAmountDueNowKobo)}. ${formatBookingDeadline(artifact.facts.paymentWindowExpiresAt)}. ${guestReservationStatus(artifact.facts.status === "issued" ? "offer-issued" : artifact.facts.status === "accepted" ? "offer-accepted" : "offer-closed")}`;
  }

  #confirmedBookingSurface(
    thread: GuestThreadState,
  ): GuestSurfacePayload | null {
    if (!thread.offerId) return null;
    const snapshot =
      this.#environment.interactionStore.findBookingSnapshotByOfferId(
        thread.offerId,
      );
    if (!snapshot) return null;
    try {
      const contract = JSON.parse(snapshot.contractJson) as {
        readonly contractId: string;
      };
      const bookingSurfaceId = `thread-${thread.threadId}:booking:${contract.contractId}`;
      const contractArtifact = this.#contractArtifact(contract.contractId);
      this.#supersede(thread, PAYMENT_STAGE);
      thread.activeSurfaces.set(BOOKING_STAGE, bookingSurfaceId);
      return {
        surfaceId: bookingSurfaceId,
        mode: "focused-surface",
        summary: "Reservation confirmed",
        conventionalRoute: conventionalBookingContractRoute(
          contract.contractId,
        ),
        textFallback: this.#confirmedBookingFallback(contractArtifact),
        a2uiMessages: bookingContractArtifactToA2UI({
          artifact: contractArtifact,
          surfaceId: bookingSurfaceId,
        }),
      };
    } catch {
      return null;
    }
  }

  #refreshWorkflow(thread: GuestThreadState): GuestTurnResult | null {
    // ADR 0105: a demo delay is honoured lazily, here, once the delay has elapsed on the injected clock.
    if (thread.requestId && !thread.offerId) this.#environment.acceptDueDemoRequest(thread.requestId);
    const confirmedSurface = this.#confirmedBookingSurface(thread);
    if (confirmedSurface)
      return { ok: true, messages: [], surfaces: [confirmedSurface] };
    if (thread.offerId && thread.activeSurfaces.has(OFFER_STAGE)) {
      const offer = this.#environment.conditionalOfferApp.getArtifact(
        thread.offerId,
        this.#environment.guestPrincipal(),
      );
      if (offer.facts.status === "expired") {
        const surfaceId = `thread-${thread.threadId}:offer:${thread.offerId}`;
        thread.activeSurfaces.set(OFFER_STAGE, surfaceId);
        this.#emitTransition(thread, "conditional_booking_offer.expired", {
          aggregateType: "conditional_booking_offer",
          aggregateId: thread.offerId,
          reasonCode: "OFFER_EXPIRED",
          surfaceId,
        });
        return {
          ok: true,
          messages: [
            "The Conditional Booking Offer expired. Payment authority has been removed.",
          ],
          surfaces: [
            {
              surfaceId,
              mode: "focused-surface",
              summary: "Conditional Booking Offer expired",
              status: "expired",
              conventionalRoute: conventionalConditionalOfferRoute(
                thread.offerId,
              ),
              textFallback: this.#offerFallback(offer),
              a2uiMessages: conditionalOfferArtifactToA2UI({
                artifact: offer,
                surfaceId,
              }),
            },
          ],
        };
      }
    }
    if (thread.offerId && thread.activeSurfaces.has(PAYMENT_STAGE)) {
      const snapshot =
        this.#environment.interactionStore.findBookingSnapshotByOfferId(
          thread.offerId,
        );
      if (snapshot) {
        try {
          const contract = JSON.parse(snapshot.contractJson) as {
            readonly contractId: string;
          };
          const bookingSurfaceId = `thread-${thread.threadId}:booking:${contract.contractId}`;
          const contractArtifact = this.#contractArtifact(contract.contractId);
          this.#supersede(thread, PAYMENT_STAGE);
          thread.activeSurfaces.set(BOOKING_STAGE, bookingSurfaceId);
          return {
            ok: true,
            messages: [],
            surfaces: [
              {
                surfaceId: bookingSurfaceId,
                mode: "focused-surface",
                summary: "Reservation confirmed",
                conventionalRoute: conventionalBookingContractRoute(
                  contract.contractId,
                ),
                textFallback: this.#confirmedBookingFallback(contractArtifact),
                a2uiMessages: bookingContractArtifactToA2UI({
                  artifact: contractArtifact,
                  surfaceId: bookingSurfaceId,
                }),
              },
            ],
          };
        } catch {
          // Keep the payment surface until the durable Contract can be read.
        }
      }
      const payment = this.#environment.cardPaymentApp.getArtifact(
        thread.offerId,
        this.#environment.guestPrincipal(),
      );
      if (payment.facts.status === "expired") {
        const surfaceId = `thread-${thread.threadId}:payment:expired:${thread.offerId}`;
        this.#supersede(thread, PAYMENT_STAGE);
        thread.activeSurfaces.set(PAYMENT_STAGE, surfaceId);
        this.#emitTransition(thread, "payment.expired", {
          aggregateType: "payment_window",
          aggregateId: thread.offerId,
          reasonCode: "PAYMENT_EXPIRED",
          surfaceId,
        });
        return {
          ok: true,
          messages: [
            "The Payment Window expired. Payment authority has been removed; no Reservation exists.",
          ],
          surfaces: [
            {
              ...this.#paymentSurface(
                thread,
                payment,
                "Payment Window expired",
                surfaceId,
              ),
              status: "expired",
              textFallback: `Payment window expired. Total to complete booking: ${formatNgnKobo(payment.facts.amountDueNowKobo)}. No Reservation exists.`,
            },
          ],
        };
      }
    }
    if (!thread.requestId || thread.offerId) return null;
    const artifact = this.#environment.bookingRequestApp.getArtifact(
      thread.requestId,
      this.#environment.guestPrincipal(),
    );
    if (artifact.facts.status === "confirmed") {
      // ADR-0079: never issue a second Conditional Booking Offer for a request
      // that already has one. The refresh path adopts an existing durable
      // offer instead of repeating the issuance command.
      const durableOffer =
        this.#environment.interactionStore.findConditionalOfferByRequestId(
          thread.requestId,
        );
      let offerId = durableOffer?.offerId ?? null;
      if (offerId === null) {
        try {
          const offer = this.#environment.conditionalOfferApp.issue(
            thread.requestId,
            this.#environment.representativePrincipal(),
          );
          offerId = offer.offerId;
        } catch {
          offerId = null;
        }
      }
      if (offerId === null)
        return {
          ok: true,
          messages: [
            "The Operator confirmed availability, but the Conditional Booking Offer could not be prepared.",
          ],
          surfaces: [this.#requestSurface(thread, thread.requestId)],
        };
      thread.offerId = offerId;
      this.#supersede(thread, REQUEST_STAGE);
      const surfaceId = `thread-${thread.threadId}:offer:${offerId}`;
      thread.activeSurfaces.set(OFFER_STAGE, surfaceId);
      const offerArtifact = this.#environment.conditionalOfferApp.getArtifact(
        offerId,
        this.#environment.guestPrincipal(),
      );
      this.#emitTransition(thread, "booking_request.confirmed", {
        aggregateType: "booking_request",
        aggregateId: thread.requestId,
        nextState: "confirmed",
        correlationId: offerId,
      });
      this.#emitTransition(thread, "conditional_booking_offer.shown", {
        aggregateType: "conditional_booking_offer",
        aggregateId: offerId,
        correlationId: thread.requestId,
        surfaceId,
      });
      return {
        ok: true,
        messages: [
          "Operator confirmed availability. Review the Conditional Booking Offer; payment is still required.",
        ],
        surfaces: [
          {
            surfaceId,
            mode: "focused-surface",
            summary: "Conditional Booking Offer",
            conventionalRoute: conventionalConditionalOfferRoute(offerId),
            textFallback: this.#offerFallback(offerArtifact),
            a2uiMessages: conditionalOfferArtifactToA2UI({
              artifact: offerArtifact,
              surfaceId,
            }),
          },
        ],
      };
    }
    if (
      ["declined", "expired", "delivery_failed"].includes(artifact.facts.status)
    ) {
      this.#supersede(thread, REQUEST_STAGE);
      const type =
        artifact.facts.status === "declined"
          ? "booking_request.declined"
          : artifact.facts.status === "expired"
            ? "booking_request.timed_out"
            : "booking_request.delivery_failed";
      this.#emitTransition(thread, type, {
        aggregateType: "booking_request",
        aggregateId: thread.requestId,
        reasonCode:
          artifact.facts.status === "declined"
            ? "OPERATOR_DECLINED"
            : artifact.facts.status === "expired"
              ? "OPERATOR_TIMEOUT"
              : "REQUEST_DELIVERY_FAILED",
      });
      return {
        ok: true,
        messages: [
          artifact.facts.status === "declined"
            ? "The Operator declined the request. No payment was taken."
            : artifact.facts.status === "expired"
              ? "The Booking Request expired before the Operator responded."
              : "The Booking Request could not be delivered.",
        ],
        surfaces: [
          {
            ...this.#requestSurface(thread, thread.requestId),
            mode: "inline-surface",
            summary: "Request outcome",
            status: "active",
          },
        ],
      };
    }
    return {
      ok: true,
      messages: [],
      surfaces: [this.#requestSurface(thread, thread.requestId)],
    };
  }

  #handleOfferAccept(
    thread: GuestThreadState,
    event: GuestEventPayload,
  ): GuestTurnResult {
    if (!thread.offerId) {
      return {
        ok: false,
        code: "INVALID_ARTIFACT",
        message: "No offer is active for this conversation.",
      };
    }
    this.#emitTransition(
      thread,
      "conditional_booking_offer.acceptance_attempted",
      {
        aggregateType: "conditional_booking_offer",
        aggregateId: thread.offerId,
        surfaceId: event.surfaceId,
      },
    );
    const resolved = resolveConditionalOfferServerEvent({
      event: this.#handoff(event),
      application: this.#environment.conditionalOfferApp,
      principal: this.#environment.guestPrincipal(),
    });
    if (!resolved.ok) {
      this.#emitTransition(
        thread,
        "conditional_booking_offer.stale_action_rejected",
        {
          aggregateType: "conditional_booking_offer",
          aggregateId: thread.offerId,
          reasonCode: "STALE_ACTION",
          surfaceId: event.surfaceId,
        },
      );
      return { ok: false, code: resolved.code, message: resolved.message };
    }

    const offerId = thread.offerId;
    const paymentSurfaceId = `thread-${thread.threadId}:payment:ready:${offerId}`;
    this.#supersede(thread, OFFER_STAGE);
    thread.activeSurfaces.set(PAYMENT_STAGE, paymentSurfaceId);
    this.#emitTransition(thread, "conditional_booking_offer.accepted", {
      aggregateType: "conditional_booking_offer",
      aggregateId: offerId,
      nextState: "accepted",
      surfaceId: paymentSurfaceId,
    });

    const paymentArtifact = this.#environment.cardPaymentApp.getArtifact(
      offerId,
      this.#environment.guestPrincipal(),
    );
    return {
      ok: true,
      messages: ["Complete the secure card payment to confirm your booking."],
      receipts: [GUEST_RECEIPTS.offerAccepted],
      surfaces: [
        this.#paymentSurface(
          thread,
          paymentArtifact,
          "Payment required",
          paymentSurfaceId,
        ),
      ],
    };
  }

  #handleCardCheckout(
    thread: GuestThreadState,
    event: GuestEventPayload,
  ): GuestTurnResult {
    if (!thread.offerId) {
      return {
        ok: false,
        code: "INVALID_ARTIFACT",
        message: "No payment is active for this conversation.",
      };
    }
    const environment = this.#environment;
    // The contact application owns email validation and persistence. Present
    // its generated input surface before resolving the payment command so the
    // payment resolver never has to infer a missing contact from a swallowed
    // application error.
    if (
      !environment.guestContactApp.get(environment.guestPrincipal())
        ?.contactEmail
    ) {
      return this.#contactSurface(thread, "email", event.context ?? {});
    }
    const resolved = resolveCardPaymentServerEvent({
      event: this.#handoff(event),
      application: environment.cardPaymentApp,
      principal: environment.guestPrincipal(),
    });
    if (!resolved.ok) {
      if (/email address is required/i.test(resolved.message))
        return this.#contactSurface(thread, "email", event.context ?? {});
      return { ok: false, code: resolved.code, message: resolved.message };
    }

    const session = environment.cardPaymentApp.getCheckoutSession(
      thread.offerId,
    );
    if (!session) {
      return {
        ok: false,
        code: "INVALID_ARTIFACT",
        message: "No checkout session is active.",
      };
    }
    const artifact = environment.cardPaymentApp.getArtifact(
      thread.offerId,
      environment.guestPrincipal(),
    );
    const surfaceId = `thread-${thread.threadId}:payment:checkout:${session.checkoutId}`;
    this.#supersede(thread, PAYMENT_STAGE);
    thread.activeSurfaces.set(PAYMENT_STAGE, surfaceId);
    this.#emitTransition(thread, "payment.handoff.opened", {
      aggregateType: "payment",
      aggregateId: thread.offerId,
      surfaceId,
    });
    this.#emitTransition(thread, "payment.attempt.initialized", {
      aggregateType: "payment_attempt",
      aggregateId: session.checkoutId,
      correlationId: thread.offerId,
    });
    const checkoutAmount =
      artifact.facts.currentComponentAmountKobo ??
      (artifact.facts.currentComponent === "security_deposit"
        ? artifact.facts.refundableSecurityDepositKobo
        : artifact.facts.allInStayTotalKobo) ??
      artifact.facts.amountDueNowKobo;
    const checkoutPurpose =
      artifact.facts.currentComponent === "security_deposit"
        ? GUEST_GLOSSARY.refundableSecurityDeposit
        : "stay payment";
    return {
      ok: true,
      messages: [
        "Payment checkout is ready. Payment has not succeeded; your booking details remain available when you return.",
      ],
      surfaces: [
        {
          surfaceId,
          mode: "focused-surface",
          summary: "Payment handoff",
          conventionalRoute: conventionalCardPaymentRoute(thread.offerId),
          conventionalRouteLabel: `Continue to ${checkoutPurpose} · ${formatNgnKobo(checkoutAmount)}`,
          textFallback: `Payment handoff ready for ${artifact.facts.unit}, ${formatStayDates(artifact.facts.checkIn, artifact.facts.checkOut)}. ${artifact.facts.allInStayTotalKobo === undefined ? "" : `${GUEST_GLOSSARY.allInStayTotal}: ${formatNgnKobo(artifact.facts.allInStayTotalKobo)}. `}${artifact.facts.refundableSecurityDepositKobo ? `${GUEST_GLOSSARY.refundableSecurityDeposit} (separate): ${formatNgnKobo(artifact.facts.refundableSecurityDepositKobo)}. ` : ""}Next payment: ${formatNgnKobo(checkoutAmount)}. ${formatWAT(artifact.facts.paymentWindowExpiresAt)}. Payment has not succeeded and the booking is not confirmed. Your booking details will be retained when you return.`,
          a2uiMessages: cardPaymentArtifactToA2UI({ artifact, surfaceId }),
        },
      ],
    };
  }

  #handlePaymentReturn(
    thread: GuestThreadState,
    event: GuestEventPayload,
  ): GuestTurnResult {
    if (
      !thread.offerId ||
      event.context?.artifactId !== `card-payment:${thread.offerId}` ||
      event.context?.offerId !== thread.offerId
    )
      return {
        ok: false,
        code: "STALE_SURFACE",
        message: "That payment handoff is no longer current.",
      };
    const environment = this.#environment;
    const current = environment.cardPaymentApp.getArtifact(
      thread.offerId,
      environment.guestPrincipal(),
    );
    if (
      current.facts.status !== "checkout_initiated" ||
      event.context?.projectionVersion !== current.projectionVersion
    )
      return {
        ok: false,
        code: "STALE_SURFACE",
        message: "That payment handoff is no longer current.",
      };
    const session = environment.cardPaymentApp.getCheckoutSession(
      thread.offerId,
    );
    if (!session)
      return {
        ok: false,
        code: "INVALID_ARTIFACT",
        message: "No active payment attempt was found.",
      };
    this.#emitTransition(thread, "payment.return.received", {
      aggregateType: "payment",
      aggregateId: thread.offerId,
      surfaceId: event.surfaceId,
    });
    try {
      const outcome = environment.cardPaymentApp.verifyAndConfirm(
        session.pspReference,
        environment.systemPrincipal(),
      );
      if (outcome.outcome === "deposit_required") {
        const artifact = environment.cardPaymentApp.getArtifact(
          thread.offerId,
          environment.guestPrincipal(),
        );
        const surfaceId = `thread-${thread.threadId}:payment:deposit-ready:${thread.offerId}`;
        this.#supersede(thread, PAYMENT_STAGE);
        thread.activeSurfaces.set(PAYMENT_STAGE, surfaceId);
        this.#emitTransition(thread, "payment.verified", {
          aggregateType: "payment",
          aggregateId: thread.offerId,
          nextState: "deposit_required",
          surfaceId,
        });
        return {
          ok: true,
          messages: [
            `Payment verified for the stay. A separate ${GUEST_GLOSSARY.refundableSecurityDeposit} payment is required before a Reservation can exist.`,
          ],
          surfaces: [
            this.#paymentSurface(
              thread,
              artifact,
              `${GUEST_GLOSSARY.refundableSecurityDeposit} payment required`,
              surfaceId,
            ),
          ],
        };
      }
      const contractArtifact = this.#contractArtifact(
        outcome.bookingContract.contractId,
      );
      const bookingSurfaceId = `thread-${thread.threadId}:booking:${outcome.bookingContract.contractId}`;
      this.#supersede(thread, PAYMENT_STAGE);
      thread.activeSurfaces.set(BOOKING_STAGE, bookingSurfaceId);
      this.#emitTransition(thread, "payment.verified", {
        aggregateType: "payment",
        aggregateId: thread.offerId,
        nextState: "verified",
        surfaceId: bookingSurfaceId,
      });
      this.#emitTransition(thread, "reservation.confirmed", {
        aggregateType: "reservation",
        aggregateId: outcome.reservation.reservationId,
        correlationId: thread.offerId,
        nextState: "confirmed",
      });
      return {
        ok: true,
        messages: [],
        receipts: [GUEST_RECEIPTS.paymentVerified],
        surfaces: [
          {
            surfaceId: bookingSurfaceId,
            mode: "focused-surface",
            summary: "Reservation confirmed",
            conventionalRoute: conventionalBookingContractRoute(
              outcome.bookingContract.contractId,
            ),
            textFallback: this.#confirmedBookingFallback(contractArtifact),
            a2uiMessages: bookingContractArtifactToA2UI({
              artifact: contractArtifact,
              surfaceId: bookingSurfaceId,
            }),
          },
        ],
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Payment verification did not complete.";
      const artifact = environment.cardPaymentApp.getArtifact(
        thread.offerId,
        environment.guestPrincipal(),
      );
      const surfaceId = `thread-${thread.threadId}:payment:result:${Date.now()}`;
      this.#supersede(thread, PAYMENT_STAGE);
      thread.activeSurfaces.set(PAYMENT_STAGE, surfaceId);
      if (/processing|grace/i.test(message)) {
        this.#emitTransition(thread, "payment.processing", {
          aggregateType: "payment",
          aggregateId: thread.offerId,
          reasonCode: "PAYMENT_PROCESSING",
          surfaceId,
        });
        return {
          ok: true,
          messages: [
            "Payment is still processing. It has not succeeded and no Reservation exists yet.",
          ],
          surfaces: [
            this.#paymentSurface(
              thread,
              artifact,
              "Payment processing",
              surfaceId,
            ),
          ],
        };
      }
      if (/late|expired|deadline/i.test(message))
        this.#emitTransition(thread, "payment.late_payment.detected", {
          aggregateType: "payment",
          aggregateId: thread.offerId,
          reasonCode: /expired|deadline/i.test(message)
            ? "PAYMENT_EXPIRED"
            : "LATE_PAYMENT",
          surfaceId,
        });
      else
        this.#emitTransition(thread, "payment.failed", {
          aggregateType: "payment",
          aggregateId: thread.offerId,
          reasonCode: "PAYMENT_FAILED",
          surfaceId,
        });
      return {
        ok: true,
        messages: [
          `Payment was not verified. No Reservation was created. ${message}`,
        ],
        surfaces: [
          this.#paymentSurface(
            thread,
            artifact,
            "Payment verification result",
            surfaceId,
          ),
        ],
      };
    }
  }

  #paymentSurface(
    thread: GuestThreadState,
    artifact: ReturnType<CardPaymentApplication["getArtifact"]>,
    summary: string,
    surfaceId: string,
  ): GuestSurfacePayload {
    const processing =
      artifact.facts.journeyStage === "stay_payment_processing" ||
      artifact.facts.journeyStage === "deposit_payment_processing";
    const status = guestPaymentStatus(artifact.facts.status, processing);
    const currentAmount =
      artifact.facts.currentComponentAmountKobo ??
      (artifact.facts.status === "ready"
        ? artifact.facts.allInStayTotalKobo
        : undefined);
    const routeLabel = processing
      ? "Return to payment status"
      : artifact.facts.status === "ready"
        ? "Open payment details"
        : artifact.facts.status === "checkout_initiated"
          ? `Continue to ${artifact.facts.currentComponent === "security_deposit" ? GUEST_GLOSSARY.refundableSecurityDeposit : "stay payment"} · ${formatNgnKobo(currentAmount ?? artifact.facts.amountDueNowKobo)}`
          : artifact.facts.status === "deposit_required"
            ? `Continue to ${GUEST_GLOSSARY.refundableSecurityDeposit} · ${formatNgnKobo(currentAmount ?? artifact.facts.refundableSecurityDepositKobo ?? artifact.facts.amountDueNowKobo)}`
            : "View payment status";
    return {
      surfaceId,
      mode: "focused-surface",
      summary,
      conventionalRoute: conventionalCardPaymentRoute(thread.offerId!),
      conventionalRouteLabel: routeLabel,
      textFallback: `${status.label}. ${artifact.facts.unit}, ${formatStayDates(artifact.facts.checkIn, artifact.facts.checkOut)}. ${artifact.facts.allInStayTotalKobo === undefined ? "" : `${GUEST_GLOSSARY.allInStayTotal}: ${formatNgnKobo(artifact.facts.allInStayTotalKobo)}. `}${artifact.facts.refundableSecurityDepositKobo ? `${GUEST_GLOSSARY.refundableSecurityDeposit} (separate): ${formatNgnKobo(artifact.facts.refundableSecurityDepositKobo)}. ` : ""}${artifact.facts.status === "ready" || artifact.facts.status === "deposit_required" ? `${GUEST_FACT_LABELS.amountDueNow}: ${formatNgnKobo(artifact.facts.amountDueNowKobo)}. ` : ""}${currentAmount === undefined ? "" : `Current payment: ${formatNgnKobo(currentAmount)}. `}${formatWAT(artifact.facts.paymentWindowExpiresAt)}. ${status.detail}`,
      a2uiMessages: cardPaymentArtifactToA2UI({ artifact, surfaceId }),
    };
  }

  #partySizeFor(thread: GuestThreadState): number {
    const filters = thread.discoveryArtifact?.facts.filters;
    return typeof filters?.partySize === "number" &&
      Number.isInteger(filters.partySize) &&
      filters.partySize >= 1
      ? filters.partySize
      : 1;
  }

  #stayDatesFor(thread: GuestThreadState): {
    readonly checkIn: string;
    readonly checkOut: string;
  } {
    const filters = thread.discoveryArtifact?.facts.filters;
    if (
      typeof filters?.checkIn !== "string" ||
      typeof filters.checkOut !== "string"
    ) {
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
  if (payload === null || typeof payload !== "object" || Array.isArray(payload))
    return undefined;
  const record = payload as Record<string, unknown>;
  if (typeof record.name !== "string" || record.name.trim() === "")
    return undefined;
  if (typeof record.surfaceId !== "string" || record.surfaceId.trim() === "")
    return undefined;
  const context: JsonObject | null =
    record.context !== null &&
    typeof record.context === "object" &&
    !Array.isArray(record.context)
      ? (record.context as JsonObject)
      : null;
  return {
    name: record.name,
    surfaceId: record.surfaceId,
    sourceComponentId:
      typeof record.sourceComponentId === "string"
        ? record.sourceComponentId
        : "unknown",
    timestamp:
      typeof record.timestamp === "string"
        ? record.timestamp
        : new Date().toISOString(),
    context,
  };
}

/** The discovery surface for a stored artifact; restoring and going back present it identically. */
function discoverySurface(
  artifact: DiscoveryArtifactProjection,
  surfaceId: string,
  demo: boolean,
  compareSelection?: string,
): GuestSurfacePayload {
  return {
    surfaceId,
    mode: "inline-surface",
    summary: discoverySummary(artifact.facts.filters),
    // ADR-0080: the re-presented fallback keeps the same criteria as the live one.
    conventionalRoute: conventionalSearchRoute(artifact.facts.filters),
    textFallback: discoveryFallbackMessage(artifact),
    a2uiMessages: discoveryArtifactToA2UI({
      artifact,
      surfaceId,
      compareSelection,
      demo,
    }),
  };
}

export function discoverySummary(filters: unknown): string {
  if (filters === null || typeof filters !== "object" || Array.isArray(filters))
    return "Search results";
  const record = filters as Record<string, unknown>;
  const location =
    typeof record.location === "string" ? record.location.trim() : "";
  const neighbourhood =
    typeof record.neighbourhood === "string" ? record.neighbourhood.trim() : "";
  const partySize =
    typeof record.partySize === "number" &&
    Number.isSafeInteger(record.partySize) &&
    record.partySize > 0
      ? `${record.partySize} guests`
      : "";
  const place = [neighbourhood, location].filter(Boolean).join(", ");
  return ["Search updated", place, partySize].filter(Boolean).join(" · ");
}
