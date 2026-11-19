/// <reference lib="dom" />
/**
 * Presentation-only browser shell. Weaver renders server-produced A2UI; the
 * browser never owns booking state or executes generated business logic.
 */
import { createShortletWebRuntime } from "./shortlet-runtime.js";
import { A2UI_PRODUCER } from "../../web-agent/src/a2ui-surface.js";
import type { BasicWebRuntime } from "@cylayo/weaver-web";
import { icon } from "../../web/src/ui-kit.js";
import {
  enhanceListingGallery,
  watchPhotoFailure,
} from "./listing-gallery.js";
import {
  GUEST_ASSISTANT_COPY,
  GUEST_COMPARE_LABELS,
  GUEST_GLOSSARY,
  GUEST_MODE_CHOOSER,
  GUEST_MODES,
  GUEST_NEW_CONVERSATION,
  GUEST_TASK_RAIL,
  GUEST_VERTICALS,
  UNIT_DETAIL_ABOUT_HEADING,
  guestNewConversationCopy,
  type GuestCommittedWorkKind,
  type ModePresentation,
  type RefusalClass,
} from "../../web-agent/src/guest-content.js";
import type { GuestQuickReply } from "./concierge.js";
import { isQuickReplyList } from "./quick-replies.js";
import { CLIENT_REQUEST_TIMEOUT_MS, CLIENT_TURN_TIMEOUT_MS, TURN_STILL_WORKING_AFTER_MS } from "./turn-budget.js";
import { changedElsewhereRecovery } from "./stale-surface-response.js";
import { applyAccessibilityLabels } from "./a2ui-accessibility.js";
import { contactFieldAttributes } from "./contact-field.js";
import { combinedAbortSignal } from "./turn-cancel.js";
import { applyImageLayout } from "./image-layout.js";
import { turnEntriesSince } from "./guest-turn-recovery.js";
import {
  applyResponseModeAndThemeColour,
  assertValidResponseMode,
  readResponseMode,
  refreshThemeColourOnSchemeChange,
  type ThemeColourMeta,
} from "./response-mode.js";
import { modeSwitchChanges, runModeSwitch, type ModeSwitchEnvironment } from "./mode-switch-transition.js";
import { chooseModes, markIsControl, showsModeChooser, startBeforeTurn, type ModeChoice } from "./mode-choice.js";
import { createModeAnnouncements } from "./mode-announcement.js";
import { LaneCache, planSwitch, serverRowsMatch, stripsControlsOnLeave, type SwitchOrigin, type SwitchPlan } from "./lane-cache.js";
import { nextAgentMarkState, type AgentMarkEvent, type AgentMarkState } from "./agent-mark-state.js";
import {
  confirmationScreenHtml,
  offerScreenHtml,
  paymentScreenHtml,
  requestScreenHtml,
  signInOfferHtml,
  type SignInOfferContent,
} from "./guest-kit.js";
import type { ConfirmationContent } from "../../web-agent/src/confirmation-presentation.js";
import { EXTENSION_OPEN_EVENT, NOTICE_OPEN_EVENT } from "../../web-agent/src/booking-contract-a2ui.js";
import type { OfferScreenContent } from "../../web-agent/src/offer-presentation.js";
import type { PaymentScreenContent } from "../../web-agent/src/payment-presentation.js";
import type { RequestScreenContent } from "../../web-agent/src/request-presentation.js";
import {
  canUseSurfaceActions,
  closeFocusedSurface,
  createConversationShellState,
  fallbackSummary,
  formatGuestHistorySummary,
  guestSurfaceHeading,
  guestSurfaceStatusMessage,
  guestStatusTone,
  markActiveSurfaceStatus,
  replaceActiveSurface,
  reopenFocusedSurface,
  type ConversationShellState,
  type PresentationMode,
  type SurfaceLifecycleStatus,
  type SurfacePresentation,
} from "./conversational-shell.js";
import { mountGuestSurfaceOrFallback } from "./guest-surface-fallback.js";

interface GuestSurfacePayload {
  readonly surfaceId: string;
  readonly a2uiMessages: readonly unknown[];
  /** Issue 19: the server-owned surface type; never inferred from the surface id. */
  readonly kind?: "discovery" | "unit-detail" | "compare" | "request-draft" | "booking" | "payment" | "contact" | "general";
  /** Issue 19: the declared contact field purpose; never inferred from the label text. */
  readonly contactPurpose?: "phone" | "email";
  readonly mode?: PresentationMode;
  readonly status?: SurfaceLifecycleStatus;
  readonly summary?: string;
  readonly textFallback?: string;
  readonly conventionalRoute?: string;
  readonly conventionalRouteLabel?: string;
  readonly waiting?: GuestWaitingState;
  readonly requestScreen?: RequestScreenContent;
  readonly confirmation?: ConfirmationContent;
  readonly offerScreen?: OfferScreenContent;
  readonly paymentScreen?: PaymentScreenContent;
  readonly signInOffer?: SignInOfferContent;
}
interface GuestWaitingState {
  readonly kind: string;
  readonly heading: string;
  readonly deadlineAt: string;
  readonly deadlineText: string;
  readonly serverNow: string;
  readonly outcomes: readonly string[];
  readonly meanwhile: readonly string[];
}
interface GuestTimelineEntry {
  readonly role: "assistant" | "user" | "receipt";
  readonly text: string;
}
type JourneyStepState = "done" | "current" | "failed" | "upcoming";
interface GuestJourney {
  readonly current: string;
  readonly steps: readonly {
    readonly id: string;
    readonly label: string;
    readonly state: JourneyStepState;
  }[];
}
interface GuestCriteria {
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
  readonly budget?: {
    readonly naira: number;
    readonly per: "stay" | "night";
    readonly label: string;
  };
  readonly areas: readonly { readonly id: string; readonly label: string }[];
}
interface GuestTask {
  readonly taskId: string;
  readonly domain: string;
  readonly domainLabel: string;
  readonly status: string;
  readonly tone?: "info" | "success" | "warning" | "danger";
  readonly active: boolean;
  readonly badge?: number;
  readonly proposalOpen?: true;
}

interface GuestVertical {
  readonly domain: string;
  readonly label: string;
  readonly description?: string;
  /** Issue 03g: validated again by chooseModes before any radio is rendered. */
  readonly presentation?: unknown;
}

