import { generatePlatformId } from "../../../packages/platform-core/src/index.js";
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
import { toDiscoveryProjection, StayDateRange, dateKeyInLagos, type ExtendedStayPolicy } from "../../../domains/shortlet/src/index.js";
import { billingPeriodStatusText, extendedStayUnitFacts } from "../../web-agent/src/extended-stay-presentation.js";
import { formatBookingMoney } from "../../web-agent/src/booking-presentation.js";
import { formatGuestDate } from "../../web-agent/src/guest-content.js";
import type { BillingPeriodProjection } from "../../../domains/shortlet/src/index.js";
import { createGuestShell, type RouteModule, type StaticAsset } from "./guest-shell.js";
import type { GuestCommerceModule, PaymentReferenceKeys } from "./commerce-port.js";
import { MAX_TURN_TEXT_LENGTH } from "./turn-limits.js";
import { createLandingRouteModule } from "./landing-route-module.js";
import { nodeLandingAssetLoader } from "./node-landing-assets.js";
import type { LandingBinaryAssetLoader } from "./landing-assets.js";
import { commerceEnabledFromEnv } from "../../../packages/commerce-switch/src/commerce-switch.js";
import { applySchemaMigrations } from "../../../packages/platform-core/src/schema-migrations.js";
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
  GUEST_CONTINUE_CONVERSATION,
  accommodationProviderLine,
  guestOperatorName,
  guestReservationStatus,
  guestAmenityLabel,
  discoveryFallbackMessage,
  type DiscoveryArtifactProjection,
} from "../../../apps/web-agent/src/index.js";
import { unitDetailArtifactFromProjection } from "../../../apps/web/src/unit-detail-artifact.js";
import { bannerWrapped } from "./html-banner.js";
import { demoListingChipHtml, withDemoBanner } from "./guest-kit.js";
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
  taskRailHtml,
  verticalStartersHtml,
  type TaskRailEntry,
  type VerticalStarter,
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
  DirectPaystackClient,
  PaystackPayments,
  PaystackProviderFailure,
  isApprovedPaystackCheckoutUrl,
  loadPaystackConfiguration,
  type PaystackClient,
  type PaystackProviderStatusClass,
  type Payments,
} from "../../../packages/platform-core/src/payments/index.js";
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
import { AssistantRuntime } from "./assistant/assistant-runtime.js";
import { createShortletAssistantPack } from "./assistant/shortlet-assistant-pack.js";
import type { AssistantDomainPack } from "./assistant/assistant-platform.js";
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
import type { AssistantDiagnosticEvent } from "./assistant/assistant-runtime.js";
import type { AssistantTurnRecord } from "./assistant/assistant-turn-record.js";
import { SqliteModelRequestQuota, type ModelRequestQuotaPort } from "../../../packages/platform-core/src/model-request-quota.js";
import { modelRequestQuotaLimitsFromEnvironment } from "../../../packages/platform-core/src/model-request-quota-config.js";
import { ModelQuotaGuardClient } from "./assistant/model-quota-guard.js";
import {
  ASSISTANT_CONFIRM_ACTION_EVENT,
  ASSISTANT_CANCEL_ACTION_EVENT,
} from "./assistant/pending-action-a2ui.js";
import {
  GUEST_ACCOUNT_COOKIE,
  GuestAccountRuntime,
  accountCredentialsOf,
  clientAddressOf,
  loadGuestAccountComposition,
  safeReturnPath,
  usableCodeHashingKey,
  SignInDeliveryError,
  type GuestAccountComposition,
  type GuestAccountCredentials,
} from "./guest-account-runtime.js";
import {
  GUEST_ACCOUNT_COPY,
  GUEST_TASK_RAIL,
  GUEST_VERTICALS,
} from "../../web-agent/src/guest-content.js";
import type {
  GuestContact,
  GuestContactSource,
} from "../../../domains/shortlet/src/index.js";
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

export * from "./shortlet-app.js";
import type { CardCheckoutFailedEvent } from "./shortlet-app.js";
import {
  committedWorkScope,
  ConventionalBookingPage,
  ConventionalBookingPageKind,
  discoverySummary,
  GuestCommittedWork,
  GuestSurfacePayload,
  GuestStayTicketFacts,
  GuestTimelineEntry,
  GuestTurnResult,
  GuestWaitingState,
  LocalGuestApp,
  THREAD_ID_PATTERN,
} from "./shortlet-app.js";

export function renderGuestShellHtml(): string {
  return `<!DOCTYPE html>
<html lang="en-NG" data-theme="system">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Shortlet Concierge</title>
  <link rel="stylesheet" href="/shortlet-foundations.css">
  <style>
    * { box-sizing: border-box; }
    html { background: var(--color-canvas); }
    body { background: var(--color-canvas); color: var(--color-text); font-family: var(--font-sans); margin: 0; line-height: 1.5; }
    button, input { font: inherit; }
    button, a { -webkit-tap-highlight-color: transparent; }
    :focus-visible { outline: 3px solid var(--color-focus); outline-offset: 2px; }
    .skip-link { position: absolute; left: var(--space-2); top: -100px; z-index: var(--layer-skip-link); background: var(--color-surface); color: var(--color-text); padding: var(--space-2) var(--space-3); border: 2px solid var(--color-focus); border-radius: var(--radius-control); }
    .skip-link:focus { top: var(--space-2); }
    .app { width: 100%; max-width: var(--layout-conversation-max); height: 100dvh; height: 100svh; min-height: 0; margin: 0 auto; display: flex; flex-direction: column; }
    .app .ui-appbar { padding-block-start: max(var(--space-2), env(safe-area-inset-top)); }
    .header-identity h1 { margin: 0; font: inherit; }
    .header-identity { display: flex; align-items: center; min-height: var(--control-min-target); }
    .header-note { color: var(--color-text-muted); font-size: var(--font-size-small); white-space: nowrap; }
    /* Issue 13a: the header controls wrap rather than scroll at 320px (ADR-0078). */
    .header-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-2); min-width: 0; }
    /* The visible label shortens on phones; the accessible name stays "New conversation" (WCAG 2.5.3). */
    @media (max-width: 29.999rem) {
      .header-long { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    }
    #new-conversation-confirm { display: grid; gap: var(--space-3); padding: var(--space-3) var(--layout-gutter-mobile); border-bottom: 1px solid var(--color-border); background: var(--color-surface); }
    #new-conversation-confirm[hidden] { display: none; }
    #new-conversation-confirm h2 { margin: 0; font-size: var(--font-size-h3, 1.125rem); }
    .new-conversation-items p { margin: 0 0 var(--space-2); }
    .new-conversation-actions, .committed-work { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; }
    .committed-work { margin: 0 0 var(--space-3); color: var(--color-text-secondary); font-size: var(--font-size-small); }
    .committed-work p { margin: 0; }
    /* Issue 08: the journey rail is the shared .ui-rail; the shell only hides it until there is a journey to show. */
    #journey-rail[hidden] { display: none; }
    /* Slice 26: the task rail, starters and step header are shell chrome; they stay hidden until a multi-domain runtime populates them. */
    #task-rail[hidden], #task-step-header[hidden], #vertical-starters[hidden] { display: none; }
    #task-step-header { position: sticky; top: 0; z-index: 2; }
    #vertical-starters { margin-block-end: var(--space-4); }
    main { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    /* ADR-0078: keep the conversation independently scrollable at the 320px launch viewport. */
    #transcript { flex: 1 1 0; min-height: 22dvh; padding: var(--space-6) var(--layout-gutter-mobile) var(--space-4); display: flex; flex-direction: column; gap: var(--space-3); overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; }
    .conversation-heading { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    .turn { display: flex; flex-direction: column; gap: var(--space-1); }
    .turn.user { align-items: flex-end; }
    .bubble { max-width: min(88%, 70ch); padding: var(--space-2) var(--space-3); border-radius: var(--radius-card); font-size: var(--font-size-body); line-height: var(--font-line-body); white-space: pre-wrap; overflow-wrap: anywhere; }
    .turn.assistant .bubble { max-width: min(90%, 72ch); background: var(--color-surface); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-small) calc(var(--radius-workspace) + 0.125rem) calc(var(--radius-workspace) + 0.125rem) calc(var(--radius-workspace) + 0.125rem); color: var(--color-text); }
    .turn.user .bubble { background: var(--color-action); color: var(--color-on-action); border-radius: calc(var(--radius-workspace) + 0.125rem) calc(var(--radius-workspace) + 0.125rem) var(--radius-small) calc(var(--radius-workspace) + 0.125rem); }
    .retry-action { align-self: flex-start; min-height: 44px; }
    .historical-summary { width: 100%; display: flex; align-items: center; gap: var(--space-2); color: var(--color-text-secondary); font-size: var(--font-size-small); line-height: var(--font-line-small); padding: var(--space-2) 0; border-top: 1px solid var(--color-border); }
    #empty-state { max-width: 70ch; padding-block: var(--space-3) var(--space-6); }
    #empty-state h2 { margin: 0 0 var(--space-2); font-family: var(--font-display); font-size: var(--font-size-h1); line-height: var(--font-line-h1); font-weight: 600; }
    #empty-state p { max-width: 64ch; margin: 0; color: var(--color-text-secondary); }
    .prompt-suggestions { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-3); }
    .quick-replies { display: flex; flex-wrap: wrap; gap: var(--space-2); }
    .quick-reply { min-width: var(--control-min-target); justify-content: center; }
    #workspace-region { min-height: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; padding: 0 var(--layout-gutter-mobile) var(--space-4); }
    #active-workspace { background: var(--color-surface-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-workspace); padding: var(--space-4); box-shadow: var(--elevation-active); }
    #active-workspace[hidden], #workspace-region[hidden], #workspace-reopen[hidden], #empty-state[hidden] { display: none; }
    .workspace-heading { display: flex; justify-content: flex-start; align-items: flex-start; gap: var(--space-3); margin-bottom: var(--space-2); }
    .workspace-heading--inline-surface { margin-bottom: 0; }
    .workspace-heading-text { min-width: 0; display: grid; gap: var(--space-1); }
    .workspace-title { margin: 0; font-size: var(--font-size-h3); line-height: var(--font-line-h3); font-weight: 650; overflow-wrap: anywhere; }
    .eyebrow { color: var(--color-action); font-size: var(--font-size-metadata); font-weight: 650; }
    .workspace-close, #workspace-reopen, .contact-link { display: inline-flex; min-height: var(--control-min-target); align-items: center; justify-content: center; padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-control); color: var(--color-text); background: var(--color-surface); text-decoration: none; cursor: pointer; }
    .contact-link { color: var(--color-text-secondary); font-size: var(--font-size-small); }
    .workspace-close:hover, #workspace-reopen:hover, .contact-link:hover { border-color: var(--color-action); }
    .workspace-status { margin: 0 0 var(--space-3); color: var(--color-text-secondary); font-size: var(--font-size-small); }
    .workspace-status[data-status="stale"], .workspace-status[data-status="expired"], .workspace-status[data-status="deleted"], .workspace-status[data-status="fallback"] { padding: var(--space-2) var(--space-3); border-inline-start: 3px dashed var(--color-warning); background: var(--color-warning-surface); color: var(--color-warning); }
    .weaver-mount { min-width: 0; max-width: 100%; overflow: visible; }
    .workspace-arrival { animation: workspace-enter var(--duration-base) var(--ease-enter) both; }
    @keyframes workspace-enter { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
    .weaver-mount h1[data-a2ui-component="Text"] { font-family: var(--font-heading); font-size: var(--font-size-display) !important; line-height: var(--font-line-display) !important; font-weight: 700 !important; margin: 0 !important; }
    .weaver-mount h2[data-a2ui-component="Text"] { font-family: var(--font-heading); font-size: var(--font-size-h2) !important; line-height: var(--font-line-h2) !important; font-weight: 650 !important; margin: 0 !important; }
    .weaver-mount h3[data-a2ui-component="Text"] { font-family: var(--font-heading); font-size: var(--font-size-h3) !important; line-height: var(--font-line-h3) !important; font-weight: 650 !important; margin: 0 !important; }
    .weaver-mount img { display: block; width: 100%; max-width: 100%; height: auto; min-height: 120px; aspect-ratio: 4 / 3; object-fit: cover; border-radius: var(--radius-card); background: var(--color-surface-subtle); }
    .photo-fallback { width: 100%; min-width: 0; min-height: 120px; aspect-ratio: 4 / 3; display: grid; place-items: center; padding: var(--space-4); border: 1px solid var(--color-border); border-radius: var(--radius-card); background: var(--color-surface-subtle); color: var(--color-text-secondary); text-align: center; }
    .weaver-mount small[data-a2ui-component="Text"] { margin: 0 !important; color: var(--color-text-secondary); font-size: var(--font-size-small) !important; font-style: normal !important; line-height: var(--font-line-small); }
    .weaver-mount p[data-a2ui-component="Text"] { margin: 0 !important; }
    /* With the Text margins reset, a Column's children need the gap to keep lines and cards apart. */
    .weaver-mount [data-a2ui-component="Column"] { gap: var(--space-2); }
    .weaver-mount button[data-a2ui-variant="primary"] { min-width: var(--control-min-target); min-height: var(--control-min-target); font: 600 var(--font-size-label)/var(--font-line-label) var(--font-sans); }
    .weaver-mount button[data-a2ui-variant="primary"]:hover { --a2ui-color-primary: var(--color-action-hover); }
    .weaver-mount button[data-a2ui-variant="primary"]:active { --a2ui-color-primary: var(--color-action-pressed); }
    .weaver-mount button[data-loading="true"] { display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2); cursor: progress; }
    .weaver-mount button[data-loading="true"]::before { content: ""; inline-size: 1em; block-size: 1em; flex: none; border: 2px solid currentColor; border-inline-end-color: transparent; border-radius: var(--radius-pill); animation: ui-spin 700ms linear infinite; }
    .weaver-mount button.guest-action:not([data-a2ui-variant="primary"]) { min-width: var(--control-min-target); min-height: var(--control-min-target); padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-control); background: var(--color-surface); color: var(--color-text); font: 600 var(--font-size-label)/var(--font-line-label) var(--font-sans); cursor: pointer; }
    .weaver-mount button.guest-action:not([data-a2ui-variant="primary"]):hover { border-color: var(--color-action); background: var(--color-surface-subtle); }
    .weaver-mount .guest-field { width: 100%; min-width: 0; min-height: var(--control-min-field); padding: var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-control); background: var(--color-surface); color: var(--color-text); font-size: 1rem; }
    .guest-status { display: block; max-width: 70ch; margin: var(--space-2) 0 !important; padding: var(--space-2) var(--space-3); border: 1px solid currentColor; border-inline-start-width: 4px; border-radius: var(--radius-control); color: var(--color-info); background: var(--color-info-surface); font-weight: 600; }
    .guest-status--success { color: var(--color-success); background: var(--color-success-surface); }
    .guest-status--warning { color: var(--color-warning); background: var(--color-warning-surface); }
    .guest-status--danger { color: var(--color-danger); background: var(--color-danger-surface); }
    .empty-state-title { margin-block: var(--space-2); }
    .stay-grid { display: grid !important; grid-template-columns: minmax(0, 1fr); gap: var(--space-4) !important; min-width: 0; }
    .stay-card { min-width: 0; margin: 0 !important; }
    .stay-card > * { min-width: 0; }
    .stay-card__fit { color: var(--color-success); font-weight: 600; }
    .stay-card__compare { justify-self: start; }
    /* Issue 05: phones show the compact rows for the inline results; the cards open with "See all results". Wide screens show two cards per row. */
    .ui-result-rows { margin-block-end: var(--space-3); }
    #active-workspace[data-mode="focused-surface"] .ui-result-rows, #active-workspace[data-mode="focused-surface"] .ui-result-rows__compare { display: none; }
    @media (max-width: 47.999rem) { #active-workspace[data-surface-kind="discovery"][data-mode="inline-surface"] .ui-result-rows ~ .stay-grid { display: none !important; } }
    @media (min-width: 48rem) { .ui-result-rows, .ui-result-rows__compare { display: none; } #active-workspace[data-surface-kind="discovery"] .stay-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    .unit-detail-root { display: grid !important; min-width: 0; gap: var(--space-4) !important; }
    ${LISTING_GALLERY_STYLE}
    .unit-gallery--fallback { padding: var(--space-4); border: 1px solid var(--color-border); border-radius: var(--radius-card); background: var(--color-surface-subtle); }
    .unit-photo-missing { display: grid; min-height: 10rem; place-items: center; margin: 0; color: var(--color-text-secondary); text-align: center; }
    .unit-detail-sheet { position: relative; z-index: 1; display: grid; min-width: 0; gap: var(--space-4); margin-block-start: calc(-1 * var(--space-6)); padding: var(--space-5); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sheet) var(--radius-sheet) var(--radius-card) var(--radius-card); background: var(--color-surface); box-shadow: var(--elevation-active); }
    .unit-detail-sheet > * { margin: 0 !important; }
    .unit-detail-sheet > h2[data-a2ui-component="Text"] { font-family: var(--font-display); font-size: var(--font-size-h1) !important; line-height: var(--font-line-h1) !important; font-weight: 600 !important; overflow-wrap: anywhere; }
    .unit-detail-sheet > h2:not([data-a2ui-component]) { font-family: var(--font-heading); font-size: var(--font-size-h2) !important; line-height: var(--font-line-h2) !important; font-weight: 650 !important; }
    .unit-detail-location { display: flex; align-items: center; gap: var(--space-1); color: var(--color-text-secondary); font-size: var(--font-size-small) !important; }
    .unit-detail-description { white-space: pre-line; max-width: 70ch; }
    .unit-amenities, .unit-supporting-info { display: grid; min-width: 0; gap: var(--space-2); padding-top: var(--space-3); border-top: 1px solid var(--color-border); }
    .unit-amenities > :first-child { margin: 0 !important; font-size: var(--font-size-h3) !important; line-height: var(--font-line-h3) !important; }
    .unit-amenities [data-a2ui-component="Column"] { display: flex !important; flex-wrap: wrap !important; gap: var(--space-2) !important; }
    .unit-amenities [data-a2ui-component="Column"] > * { max-width: 100%; margin: 0 !important; padding: var(--space-1) var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius-small); background: var(--color-surface); overflow-wrap: anywhere; }
    .unit-supporting-info { color: var(--color-text-secondary); }
    .unit-supporting-info > * { margin: 0 !important; }
    .unit-actions { display: flex; min-width: 0; flex-wrap: wrap; gap: var(--space-2); }
    .unit-action-bar { margin-inline: calc(-1 * var(--space-4)); padding-inline: var(--space-4); }
    .unit-action-bar > p { margin: 0; }
    .unit-action-bar .unit-actions { flex: 1 1 12rem; }
    .unit-action-bar .unit-actions button { width: 100%; }
    .unit-actions button { flex: 1 1 14rem; }
    .surface-fallback { border-inline-start: 4px solid var(--color-warning); padding: var(--space-1) 0 var(--space-1) var(--space-3); }
    .surface-fallback p { margin: 0 0 var(--space-2); }
    .fallback-link { display: inline-flex; align-items: center; min-height: var(--control-min-target); color: var(--color-action); font-weight: 650; }
    .guest-field-error { margin: var(--space-2) 0 !important; color: var(--color-danger); }
    #workspace-reopen { margin: 0 var(--layout-gutter-mobile) var(--space-4); width: calc(100% - 2 * var(--layout-gutter-mobile)); justify-content: flex-start; text-align: start; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
    /* Issue 03a: the criteria strip sits above the composer; chips wrap, never scroll the page (ADR-0078). */
    #criteria-strip { display: grid; gap: var(--space-2); padding: var(--space-2) var(--layout-gutter-mobile) 0; border-top: 1px solid var(--color-border); background: var(--color-surface); }
    #criteria-strip[hidden], #criteria-editor[hidden] { display: none; }
    .criteria-chips { display: flex; flex-wrap: wrap; gap: var(--space-2); min-width: 0; }
    .criteria-chip { position: relative; min-height: var(--control-min-target); min-width: var(--control-min-target); justify-content: center; max-width: 100%; overflow-wrap: anywhere; text-align: start; border-radius: var(--radius-pill); }
    /* Narrow screens keep the field names for screen readers only, so the strip stays short. */
    @media (max-width: 29.999rem) { .criteria-chip { padding-inline: var(--space-2); font-size: var(--font-size-small); } .criteria-chip .criteria-chip-name { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; } }
    .criteria-chip .criteria-chip-name { color: var(--color-text-secondary); font-weight: 400; }
    .criteria-chip[aria-expanded="true"] { border-color: var(--color-action); }
    .criteria-undo { min-height: var(--control-min-target); padding-inline: var(--space-2); border: 0; background: none; color: var(--color-action); font-weight: 650; text-decoration: underline; cursor: pointer; }
    #criteria-editor { display: grid; gap: var(--space-2); padding: var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-card); background: var(--color-surface-elevated); }
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
    form#composer { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: var(--space-2); padding: var(--space-2) var(--layout-gutter-mobile) max(var(--space-4), env(safe-area-inset-bottom)); border-top: 1px solid var(--color-border); background: var(--color-surface); position: sticky; bottom: 0; z-index: 10; }
    #composer-label { grid-column: 1 / -1; color: var(--color-text-secondary); font-size: var(--font-size-small); line-height: var(--font-line-small); font-weight: 600; }
    #composer-input { min-width: 0; width: 100%; min-height: var(--control-min-field); padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-pill); font-size: 1rem; background: var(--color-canvas); color: var(--color-text); }
    #composer-submit { inline-size: 3rem; min-inline-size: 3rem; min-height: 3rem; padding: 0; border-radius: var(--radius-pill); }
    form#composer[data-focused="true"] { gap: var(--space-1) var(--space-2); padding-block: var(--space-1) max(var(--space-2), env(safe-area-inset-bottom)); background: var(--color-canvas); }
    form#composer[data-focused="true"] #composer-label { font-weight: 400; }
    form#composer[data-focused="true"] #composer-input { min-height: 2.75rem; background: var(--color-surface); }
    form#composer[data-focused="true"] #composer-submit { min-height: 2.75rem; }
    #composer-submit:disabled { background: var(--color-surface-subtle); cursor: progress; }
    #working-status { grid-column: 1 / -1; margin: 0; color: var(--color-text-secondary); font-size: var(--font-size-small); }
    @media (min-width: 48rem) {
      #transcript, #workspace-region, form#composer, #criteria-strip { padding-left: var(--layout-gutter-tablet); padding-right: var(--layout-gutter-tablet); }
    }
    @media (min-width: 64rem) { .app { max-width: var(--layout-conversation-max); } #transcript, #workspace-region, form#composer, #criteria-strip { padding-left: var(--layout-gutter-desktop); padding-right: var(--layout-gutter-desktop); } }
    @media (max-width: 47.999rem) { .header-note { display: none; } #active-workspace[data-mode="focused-surface"] { scroll-margin-block: var(--space-3); } }
    /*
     * Issue 09 AC1: at 64rem and wider, an open workspace takes the second
     * column beside the transcript, starting at the top (no dead space). The
     * strip and composer stay under the transcript so chat remains live.
     */
    @media (min-width: 64rem) {
      /* Issue 11: the app bar and rail span the full width; a 460px conversation sits beside a left-aligned reading column (560px, 760px for discovery). */
      .app:has(#active-workspace:not([hidden])) { max-width: none; }
      .app:has(#active-workspace:not([hidden])) .ui-appbar, .app:has(#active-workspace:not([hidden])) .ui-rail { padding-inline: var(--layout-gutter-desktop); }
      main:has(#active-workspace:not([hidden])) {
        display: grid;
        grid-template-columns: minmax(22rem, 28.75rem) minmax(0, 1fr);
        grid-template-rows: minmax(0, 1fr) auto auto auto;
        grid-template-areas: "transcript workspace" "reopen workspace" "strip workspace" "composer workspace";
      }
      main:has(#active-workspace:not([hidden])) > #transcript { grid-area: transcript; }
      main:has(#active-workspace:not([hidden])) > #workspace-reopen { grid-area: reopen; }
      main:has(#active-workspace:not([hidden])) > #criteria-strip { grid-area: strip; }
      main:has(#active-workspace:not([hidden])) > form#composer { grid-area: composer; }
      main:has(#active-workspace:not([hidden])) > #workspace-region { grid-area: workspace; min-height: 0; padding: var(--space-6) var(--space-10); border-inline-start: 1px solid var(--color-border); }
      main:has(#active-workspace:not([hidden])) #active-workspace { max-inline-size: 35rem; }
      main:has(#active-workspace:not([hidden])) #active-workspace[data-surface-kind="discovery"] { max-inline-size: 47.5rem; }
    }
    /*
     * Issue 09 AC2: below 64rem a focused workspace is a full-screen sheet
     * above the conversation. It stops at the composer, which stays usable
     * (AC3); header Back and browser Back both close it.
     */
    @media (max-width: 63.999rem) {
      #workspace-region:has(> #active-workspace[data-mode="focused-surface"][data-status="active"]:not([hidden])) {
        position: fixed; inset: 0 0 var(--composer-block-size, 0px) 0; z-index: var(--layer-sticky); padding: max(var(--space-3), env(safe-area-inset-top)) var(--layout-gutter-mobile) var(--space-4); background: var(--color-canvas);
      }
      #workspace-region:has(> #active-workspace[data-mode="focused-surface"][data-status="active"]:not([hidden])) .workspace-heading--focused-surface { position: sticky; top: calc(-1 * var(--space-3)); z-index: 1; margin-inline: calc(-1 * var(--space-4)); padding: var(--space-2) var(--space-4); background: var(--color-surface-elevated); }
      form#composer { z-index: calc(var(--layer-sticky) + 1); }
    }
    @media (max-height: 520px) { .ui-appbar { position: static; } #transcript { min-height: 0; } form#composer { position: sticky; } }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; } }
  </style>
</head>
<body>
  <a class="skip-link" href="#main-content">Skip to conversation</a>
  <div class="app guest-editorial">
    <header class="ui-appbar">
      <a class="header-identity ui-appbar__brand" href="/" aria-label="Shortlet home"><h1>Shortlet</h1></a>
      <span class="header-note">Abuja · Lagos</span>
      <span class="ui-appbar__grow"></span>
      <div class="header-actions">
        <button id="new-conversation" class="ui-button ui-button--small ui-appbar__action" type="button">${icon("message-plus")}<span>New<span class="header-long"> conversation</span></span></button>
        <a class="ui-button ui-button--small ui-appbar__action" href="/guest/contact">Contact details</a>
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
    <nav id="journey-rail" class="ui-rail-nav" aria-label="${GUEST_JOURNEY.railLabel}" hidden><ol class="ui-rail"></ol></nav>
    <nav id="task-rail" class="ui-task-rail-nav" aria-label="${GUEST_TASK_RAIL.railLabel}" hidden><ol class="ui-task-rail"></ol></nav>
    <main id="main-content" tabindex="-1">
      <section id="transcript" role="log" aria-live="polite" aria-relevant="additions" aria-labelledby="conversation-heading">
        <h2 id="conversation-heading" class="conversation-heading">Conversation</h2>
        <header id="task-step-header" class="ui-step-header" hidden></header>
        <section id="vertical-starters" class="ui-vertical-starters" hidden></section>
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
        <button id="composer-submit" class="ui-button ui-button--primary" type="submit" aria-label="Send">${icon("arrow-up")}</button>
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

/**
 * Issue 19: request bodies are read with a ceiling so one request cannot hold unbounded memory. A chat turn is at
 * most MAX_TURN_TEXT_LENGTH characters and an A2UI event a small context object, so 64 KiB leaves wide headroom;
 * Paystack webhook and callback bodies are small signed JSON or form payloads.
 */
export const JSON_BODY_LIMIT_BYTES = 64 * 1024;
export const PROVIDER_BODY_LIMIT_BYTES = 256 * 1024;

async function readJsonBody(req: HttpRequestLike): Promise<unknown> {
  const raw = (await readBoundedBody(req, JSON_BODY_LIMIT_BYTES)).toString(
    "utf8",
  );
  try {
    return raw === "" ? {} : JSON.parse(raw);
  } catch (error) {
    throw error instanceof Error ? error : new Error("Invalid JSON body");
  }
}

/**
 * Demo-launch issue 12 AC4 (ADR 0092): the Guest's Billing Period schedule. Each period shows its dates, amount, due date and
 * status; only the period that is payable now has a payment button, and each payment is a separate Paystack TEST session.
 */
function renderPeriodScheduleHtml(offerId: string, periods: readonly BillingPeriodProjection[]): string {
  const rows = periods.map((period) => {
    const label = `${GUEST_FACT_LABELS.billingPeriod} ${period.periodIndex}`;
    const action = period.status === "payable" && !period.live
      ? `<form method="post" action="/payments/periods/${encodeURIComponent(offerId)}/${period.periodIndex}"><button class="ui-button ui-button--primary ui-button--block" type="submit">Pay ${escapeHtml(label)}</button></form>`
      : "";
    return `<li class="ui-panel" data-period="${period.periodIndex}" data-status="${escapeHtml(period.status)}"><h2>${escapeHtml(label)}</h2><p>${escapeHtml(formatGuestDate(period.checkIn) ?? period.checkIn)} to ${escapeHtml(formatGuestDate(period.checkOut) ?? period.checkOut)} (${period.nights} nights)</p><p>${escapeHtml(formatBookingMoney(period.amountKobo))} · due ${escapeHtml(formatGuestDate(period.dueDate) ?? period.dueDate)}</p><p class="ui-money-metadata">${escapeHtml(billingPeriodStatusText(period))}</p>${action}</li>`;
  }).join("");
  return pageShell({
    title: GUEST_FACT_LABELS.paymentSchedule,
    frame: appFrameHtml({ threadId: null, publicStep: "stay" }),
    style: "",
    body: `<div class="guest-editorial"><section aria-label="${escapeHtml(GUEST_FACT_LABELS.paymentSchedule)}"><h1>${escapeHtml(GUEST_FACT_LABELS.paymentSchedule)}</h1><p>${escapeHtml(GUEST_FACT_LABELS.firstPeriodOnly)}</p><ol>${rows}</ol></section></div>`,
  });
}

// Demo-launch issue 12: the standalone page derives the Extended Stay monthly facts from the same domain projection as chat.
// The page has no dates, so it quotes the first 30 nights from tomorrow (Lagos), the first Billing Period. No policy means
// production, where no Extended Stay result exists, so nothing is shown (ADR 0092, ADR 0105).
function extendedStayPageFacts(unit: Unit, options: { readonly policy: ExtendedStayPolicy; readonly now: Date } | undefined): readonly string[] {
  if (options === undefined) return [];
  const today = dateKeyInLagos(options.now, "now");
  const checkIn = new Date(`${today}T00:00:00.000Z`);
  checkIn.setUTCDate(checkIn.getUTCDate() + 1);
  const checkInKey = checkIn.toISOString().slice(0, 10);
  const checkOut = new Date(checkIn.getTime() + options.policy.billingPeriodNights * 86_400_000).toISOString().slice(0, 10);
  const projection = toDiscoveryProjection(unit, new StayDateRange(checkInKey, checkOut, options.now, options.policy), options.policy, options.now);
  return extendedStayUnitFacts(projection.extendedStay);
}

export function renderConventionalUnitDetailHtml(
  unit: Unit,
  photoUrl?: (url: string) => string,
  demo = false,
  extendedStay?: { readonly policy: ExtendedStayPolicy; readonly now: Date },
): string {
  const photos = normalizePhotoUrls(unit.photoUrls);
  // Guest gallery issue 01: the shared gallery. Every photo shows and links to its full image without JavaScript
  // (ADR 0080); /gallery.js adds the strip count, "Show all" and the full-screen viewer.
  const photoMarkup =
    photos.length === 0
      ? `<p class="ui-image-frame" role="status">Photos are not available for this ${GUEST_GLOSSARY.unit} yet.</p>`
      : `${listingGalleryHtml({ title: unit.title, photos: photos.map((url, index) => ({ src: photoUrl ? photoUrl(url) : url, alt: `Photo ${index + 1} of ${unit.title}` })) })}<script src="/gallery.js" defer></script>`;
  return pageShell({
    title: unit.title,
    frame: appFrameHtml({ threadId: null, publicStep: "stay" }),
    style: `${LISTING_GALLERY_STYLE}.unit-detail-sheet{position:relative;z-index:1;display:grid;gap:var(--space-4);margin-block-start:calc(-1 * var(--space-6));padding:var(--space-5);border:1px solid var(--color-border-subtle);border-radius:var(--radius-sheet) var(--radius-sheet) var(--radius-card) var(--radius-card);background:var(--color-surface);box-shadow:var(--elevation-active)}.unit-detail-sheet h1,.unit-detail-sheet h2,.unit-detail-sheet p,.unit-detail-sheet ul{margin:0}.unit-detail-location{display:flex;align-items:center;gap:var(--space-1);color:var(--color-text-secondary)}.unit-detail-description{white-space:pre-line}.unit-detail-page{display:grid;gap:var(--space-4)}.unit-detail-page .listing-gallery{z-index:0}.unit-detail-page .ui-action-bar{position:sticky}.unit-detail-page .ui-ticket{margin-block:var(--space-2)}.stay-results{list-style:none;margin:0;padding:0;display:grid;gap:var(--space-4)}.stay-card-photo{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:var(--radius-card);background:var(--color-surface-subtle)}.stay-card-photo--empty{display:grid;place-items:center;color:var(--color-text-secondary)}.stay-card-facts{display:flex;flex-wrap:wrap;gap:var(--space-2)}.stay-card-facts span{display:inline-flex;min-block-size:2.75rem;align-items:center;padding:var(--space-2) var(--space-3);border:1px solid var(--color-border-subtle);border-radius:var(--radius-pill);background:var(--color-surface-subtle);font-size:var(--font-size-small)}.stay-card-price{display:grid;gap:var(--space-1);padding-block-start:var(--space-3);border-block-start:1px solid var(--color-border-subtle)}.stay-card-price p{margin:0}.guest-editorial .ui-button--primary,.guest-editorial .ui-button--block{border-radius:var(--radius-pill)}.ui-panel p{margin:0}`,
    body: `<div class="guest-editorial unit-detail-page">${photoMarkup}<section class="unit-detail-sheet" aria-label="Stay details">${demo ? demoListingChipHtml() : ""}<p class="unit-detail-location">${icon("pin")}${escapeHtml(unit.location.neighbourhood)}, ${escapeHtml(unit.location.city)} · exact address after payment</p><h1>${escapeHtml(unit.title)}</h1>${unitTilesHtml(unitTiles(unit.bedrooms, unit.bathrooms, unit.capacity))}${unitIndicativePriceHtml(unit.price.nightlyKobo)}${extendedStayPageFacts(unit, extendedStay).map((text) => `<p class="ui-money-metadata">${escapeHtml(text)}</p>`).join("")}${unitAboutHtml(unit.description)}</section><div class="ui-action-bar"><p class="ui-action-bar__sum"><strong>${formatNgnKobo(unit.price.nightlyKobo)}</strong><span class="ui-money-metadata">Price per night (indicative)</span></p><a class="ui-button ui-button--primary ui-button--block" href="/">Continue to Request to Book</a></div></div>`,
  });
}


/**
 * Issue 06c: the server-rendered conversation for browsers without
 * JavaScript. Surfaces are shown by their text fallback and conventional
 * route (ADR-0080), with the same link label the client uses.
 */
/** Issue 08 / ADR-0080: the no-JS page shows the same journey rail as the live shell. */
function renderJourneyRailHtml(journey: GuestJourney | undefined): string {
  return railHtml(journey).replace(
    'class="ui-rail-nav"',
    'class="ui-rail-nav no-js-journey"',
  );
}

/** Issue 10 / ADR-0080: without JavaScript the absolute deadline stands in for the countdown. */
function renderWaitingHtml(waiting: GuestWaitingState | undefined): string {
  if (!waiting) return "";
  const list = (items: readonly string[]): string =>
    `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  return `<div class="no-js-waiting" data-waiting="${waiting.kind}"><h3>${escapeHtml(waiting.heading)}</h3><p>${escapeHtml(waiting.deadlineText)}</p><p>What happens next</p>${list(waiting.outcomes)}${list(waiting.meanwhile)}</div>`;
}