interface GuestResponse {
  readonly ok: boolean;
  readonly code?: string;
  readonly message?: string;
  readonly messages?: readonly string[];
  readonly receipts?: readonly string[];
  readonly surfaces?: readonly GuestSurfacePayload[];
  readonly journey?: GuestJourney;
  readonly criteria?: GuestCriteria;
  readonly quickReplies?: readonly GuestQuickReply[];
  readonly modeChange?: { readonly from: string; readonly to: string; readonly reason: "suggested"; readonly undoable: false };
  readonly tasks?: readonly GuestTask[];
  readonly verticals?: readonly GuestVertical[];
  readonly mode?: ModePresentation;
  /** Issue 60: the server's closed refusal class on an `ok:false` response. An unknown value is ignored (the code list still applies). */
  readonly refusal?: RefusalClass;
}
interface GuestCommittedWork {
  readonly kind: GuestCommittedWorkKind;
  readonly threadId: string;
  readonly route: string;
  readonly unitTitle?: string;
}
interface GuestStateResponse extends GuestResponse {
  readonly timeline?: readonly GuestTimelineEntry[];
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing guest shell element: ${id}`);
  return element as T;
}

const transcript = requiredElement<HTMLElement>("transcript");
const workspaceRegion = requiredElement<HTMLElement>("workspace-region");
const activeWorkspace = requiredElement<HTMLElement>("active-workspace");
const workspaceReopen = requiredElement<HTMLButtonElement>("workspace-reopen");
const composerForm = requiredElement<HTMLFormElement>("composer");
const composerInput = requiredElement<HTMLInputElement>("composer-input");
const composerSubmit = requiredElement<HTMLButtonElement>("composer-submit");
const announcer = requiredElement<HTMLElement>("announcer");
const errorAnnouncer = requiredElement<HTMLElement>("error-announcer");
const emptyState = requiredElement<HTMLElement>("empty-state");
const routeHeading = requiredElement<HTMLElement>("route-heading");
const workingStatus = requiredElement<HTMLElement>("working-status");
const turnCancel = requiredElement<HTMLButtonElement>("turn-cancel");
const journeyRail = requiredElement<HTMLElement>("journey-rail");
const taskRail = requiredElement<HTMLElement>("task-rail");
const verticalStarters = requiredElement<HTMLElement>("vertical-starters");
const taskStepHeader = requiredElement<HTMLElement>("task-step-header");
const criteriaStrip = requiredElement<HTMLElement>("criteria-strip");
const criteriaEditor = requiredElement<HTMLFormElement>("criteria-editor");
const criteriaStatus = requiredElement<HTMLElement>("criteria-status");
const criteriaToggle = requiredElement<HTMLButtonElement>("criteria-toggle");
const criteriaSummary = requiredElement<HTMLElement>("criteria-summary");
const newConversationButton =
  requiredElement<HTMLButtonElement>("new-conversation");
const newConversationConfirm = requiredElement<HTMLElement>(
  "new-conversation-confirm",
);
const newConversationStart = requiredElement<HTMLButtonElement>(
  "new-conversation-start",
);
const newConversationCancel = requiredElement<HTMLButtonElement>(
  "new-conversation-cancel",
);

function getThreadId(): string {
  try {
    const urlParam = new URLSearchParams(window.location.search).get(
      "threadId",
    );
    if (urlParam && /^g-[a-f0-9-]{6,64}$/.test(urlParam)) {
      window.sessionStorage.setItem("shortlet-concierge-thread", urlParam);
      return urlParam;
    }
    const stored = window.sessionStorage.getItem("shortlet-concierge-thread");
    if (stored && /^g-[a-f0-9-]{6,64}$/.test(stored)) return stored;
  } catch {
    /* Storage is optional; the server remains authoritative. */
  }
  const created = `g-${crypto.randomUUID()}`;
  try {
    window.sessionStorage.setItem("shortlet-concierge-thread", created);
  } catch {
    /* Page-lifetime fallback. */
  }
  return created;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSafeImageUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (
      parsed.protocol !== "https:" ||
      parsed.username !== "" ||
      parsed.password !== ""
    )
      return false;
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal") ||
      hostname.endsWith(".lan")
    )
      return false;
    if (hostname.includes(":") || hostname.startsWith("[")) return false;
    if (
      /^(0\.|10\.|127\.|169\.254\.|192\.0\.0\.|192\.168\.|198\.(18|19)\.|224\.)/.test(
        hostname,
      )
    )
      return false;
    if (/^100\.(6[4-9]|[78]\d|9\d)\./.test(hostname)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return false;
    if (
      hostname === "::1" ||
      hostname.startsWith("fc") ||
      hostname.startsWith("fd") ||
      hostname.startsWith("fe8")
    )
      return false;
    return true;
  } catch {
    return false;
  }
}

function safeImageResourceUrl(value: string): string | undefined {
  if (!isSafeImageUrl(value)) return undefined;
  const parsed = new URL(value);
  const localBrowser =
    window.location.protocol === "http:" &&
    (window.location.hostname === "127.0.0.1" ||
      window.location.hostname === "localhost");
  return localBrowser && parsed.hostname === "pilot-local.invalid"
    ? `${window.location.origin}${parsed.pathname}`
    : value;
}

function enhanceListingImages(mount: HTMLElement): void {
  for (const [index, image] of [...mount.querySelectorAll("img")].entries()) {
    image.classList.add("guest-photo");
    image.referrerPolicy = "no-referrer";
    image.decoding = "async";
    image.loading = index === 0 ? "eager" : "lazy";
    if (index === 0) image.fetchPriority = "high";
    watchPhotoFailure(image);
  }
  // Guest gallery issue 01: the strip count, "Show all" and the full-screen viewer (presentation only, ADR 0072).
  for (const gallery of mount.querySelectorAll<HTMLElement>(".listing-gallery"))
    enhanceListingGallery(gallery);
}





/** Issue 08: the offer sits beneath the request-sent or confirmation screen, from the same kit helper the page uses. */
function organizeSignInOffer(mount: HTMLElement, content: SignInOfferContent): void {
  const root = mount.querySelector<HTMLElement>('[data-a2ui-component="Column"]');
  root?.insertAdjacentHTML("beforeend", signInOfferHtml(content));
}

function organizeConfirmation(
  mount: HTMLElement,
  content: ConfirmationContent,
): void {
  const root = mount.querySelector<HTMLElement>(
    '[data-a2ui-component="Column"]',
  );
  const ticket = root?.querySelector<HTMLElement>(":scope > .ui-ticket");
  const breakdown = root?.querySelector<HTMLElement>(
    ":scope > .ui-price-breakdown",
  );
  if (!root || !ticket || !breakdown) return;
  const template = document.createElement("template");
  template.innerHTML = confirmationScreenHtml(
    content,
    ticket.outerHTML,
    breakdown.outerHTML,
  );
  root.replaceChildren(template.content);
  // Issue 18: the confirmation screen replaces the Weaver tree, so its Give notice button is wired here to the same open event
  // the booking surface's Weaver action sends (the card is then the only confirmation, ADR 0060).
  const bookingSurfaceId = activePayload?.surfaceId;
  root.querySelector<HTMLButtonElement>("[data-notice-open]")?.addEventListener("click", () => {
    if (bookingSurfaceId === undefined) return;
    void sendEvent({ name: NOTICE_OPEN_EVENT, surfaceId: bookingSurfaceId, sourceComponentId: "booking-contract-notice-action", timestamp: new Date().toISOString(), context: { surfaceId: bookingSurfaceId } });
  });
  // Monthly-stays issue 09: "Extend your stay" opens the extension card through the same routed event (ADR 0074).
  root.querySelector<HTMLButtonElement>("[data-extension-open]")?.addEventListener("click", () => {
    if (bookingSurfaceId === undefined) return;
    void sendEvent({ name: EXTENSION_OPEN_EVENT, surfaceId: bookingSurfaceId, sourceComponentId: "booking-contract-extension-action", timestamp: new Date().toISOString(), context: { surfaceId: bookingSurfaceId } });
  });
  root
    .querySelector<HTMLAnchorElement>(".request-next a")
    ?.addEventListener("click", (event) => {
      event.preventDefault();
      askShortlet();
    });
}

/** Issue 09: one payment layout. The Weaver action row stays in the page, so its server-bound event still runs (ADR-0072). */
function organizePaymentScreen(
  mount: HTMLElement,
  content: PaymentScreenContent,
): void {
  const root = mount.querySelector<HTMLElement>(
    '[data-a2ui-component="Column"]',
  );
  const ticket = root?.querySelector<HTMLElement>(":scope > .ui-ticket");
  const breakdown = root?.querySelector<HTMLElement>(
    ":scope > .ui-price-breakdown",
  );
  const actions = root?.querySelector<HTMLElement>(
    ':scope > [data-a2ui-component="Row"]',
  );
  if (!root || !ticket || !breakdown) return;
  const template = document.createElement("template");
  template.innerHTML = paymentScreenHtml(
    content,
    ticket.outerHTML,
    breakdown.outerHTML,
    {
      countdown: true,
      ...(actions ? { actions: '<div data-payment-action-slot></div>' } : {}),
    },
  );
  const slot = template.content.querySelector("[data-payment-action-slot]");
  if (slot && actions) slot.replaceWith(actions);
  if (content.choice && actions) {
    const original = actions.querySelector<HTMLButtonElement>("button");
    const form = template.content.querySelector<HTMLFormElement>(".payment-choice-form");
    form?.addEventListener("submit", event => {
      if (new FormData(form).get("method") !== "card") return;
      // ADR 0072: card retains Weaver's server-bound event; the other methods post to their conventional commands.
      event.preventDefault();
      if (original && !original.disabled) original.click();
    });
    const binding = document.createElement("div");
    binding.hidden = true;
    binding.append(actions);
    root.replaceChildren(template.content, binding);
  } else root.replaceChildren(template.content);
  const countdown = root.querySelector<HTMLElement>(".waiting-countdown");
  if (countdown && activePayload?.waiting?.kind === "payment-window")
    startCountdown(activePayload.waiting, countdown, true);
}

function organizeOfferScreen(
  mount: HTMLElement,
  content: OfferScreenContent,
): void {
  const root = mount.querySelector<HTMLElement>(
    '[data-a2ui-component="Column"]',
  );
  const ticket = root?.querySelector<HTMLElement>(":scope > .ui-ticket");
  const breakdown = root?.querySelector<HTMLElement>(
    ":scope > .ui-price-breakdown",
  );
  if (!root || !ticket || !breakdown) return;
  const original = root.querySelector<HTMLButtonElement>("button");
  if (content.accept && !original) return;
  const template = document.createElement("template");
  template.innerHTML = offerScreenHtml(
    content,
    ticket.outerHTML,
    breakdown.outerHTML,
  );
  const screen = template.content.firstElementChild as HTMLElement;
  if (content.accept && original) {
    const binding = document.createElement("div");
    binding.hidden = true;
    binding.append(original);
    screen
      .querySelector<HTMLFormElement>(".offer-actions form")
      ?.addEventListener("submit", (event) => {
        event.preventDefault();
        if (!original.disabled) original.click();
      });
    root.replaceChildren(screen, binding);
  } else root.replaceChildren(screen);
  for (const form of screen.querySelectorAll<HTMLFormElement>(
    ".offer-actions form",
  )) {
    if (form.getAttribute("action")?.endsWith("/conversation"))
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        closeWorkspace(workspaceReopen);
      });
  }
  const countdown = screen.querySelector<HTMLElement>(".waiting-countdown");
  if (countdown && activePayload?.waiting?.kind === "offer-payment-window")
    startCountdown(activePayload.waiting, countdown, true);
}

/** ADR-0072/0081: one kit layout; the submitted draft action still runs Weaver's original, server-bound event. */
function organizeRequestScreen(
  mount: HTMLElement,
  content: RequestScreenContent,
): void {
  const root = mount.querySelector<HTMLElement>(
    '[data-a2ui-component="Column"]',
  );
  const ticket = root?.querySelector<HTMLElement>(":scope > .ui-ticket");
  const breakdown = root?.querySelector<HTMLElement>(
    ":scope > .ui-price-breakdown",
  );
  if (!root || !ticket || !breakdown) return;
  const originalAction = root.querySelector<HTMLButtonElement>("button");
  if (
    (content.state === "draft" || content.state === "review") &&
    !originalAction
  )
    return;
  const template = document.createElement("template");
  template.innerHTML = requestScreenHtml(
    content,
    ticket.outerHTML,
    breakdown.outerHTML,
    breakdown.querySelector(".ui-money-total")?.textContent ?? undefined,
  );
  const screen = template.content.firstElementChild as HTMLElement;
  const primaryForm = screen.querySelector<HTMLFormElement>(
    ".request-actions form",
  );
  if (
    originalAction &&
    (content.state === "draft" || content.state === "review")
  ) {
    // Keep the runtime-owned button and its listeners, without exposing a second action to assistive technology.
    const binding = document.createElement("div");
    binding.hidden = true;
    binding.append(originalAction);
    primaryForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!originalAction.disabled) originalAction.click();
    });
    root.replaceChildren(screen, binding);
  } else root.replaceChildren(screen);
  for (const form of screen.querySelectorAll<HTMLFormElement>(
    ".request-actions form",
  )) {
    if (new URL(form.action).pathname.endsWith("/conversation"))
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        closeWorkspace(workspaceReopen);
      });
  }
  const change = screen.querySelector<HTMLAnchorElement>(".request-guests a");
  change?.addEventListener("click", (event) => {
    event.preventDefault();
    closeWorkspace(composerInput);
  });
  if (activePayload?.waiting?.kind === "operator-response") {
    screen.dataset.waiting = "operator-response";
    const countdown = screen.querySelector<HTMLElement>(".waiting-countdown");
    if (countdown) startCountdown(activePayload.waiting, countdown);
  }
}

let comparingBoth = false;

/**
 * "See both side by side": picks the two results as their Compare buttons would, so the server opens the comparison.
 * If one is already picked, only the other is picked; picking it again would un-pick it (issue 13b).
 */
async function compareBoth(): Promise<void> {
  if (comparingBoth) return;
  comparingBoth = true;
  const compareButtons = (): (HTMLButtonElement | null)[] =>
    [...activeWorkspace.querySelectorAll<HTMLElement>(".ui-stay-card")].map(
      (card) => card.querySelector<HTMLButtonElement>(".stay-card__compare"),
    );
  const picked = (button: HTMLButtonElement | null | undefined): boolean =>
    button?.textContent?.trim() === GUEST_COMPARE_LABELS.unpick;
  try {
    const [first, second] = compareButtons();
    if (first && second) {
      if (picked(first) || picked(second)) {
        (picked(first) ? second : first).click();
        return;
      }
      first.click();
      // The server re-presents the results with the first stay picked; the second pick goes to the fresh surface.
      for (let waited = 0; waited < 10_000; waited += 50) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        const [fresh, next] = compareButtons();
        if (picked(fresh) && next) {
          next.click();
          return;
        }
      }
    }
    // Never silent: say what happened and where the per-stay Compare is.
    const message =
      "The comparison could not be opened. Open See all results and choose Compare on each stay.";
    addTurn("assistant", message);
    announce(message, true);
  } finally {
    comparingBoth = false;
  }
}

function enhanceSurfacePresentation(mount: HTMLElement, kind: string): void {
  mount.dataset.surfaceKind = kind;
  // Only Weaver's Basic Buttons take the shell's button style; kit controls drawn by the typed renderers (the gallery's
  // "Show all", "See both side by side") keep their own kit classes, as they did when the organizers added them later.
  for (const button of mount.querySelectorAll<HTMLButtonElement>('button[data-a2ui-component="Button"]'))
    button.classList.add("guest-action");
  for (const field of mount.querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >("input, textarea, select"))
    field.classList.add("guest-field");
  for (const text of mount.querySelectorAll<HTMLElement>(
    '[data-a2ui-component="Text"]',
  )) {
    const value = text.textContent?.trim() ?? "";
    const isHeading = /^H[1-6]$/.test(text.tagName);
    const tone = isHeading ? undefined : guestStatusTone(value);
    if (tone) text.classList.add("guest-status", `guest-status--${tone}`);
    if (/^No stays match|^No current matches/i.test(value))
      text.classList.add("empty-state-title");
  }
  if (activePayload?.requestScreen)
    organizeRequestScreen(mount, activePayload.requestScreen);
  if (activePayload?.confirmation)
    organizeConfirmation(mount, activePayload.confirmation);
  if (activePayload?.offerScreen)
    organizeOfferScreen(mount, activePayload.offerScreen);
  if (activePayload?.paymentScreen)
    organizePaymentScreen(mount, activePayload.paymentScreen);
  if (activePayload?.signInOffer)
    organizeSignInOffer(mount, activePayload.signInOffer);
}

function isSafeInternalRoute(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value === "" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  )
    return false;
  try {
    return (
      new URL(value, window.location.origin).origin === window.location.origin
    );
  } catch {
    return false;
  }
}

function isStringList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isWaitingState(value: unknown): value is GuestWaitingState {
  return (
    isRecord(value) &&
    ["operator-response", "offer-payment-window", "payment-window"].includes(
      String(value.kind),
    ) &&
    typeof value.heading === "string" &&
    typeof value.deadlineText === "string" &&
    typeof value.deadlineAt === "string" &&
    Number.isFinite(Date.parse(value.deadlineAt)) &&
    typeof value.serverNow === "string" &&
    Number.isFinite(Date.parse(value.serverNow)) &&
    isStringList(value.outcomes) &&
    isStringList(value.meanwhile)
  );
}

function isConfirmation(value: unknown): value is ConfirmationContent {
  return (
    isRecord(value) &&
    typeof value.bookingReference === "string" &&
    value.bookingReference !== "" &&
    typeof value.depositCollected === "boolean" &&
    isStringList(value.steps) &&
    isSafeInternalRoute(value.conversationHref) &&
    isSafeInternalRoute(value.detailsHref) &&
    typeof value.details === "string"
  );
}

/** Issue 08: the sign-in offer's two values, the email and the return path; the markup comes from the kit. */
function isSignInOffer(value: unknown): value is SignInOfferContent {
  return isRecord(value) && typeof value.email === "string" && typeof value.returnPath === "string";
}

function isRequestScreen(value: unknown): value is RequestScreenContent {
  if (
    !isRecord(value) ||
    typeof value.state !== "string" ||
    !["draft", "review", "sent", "not-accepted"].includes(value.state) ||
    typeof value.tone !== "string" ||
    !["neutral", "warning", "danger"].includes(value.tone) ||
    typeof value.title !== "string" ||
    typeof value.status !== "string" ||
    !isStringList(value.steps) ||
    !isStringList(value.notes)
  )
    return false;
  const action = (candidate: unknown): boolean =>
    isRecord(candidate) &&
    isSafeInternalRoute(candidate.path) &&
    typeof candidate.label === "string" &&
    (candidate.surfaceId === undefined ||
      typeof candidate.surfaceId === "string");
  if (
    !action(value.primary) ||
    (value.secondary !== undefined && !action(value.secondary))
  )
    return false;
  if (
    ["banner", "provider", "guests", "sentAt"].some(
      (key) => value[key] !== undefined && typeof value[key] !== "string",
    )
  )
    return false;
  if (value.selfBooking !== undefined && typeof value.selfBooking !== "boolean")
    return false;
  if (value.changeHref !== undefined && !isSafeInternalRoute(value.changeHref))
    return false;
  return (
    value.deadline === undefined ||
    (isRecord(value.deadline) &&
      typeof value.deadline.iso === "string" &&
      Number.isFinite(Date.parse(value.deadline.iso)) &&
      typeof value.deadline.text === "string")
  );
}

function isOfferScreen(value: unknown): value is OfferScreenContent {
  if (
    !isRecord(value) ||
    !["live", "expired", "accepted", "closed"].includes(String(value.state)) ||
    ["title", "status", "provider", "consequence", "amount"].some(
      (key) => typeof value[key] !== "string",
    ) ||
    typeof value.deadlineIso !== "string" ||
    !Number.isFinite(Date.parse(value.deadlineIso)) ||
    typeof value.serverNow !== "string" ||
    !Number.isFinite(Date.parse(value.serverNow)) ||
    !isStringList(value.steps) ||
    !isStringList(value.notes) ||
    !Array.isArray(value.policies) ||
    !value.policies.every(section => isRecord(section) && typeof section.heading === "string" && isStringList(section.items)) ||
    !isSafeInternalRoute(value.conversationPath) ||
    (value.searchPath !== undefined && !isSafeInternalRoute(value.searchPath))
  )
    return false;
  return (
    value.accept === undefined ||
    (value.state === "live" &&
      isRecord(value.accept) &&
      isSafeInternalRoute(value.accept.path) &&
      typeof value.accept.surfaceId === "string" &&
      value.accept.surfaceId !== "")
  );
}

function isPaymentScreen(value: unknown): value is PaymentScreenContent {
  return (
    isRecord(value) &&
    ["ready", "handoff"].includes(String(value.state)) &&
    ["success", "warning", "danger", "neutral"].includes(String(value.tone)) &&
    ["title", "status", "explanation"].every(
      (key) => typeof value[key] === "string",
    ) &&
    typeof value.serverNow === "string" &&
    Number.isFinite(Date.parse(value.serverNow)) &&
    (value.deadlineIso === undefined ||
      (typeof value.deadlineIso === "string" &&
        Number.isFinite(Date.parse(value.deadlineIso)))) &&
    isStringList(value.steps) &&
    (value.choice === undefined || (value.state === "ready" && isRecord(value.choice) &&
      isSafeInternalRoute(value.choice.action) && typeof value.choice.providerTransfer === "boolean" &&
      typeof value.choice.amount === "string" &&
      (value.choice.manualAction === undefined || isSafeInternalRoute(value.choice.manualAction))))
  );
}

function isSurfacePayload(value: unknown): value is GuestSurfacePayload {
  if (
    !isRecord(value) ||
    typeof value.surfaceId !== "string" ||
    value.surfaceId.trim() === "" ||
    !Array.isArray(value.a2uiMessages)
  )
    return false;
  if (
    value.mode !== undefined &&
    value.mode !== "text" &&
    value.mode !== "inline-surface" &&
    value.mode !== "focused-surface"
  )
    return false;
  if (
    value.status !== undefined &&
    (typeof value.status !== "string" ||
      ![
        "active",
        "superseded",
        "stale",
        "expired",
        "deleted",
        "fallback",
      ].includes(value.status))
  )
    return false;
  if (value.summary !== undefined && typeof value.summary !== "string")
    return false;
  if (
    value.textFallback !== undefined &&
    typeof value.textFallback !== "string"
  )
    return false;
  if (
    value.conventionalRouteLabel !== undefined &&
    typeof value.conventionalRouteLabel !== "string"
  )
    return false;
  if (value.waiting !== undefined && !isWaitingState(value.waiting))
    return false;
  if (
    value.requestScreen !== undefined &&
    !isRequestScreen(value.requestScreen)
  )
    return false;
  if (value.confirmation !== undefined && !isConfirmation(value.confirmation))
    return false;
  if (value.signInOffer !== undefined && !isSignInOffer(value.signInOffer))
    return false;
  if (value.offerScreen !== undefined && !isOfferScreen(value.offerScreen))
    return false;
  if (
    value.paymentScreen !== undefined &&
    !isPaymentScreen(value.paymentScreen)
  )
    return false;
  return (
    value.conventionalRoute === undefined ||
    isSafeInternalRoute(value.conventionalRoute)
  );
}

const JOURNEY_STATE_TEXT: Readonly<Record<JourneyStepState, string>> = {
  done: "completed",
  current: "current step",
  failed: "not completed",
  upcoming: "not started",
};

function isJourney(value: unknown): value is GuestJourney {
  if (
    !isRecord(value) ||
    typeof value.current !== "string" ||
    !Array.isArray(value.steps) ||
    value.steps.length === 0
  )
    return false;
  return value.steps.every(
    (step) =>
      isRecord(step) &&
      typeof step.id === "string" &&
      typeof step.label === "string" &&
      typeof step.state === "string" &&
      step.state in JOURNEY_STATE_TEXT,
  );
}

function isCriteria(value: unknown): value is GuestCriteria {
  if (
    !isRecord(value) ||
    typeof value.key !== "string" ||
    typeof value.editable !== "boolean" ||
    typeof value.canUndo !== "boolean"
  )
    return false;
  if (
    !Array.isArray(value.areas) ||
    !value.areas.every(
      (area) =>
        isRecord(area) &&
        typeof area.id === "string" &&
        typeof area.label === "string",
    )
  )
    return false;
  const labelled = (field: unknown): boolean =>
    field === undefined || (isRecord(field) && typeof field.label === "string");
  return (
    labelled(value.where) &&
    labelled(value.when) &&
    labelled(value.guests) &&
    labelled(value.budget)
  );
}

function isGuestTask(value: unknown): value is GuestTask {
  if (
    !isRecord(value) ||
    typeof value.taskId !== "string" ||
    typeof value.domain !== "string" ||
    typeof value.domainLabel !== "string" ||
    typeof value.status !== "string" ||
    typeof value.active !== "boolean"
  )
    return false;
  if (
    value.tone !== undefined &&
    !["info", "success", "warning", "danger"].includes(String(value.tone))
  )
    return false;
  return (
    value.badge === undefined ||
    (typeof value.badge === "number" && Number.isInteger(value.badge) && value.badge >= 0)
  );
}

function isGuestVertical(value: unknown): value is GuestVertical {
  if (
    !isRecord(value) ||
    typeof value.domain !== "string" ||
    typeof value.label !== "string"
  )
    return false;
  return value.description === undefined || typeof value.description === "string";
}

function readGuestResponse(value: unknown): GuestResponse {
  if (!isRecord(value) || typeof value.ok !== "boolean")
    throw new Error("Invalid server response");
  if (
    value.messages !== undefined &&
    (!Array.isArray(value.messages) ||
      value.messages.some((message) => typeof message !== "string"))
  )
    throw new Error("Invalid response messages");
  if (
    value.receipts !== undefined &&
    (!Array.isArray(value.receipts) ||
      value.receipts.some((receipt) => typeof receipt !== "string"))
  )
    throw new Error("Invalid response receipts");
  if (
    value.surfaces !== undefined &&
    (!Array.isArray(value.surfaces) ||
      value.surfaces.some((surface) => !isSurfacePayload(surface)))
  )
    throw new Error("Invalid response surface");
  if (value.journey !== undefined && !isJourney(value.journey))
    throw new Error("Invalid response journey");
  if (value.criteria !== undefined && !isCriteria(value.criteria))
    throw new Error("Invalid response criteria");
  // Issue 58: a malformed chip is dropped by isQuickReplyList at render, so only a non-array is refused whole here.
  if (value.quickReplies !== undefined && !Array.isArray(value.quickReplies))
    throw new Error("Invalid response quick replies");
  if (value.modeChange !== undefined && (!isRecord(value.modeChange) || value.modeChange.reason !== "suggested"
    || typeof value.modeChange.from !== "string" || typeof value.modeChange.to !== "string" || value.modeChange.undoable !== false
    || Object.keys(value.modeChange).length !== 4)) throw new Error("Invalid response mode change");
  if (
    value.tasks !== undefined &&
    (!Array.isArray(value.tasks) || value.tasks.some((task) => !isGuestTask(task)))
  )
    throw new Error("Invalid response tasks");
  if (
    value.verticals !== undefined &&
    (!Array.isArray(value.verticals) ||
      value.verticals.some((vertical) => !isGuestVertical(vertical)))
  )
    throw new Error("Invalid response verticals");
  assertValidResponseMode(value.mode);
  return value as unknown as GuestResponse;
}

// Slice 1 of the agent-modes effort: the applied presentation drives the shell announcements. It is only ever set from a
// validated copy, so a raw response object never reaches the copy. Stays is the default before the first response.
let appliedMode: ModePresentation = GUEST_MODES.stays;
// Issue 03l (ADR 0107 decision 7): the switch announcement state. Pure (mode-announcement.ts); the client only routes text through it.
const modeAnnouncements = createModeAnnouncements();

/** Issue 03k: the theme-color tags the shell renders. Read at the time of each write, so a re-render never leaves a stale list. */
function themeColourMetas(): ThemeColourMeta[] {
  return Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'));
}

/** Issue 03k (ADR 0107 decision 4): the resolved --mode-tint for the current theme, as the browser computes it. */
function readModeTint(): string {
  return getComputedStyle(document.documentElement).getPropertyValue("--mode-tint");
}

// Issue 03k: a page that follows the system re-reads the tint when the operating system's colour scheme changes.
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  refreshThemeColourOnSchemeChange(document.documentElement, themeColourMetas(), readModeTint);
});

/**
 * Issue 03j: the mode-switch transition's environment. Feature-detected: no View Transitions API means an instant update. A switch never
 * starts over a running transition.
 */
function modeSwitchEnvironment(): ModeSwitchEnvironment {
  const running = (document as unknown as { activeViewTransition?: unknown }).activeViewTransition;
  return {
    start: typeof document.startViewTransition === "function"
      ? (options: unknown) => Reflect.apply(document.startViewTransition, document, [options])
      : undefined,
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    transitionRunning: running !== undefined && running !== null,
  };
}

// Issue 03j: set while a first message commits a previewed mode. The switch then stays instant, so the hero transition runs as before.
let holdModeSwitchForFirstMessage = false;

function applyResponseMode(response: GuestResponse): void {
  // Issue 03j: the mode this response validated, or undefined. An absent or malformed mode writes nothing (ADR 0107 decision 6).
  const committed = readResponseMode(response.mode);
  appliedMode = committed ?? appliedMode;
  // Issue 03l (ADR 0107 decision 7): a committed switch is held for the polite announcer; the first response is never a switch.
  modeAnnouncements.applyResponse(response.mode);
  // Issue 03j: the DOM part of the response's mode is one update. A confirmed switch (the validated id differs from data-mode) runs it
  // through the feature-detected transition; anything else runs it at once. The update writes only when this response's mode is still
  // the committed one, so an earlier update still pending can never overwrite a later switch.
  const update = (): void => {
    // Issue 03c (ADR 0107 decision 6): the document's data-mode follows the validated response, never a user action or the DOM.
    // Issue 03k (ADR 0107 decision 2): the browser theme colour follows the same validated response, and only when the id changed.
    if (committed !== undefined && appliedMode.id === committed.id) applyResponseModeAndThemeColour(document.documentElement, themeColourMetas(), readModeTint, committed);
    // Issue 03g: with no preview pending, the empty copy and the strip follow the committed mode.
    if (previewDomain === undefined) renderEmptyCopy(appliedMode);
    syncModeMark();
    renderModeStrip();
  };
  if (committed !== undefined && !holdModeSwitchForFirstMessage && modeSwitchChanges(document.documentElement.dataset.mode, committed)) runModeSwitch(update, modeSwitchEnvironment());
  else update();
}

// Issue 01b (ADR 0107 decision 9): the Agent Mark follows signals the shell already has. The state is never persisted (ADR 0106), so
// a reload starts from idle. No client path sets `human`: no takeover signal reaches guests (ADR 0076). Any future takeover signal must
// set `human` and block thinking, working and responding in nextAgentMarkState.
const AGENT_MARK_POP_MS = 400;
let agentMarkState: AgentMarkState = "idle";
let agentMarkSettleTimer: number | undefined;
const agentDock = requiredElement<HTMLElement>("agent-dock");
const agentDockChip = agentDock.querySelector<HTMLElement>(".agent-dock__chip");

function setAgentMark(event: AgentMarkEvent): void {
  agentMarkState = nextAgentMarkState(agentMarkState, event);
  for (const mark of document.querySelectorAll<HTMLElement>("[data-agent-mark]")) mark.setAttribute("data-agent-state", agentMarkState);
}

/** A reply landed: the mark pops once, then settles to idle. */
function landAgentReply(): void {
  setAgentMark({ type: "reply-landed" });
  window.clearTimeout(agentMarkSettleTimer);
  agentMarkSettleTimer = window.setTimeout(() => setAgentMark({ type: "response-settled" }), AGENT_MARK_POP_MS);
}

// Motion pauses while the page is hidden (the kit CSS reads data-page-hidden on <html>).
function syncPageHidden(): void {
  document.documentElement.toggleAttribute("data-page-hidden", document.visibilityState === "hidden");
}
syncPageHidden();
document.addEventListener("visibilitychange", syncPageHidden);

// The mark is listening only while the composer is focused with text (ADR 0107 decision 9).
function syncComposerMark(): void {
  setAgentMark({ type: "composer-changed", focusedWithText: document.activeElement === composerInput && composerInput.value.trim() !== "" });
}
composerInput.addEventListener("input", syncComposerMark);
composerInput.addEventListener("focus", syncComposerMark);
composerInput.addEventListener("blur", syncComposerMark);

/**
 * The first message moves the hero mark into the app bar (ADR 0107 decision 9). Same-document and feature-detected: an instant update is
 * always correct, and reduced motion skips the transition. The app-bar mark takes the shared name only once the empty state is hidden.
 */
function withAgentMarkTransition(update: () => void): void {
  // Only the first message has a hero to morph. Once the empty state is hidden the shared name sits on the app-bar mark in both
  // snapshots, so a transition would animate nothing while it holds the document (a running view transition widens the page at 375px).
  if (emptyState.hidden || !document.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    update();
    return;
  }
  document.startViewTransition(update);
}

/**
 * Issue 07 review: the "not confirmed" banner comes from the callback redirect's `payment` flag. Drop the flag from the
 * address bar once the page has it, so a refresh or a shared link after a later confirmation never shows it again.
 */
function dropPaymentNoticeFlag(): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("payment")) return;
    url.searchParams.delete("payment");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    /* The address bar is a convenience; the server's journey still hides a stale banner. */
  }
}
dropPaymentNoticeFlag();

const threadId = getThreadId();
/**
 * Issue 03i (ADR 0107 decision 11): every visited lane is a live element inside the transcript, shown or hidden, never re-inserted.
 * The cache is in memory only; the server's task list and timeline decide what is shown (see lane-cache.ts).
 */
const laneCache = new LaneCache<HTMLElement>(threadId);
let activeLane = createLaneElement();
let activeLaneId: string | undefined;
/** Set by a switch made from the switcher (rail, strip or sheet): the lane heading takes focus when the lane changes. */
let laneFocusRequested = false;
transcript.appendChild(activeLane);
routeHeading.tabIndex = -1;
let shellState: ConversationShellState = createConversationShellState();
let activePayload: GuestSurfacePayload | undefined;
/** Issue 14: a turn's assistant message is announced by the transcript log, so the workspace stays silent for that turn. */
let transcriptAnnouncesTurn = false;
let isLoading = false;
let eventInFlight = false;
let lastActivatedControl: HTMLElement | undefined;
let workspaceOpener: HTMLElement | undefined;
let focusedScrollTop = 0;
const createdSurfaceIds = new Set<string>();

type ShellTelemetryEvent =
  | "text-response-rendered"
  | "inline-surface-rendered"
  | "focused-surface-opened"
  | "focused-surface-closed"
  | "surface-replaced"
  | "stale-surface-encountered"
  | "expired-surface-encountered"
  | "fallback-rendered"
  | "conventional-route-fallback"
  | "weaver-rendering-failure";

function trackTelemetry(event: ShellTelemetryEvent): void {
  void fetch("/api/telemetry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event }),
    keepalive: true,
  }).catch(() => {
    /* Observability must never block the interaction. */
  });
}

function announce(text: string, assertive = false): void {
  // ADR-0078: separate polite progress from assertive errors so normal turns
  // never upgrade the live region's urgency.
  if (assertive) {
    errorAnnouncer.textContent = text;
    return;
  }
  // Issue 03l: a held mode-switch copy is combined into this one polite write, switch first.
  announcer.textContent = modeAnnouncements.politeText(text);
}

/** Issue 03l: writes a held mode-switch copy on its own when no reply announcement combined with it. */
function flushModeSwitchAnnouncement(): void {
  const alone = modeAnnouncements.flush();
  if (alone !== undefined) announcer.textContent = alone;
}

/** Issue 24 (guideline §12): keep the latest turns rendered; older ones defer until scrolled near, and stay reachable. */
const RENDERED_TURN_WINDOW = 6;
function deferOlderTurns(): void {
  const turns = activeLane.querySelectorAll<HTMLElement>(".turn");
  const cutoff = Math.max(0, turns.length - RENDERED_TURN_WINDOW);
  turns.forEach((turn, index) => turn.classList.toggle("turn--deferred", index < cutoff));
}

function addTurn(role: "assistant" | "user", text: string): void {
  emptyState.hidden = true;
  // Issue 03g: the strip belongs to the empty conversation; the sheet opens from the mark during a conversation.
  verticalStarters.hidden = true;
  const turn = document.createElement("article");
  turn.className = `turn ${role}`;
  turn.setAttribute(
    "aria-label",
    role === "user" ? "You" : "Shortlet Concierge",
  );
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  turn.appendChild(bubble);
  appendToLane(turn);
  deferOlderTurns();
  transcript.scrollTop = transcript.scrollHeight;
  requestAnimationFrame(() => {
    if (turn.isConnected) transcript.scrollTop = transcript.scrollHeight;
  });
}

function addRetryTurn(text: string, retry: () => void): void {
  addTurn("assistant", text);
  const turn = activeLane.lastElementChild;
  if (!(turn instanceof HTMLElement)) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ui-button retry-action";
  button.textContent = "Retry";
  button.addEventListener(
    "click",
    () => {
      button.remove();
      retry();
    },
    { once: true },
  );
  turn.appendChild(button);
}

function addMarker(text: string, className: string): void {
  if (text === "") return;
  emptyState.hidden = true;
  const item = document.createElement("p");
  item.className = className;
  item.textContent = text;
  appendToLane(item);
}

function addHistoricalSummary(
  summary: ConversationShellState["historicalSummaries"][number],
): void {
  addMarker(
    formatGuestHistorySummary(summary.summary, summary.status),
    "historical-summary",
  );
}

// Issue 07: a receipt records a completed action as a quiet marker, not an assistant turn.
function addReceipt(text: string): void {
  addMarker(text, "historical-summary receipt-marker");
}

function addTimelineEntry(entry: GuestTimelineEntry): void {
  if (entry.role === "receipt") addReceipt(entry.text);
  else addTurn(entry.role, entry.text);
}

function modeFor(surface: GuestSurfacePayload): PresentationMode {
  if (surface.mode) return surface.mode;
  return surface.kind === "unit-detail" || surface.kind === "request-draft" || surface.kind === "booking" || surface.kind === "payment" || surface.kind === "contact"
    ? "focused-surface"
    : "inline-surface";
}

function presentationFor(surface: GuestSurfacePayload): SurfacePresentation {
  const mode = modeFor(surface);
  return {
    surfaceId: surface.surfaceId,
    mode,
    // Missing authority metadata is unsafe: the browser must not infer that
    // a rich surface is actionable (ADR-0074).
    status: surface.status ?? "fallback",
    summary:
      surface.summary ??
      (mode === "focused-surface" ? "Stay details" : "Stays for your search"),
    ...(surface.textFallback === undefined
      ? {}
      : { textFallback: surface.textFallback }),
    ...(surface.conventionalRoute === undefined
      ? {}
      : { conventionalRoute: surface.conventionalRoute }),
    ...(surface.conventionalRouteLabel === undefined
      ? {}
      : { conventionalRouteLabel: surface.conventionalRouteLabel }),
  };
}

function fallback(mount: HTMLElement, surface: SurfacePresentation): void {
  // ADR-0074: retain safe explanatory text and conventional navigation when rich UI cannot mount.
  mountGuestSurfaceOrFallback({ attemptMount: () => ({ ok: false }), mount, surface, onConventionalRouteFallback: () => trackTelemetry("conventional-route-fallback") });
}

function showReopen(): void {
  if (workspaceReopen.disabled) {
    workspaceReopen.hidden = false;
    workspaceReopen.textContent = "Checking current details…";
    return;
  }
  const current = shellState.activeSurface;
  const canReopen =
    current?.mode === "focused-surface" &&
    current.status !== "deleted" && current.status !== "superseded" &&
    activePayload !== undefined;
  workspaceReopen.hidden = !canReopen || shellState.focusedSurfaceOpen;
  if (canReopen)
    workspaceReopen.textContent = `Return to ${guestSurfaceHeading(current.summary).toLocaleLowerCase()}`;
}

function enhanceGuestContactField(mount: HTMLElement, purpose: "phone" | "email" | undefined): void {
  if (purpose === undefined) return;
  const synchronize = (): void => {
    const wrapper = mount.querySelector<HTMLElement>(
      '[data-a2ui-component="TextField"]',
    );
    const label = wrapper?.querySelector<HTMLLabelElement>("label");
    const input = wrapper?.querySelector<HTMLInputElement>("input");
    if (!wrapper || !label || !input) return;
    const kind = purpose;

    const hint =
      wrapper.previousElementSibling instanceof HTMLElement &&
      wrapper.previousElementSibling.dataset.a2uiComponent === "Text"
        ? wrapper.previousElementSibling
        : undefined;
    const error =
      wrapper.nextElementSibling instanceof HTMLElement &&
      wrapper.nextElementSibling.dataset.a2uiComponent === "Text"
        ? wrapper.nextElementSibling
        : undefined;
    if (hint) hint.id = `guest-contact-${kind}-help`;
    input.required = true;
    const attributes = contactFieldAttributes(kind);
    input.type = attributes.type;
    input.inputMode = attributes.inputMode;
    input.autocomplete = attributes.autocomplete;
    if (error) {
      error.id = `guest-contact-${kind}-error`;
      error.setAttribute("role", "alert");
      error.classList.add("guest-field-error");
    }
    input.setAttribute(
      "aria-describedby",
      [hint?.id, error?.id].filter(Boolean).join(" "),
    );
    if (error) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  };
  synchronize();
  new MutationObserver(synchronize).observe(mount, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

let countdownTimer: ReturnType<typeof setInterval> | undefined;
let lastWaitingRefetch = Number.NEGATIVE_INFINITY;
const WAITING_REFETCH_GAP_MS = 5_000;

function stopCountdown(): void {
  if (countdownTimer !== undefined) clearInterval(countdownTimer);
  countdownTimer = undefined;
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return "Checking the latest status…";
  const minutes = Math.ceil(ms / 60_000);
  if (minutes <= 1) return "Less than 1 min left";
  return minutes < 60
    ? `${minutes} min left`
    : `${Math.floor(minutes / 60)} h ${minutes % 60} min left`;
}

/**
 * Issue 10 AC2 / ADR-0079: at zero the browser asks the server for the
 * authoritative state; it never marks anything expired itself. Refetches are
 * spaced so a deadline on the boundary cannot loop.
 */
function refetchWaitingState(retryWhile?: HTMLElement): void {
  const wait = Math.max(
    0,
    WAITING_REFETCH_GAP_MS - (performance.now() - lastWaitingRefetch),
  );
  setTimeout(() => {
    lastWaitingRefetch = performance.now();
    void refreshServerState().then((refreshed) => {
      // ADR-0074/0079: keep expired material actions disabled during a network outage,
      // and retry only while this offer is still the displayed projection.
      if (!refreshed && retryWhile?.isConnected)
        refetchWaitingState(retryWhile);
    });
  }, wait);
}

/**
 * Issue 10 AC1: the remaining time is the server's deadline minus the
 * server's own clock, then counted down with the monotonic clock. Changing
 * the device clock moves neither the countdown nor the displayed deadline.
 */
function startCountdown(
  waiting: GuestWaitingState,
  output: HTMLElement,
  fullMinutes = false,
): void {
  stopCountdown();
  const remainingAtReceipt =
    Date.parse(waiting.deadlineAt) - Date.parse(waiting.serverNow);
  const receivedAt = performance.now();
  const tick = (): void => {
    const remaining = remainingAtReceipt - (performance.now() - receivedAt);
    const minutes = Math.max(0, Math.ceil(remaining / 60_000));
    output.textContent = fullMinutes
      ? `${minutes} ${minutes === 1 ? "minute" : "minutes"} left`
      : formatRemaining(remaining);
    if (remaining <= 0) {
      stopCountdown();
      if (fullMinutes) {
        // ADR-0074: disable both the visible form and retained Weaver binding;
        // expiry itself still comes exclusively from the server projection.
        for (const button of output
          .closest('[data-a2ui-component="Column"]')
          ?.querySelectorAll<HTMLButtonElement>("button") ?? [])
          button.disabled = true;
        output.textContent = "Checking the latest status…";
      }
      refetchWaitingState(fullMinutes ? output : undefined);
    }
  };
  tick();
  if (remainingAtReceipt > 0) countdownTimer = setInterval(tick, 1_000);
}

function renderWaiting(waiting: GuestWaitingState): HTMLElement {
  // Issue 11: the kit's panel, neutral banner and steps replace the retired waiting panel.
  const panel = document.createElement("section");
  panel.className = "ui-panel";
  panel.dataset.waiting = waiting.kind;
  panel.setAttribute("aria-label", waiting.heading);
  const heading = document.createElement("h3");
  heading.textContent = waiting.heading;
  const deadline = document.createElement("p");
  deadline.className = "ui-banner ui-banner--neutral waiting-deadline";
  deadline.insertAdjacentHTML("afterbegin", icon("clock"));
  const text = document.createElement("span");
  const absolute = document.createElement("span");
  absolute.className = "waiting-deadline-time";
  absolute.textContent = waiting.deadlineText;
  const countdown = document.createElement("span");
  countdown.className = "waiting-countdown";
  text.append(absolute, " · ", countdown);
  deadline.append(text);
  const nextLabel = document.createElement("h4");
  nextLabel.textContent = "What happens next";
  const steps = (items: readonly string[]): HTMLElement => {
    const element = document.createElement("ol");
    element.className = "ui-steps";
    for (const item of items) {
      const entry = document.createElement("li");
      entry.textContent = item;
      element.appendChild(entry);
    }
    return element;
  };
  panel.append(heading, deadline, nextLabel, steps(waiting.outcomes));
  for (const line of waiting.meanwhile) {
    const note = document.createElement("p");
    note.textContent = line;
    panel.appendChild(note);
  }
  startCountdown(waiting, countdown);
  return panel;
}



/**
 * Issue 09: below 64rem a focused workspace is a full-screen sheet. While it
 * is open the page holds one extra history entry, so browser Back closes the
 * sheet (AC2). Closing it any other way removes that entry again.
 */
const sheetQuery = window.matchMedia("(max-width: 63.999rem)");
// Review fix: a reload keeps history.state, so an open sheet already owns this entry.
let sheetInHistory = isSheetState(history.state);

function isSheetState(state: unknown): boolean {
  return isRecord(state) && state.shortletSheet === true;
}

function sheetOpen(): boolean {
  return sheetQuery.matches && shellState.activeSurface?.mode === "focused-surface" && shellState.focusedSurfaceOpen && !activeWorkspace.hidden;
}

function syncSheetHistory(): void {
  const open = sheetOpen();
  if (open && !sheetInHistory) {
    history.pushState({ ...(isRecord(history.state) ? history.state : {}), shortletSheet: true }, "");
    sheetInHistory = true;
  } else if (!open && sheetInHistory) {
    sheetInHistory = false;
    if (isSheetState(history.state)) history.back();
  }
}

/** Closes the focused workspace (header Back, Escape or browser Back) and returns focus. */
function closeWorkspace(focusTarget: HTMLElement): void {
  focusedScrollTop = workspaceRegion.scrollTop;
  shellState = closeFocusedSurface(shellState);
  composerForm.dataset.focused = "false";
  routeHeading.textContent = appliedMode.emptyState.heading;
  activeWorkspace.hidden = true;
  showReopen();
  const target = focusTarget.isConnected && !focusTarget.hidden ? focusTarget : workspaceReopen;
  target.focus({ preventScroll: true });
  workspaceOpener = target;
  syncSheetHistory();
  trackTelemetry("focused-surface-closed");
  announce(appliedMode.workspace.returnedAnnouncement);
}

function askShortlet(): void {
  closeWorkspace(composerInput);
  composerInput.focus({ preventScroll: true });
  announce(appliedMode.workspace.readyAnnouncement);
}

function renderSurface(surface: GuestSurfacePayload, moveFocus = false): void {
  stopCountdown();
  // Issue 60: a new surface render retires the previous control, so a disabled reference from an earlier refusal cannot linger.
  lastActivatedControl = undefined;
  const presentation = presentationFor(surface);
  const previousScroll = activePayload?.surfaceId === surface.surfaceId
    ? shellState.focusedSurfaceOpen ? workspaceRegion.scrollTop : focusedScrollTop
    : 0;
  focusedScrollTop = previousScroll;
  composerForm.dataset.focused = presentation.mode === "focused-surface" ? "true" : "false";
  activePayload = surface;
  routeHeading.textContent = guestSurfaceHeading(presentation.summary);
  activeWorkspace.replaceChildren();
  activeWorkspace.hidden = presentation.mode === "focused-surface" && !shellState.focusedSurfaceOpen;
  activeWorkspace.tabIndex = -1;
  workspaceRegion.hidden = false;
  activeWorkspace.dataset.mode = presentation.mode;
  activeWorkspace.dataset.status = presentation.status;
  activeWorkspace.dataset.surfaceKind = surface.kind ?? "general";
  activeWorkspace.classList.remove("workspace-arrival");
  void activeWorkspace.offsetWidth;
  activeWorkspace.classList.add("workspace-arrival");

  const heading = document.createElement("div");
  heading.className = `workspace-heading workspace-heading--${presentation.mode}`;
  const title = document.createElement("h2");
  title.className = "sr-only";
  title.textContent = guestSurfaceHeading(presentation.summary);
  heading.appendChild(title);
  if (presentation.mode === "focused-surface") {
    const close = document.createElement("button");
    close.type = "button";
    close.className = "workspace-close ui-button ui-button--quiet";
    const arrow = document.createElement("span");
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "←";
    close.appendChild(arrow);
    close.append("Back");
    const detail = document.createElement("span");
    detail.className = "workspace-close__detail";
    detail.textContent = " to conversation";
    close.appendChild(detail);
    close.setAttribute("aria-label", "Back to conversation");
    close.addEventListener("click", () => closeWorkspace(workspaceReopen));
    heading.appendChild(close);
    const stage = document.createElement("span");
    stage.className = "workspace-stage-label";
    stage.textContent = guestSurfaceHeading(presentation.summary);
    heading.appendChild(stage);
    const ask = document.createElement("button");
    ask.type = "button";
    ask.className = "workspace-ask ui-button ui-button--quiet";
    ask.textContent = "Ask Shortlet";
    ask.addEventListener("click", askShortlet);
    heading.appendChild(ask);
  }
  activeWorkspace.appendChild(heading);

  const statusMessage = guestSurfaceStatusMessage(presentation.status);
  if (statusMessage) {
    const state = document.createElement("p");
    state.className = `workspace-status status-${presentation.status}`;
    state.dataset.status = presentation.status;
    state.textContent = statusMessage;
    activeWorkspace.appendChild(state);
  }
if (
    surface.waiting &&
    presentation.status === "active" &&
    !(surface.requestScreen && surface.waiting.kind === "operator-response") &&
    !(surface.offerScreen && surface.waiting.kind === "offer-payment-window") &&
    !(surface.paymentScreen && surface.waiting.kind === "payment-window")
  )
    activeWorkspace.appendChild(renderWaiting(surface.waiting));

  const mount = document.createElement("div");
  mount.className = "weaver-mount";
  activeWorkspace.appendChild(mount);
  if (presentation.status === "stale")trackTelemetry("stale-surface-encountered");
  if (presentation.status === "expired")
    trackTelemetry("expired-surface-encountered");
  // ADR-0074: closed offers contain no material action; their native recovery controls remain usable.
  const offerRecovery =
    surface.offerScreen &&
    surface.offerScreen.state !== "live" &&
    !surface.offerScreen.accept &&
    presentation.status === "expired";
  if (!canUseSurfaceActions(presentation.status) && !offerRecovery) {
    mount.setAttribute("inert", "");
    mount.setAttribute("aria-disabled", "true");
  }
  if (presentation.status === "fallback") { trackTelemetry("fallback-rendered"); fallback(mount, presentation); showReopen(); syncSheetHistory(); return; }

  if (createdSurfaceIds.has(surface.surfaceId)) {
    // ADR-0074: a refreshed server projection re-creates a surface this page
    // already holds. Weaver rejects duplicate createSurface ids, so the local
    // copy is removed first instead of falling back (issue 04a AC5).
    weaver.runtime.process(A2UI_PRODUCER.deleteSurface({ surfaceId: surface.surfaceId }));
    createdSurfaceIds.delete(surface.surfaceId);
  }
  for (const message of surface.a2uiMessages) {
    const processed = weaver.runtime.process(message);
    if (processed.ok && isRecord(message) && "createSurface" in message) createdSurfaceIds.add(surface.surfaceId);
    if (!processed.ok) {
      trackTelemetry("weaver-rendering-failure");
      trackTelemetry("fallback-rendered");
      fallback(mount, { ...presentation, status: "fallback" });
      announce("The workspace could not be displayed safely. A standard route remains available.", true);
      showReopen();
      syncSheetHistory();
      return;
    }
  }
  const mounted = mountGuestSurfaceOrFallback({
    attemptMount: () => weaver.mount({ surfaceId: surface.surfaceId, target: mount }),
    mount,
    surface: presentation,
    onConventionalRouteFallback: () => trackTelemetry("conventional-route-fallback"),
  });
  if (!mounted.ok) {
    trackTelemetry("weaver-rendering-failure");
    trackTelemetry("fallback-rendered");
    announce("The workspace could not be displayed safely. A standard route remains available.", true);
    showReopen();
    syncSheetHistory();
    return;
  }
  mount.dataset.renderer = "weaver";
  mount.dataset.surfaceId = surface.surfaceId;
  enhanceSurfacePresentation(mount, activeWorkspace.dataset.surfaceKind ?? "general");
  // Issue 13 (ADR 0074/0078): Weaver ignores the A2UI accessibility label, so the browser applies it after mount.
  applyAccessibilityLabels(mount, surface.a2uiMessages);
  if (surface.requestScreen && surface.waiting?.kind === "operator-response" && presentation.status === "active" && !mount.querySelector(".request-screen")) {
    // ADR-0074/0080: a partial older surface retains all waiting guidance as well as its readable Weaver facts.
    mount.before(renderWaiting(surface.waiting));
  }
  enhanceGuestContactField(mount, surface.contactPurpose);
  applyImageLayout(mount);
  enhanceListingImages(mount);
  if (presentation.conventionalRoute) {
    const link = document.createElement("a");
    link.href = presentation.conventionalRoute;
    link.className = "fallback-link";
    link.textContent = surface.conventionalRouteLabel ?? "Open full details";
    mount.appendChild(link);
  }
  showReopen();
  workspaceRegion.scrollTop = previousScroll;
  if (moveFocus) {
    activeWorkspace.scrollIntoView({ block: "start" });
    // Priority order, not document order: the heading precedes the close control in the DOM.
    const focusTarget = [".workspace-close", ".workspace-heading h2", ".weaver-mount h1", ".weaver-mount h2", ".weaver-mount h3", ".weaver-mount button"]
      .map((selector) => activeWorkspace.querySelector<HTMLElement>(selector))
      .find((element): element is HTMLElement => element !== null);
    if (focusTarget) {
      if (!focusTarget.matches("button, a, input, textarea, select, [tabindex]")) focusTarget.tabIndex = -1;
      focusTarget.classList.add("workspace-focus-target");
      requestAnimationFrame(() => {
        if (focusTarget.isConnected && !activeWorkspace.hidden) focusTarget.focus({ preventScroll: true });
      });
    }
  }
  trackTelemetry(presentation.mode === "focused-surface" ? "focused-surface-opened" : "inline-surface-rendered");
  if (moveFocus && !transcriptAnnouncesTurn) announce(`${guestSurfaceHeading(presentation.summary)} is ready.`);
  syncSheetHistory();
}

function acceptSurface(surface: GuestSurfacePayload, preserveConversation = false): void {
  const before = shellState.historicalSummaries.length;
  const firstSurface = shellState.activeSurface === undefined;
  const replaced = shellState.activeSurface !== undefined && shellState.activeSurface.surfaceId !== surface.surfaceId;
  const keepConversationOpen = preserveConversation || (!replaced && shellState.activeSurface?.mode === "focused-surface" && !shellState.focusedSurfaceOpen);
  shellState = replaceActiveSurface(shellState, presentationFor(surface));
  if (keepConversationOpen) shellState = closeFocusedSurface(shellState);
  if (replaced) trackTelemetry("surface-replaced");
  for (const summary of shellState.historicalSummaries.slice(before)) addHistoricalSummary(summary);
  // Issue 14: the first workspace is a task transition too, so it gets the same focus and one ready announcement.
  renderSurface(surface, (replaced || firstSurface) && !preserveConversation);
  syncSheetHistory();
}

function renderSurfaces(surfaces: readonly GuestSurfacePayload[], preserveConversation = false): void {
  for (const historical of surfaces.slice(0, -1)) {
    const presentation = presentationFor(historical);
    addHistoricalSummary({
      surfaceId: historical.surfaceId,
      status: presentation.status === "active" ? "superseded" : presentation.status,
      summary: presentation.summary,
    });
  }
  const current = surfaces.at(-1);
  if (current) acceptSurface(current, preserveConversation);
}

/**
 * Issue 08: the journey rail mirrors the server's projection; the browser
 * never advances it. State is spoken as text, not only shown as colour
 * (ADR-0078). Not announced itself: the conversation log carries the turn.
 */
function renderJourney(journey: GuestJourney | undefined): void {
  if (!journey) return;
  // Issue 07 review: a late webhook can confirm the booking after the callback said "not confirmed"; the server's journey
  // wins, so the stale banner goes once the booking is confirmed.
  if (journey.current === "confirmed") document.querySelector("[data-payment-notice]")?.remove();
  const list = document.createElement("ol");
  list.className = "ui-rail";
  let current: HTMLElement | undefined;
  for (const step of journey.steps) {
    const item = document.createElement("li");
    item.dataset.step = step.id;
    item.dataset.state = step.state;
    const tone = step.state === "failed" ? guestStatusTone(step.label) : undefined;
    if (tone) item.dataset.tone = tone;
    item.append(step.label);
    const state = document.createElement("span");
    state.className = "ui-sr-only";
    state.textContent = ` (${JOURNEY_STATE_TEXT[step.state]})`;
    item.appendChild(state);
    if (step.state === "current" || step.state === "failed") {
      if (step.state === "current") item.setAttribute("aria-current", "step");
      current = item;
    }
    list.appendChild(item);
  }
  journeyRail.replaceChildren(list);
  journeyRail.hidden = false;
  // Keep the current step visible at 320px without scrolling the page.
  if (current) list.scrollLeft = Math.max(0, current.offsetLeft - list.offsetLeft - list.clientWidth / 2 + current.offsetWidth / 2);
}

const TASK_START_EVENT = "platform.task.start";
const TASK_SWITCH_EVENT = "platform.task.switch";
let taskEventInFlight = false;

function taskRailSurfaceId(): string {
  return `thread-${threadId}:tasks`;
}

/** Issue 03i: one lane is one live transcript element. Hidden lanes take no layout and stay in the DOM. */
function createLaneElement(): HTMLElement {
  const lane = document.createElement("div");
  lane.className = "transcript-lane";
  return lane;
}

/** Issue 03i: every new turn, marker or choice goes to the visible lane. */
function appendToLane(node: Node): void {
  activeLane.appendChild(node);
}

/** Issue 03i (ADR 0107 decision 11): a switch's history step replaces the entry; it never pushes one. */
function replaceHistoryEntry(): void {
  try {
    window.history.replaceState(window.history.state, "", window.location.href);
  } catch {
    /* The address bar is a convenience; the lane still changes. */
  }
}

/**
 * Issue 03i (analysis 11.5): restores a lane's scroll now and again after the frame. A turn schedules its own scroll-to-end on the
 * next frame (addTurn), which would otherwise undo the restore.
 */
function restoreLaneScroll(top: number, behavior: ScrollBehavior): void {
  transcript.scrollTo({ top, behavior });
  requestAnimationFrame(() => transcript.scrollTo({ top, behavior }));
}

/** Issue 03i: a live region would announce every node a lane brings back, so announcements pause while the lane is written. */
function withoutLiveAnnouncement(write: () => void): void {
  transcript.setAttribute("aria-live", "off");
  try {
    write();
  } finally {
    transcript.setAttribute("aria-live", "polite");
  }
}

/** Issue 03i: the server's task list is the authority. A lane it no longer lists is removed, and a lane the server made active is shown. */
function syncLanes(tasks: readonly GuestTask[] | undefined): void {
  if (tasks === undefined) return;
  const active = tasks.find((task) => task.active);
  if (active !== undefined) {
    if (activeLaneId === undefined) bindVisibleLane(active.taskId);
    else if (active.taskId !== activeLaneId) {
      const origin: SwitchOrigin = laneFocusRequested ? "switcher" : "server";
      laneFocusRequested = false;
      const left = activeLane;
      const plan = enterLane(active.taskId, origin, tasks);
      // Issue 03i fix: the server has accepted this change, so the lane it leaves is final.
      if (plan !== undefined) {
        if (stripsControlsOnLeave("accepted")) stripLaneControls(left);
        void loadVisibleLane(active.taskId, plan.scrollTop);
      }
    }
  }
  for (const lane of laneCache.retain(tasks.map((task) => task.taskId))) {
    if (lane !== activeLane) lane.remove();
  }
}

/** The first lane is the one the page started in; its id arrives with the server's task list. */
function bindVisibleLane(taskId: string): void {
  activeLaneId = taskId;
  laneCache.put(taskId, activeLane);
}

/** Interactive controls of a lane (Retry, quick replies) are not kept: a cached lane shows its text only, and never sends. */
function stripLaneControls(lane: HTMLElement): void {
  for (const control of lane.querySelectorAll(".retry-action, .quick-replies")) control.remove();
}

/**
 * Issue 03i: shows a lane. A cached lane appears at once from memory with its scroll position; an uncached one appears empty until the
 * server's timeline arrives (loadVisibleLane). Returns the plan, or undefined when the server does not list the task.
 */
function enterLane(taskId: string, origin: SwitchOrigin, tasks: readonly GuestTask[] = lastTasks): SwitchPlan | undefined {
  if (taskId === activeLaneId) return undefined;
  const plan = planSwitch(laneCache, {
    target: taskId,
    serverTaskIds: tasks.map((task) => task.taskId),
    origin,
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  });
  if (plan.show === "none") return undefined;
  const outgoing = activeLaneId;
  if (outgoing !== undefined) laneCache.remember(outgoing, { scrollTop: transcript.scrollTop });
  let lane: HTMLElement;
  if (plan.show === "cached") {
    lane = laneCache.get(taskId)?.handle ?? createLaneElement();
  } else {
    lane = createLaneElement();
    lane.hidden = true;
    transcript.appendChild(lane);
  }
  // Issue 03i fix: the outgoing lane keeps its controls until the switch is final (switchFromRail and syncLanes strip it).
  activeLane.hidden = true;
  lane.hidden = false;
  activeLane = lane;
  activeLaneId = taskId;
  if (plan.show === "fresh") {
    for (const dropped of laneCache.put(taskId, lane)) {
      if (dropped !== lane) dropped.remove();
    }
  }
  if (plan.scroll === "restore" && plan.scrollTop !== undefined) {
    restoreLaneScroll(plan.scrollTop, plan.scrollBehavior);
  } else {
    transcript.scrollTop = 0;
  }
  replaceHistoryEntry();
  if (plan.focus === "lane-heading") routeHeading.focus();
  return plan;
}

/**
 * Issue 03i: the server's timeline for the visible lane. It is applied after a switch, so the server wins: a lane is rebuilt unless its
 * server rows are unchanged and the guest has added nothing to it since. The remembered scroll position is restored either way.
 */
async function loadVisibleLane(taskId: string, restoreTop?: number): Promise<void> {
  try {
    const response = (await postJson(`/api/state?threadId=${encodeURIComponent(threadId)}`)) as GuestStateResponse;
    if (!response.ok || response.timeline === undefined || activeLaneId !== taskId) return;
    const rows = response.timeline;
    const cached = laneCache.peek(taskId);
    // Owner decision (17 Nov 2026): a lane whose server lines still match is kept as rendered, with the guest's own lines. On any
    // mismatch the server wins and the rendered lane is rebuilt from the server's timeline.
    const kept = cached !== undefined && serverRowsMatch(cached.rows, rows);
    laneCache.remember(taskId, { rows });
    if (!kept) {
      withoutLiveAnnouncement(() => {
        activeLane.replaceChildren();
        for (const entry of rows) addTimelineEntry(entry);
      });
    }
    if (restoreTop !== undefined) restoreLaneScroll(restoreTop, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "auto");
  } catch {
    /* The lane stays as the cache showed it; the next switch asks again. */
  }
}

/**
 * Owner decision (17 Nov 2026): after a turn, the server's lines for the visible lane become the baseline a later switch compares
 * against. The lane is not re-rendered here, so the guest's own lines stay as they are.
 */
async function refreshLaneRows(): Promise<void> {
  const taskId = activeLaneId;
  if (taskId === undefined) return;
  try {
    const response = (await postJson(`/api/state?threadId=${encodeURIComponent(threadId)}`)) as GuestStateResponse;
    if (response.ok && response.timeline !== undefined && activeLaneId === taskId) laneCache.remember(taskId, { rows: response.timeline });
  } catch {
    /* The next switch compares against the last baseline; a mismatch falls back to the server. */
  }
}

/** A rail switch: the lane changes at once from memory (or empty), the event goes to the server, and the server's answer decides. */
async function switchFromRail(taskId: string): Promise<void> {
  if (taskEventInFlight || isLoading || taskId === activeLaneId) return;
  const previous = activeLaneId;
  const left = activeLane;
  const plan = enterLane(taskId, "switcher");
  if (plan === undefined) return;
  const attempted = activeLane;
  const ok = await sendTaskEvent(TASK_SWITCH_EVENT, { taskId }, "switcher");
  if (!ok) {
    // A refused or failed switch returns to the lane the guest was in; the server's state is read again.
    if (previous !== undefined && activeLaneId === taskId) enterLane(previous, "server");
    // Issue 03i fix: the lane that was attempted is final now. The lane the guest returns to keeps its own controls.
    if (stripsControlsOnLeave("refused")) stripLaneControls(attempted);
    void refreshServerState();
    return;
  }
  // Issue 03i fix: the server accepted the switch, so the lane it leaves is final.
  if (stripsControlsOnLeave("accepted")) stripLaneControls(left);
  // The response has re-rendered the rail and the workspace; the lane's remembered position is applied again after that.
  if (plan.scroll === "restore" && plan.scrollTop !== undefined) restoreLaneScroll(plan.scrollTop, plan.scrollBehavior);
  void loadVisibleLane(taskId, plan.scrollTop);
}

/** Slice 26: the task rail mirrors the server projection; a rail switch is the only switch the guest makes from it. */
function renderTaskRail(tasks: readonly GuestTask[] | undefined): void {
  lastTasks = tasks ?? [];
  syncLanes(tasks);
  if (!tasks || tasks.length <= 1) {
    taskRail.replaceChildren();
    taskRail.hidden = true;
    renderTaskStepHeader(undefined);
    return;
  }
  const list = document.createElement("ol");
  list.className = "ui-task-rail";
  for (const task of tasks) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ui-task-rail__item";
    if (task.active) button.classList.add("ui-task-rail__item--current");
    button.dataset.taskId = task.taskId;
    button.dataset.domain = task.domain;
    if (task.active) button.setAttribute("aria-current", "true");
    button.disabled = task.active;
    const chip = document.createElement("span");
    chip.className = "ui-domain-chip";
    chip.textContent = task.domainLabel;
    const status = document.createElement("span");
    status.className = "ui-task-rail__status";
    status.textContent = task.status;
    button.append(chip, status);
    if (task.badge !== undefined && task.badge > 0) {
      const badge = document.createElement("span");
      badge.className = "ui-task-badge";
      badge.textContent = String(task.badge);
      const updates = document.createElement("span");
      updates.className = "ui-sr-only";
      updates.textContent = ` ${GUEST_TASK_RAIL.updates}`;
      badge.appendChild(updates);
      button.appendChild(badge);
    }
    const state = document.createElement("span");
    state.className = "ui-sr-only";
    state.textContent = ` ${task.active ? GUEST_TASK_RAIL.currentTask : GUEST_TASK_RAIL.openTask}`;
    button.appendChild(state);
    button.addEventListener("click", () => {
      void switchFromRail(task.taskId);
    });
    item.appendChild(button);
    list.appendChild(item);
  }
  taskRail.replaceChildren(list);
  taskRail.hidden = false;
  renderTaskStepHeader(tasks);
}

/** Slice 26: the active task's domain chip and step, shown above the conversation. */
function renderTaskStepHeader(tasks: readonly GuestTask[] | undefined): void {
  const active = tasks?.find((task) => task.active);
  if (!active) {
    taskStepHeader.replaceChildren();
    taskStepHeader.hidden = true;
    return;
  }
  taskStepHeader.replaceChildren();
  const chip = document.createElement("span");
  chip.className = "ui-domain-chip";
  chip.textContent = active.domainLabel;
  const status = document.createElement("span");
  status.className = "ui-step-header__status";
  status.textContent = active.status;
  taskStepHeader.append(chip, status);
  taskStepHeader.hidden = false;
}

/**
 * Issue 03g (ADR 0107 decision 9): the mode strip and the mode sheet. Both offer the same radio group. The strip previews a mode in
 * an empty conversation and makes no request; a first message or a starter commits it (startTurn). The sheet commits at once.
 */
let modeChoices: readonly ModeChoice[] = [];
/** The domain previewed on the strip; undefined when the preview is the committed mode. Never sent to the server. */
let previewDomain: string | undefined;
let lastTasks: readonly GuestTask[] = [];
let modeSheet: HTMLDialogElement | undefined;
let modeMark: HTMLButtonElement | undefined;

function committedChoice(): ModeChoice | undefined {
  return modeChoices.find((choice) => choice.presentation.id === appliedMode.id);
}

function activeProposalOpen(): boolean {
  return lastTasks.some((task) => task.active && task.proposalOpen === true);
}

/** One choice: a visually hidden native radio whose label is the 44px target (the kit pattern for hidden radios). */
function modeChoiceLabel(choice: ModeChoice, group: string, checked: boolean, onChoose: () => void): HTMLLabelElement {
  const label = document.createElement("label");
  label.className = "ui-vertical-starter mode-choice";
  label.dataset.domain = choice.domain;
  const input = document.createElement("input");
  input.type = "radio";
  input.name = group;
  input.value = choice.domain;
  input.className = "ui-sr-only";
  input.checked = checked;
  input.addEventListener("change", onChoose);
  const mark = document.createElement("span");
  mark.className = "agent-mark";
  mark.setAttribute("aria-hidden", "true");
  mark.innerHTML = icon(choice.presentation.persona.icon);
  const title = document.createElement("span");
  title.className = "ui-vertical-starter__title";
  title.textContent = choice.presentation.persona.name;
  const description = document.createElement("p");
  description.className = "ui-vertical-starter__description";
  description.textContent = choice.presentation.tagline;
  label.append(input, mark, title, description);
  return label;
}

/** Fills the empty state, the route heading and the composer placeholder from one presentation (the preview and the commit). */
function renderEmptyCopy(mode: ModePresentation): void {
  routeHeading.textContent = mode.emptyState.heading;
  const heading = emptyState.querySelector<HTMLElement>("#empty-state-heading");
  if (heading) heading.textContent = mode.emptyState.heading;
  const body = emptyState.querySelector<HTMLElement>("p");
  if (body) body.textContent = mode.emptyState.body;
  const starters = emptyState.querySelector<HTMLElement>(".prompt-suggestions");
  if (starters) {
    starters.replaceChildren(...mode.emptyState.starters.map((starter) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "prompt-suggestion ui-chip";
      button.dataset.prompt = starter.prompt;
      button.textContent = starter.label;
      return button;
    }));
  }
  composerInput.placeholder = mode.composer.placeholder;
}

function previewChoose(choice: ModeChoice): void {
  const committed = committedChoice();
  previewDomain = committed?.domain === choice.domain ? undefined : choice.domain;
  renderEmptyCopy(choice.presentation);
  renderModeStrip();
}

/** The strip: shown in an empty conversation with two or more modes, hidden otherwise. */
function renderModeStrip(): void {
  verticalStarters.replaceChildren();
  if (!showsModeChooser(modeChoices) || emptyState.hidden) {
    verticalStarters.hidden = true;
    delete verticalStarters.dataset.previewMode;
    return;
  }
  const committed = committedChoice();
  const shown = modeChoices.find((choice) => choice.domain === previewDomain) ?? committed;
  const fieldset = document.createElement("fieldset");
  fieldset.className = "mode-choices";
  const legend = document.createElement("legend");
  legend.textContent = GUEST_MODE_CHOOSER.heading;
  fieldset.appendChild(legend);
  for (const choice of modeChoices) {
    fieldset.appendChild(modeChoiceLabel(choice, "mode-preview", choice.domain === shown?.domain, () => previewChoose(choice)));
  }
  verticalStarters.appendChild(fieldset);
  if (shown && committed && shown.domain !== committed.domain) verticalStarters.dataset.previewMode = shown.presentation.id;
  else delete verticalStarters.dataset.previewMode;
  verticalStarters.hidden = false;
}

/** The mark becomes a labelled control only with two or more modes (ADR 0107, 10 Nov amendment; ADR 0076 human state is unwired). */
function syncModeMark(): void {
  if (!markIsControl(modeChoices, false)) return;
  if (modeMark === undefined) {
    const mark = document.querySelector<HTMLElement>('.ui-appbar > .agent-mark[data-agent-mark="appbar"]');
    if (!mark) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ui-button ui-button--quiet mode-mark";
    button.setAttribute("aria-haspopup", "dialog");
    button.addEventListener("click", openModeSheet);
    mark.before(button);
    button.appendChild(mark);
    modeMark = button;
  }
  modeMark.setAttribute("aria-label", `${GUEST_MODE_CHOOSER.conciergeLabel(appliedMode.label)}. ${GUEST_MODE_CHOOSER.changeConcierge}`);
}

function ensureModeSheet(): HTMLDialogElement {
  if (modeSheet) return modeSheet;
  const sheet = document.createElement("dialog");
  sheet.className = "mode-sheet";
  sheet.setAttribute("aria-labelledby", "mode-sheet-heading");
  const heading = document.createElement("h2");
  heading.id = "mode-sheet-heading";
  const warning = document.createElement("p");
  warning.className = "mode-sheet__warning";
  warning.setAttribute("role", "note");
  warning.textContent = GUEST_MODE_CHOOSER.openProposalWarning;
  const list = document.createElement("div");
  list.className = "mode-sheet__choices";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "ui-button ui-button--quiet mode-sheet__close";
  close.textContent = GUEST_MODE_CHOOSER.close;
  close.addEventListener("click", () => sheet.close());
  sheet.addEventListener("close", () => modeMark?.focus({ preventScroll: true }));
  sheet.append(heading, warning, list, close);
  document.body.appendChild(sheet);
  modeSheet = sheet;
  return sheet;
}

/** Opens the sheet from the mark: a modal dialog, which adds no history entry. */
function openModeSheet(): void {
  const sheet = ensureModeSheet();
  const heading = sheet.querySelector<HTMLElement>("#mode-sheet-heading");
  if (heading) heading.textContent = GUEST_MODE_CHOOSER.conciergeLabel(appliedMode.label);
  const warning = sheet.querySelector<HTMLElement>(".mode-sheet__warning");
  if (warning) warning.hidden = !activeProposalOpen();
  const list = sheet.querySelector<HTMLElement>(".mode-sheet__choices");
  const committed = committedChoice();
  list?.replaceChildren(...modeChoices.map((choice) =>
    modeChoiceLabel(choice, "mode-sheet", choice.domain === committed?.domain, () => void chooseInSheet(choice))));
  if (!sheet.open) sheet.showModal();
}

/** The sheet commits at once: switch when the mode's task exists, otherwise start it. */
async function chooseInSheet(choice: ModeChoice): Promise<void> {
  if (choice.domain === committedChoice()?.domain) return;
  const task = lastTasks.find((entry) => entry.domain === choice.domain);
  const ok = task === undefined
    ? await sendTaskEvent(TASK_START_EVENT, { domain: choice.domain }, "switcher")
    : await sendTaskEvent(TASK_SWITCH_EVENT, { taskId: task.taskId }, "switcher");
  previewDomain = undefined;
  if (ok) modeSheet?.close();
  renderModeStrip();
}

/** Issue 03g (ADR 0107 decision 9): renders the strip and keeps the mark and the sheet in step with the validated choices. */
function renderVerticalStarters(verticals: readonly GuestVertical[] | undefined): void {
  modeChoices = chooseModes(verticals);
  syncModeMark();
  renderModeStrip();
}

/**
 * Issue 03g step 3: a first message or a starter sends `platform.task.start` for the previewed mode before the turn, when it differs
 * from the committed mode. A refused start keeps the server's mode and leaves the text in the composer.
 */
function startTurn(text: string): void {
  const start = startBeforeTurn(modeChoices, previewDomain, appliedMode.id);
  if (start === undefined) {
    previewDomain = undefined;
    withAgentMarkTransition(() => {
      addTurn("user", text);
      void sendTurn(text);
    });
    return;
  }
  void commitPreviewThenSend(start, text);
}

async function commitPreviewThenSend(start: ModeChoice, text: string): Promise<void> {
  holdModeSwitchForFirstMessage = true;
  let ok: boolean;
  try {
    ok = await sendTaskEvent(TASK_START_EVENT, { domain: start.domain }, "switcher");
  } finally {
    holdModeSwitchForFirstMessage = false;
  }
  previewDomain = undefined;
  if (!ok || appliedMode.id !== start.presentation.id) {
    renderEmptyCopy(appliedMode);
    renderModeStrip();
    return;
  }
  withAgentMarkTransition(() => {
    addTurn("user", text);
    void sendTurn(text);
  });
}

/** Sends a task-rail event; unlike surface actions, it needs no active surface. */
/** Returns whether the server accepted the event (issue 03g: a refused start keeps the server's mode). */
async function sendTaskEvent(name: string, context: Readonly<Record<string, unknown>>, origin: SwitchOrigin = "server"): Promise<boolean> {
  if (taskEventInFlight || isLoading) return false;
  taskEventInFlight = true;
  taskRail.setAttribute("aria-busy", "true");
  // Issue 03i: a switch from the switcher moves focus to the lane heading (the flag is read by syncLanes and cleared below).
  laneFocusRequested = origin === "switcher";
  try {
    const response = await postJson("/api/event", {
      threadId,
      name,
      surfaceId: taskRailSurfaceId(),
      sourceComponentId: "task-rail",
      timestamp: new Date().toISOString(),
      context,
    });
    if (!response.ok) {
      addTurn("assistant", response.message ?? "That task could not be opened.");
      announce(response.message ?? "That task could not be opened.", true);
      return false;
    }
    return renderResponse(response);
  } catch {
    addTurn("assistant", "That task could not be opened. Please try again.");
    announce("That task could not be opened. Please try again.", true);
    return false;
  } finally {
    taskEventInFlight = false;
    laneFocusRequested = false;
    taskRail.removeAttribute("aria-busy");
  }
}

type CriteriaField = "where" | "when" | "guests" | "budget";
const CRITERIA_FIELDS: readonly CriteriaField[] = ["where", "when", "guests", "budget"];
const CRITERIA_NAMES: Readonly<Record<CriteriaField, string>> = { where: "Where", when: "When", guests: "Guests", budget: "Budget" };
const CRITERIA_EMPTY: Readonly<Record<CriteriaField, string>> = { where: "Add area", when: "Add dates", guests: "Add guests", budget: "Add budget" };
const CRITERIA_EDIT_EVENT = "shortlet.criteria.edit";
const CRITERIA_UNDO_EVENT = "shortlet.criteria.undo";
let currentCriteria: GuestCriteria | undefined;
let openCriteriaField: CriteriaField | undefined;
let criteriaInFlight = false;

/**
 * Issue 03a: the strip shows the server's criteria (ADR-0004). The browser
 * never searches itself; each edit is an event the server applies and checks.
 */
function renderCriteria(criteria: GuestCriteria | undefined): void {
  if (!criteria) return;
  currentCriteria = criteria;
  const chips = criteriaStrip.querySelector<HTMLElement>(".criteria-chips");
  if (!chips) return;
  chips.replaceChildren();
  for (const field of CRITERIA_FIELDS) {
    const chip = document.createElement("button");
    chip.type = "button";
    const empty = criteria[field] === undefined;
    chip.className = `ui-chip criteria-chip${empty ? " ui-chip--add" : ""}`;
    chip.dataset.field = field;
    chip.dataset.empty = String(empty);
    chip.setAttribute("aria-expanded", String(openCriteriaField === field));
    chip.setAttribute("aria-controls", "criteria-editor");
    const name = document.createElement("span");
    name.className = "criteria-chip-name";
    name.textContent = `${CRITERIA_NAMES[field]}: `;
    // An empty chip names what it adds, since narrow screens hide the field name.
    // An empty criterion is a dashed "add" chip with a plus (decorative, from the shared icon set).
    if (empty) chip.insertAdjacentHTML("afterbegin", icon("plus"));
    chip.append(name, criteria[field]?.label ?? CRITERIA_EMPTY[field]);
    chip.disabled = !criteria.editable;
    chip.addEventListener("click", () => {
      if (openCriteriaField === field) closeCriteriaEditor(true);
      else openCriteriaEditor(field);
    });
    chips.appendChild(chip);
  }
  if (criteria.canUndo) {
    const undo = document.createElement("button");
    undo.type = "button";
    undo.className = "criteria-undo";
    undo.textContent = "Undo last change";
    undo.addEventListener("click", () => { void sendCriteriaEvent(CRITERIA_UNDO_EVENT, { basedOn: criteria.key }); });
    chips.appendChild(undo);
  }
  // The compact summary lists only the filled criteria (phones).
  criteriaSummary.textContent = CRITERIA_FIELDS.map((name) => criteria[name]?.label).filter((label): label is string => label !== undefined).join(" · ");
  criteriaStrip.hidden = false;
  if (!criteria.editable) closeCriteriaEditor(false);
}

/** Phones: expands or collapses the chips under the one-line summary. */
function setCriteriaExpanded(expanded: boolean): void {
  criteriaStrip.dataset.expanded = String(expanded);
  criteriaToggle.setAttribute("aria-expanded", String(expanded));
  criteriaToggle.textContent = expanded ? "Done" : "Edit search";
  if (!expanded) closeCriteriaEditor(false);
}

criteriaToggle.addEventListener("click", () => {
  const expand = criteriaStrip.dataset.expanded !== "true";
  setCriteriaExpanded(expand);
  if (expand) criteriaStrip.querySelector<HTMLElement>(".criteria-chip:not(:disabled)")?.focus();
});

function field(labelText: string, control: HTMLInputElement | HTMLSelectElement): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "ui-field";
  const label = document.createElement("label");
  label.className = "ui-field__label";
  label.htmlFor = control.id;
  label.textContent = labelText;
  wrapper.append(label, control);
  return wrapper;
}

function numberInput(id: string, name: string, value: number | undefined): HTMLInputElement {
  const input = document.createElement("input");
  input.id = id;
  input.name = name;
  input.type = "number";
  input.min = "1";
  input.step = "1";
  input.inputMode = "numeric";
  input.required = true;
  if (value !== undefined) input.value = String(value);
  return input;
}

function openCriteriaEditor(target: CriteriaField): void {
  const criteria = currentCriteria;
  if (!criteria?.editable) return;
  openCriteriaField = target;
  criteriaStatus.textContent = "";
  criteriaEditor.replaceChildren();
  criteriaEditor.setAttribute("aria-label", `Change ${CRITERIA_NAMES[target].toLocaleLowerCase()}`);
  if (target === "where") {
    const select = document.createElement("select");
    select.id = "criteria-area";
    select.name = "area";
    for (const area of criteria.areas) {
      const option = document.createElement("option");
      option.value = area.id;
      option.textContent = area.label;
      option.selected = area.id === criteria.where?.area;
      select.appendChild(option);
    }
    criteriaEditor.appendChild(field("Where", select));
  } else if (target === "when") {
    const date = document.createElement("input");
    date.id = "criteria-check-in";
    date.name = "checkIn";
    date.type = "date";
    date.required = true;
    if (criteria.when?.checkIn) date.value = criteria.when.checkIn;
    criteriaEditor.append(field("Arrival date", date), field("Nights", numberInput("criteria-nights", "nights", criteria.when?.nights)));
  } else if (target === "guests") {
    criteriaEditor.appendChild(field("Guests", numberInput("criteria-guests", "partySize", criteria.guests?.count)));
  } else {
    // Issue 03b / ADR-0015: the budget is compared with the All-In Stay Total, never the deposit.
    const per = document.createElement("select");
    per.id = "criteria-budget-per";
    per.name = "per";
    for (const [value, label] of [["stay", "Total for the stay"], ["night", "Per night"]] as const) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = (criteria.budget?.per ?? "stay") === value;
      per.appendChild(option);
    }
    const hint = document.createElement("p");
    hint.className = "ui-field__hint";
    hint.textContent = `Compared with the ${GUEST_GLOSSARY.allInStayTotal}, all fees included. The ${GUEST_GLOSSARY.refundableSecurityDeposit} is separate.`;
    criteriaEditor.append(field("Budget (₦)", numberInput("criteria-budget", "naira", criteria.budget?.naira)), field("Budget is", per), hint);
  }
  const actions = document.createElement("div");
  actions.className = "criteria-editor-actions";
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "ui-button ui-button--primary";
  submit.textContent = "Update search";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "ui-button ui-button--quiet";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => closeCriteriaEditor(true));
  actions.append(submit, cancel);
  if (target === "budget" && criteria.budget) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ui-button ui-button--quiet";
    remove.textContent = "Remove budget";
    remove.addEventListener("click", () => { void sendCriteriaEvent(CRITERIA_EDIT_EVENT, { field: "budget", clear: true, basedOn: criteria.key }); });
    actions.appendChild(remove);
  }
  criteriaEditor.appendChild(actions);
  criteriaEditor.hidden = false;
  for (const chip of criteriaStrip.querySelectorAll<HTMLElement>(".criteria-chip")) chip.setAttribute("aria-expanded", String(chip.dataset.field === target));
  criteriaEditor.querySelector<HTMLElement>("input, select")?.focus();
}

function closeCriteriaEditor(returnFocus: boolean): void {
  const closed = openCriteriaField;
  openCriteriaField = undefined;
  criteriaEditor.hidden = true;
  criteriaEditor.replaceChildren();
  for (const chip of criteriaStrip.querySelectorAll<HTMLElement>(".criteria-chip")) chip.setAttribute("aria-expanded", "false");
  // ADR-0078: focus returns to the chip that opened the editor.
  if (returnFocus && closed) criteriaStrip.querySelector<HTMLElement>(`.criteria-chip[data-field="${closed}"]`)?.focus();
}

async function sendCriteriaEvent(name: string, context: Readonly<Record<string, string | number | boolean>>): Promise<void> {
  if (criteriaInFlight || isLoading) return;
  criteriaInFlight = true;
  criteriaStrip.setAttribute("aria-busy", "true");
  const submit = criteriaEditor.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submit) submit.disabled = true;
  try {
    const response = await postJson("/api/event", { threadId, name, surfaceId: `thread-${threadId}:criteria`, sourceComponentId: "criteria-strip", timestamp: new Date().toISOString(), context });
    if (!response.ok) {
      // AC3: a refused edit is explained next to the strip; the criteria stay as they were.
      // Issue 11 (ADR 0072, 0074): the changed-elsewhere wording is the first choice for the strip's status text.
      // Issue 60: the same refusal-class handling as a surface action, so a stale class refreshes the authoritative state.
      const recovery = changedElsewhereRecovery(response.code);
      criteriaStatus.textContent = recovery?.message ?? response.message ?? "That change could not be applied.";
      const refusal = applyRefusal(response);
      if (recovery || refusal === "stale" || response.code === "CRITERIA_LOCKED") void refreshServerState();
      return;
    }
    criteriaStatus.textContent = "";
    closeCriteriaEditor(false);
    // A completed change folds the strip back into its summary on phones.
    setCriteriaExpanded(false);
    renderResponse(response);
  } catch {
    criteriaStatus.textContent = "The change could not be sent. Please try again.";
  } finally {
    criteriaInFlight = false;
    criteriaStrip.removeAttribute("aria-busy");
    if (submit?.isConnected) submit.disabled = false;
  }
}

criteriaEditor.addEventListener("submit", (event) => {
  event.preventDefault();
  const target = openCriteriaField;
  const criteria = currentCriteria;
  if (!target || !criteria) return;
  const data = new FormData(criteriaEditor);
  const whole = (name: string): number | undefined => {
    const value = Number(data.get(name));
    return Number.isInteger(value) && value >= 1 ? value : undefined;
  };
  if (target === "where") {
    void sendCriteriaEvent(CRITERIA_EDIT_EVENT, { field: "where", area: String(data.get("area") ?? ""), basedOn: criteria.key });
  } else if (target === "when") {
    const checkIn = String(data.get("checkIn") ?? "");
    const nights = whole("nights");
    if (checkIn === "" || nights === undefined) { criteriaStatus.textContent = "Enter an arrival date and a whole number of nights."; return; }
    void sendCriteriaEvent(CRITERIA_EDIT_EVENT, { field: "when", checkIn, nights, basedOn: criteria.key });
  } else if (target === "guests") {
    const partySize = whole("partySize");
    if (partySize === undefined) { criteriaStatus.textContent = "Enter a whole number of guests."; return; }
    void sendCriteriaEvent(CRITERIA_EDIT_EVENT, { field: "guests", partySize, basedOn: criteria.key });
  } else {
    const naira = whole("naira");
    if (naira === undefined) { criteriaStatus.textContent = "Enter a budget in whole naira."; return; }
    void sendCriteriaEvent(CRITERIA_EDIT_EVENT, { field: "budget", naira, per: data.get("per") === "night" ? "night" : "stay", basedOn: criteria.key });
  }
});

criteriaEditor.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  event.preventDefault();
  event.stopPropagation();
  closeCriteriaEditor(true);
});

function clearQuickReplies(): void {
  for (const group of transcript.querySelectorAll(".quick-replies")) group.remove();
}

/**
 * Issue 11 AC3 / issue 58: one-tap answers to the question just asked. A chip with an `edit` is structured guest input: it is sent as a
 * `shortlet.criteria.edit` event (like the criteria strip) and never reaches the scope classifier. A chip without one is the Guest's
 * own message, interpreted like typed text. A malformed chip is dropped by `isQuickReplyList`.
 */
function renderQuickReplies(replies: readonly GuestQuickReply[] | undefined): void {
  clearQuickReplies();
  const chips = isQuickReplyList(replies) ?? [];
  if (chips.length === 0) return;
  const group = document.createElement("div");
  group.className = "quick-replies";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Suggested replies");
  for (const reply of chips) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ui-chip quick-reply";
    button.textContent = reply.label;
    button.addEventListener("click", () => {
      // ADR 0074: a concurrent task event would be ignored by sendTaskEvent. Do not consume this guest choice first.
      if (isLoading || (reply.domain !== undefined && taskEventInFlight)) return;
      clearQuickReplies();
      addTurn("user", reply.label);
      if (reply.domain !== undefined) {
        // ADR 0107: the chip is guest consent, not classifier authority. The server checks the registered target.
        void sendTaskEvent(reply.taskId === undefined ? TASK_START_EVENT : TASK_SWITCH_EVENT,
          reply.taskId === undefined ? { domain: reply.domain } : { taskId: reply.taskId }, "chip");
        return;
      }
      if (reply.edit !== undefined) {
        const basedOn = currentCriteria?.key;
        if (basedOn === undefined) { void sendTurn(reply.label); return; }
        void sendCriteriaEvent(CRITERIA_EDIT_EVENT, { ...reply.edit, basedOn });
        return;
      }
      void sendTurn(reply.label);
    });
    group.appendChild(button);
  }
  appendToLane(group);
  transcript.scrollTop = transcript.scrollHeight;
}

/** The last refusal's signature, so an identical consecutive refusal is collapsed into one turn (issue 60). */
let lastRefusalSignature: string | undefined;
const REFUSAL_CLASSES: readonly RefusalClass[] = ["stale", "forbidden", "invalid", "unavailable", "busy"];

function isRefusalClass(value: unknown): value is RefusalClass {
  return typeof value === "string" && (REFUSAL_CLASSES as readonly string[]).includes(value);
}

/**
 * Issue 60: applies the `stale` part of the server's closed refusal class: retire, re-render and refresh the view. It never touches a
 * control, so a criteria-strip or chip refusal cannot disable a workspace button the guest tapped earlier. The class falls back to the
 * three legacy stale codes when an older server omits it.
 */
function applyRefusal(response: GuestResponse): RefusalClass | undefined {
  const byCode: RefusalClass | undefined = response.code === "STALE_SURFACE" || response.code === "STALE_ACTION" || response.code === "EXPIRED_SURFACE"
    ? "stale" : undefined;
  const cls = isRefusalClass(response.refusal) ? response.refusal : byCode;
  if (cls === "stale") {
    shellState = markActiveSurfaceStatus(shellState, response.code === "EXPIRED_SURFACE" ? "expired" : "stale");
    if (activePayload) renderSurface({ ...activePayload, status: shellState.activeSurface?.status });
    void refreshServerState();
  }
  return cls;
}

function renderResponse(response: GuestResponse): boolean {
  if (!response.ok) {
    // Issue 11 (ADR 0072, 0074): a stale, expired or changed-elsewhere rejection makes the current surface read-only and
    // refreshes the authoritative state. An artifact mismatch gets guest wording, never the server's internal message.
    const recovery = changedElsewhereRecovery(response.code);
    const message = recovery?.message ?? response.message ?? "That action could not be completed.";
    if (response.code === "quota_refusal" || response.code === "CONCIERGE_UNAVAILABLE") setAgentMark({ type: "turn-refused", code: response.code });
    const cls = applyRefusal(response);
    // Issue 11 (ADR 0072, 0074): a changed-elsewhere, stale or expired rejection makes the current surface read-only and refreshes it.
    if (recovery) {
      shellState = markActiveSurfaceStatus(shellState, recovery.kind);
      if (activePayload) renderSurface({ ...activePayload, status: shellState.activeSurface?.status });
      void refreshServerState();
    }
    // Issue 60: a forbidden or invalid workspace refusal disables only the control the guest just tapped, and only while that control is
    // still the live one in the workspace. The reference is cleared on every surface render, so a stale one can never block a later event.
    // A changed-elsewhere recovery wins: it never also disables the control.
    if (!recovery && (cls === "forbidden" || cls === "invalid") && lastActivatedControl?.isConnected && activeWorkspace.contains(lastActivatedControl)) {
      lastActivatedControl.setAttribute("aria-disabled", "true");
    }
    const signature = `${response.code ?? ""}|${cls ?? ""}|${message}`;
    const duplicate = signature === lastRefusalSignature;
    lastRefusalSignature = signature;
    if (!duplicate) addTurn("assistant", message);
    announce(message, true);
    return false;
  }
  lastRefusalSignature = undefined;
  renderJourney(response.journey);
  renderCriteria(response.criteria);
  renderTaskRail(response.tasks);
  renderVerticalStarters(response.verticals);
  applyResponseMode(response);
  for (const message of response.messages ?? []) addTurn("assistant", message);
  renderQuickReplies(response.quickReplies);
  if ((response.messages ?? []).length > 0) trackTelemetry("text-response-rendered");
  const surfaces = response.surfaces ?? [];
  transcriptAnnouncesTurn = (response.messages ?? []).length > 0;
  renderSurfaces(surfaces);
  transcriptAnnouncesTurn = false;
  // Receipts follow the markers for the steps they complete.
  for (const receipt of response.receipts ?? []) addReceipt(receipt);
  if (response.modeChange?.reason === "suggested") setAgentMark({ type: "mode-suggested" });
  else landAgentReply();
  // Issue 03l: a switch with no other announcement for this response is written alone.
  flushModeSwitchAnnouncement();
  return true;
}

async function refreshServerState(preserveConversation = shellState.activeSurface?.mode === "focused-surface" && !shellState.focusedSurfaceOpen): Promise<boolean> {
  try {
    const response = (await postJson(
      `/api/state?threadId=${encodeURIComponent(threadId)}`,
    )) as GuestStateResponse;
    if (response.ok) {
      renderJourney(response.journey);
      renderCriteria(response.criteria);
      renderTaskRail(response.tasks);
      renderVerticalStarters(response.verticals);
      applyResponseMode(response);
      flushModeSwitchAnnouncement();
      if (response.modeChange?.reason === "suggested") renderQuickReplies(response.quickReplies);
    }
    if (response.ok && response.surfaces && response.surfaces.length > 0) {
      renderSurfaces(response.surfaces, preserveConversation);
      return true;
    }
  } catch {
    /* The caller may retry a deadline refresh while its safe view remains mounted. */
  }
  return false;
}

async function postJson(path: string, body?: unknown, timeoutMs: number = CLIENT_REQUEST_TIMEOUT_MS, userSignal?: AbortSignal): Promise<GuestResponse> {
  const response = await fetch(path, body === undefined ? {} : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    // ADR-0079 bounds establishment; aborting the client wait never rolls back
    // a command that the server may already have committed. A turn waits for the
    // server's worst case (turn-budget.ts), so the wait ends only after the server can finish.
    signal: userSignal === undefined ? AbortSignal.timeout(timeoutMs) : combinedAbortSignal(userSignal, timeoutMs),
  });
  if (!response.ok) throw new Error(`Guest request failed with HTTP ${response.status}`);
  return readGuestResponse(await response.json());
}

function setLoading(next: boolean): void {
  isLoading = next;
  composerSubmit.disabled = next;
  composerForm.setAttribute("aria-busy", String(next));
  composerSubmit.textContent = next ? "Working…" : "Send";
  workingStatus.hidden = !next;
  workingStatus.textContent = next ? appliedMode.workspace.workingStatus : "";
  if (next) announce("Message sent. The concierge is working on your request.");
  // The presence dock shows the same working copy as #working-status while a turn is in flight (ADR 0107 decision 9).
  agentDock.hidden = !next;
  if (agentDockChip) agentDockChip.textContent = next ? appliedMode.workspace.workingStatus : "";
  setAgentMark({ type: next ? "turn-started" : "turn-ended" });
}

/**
 * The browser stopped waiting for a turn. The server may already have committed it, so the thread decides: when the
 * guest's message is in the thread the turn landed and its reply is shown; otherwise the caller offers Retry (ADR 0106).
 */
async function showLandedTurn(text: string): Promise<boolean> {
  try {
    const response = await postJson(`/api/state?threadId=${encodeURIComponent(threadId)}`) as GuestStateResponse;
    if (!response.ok || !response.timeline) return false;
    const entries = turnEntriesSince(response.timeline, text);
    if (entries === undefined) return false;
    for (const entry of entries) addTimelineEntry(entry);
    await refreshServerState();
    return true;
  } catch {
    return false;
  }
}

async function sendTurn(text: string): Promise<void> {
  if (isLoading) return;
  setLoading(true);
  const cancel = new AbortController();
  let stoppedByGuest = false;
  const showCancel = setTimeout(() => { turnCancel.hidden = false; }, TURN_STILL_WORKING_AFTER_MS);
  // A normal turn takes 5 to 8 seconds. A slower one says it is still working instead of looking stuck.
  const stillWorking = setTimeout(() => { workingStatus.textContent = GUEST_ASSISTANT_COPY.stillWorking; }, TURN_STILL_WORKING_AFTER_MS);
  const stop = (): void => { stoppedByGuest = true; cancel.abort(); };
  turnCancel.addEventListener("click", stop);
  try {
    if (renderResponse(await postJson("/api/turn", { threadId, text }, CLIENT_TURN_TIMEOUT_MS, cancel.signal))) {
      await refreshLaneRows();
      if (composerInput.value.trim() === text) composerInput.value = "";
    }
  } catch {
    if (stoppedByGuest) {
      // Issue 21: the server may still answer. Show a landed turn, otherwise keep the text and say so.
      if (await showLandedTurn(text)) {
        if (composerInput.value.trim() === text) composerInput.value = "";
      } else {
        if (composerInput.value.trim() === "") composerInput.value = text;
        addTurn("assistant", GUEST_ASSISTANT_COPY.stoppedWaiting);
        announce(GUEST_ASSISTANT_COPY.stoppedWaiting);
      }
    } else if (await showLandedTurn(text)) {
      if (composerInput.value.trim() === text) composerInput.value = "";
    } else {
      addRetryTurn("The concierge is temporarily unavailable. Your message is still in the composer; please try again.", () => { void sendTurn(text); });
      announce("The concierge is temporarily unavailable. Your message remains in the composer.", true);
    }
  } finally {
    clearTimeout(showCancel);
    clearTimeout(stillWorking);
    turnCancel.hidden = true;
    turnCancel.removeEventListener("click", stop);
    setLoading(false);
  }
}

async function sendEvent(action: { readonly name: string; readonly surfaceId: string; readonly sourceComponentId: string; readonly timestamp: string; readonly context: unknown }): Promise<void> {
  // Issue 60: a control disabled by a forbidden or invalid refusal stays inert only while it is the live control in the workspace.
  // A disconnected or replaced reference (for example after a re-render) must never block an event.
  if (lastActivatedControl?.isConnected && activeWorkspace.contains(lastActivatedControl) && lastActivatedControl.getAttribute("aria-disabled") === "true") return;
  const current = shellState.activeSurface;
  if (!current || current.surfaceId !== action.surfaceId || !canUseSurfaceActions(current.status)) {
    addTurn("assistant", fallbackSummary(current ?? { surfaceId: action.surfaceId, mode: "inline-surface", status: "stale", summary: "This workspace" }));
    announce("That action is no longer available. The workspace has been kept safe.", true);
    return;
  }
  // One surface action at a time: a second tap while the first is pending must not
  // submit twice. The activated button shows the shared ui-button loading state.
  if (eventInFlight) return;
  eventInFlight = true;
  setAgentMark({ type: "turn-started" });
  const control = lastActivatedControl?.isConnected && activeWorkspace.contains(lastActivatedControl) ? lastActivatedControl : undefined;
  control?.setAttribute("data-loading", "true");
  control?.setAttribute("aria-busy", "true");
  activeWorkspace.setAttribute("aria-busy", "true");
  try { renderResponse(await postJson("/api/event", { threadId, ...action })); }
  catch {
    addRetryTurn("The action could not be sent. Please try again.", () => { void sendEvent(action); });
    announce("The action could not be sent. Please try again.", true);
  }
  finally {
    eventInFlight = false;
    setAgentMark({ type: "turn-ended" });
    control?.removeAttribute("data-loading");
    control?.removeAttribute("aria-busy");
    activeWorkspace.removeAttribute("aria-busy");
  }
}

activeWorkspace.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>("button") : null;
  if (target && !target.closest("[hidden]")) lastActivatedControl = target;
}, { capture: true });

let weaver: BasicWebRuntime;
try {
  weaver = createShortletWebRuntime({
    resourcePolicy: ({ kind, url }) => kind === "image" ? safeImageResourceUrl(url) : undefined,
    onServerEvent: (event) => { void sendEvent(event.message.action); },
    // Weaver catalogues issue 06: the StayResults renderer offers "See both side by side" through this handler.
    onCompareBoth: () => void compareBoth(),
  });
} catch {
  addTurn("assistant", "The interface runtime could not start. Please reload the page.");
  announce("The interface runtime could not start. Please reload the page.", true);
  throw new Error("Unable to create the Weaver web runtime");
}

workspaceReopen.addEventListener("click", async () => {
  if (workspaceReopen.disabled) return;
  const previous = shellState.activeSurface;
  workspaceOpener = workspaceReopen;
  // ADR-0074: a retained task never regains action authority before a server projection arrives.
  workspaceReopen.disabled = true;
  workspaceReopen.setAttribute("aria-busy", "true");
  showReopen();
  composerInput.focus({ preventScroll: true });
  const refreshed = await refreshServerState(true);
  let recoveryFocus: HTMLButtonElement | undefined;
  if (!refreshed && activePayload) {
    shellState = markActiveSurfaceStatus(shellState, "stale");
    renderSurface({ ...activePayload, status: "stale" });
    shellState = reopenFocusedSurface(shellState);
    activeWorkspace.hidden = false;
    composerForm.dataset.focused = "true";
    const recovery = document.createElement("div");
    recovery.className = "workspace-recovery ui-panel";
    recovery.setAttribute("role", "status");
    const message = document.createElement("p");
    message.textContent = "Current details could not be checked. This saved view has no actions.";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.id = "workspace-retry-status";
    retry.className = "ui-button";
    retry.textContent = "Retry current status";
    retry.addEventListener("click", async () => {
      retry.disabled = true;
      retry.textContent = "Checking current status…";
      if (await refreshServerState()) {
        // ADR-0078: a successful refresh removes Retry, so focus its replacement task control.
        const taskBack = shellState.activeSurface?.mode === "focused-surface" && !activeWorkspace.hidden
          ? activeWorkspace.querySelector<HTMLElement>(".workspace-close")
          : null;
        (taskBack ?? composerInput).focus({ preventScroll: true });
        return;
      }
      retry.disabled = false;
      retry.textContent = "Retry current status";
      announce("Current details could not be checked. Try again or open the standard details.", true);
    });
    recovery.append(message, retry);
    if (activePayload.conventionalRoute) {
      const link = document.createElement("a");
      link.className = "ui-button";
      link.href = activePayload.conventionalRoute;
      link.textContent = "Open standard details";
      recovery.appendChild(link);
    }
    activeWorkspace.querySelector(".workspace-status")?.after(recovery);
    recoveryFocus = retry;
    syncSheetHistory();
    announce("Current details could not be checked. Review the saved details without using their actions.", true);
  }
  workspaceReopen.disabled = false;
  workspaceReopen.removeAttribute("aria-busy");
  showReopen();
  if (recoveryFocus) {
    recoveryFocus.focus({ preventScroll: true });
    requestAnimationFrame(() => { workspaceRegion.scrollTop = focusedScrollTop; });
    return;
  }
  const current = shellState.activeSurface;
  if (!current || current.surfaceId !== previous?.surfaceId ||
    (previous.status === "active" && current.status !== "active")) {
    composerInput.focus({ preventScroll: true });
    return;
  }
  shellState = reopenFocusedSurface(shellState);
  if (!shellState.focusedSurfaceOpen || !activePayload) return;
  activeWorkspace.hidden = false;
  composerForm.dataset.focused = "true";
  showReopen();
  syncSheetHistory();
  activeWorkspace.querySelector<HTMLElement>(".workspace-close")?.focus({ preventScroll: true });
  requestAnimationFrame(() => {
    if (sheetOpen()) workspaceRegion.scrollTop = focusedScrollTop;
  });
});

// ADR-0078: focused workspaces are keyboard-dismissible and restore focus to
// their opener; Escape elsewhere in the page leaves the conversation intact.
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || activeWorkspace.hidden || !activeWorkspace.contains(document.activeElement)) return;
  if (shellState.activeSurface?.mode !== "focused-surface" || !shellState.focusedSurfaceOpen) return;
  event.preventDefault();
  closeWorkspace(workspaceOpener?.isConnected && !workspaceOpener.hidden ? workspaceOpener : workspaceReopen);
});

// Issue 09 AC2: browser Back closes the open sheet instead of leaving the page.
window.addEventListener("popstate", () => {
  if (!sheetInHistory || isSheetState(history.state)) return;
  sheetInHistory = false;
  closeWorkspace(workspaceReopen);
});

sheetQuery.addEventListener("change", syncSheetHistory);

// Issue 03g: starters are delegated, because a preview re-renders them (the rendered buttons are created after load).
document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const suggestion = event.target.closest<HTMLButtonElement>(".prompt-suggestion[data-prompt]");
  if (!suggestion || !emptyState.contains(suggestion)) return;
  const text = suggestion.dataset.prompt?.trim();
  if (!text || isLoading) return;
  startTurn(text);
});
composerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = composerInput.value.trim();
  // Issue 03i: a message never races a switch that is still waiting for the server.
  if (text === "" || isLoading || taskEventInFlight) return;
  clearQuickReplies();
  startTurn(text);
});

async function restoreServerState(): Promise<boolean> {
  try {
    const response = await postJson(`/api/state?threadId=${encodeURIComponent(threadId)}`) as GuestStateResponse;
    if (!response.ok) return false;
    // ADR 0107: every task has its own lane; restore that lane's timeline even when the thread has multiple tasks.
    // Issue 03g: an empty conversation still shows the mode strip and the presentation's copy.
    renderVerticalStarters(response.verticals);
    if (response.mode !== undefined) applyResponseMode(response);
    if ((!response.timeline || response.timeline.length === 0) && !(response.tasks && response.tasks.length > 1)) return false;
    for (const entry of response.timeline ?? []) addTimelineEntry(entry);
    renderTaskRail(response.tasks);
    // Issue 03i: the restored lane's rows are the server's; a later switch back compares against them.
    if (activeLaneId !== undefined) laneCache.remember(activeLaneId, { rows: response.timeline ?? [] });
    renderJourney(response.journey);
    renderCriteria(response.criteria);
    renderSurfaces(response.surfaces ?? []);
    renderQuickReplies(response.quickReplies);
    if (response.modeChange?.reason === "suggested") setAgentMark({ type: "mode-suggested" });
    announce("Your conversation has been restored.");
    flushModeSwitchAnnouncement();
    return true;
  } catch { return false; }
}

function isCommittedWork(value: unknown): value is GuestCommittedWork {
  return isRecord(value)
    && (value.kind === "request" || value.kind === "offer" || value.kind === "reservation")
    && typeof value.threadId === "string"
    && typeof value.route === "string" && value.route.startsWith("/")
    && (value.unitTitle === undefined || typeof value.unitTitle === "string");
}

/** Issue 13a: the Guest's live work, or null when it can't be read. */
async function fetchCommittedWork(): Promise<readonly GuestCommittedWork[] | null> {
  try {
    const response = await fetch("/api/committed-work", { signal: AbortSignal.timeout(CLIENT_REQUEST_TIMEOUT_MS) });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (!isRecord(body) || body.ok !== true || !Array.isArray(body.committedWork) || !body.committedWork.every(isCommittedWork)) return null;
    return body.committedWork;
  } catch { return null; }
}

function committedWorkNote(work: GuestCommittedWork, text: string): HTMLElement {
  const note = document.createElement("div");
  note.className = "committed-work";
  note.dataset.kind = work.kind;
  const line = document.createElement("p");
  line.textContent = text;
  const link = document.createElement("a");
  link.className = "contact-link";
  link.href = work.route;
  link.textContent = guestNewConversationCopy(work.kind, work.unitTitle).link;
  note.append(line, link);
  return note;
}

/**
 * Issue 13a: a new conversation only switches the thread id this tab uses.
 * It never calls /api/reset and sends no command, so a Booking Request,
 * offer or Reservation is never withdrawn or cancelled (ADR-0079).
 */
function startNewConversation(): void {
  const next = `g-${crypto.randomUUID()}`;
  try {
    window.sessionStorage.setItem("shortlet-concierge-thread", next);
    window.location.replace("/");
  } catch {
    window.location.replace(`/?threadId=${encodeURIComponent(next)}`);
  }
}

function closeNewConversationConfirm(): void {
  newConversationConfirm.hidden = true;
  newConversationButton.setAttribute("aria-expanded", "false");
  newConversationButton.focus();
}

newConversationButton.setAttribute("aria-controls", "new-conversation-confirm");
newConversationButton.setAttribute("aria-expanded", "false");
newConversationButton.addEventListener("click", async () => {
  if (!newConversationConfirm.hidden) { closeNewConversationConfirm(); return; }
  newConversationButton.disabled = true;
  const work = await fetchCommittedWork();
  newConversationButton.disabled = false;
  if (work !== null && work.length === 0) { startNewConversation(); return; }
  // ADR-0072: live work gets an in-page confirmation that states the effect.
  const items = newConversationConfirm.querySelector<HTMLElement>(".new-conversation-items");
  if (items) {
    items.replaceChildren(...(work === null
      ? [Object.assign(document.createElement("p"), { textContent: GUEST_NEW_CONVERSATION.unknown })]
      : work.map((entry) => committedWorkNote(entry, guestNewConversationCopy(entry.kind, entry.unitTitle).confirm))));
  }
  newConversationConfirm.hidden = false;
  newConversationButton.setAttribute("aria-expanded", "true");
  // ADR 0078: move focus after the confirmation has been laid out, without racing pending surface focus.
  requestAnimationFrame(() => {
    if (!newConversationConfirm.hidden) newConversationStart.focus({ preventScroll: true });
  });
});
newConversationStart.addEventListener("click", startNewConversation);
newConversationCancel.addEventListener("click", closeNewConversationConfirm);
newConversationConfirm.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  event.preventDefault();
  closeNewConversationConfirm();
});

/** Issue 13a AC1: an empty conversation says the Guest's live work is unaffected. */
async function showCommittedWorkElsewhere(): Promise<void> {
  const work = (await fetchCommittedWork())?.filter((entry) => entry.threadId !== threadId) ?? [];
  if (work.length === 0 || transcript.querySelector(".committed-work")) return;
  const heading = transcript.querySelector("#conversation-heading");
  const notes = work.map((entry) => committedWorkNote(entry, guestNewConversationCopy(entry.kind, entry.unitTitle).stillActive));
  if (heading) heading.after(...notes); else transcript.prepend(...notes);
}

// Issue 10: a tab that was hidden may have missed its deadline; ask the server.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && activePayload?.waiting) void refreshServerState();
});

void restoreServerState().then((restored) => { if (!restored) void showCommittedWorkElsewhere(); });