export function renderNoScriptConversationHtml(input: {
  readonly threadId: string;
  readonly timeline: readonly GuestTimelineEntry[];
  readonly surfaces: readonly GuestSurfacePayload[];
  readonly journey?: GuestJourney;
  readonly tasks?: readonly TaskRailEntry[];
  readonly verticals?: readonly VerticalStarter[];
  readonly error?: string;
  readonly draft?: string;
  readonly committedWork?: readonly GuestCommittedWork[];
}): string {
  const turns = input.timeline
    .map((entry) =>
      entry.role === "receipt"
        ? `<li class="no-js-receipt receipt-marker" data-role="receipt"><p>${icon("check")} ${escapeHtml(entry.text)}</p></li>`
        : `<li class="turn ${entry.role} no-js-turn" data-role="${entry.role}"><p class="turn-label">${entry.role === "user" ? "You" : "Shortlet Concierge"}</p><div class="bubble">${escapeHtml(entry.text)}</div></li>`,
    )
    .join("");
  const surfaces = input.surfaces
    .filter(
      (surface) =>
        surface.status !== "deleted" && surface.status !== "superseded",
    )
    .map((surface) => {
      const content = `<span class="ui-result-row__thumb">${icon("doc")}</span><span class="ui-result-row__body"><strong class="ui-result-row__title">${escapeHtml(surface.summary ?? "Current details")}</strong>${surface.textFallback ? `<span class="no-js-surface-fallback">${escapeHtml(surface.textFallback)}</span>` : ""}<span class="ui-link">${escapeHtml(surface.conventionalRouteLabel ?? "Open full details")}</span></span>${icon("chevron-right")}`;
      return `<section aria-label="${escapeHtml(surface.summary ?? "Current details")}">${surface.conventionalRoute ? `<a class="ui-result-row" href="${escapeHtml(surface.conventionalRoute)}">${content}</a>` : `<div class="ui-result-row">${content}</div>`}${renderWaitingHtml(surface.waiting)}</section>`;
    })
    .join("");
  const error = input.error
    ? `<p id="composer-error" class="ui-field__error" role="alert">${escapeHtml(input.error)}</p>`
    : "";
  // Issue 13a / ADR-0080: a new conversation without JavaScript still says the
  // Guest's live work elsewhere is unaffected, and links to it.
  const committed =
    input.timeline.length > 0
      ? ""
      : (input.committedWork ?? [])
          .filter((work) => work.threadId !== input.threadId)
          .map((work) => {
            const copy = guestNewConversationCopy(work.kind, work.unitTitle);
            return `<section class="ui-panel committed-work" data-kind="${work.kind}"><p>${escapeHtml(copy.stillActive)}</p><a class="ui-button" href="${escapeHtml(work.route)}">${escapeHtml(copy.link)}</a></section>`;
          })
          .join("");
  return pageShell({
    title: "Conversation · Shortlet",
    width: "narrow",
    frame: `${appBarHtml({ backHref: "/", backLabel: "Back to your conversation", action: { href: "/conversation", label: GUEST_NEW_CONVERSATION.control, icon: "message-plus" } })}${renderJourneyRailHtml(input.journey)}${taskRailHtml(input.tasks ?? [])}`,
    body: `<div class="guest-editorial no-js-conversation" data-page="conversation"><h1 class="ui-sr-only">Conversation</h1>${verticalStartersHtml(input.verticals ?? [])}${committed}${turns ? `<ol class="no-js-transcript" aria-label="Conversation">${turns}</ol>` : ""}${surfaces}<form id="composer" class="composer" method="post" action="/conversation" aria-label="Message the concierge"><div class="ui-field"><label class="ui-field__label" for="composer-input">Your message</label><p class="ui-field__hint" id="composer-hint">Share a city or neighbourhood, dates or nights, and number of guests.</p><input id="composer-input" name="message" type="text" autocomplete="off" enterkeyhint="send" maxlength="${MAX_TURN_TEXT_LENGTH}" required aria-describedby="composer-hint${error ? " composer-error" : ""}"${error ? ' aria-invalid="true"' : ""} value="${escapeHtml(input.draft ?? "")}">${error}</div><input type="hidden" name="threadId" value="${escapeHtml(input.threadId)}"><button class="ui-button ui-button--primary" type="submit">Send</button></form></div>`,
  });
}

/** The booking routes built by `apps/web/src/presentation.ts`; drafts are matched before requests. */
const CONVENTIONAL_BOOKING_ROUTES: readonly (readonly [
  ConventionalBookingPageKind,
  RegExp,
])[] = [
  ["draft", /^\/booking-requests\/drafts\/([^/]+)$/],
  ["request", /^\/booking-requests\/([^/]+)$/],
  ["offer", /^\/conditional-offers\/([^/]+)$/],
  ["contract", /^\/booking-contracts\/([^/]+)$/],
];

function matchConventionalBookingRoute(pathname: string): {
  readonly kind: ConventionalBookingPageKind;
  readonly encodedId: string;
} | null {
  for (const [kind, pattern] of CONVENTIONAL_BOOKING_ROUTES) {
    const match = pattern.exec(pathname);
    if (match && !(kind === "request" && match[1] === "drafts"))
      return { kind, encodedId: match[1]! };
  }
  return null;
}

export function renderConventionalBookingHtml(
  page: ConventionalBookingPage,
): string {
  const stay = page.stay;
  const ticket = stay
    ? stayTicketHtml({
        ...stay,
        ...(page.confirmation
          ? { bookingReference: page.confirmation.bookingReference }
          : {}),
      })
    : "";
  const breakdown = stay
    ? priceBreakdownHtml({
        ...(page.confirmation
          ? { depositCollected: page.confirmation.depositCollected }
          : {}),
        ...(stay.allInStayTotalKobo === undefined
          ? {}
          : { allInStayTotalKobo: stay.allInStayTotalKobo }),
        ...(stay.refundableSecurityDepositKobo === undefined
          ? {}
          : {
              refundableSecurityDepositKobo: stay.refundableSecurityDepositKobo,
            }),
        ...(stay.amountDueNowKobo === undefined
          ? {}
          : { amountDueNowKobo: stay.amountDueNowKobo }),
        ...(stay.amountDueNowIsConditional
          ? { heading: GUEST_FACT_LABELS.ifRequestAccepted }
          : {}),
        ...(stay.amountPaidKobo === undefined
          ? {}
          : { amountPaidKobo: stay.amountPaidKobo }),
      })
    : "";
  const signInOffer = page.signInOffer ? signInOfferHtml(page.signInOffer) : "";
  return pageShell({
    title: `${page.summary} · Shortlet`,
    width: "narrow",
    frame: appFrameHtml({
      threadId: page.threadId,
      ...(page.journey === undefined ? {} : { journey: page.journey }),
    }),
    body: page.offerScreen
      ? `<div class="guest-editorial">${offerScreenHtml(page.offerScreen, ticket, breakdown)}</div><script src="/offer.js" defer></script>`
      : page.confirmation
        ? `<div class="guest-editorial">${confirmationScreenHtml(page.confirmation, ticket, breakdown)}${signInOffer}</div>`
        : page.requestScreen
          ? `<div class="guest-editorial">${requestScreenHtml(page.requestScreen, ticket, breakdown, stay?.allInStayTotalKobo === undefined ? undefined : formatNgnKobo(stay.allInStayTotalKobo))}${signInOffer}</div>`
          : `<div class="guest-editorial"><header class="ui-page__header" data-page="booking-record"><p class="ui-eyebrow">Your booking</p><h1>${escapeHtml(page.summary)}</h1></header>${ticket}${breakdown}<section class="ui-panel"><p>${escapeHtml(page.textFallback)}</p><a class="ui-button ui-button--primary ui-button--block" href="/?threadId=${encodeURIComponent(page.threadId)}">Back to your conversation</a></section></div>`,
  });
}

/** Only the criteria `conventionalSearchRoute` builds for the guest app; anything else fails closed (ADR-0080). */
const SEARCH_TEXT_KEYS = [
  "location",
  "neighbourhood",
  "checkIn",
  "checkOut",
] as const;
const SEARCH_COUNT_KEYS = ["partySize", "bedrooms"] as const;

export function parseConventionalSearchQuery(
  params: URLSearchParams,
): Readonly<Record<string, string | number>> | null {
  const filters: Record<string, string | number> = {};
  for (const [key, value] of params) {
    // Issue 03b: the form's budget (whole naira) is optional, so an empty one means none.
    if (key === "budget") {
      if (value.trim() === "") continue;
      if (
        !/^\d{1,10}$/.test(value) ||
        Number(value) < 1 ||
        params.has("maxPriceKobo") ||
        params.getAll("budget").length > 1
      )
        return null;
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
      if (
        !area ||
        params.has("location") ||
        params.has("neighbourhood") ||
        params.getAll("area").length > 1
      )
        return null;
      filters.location = area.city;
      if (area.neighbourhood !== undefined)
        filters.neighbourhood = area.neighbourhood;
    } else if ((SEARCH_TEXT_KEYS as readonly string[]).includes(key))
      filters[key] = value.trim();
    else if (
      (SEARCH_COUNT_KEYS as readonly string[]).includes(key) &&
      /^\d{1,3}$/.test(value)
    )
      filters[key] = Number(value);
    else return null;
  }
  return filters;
}

function quotedNightCount(
  checkIn: unknown,
  checkOut: unknown,
): number | undefined {
  if (
    typeof checkIn !== "string" ||
    typeof checkOut !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(checkIn) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(checkOut)
  )
    return undefined;
  const start = Date.parse(`${checkIn}T00:00:00Z`);
  const end = Date.parse(`${checkOut}T00:00:00Z`);
  const nights = (end - start) / 86_400_000;
  return Number.isInteger(nights) && nights > 0 ? nights : undefined;
}

export function renderConventionalSearchHtml(
  artifact: DiscoveryArtifactProjection,
  photoUrl?: (url: string) => string,
  demo = false,
): string {
  const { checkIn, checkOut } = artifact.facts.filters;
  const nights = quotedNightCount(checkIn, checkOut);
  const cards = artifact.facts.results
    .map((unit) => {
      const route =
        artifact.actions.find(
          (action) => action.type === "view-unit" && action.unitId === unit.id,
        )?.conventionalRoute ?? `/stays/${encodeURIComponent(unit.id)}`;
      const photo = unit.photoUrls[0];
      return `<li data-unit-id="${escapeHtml(unit.id)}">${stayCardHtml({ href: route, title: unit.title, neighbourhood: unit.location.neighbourhood, city: unit.location.city, allInStayTotalKobo: unit.price.allInStayTotalKobo, refundableSecurityDepositKobo: unit.price.refundableSecurityDepositKobo, nightlyKobo: unit.price.nightlyKobo, bedrooms: unit.bedrooms ?? null, bathrooms: unit.bathrooms, capacity: unit.capacity, ...(nights === undefined ? {} : { nights }), ...(demo ? { demoListing: true } : {}), ...(photo === undefined ? {} : { photoSrc: photoUrl ? photoUrl(photo) : photo, photoCount: unit.photoUrls.length }) })}</li>`;
    })
    .join("");
  const stay =
    typeof checkIn === "string" && typeof checkOut === "string"
      ? formatStayDates(checkIn, checkOut)
      : "";
  const summary = [
    discoverySummary(artifact.facts.filters).replace(
      /^Search updated( · )?/,
      "",
    ),
    stay,
  ]
    .filter(Boolean)
    .join(" · ");
  const filters = artifact.facts.filters as Readonly<Record<string, unknown>>;
  const currentArea = SEARCH_AREAS.find(
    (area) =>
      area.city === filters.location &&
      area.neighbourhood === filters.neighbourhood,
  )?.id;
  const text = (value: unknown): string =>
    typeof value === "string" ? escapeHtml(value) : "";
  // Issue 03a / ADR-0080: the strip's Where, When and Guests, editable without JavaScript.
  const form =
    `<form class="ui-panel search-form" id="change-search" method="get" action="/stays/search" aria-label="Change your search">` +
    `<div class="ui-field"><label class="ui-field__label" for="search-area">Where</label><select class="ui-input" id="search-area" name="area" required>${SEARCH_AREAS.map((area) => `<option value="${area.id}"${area.id === currentArea ? " selected" : ""}>${escapeHtml(area.label)}</option>`).join("")}</select></div>` +
    `<div class="ui-field"><label class="ui-field__label" for="search-check-in">Arrival date</label><input class="ui-input" id="search-check-in" name="checkIn" type="date" required value="${text(filters.checkIn)}"></div>` +
    `<div class="ui-field"><label class="ui-field__label" for="search-check-out">Departure date</label><input class="ui-input" id="search-check-out" name="checkOut" type="date" required value="${text(filters.checkOut)}"></div>` +
    `<div class="ui-field"><label class="ui-field__label" for="search-guests">Guests</label><input class="ui-input" id="search-guests" name="partySize" type="number" min="1" inputmode="numeric" required value="${typeof filters.partySize === "number" ? filters.partySize : ""}"></div>` +
    `<div class="ui-field"><label class="ui-field__label" for="search-budget">Budget for the stay (₦, optional)</label><p class="ui-field__hint" id="search-budget-hint">Compared with the ${GUEST_GLOSSARY.allInStayTotal}. The ${GUEST_GLOSSARY.refundableSecurityDeposit} is separate.</p><input class="ui-input" id="search-budget" name="budget" type="number" min="1" step="1" inputmode="numeric" aria-describedby="search-budget-hint" value="${typeof filters.maxPriceKobo === "number" ? Math.round(filters.maxPriceKobo / 100) : ""}"></div>` +
    `<button class="ui-button ui-button--primary" type="submit">Update search</button></form>`;
  // Design: "N apartments in <area>", then the criteria as chips that jump to the search form below (works without JavaScript).
  const areaLabel = SEARCH_AREAS.find(
    (area) =>
      area.city === filters.location &&
      area.neighbourhood === filters.neighbourhood,
  )?.label;
  const count = artifact.facts.results.length;
  const heading =
    count > 0 && areaLabel !== undefined
      ? `${count} ${count === 1 ? "apartment" : "apartments"} in ${areaLabel}`
      : discoveryFallbackMessage(artifact);
  const chip = (
    iconName: "pin" | "calendar" | "users" | "plus",
    label: string,
    add = false,
  ): string =>
    `<a class="ui-chip${add ? " ui-chip--add" : ""}" href="#change-search">${icon(iconName)}${escapeHtml(label)}</a>`;
  const chips = `<div class="ui-row" role="group" aria-label="Your search">${[
    areaLabel === undefined ? "" : chip("pin", areaLabel),
    typeof checkIn === "string" && typeof checkOut === "string"
      ? chip(
          "calendar",
          `${stay}${nights === undefined ? "" : ` · ${nights} ${nights === 1 ? "night" : "nights"}`}`,
        )
      : "",
    typeof filters.partySize === "number"
      ? chip(
          "users",
          `${filters.partySize} ${filters.partySize === 1 ? "guest" : "guests"}`,
        )
      : "",
    typeof filters.maxPriceKobo === "number"
      ? chip("plus", `Budget ${formatNgnKobo(filters.maxPriceKobo)}`)
      : chip("plus", "Budget", true),
  ].join("")}</div>`;
  return pageShell({
    title: "Search results · Shortlet",
    frame: appFrameHtml({ threadId: null, publicStep: "search" }),
    style:
      ".search-form{display:grid;gap:var(--space-3)}.stay-results{list-style:none;margin:0;padding:0;display:grid;gap:var(--space-4)}",
    body: `<div class="guest-editorial"><header class="ui-page__header" data-page="stay-search"><p class="ui-eyebrow">Stays that fit your trip</p><h1>${escapeHtml(heading)}</h1>${summary ? `<p>${escapeHtml(summary)}</p>` : ""}</header>${chips}${form}${cards ? `<ul class="stay-results" aria-label="Stay search results">${cards}</ul>` : ""}<p><a class="ui-button ui-button--primary" href="/">Back to your conversation</a></p></div>`,
  });
}

function readRawBody(req: HttpRequestLike): Promise<Buffer> {
  return readBoundedBody(req, PROVIDER_BODY_LIMIT_BYTES);
}

/**
 * Form posts are small (ADR 0080 no-JS forms); chunks are collected as Buffer bytes so the same reader works
 * without node:http (slice 08a) and the 4 KiB ceiling counts bytes, not decoded characters.
 */
function readFormBody(req: HttpRequestLike): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    const buffers: Buffer[] = [];
    let size = 0;
    let refused = false;
    req.on("data", (chunk: Buffer) => {
      if (refused) return;
      size += chunk.length;
      if (size > 4096) {
        refused = true;
        reject(new Error("Form is too large"));
        return;
      }
      buffers.push(Buffer.from(chunk));
    });
    req.on("end", () => {
      if (!refused)
        resolve(new URLSearchParams(Buffer.concat(buffers).toString("utf8")));
    });
    req.on("error", reject);
  });
}

export function renderGuestContactHtml(
  contact: {
    phoneNumber: string | null;
    contactEmail: string | null;
    revision: number;
  } | null,
  error = "",
  kind: "phone" | "email" | "both" = "both",
  entered: {
    readonly phoneNumber?: string;
    readonly contactEmail?: string;
  } = {},
): string {
  const safe = escapeHtml;
  const phoneError = kind === "phone" ? error : "";
  const emailError = kind === "email" ? error : "";
  const phoneValue = entered.phoneNumber ?? contact?.phoneNumber ?? "";
  const emailValue = entered.contactEmail ?? contact?.contactEmail ?? "";
  const phoneForm =
    kind === "email"
      ? ""
      : `<form class="ui-panel" method="post" action="/guest/contact/phone"><div class="ui-field"><label class="ui-field__label" for="phoneNumber">Phone number <span aria-hidden="true">*</span></label><p class="ui-field__hint" id="phoneNumber-help">Required before you send a Booking Request. Use a Nigerian mobile number: +234 E.164 format. Example: +234 801 234 5678 or 0801 234 5678. This is for booking coordination, not identity verification.</p><input id="phoneNumber" name="phoneNumber" type="tel" inputmode="tel" autocomplete="tel" enterkeyhint="done" maxlength="32" required aria-describedby="phoneNumber-help${phoneError ? " phoneNumber-error" : ""}"${phoneError ? ' aria-invalid="true"' : ""} value="${safe(phoneValue)}">${phoneError ? `<p id="phoneNumber-error" class="ui-field__error" role="alert">${safe(phoneError)}</p>` : ""}</div><input type="hidden" name="expectedRevision" value="${contact?.revision ?? 0}"><button class="ui-button ui-button--primary ui-button--block" type="submit">Save phone number</button></form>`;
  const emailForm =
    kind === "phone"
      ? ""
      : `<form class="ui-panel" method="post" action="/guest/contact/email"><div class="ui-field"><label class="ui-field__label" for="contactEmail">Email address <span aria-hidden="true">*</span></label><p class="ui-field__hint" id="contactEmail-help">Required to initialize hosted card checkout and send your payment receipt. This email is not your account identity.</p><input id="contactEmail" name="contactEmail" type="email" inputmode="email" autocomplete="email" enterkeyhint="done" maxlength="254" required aria-describedby="contactEmail-help${emailError ? " contactEmail-error" : ""}"${emailError ? ' aria-invalid="true"' : ""} value="${safe(emailValue)}">${emailError ? `<p id="contactEmail-error" class="ui-field__error" role="alert">${safe(emailError)}</p>` : ""}</div><input type="hidden" name="expectedRevision" value="${contact?.revision ?? 0}"><button class="ui-button ui-button--primary ui-button--block" type="submit">Save email address</button></form>`;
  const generalError =
    error && kind === "both"
      ? `<p class="ui-banner ui-banner--danger" role="alert">${icon("alert")}<span>${safe(error)}</span></p>`
      : "";
  return pageShell({
    title: "Guest contact",
    width: "narrow",
    body: `<header class="ui-page__header"><h1>Guest contact</h1><p>Used only to coordinate your booking and payment.</p></header>${generalError}${phoneForm}${emailForm}`,
  });
}

const PAGE_ERROR_COPY: Readonly<
  Record<string, { readonly title: string; readonly message: string }>
> = {
  AUTHENTICATION_REQUIRED: {
    title: "Open this from your conversation",
    message:
      "This page needs the browser session you used to chat with the concierge. Return to the conversation and follow the link from there.",
  },
  INVALID_OFFER: {
    title: "This payment link isn't valid",
    message:
      "The link is incomplete or has been changed. Return to the conversation for the current booking status.",
  },
  PAYMENT_OFFER_NOT_FOUND: {
    title: "We couldn't find this booking offer",
    message:
      "It may have expired or belong to a different conversation. Return to the conversation for the current booking status.",
  },
  PAYMENT_CONTINUATION_REJECTED: {
    title: "Payment can't continue right now",
    message:
      "No payment was taken. The offer may have expired or already been paid. Return to the conversation for the current booking status.",
  },
  TRANSFER_UNAVAILABLE: {
    title: "Bank transfer is unavailable",
    message:
      "No transfer account was issued and no payment was taken. Go back and pay by card, or try again in a few minutes.",
  },
  TRANSFER_REJECTED: {
    title: "Bank transfer can't start",
    message:
      "No transfer account was issued. The offer may have expired or another payment may already be in progress. Return to the conversation for the current booking status.",
  },
  MANUAL_TRANSFER_UNAVAILABLE: {
    title: "Manual bank transfer is unavailable",
    message: "No payment was taken. Go back and choose another way to pay.",
  },
  MANUAL_TRANSFER_REJECTED: {
    title: "Manual bank transfer can't start",
    message:
      "Manual bank transfer is only offered when we can check your payment between 8:00 AM and 8:00 PM WAT, and only while no other payment is in progress. No payment was taken.",
  },
  PAYMENT_METHOD_INVALID: {
    title: "Choose how to pay",
    message:
      "Pick card or bank transfer on the payment page. No payment was started.",
  },
  MANUAL_TRANSFER_IN_PROGRESS: {
    title: "Your manual bank transfer is still open",
    message:
      "You chose manual bank transfer, so other payment methods are unavailable until it is confirmed, declined or expires.",
  },
  TRANSFER_IN_PROGRESS: {
    title: "Your bank transfer is still open",
    message:
      "You chose bank transfer, so card payment is unavailable until the transfer account expires. Transfer the exact amount to the account shown, or wait for it to expire.",
  },
  PAYSTACK_UNAVAILABLE: {
    title: "Card checkout is unavailable",
    message:
      "No payment was taken. Try again in a few minutes from your conversation.",
  },
  INVALID_CHECKOUT_URL: {
    title: "Card checkout is unavailable",
    message:
      "No payment was taken. Try again in a few minutes from your conversation.",
  },
  LOCAL_PAYMENT_INVALID: {
    title: "This demo payment link isn't valid",
    message: "Start the payment again from your conversation.",
  },
  INVALID_BOOKING_LINK: {
    title: "This booking link isn't valid",
    message:
      "The link is incomplete or has been changed. Return to the conversation for the current booking status.",
  },
  BOOKING_RECORD_NOT_FOUND: {
    title: "We couldn't find this booking",
    message:
      "It may belong to a different conversation. Return to the conversation for the current booking status.",
  },
  INVALID_CONVERSATION: {
    title: "This conversation link isn't valid",
    message:
      "The link is incomplete or has been changed. Start again from the conversation.",
  },
  SEARCH_INVALID: {
    title: "This search link isn't valid",
    message:
      "The link is incomplete or has been changed. Return to the conversation and search again.",
  },
};

/** Page routes answer browser navigations with a styled page and API clients with JSON. */
function sendPageError(
  req: HttpRequestLike,
  res: HttpResponseLike,
  status: number,
  code: string,
  // Account routes pass true: their refusals are never cached (delta 2).
  noStore = false,
): void {
  if (!prefersHtml(req.headers.accept)) {
    if (noStore) {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify({ ok: false, code }));
      return;
    }
    sendJson(res, status, { ok: false, code });
    return;
  }
  const copy = PAGE_ERROR_COPY[code] ?? {
    title: "This action couldn't be completed",
    message: "Return to your conversation for the current options.",
  };
  res.writeHead(status, noStore ? ACCOUNT_PAGE_HEADERS : GUEST_HTML_HEADERS);
  res.end(
    errorPage({
      status,
      code,
      title: copy.title,
      message: copy.message,
      action: { href: "/", label: "Back to your conversation" },
    }),
  );
}

/**
 * The manual transfer page (P5, ADR 0090): the business account, the exact amount, the unique booking reference and
 * the absolute WAT deadline; then one receipt upload. It says plainly that the booking confirms only after the money
 * is checked, never on the receipt (ADR 0005, 0090). A plain multipart form: no JavaScript (ADR 0080).
 */
export function renderManualTransferPageHtml(input: {
  readonly transfer: ManualTransfer;
  readonly now: Date;
  readonly receiptMaxBytes: number;
  readonly error: string;
  readonly threadId: string | null;
  readonly journey?: GuestJourney;
  readonly contractId: string | null;
  readonly stay?: GuestStayTicketFacts;
  readonly allInStayTotalKobo?: number;
  readonly refundableSecurityDepositKobo?: number;
}): string {
  const { transfer, now } = input;
  const conversation = input.threadId
    ? `/?threadId=${encodeURIComponent(input.threadId)}`
    : "/";
  const back = `<a class="ui-button ui-button--secondary ui-button--block" href="${conversation}">Back to your conversation</a>`;
  const alert = input.error
    ? `<p class="ui-banner ui-banner--danger" role="alert">${icon("alert")}<span>${escapeHtml(input.error)}</span></p>`
    : "";
  const screen = (
    state: string,
    heading: string,
    tone: KitStatusTone,
    status: string,
    parts: {
      readonly banner?: string;
      readonly sections?: readonly string[];
      readonly actions: string;
    },
  ) =>
    pageShell({
      title: `${heading} · Shortlet`,
      width: "narrow",
      frame: appFrameHtml({
        threadId: input.threadId,
        ...(input.journey === undefined ? {} : { journey: input.journey }),
      }),
      body: `<div class="guest-editorial">${paymentLayoutHtml({
        state,
        eyebrow: "Booking payment · Manual bank transfer",
        title: heading,
        tone,
        status,
        banner: `${alert}${parts.banner ?? ""}`,
        ticket: input.stay ? stayTicketHtml(input.stay) : "",
        breakdown:
          input.allInStayTotalKobo === undefined
            ? ""
            : priceBreakdownHtml({
                allInStayTotalKobo: input.allInStayTotalKobo,
                ...(input.refundableSecurityDepositKobo === undefined
                  ? {}
                  : {
                      refundableSecurityDepositKobo:
                        input.refundableSecurityDepositKobo,
                    }),
                thisPaymentKobo: transfer.amountKobo,
              }),
        sections: parts.sections ?? [],
        actions: parts.actions,
      })}</div><script src="/payment.js" defer></script>`,
    });
  if (transfer.status === "confirmed") {
    return screen(
      "confirmed",
      "Payment received",
      "success",
      "Payment verified",
      {
        sections: [
          `<p>We found your transfer in our account. Your ${GUEST_GLOSSARY.reservation} is confirmed.</p>`,
        ],
        actions: `${input.contractId ? `<a class="ui-button ui-button--primary ui-button--block" href="${conventionalBookingContractRoute(input.contractId)}">View your ${GUEST_GLOSSARY.reservation}</a>` : ""}${back}`,
      },
    );
  }
  if (transfer.status === "rejected" || transfer.status === "expired") {
    // ADR 0090/0045: no Reservation; any money received for this attempt is refunded in full.
    const rejected = transfer.status === "rejected";
    return screen(
      "closed",
      "No Reservation was made",
      "danger",
      rejected ? "Transfer not matched" : "Transfer account expired",
      {
        banner: rejected
          ? paymentOutcomeBannerHtml(
              "danger",
              "We couldn't match your transfer to this booking.",
            )
          : paymentOutcomeBannerHtml(
              "danger",
              "The deadline passed before your payment was confirmed.",
              { label: "Expired at", iso: transfer.paymentDeadlineAt },
            ),
        sections: [
          `<p>Any money we received for this booking is refunded in full.</p>`,
        ],
        actions: paymentRecoveryActionsHtml(conversation),
      },
    );
  }
  if (transfer.status === "awaiting_verification") {
    return screen(
      "waiting",
      "Waiting for payment check",
      "warning",
      "Receipt received · not confirmed yet",
      {
        banner: paymentOutcomeBannerHtml(
          "neutral",
          "Your booking confirms only after we see the money in our account and check it.",
          { label: "We will check by", iso: transfer.verificationDeadlineAt },
        ),
        sections: [
          transferSummaryHtml([
            { label: "Transfer", value: formatNgnKobo(transfer.amountKobo) },
            {
              label: "Booking reference",
              value: transfer.bookingReference,
              mono: true,
            },
            ...(transfer.receipt === undefined
              ? []
              : [
                  {
                    label: "Receipt",
                    value: `Uploaded ${formatWAT(transfer.receipt.uploadedAt)}`,
                  },
                ]),
          ]),
          `<p>We received your receipt. Your dates are held until then. No ${GUEST_GLOSSARY.reservation} exists yet.</p>`,
        ],
        actions: back,
      },
    );
  }
  const limitMb = Math.floor(input.receiptMaxBytes / (1024 * 1024));
  return screen(
    "awaiting-receipt",
    "Transfer and upload your receipt",
    "warning",
    "Waiting for your transfer",
    {
      banner: deadlineBannerHtml({
        label: "Transfer and upload by",
        deadlineIso: transfer.paymentDeadlineAt,
        now,
      }),
      sections: [
        bankDetailsCardHtml(
          {
            bankName: transfer.account.bankName,
            accountName: transfer.account.accountName,
            accountNumber: transfer.account.accountNumber,
            amountKobo: transfer.amountKobo,
            bookingReference: transfer.bookingReference,
          },
          [
            "Include the booking reference with your transfer. Your booking confirms only after we see the money in our account and check it; the receipt alone doesn't confirm it.",
          ],
        ),
        uploadCardHtml({
          action: `/payments/offers/${encodeURIComponent(transfer.offerId)}/manual-transfer/receipt`,
          limitMb,
        }),
      ],
      actions: back,
    },
  );
}

/** Reads a request body, refusing (and discarding) anything over `limit` bytes. */
export class BodyTooLargeError extends Error {
  constructor() {
    super("Body too large");
  }
}

function readBoundedBody(req: HttpRequestLike, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let refused = false;
    req.on("data", (chunk: Buffer) => {
      if (refused) return;
      size += chunk.length;
      if (size > limit) {
        refused = true;
        chunks.length = 0;
        reject(new BodyTooLargeError());
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!refused) resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

/**
 * The bank transfer screen (P3, ADR 0088): the provider's bank and account, the exact amount and the absolute WAT
 * deadline with time left. It never says the booking is confirmed until a Reservation exists (ADR 0005). No JavaScript.
 */
export function renderTransferPageHtml(input: {
  readonly transfer: BankTransferCheckoutSession;
  readonly now: Date;
  readonly contract: { readonly contractId: string } | null;
  readonly threadId: string | null;
  readonly journey?: GuestJourney;
  readonly localPayment: boolean;
  readonly stay?: GuestStayTicketFacts;
  readonly allInStayTotalKobo?: number;
  readonly refundableSecurityDepositKobo?: number;
  readonly amountDueNowKobo?: number;
}): string {
  const { transfer, now } = input;
  const conversation = input.threadId
    ? `/?threadId=${encodeURIComponent(input.threadId)}`
    : "/";
  const back = `<a class="ui-button ui-button--secondary ui-button--block" href="${conversation}">Back to your conversation</a>`;
  const screen = (
    state: string,
    heading: string,
    tone: KitStatusTone,
    status: string,
    parts: {
      readonly banner?: string;
      readonly sections?: readonly string[];
      readonly actions: string;
    },
  ) =>
    pageShell({
      title: `${heading} · Shortlet`,
      width: "narrow",
      frame: appFrameHtml({
        threadId: input.threadId,
        ...(input.journey === undefined ? {} : { journey: input.journey }),
      }),
      body: `<div class="guest-editorial">${paymentLayoutHtml({
        state,
        eyebrow: "Booking payment · Bank transfer",
        title: heading,
        tone,
        status,
        ...(parts.banner === undefined ? {} : { banner: parts.banner }),
        ticket: input.stay ? stayTicketHtml(input.stay) : "",
        breakdown:
          input.allInStayTotalKobo === undefined
            ? ""
            : priceBreakdownHtml({
                allInStayTotalKobo: input.allInStayTotalKobo,
                ...(input.refundableSecurityDepositKobo === undefined
                  ? {}
                  : {
                      refundableSecurityDepositKobo:
                        input.refundableSecurityDepositKobo,
                    }),
                amountDueNowKobo: input.amountDueNowKobo,
                thisPaymentKobo: transfer.amountKobo,
              }),
        sections: parts.sections ?? [],
        actions: parts.actions,
      })}</div><script src="/payment.js" defer></script>`,
    });
  if (input.contract) {
    return screen(
      "confirmed",
      "Payment received",
      "success",
      "Payment verified",
      {
        sections: [
          `<p>Your transfer arrived and your ${GUEST_GLOSSARY.reservation} is confirmed.</p>`,
        ],
        actions: `<a class="ui-button ui-button--primary ui-button--block" href="${conventionalBookingContractRoute(input.contract.contractId)}">View your ${GUEST_GLOSSARY.reservation}</a>${back}`,
      },
    );
  }
  const payable =
    (transfer.status === "initiated" ||
      transfer.status === "processing_in_grace") &&
    now.getTime() < Date.parse(transfer.expiresAt);
  if (transfer.status === "processing_in_grace") {
    return screen(
      "waiting",
      "Your transfer is processing",
      "warning",
      "Your transfer is processing",
      {
        banner: paymentOutcomeBannerHtml(
          "neutral",
          `Your bank has started the transfer. It has not arrived yet and no ${GUEST_GLOSSARY.reservation} exists yet.`,
        ),
        sections: [
          transferSummaryHtml([
            { label: "Transfer", value: formatNgnKobo(transfer.amountKobo) },
          ]),
        ],
        actions: back,
      },
    );
  }
  if (!payable) {
    // ADR 0045/0047: the account stopped at the deadline; money sent afterwards is refunded in full and never books.
    return screen(
      "closed",
      "This transfer account has expired",
      "danger",
      "Transfer account expired",
      {
        banner: paymentOutcomeBannerHtml(
          "danger",
          `No ${GUEST_GLOSSARY.reservation} was made.`,
          { label: "The transfer account expired at", iso: transfer.expiresAt },
        ),
        sections: [`<p>Money sent after the deadline is refunded in full.</p>`],
        actions: paymentRecoveryActionsHtml(conversation),
      },
    );
  }
  const local = input.localPayment
    ? `<form method="post" action="/payments/local/transfer/complete"><input type="hidden" name="reference" value="${escapeHtml(transfer.transferReference)}"><button class="ui-button ui-button--block" type="submit">Complete local demo transfer</button></form>`
    : "";
  return screen(
    "awaiting-transfer",
    "Transfer to complete your booking",
    "warning",
    "Waiting for your transfer",
    {
      banner: deadlineBannerHtml({
        label: "Transfer by",
        deadlineIso: transfer.expiresAt,
        now,
      }),
      sections: [
        bankDetailsCardHtml(
          {
            bankName: transfer.bankName,
            accountNumber: transfer.accountNumber,
            amountKobo: transfer.amountKobo,
          },
          [
            "Transfer the exact amount. Your booking confirms automatically once the transfer arrives.",
            "This account is for this booking only and stops accepting payment at the deadline.",
          ],
        ),
        local,
      ],
      actions: back,
    },
  );
}

function sendJson(
  res: HttpResponseLike,
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
  res.end(JSON.stringify(body));
}

/** Responses that carry the Guest's contact email (issue 08) are never kept by a browser or a cache (ADR 0093). */
const NO_STORE = Object.freeze({ "Cache-Control": "no-store" });

/** Issue 08: a sent request or a confirmed booking, as a screen. Only the screen's own content decides, not the route. */
function isSentOrConfirmed(screen: {
  readonly requestScreen?: RequestScreenContent;
  readonly confirmation?: ConfirmationContent;
}): boolean {
  return (
    screen.confirmation !== undefined || screen.requestScreen?.state === "sent"
  );
}

/**
 * Issue 08 (ADR 0085): an offer, never a gate. It is shown only to a browser with no account (a signed-in browser never sees it)
 * and only while sign-in is enabled, because the form could not complete otherwise. The email is the contact the Guest already
 * gave (ADR 0093). It is computed per response and never stored with the thread (ADR 0075).
 */
async function signInOfferFor(input: {
  readonly accounts: GuestAccountRuntime | null;
  /** The principal's own request contact row, never the account-aware view: a linked principal's view is the account email (D1). */
  readonly ownContacts: {
    find(principalId: string, tenantId: string): Promise<GuestContact | null>;
  };
  readonly principal: CommandPrincipal;
  readonly credentials: GuestAccountCredentials | null;
  readonly returnPath: string;
}): Promise<SignInOfferContent | undefined> {
  if (input.accounts === null || !input.principal.tenantId) return undefined;
  // D1 (ADR 0093, 0075), fail closed: a principal linked to ANY account gets no offer, even when its account session is not presented.
  if ((await input.accounts.linkedAccountOf(input.principal.id)) !== null)
    return undefined;
  if (
    (await input.accounts.identityFor(input.principal.id, input.credentials))
      .accountGuestId !== undefined
  )
    return undefined;
  const own = await input.ownContacts.find(
    input.principal.id,
    input.principal.tenantId,
  );
  return { email: own?.contactEmail ?? "", returnPath: input.returnPath };
}

/** Issue 08: the offer rides on the last active request-sent or confirmation surface of a response, once per response. */
export function surfacesWithSignInOffer(
  surfaces: readonly GuestSurfacePayload[],
  offerFor: () => SignInOfferContent | undefined,
): { readonly surfaces: GuestSurfacePayload[]; readonly offered: boolean } {
  let index = -1;
  surfaces.forEach((surface, position) => {
    if (
      (surface.status === undefined || surface.status === "active") &&
      isSentOrConfirmed(surface)
    )
      index = position;
  });
  const offer = index < 0 ? undefined : offerFor();
  if (offer === undefined) return { surfaces: [...surfaces], offered: false };
  return {
    surfaces: surfaces.map((surface, position) =>
      position === index ? { ...surface, signInOffer: offer } : surface,
    ),
    offered: true,
  };
}

const GUEST_SESSION_COOKIE = "shortlet_guest_session";
/** Static assets the public /stays/* pages load; never refused for a stale session. */
const PUBLIC_GUEST_PATHS: ReadonlySet<string> = new Set([
  "/client.js",
  "/gallery.js",
  "/payment.js",
  "/offer.js",
  "/shortlet-foundations.css",
]);
const GUEST_SESSION_PATTERN = /^gs-[a-f0-9-]{36}$/;

/** The bundles and stylesheets the shell serves for the guest app. */
const SHORTLET_STATIC_ASSETS: readonly StaticAsset[] = [
  {
    path: "/shortlet-foundations.css",
    assetName: "shortlet-foundations.css",
    contentType: "text/css; charset=utf-8",
    cacheControl: "public, max-age=3600",
    missingStatus: 500,
    missingMessage:
      "Foundation styles missing; run npm run guest:local to build it.",
  },
  {
    path: "/gallery.js",
    assetName: "gallery.js",
    contentType: "text/javascript; charset=utf-8",
    missingStatus: 404,
    missingMessage:
      "Gallery script missing; run npm run guest:local to build it.",
  },
  {
    path: "/payment.js",
    assetName: "payment.js",
    contentType: "text/javascript; charset=utf-8",
    missingStatus: 404,
    missingMessage:
      "Payment script missing; run npm run guest:local to build it.",
  },
  {
    path: "/offer.js",
    assetName: "offer.js",
    contentType: "text/javascript; charset=utf-8",
    missingStatus: 404,
    missingMessage:
      "Payment script missing; run npm run guest:local to build it.",
  },
  {
    path: "/client.js",
    assetName: "client.js",
    contentType: "text/javascript; charset=utf-8",
    missingStatus: 500,
    missingMessage:
      "Guest client bundle missing; run npm run guest:local to build it.",
  },
];

/** The standard rate-limited response (ADR 0093): 429 with Retry-After, the pilot's status, code and recovery. */
function sendAccountRateLimited(
  res: HttpResponseLike,
  retryAfterSeconds: number,
): void {
  res.writeHead(429, {
    "Retry-After": String(retryAfterSeconds),
    "Cache-Control": "no-store",
    "Content-Type": "text/html; charset=utf-8",
  });
  res.end(renderRateLimitedHtml());
}

/** The inline message for a refused code, keyed by the authority's reason code (AC2). */
function codeFormError(code: string): AccountFormError {
  const errors = GUEST_ACCOUNT_COPY.errors;
  const message =
    code === "code_expired"
      ? errors.codeExpired
      : code === "code_attempts_exhausted"
        ? errors.attemptsExhausted
        : code === "code_consumed"
          ? errors.codeConsumed
          : errors.codeInvalid;
  return { code, message };
}

/**
 * The routes that start a fresh, unlinked session when the cookie has no binding (D3): the home page and the sign-in
 * and sign-out forms. Account identity is never granted by these; the pages behind an account stay gated.
 */
function reissuableBrowserRoute(
  method: string | undefined,
  path: string,
): boolean {
  if (method === "GET") return path === "/" || path === "/account/sign-in";
  if (method === "POST")
    return (
      path === "/account/sign-in" ||
      path === "/account/sign-in/code" ||
      path === "/account/sign-out" ||
      path === "/welcome/start"
    );
  return false;
}

function readGuestSession(req: HttpRequestLike): string | null | undefined {
  const header = req.headers.cookie;
  if (typeof header !== "string") return undefined;
  const value = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${GUEST_SESSION_COOKIE}=`))
    ?.slice(GUEST_SESSION_COOKIE.length + 1);
  if (value === undefined) return undefined;
  return GUEST_SESSION_PATTERN.test(value) ? value : null;
}

/** Compares digests so neither the code's length nor its content leaks through timing. */
function betaInviteCodeMatches(offered: string, expected: string): boolean {
  const digest = (value: string) =>
    createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(digest(offered.trim()), digest(expected));
}

/**
 * Staging beta gate (launch-readiness issue 22). A plain form, so it works without JavaScript (ADR 0080). From the landing
 * page (issue 14) it posts the code with the Guest's message in the body, never in the address.
 */
export function renderBetaInviteHtml(
  rejected: boolean,
  landingMessage?: string,
): string {
  const error = rejected
    ? `<p id="invite-error" class="ui-field__error" role="alert">That invite code is not valid. Check the invite link you were sent.</p>`
    : "";
  return pageShell({
    title: "Shortlet beta",
    width: "narrow",
    body: `<header class="ui-page__header"><p class="ui-eyebrow">Shortlet</p><h1>Shortlet beta</h1><p>This beta is open to invited testers. Open the invite link you were sent, or enter your invite code.</p></header><form class="ui-panel" method="${landingMessage === undefined ? "get" : "post"}" action="${landingMessage === undefined ? "/" : "/welcome/start"}">${landingMessage === undefined ? "" : `<input type="hidden" name="message" value="${escapeHtml(landingMessage)}">`}<div class="ui-field"><label class="ui-field__label" for="invite">Invite code</label><input id="invite" name="invite" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="200" required${rejected ? ` aria-invalid="true" aria-describedby="invite-error"` : ""}>${error}</div><button class="ui-button ui-button--primary ui-button--block" type="submit">Continue</button></form>`,
  });
}

/**
 * Issue 14 / ADR-0079: the landing message arrived while the Guest already has a conversation open. Continue is offered
 * first; the new conversation only starts when the Guest chooses it, and the message is carried in the body, not a URL.
 */
export function renderLandingContinueHtml(
  continueHref: string,
  message: string,
): string {
  const copy = GUEST_CONTINUE_CONVERSATION;
  return pageShell({
    title: "Continue your conversation · Shortlet",
    width: "narrow",
    body: `<header class="ui-page__header"><p class="ui-eyebrow">Shortlet</p><h1>${escapeHtml(copy.heading)}</h1><p>${escapeHtml(copy.lede)}</p></header><section class="ui-panel"><a class="ui-button ui-button--primary ui-button--block" href="${escapeHtml(continueHref)}">${escapeHtml(copy.continue)}</a></section><form class="ui-panel" method="post" action="/welcome/start"><h2>${escapeHtml(copy.startNewHeading)}</h2><p>${escapeHtml(copy.reassurance)}</p><input type="hidden" name="message" value="${escapeHtml(message)}"><input type="hidden" name="startNew" value="1"><button class="ui-button ui-button--block" type="submit">${escapeHtml(copy.startNew)}</button></form>`,
  });
}

function issueGuestSession(
  res: HttpResponseLike,
  secureCookie: boolean,
): string {
  const sessionId = `gs-${crypto.randomUUID()}`;
  res.setHeader(
    "Set-Cookie",
    `${GUEST_SESSION_COOKIE}=${sessionId};${secureCookie ? " Secure;" : ""} HttpOnly; SameSite=Lax; Path=/`,
  );
  return sessionId;
}

/**
 * The Origin check for the account POSTs (Q4). An Origin that matches is accepted. Without an Origin, a same-origin
 * Referer is accepted; with neither, the request is refused.
 */
function accountPostAccepted(
  req: HttpRequestLike,
  publicOrigin: string | undefined,
): boolean {
  if (typeof req.headers.origin === "string")
    return browserOriginAccepted(req, publicOrigin);
  const referer = req.headers.referer;
  if (typeof referer !== "string") return false;
  const expected = publicOrigin ?? `http://${req.headers.host ?? "localhost"}`;
  try {
    return new URL(referer).origin === new URL(expected).origin;
  } catch {
    return false;
  }
}

function browserOriginAccepted(
  req: HttpRequestLike,
  publicOrigin: string | undefined,
): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  const expected = publicOrigin ?? `http://${req.headers.host ?? "localhost"}`;
  if (origin === "null" && publicOrigin) {
    const configured = safePublicOrigin(publicOrigin);
    return (
      configured !== null &&
      configured.protocol === "http:" &&
      (configured.hostname === "127.0.0.1" ||
        configured.hostname === "localhost") &&
      req.headers["sec-fetch-site"] === "same-origin"
    );
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
async function resolveBrowserSession(
  env: LocalGuestEnvironment,
  cache: Map<string, BrowserSession>,
  sessionId: string | null | undefined,
  expectedPrincipalId?: string,
  accountCredentials: GuestAccountCredentials | null = null,
  accounts: GuestAccountRuntime | null = null,
): Promise<BrowserSession | null> {
  if (sessionId === null || typeof sessionId !== "string") return null;
  const sessionKey = hashSessionSecret(sessionId);
  const cached = cache.get(sessionKey);
  if (cached) {
    if (
      (expectedPrincipalId !== undefined &&
        cached.principalId !== expectedPrincipalId) ||
      cached.tenantId !== env.config.tenantId
    )
      return null;
    // The durable binding is checked on every request, so a session retired by another server instance stops at once
    // (ADR 0070, ADR 0093). The cache only saves the rebuild, never the authority.
    const live = await env.guestData.findSessionBinding(sessionKey);
    if (
      !live ||
      live.principalId !== cached.principalId ||
      live.tenantId !== cached.tenantId
    ) {
      cache.delete(sessionKey);
      return null;
    }
    return await withAccountIdentity(cached, accountCredentials, accounts);
  }
  const binding = await env.guestData.findSessionBinding(sessionKey);
  if (!binding) return null;
  if (
    (expectedPrincipalId !== undefined &&
      binding.principalId !== expectedPrincipalId) ||
    binding.tenantId !== env.config.tenantId
  )
    return null;
  // ADR 0101: in the Cloudflare split the guest threads live in the platform store, reached through guestData. The
  // interaction store here has no guest_threads table in that composition, so reading it on a cold cache failed.
  const threads = await env.guestData.findThreadsForPrincipal(binding.principalId, binding.tenantId);
  const session: BrowserSession = {
    sessionKey,
    principalId: binding.principalId,
    tenantId: binding.tenantId,
    // Replaced per request by withAccountIdentity; the cache never holds an account identity.
    identity: anonymousGuestIdentity(binding.principalId, binding.tenantId),
    // The thread set is derived from the durable principal-scoped threads; the
    // browser session itself never authorizes a thread id on its own.
    threadIds: new Set(threads.map((thread) => thread.threadId)),
  };
  cache.set(sessionKey, session);
  return await withAccountIdentity(session, accountCredentials, accounts);
}

/**
 * The browser session with its identity for this request (ADR 0093). A valid, linked account cookie widens the identity to
 * the account's Linked Principals; anything else is the browser's own principal. Resolved on every call, so a revoked
 * account session stops applying at once.
 */
async function withAccountIdentity(
  session: BrowserSession,
  accountCredentials: GuestAccountCredentials | null,
  accounts: GuestAccountRuntime | null,
): Promise<BrowserSession> {
  const identity = accounts
    ? await accounts.identityFor(session.principalId, accountCredentials)
    : anonymousGuestIdentity(session.principalId, session.tenantId);
  return { ...session, identity };
}

/**
 * Whether a session may read or act on an offer's stay and money details (offer access, ADR 0070, 0075, 0093): the offer's
 * primary guest in the session's identity (its own principal, a linked principal, or a claimed request), or its distinct
 * payer. A missing offer, a foreign one and one without a tenant are all refused the same way.
 */
export function offerAuthorized(
  env: LocalGuestEnvironment,
  session: BrowserSession,
  offerId: string,
): boolean {
  let offer: ConditionalBookingOffer;
  try {
    offer = env.conditionalOfferApp.getOffer(offerId);
  } catch {
    return false;
  }
  if (!offer.tenantId) return false;
  if (
    authorizesBookingRequest(session.identity, {
      requestId: offer.requestId,
      primaryGuestId: offer.parties.primaryGuest.id,
      tenantId: offer.tenantId,
    })
  )
    return true;
  const payerId = offer.parties.distinctPayer?.id;
  return (
    payerId !== undefined &&
    authorizesPrincipalOwner(session.identity, {
      principalId: payerId,
      tenantId: offer.tenantId,
    })
  );
}

/**
 * Whether a session may read a thread now (D2). The thread must be in the session's set, and when it is persisted its
 * owner must be in the identity resolved for this request, so a linked conversation stops once the account session ends.
 */
async function threadReadable(
  env: LocalGuestEnvironment,
  session: BrowserSession,
  threadId: string,
): Promise<boolean> {
  if (!session.threadIds.has(threadId)) return false;
  const record = await env.guestData.findThread(threadId);
  // Fail closed (AGENTS anti-pattern 1). Defence in depth: app.getState returns nothing without a saved record, so this
  // guard is not what keeps content from a record-less id today; it stops a future read path from serving one.
  if (!record) return false;
  return authorizesPrincipalOwner(session.identity, {
    principalId: record.principalId,
    tenantId: record.tenantId,
  });
}

async function bindBrowserThread(
  env: LocalGuestEnvironment,
  cache: Map<string, BrowserSession>,
  req: HttpRequestLike,
  threadId: string,
  requireSession = false,
  accounts: GuestAccountRuntime | null = null,
): Promise<boolean> {
  const sessionId = readGuestSession(req);
  if (sessionId === null) return false;
  if (sessionId === undefined) {
    if (requireSession) return false;
    // No browser session cookie at all: the deterministic demo accepts an
    // anonymous turn (legacy local behavior). The thread is still persisted
    // under the demo principal so it is restorable.
    const principal = env.guestPrincipal();
    const record = await env.guestData.findThread(threadId);
    if (record) {
      // A conversation saved for another principal is never re-owned by a cookieless request.
      if (
        record.principalId !== principal.id ||
        record.tenantId !== env.config.tenantId
      )
        return false;
      await env.guestData.saveThread({
        threadId,
        principalId: principal.id,
        tenantId: env.config.tenantId,
        threadJson: record.threadJson,
      });
    }
    return true;
  }
  const session = await resolveBrowserSession(
    env,
    cache,
    sessionId,
    env.config.guestId,
    accountCredentialsOf(req),
    accounts,
  );
  if (!session) return false;
  // The thread row is owned by the principal/tenant (ADR-0070); persisting it
  // makes the thread re-derivable after a restart by the same session binding.
  const record = await env.guestData.findThread(threadId);
  if (record) {
    // ADR 0070/0093: the session principal or a Linked Principal of its account owns the thread; nothing else does.
    if (
      !authorizesPrincipalOwner(session.identity, {
        principalId: record.principalId,
        tenantId: record.tenantId,
      })
    )
      return false;
    // A linked principal's thread keeps its owner (ADR 0004): only the owner's own thread is re-saved.
    if (record.principalId === session.principalId)
      await env.guestData.saveThread({
        threadId,
        principalId: session.principalId,
        tenantId: session.tenantId,
        threadJson: record.threadJson,
      });
  }
  session.threadIds.add(threadId);
  return true;
}

async function registerBrowserSession(
  env: LocalGuestEnvironment,
  cache: Map<string, BrowserSession>,
  sessionId: string,
  principalId = env.config.guestId,
): Promise<BrowserSession> {
  const sessionKey = hashSessionSecret(sessionId);
  const session: BrowserSession = {
    sessionKey,
    principalId,
    tenantId: env.config.tenantId,
    identity: anonymousGuestIdentity(principalId, env.config.tenantId),
    threadIds: new Set(),
  };
  cache.set(sessionKey, session);
  // Persist the binding (hash only, never the raw secret) so a restarted
  // application instance can re-authenticate the same browser session.
  await env.guestData.saveSessionBinding({
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
  /** What this browser may act on (ADR 0093). Thread ownership is checked against it, never against the cookie alone. */
  readonly identity: GuestIdentity;
  readonly threadIds: Set<string>;
}

const GUEST_HTML_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  // ADR-0078: serve the local accessible foundation while keeping remote styles disallowed. Shared with the Worker
  // so the two cannot drift (slice 13).
  ...GUEST_HTML_SECURITY_HEADERS,
} as const;

async function findGuestThreadForOffer(
  env: LocalGuestEnvironment,
  offerId: string,
  principal: { readonly id: string; readonly tenantId?: string },
  principalIds: readonly string[] = [principal.id],
): Promise<string | null> {
  if (!principal.tenantId) return null;
  // ADR 0093: the session principal's own threads and its account's Linked Principals' threads, and nothing else.
  for (const thread of await env.guestData.findThreadsForPrincipals(
    principalIds.includes(principal.id) ? principalIds : [],
    principal.tenantId,
  )) {
    try {
      const projection: unknown = JSON.parse(thread.threadJson);
      if (
        projection !== null &&
        typeof projection === "object" &&
        !Array.isArray(projection) &&
        (projection as { offerId?: unknown }).offerId === offerId
      )
        return thread.threadId;
    } catch {
      // Corrupt thread projections are not eligible callback targets.
    }
  }
  return null;
}

/** The conversation a payment page belongs to and its journey, for the shared app frame. */
async function threadFrame(
  app: LocalGuestApp,
  offerId: string,
  principal: CommandPrincipal,
  principalIds?: readonly string[],
): Promise<{
  readonly threadId: string | null;
  readonly journey?: GuestJourney;
}> {
  const threadId = await findGuestThreadForOffer(
    app.environment,
    offerId,
    principal,
    principalIds,
  );
  const journey =
    threadId === null
      ? undefined
      : await app.journeyForThread(threadId, principal);
  return { threadId, ...(journey === undefined ? {} : { journey }) };
}

export interface LocalGuestServerHandle {
  readonly port: number;
  readonly app: LocalGuestApp;
  /** The live environment; a fresh one is installed by /api/reset. */
  readonly environment: LocalGuestEnvironment;
  /** Issue 19: open per-session runtimes (each holds a SQLite connection); idle ones are evicted. */
  readonly activeSessionRuntimes: number;
  /** How many session runtimes this server has built since it started, including rebuilds after eviction. */
  readonly sessionRuntimesBuilt: number;
  listen(): Promise<number>;
  close(): Promise<void>;
}

/**
 * Whether this handler composes the commerce domain on its database. "local" (the default) applies the commerce
 * migrations and mounts the commerce routes. "disabled" does neither: the Shortlet Worker uses it, because commerce
 * data lives in its own object (ADR 0101), and applying the commerce ledger to the Shortlet database collides with
 * the Shortlet migration ledger.
 */
export const GUEST_COMMERCE_COMPOSITION = {
  local: "local",
  disabled: "disabled",
} as const;
export type GuestCommerceComposition =
  (typeof GUEST_COMMERCE_COMPOSITION)[keyof typeof GUEST_COMMERCE_COMPOSITION];
/**
 * The default composition follows the single commerce switch (ADR 0104). Off unless COMMERCE_ENABLED is exactly "true".
 * An unrecognised switch value throws here, at startup, and names the variable. Hosts that pass no environment (Workers)
 * read no process environment and so take "disabled".
 */
function defaultGuestCommerceComposition(): GuestCommerceComposition {
  const env: Readonly<Record<string, string | undefined>> =
    typeof process === "undefined" ? {} : process.env;
  return commerceEnabledFromEnv(env)
    ? GUEST_COMMERCE_COMPOSITION.local
    : GUEST_COMMERCE_COMPOSITION.disabled;
}
/** The commerce pack's domain id (domains/commerce/src/index.ts), which the disabled composition refuses. */
const COMMERCE_DOMAIN_PACK_ID = "commerce";

/**
 * Fails closed: the local composition needs the commerce module from its composition root (ADR 0104 decision 6). The
 * message names the variable and never echoes a value.
 */
function requireCommerceModule(module: GuestCommerceModule | undefined): GuestCommerceModule {
  if (module === undefined) {
    throw new Error(
      'COMMERCE_ENABLED is on, but no commerce module is injected: commerce composition "local" needs the commerce module from its composition root (ADR 0104 decision 6). The guest server refuses to start without it.',
    );
  }
  return module;
}

/** Fails closed: a missing value takes the switch-driven default; any other value that is not a known composition throws. */
function resolveGuestCommerceComposition(
  value: unknown,
): GuestCommerceComposition {
  if (value === undefined) return defaultGuestCommerceComposition();
  if (
    value === GUEST_COMMERCE_COMPOSITION.local ||
    value === GUEST_COMMERCE_COMPOSITION.disabled
  )
    return value;
  throw new Error('commerce must be "local" or "disabled"');
}

/**
 * Closed reasons for a rejected payment continuation (`/payments/offers/:id/continue`). The page shows one generic
 * message; the host sees only this reason (ADR 0075: no offer id, URL, reference, contact or provider text).
 */
export type PaymentContinuationRejectionReason =
  | "offer_not_accepted"
  | "contact_missing"
  | "payment_window_closed"
  | "provider_start_failed"
  | "unclassified";

export interface PaymentContinuationRejectedEvent {
  readonly code: "PAYMENT_CONTINUATION_REJECTED";
  readonly reason: PaymentContinuationRejectionReason;
  /** The closed HTTP-status class of a Paystack rejection. Present only with reason "provider_start_failed" (ADR 0075). */
  readonly statusClass?: PaystackProviderStatusClass;
}

/** The closed status class of a rejected Paystack start, when the thrown error is that rejection (ADR 0075). */
export function paymentContinuationProviderStatusClass(error: unknown): PaystackProviderStatusClass | undefined {
  return error instanceof PaystackProviderFailure && error.reason === "provider_rejected" ? error.statusClass : undefined;
}

/** Maps a thrown continuation error to its closed reason. Only the domain's fixed messages are matched. */
export function paymentContinuationRejectionReason(error: unknown): PaymentContinuationRejectionReason {
  const message = error instanceof Error ? error.message : "";
  if (/Checkout initialization requires an accepted offer|not accepted|Only the authoritative payer/i.test(message)) return "offer_not_accepted";
  if (/phone number is required|email address is required/i.test(message)) return "contact_missing";
  if (/Payment window has expired/i.test(message)) return "payment_window_closed";
  if (/Paystack/i.test(message)) return "provider_start_failed";
  return "unclassified";
}

export interface GuestRequestHandlerOptions {
  /** Metadata-only observation of a rejected payment continuation (closed reason; ADR 0075). */
  onPaymentContinuationRejected?: (event: PaymentContinuationRejectedEvent) => void;
  /** Metadata-only observation of a failed chat card start (closed reason; ADR 0075). */
  onCardCheckoutFailed?: (event: CardCheckoutFailedEvent) => void;
  /** Payment reference keys for the commerce pack (user decision 18 Oct 2026). Omitted: the injected module reads them from the environment. */
  paymentReferenceKeys?: PaymentReferenceKeys;
  environment?: LocalGuestEnvironment;
  /** Commerce composition on this handler's database. Default: "local" only when COMMERCE_ENABLED is "true", otherwise "disabled" (ADR 0104). The Shortlet Worker passes "disabled" (ADR 0101). */
  commerce?: GuestCommerceComposition;
  /**
   * The commerce domain, injected by a composition root that ships commerce (ADR 0104 decision 6). Default: none. With the
   * composition "local" and no module, the handler refuses to start. With the composition "disabled" the module is unused.
   */
  commerceModule?: GuestCommerceModule;
  clientScriptPath?: string;
  /** Slice 09a: the bundles/CSS the handler serves; the Node default is `nodeAssetLoader()` (no import-time reads). */
  assets?: AssetLoader;
  /** Owner-approved labelled illustrations; never seeds inventory or changes transaction authority. */
  landingDemo?: boolean;
  /** ADR 0095: Node reads lazily; the Workers host injects its own binary loader. */
  landingBinaryAssets?: LandingBinaryAssetLoader;
  modelClient?: AssistantModelClient;
  /** Metadata-only observation for local evaluation and host telemetry. */
  onAssistantDiagnostic?: (event: AssistantDiagnosticEvent) => void;
  /** Issue 05: one allow-listed record per assistant turn, passed to every AssistantRuntime this handler builds. */
  onAssistantTurn?: (record: AssistantTurnRecord) => void;
  /** Issue 05: the configured primary model id for `gen_ai.request.model`. Hosts that pass `modelClient` supply it. */
  assistantModelName?: string;
  conciergeMode?:
    | "deterministic"
    | "gemini"
    | "openai-compatible"
    | "assistant-offline";
  paystackClient?: PaystackClient;
  /** The platform Payments module (ADR 0099 rule 2). Built from `paystackClient` when not supplied. */
  payments?: Payments;
  /** Production-only deployment controls. Local fixture defaults remain unchanged. */
  production?: boolean;
  publicOrigin?: string;
  secureCookie?: boolean;
  sessionScopedGuestPrincipals?: boolean;
  /** Staging beta gate: when set, a new Guest session needs `/?invite=<code>` (issue 22). */
  betaInviteCode?: string;
  /**
   * Guest Account sign-in (issue 06). Undefined reads the composition from configuration; `null` disables sign-in. Sign-in
   * needs session-scoped principals, a code-hashing key and an email sender, and is disabled when any is missing.
   */
  guestAccounts?: GuestAccountComposition | null;
  /** Explicit local-pilot control; never enabled by production composition. */
  localPayment?: boolean;
  /** Explicit local-pilot photo mapping for synthetic, same-process assets. */
  localPhotoUrl?: (url: string) => string;
  fixtureRoutes?: boolean;
  /** Issue 19: daily cap on model calls; when it is spent, turns use the deterministic concierge. */
  modelCallBudget?: ModelCallBudget;
  /** Shared platform-owned per-provider-attempt quota authority. */
  modelRequestQuota?: ModelRequestQuotaPort;
  /** Slice 26: extra domain packs registered with the assistant runtime (multi-domain shell). */
  additionalPacks?: readonly AssistantDomainPack[];
  /** Issue 19: a session's runtime (environment, SQLite connection, assistant memory) is closed after this idle time. */
  sessionRuntimeIdleMs?: number;
  /**
   * At most this many session runtimes are resident; opening one more evicts the least recently used. Unset means
   * no cap. Runtimes share one SQLite handle, so an evicted session is rebuilt from durable state.
   */
  sessionRuntimeLimit?: number;
}

/**
 * Slice 08a: the request logic of the Guest server, callable without a node:http server. It returns the request
 * logic unchanged: a plain `(req: HttpRequestLike, res: HttpResponseLike) => Promise<void>`, plus what closes the
 * per-session runtimes and the environment.
 */
export interface GuestRequestHandler {
  readonly app: LocalGuestApp;
  /** The live environment; a fresh one is installed by /api/reset. */
  readonly environment: LocalGuestEnvironment;
  /** Issue 19: open per-session runtimes (each holds a SQLite connection); idle ones are evicted. */
  readonly activeSessionRuntimes: number;
  /** How many session runtimes this handler has built since it was created, including rebuilds after eviction. */
  readonly sessionRuntimesBuilt: number;
  handle(req: HttpRequestLike, res: HttpResponseLike): Promise<void>;
  /** Stops every timer the handler started, closes the runtimes and the default environment. */
  close(): Promise<void>;
}

export function createGuestRequestHandler(
  options: GuestRequestHandlerOptions = {},
): GuestRequestHandler {
  const sessionRuntimeLimit = options.sessionRuntimeLimit ?? null;
  if (
    sessionRuntimeLimit !== null &&
    (!Number.isSafeInteger(sessionRuntimeLimit) || sessionRuntimeLimit < 1)
  ) {
    throw new Error("sessionRuntimeLimit must be a positive whole number");
  }
  const sessionRuntimeIdleMs = options.sessionRuntimeIdleMs ?? null;
  if (
    sessionRuntimeIdleMs !== null &&
    (!Number.isSafeInteger(sessionRuntimeIdleMs) || sessionRuntimeIdleMs < 1)
  ) {
    throw new Error(
      "sessionRuntimeIdleMs must be a positive whole number of milliseconds",
    );
  }
  const commerceComposition = resolveGuestCommerceComposition(options.commerce);
  // ADR 0104 decision 6: a composition that is on needs the injected module. Fail closed here, before any state is opened.
  const commerceModule =
    commerceComposition === GUEST_COMMERCE_COMPOSITION.local
      ? requireCommerceModule(options.commerceModule)
      : undefined;
  // ADR 0101: a handler that composes no commerce must not be given the commerce pack either.
  if (
    commerceComposition === GUEST_COMMERCE_COMPOSITION.disabled &&
    (options.additionalPacks ?? []).some(
      (pack) => pack.id === COMMERCE_DOMAIN_PACK_ID,
    )
  ) {
    throw new Error(
      "commerce is disabled, so no commerce domain pack may be added",
    );
  }
  const rawMode = options.conciergeMode ?? process.env.CONCIERGE_MODE;
  const mode:
    | "deterministic"
    | "gemini"
    | "openai-compatible"
    | "assistant-offline" =
    rawMode === "gemini" || rawMode === "openai-compatible"
      ? rawMode
      : rawMode === "assistant-offline"
        ? "assistant-offline"
        : "deterministic";

  const configuredPaystack =
    options.paystackClient ??
    (() => {
      const configuration = loadPaystackConfiguration();
      return configuration
        ? new DirectPaystackClient(configuration)
        : undefined;
    })();
  const production = options.production === true;
  const fixtureRoutes = options.fixtureRoutes ?? !production;
  if (production && (options.localPayment || options.localPhotoUrl))
    throw new Error(
      "Production Guest composition cannot mount local pilot controls",
    );
  const sessionScopedGuestPrincipals =
    options.sessionScopedGuestPrincipals === true;
  if (production && !options.publicOrigin)
    throw new Error("Production Guest server requires SHORTLET_PUBLIC_ORIGIN");
  const secureCookie = options.secureCookie ?? production;
  const env =
    options.environment ??
    LocalGuestEnvironment.openNode({
      initialGuestPhoneNumber: null,
      initialGuestContactEmail: null,
      production,
      deterministicPsp: !production,
      ...(configuredPaystack === undefined
        ? {}
        : { paystackClient: configuredPaystack }),
    });
  const paystackClient = configuredPaystack ?? env.config.paystackClient;
  const payments =
    options.payments ??
    env.config.payments ??
    (paystackClient === undefined
      ? undefined
      : new PaystackPayments({ card: paystackClient }));
  const modelRequestQuota = options.modelRequestQuota ?? (mode === "gemini" || mode === "openai-compatible"
    ? new SqliteModelRequestQuota(env.database, modelRequestQuotaLimitsFromEnvironment(process.env))
    : undefined);
  const quotaGuard = (client: AssistantModelClient, runtimeEnvironment: LocalGuestEnvironment): AssistantModelClient => modelRequestQuota
    ? new ModelQuotaGuardClient(
      client,
      modelRequestQuota,
      { tenantId: runtimeEnvironment.config.tenantId, guestId: runtimeEnvironment.guestPrincipal().id },
    )
    : client;

  let assistantRuntime: AssistantRuntime | undefined;
  let assistantModelClient: AssistantModelClient | undefined;
  // Issue 05: the model id the turn record names. A host that injects `modelClient` supplies it; otherwise it is the environment's.
  let assistantModelName: string | undefined = options.assistantModelName;

  if (mode === "assistant-offline") {
    assistantModelClient = options.modelClient ?? new ScriptedAssistantModel();
    assistantRuntime = new AssistantRuntime(env, assistantModelClient, {
      // ADR 0099 section 6: the host (this composition root) supplies the Shortlet pack.
      packs: [createShortletAssistantPack(env)],
      additionalPacks: options.additionalPacks,
      onDiagnostic: options.onAssistantDiagnostic,
      onTurnRecord: options.onAssistantTurn,
      modelName: assistantModelName,
    });
  } else if (mode === "gemini" || mode === "openai-compatible") {
    // The production pilot passes a validated client; development commands read the same settings from the environment.
    const configuredConcierge = options.modelClient ? undefined : loadConciergeConfiguration({ ...process.env, CONCIERGE_MODE: mode });
    assistantModelClient =
      options.modelClient ??
      (configuredConcierge && createConciergeModelClient(configuredConcierge));
    assistantModelName ??= configuredConcierge?.primary?.model;
    if (!assistantModelClient)
      throw new Error(`CONCIERGE_MODE=${mode} requires a model client`);
    if (production && (!modelRequestQuota || assistantModelClient.supportsProviderAttemptReservation !== true))
      throw new Error("Production model use requires persistent quota storage and an attempt-aware adapter");
    if (options.modelCallBudget)
      assistantModelClient = new BudgetedModelClient(
        assistantModelClient,
        options.modelCallBudget,
      );
    const guardedModelClient = quotaGuard(assistantModelClient, env);
    assistantRuntime = new AssistantRuntime(env, guardedModelClient, {
      packs: [createShortletAssistantPack(env)],
      additionalPacks: options.additionalPacks,
      onDiagnostic: options.onAssistantDiagnostic,
      onTurnRecord: options.onAssistantTurn,
      modelName: assistantModelName,
    });
  }
  const modelCallBudget = options.modelCallBudget
    ? { modelCallBudget: options.modelCallBudget }
    : {};

  const defaultApp = new LocalGuestApp(env, {
    assistantRuntime,
    ...modelCallBudget,
    ...(options.onCardCheckoutFailed === undefined ? {} : { onCardCheckoutFailed: options.onCardCheckoutFailed }),
  });
  // Guest Account sign-in (issue 06). Disabled, not defaulted, when its key, sender or session scoping is missing.
  const accountComposition =
    options.guestAccounts === undefined
      ? (loadGuestAccountComposition(process.env) as GuestAccountComposition)
      : options.guestAccounts;
  // Q7: a missing or short key leaves the key unusable, which disables sign-in.
  const accountKey = usableCodeHashingKey(accountComposition?.codeHashingKey);
  const guestAccounts =
    accountComposition &&
    sessionScopedGuestPrincipals &&
    accountKey &&
    accountComposition.sender
      ? new GuestAccountRuntime({
          database: env.database,
          tenantId: env.config.tenantId,
          clock: () => env.clock(),
          requests: env.interactionStore,
          ...(accountComposition.remoteAccounts === undefined
            ? {}
            : { remoteAccounts: accountComposition.remoteAccounts }),
          ...(accountComposition.remoteAccountState === undefined
            ? {}
            : { accountState: accountComposition.remoteAccountState }),
          ...(accountComposition.remoteAssuranceInvalidator === undefined
            ? {}
            : {
                assuranceInvalidator:
                  accountComposition.remoteAssuranceInvalidator,
              }),
          composition: {
            ...accountComposition,
            codeHashingKey: accountKey,
            sender: accountComposition.sender,
          },
        })
      : null;
  const browserSessions = new Map<string, BrowserSession>();
  const sessionRuntimes = new Map<
    string,
    {
      readonly environment: LocalGuestEnvironment;
      readonly app: LocalGuestApp;
      lastUsedMs: number;
    }
  >();
  let sessionRuntimesBuilt = 0;
  // Durable state lives in SQLite, so an evicted session's runtime is rebuilt on its next request, exactly as after a
  // restart. Only the in-memory assistant conversation is lost.
  // Issue 06 (ADR 0070): a runtime with a run in flight is never evicted, idle or least recently used. Its run commits into that
  // runtime, so closing it would let the run finish against state the store no longer matches.
  const evictIdleRuntimes = (nowMs: number): void => {
    if (sessionRuntimeIdleMs === null) return;
    for (const [key, runtime] of sessionRuntimes) {
      if (nowMs - runtime.lastUsedMs < sessionRuntimeIdleMs) continue;
      if (runtime.app.hasRunInFlight()) continue;
      sessionRuntimes.delete(key);
      runtime.environment.close();
    }
  };
  const runtimeForSession = (
    session: BrowserSession,
  ): {
    readonly environment: LocalGuestEnvironment;
    readonly app: LocalGuestApp;
  } => {
    if (!sessionScopedGuestPrincipals)
      return { environment: env, app: defaultApp };
    const nowMs = env.clock().getTime();
    evictIdleRuntimes(nowMs);
    const existing = sessionRuntimes.get(session.sessionKey);
    if (existing) {
      existing.lastUsedMs = nowMs;
      // Re-insert so the Map's first key is always the least recently used runtime.
      sessionRuntimes.delete(session.sessionKey);
      sessionRuntimes.set(session.sessionKey, existing);
      return existing;
    }
    if (sessionRuntimeLimit !== null) {
      // Least recently used first. A runtime with a run in flight is skipped; when every resident runtime is busy the cap is
      // exceeded for this request rather than closing a run (issue 06).
      for (const [key, candidate] of [...sessionRuntimes]) {
        if (sessionRuntimes.size < sessionRuntimeLimit) break;
        if (candidate.app.hasRunInFlight()) continue;
        sessionRuntimes.delete(key);
        candidate.environment.close();
      }
    }
    // ADR 0004: every session runtime shares the live environment's one handle and inventory. Closing a runtime
    // environment never closes them, so eviction cannot disturb other sessions.
    const shared = defaultApp.environment;
    const runtimeEnvironment = new LocalGuestEnvironment(
      {
        ...shared.config,
        guestId: session.principalId,
        initialGuestPhoneNumber: null,
        initialGuestContactEmail: null,
        production,
        deterministicPsp: !production,
        ...(payments === undefined ? {} : { payments }),
      },
      {
        database: shared.database,
        unitRepository: shared.unitRepository,
        guestData: shared.guestData,
        guestDataIsRemote: shared.guestDataIsRemote,
      },
    );
    sessionRuntimesBuilt += 1;
    const runtime = {
      environment: runtimeEnvironment,
      app: new LocalGuestApp(runtimeEnvironment, {
        ...(options.onCardCheckoutFailed === undefined ? {} : { onCardCheckoutFailed: options.onCardCheckoutFailed }),
        ...(assistantModelClient
          ? {
              assistantRuntime: new AssistantRuntime(
                runtimeEnvironment,
                quotaGuard(assistantModelClient, runtimeEnvironment),
                { packs: [createShortletAssistantPack(runtimeEnvironment)], additionalPacks: options.additionalPacks, onDiagnostic: options.onAssistantDiagnostic, onTurnRecord: options.onAssistantTurn, modelName: assistantModelName },
              ),
            }
          : {}),
        ...modelCallBudget,
      }),
      lastUsedMs: nowMs,
    };
    sessionRuntimes.set(session.sessionKey, runtime);
    return runtime;
  };
  // Slice 09a: assets come from the injected loader (Node default `nodeAssetLoader()`), never from import-time reads.
  const assets =
    options.assets ??
    nodeAssetLoader({ clientScriptPath: options.clientScriptPath });

  // ---- Guest Account routes (issue 06, ADR 0093). Plain forms: each works without JavaScript (ADR 0080). ----
  const accountCookieLine = (value: string, maxAgeSeconds: number): string =>
    `${GUEST_ACCOUNT_COOKIE}=${value};${secureCookie ? " Secure;" : ""} HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
  const clearedAccountCookieLine = (): string =>
    `${GUEST_ACCOUNT_COOKIE}=;${secureCookie ? " Secure;" : ""} HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
  const interactionCookieLine = (sessionId: string): string =>
    `${GUEST_SESSION_COOKIE}=${sessionId};${secureCookie ? " Secure;" : ""} HttpOnly; SameSite=Lax; Path=/`;
  /** Binds a fresh interaction session and retires the previous binding (ADR 0093): the old cookie stops working. */
  const replaceInteractionSession = async (
    previous: BrowserSession | null,
    principalId: string,
    keepOwnConversations: boolean,
  ): Promise<string> => {
    const sessionId = `gs-${crypto.randomUUID()}`;
    const registered = await registerBrowserSession(
      env,
      browserSessions,
      sessionId,
      principalId,
    );
    if (previous !== null && keepOwnConversations) {
      // ADR 0093 continuity: only conversations this same principal saved carry over, never a linked or foreign one.
      for (const threadId of previous.threadIds) {
        const saved = await env.guestData.findThread(threadId);
        if (
          saved &&
          saved.principalId === principalId &&
          saved.tenantId === env.config.tenantId
        )
          registered.threadIds.add(threadId);
      }
    }
    if (previous !== null) {
      await env.guestData.deleteSessionBinding(previous.sessionKey);
      browserSessions.delete(previous.sessionKey);
    }
    return sessionId;
  };
  const existingBrowserSession = async (
    req: HttpRequestLike,
  ): Promise<BrowserSession | null> => {
    const raw = readGuestSession(req);
    if (typeof raw !== "string") return null;
    return resolveBrowserSession(
      env,
      browserSessions,
      raw,
      undefined,
      accountCredentialsOf(req),
      guestAccounts,
    );
  };
  /**
   * Binding writes (a new session for sign-in, or a rotation for sign-out) share the ADR 0093 per-address code-request
   * budget, so unauthenticated requests cannot grow the binding table without limit.
   */
  const bindingLimiter = new SlidingWindowRateLimiter(
    {
      limit: {
        ...GUEST_ACCOUNT_POLICY_DEFAULTS,
        ...(accountComposition?.policy ?? {}),
      }.codeRequestsPerAddressPerHour,
      windowMs: GUEST_ACCOUNT_POLICY_DEFAULTS.rateLimitWindowMs,
    },
    () => env.clock(),
  );
  type SignInSessionOutcome =
    | { readonly kind: "session"; readonly session: BrowserSession }
    | { readonly kind: "limited"; readonly retryAfterSeconds: number }
    | { readonly kind: "none" };
  /** Sign-in needs a browser session to link. A new one is issued only when no cookie exists and no invite gate applies, and the budget admits it. */
  const sessionForSignIn = async (
    req: HttpRequestLike,
    res: HttpResponseLike,
    address: string,
  ): Promise<SignInSessionOutcome> => {
    const raw = readGuestSession(req);
    if (raw === null) return { kind: "none" };
    if (raw !== undefined) {
      const existing = await existingBrowserSession(req);
      if (existing) return { kind: "session", session: existing };
    }
    if (options.betaInviteCode !== undefined) return { kind: "none" };
    const admitted = bindingLimiter.tryConsume(address);
    if (!admitted.allowed)
      return { kind: "limited", retryAfterSeconds: admitted.retryAfterSeconds };
    const sessionId = issueGuestSession(res, secureCookie);
    return {
      kind: "session",
      session: await registerBrowserSession(
        env,
        browserSessions,
        sessionId,
        generatePlatformId("guest"),
      ),
    };
  };
  /**
   * The account page for a signed-in browser (issue 07). The phone is read through the same contact view the Booking Request uses,
   * so the page and the next request agree (AC6). Without a browser session the account's own contact row is read.
   */
  const accountPageHtml = async (
    session: BrowserSession | null,
    status: {
      readonly account: GuestAccount;
      readonly governmentIdVerified: boolean;
    },
    extra: Partial<
      Omit<AccountPageInput, "email" | "phone" | "governmentIdVerified">
    >,
  ): Promise<string> => {
    const tenantId = env.config.tenantId;
    const contact = session
      ? await env.guestData.findContact(session.principalId, tenantId)
      : await env.guestData.findContact(
          status.account.accountGuestId,
          tenantId,
        );
    return renderAccountHtml({
      email: status.account.email,
      phone: contact?.phoneNumber ?? null,
      governmentIdVerified: status.governmentIdVerified,
      ...extra,
    });
  };

  /** Issue 08: the sign-in offer on a chat response, for the browser that asked (its own principal and account only). */
  const withSignInOffer = async (
    req: HttpRequestLike,
    environment: LocalGuestEnvironment,
    threadId: string,
    surfaces: readonly GuestSurfacePayload[],
  ) => {
    const session = await resolveBrowserSession(
      environment,
      browserSessions,
      readGuestSession(req),
      sessionScopedGuestPrincipals ? undefined : environment.config.guestId,
      accountCredentialsOf(req),
      guestAccounts,
    );
    if (!session) return { surfaces: [...surfaces], offered: false };
    const offer = await signInOfferFor({
      accounts: guestAccounts,
      ownContacts: {
        find: (principalId, tenantId) =>
          environment.guestData.findContact(principalId, tenantId),
      },
      principal: {
        id: session.principalId,
        role: "guest",
        tenantId: session.tenantId,
      },
      credentials: accountCredentialsOf(req),
      returnPath: `/?threadId=${encodeURIComponent(threadId)}`,
    });
    return surfacesWithSignInOffer(surfaces, () => offer);
  };

  const sendTurnResult = async (
    req: HttpRequestLike,
    res: HttpResponseLike,
    environment: LocalGuestEnvironment,
    threadId: string,
    result: GuestTurnResult,
  ): Promise<void> => {
    if (!result.ok) {
      sendJson(res, 200, result);
      return;
    }
    const withOffer = await withSignInOffer(
      req,
      environment,
      threadId,
      result.surfaces,
    );
    sendJson(
      res,
      200,
      { ...result, surfaces: withOffer.surfaces },
      withOffer.offered ? NO_STORE : {},
    );
  };

  const handleAccountRoute = async (
    req: HttpRequestLike,
    res: HttpResponseLike,
    url: URL,
  ): Promise<void> => {
    const accounts = guestAccounts;
    const path = url.pathname;
    if (!accounts) {
      // Sign-in is disabled, but a sign-out still ends the account server-side: the session hash needs no key, so
      // the revocation goes through the store directly. Sign-out everywhere that cannot end anything refuses, claiming no
      // success and keeping the cookie; a plain sign-out always clears the cookie and rotates the browser.
      if (
        req.method === "POST" &&
        (path === "/account/sign-out" ||
          path === "/account/sign-out-everywhere")
      ) {
        if (!accountPostAccepted(req, options.publicOrigin)) {
          sendPageError(req, res, 403, "ORIGIN_REJECTED", true);
          return;
        }
        const everywhere = path === "/account/sign-out-everywhere";
        // Never rate limited (orchestrator decision).
        const presented = accountCredentialsOf(req);
        const ended =
          presented === null
            ? null
            : revokeGuestAccountWithoutKey(env.database, {
                sessionId: presented.sessionId,
                sessionSecret: presented.sessionSecret,
                tenantId: env.config.tenantId,
                everywhere,
                now: env.clock(),
              });
        if (everywhere && ended === null) {
          res.writeHead(503, ACCOUNT_PAGE_HEADERS);
          res.end(renderSignInUnavailableHtml());
          return;
        }
        const previous = await existingBrowserSession(req);
        if (everywhere && ended !== null) {
          await env.guestData.deleteSessionBindingsForPrincipals(
            ended.principalIds,
            env.config.tenantId,
          );
          for (const [key, cached] of browserSessions) {
            if (ended.principalIds.includes(cached.principalId))
              browserSessions.delete(key);
          }
        }
        if (previous === null) {
          // No presented session: no binding is written and the account cookie is cleared.
          res.setHeader("Set-Cookie", clearedAccountCookieLine());
          res.writeHead(303, { Location: "/", "Cache-Control": "no-store" });
          res.end();
          return;
        }
        const interactionId = await replaceInteractionSession(
          previous,
          generatePlatformId("guest"),
          false,
        );
        res.setHeader("Set-Cookie", [
          interactionCookieLine(interactionId),
          clearedAccountCookieLine(),
        ]);
        res.writeHead(303, { Location: "/", "Cache-Control": "no-store" });
        res.end();
        return;
      }
      res.writeHead(503, ACCOUNT_PAGE_HEADERS);
      res.end(renderSignInUnavailableHtml());
      return;
    }
    const credentials = accountCredentialsOf(req);
    if (req.method === "GET" && path === "/account/sign-in") {
      // Rendering the form writes no binding; the first POST that needs a session creates it.
      res.writeHead(200, ACCOUNT_PAGE_HEADERS);
      res.end(
        renderSignInHtml({
          returnPath: safeReturnPath(url.searchParams.get("return")),
        }),
      );
      return;
    }
    if (req.method === "GET" && path === "/account") {
      // Issue 07: a signed-out browser is sent to sign-in and sees no account data (AC1).
      // A presented interaction cookie that no longer resolves (for example the pre-sign-in value) never shows the account (ADR
      // 0093), so it is treated as signed out. Without that cookie, a live account session alone is enough.
      const session = await existingBrowserSession(req);
      const staleInteraction =
        typeof readGuestSession(req) === "string" && session === null;
      const account = await accounts.resolveAccount(credentials);
      // Review D4: a presented interaction session must be linked to the same account as the account cookie, or nothing is shown.
      const mismatched =
        session !== null &&
        account !== null &&
        (await accounts.linkedAccountOf(session.principalId)) !==
          account.accountGuestId;
      const status =
        account && !staleInteraction && !mismatched
          ? await accounts.accountStatus(account.accountGuestId)
          : null;
      if (!status) {
        res.writeHead(303, {
          Location: "/account/sign-in?return=/account",
          "Cache-Control": "no-store",
        });
        res.end();
        return;
      }
      // Review D3: the notice is read from a fixed allowlist; any other value is ignored and never reflected.
      const notice = accountNoticeFrom(url.searchParams.get("notice"));
      res.writeHead(200, ACCOUNT_PAGE_HEADERS);
      res.end(
        await accountPageHtml(
          session,
          status,
          notice === undefined ? {} : { notice },
        ),
      );
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    // ADR 0093 / ADR 0080: every state-changing form is origin-checked like the other Guest POSTs.
    if (!accountPostAccepted(req, options.publicOrigin)) {
      sendPageError(req, res, 403, "ORIGIN_REJECTED", true);
      return;
    }
    let form: URLSearchParams;
    try {
      form = await readFormBody(req);
    } catch {
      sendPageError(req, res, 400, "INVALID_EVENT", true);
      return;
    }
    const returnPath = safeReturnPath(form.get("return"));
    const email = form.get("email") ?? "";
    const invalidEmail = (): void => {
      res.writeHead(400, ACCOUNT_PAGE_HEADERS);
      res.end(
        renderSignInHtml({
          returnPath,
          email,
          error: {
            code: "invalid_email",
            message: GUEST_ACCOUNT_COPY.errors.invalidEmail,
          },
        }),
      );
    };

    if (path === "/account/sign-in") {
      const admittedSession = await sessionForSignIn(
        req,
        res,
        accounts.clientAddress(req),
      );
      if (admittedSession.kind === "limited") {
        sendAccountRateLimited(res, admittedSession.retryAfterSeconds);
        return;
      }
      if (admittedSession.kind === "none") {
        sendPageError(req, res, 401, "AUTHENTICATION_REQUIRED", true);
        return;
      }
      try {
        normalizeContactEmail(email);
      } catch {
        invalidEmail();
        return;
      }
      try {
        const sent = await accounts.requestSignInCode({
          email,
          clientAddress: accounts.clientAddress(req),
        });
        res.writeHead(200, ACCOUNT_PAGE_HEADERS);
        res.end(
          renderSignInCodeHtml({
            email: sent.email,
            challengeId: sent.challengeId,
            returnPath,
            minutes: accounts.signInCodeLifetimeMinutes,
          }),
        );
      } catch (error) {
        if (
          error instanceof GuestAccountAuthorityError &&
          error.code === "rate_limited"
        ) {
          sendAccountRateLimited(res, error.retryAfterSeconds ?? 1);
          return;
        }
        if (error instanceof SignInDeliveryError) {
          res.writeHead(503, ACCOUNT_PAGE_HEADERS);
          res.end(
            renderSignInHtml({
              returnPath,
              email,
              error: {
                code: "send_failed",
                message: GUEST_ACCOUNT_COPY.errors.sendFailed,
              },
            }),
          );
          return;
        }
        throw error;
      }
      return;
    }

    if (path === "/account/sign-in/code") {
      const admittedSession = await sessionForSignIn(
        req,
        res,
        accounts.clientAddress(req),
      );
      if (admittedSession.kind === "limited") {
        sendAccountRateLimited(res, admittedSession.retryAfterSeconds);
        return;
      }
      if (admittedSession.kind === "none") {
        sendPageError(req, res, 401, "AUTHENTICATION_REQUIRED", true);
        return;
      }
      const session = admittedSession.session;
      const challengeId = form.get("challengeId") ?? "";
      const code = form.get("code") ?? "";
      try {
        normalizeContactEmail(email);
      } catch {
        invalidEmail();
        return;
      }
      let verified: GuestAccountSession;
      try {
        verified = await accounts.verifySignInCode({
          challengeId,
          email,
          code,
          clientAddress: accounts.clientAddress(req),
        });
      } catch (error) {
        if (!(error instanceof GuestAccountAuthorityError)) throw error;
        if (error.code === "rate_limited") {
          sendAccountRateLimited(res, error.retryAfterSeconds ?? 1);
          return;
        }
        if (error.code === "invalid_input") {
          invalidEmail();
          return;
        }
        res.writeHead(200, ACCOUNT_PAGE_HEADERS);
        res.end(
          renderSignInCodeHtml({
            email,
            challengeId,
            returnPath,
            minutes: accounts.signInCodeLifetimeMinutes,
            error: codeFormError(error.code),
          }),
        );
        return;
      }
      // The link uses the authority's verified session (ADR 0093, issue 05 Human decision 2) and happens before any cookie.
      try {
        if (accounts.linkVerifiedSignInAcrossDomains)
          await accounts.linkVerifiedSignInAcrossDomains(
            session.principalId,
            verified,
          );
        else await accounts.linkVerifiedSignIn(session.principalId, verified);
      } catch (error) {
        if (
          error instanceof GuestAccountAuthorityError &&
          error.code === "account_conflict"
        ) {
          res.writeHead(409, ACCOUNT_PAGE_HEADERS);
          res.end(
            renderSignInHtml({
              returnPath,
              email,
              error: {
                code: "account_conflict",
                message: GUEST_ACCOUNT_COPY.errors.linkConflict,
              },
            }),
          );
          return;
        }
        if (
          error instanceof GuestAccountAuthorityError &&
          error.code === "session_invalid"
        ) {
          sendPageError(req, res, 401, "AUTHENTICATION_REQUIRED", true);
          return;
        }
        throw error;
      }
      // ADR 0093: sign-in rotates the interaction cookie, so the pre-sign-in value no longer authenticates.
      const interactionId = await replaceInteractionSession(
        session,
        session.principalId,
        true,
      );
      const maxAge = Math.max(
        1,
        Math.floor(
          (Date.parse(verified.expiresAt) - env.clock().getTime()) / 1000,
        ),
      );
      res.setHeader("Set-Cookie", [
        interactionCookieLine(interactionId),
        accountCookieLine(
          `${verified.sessionId}.${verified.sessionSecret}`,
          maxAge,
        ),
      ]);
      res.writeHead(303, { Location: returnPath, "Cache-Control": "no-store" });
      res.end();
      return;
    }

    if (
      path === "/account/email" ||
      path === "/account/email/code" ||
      path === "/account/phone"
    ) {
      const account = await accounts.resolveAccount(credentials);
      const status = account
        ? await accounts.accountStatus(account.accountGuestId)
        : null;
      if (!credentials || !account || !status) {
        sendPageError(req, res, 401, "AUTHENTICATION_REQUIRED", true);
        return;
      }
      const session = await existingBrowserSession(req);
      // Review D4: an interaction session of another account refuses the request before anything is read or written.
      if (
        session !== null &&
        (await accounts.linkedAccountOf(session.principalId)) !==
          account.accountGuestId
      ) {
        res.writeHead(303, {
          Location: "/account/sign-in?return=/account",
          "Cache-Control": "no-store",
        });
        res.end();
        return;
      }
      const minutes = accounts.signInCodeLifetimeMinutes;
      const sendAccountPage = async (
        extra: Partial<
          Omit<AccountPageInput, "email" | "phone" | "governmentIdVerified">
        >,
        status400: boolean,
      ): Promise<void> => {
        res.writeHead(status400 ? 400 : 200, ACCOUNT_PAGE_HEADERS);
        res.end(await accountPageHtml(session, status, extra));
      };
      if (path === "/account/phone") {
        const typed = form.get("phone") ?? "";
        let phoneNumber: string;
        try {
          phoneNumber = normalizeNigerianPhoneNumber(typed);
        } catch (error) {
          // ADR 0078: the typed value survives and the existing validation message is shown inline.
          await sendAccountPage(
            {
              phoneDraft: typed,
              phoneError: {
                code: "invalid_phone",
                message:
                  error instanceof Error
                    ? error.message
                    : GUEST_ACCOUNT_COPY.errors.phoneSaveFailed,
              },
            },
            true,
          );
          return;
        }
        try {
          await env.guestData.savePhone({
            guestId: session ? session.principalId : account.accountGuestId,
            tenantId: env.config.tenantId,
            phoneNumber,
          });
        } catch {
          await sendAccountPage(
            {
              phoneDraft: typed,
              phoneError: {
                code: "phone_save_failed",
                message: GUEST_ACCOUNT_COPY.errors.phoneSaveFailed,
              },
            },
            true,
          );
          return;
        }
        res.writeHead(303, {
          Location: "/account?notice=phone-saved",
          "Cache-Control": "no-store",
        });
        res.end();
        return;
      }
      if (path === "/account/email") {
        const typed = form.get("email") ?? "";
        let normalized: string;
        try {
          normalized = normalizeContactEmail(typed);
        } catch {
          await sendAccountPage(
            {
              emailDraft: typed,
              emailError: {
                code: "invalid_email",
                message: GUEST_ACCOUNT_COPY.errors.invalidEmail,
              },
            },
            true,
          );
          return;
        }
        if (normalized === status.account.email) {
          await sendAccountPage(
            {
              emailDraft: typed,
              emailError: {
                code: "same_email",
                message: GUEST_ACCOUNT_COPY.errors.sameEmail,
              },
            },
            true,
          );
          return;
        }
        try {
          const sent = await accounts.requestEmailChangeCode({
            credentials: credentials,
            accountGuestId: account.accountGuestId,
            email: normalized,
            clientAddress: accounts.clientAddress(req),
          });
          res.writeHead(200, ACCOUNT_PAGE_HEADERS);
          res.end(
            renderEmailChangeCodeHtml({
              newEmail: sent.email,
              challengeId: sent.challengeId,
              minutes,
            }),
          );
        } catch (error) {
          if (
            error instanceof GuestAccountAuthorityError &&
            error.code === "rate_limited"
          ) {
            sendAccountRateLimited(res, error.retryAfterSeconds ?? 1);
            return;
          }
          if (
            error instanceof GuestAccountAuthorityError &&
            error.code === "session_invalid"
          ) {
            sendPageError(req, res, 401, "AUTHENTICATION_REQUIRED", true);
            return;
          }
          // Q6: the same address is refused by the authority too; a race with the check above answers the same page, never a 500.
          if (
            error instanceof GuestAccountAuthorityError &&
            error.code === "invalid_input"
          ) {
            await sendAccountPage(
              {
                emailDraft: typed,
                emailError: {
                  code: "same_email",
                  message: GUEST_ACCOUNT_COPY.errors.sameEmail,
                },
              },
              true,
            );
            return;
          }
          if (error instanceof SignInDeliveryError) {
            await sendAccountPage(
              {
                emailDraft: typed,
                emailError: {
                  code: "send_failed",
                  message: GUEST_ACCOUNT_COPY.errors.sendFailed,
                },
              },
              true,
            );
            return;
          }
          throw error;
        }
        return;
      }
      // POST /account/email/code: the code sent to the new address must be entered before the account email changes (AC2).
      const newEmail = form.get("email") ?? "";
      const challengeId = form.get("challengeId") ?? "";
      const code = form.get("code") ?? "";
      try {
        normalizeContactEmail(newEmail);
      } catch {
        await sendAccountPage(
          {
            emailError: {
              code: "invalid_email",
              message: GUEST_ACCOUNT_COPY.errors.invalidEmail,
            },
          },
          true,
        );
        return;
      }
      try {
        await accounts.confirmEmailChange({
          credentials: credentials,
          accountGuestId: account.accountGuestId,
          challengeId,
          email: newEmail,
          code,
          clientAddress: accounts.clientAddress(req),
        });
      } catch (error) {
        if (!(error instanceof GuestAccountAuthorityError)) throw error;
        if (error.code === "rate_limited") {
          sendAccountRateLimited(res, error.retryAfterSeconds ?? 1);
          return;
        }
        if (error.code === "session_invalid") {
          sendPageError(req, res, 401, "AUTHENTICATION_REQUIRED", true);
          return;
        }
        if (error.code === "account_conflict") {
          await sendAccountPage(
            {
              emailError: {
                code: "email_in_use",
                message: GUEST_ACCOUNT_COPY.errors.emailInUse,
              },
            },
            true,
          );
          return;
        }
        res.writeHead(200, ACCOUNT_PAGE_HEADERS);
        res.end(
          renderEmailChangeCodeHtml({
            newEmail,
            challengeId,
            minutes,
            error: codeFormError(error.code),
          }),
        );
        return;
      }
      res.writeHead(303, {
        Location: "/account?notice=email-changed",
        "Cache-Control": "no-store",
      });
      res.end();
      return;
    }

    if (path === "/account/sign-out") {
      // Sign-out is never rate limited (orchestrator decision): the budget meters only code sends and new bindings.
      await accounts.signOut(credentials);
      const previous = await existingBrowserSession(req);
      if (previous === null) {
        // No presented session: nothing to rotate, so no binding is written and the account cookie is cleared.
        res.setHeader("Set-Cookie", clearedAccountCookieLine());
        res.writeHead(303, { Location: "/", "Cache-Control": "no-store" });
        res.end();
        return;
      }
      const interactionId = await replaceInteractionSession(
        previous,
        generatePlatformId("guest"),
        false,
      );
      res.setHeader("Set-Cookie", [
        interactionCookieLine(interactionId),
        clearedAccountCookieLine(),
      ]);
      res.writeHead(303, { Location: "/", "Cache-Control": "no-store" });
      res.end();
      return;
    }

    if (path === "/account/sign-out-everywhere") {
      const account = await accounts.resolveAccount(credentials);
      if (!account) {
        sendPageError(req, res, 401, "AUTHENTICATION_REQUIRED", true);
        return;
      }
      // ADR 0093 / ADR 0070: every account session ends, and so does the interaction authority of each Linked Principal.
      const presentedSession = await existingBrowserSession(req);
      const principals = await accounts.principalsOf(account.accountGuestId);
      await accounts.signOutEverywhere(account.accountGuestId);
      await env.guestData.deleteSessionBindingsForPrincipals(
        principals,
        account.tenantId,
      );
      for (const [key, cached] of browserSessions) {
        if (principals.includes(cached.principalId))
          browserSessions.delete(key);
      }
      if (presentedSession === null) {
        // No presented session: no binding is written and the account cookie is cleared.
        res.setHeader("Set-Cookie", clearedAccountCookieLine());
        res.writeHead(303, { Location: "/", "Cache-Control": "no-store" });
        res.end();
        return;
      }
      const interactionId = await replaceInteractionSession(
        presentedSession,
        generatePlatformId("guest"),
        false,
      );
      res.setHeader("Set-Cookie", [
        interactionCookieLine(interactionId),
        clearedAccountCookieLine(),
      ]);
      res.writeHead(303, { Location: "/", "Cache-Control": "no-store" });
      res.end();
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  };

  const dispatch = async (
    req: HttpRequestLike,
    res: HttpResponseLike,
  ): Promise<void> => {
    const url = new URL(
      req.url ?? "/",
      `http://${req.headers.host ?? "localhost"}`,
    );
    const rawSession = readGuestSession(req);
    let requestSession: BrowserSession | null = null;
    if (rawSession !== undefined && rawSession !== null) {
      requestSession = await resolveBrowserSession(
        env,
        browserSessions,
        rawSession,
        sessionScopedGuestPrincipals ? undefined : env.config.guestId,
        accountCredentialsOf(req),
        guestAccounts,
      );
      // Public pages and their static assets load for anyone, even with an expired or unknown session cookie.
      // A signed-out browser asking for the account page is sent to sign-in by the account route itself (issue 07 AC1).
      const accountPageRedirect =
        req.method === "GET" && url.pathname === "/account";
      if (
        !requestSession &&
        sessionScopedGuestPrincipals &&
        !PUBLIC_GUEST_PATHS.has(url.pathname) &&
        !url.pathname.startsWith("/stays/") &&
        !accountPageRedirect &&
        !reissuableBrowserRoute(req.method, url.pathname)
      ) {
        sendJson(res, 401, { ok: false, code: "AUTHENTICATION_REQUIRED" });
        return;
      }
    }
    // Every route that names an offer reads its stay and money details, so the
    // gate runs here, before any read. The refusal is the same for a missing offer and a foreign one.
    const offerRoute =
      /^\/(payments\/offers|conditional-offers)\/([^/]+)(\/|$)/.exec(
        url.pathname,
      );
    if (offerRoute && (req.method === "GET" || req.method === "POST")) {
      if (!requestSession) {
        sendPageError(req, res, 401, "AUTHENTICATION_REQUIRED");
        return;
      }
      let offerKey: string;
      try {
        offerKey = decodeURIComponent(offerRoute[2]!);
      } catch {
        sendPageError(req, res, 400, "INVALID_OFFER");
        return;
      }
      if (!offerAuthorized(env, requestSession, offerKey)) {
        // API clients keep their JSON refusal; a browser navigation gets the page with plain sign-in guidance.
        if (!prefersHtml(req.headers.accept)) {
          sendPageError(req, res, 404, "PAYMENT_OFFER_NOT_FOUND");
          return;
        }
        res.writeHead(404, GUEST_HTML_HEADERS);
        res.end(renderOfferNotFoundHtml());
        return;
      }
    }
    const requestRuntime = requestSession
      ? runtimeForSession(requestSession)
      : { environment: env, app: defaultApp };
    // This shadowed application is the same existing Guest application code,
    // selected by the server-owned browser session in production.
    const app = requestRuntime.app;

    if (url.pathname === "/account" || url.pathname.startsWith("/account/")) {
      await handleAccountRoute(req, res, url);
      return;
    }

    if (req.method === "POST" && url.pathname === "/welcome/start") {
      // Issue 14 / decision 13.1(a): the landing composers start a conversation. The message travels only in this body
      // (ADR-0075): it is never put in a URL, redirect or log line. Sending is discovery only (ADR-0005).
      if (!browserOriginAccepted(req, options.publicOrigin)) {
        res.writeHead(403);
        res.end("Origin rejected");
        return;
      }
      if (rawSession === null) {
        // A malformed session cookie is rejected, never silently replaced (as GET /).
        res.writeHead(401, { "Content-Type": "text/plain" });
        res.end("Unauthorized");
        return;
      }
      // Every page below can echo the typed message, so none may be cached.
      const LANDING_START_HTML_HEADERS = { ...GUEST_HTML_HEADERS, "Cache-Control": "no-store" };
      let form: URLSearchParams;
      try {
        form = await readFormBody(req);
      } catch {
        sendPageError(req, res, 400, "INVALID_CONVERSATION");
        return;
      }
      const text = form.get("message") ?? "";
      if (text.trim() === "" || text.length > MAX_TURN_TEXT_LENGTH) {
        // The composer's own validation; nothing is started and the text is kept.
        res.writeHead(400, LANDING_START_HTML_HEADERS);
        res.end(
          renderNoScriptConversationHtml({
            threadId: `g-${crypto.randomUUID()}`,
            timeline: [],
            surfaces: [],
            error: "Type a short message to send.",
            draft: text.slice(0, MAX_TURN_TEXT_LENGTH),
          }),
        );
        return;
      }
      let session = requestSession;
      const existingSession = session !== null;
      if (session === null) {
        // The same invite gate and session issuance as GET / (issue 22); the code arrives in the body.
        const offeredInvite = form.get("invite");
        if (
          options.betaInviteCode !== undefined &&
          (offeredInvite === null ||
            !betaInviteCodeMatches(offeredInvite, options.betaInviteCode))
        ) {
          res.writeHead(offeredInvite === null ? 200 : 403, LANDING_START_HTML_HEADERS);
          res.end(renderBetaInviteHtml(offeredInvite !== null, text));
          return;
        }
        const sessionId = issueGuestSession(res, secureCookie);
        session = await registerBrowserSession(
          env,
          browserSessions,
          sessionId,
          sessionScopedGuestPrincipals
            ? generatePlatformId("guest")
            : app.environment.config.guestId,
        );
      }
      const runtime = runtimeForSession(session);
      if (existingSession && form.get("startNew") !== "1") {
        // ADR-0079: offer the open conversation first. Nothing is started or withdrawn here.
        for (const openThreadId of [...session.threadIds].reverse()) {
          if (!(await threadReadable(runtime.environment, session, openThreadId)))
            continue;
          const openState = await runtime.app.getStateAsync(openThreadId);
          if (openState && openState.timeline.length > 0) {
            res.writeHead(200, LANDING_START_HTML_HEADERS);
            res.end(
              renderLandingContinueHtml(
                `/conversation?threadId=${encodeURIComponent(openThreadId)}`,
                text,
              ),
            );
            return;
          }
        }
      }
      const threadId = `g-${crypto.randomUUID()}`;
      session.threadIds.add(threadId);
      let failure: string | null = null;
      try {
        const result = await runtime.app.handleTurn(threadId, text);
        if (!result.ok) failure = result.message;
      } catch {
        failure = GUEST_CONTINUE_CONVERSATION.failed;
      }
      if (failure !== null) {
        // The message and the thread are kept: the composer here posts the retry to /conversation.
        const state = await runtime.app.getStateAsync(threadId);
        res.writeHead(422, LANDING_START_HTML_HEADERS);
        res.end(
          renderNoScriptConversationHtml({
            threadId,
            timeline: state?.timeline ?? [],
            surfaces: state?.surfaces ?? [],
            journey: state?.journey,
            tasks: state?.tasks,
            verticals: state?.verticals,
            error: failure,
            draft: text,
          }),
        );
        return;
      }
      // Post/redirect/get: refreshing the transcript never re-sends the message.
      res.writeHead(303, {
        Location: `/conversation?threadId=${encodeURIComponent(threadId)}`,
        "Cache-Control": "no-store",
      });
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/") {
      if (rawSession === null) {
        // A malformed session cookie is rejected, never silently replaced.
        res.writeHead(401, { "Content-Type": "text/plain" });
        res.end("Unauthorized");
        return;
      }
      if (requestSession === null) {
        // No cookie, or a well-formed cookie with no binding (retired by sign-out or sign-out everywhere, D3): a fresh,
        // unlinked session starts. Staging beta: no Guest session starts without the invite code (issue 22).
        const offeredInvite = url.searchParams.get("invite");
        if (
          options.betaInviteCode !== undefined &&
          (offeredInvite === null ||
            !betaInviteCodeMatches(offeredInvite, options.betaInviteCode))
        ) {
          res.writeHead(offeredInvite === null ? 200 : 403, GUEST_HTML_HEADERS);
          res.end(renderBetaInviteHtml(offeredInvite !== null));
          return;
        }
        const sessionId = issueGuestSession(res, secureCookie);
        let principalId = app.environment.config.guestId;
        if (sessionScopedGuestPrincipals)
          principalId = generatePlatformId("guest");
        const registered = await registerBrowserSession(
          env,
          browserSessions,
          sessionId,
          principalId,
        );
        if (sessionScopedGuestPrincipals) runtimeForSession(registered);
        if (options.betaInviteCode !== undefined) {
          // Drop the code from the address bar and history once the session exists.
          res.writeHead(303, { Location: "/", "Cache-Control": "no-store" });
          res.end();
          return;
        }
      } else {
        // A well-formed cookie must resolve to a durable binding; an unknown
        // id is rejected rather than silently minted into a new session.
        const resolved = await resolveBrowserSession(
          app.environment,
          browserSessions,
          rawSession,
          sessionScopedGuestPrincipals
            ? undefined
            : app.environment.config.guestId,
          accountCredentialsOf(req),
          guestAccounts,
        );
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
      try {
        artifact =
          filters === null
            ? null
            : app.environment.discoveryQuery.search(filters);
      } catch {
        artifact = null;
      }
      if (!artifact) {
        sendPageError(req, res, 400, "SEARCH_INVALID");
        return;
      }
      res.writeHead(200, GUEST_HTML_HEADERS);
      res.end(renderConventionalSearchHtml(artifact, options.localPhotoUrl, app.environment.config.demo === true));
      return;
    }

    const conventionalUnitMatch = /^\/stays\/([^/]+)$/.exec(url.pathname);
    if (req.method === "GET" && conventionalUnitMatch) {
      let unitId: string;
      try {
        unitId = decodeURIComponent(conventionalUnitMatch[1]!);
      } catch {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Invalid apartment");
        return;
      }
      const unit = app.environment.unitRepository.findById(unitId);
      if (!unit || !isEligibleUnit(unit, app.environment.clock())) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Apartment not found");
        return;
      }
      res.writeHead(200, GUEST_HTML_HEADERS);
      res.end(renderConventionalUnitDetailHtml(unit, options.localPhotoUrl, app.environment.config.demo === true, app.environment.extendedStayPolicy ? { policy: app.environment.extendedStayPolicy, now: app.environment.clock() } : undefined));
      return;
    }

    const requestPost =
      /^\/(booking-requests\/drafts|booking-requests)\/([^/]+)\/(review|submit|conversation|search)$/.exec(
        url.pathname,
      );
    if (req.method === "POST" && requestPost) {
      const session = await resolveBrowserSession(
        env,
        browserSessions,
        readGuestSession(req),
        sessionScopedGuestPrincipals
          ? undefined
          : app.environment.config.guestId,
        accountCredentialsOf(req),
        guestAccounts,
      );
      if (!session) {
        sendPageError(req, res, 401, "AUTHENTICATION_REQUIRED");
        return;
      }
      if (!browserOriginAccepted(req, options.publicOrigin)) {
        sendPageError(req, res, 403, "ORIGIN_REJECTED");
        return;
      }
      let id: string;
      try {
        id = decodeURIComponent(requestPost[2]!);
      } catch {
        sendPageError(req, res, 400, "INVALID_BOOKING_LINK");
        return;
      }
      const kind =
        requestPost[1] === "booking-requests/drafts" ? "draft" : "request";
      const principal: CommandPrincipal = {
        id: session.principalId,
        role: "guest",
        tenantId: session.tenantId,
      };
      const page = await app.conventionalBookingPage(kind, id, principal);
      if (!page) {
        sendPageError(req, res, 404, "BOOKING_RECORD_NOT_FOUND");
        return;
      }
      const action = requestPost[3];
      let destination: string | undefined;
      if (kind === "draft" && (action === "review" || action === "submit")) {
        let form: URLSearchParams;
        try {
          form = await readFormBody(req);
        } catch {
          sendPageError(req, res, 400, "INVALID_EVENT");
          return;
        }
        if (
          [...form.keys()].some((key) => key !== "surfaceId") ||
          form.getAll("surfaceId").length !== 1
        ) {
          sendPageError(req, res, 409, "STALE_SURFACE");
          return;
        }
        const result = await app.conventionalRequestAction(
          id,
          action,
          form.get("surfaceId") ?? "",
          principal,
        );
        if (!result.ok) {
          sendPageError(req, res, 409, result.code);
          return;
        }
        destination = result.surfaces.at(-1)?.conventionalRoute;
      } else if (kind === "request" && action === "conversation") {
        destination = `/conversation?threadId=${encodeURIComponent(page.threadId)}`;
      } else if (kind === "request" && action === "search") {
        destination =
          (await app.conventionalRequestSearch(id, principal)) ?? undefined;
      }
      if (!destination) {
        sendPageError(req, res, 409, "ACTION_NOT_AUTHORIZED");
        return;
      }
      res.writeHead(303, {
        Location: destination,
        "Cache-Control": "no-store",
      });
      res.end();
      return;
    }

    const offerPost =
      /^\/conditional-offers\/([^/]+)\/(accept|conversation|search)$/.exec(
        url.pathname,
      );
    if (req.method === "POST" && offerPost) {
      const session = await resolveBrowserSession(
        env,
        browserSessions,
        readGuestSession(req),
        sessionScopedGuestPrincipals
          ? undefined
          : app.environment.config.guestId,
        accountCredentialsOf(req),
        guestAccounts,
      );
      if (!session) {
        sendPageError(req, res, 401, "AUTHENTICATION_REQUIRED");
        return;
      }
      if (!browserOriginAccepted(req, options.publicOrigin)) {
        sendPageError(req, res, 403, "ORIGIN_REJECTED");
        return;
      }
      let id: string;
      try {
        id = decodeURIComponent(offerPost[1]!);
      } catch {
        sendPageError(req, res, 400, "INVALID_BOOKING_LINK");
        return;
      }
      const principal: CommandPrincipal = {
        id: session.principalId,
        role: "guest",
        tenantId: session.tenantId,
      };
      const page = await app.conventionalBookingPage("offer", id, principal);
      if (!page) {
        sendPageError(req, res, 404, "BOOKING_RECORD_NOT_FOUND");
        return;
      }
      let destination: string | null = null;
      if (offerPost[2] === "accept") {
        let form: URLSearchParams;
        try {
          form = await readFormBody(req);
        } catch {
          sendPageError(req, res, 400, "INVALID_EVENT");
          return;
        }
        if (
          [...form.keys()].some((key) => key !== "surfaceId") ||
          form.getAll("surfaceId").length !== 1
        ) {
          sendPageError(req, res, 409, "STALE_SURFACE");
          return;
        }
        const result = await app.conventionalOfferAccept(
          id,
          form.get("surfaceId") ?? "",
          principal,
        );
        if (!result.ok) {
          sendPageError(req, res, 409, result.code);
          return;
        }
        destination = conventionalCardPaymentRoute(id);
      } else if (offerPost[2] === "conversation")
        destination = `/conversation?threadId=${encodeURIComponent(page.threadId)}`;
      else destination = await app.conventionalOfferSearch(id, principal);
      if (!destination) {
        sendPageError(req, res, 409, "ACTION_NOT_AUTHORIZED");
        return;
      }
      res.writeHead(303, {
        Location: destination,
        "Cache-Control": "no-store",
      });
      res.end();
      return;
    }

    const bookingPageMatch =
      req.method === "GET" ? matchConventionalBookingRoute(url.pathname) : null;
    if (bookingPageMatch) {
      // ADR-0070/0080: booking records are never public. Unlike /stays/*,
      // these routes need the owner's browser session and re-check ownership.
      const session = await resolveBrowserSession(
        env,
        browserSessions,
        readGuestSession(req),
        sessionScopedGuestPrincipals
          ? undefined
          : app.environment.config.guestId,
        accountCredentialsOf(req),
        guestAccounts,
      );
      if (!session) {
        sendPageError(req, res, 401, "AUTHENTICATION_REQUIRED");
        return;
      }
      let recordId: string;
      try {
        recordId = decodeURIComponent(bookingPageMatch.encodedId);
      } catch {
        sendPageError(req, res, 400, "INVALID_BOOKING_LINK");
        return;
      }
      const principal: CommandPrincipal = {
        id: session.principalId,
        role: "guest",
        tenantId: session.tenantId,
      };
      const bookingPage = await app.conventionalBookingPage(
        bookingPageMatch.kind,
        recordId,
        principal,
      );
      if (!bookingPage) {
        sendPageError(req, res, 404, "BOOKING_RECORD_NOT_FOUND");
        return;
      }
      // Issue 08: the offer carries the Guest's contact email, so this response is never kept (ADR 0093).
      const signInOffer = isSentOrConfirmed(bookingPage)
        ? await signInOfferFor({
            accounts: guestAccounts,
            ownContacts: {
              find: (principalId, tenantId) =>
                env.guestData.findContact(principalId, tenantId),
            },
            principal,
            credentials: accountCredentialsOf(req),
            returnPath: url.pathname,
          })
        : undefined;
      res.writeHead(
        200,
        signInOffer === undefined
          ? GUEST_HTML_HEADERS
          : { ...GUEST_HTML_HEADERS, ...NO_STORE },
      );
      res.end(
        renderConventionalBookingHtml(
          signInOffer === undefined
            ? bookingPage
            : { ...bookingPage, signInOffer },
        ),
      );
      return;
    }

    const paymentPageMatch = /^\/payments\/offers\/([^/]+)$/.exec(url.pathname);
    if (req.method === "POST" && paymentPageMatch) {
      // Issue 09 AC2: one native method form. It only dispatches to the existing card continuation or transfer
      // route (ADR 0072, 0088); an unknown or missing method starts nothing.
      if (!browserOriginAccepted(req, options.publicOrigin)) {
        res.writeHead(403);
        res.end("Origin rejected");
        return;
      }
      const session = await resolveBrowserSession(
        env,
        browserSessions,
        readGuestSession(req),
        sessionScopedGuestPrincipals
          ? undefined
          : app.environment.config.guestId,
        accountCredentialsOf(req),
        guestAccounts,
      );
      if (!session) {
        sendPageError(req, res, 401, "AUTHENTICATION_REQUIRED");
        return;
      }
      let offerId: string;
      try {
        offerId = decodeURIComponent(paymentPageMatch[1]!);
      } catch {
        sendPageError(req, res, 400, "INVALID_OFFER");
        return;
      }
      const methods = new URLSearchParams(
        (await readRawBody(req)).toString("utf8"),
      ).getAll("method");
      const method = methods.length === 1 ? methods[0] : undefined;
      if (method !== "card" && method !== "bank_transfer") {
        sendPageError(req, res, 400, "PAYMENT_METHOD_INVALID");
        return;
      }
      const base = `/payments/offers/${encodeURIComponent(offerId)}`;
      // 307 keeps the POST, so bank transfer reaches its existing initialization route unchanged.
      res.writeHead(method === "card" ? 303 : 307, {
        Location: method === "card" ? `${base}/continue` : `${base}/transfer`,
      });
      res.end();
      return;
    }
    if (req.method === "GET" && paymentPageMatch) {
      const session = await resolveBrowserSession(
        env,
        browserSessions,
        readGuestSession(req),
        sessionScopedGuestPrincipals
          ? undefined
          : app.environment.config.guestId,
        accountCredentialsOf(req),
        guestAccounts,
      );
      if (!session) {
        sendPageError(req, res, 401, "AUTHENTICATION_REQUIRED");
        return;
      }
      let offerId: string;
      try {
        offerId = decodeURIComponent(paymentPageMatch[1]!);
      } catch {
        sendPageError(req, res, 400, "INVALID_OFFER");
        return;
      }
      try {
        const principal: CommandPrincipal = {
          id: session.principalId,
          role: "guest",
          tenantId: session.tenantId,
        };
        const artifact = app.environment.cardPaymentApp.getArtifact(
          offerId,
          principal,
        );
        if (
          app.environment.manualTransfers?.current(
            offerId,
            app.environment.clock(),
          )
        ) {
          res.writeHead(303, {
            Location: `/payments/offers/${encodeURIComponent(offerId)}/manual-transfer`,
          });
          res.end();
          return;
        }
        if (app.environment.bankTransferApp?.getSession(offerId)) {
          res.writeHead(303, {
            Location: `/payments/offers/${encodeURIComponent(offerId)}/transfer`,
          });
          res.end();
          return;
        }
        const processing =
          artifact.facts.journeyStage === "stay_payment_processing" ||
          artifact.facts.journeyStage === "deposit_payment_processing";
        const status = guestPaymentStatus(artifact.facts.status, processing);
        const contactEmailMissing = !(
          await app.environment.guestData.findContact(
            principal.id,
            principal.tenantId!,
          )
        )?.contactEmail;
        const threadId = await findGuestThreadForOffer(
          app.environment,
          offerId,
          principal,
          session.identity.principalIds,
        );
        const href =
          contactEmailMissing && artifact.facts.status === "ready"
            ? "/guest/contact?kind=email"
            : processing && threadId
              ? `/?threadId=${encodeURIComponent(threadId)}`
              : `/payments/offers/${encodeURIComponent(offerId)}/continue`;
        const label =
          contactEmailMissing && artifact.facts.status === "ready"
            ? "Add email address to continue"
            : processing
              ? "Return to booking status"
              : options.localPayment
                ? "Continue to local demo payment"
                : "Continue to hosted card checkout";
        const canContinue =
          artifact.actions.length > 0 &&
          (artifact.facts.status !== "ready" ||
            contactEmailMissing ||
            !processing);
        // P3: before any attempt, with an email on file, the Guest chooses the method (ADR 0088).
        const manualOffered =
          app.environment.manualTransfers?.isOffered(
            offerId,
            app.environment.clock(),
          ) === true;
        const offerTransferChoice =
          (app.environment.bankTransferApp !== null || manualOffered) &&
          artifact.facts.status === "ready" &&
          !contactEmailMissing &&
          !processing;
        const offerFacts = app.environment.conditionalOfferApp.getArtifact(
          offerId,
          principal,
        ).facts;
        const componentAmount =
          artifact.facts.currentComponentAmountKobo ??
          (artifact.facts.status === "ready"
            ? artifact.facts.allInStayTotalKobo
            : artifact.facts.refundableSecurityDepositKobo);
        const componentLabel =
          artifact.facts.status === "deposit_required" ||
          artifact.facts.currentComponent === "security_deposit"
            ? GUEST_GLOSSARY.refundableSecurityDeposit
            : "stay payment";
        const ticket = stayTicketHtml({
          unitTitle: artifact.facts.unit,
          checkIn: artifact.facts.checkIn,
          checkOut: artifact.facts.checkOut,
          nights:
            quotedNightCount(artifact.facts.checkIn, artifact.facts.checkOut) ??
            0,
          guestCount: offerFacts.occupants.length,
        });
        const breakdown = priceBreakdownHtml({
          ...(artifact.facts.allInStayTotalKobo === undefined
            ? {}
            : { allInStayTotalKobo: artifact.facts.allInStayTotalKobo }),
          ...(artifact.facts.refundableSecurityDepositKobo === undefined
            ? {}
            : {
                refundableSecurityDepositKobo:
                  artifact.facts.refundableSecurityDepositKobo,
              }),
          amountDueNowKobo: artifact.facts.amountDueNowKobo,
          ...(componentAmount === undefined
            ? {}
            : {
                next: `${componentLabel} · ${formatNgnKobo(componentAmount)}`,
              }),
        });
        const paymentPath = `/payments/offers/${encodeURIComponent(offerId)}`;
        const content = paymentScreenContent(
          artifact,
          app.environment.clock(),
          paymentPath,
          offerFacts.operatorName,
        );
        const choice = offerTransferChoice
          ? paymentChoiceHtml({
              action: paymentPath,
              providerTransfer: app.environment.bankTransferApp !== null,
              ...(manualOffered
                ? { manualAction: `${paymentPath}/manual-transfer` }
                : {}),
              amount: formatNgnKobo(
                componentAmount ?? artifact.facts.amountDueNowKobo,
              ),
              switching:
                app.environment.bankTransferApp !== null
                  ? `If you choose bank transfer, you can't switch to card until the transfer account expires.${manualOffered ? " The same applies to manual bank transfer." : ""}`
                  : "If you choose manual bank transfer, you can't switch to card until it expires or is declined.",
              manualCopy:
                "Manual bank transfer: pay our business account and upload your receipt. Your booking confirms only after we check the money has arrived.",
            })
          : undefined;
        res.writeHead(200, GUEST_HTML_HEADERS);
        res.end(
          pageShell({
            title: `${status.label} · Shortlet`,
            width: "narrow",
            frame: appFrameHtml(
              await threadFrame(
                app,
                offerId,
                principal,
                session.identity.principalIds,
              ),
            ),
            body: `<div class="guest-editorial">${paymentScreenHtml(content, ticket, breakdown, canContinue ? (choice !== undefined ? { sections: choice } : { actions: `<a class="ui-button ui-button--primary ui-button--block" href="${href}">${label}</a>` }) : {})}</div>`,
          }),
        );
      } catch {
        sendPageError(req, res, 404, "PAYMENT_OFFER_NOT_FOUND");
      }
      return;
    }

    // P5: manual bank transfer with receipt (ADR 0090). The receipt is evidence only; the back office confirms (B6).
    const manualMatch =
      /^\/payments\/offers\/([^/]+)\/manual-transfer(\/receipt)?$/.exec(
        url.pathname,
      );
    if (
      manualMatch &&
      (req.method === "POST" || (req.method === "GET" && !manualMatch[2]))
    ) {
      if (
        req.method === "POST" &&
        !browserOriginAccepted(req, options.publicOrigin)
      ) {
        res.writeHead(403);
        res.end("Origin rejected");
        return;
      }
      const session = await resolveBrowserSession(
        env,
        browserSessions,
        readGuestSession(req),
        sessionScopedGuestPrincipals
          ? undefined
          : app.environment.config.guestId,
        accountCredentialsOf(req),
        guestAccounts,
      );
      if (!session) {
        sendPageError(req, res, 401, "AUTHENTICATION_REQUIRED");
        return;
      }
      let offerId: string;
      try {
        offerId = decodeURIComponent(manualMatch[1]!);
      } catch {
        sendPageError(req, res, 400, "INVALID_OFFER");
        return;
      }
      const manual = app.environment.manualTransfers;
      if (!manual) {
        sendPageError(req, res, 404, "MANUAL_TRANSFER_UNAVAILABLE");
        return;
      }
      const principal: CommandPrincipal = {
        id: session.principalId,
        role: "guest",
        tenantId: session.tenantId,
      };
      let manualOffer: ReturnType<
        typeof app.environment.conditionalOfferApp.getOffer
      >;
      try {
        manualOffer = app.environment.conditionalOfferApp.getOffer(offerId);
      } catch {
        sendPageError(req, res, 404, "PAYMENT_OFFER_NOT_FOUND");
        return;
      }
      const payerId =
        manualOffer.parties.distinctPayer?.id ??
        manualOffer.parties.primaryGuest.id;
      if (
        !principal.id ||
        principal.id !== payerId ||
        !principal.tenantId ||
        principal.tenantId !== manualOffer.tenantId
      ) {
        sendPageError(req, res, 404, "PAYMENT_OFFER_NOT_FOUND");
        return;
      }
      const manualPage = `/payments/offers/${encodeURIComponent(offerId)}/manual-transfer`;
      const receiptMaxBytes =
        app.environment.config.receiptMaxBytes ?? DEFAULT_RECEIPT_MAX_BYTES;
      const render = async (status: number, error = "") => {
        const transfer = manual.current(offerId, app.environment.clock());
        if (!transfer) {
          res.writeHead(303, {
            Location: `/payments/offers/${encodeURIComponent(offerId)}`,
          });
          res.end();
          return;
        }
        const paymentFacts = app.environment.cardPaymentApp.getArtifact(
          offerId,
          principal,
        ).facts;
        res.writeHead(status, GUEST_HTML_HEADERS);
        const offerFacts = app.environment.conditionalOfferApp.getArtifact(
          offerId,
          principal,
        ).facts;
        res.end(
          renderManualTransferPageHtml({
            transfer,
            now: app.environment.clock(),
            receiptMaxBytes,
            error,
            ...(await threadFrame(
              app,
              offerId,
              principal,
              session.identity.principalIds,
            )),
            contractId:
              transfer.decision?.kind === "confirmed"
                ? transfer.decision.contractId
                : null,
            stay: {
              unitTitle: paymentFacts.unit,
              checkIn: paymentFacts.checkIn,
              checkOut: paymentFacts.checkOut,
              nights:
                quotedNightCount(paymentFacts.checkIn, paymentFacts.checkOut) ??
                0,
              guestCount: offerFacts.occupants.length,
            },
            ...(paymentFacts.allInStayTotalKobo === undefined
              ? {}
              : { allInStayTotalKobo: paymentFacts.allInStayTotalKobo }),
            ...(paymentFacts.refundableSecurityDepositKobo === undefined
              ? {}
              : {
                  refundableSecurityDepositKobo:
                    paymentFacts.refundableSecurityDepositKobo,
                }),
          }),
        );
      };
      if (req.method === "GET") {
        await render(200);
        return;
      }
      if (!manualMatch[2]) {
        try {
          manual.start(
            createManualTransferCommand({
              commandName: "manual_transfer.start",
              principal,
              payload: { offerId },
            }),
            app.environment.clock,
          );
        } catch {
          sendPageError(req, res, 409, "MANUAL_TRANSFER_REJECTED");
          return;
        }
        res.writeHead(303, { Location: manualPage });
        res.end();
        return;
      }
      // Receipt upload: a bounded body, one file field; nothing is stored on any refusal (ADR 0075, 0090).
      const boundary = multipartBoundary(req.headers["content-type"]);
      const declared = Number(req.headers["content-length"] ?? "0");
      const bodyLimit = receiptMaxBytes + 16 * 1024;
      if (!boundary) {
        req.resume();
        await render(400, "Choose a receipt file to upload.");
        return;
      }
      if (Number.isFinite(declared) && declared > bodyLimit) {
        req.resume();
        await render(
          413,
          "That file is too large. Upload a smaller photo or PDF of your receipt.",
        );
        return;
      }
      let body: Buffer;
      try {
        body = await readBoundedBody(req, bodyLimit);
      } catch {
        await render(
          413,
          "That file is too large. Upload a smaller photo or PDF of your receipt.",
        );
        return;
      }
      let bytes: Buffer | null;
      try {
        bytes = multipartFile(body, boundary, "receipt");
      } catch {
        await render(
          400,
          "The upload could not be read. Choose your receipt file again.",
        );
        return;
      }
      try {
        await manual.uploadReceipt(
          createManualTransferCommand({
            commandName: "manual_transfer.upload_receipt",
            principal,
            payload: { offerId },
          }),
          { bytes: bytes ?? Buffer.alloc(0) },
          app.environment.clock,
        );
      } catch (error) {
        const problem =
          error instanceof ManualTransferError ? error.problem : "no_transfer";
        const message =
          problem === "receipt_type_not_allowed"
            ? "Upload a photo (JPEG or PNG) or a PDF of your receipt."
            : problem === "receipt_too_large"
              ? "That file is too large. Upload a smaller photo or PDF of your receipt."
              : problem === "receipt_empty"
                ? "Choose a receipt file to upload."
                : problem === "payment_window_closed"
                  ? "The deadline has passed, so the receipt was not accepted. No Reservation was made."
                  : problem === "receipt_already_uploaded"
                    ? "Your receipt was already received."
                    : "The receipt was not accepted. No payment was recorded.";
        await render(
          problem === "receipt_too_large"
            ? 413
            : problem === "payment_window_closed" ||
                problem === "receipt_already_uploaded" ||
                problem === "no_transfer" ||
                problem === "not_payer"
              ? 409
              : 400,
          message,
        );
        return;
      }
      res.writeHead(303, { Location: manualPage });
      res.end();
      return;
    }

    // P3: the Guest chooses bank transfer (ADR 0088). Server-owned: the offer, amount and reference never come from the browser.
    const transferMatch = /^\/payments\/offers\/([^/]+)\/transfer$/.exec(
      url.pathname,
    );
    if (transferMatch && (req.method === "POST" || req.method === "GET")) {
      if (
        req.method === "POST" &&
        !browserOriginAccepted(req, options.publicOrigin)
      ) {
        res.writeHead(403);
        res.end("Origin rejected");
        return;
      }
      const session = await resolveBrowserSession(
        env,
        browserSessions,
        readGuestSession(req),
        sessionScopedGuestPrincipals
          ? undefined
          : app.environment.config.guestId,
        accountCredentialsOf(req),
        guestAccounts,
      );
      if (!session) {
        sendPageError(req, res, 401, "AUTHENTICATION_REQUIRED");
        return;
      }
      let offerId: string;
      try {
        offerId = decodeURIComponent(transferMatch[1]!);
      } catch {
        sendPageError(req, res, 400, "INVALID_OFFER");
        return;
      }
      const transfers = app.environment.bankTransferApp;
      if (!transfers) {
        sendPageError(req, res, 404, "TRANSFER_UNAVAILABLE");
        return;
      }
      const principal: CommandPrincipal = {
        id: session.principalId,
        role: "guest",
        tenantId: session.tenantId,
      };
      let transferOffer: ReturnType<
        typeof app.environment.conditionalOfferApp.getOffer
      >;
      try {
        transferOffer = app.environment.conditionalOfferApp.getOffer(offerId);
      } catch {
        sendPageError(req, res, 404, "PAYMENT_OFFER_NOT_FOUND");
        return;
      }
      const payerId =
        transferOffer.parties.distinctPayer?.id ??
        transferOffer.parties.primaryGuest.id;
      if (
        !principal.id ||
        principal.id !== payerId ||
        !principal.tenantId ||
        principal.tenantId !== transferOffer.tenantId
      ) {
        sendPageError(req, res, 404, "PAYMENT_OFFER_NOT_FOUND");
        return;
      }
      const transferPage = `/payments/offers/${encodeURIComponent(offerId)}/transfer`;
      if (req.method === "POST") {
        try {
          await transfers.initializeTransfer(offerId, principal);
        } catch (error) {
          sendPageError(
            req,
            res,
            409,
            error instanceof BankTransferProviderError
              ? "TRANSFER_UNAVAILABLE"
              : "TRANSFER_REJECTED",
          );
          return;
        }
        res.writeHead(303, { Location: transferPage });
        res.end();
        return;
      }
      const transfer = transfers.getSession(offerId);
      if (!transfer) {
        res.writeHead(303, {
          Location: `/payments/offers/${encodeURIComponent(offerId)}`,
        });
        res.end();
        return;
      }
      const paymentFacts = app.environment.cardPaymentApp.getArtifact(
        offerId,
        principal,
      ).facts;
      const offerFacts = app.environment.conditionalOfferApp.getArtifact(
        offerId,
        principal,
      ).facts;
      res.writeHead(200, GUEST_HTML_HEADERS);
      res.end(
        renderTransferPageHtml({
          transfer,
          now: app.environment.clock(),
          contract: transfers.getBookingContract(offerId) ?? null,
          ...(await threadFrame(
            app,
            offerId,
            principal,
            session.identity.principalIds,
          )),
          localPayment: options.localPayment === true,
          stay: {
            unitTitle: paymentFacts.unit,
            checkIn: paymentFacts.checkIn,
            checkOut: paymentFacts.checkOut,
            nights:
              quotedNightCount(paymentFacts.checkIn, paymentFacts.checkOut) ??
              0,
            guestCount: offerFacts.occupants.length,
          },
          ...(paymentFacts.allInStayTotalKobo === undefined
            ? {}
            : { allInStayTotalKobo: paymentFacts.allInStayTotalKobo }),
          ...(paymentFacts.refundableSecurityDepositKobo === undefined
            ? {}
            : {
                refundableSecurityDepositKobo:
                  paymentFacts.refundableSecurityDepositKobo,
              }),
          amountDueNowKobo: paymentFacts.amountDueNowKobo,
        }),
      );
      return;
    }

    if (
      options.localPayment &&
      req.method === "POST" &&
      url.pathname === "/payments/local/transfer/complete"
    ) {
      // Local pilot only: plays the Guest's bank sending the exact amount to the local provider's account.
      if (!browserOriginAccepted(req, options.publicOrigin)) {
        res.writeHead(403);
        res.end("Origin rejected");
        return;
      }
      const session = await resolveBrowserSession(
        env,
        browserSessions,
        readGuestSession(req),
        sessionScopedGuestPrincipals
          ? undefined
          : app.environment.config.guestId,
        accountCredentialsOf(req),
        guestAccounts,
      );
      if (!session) {
        sendJson(res, 401, { ok: false, code: "AUTHENTICATION_REQUIRED" });
        return;
      }
      const reference =
        new URLSearchParams((await readRawBody(req)).toString("utf8")).get(
          "reference",
        ) ?? "";
      const transfers = app.environment.bankTransferApp;
      const transfer =
        reference && transfers
          ? transfers.getSessionByReference(reference)
          : undefined;
      if (!transfers || !transfer) {
        sendJson(res, 400, { ok: false, code: "LOCAL_PAYMENT_INVALID" });
        return;
      }
      const localOffer = app.environment.conditionalOfferApp.getOffer(
        transfer.offerId,
      );
      if (
        session.principalId !==
          (localOffer.parties.distinctPayer?.id ??
            localOffer.parties.primaryGuest.id) ||
        session.tenantId !== localOffer.tenantId
      ) {
        sendJson(res, 400, { ok: false, code: "LOCAL_PAYMENT_INVALID" });
        return;
      }
      try {
        await transfers.verifyAndProcessFromProvider(
          reference,
          app.environment.systemPrincipal(),
        );
      } catch {
        /* the authoritative state is re-read on the transfer page */
      }
      res.writeHead(303, {
        Location: `/payments/offers/${encodeURIComponent(transfer.offerId)}/transfer`,
      });
      res.end();
      return;
    }

    const continuationMatch = /^\/payments\/offers\/([^/]+)\/continue$/.exec(
      url.pathname,
    );
    if (req.method === "GET" && continuationMatch) {
      // ADR-0087: payment initialization is a server-owned continuation, not
      // a browser-selected amount, currency, reference, callback, or URL.
      const session = await resolveBrowserSession(
        env,
        browserSessions,
        readGuestSession(req),
        sessionScopedGuestPrincipals
          ? undefined
          : app.environment.config.guestId,
        accountCredentialsOf(req),
        guestAccounts,
      );
      if (!session) {
        sendPageError(req, res, 401, "AUTHENTICATION_REQUIRED");
        return;
      }
      let offerId: string;
      try {
        offerId = decodeURIComponent(continuationMatch[1]!);
      } catch {
        sendPageError(req, res, 400, "INVALID_OFFER");
        return;
      }
      const openManual = app.environment.manualTransfers?.current(
        offerId,
        app.environment.clock(),
      );
      if (
        openManual &&
        (openManual.status === "awaiting_receipt" ||
          openManual.status === "awaiting_verification")
      ) {
        sendPageError(req, res, 409, "MANUAL_TRANSFER_IN_PROGRESS");
        return;
      }
      const liveTransfer = app.environment.bankTransferApp?.getSession(offerId);
      if (
        liveTransfer &&
        (liveTransfer.status === "initiated" ||
          liveTransfer.status === "processing_in_grace") &&
        app.environment.clock().getTime() < Date.parse(liveTransfer.graceEndsAt)
      ) {
        // ADR 0046/0088: a transfer that can still be paid holds the one Live Payment Attempt; no switch to card.
        sendPageError(req, res, 409, "TRANSFER_IN_PROGRESS");
        return;
      }
      try {
        // ADR 0087: refresh authoritative remote contact before the synchronous payment domain read.
        if (app.environment.guestDataIsRemote && app.environment.remoteGuestContacts) {
          app.environment.remoteGuestContacts.hydrate(
            await app.environment.guestData.findContact(session.principalId, session.tenantId),
          );
        }
        const principal: CommandPrincipal = {
          id: session.principalId,
          role: "guest",
          tenantId: session.tenantId,
        };
        if (options.localPayment) {
          app.environment.cardPaymentApp.getArtifact(offerId, principal);
          const checkout =
            app.environment.cardPaymentApp.getCheckoutSession(offerId) ??
            app.environment.cardPaymentApp.initializeCheckout(
              offerId,
              principal,
            );
          res.writeHead(303, {
            Location: `/payments/local/checkout?reference=${encodeURIComponent(checkout.pspReference)}`,
          });
          res.end();
          return;
        }
        if (!payments) {
          sendPageError(req, res, 503, "PAYSTACK_UNAVAILABLE");
          return;
        }
        const checkout =
          await app.environment.cardPaymentApp.initializePaystackCheckout(
            offerId,
            principal,
            payments,
          );
        if (!isApprovedPaystackCheckoutUrl(checkout.checkoutUrl)) {
          sendPageError(req, res, 502, "INVALID_CHECKOUT_URL");
          return;
        }
        res.writeHead(303, { Location: checkout.checkoutUrl });
        res.end();
      } catch (error) {
        const reason = paymentContinuationRejectionReason(error);
        const statusClass = reason === "provider_start_failed" ? paymentContinuationProviderStatusClass(error) : undefined;
        options.onPaymentContinuationRejected?.({
          code: "PAYMENT_CONTINUATION_REJECTED",
          reason,
          ...(statusClass === undefined ? {} : { statusClass }),
        });
        sendPageError(req, res, 400, "PAYMENT_CONTINUATION_REJECTED");
      }
      return;
    }

    if (
      options.localPayment &&
      req.method === "GET" &&
      url.pathname === "/payments/local/checkout"
    ) {
      const session = await resolveBrowserSession(
        env,
        browserSessions,
        readGuestSession(req),
        sessionScopedGuestPrincipals
          ? undefined
          : app.environment.config.guestId,
        accountCredentialsOf(req),
        guestAccounts,
      );
      const reference = url.searchParams.get("reference");
      const checkout = reference
        ? app.environment.cardPaymentApp.getCheckoutSessionByReference(
            reference,
          )
        : null;
      if (!session || !reference || !checkout) {
        sendPageError(req, res, 400, "LOCAL_PAYMENT_INVALID");
        return;
      }
      res.writeHead(200, GUEST_HTML_HEADERS);
      res.end(
        pageShell({
          title: "Local demo payment",
          width: "narrow",
          body: `<header class="ui-page__header"><p class="ui-eyebrow">Local pilot only</p><h1>Local demo payment</h1><p>This deterministic local provider verifies the authoritative amount without collecting card details.</p></header><form class="ui-panel" method="post" action="/payments/local/complete"><input type="hidden" name="reference" value="${reference.replace(/[&<>'"]/g, "")}"><button class="ui-button ui-button--primary ui-button--block" type="submit">Complete local payment</button></form>`,
        }),
      );
      return;
    }

    if (
      options.localPayment &&
      req.method === "POST" &&
      url.pathname === "/payments/local/complete"
    ) {
      if (!browserOriginAccepted(req, options.publicOrigin)) {
        res.writeHead(403);
        res.end("Origin rejected");
        return;
      }
      const session = await resolveBrowserSession(
        env,
        browserSessions,
        readGuestSession(req),
        sessionScopedGuestPrincipals
          ? undefined
          : app.environment.config.guestId,
        accountCredentialsOf(req),
        guestAccounts,
      );
      if (!session) {
        sendJson(res, 401, { ok: false, code: "AUTHENTICATION_REQUIRED" });
        return;
      }
      const params = new URLSearchParams(
        (await readRawBody(req)).toString("utf8"),
      );
      const reference = params.get("reference");
      const checkout = reference
        ? app.environment.cardPaymentApp.getCheckoutSessionByReference(
            reference,
          )
        : null;
      if (!reference || !checkout) {
        sendJson(res, 400, { ok: false, code: "LOCAL_PAYMENT_INVALID" });
        return;
      }
      const principal: CommandPrincipal = {
        id: session.principalId,
        role: "guest",
        tenantId: session.tenantId,
      };
      try {
        const offer = app.environment.conditionalOfferApp.getOffer(
          checkout.offerId,
        );
        const expectedPayerId =
          offer.parties.distinctPayer?.id ?? offer.parties.primaryGuest.id;
        if (
          !principal.id ||
          principal.id !== expectedPayerId ||
          !principal.tenantId ||
          principal.tenantId !== offer.tenantId
        )
          throw new Error("Local payment is not authorized for this Guest");
        app.environment.cardPaymentApp.getArtifact(checkout.offerId, principal);
        const threadId = await findGuestThreadForOffer(
          app.environment,
          checkout.offerId,
          principal,
          session.identity.principalIds,
        );
        if (!threadId) throw new Error("Local payment thread is unavailable");
        app.environment.cardPaymentApp.verifyAndConfirm(
          reference,
          app.environment.systemPrincipal(),
        );
        res.writeHead(303, {
          Location: `/?threadId=${encodeURIComponent(threadId)}`,
        });
        res.end();
      } catch {
        sendJson(res, 400, { ok: false, code: "LOCAL_PAYMENT_REJECTED" });
      }
      return;
    }

    // Demo-launch issue 12 AC4 (ADR 0092): a Guest's later Billing Period schedule, and a separate Paystack TEST session
    // for one period. The schedule shows what is payable now; it never shows a future period as paid.
    const periodPageMatch = /^\/bookings\/periods\/([^/]+)$/.exec(url.pathname);
    const periodStartMatch = /^\/payments\/periods\/([^/]+)\/(\d+)$/.exec(url.pathname);
    if ((periodPageMatch && req.method === "GET") || (periodStartMatch && req.method === "POST")) {
      const offerId = decodeURIComponent((periodPageMatch ?? periodStartMatch)![1]!);
      const session = await resolveBrowserSession(
        env,
        browserSessions,
        readGuestSession(req),
        sessionScopedGuestPrincipals ? undefined : app.environment.config.guestId,
        accountCredentialsOf(req),
        guestAccounts,
      );
      if (!session) {
        sendJson(res, 401, { ok: false, code: "GUEST_SESSION_REQUIRED" });
        return;
      }
      const principal: CommandPrincipal = { id: session.principalId, role: "guest", tenantId: session.tenantId };
      try {
        // getArtifact throws unless this Guest owns the offer (ADR 0087 binding of references to the Guest).
        app.environment.cardPaymentApp.getArtifact(offerId, principal);
        if (periodPageMatch) {
          const periods = app.environment.cardPaymentApp.projectBillingPeriods(offerId);
          // Render before the headers are written: a failure here must still reach the catch below as a 400.
          const html = renderPeriodScheduleHtml(offerId, periods);
          res.writeHead(200, GUEST_HTML_HEADERS);
          res.end(html);
          return;
        }
        if (!payments) {
          sendJson(res, 503, { ok: false, code: "PAYSTACK_UNAVAILABLE" });
          return;
        }
        // ADR 0087: refresh authoritative remote contact before the synchronous period domain read.
        if (app.environment.guestDataIsRemote && app.environment.remoteGuestContacts) {
          app.environment.remoteGuestContacts.hydrate(await app.environment.guestData.findContact(session.principalId, session.tenantId));
        }
        const started = await app.environment.cardPaymentApp.initializePeriodPaystackCheckout(
          offerId,
          Number(periodStartMatch![2]),
          principal,
          payments,
        );
        if (!isApprovedPaystackCheckoutUrl(started.authorizationUrl)) {
          sendPageError(req, res, 502, "INVALID_CHECKOUT_URL");
          return;
        }
        res.writeHead(303, { Location: started.authorizationUrl });
        res.end();
      } catch {
        sendJson(res, 400, { ok: false, code: "PERIOD_PAYMENT_REJECTED" });
      }
      return;
    }

    if (
      req.method === "GET" &&
      url.pathname === "/payments/paystack/callback"
    ) {
      // ADR-0087: a callback is only a return signal; verification below is
      // the sole path allowed to advance the existing payment transition.
      if (!payments) {
        sendJson(res, 503, { ok: false, code: "PAYSTACK_UNAVAILABLE" });
        return;
      }
      const session = await resolveBrowserSession(
        env,
        browserSessions,
        readGuestSession(req),
        sessionScopedGuestPrincipals
          ? undefined
          : app.environment.config.guestId,
        accountCredentialsOf(req),
        guestAccounts,
      );
      const reference = url.searchParams.get("reference");
      if (!session || !reference) {
        sendJson(res, 400, { ok: false, code: "PAYMENT_CALLBACK_INVALID" });
        return;
      }
      const checkout =
        app.environment.cardPaymentApp.getCheckoutSessionByReference(reference);
      // Demo-launch issue 12 AC4: a later Billing Period's own session verifies through the period path, then returns to its schedule.
      const periodOfferId = checkout ? undefined : app.environment.cardPaymentApp.periodOfferIdForReference(reference);
      if (!checkout && periodOfferId !== undefined) {
        try {
          const periodOffer = app.environment.conditionalOfferApp.getOffer(periodOfferId);
          const expectedPayerId = periodOffer.parties.distinctPayer?.id ?? periodOffer.parties.primaryGuest.id;
          if (!session.principalId || session.principalId !== expectedPayerId || !session.tenantId || !periodOffer.tenantId || session.tenantId !== periodOffer.tenantId)
            throw new Error("Payment callback is not authorized for this Guest");
          await app.environment.cardPaymentApp.verifyAndConfirmPaystack(reference, app.environment.systemPrincipal(), payments);
          res.writeHead(303, { Location: `/bookings/periods/${encodeURIComponent(periodOfferId)}` });
          res.end();
        } catch {
          sendJson(res, 400, { ok: false, code: "PERIOD_PAYMENT_CALLBACK_REJECTED" });
        }
        return;
      }
      if (!checkout) {
        sendJson(res, 400, { ok: false, code: "PAYMENT_CALLBACK_UNKNOWN" });
        return;
      }
      const principal: CommandPrincipal = {
        id: session.principalId,
        role: "guest",
        tenantId: session.tenantId,
      };
      try {
        // Resolving the artifact first binds the provider reference to the
        // authenticated Guest and tenant before any server verification.
        const callbackOffer = app.environment.conditionalOfferApp.getOffer(
          checkout.offerId,
        );
        const expectedPayerId =
          callbackOffer.parties.distinctPayer?.id ??
          callbackOffer.parties.primaryGuest.id;
        if (
          !principal.id ||
          principal.id !== expectedPayerId ||
          !principal.tenantId ||
          !callbackOffer.tenantId ||
          principal.tenantId !== callbackOffer.tenantId
        )
          throw new Error("Payment callback is not authorized for this Guest");
        app.environment.cardPaymentApp.getArtifact(checkout.offerId, principal);
        const threadId = await findGuestThreadForOffer(
          app.environment,
          checkout.offerId,
          principal,
          session.identity.principalIds,
        );
        if (!threadId) {
          sendJson(res, 404, {
            ok: false,
            code: "PAYMENT_CALLBACK_THREAD_UNKNOWN",
          });
          return;
        }
        await app.environment.cardPaymentApp.verifyAndConfirmPaystack(
          reference,
          app.environment.systemPrincipal(),
          payments,
        );
        res.writeHead(303, {
          Location: `/?threadId=${encodeURIComponent(threadId)}`,
        });
        res.end();
      } catch {
        const threadId = await findGuestThreadForOffer(
          app.environment,
          checkout.offerId,
          principal,
          session.identity.principalIds,
        );
        if (threadId) {
          res.writeHead(303, {
            Location: `/?threadId=${encodeURIComponent(threadId)}`,
          });
          res.end();
        } else
          sendJson(res, 400, {
            ok: false,
            code: "PAYMENT_CALLBACK_REJECTED",
          });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/webhooks/paystack") {
      // ADR-0087: the platform Payments module validates the raw signed body before parsing event meaning.
      if (!payments) {
        sendJson(res, 503, { ok: false, code: "PAYSTACK_UNAVAILABLE" });
        return;
      }
      try {
        const rawBody = await readRawBody(req);
        const outcome = await payments.handleWebhook({
          rawBody,
          signature:
            typeof req.headers["x-paystack-signature"] === "string"
              ? req.headers["x-paystack-signature"]
              : undefined,
        });
        if (outcome.kind === "invalid-signature") {
          sendJson(res, 401, {
            ok: false,
            code: "INVALID_WEBHOOK_SIGNATURE",
          });
          return;
        }
        if (outcome.kind === "invalid") {
          sendJson(res, 400, { ok: false, code: "INVALID_WEBHOOK" });
          return;
        }
        if (outcome.kind === "ignored") {
          sendJson(res, 200, { ok: true, ignored: true });
          return;
        }
        const reference = outcome.reference;
        const checkout =
          app.environment.cardPaymentApp.getCheckoutSessionByReference(
            reference,
          );
        if (!checkout) {
          // P2: a Pay with Transfer reference. The signed event is only a prompt; the server re-verifies with
          // Paystack and processes once (ADR 0047). Late money is recorded for a full refund (ADR 0045).
          const transfers = app.environment.bankTransferApp;
          if (!transfers?.getSessionByReference(reference)) {
            sendJson(res, 200, { ok: true, ignored: true });
            return;
          }
          try {
            await transfers.verifyAndProcessFromProvider(
              reference,
              app.environment.systemPrincipal(),
            );
          } catch {
            /* the authoritative unresolved/failed state is retained */
          }
          sendJson(res, 200, { ok: true });
          return;
        }
        try {
          await app.environment.cardPaymentApp.verifyAndConfirmPaystack(
            reference,
            app.environment.systemPrincipal(),
            payments,
          );
        } catch {
          /* the authoritative unresolved/failed state is retained */
        }
        sendJson(res, 200, { ok: true });
      } catch (error) {
        sendJson(res, error instanceof BodyTooLargeError ? 413 : 400, {
          ok: false,
          code:
            error instanceof BodyTooLargeError
              ? "BODY_TOO_LARGE"
              : "INVALID_WEBHOOK",
        });
      }
      return;
    }

    if (
      url.pathname === "/guest/contact" ||
      url.pathname === "/guest/contact/phone" ||
      url.pathname === "/guest/contact/email"
    ) {
      const session = await resolveBrowserSession(
        env,
        browserSessions,
        readGuestSession(req),
        sessionScopedGuestPrincipals
          ? undefined
          : app.environment.config.guestId,
        accountCredentialsOf(req),
        guestAccounts,
      );
      if (!session) {
        res.writeHead(401, { "Content-Type": "text/plain" });
        res.end("Unauthorized");
        return;
      }
      const contactPrincipal: CommandPrincipal = {
        id: session.principalId,
        role: "guest",
        tenantId: session.tenantId,
      };
      if (req.method === "GET" && url.pathname === "/guest/contact") {
        const kind = url.searchParams.get("kind");
        const requestedKind =
          kind === "phone" || kind === "email" ? kind : "both";
        res.writeHead(200, GUEST_HTML_HEADERS);
        res.end(
          renderGuestContactHtml(
            await app.environment.guestData.findContact(
              contactPrincipal.id,
              contactPrincipal.tenantId!,
            ),
            "",
            requestedKind,
          ),
        );
        return;
      }
      if (req.method === "POST") {
        if (!browserOriginAccepted(req, options.publicOrigin)) {
          res.writeHead(403);
          res.end("Origin rejected");
          return;
        }
        let submittedValue = "";
        const contactKind = url.pathname.endsWith("/phone") ? "phone" : "email";
        try {
          const form = await readFormBody(req);
          const expectedRevision = Number(form.get("expectedRevision"));
          if (contactKind === "phone") {
            submittedValue = form.get("phoneNumber") ?? "";
            await app.environment.guestData.savePhone({
              guestId: contactPrincipal.id,
              tenantId: contactPrincipal.tenantId!,
              phoneNumber: submittedValue,
              ...(Number.isInteger(expectedRevision)
                ? { expectedRevision }
                : {}),
            });
          } else {
            submittedValue = form.get("contactEmail") ?? "";
            await app.environment.guestData.saveEmail({
              guestId: contactPrincipal.id,
              tenantId: contactPrincipal.tenantId!,
              contactEmail: submittedValue,
              ...(Number.isInteger(expectedRevision)
                ? { expectedRevision }
                : {}),
            });
          }
          res.writeHead(303, { Location: "/guest/contact" });
          res.end();
          return;
        } catch (error) {
          res.writeHead(400, GUEST_HTML_HEADERS);
          res.end(
            renderGuestContactHtml(
              await app.environment.guestData.findContact(
                contactPrincipal.id,
                contactPrincipal.tenantId!,
              ),
              error instanceof GuestContactOwnedByAccountError
                ? GUEST_ACCOUNT_COPY.errors.emailOwnedByAccount
                : error instanceof Error
                  ? error.message
                  : "Contact could not be saved",
              contactKind,
              contactKind === "phone"
                ? { phoneNumber: submittedValue }
                : { contactEmail: submittedValue },
            ),
          );
          return;
        }
      }
    }

    if (
      url.pathname === "/conversation" &&
      (req.method === "GET" || req.method === "POST")
    ) {
      // Issue 06c / ADR-0080: the composer works without JavaScript. The turn
      // runs through the same handleTurn as /api/turn, and the browser session
      // must own the thread (ADR-0070). Message text is never logged (ADR-0075).
      const session = await resolveBrowserSession(
        env,
        browserSessions,
        readGuestSession(req),
        sessionScopedGuestPrincipals
          ? undefined
          : app.environment.config.guestId,
        accountCredentialsOf(req),
        guestAccounts,
      );
      if (req.method === "GET") {
        if (!session) {
          sendPageError(req, res, 401, "AUTHENTICATION_REQUIRED");
          return;
        }
        // Issue 13a: no thread id starts a new, empty conversation. Only an id
        // is minted; nothing is written and no earlier work changes (ADR-0079).
        if (!url.searchParams.has("threadId")) {
          res.writeHead(303, {
            Location: `/conversation?threadId=${encodeURIComponent(`g-${crypto.randomUUID()}`)}`,
          });
          res.end();
          return;
        }
        const threadId = url.searchParams.get("threadId") ?? "";
        if (!THREAD_ID_PATTERN.test(threadId)) {
          sendPageError(req, res, 400, "INVALID_CONVERSATION");
          return;
        }
        const state = (await threadReadable(app.environment, session, threadId))
          ? await app.getStateAsync(threadId)
          : undefined;
        const committedWork = await app.committedWork(
          {
            id: session.principalId,
            role: "guest",
            tenantId: session.tenantId,
          },
          session.identity,
        );
        res.writeHead(200, GUEST_HTML_HEADERS);
        res.end(
          renderNoScriptConversationHtml({
            threadId,
            timeline: state?.timeline ?? [],
            surfaces: state?.surfaces ?? [],
            journey: state?.journey,
            tasks: state?.tasks,
            verticals: state?.verticals,
            committedWork,
          }),
        );
        return;
      }
      if (!browserOriginAccepted(req, options.publicOrigin)) {
        res.writeHead(403);
        res.end("Origin rejected");
        return;
      }
      let form: URLSearchParams;
      try {
        form = await readFormBody(req);
      } catch {
        sendPageError(req, res, 400, "INVALID_CONVERSATION");
        return;
      }
      const submittedThreadId = form.get("threadId") ?? "";
      if (
        submittedThreadId !== "" &&
        !THREAD_ID_PATTERN.test(submittedThreadId)
      ) {
        sendPageError(req, res, 400, "INVALID_CONVERSATION");
        return;
      }
      const threadId =
        submittedThreadId === ""
          ? `g-${crypto.randomUUID()}`
          : submittedThreadId;
      if (
        !session ||
        !(await bindBrowserThread(
          app.environment,
          browserSessions,
          req,
          threadId,
          true,
          guestAccounts,
        ))
      ) {
        sendPageError(req, res, 401, "AUTHENTICATION_REQUIRED");
        return;
      }
      const text = form.get("message") ?? "";
      if (text.trim() === "" || text.length > MAX_TURN_TEXT_LENGTH) {
        const state = await app.getStateAsync(threadId);
        res.writeHead(400, GUEST_HTML_HEADERS);
        res.end(
          renderNoScriptConversationHtml({
            threadId,
            timeline: state?.timeline ?? [],
            surfaces: state?.surfaces ?? [],
            journey: state?.journey,
            tasks: state?.tasks,
            verticals: state?.verticals,
            error: "Type a short message to send.",
            draft: text.slice(0, MAX_TURN_TEXT_LENGTH),
          }),
        );
        return;
      }
      const result = await app.handleTurn(threadId, text);
      if (!result.ok) {
        // The same rejection the JavaScript client announces, keeping the draft.
        const state = await app.getStateAsync(threadId);
        res.writeHead(422, GUEST_HTML_HEADERS);
        res.end(
          renderNoScriptConversationHtml({
            threadId,
            timeline: state?.timeline ?? [],
            surfaces: state?.surfaces ?? [],
            journey: state?.journey,
            tasks: state?.tasks,
            verticals: state?.verticals,
            error: result.message,
            draft: text,
          }),
        );
        return;
      }
      // Post/redirect/get: refreshing the transcript never re-sends the turn.
      res.writeHead(303, {
        Location: `/conversation?threadId=${encodeURIComponent(threadId)}`,
      });
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/committed-work") {
      // Issue 13a: principal-scoped, never keyed by a client-supplied thread id.
      const session = await resolveBrowserSession(
        app.environment,
        browserSessions,
        readGuestSession(req),
        sessionScopedGuestPrincipals
          ? undefined
          : app.environment.config.guestId,
        accountCredentialsOf(req),
        guestAccounts,
      );
      if (!session) {
        sendJson(res, 401, {
          ok: false,
          code: "AUTHENTICATION_REQUIRED",
          message: "Conversation access requires an active browser session.",
        });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        committedWork: await app.committedWork(
          {
            id: session.principalId,
            role: "guest",
            tenantId: session.tenantId,
          },
          session.identity,
        ),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      const threadId = url.searchParams.get("threadId");
      if (!threadId || !THREAD_ID_PATTERN.test(threadId)) {
        sendJson(res, 400, {
          ok: false,
          code: "INVALID_THREAD",
          message: "Unknown conversation.",
        });
        return;
      }
      // ADR-0070/0075: a syntactically valid opaque thread ID is not an
      // ownership claim; browser refresh must present the server-issued
      // session binding before any projection is returned.
      const sessionId = readGuestSession(req);
      const session = await resolveBrowserSession(
        app.environment,
        browserSessions,
        sessionId,
        undefined,
        accountCredentialsOf(req),
        guestAccounts,
      );
      if (!session) {
        sendJson(res, 401, {
          ok: false,
          code: "AUTHENTICATION_REQUIRED",
          message: "Conversation access requires an active browser session.",
        });
        return;
      }
      if (!(await threadReadable(app.environment, session, threadId))) {
        sendJson(res, 200, {
          ok: true,
          threadId,
          timeline: [],
          surfaces: [],
        });
        return;
      }
      const state = await app.getStateAsync(threadId);
      if (!state) {
        sendJson(res, 200, {
          ok: true,
          threadId,
          timeline: [],
          surfaces: [],
        });
        return;
      }
      const withOffer = await withSignInOffer(
        req,
        app.environment,
        threadId,
        state.surfaces,
      );
      sendJson(
        res,
        200,
        { ...state, surfaces: withOffer.surfaces },
        withOffer.offered ? NO_STORE : {},
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/telemetry") {
      if (!browserOriginAccepted(req, options.publicOrigin)) {
        res.writeHead(403);
        res.end("Origin rejected");
        return;
      }
      try {
        const body = await readJsonBody(req);
        const event =
          body !== null && typeof body === "object" && !Array.isArray(body)
            ? (body as { event?: unknown }).event
            : undefined;
        const accepted = app.recordShellTelemetry(event);
        sendJson(res, accepted ? 200 : 400, { ok: accepted });
      } catch {
        sendJson(res, 400, { ok: false, code: "INVALID_TELEMETRY" });
      }
      return;
    }

    if (
      req.method === "POST" &&
      (url.pathname === "/api/turn" ||
        url.pathname === "/api/event" ||
        (fixtureRoutes && url.pathname === "/api/reset"))
    ) {
      if (!browserOriginAccepted(req, options.publicOrigin)) {
        res.writeHead(403);
        res.end("Origin rejected");
        return;
      }
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
          sendJson(res, 400, {
            ok: false,
            code: "INVALID_THREAD",
            message: "threadId is required.",
          });
          return;
        }
        if (
          !(await bindBrowserThread(
            app.environment,
            browserSessions,
            req,
            threadId,
            sessionScopedGuestPrincipals,
            guestAccounts,
          ))
        ) {
          sendJson(res, 401, {
            ok: false,
            code: "AUTHENTICATION_REQUIRED",
            message: "Conversation access requires an active browser session.",
          });
          return;
        }
        if (url.pathname === "/api/turn") {
          const text = (body as { text?: unknown }).text;
          if (
            typeof text !== "string" ||
            text.trim() === "" ||
            text.length > 2000
          ) {
            sendJson(res, 400, {
              ok: false,
              code: "INVALID_INPUT",
              message: "A short message is required.",
            });
            return;
          }
          await sendTurnResult(
            req,
            res,
            app.environment,
            threadId,
            await app.handleTurn(threadId, text),
          );
          return;
        }
        await sendTurnResult(
          req,
          res,
          app.environment,
          threadId,
          await app.handleEventAsync(threadId, body),
        );
      } catch (error) {
        if (error instanceof BodyTooLargeError) {
          sendJson(res, 413, {
            ok: false,
            code: "BODY_TOO_LARGE",
            message: "That request is too large.",
          });
          return;
        }
        if (error instanceof SyntaxError) {
          sendJson(res, 400, {
            ok: false,
            code: "INVALID_JSON",
            message: "The request could not be read.",
          });
          return;
        }
        // Issue 19: internal error text can carry domain or provider detail, so it never reaches the browser (ADR 0075).
        sendJson(res, 500, {
          ok: false,
          code: "INTERNAL_ERROR",
          message: "Something went wrong. Please try again.",
        });
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  };

  // Local composition only. Commerce public routes read the tracking-attempts table, which only the commerce migrations
  // create (issue 27). The Shortlet Worker passes commerce: "disabled", so its object never runs the commerce ledger (ADR 0101).
  const commerceRouteModules: RouteModule[] = [];
  if (commerceModule !== undefined) {
    const commerceClock = () => defaultApp.environment.clock();
    const commerce = commerceModule.compose({
      database: defaultApp.environment.database,
      clock: commerceClock,
      paymentReferenceKeys: options.paymentReferenceKeys,
    });
    applySchemaMigrations(
      defaultApp.environment.database,
      commerce.migrations,
      commerceClock().toISOString(),
    );
    commerceRouteModules.push(commerce.routeModule);
  }
  const shell = createGuestShell({
    assets,
    staticAssets: SHORTLET_STATIC_ASSETS,
    routeModules: [
      createLandingRouteModule({
        assets,
        binaryAssets: options.landingBinaryAssets ?? nodeLandingAssetLoader(),
        demo: options.landingDemo === true || defaultApp.environment.config.demo === true,
        secureCookie,
        originAccepted: (req) =>
          browserOriginAccepted(req, options.publicOrigin),
        readForm: readFormBody,
      }),
      ...commerceRouteModules,
      {
        name: "shortlet",
        tryHandle: async (req, res) => {
          await dispatch(req, res);
          return true;
        },
      },
    ],
    notFound: async (_req, res) => {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    },
  });

  return {
    app: defaultApp,
    get environment() {
      return defaultApp.environment;
    },
    get activeSessionRuntimes() {
      return sessionRuntimes.size;
    },
    get sessionRuntimesBuilt() {
      return sessionRuntimesBuilt;
    },
    handle(req, res) {
      // ADR 0105: the staging demo banner covers every guest HTML response (chat, landing, results, unit detail, account).
      return shell.handle(
        req,
        defaultApp.environment.config.demo === true ? bannerWrapped(res, req.method ?? "", withDemoBanner) : res,
      );
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const runtime of sessionRuntimes.values())
          runtime.environment.close();
        sessionRuntimes.clear();
        defaultApp.environment.close();
        resolve();
      }),
  };
}

export function startLocalGuestServer(
  options: GuestRequestHandlerOptions & { port?: number } = {},
): LocalGuestServerHandle {
  const { port, ...handlerOptions } = options;
  const listenPort = port ?? LOCAL_GUEST_PORT;
  const handler = createGuestRequestHandler(handlerOptions);
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handler.handle(req, res);
  });
  return {
    port: listenPort,
    get app() {
      return handler.app;
    },
    get environment() {
      return handler.environment;
    },
    get activeSessionRuntimes() {
      return handler.activeSessionRuntimes;
    },
    get sessionRuntimesBuilt() {
      return handler.sessionRuntimesBuilt;
    },
    listen: () =>
      new Promise<number>((resolve) => {
        server.listen(listenPort, "127.0.0.1", () => {
          const addr = server.address();
          const actualPort =
            typeof addr === "object" && addr ? addr.port : listenPort;
          resolve(actualPort);
        });
      }),
    close: () =>
      new Promise<void>((resolve) => {
        void handler.close();
        // Fetch clients may leave keep-alive sockets open after a response;
        // close them before waiting for the server callback so test and CLI
        // shutdowns are deterministic.
        server.closeIdleConnections?.();
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
