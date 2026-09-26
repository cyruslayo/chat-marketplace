/// <reference lib="dom" />
/**
 * Presentation-only browser shell. Weaver renders server-produced A2UI; the
 * browser never owns booking state or executes generated business logic.
 */
import { createBasicWebRuntime } from "@weaver/web";
import { GUEST_GLOSSARY } from "../../web-agent/src/guest-content.js";
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

interface GuestSurfacePayload {
  readonly surfaceId: string;
  readonly a2uiMessages: readonly unknown[];
  readonly mode?: PresentationMode;
  readonly status?: SurfaceLifecycleStatus;
  readonly summary?: string;
  readonly textFallback?: string;
  readonly conventionalRoute?: string;
  readonly conventionalRouteLabel?: string;
  readonly waiting?: GuestWaitingState;
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
interface GuestTimelineEntry { readonly role: "assistant" | "user" | "receipt"; readonly text: string; }
type JourneyStepState = "done" | "current" | "failed" | "upcoming";
interface GuestJourney { readonly current: string; readonly steps: readonly { readonly id: string; readonly label: string; readonly state: JourneyStepState }[]; }
interface GuestCriteria {
  readonly key: string;
  readonly editable: boolean;
  readonly canUndo: boolean;
  readonly where?: { readonly area?: string; readonly label: string };
  readonly when?: { readonly checkIn?: string; readonly nights?: number; readonly label: string };
  readonly guests?: { readonly count: number; readonly label: string };
  readonly budget?: { readonly naira: number; readonly per: "stay" | "night"; readonly label: string };
  readonly areas: readonly { readonly id: string; readonly label: string }[];
}
interface GuestResponse { readonly ok: boolean; readonly code?: string; readonly message?: string; readonly messages?: readonly string[]; readonly receipts?: readonly string[]; readonly surfaces?: readonly GuestSurfacePayload[]; readonly journey?: GuestJourney; readonly criteria?: GuestCriteria; readonly quickReplies?: readonly string[]; }
interface GuestStateResponse extends GuestResponse { readonly timeline?: readonly GuestTimelineEntry[]; }

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
const workingStatus = requiredElement<HTMLElement>("working-status");
const journeyRail = requiredElement<HTMLElement>("journey-rail");
const criteriaStrip = requiredElement<HTMLElement>("criteria-strip");
const criteriaEditor = requiredElement<HTMLFormElement>("criteria-editor");
const criteriaStatus = requiredElement<HTMLElement>("criteria-status");
const criteriaToggle = requiredElement<HTMLButtonElement>("criteria-toggle");
const criteriaSummary = requiredElement<HTMLElement>("criteria-summary");

function getThreadId(): string {
  try {
    const urlParam = new URLSearchParams(window.location.search).get("threadId");
    if (urlParam && /^g-[a-f0-9-]{6,64}$/.test(urlParam)) {
      window.sessionStorage.setItem("shortlet-concierge-thread", urlParam);
      return urlParam;
    }
    const stored = window.sessionStorage.getItem("shortlet-concierge-thread");
    if (stored && /^g-[a-f0-9-]{6,64}$/.test(stored)) return stored;
  } catch { /* Storage is optional; the server remains authoritative. */ }
  const created = `g-${crypto.randomUUID()}`;
  try { window.sessionStorage.setItem("shortlet-concierge-thread", created); } catch { /* Page-lifetime fallback. */ }
  return created;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSafeImageUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "") return false;
    if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")
      || hostname.endsWith(".internal") || hostname.endsWith(".lan")) return false;
    if (hostname.includes(":") || hostname.startsWith("[")) return false;
    if (/^(0\.|10\.|127\.|169\.254\.|192\.0\.0\.|192\.168\.|198\.(18|19)\.|224\.)/.test(hostname)) return false;
    if (/^100\.(6[4-9]|[78]\d|9\d)\./.test(hostname)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return false;
    if (hostname === "::1" || hostname.startsWith("fc") || hostname.startsWith("fd") || hostname.startsWith("fe8")) return false;
    return true;
  } catch {
    return false;
  }
}

function safeImageResourceUrl(value: string): string | undefined {
  if (!isSafeImageUrl(value)) return undefined;
  const parsed = new URL(value);
  const localBrowser = window.location.protocol === "http:" && (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost");
  return localBrowser && parsed.hostname === "pilot-local.invalid" ? `${window.location.origin}${parsed.pathname}` : value;
}

function enhanceListingImages(mount: HTMLElement): void {
  for (const [index, image] of [...mount.querySelectorAll("img")].entries()) {
    image.classList.add("guest-photo");
    image.referrerPolicy = "no-referrer";
    image.decoding = "async";
    image.loading = index === 0 ? "eager" : "lazy";
    if (index === 0) image.fetchPriority = "high";
    const failed = (): void => {
      const fallback = document.createElement("div");
      fallback.className = "photo-fallback";
      fallback.setAttribute("role", "img");
      fallback.setAttribute("aria-label", `${image.alt || "Property photo"} unavailable`);
      fallback.textContent = "Photo unavailable";
      image.replaceWith(fallback);
    };
    image.addEventListener("load", () => image.classList.add("is-loaded"), { once: true });
    image.addEventListener("error", failed, { once: true });
    if (image.complete && image.naturalWidth > 0) image.classList.add("is-loaded");
    else if (image.complete) failed();
  }
}

function wrapDirectChildren(parent: HTMLElement, className: string, children: readonly Element[]): HTMLElement | undefined {
  if (children.length === 0) return undefined;
  const wrapper = document.createElement("div");
  wrapper.className = className;
  parent.insertBefore(wrapper, children[0]!);
  for (const child of children) wrapper.appendChild(child);
  return wrapper;
}

function organizeUnitDetail(mount: HTMLElement): void {
  // Weaver adds a surface mount between our target and the Basic Catalog root.
  const root = mount.querySelector<HTMLElement>('[data-a2ui-component="Column"]');
  if (!root) return;
  root.classList.add("unit-detail-root");

  const gallery = document.createElement("div");
  gallery.className = "unit-gallery";
  gallery.setAttribute("role", "group");
  gallery.setAttribute("aria-label", "Property photos");
  while (root.firstElementChild instanceof HTMLImageElement) gallery.appendChild(root.firstElementChild);
  const noPhotos = root.firstElementChild;
  if (noPhotos instanceof HTMLElement && noPhotos.matches('[data-a2ui-component="Text"]') && /no property photos/i.test(noPhotos.textContent ?? "")) {
    noPhotos.classList.add("unit-photo-missing");
    gallery.appendChild(noPhotos);
  }
  if (gallery.childElementCount > 0) {
    const photos = [...gallery.children].filter((child) => child instanceof HTMLImageElement);
    if (photos.length === 0) gallery.classList.add("unit-gallery--fallback");
    if (photos.length > 1) gallery.classList.add("unit-gallery--mosaic");
    root.insertBefore(gallery, root.firstChild);
  }

  const children = [...root.children];
  const title = children.find((child) => child.tagName === "H2" && !/^(₦|NGN\b)/.test(child.textContent?.trim() ?? ""));
  const amount = children.find((child) => child !== title && child.tagName === "H2" && /^(₦|NGN\b)/.test(child.textContent?.trim() ?? ""));
  const priceLabel = children.find((child) => isPriceLabel(child.textContent?.trim() ?? ""));
  const location = children.find((child) => child.tagName === "SMALL" && child !== priceLabel);
  const facts = children.find((child) => child.tagName === "P" && child !== title);
  const dates = children.find((child) => child.tagName === "SMALL" && child !== location && child !== priceLabel && !/^(Refundable|Amount Due|Nightly|Mandatory)/.test(child.textContent?.trim() ?? ""));

  for (const [element, className] of [[title, "unit-title"], [location, "unit-location"], [facts, "unit-facts"], [dates, "unit-dates"]] as const) {
    element?.classList.add(className);
  }
  const overview = wrapDirectChildren(root, "unit-overview", [title, location, facts, dates].filter((element): element is Element => element !== undefined));
  if (overview) {
    overview.setAttribute("role", "group");
    overview.setAttribute("aria-label", "Stay overview");
  }

  if (priceLabel) {
    priceLabel.classList.add("unit-price-label");
    amount?.classList.add("unit-price-total");
    const descriptionHeading = children.find((child) => /^(About this place|Amenities)$/.test(child.textContent?.trim() ?? ""));
    const endIndex = descriptionHeading ? children.indexOf(descriptionHeading) : children.length;
    const startIndex = children.indexOf(priceLabel);
    const priceNodes = children.slice(startIndex, endIndex).filter((child) => child.parentElement === root);
    wrapDirectChildren(root, "unit-price-group", priceNodes);
  }

  const afterPrice = [...root.children];
  const about = afterPrice.find((child) => child.textContent?.trim() === "About this place");
  if (about) {
    const description = about.nextElementSibling;
    wrapDirectChildren(root, "unit-description", [about, ...(description ? [description] : [])]);
  }
  const afterDescription = [...root.children];
  const amenitiesHeading = afterDescription.find((child) => child.textContent?.trim() === "Amenities");
  if (amenitiesHeading) {
    const amenities = amenitiesHeading.nextElementSibling;
    wrapDirectChildren(root, "unit-amenities", [amenitiesHeading, ...(amenities ? [amenities] : [])]);
  }
  const action = root.querySelector<HTMLElement>(":scope > [data-a2ui-component=\"Row\"]");
  action?.classList.add("unit-actions");
  const grouped = new Set<Element>([gallery, ...(overview ? [overview] : []), ...root.querySelectorAll(":scope > .unit-price-group, :scope > .unit-description, :scope > .unit-amenities")]);
  const supporting = [...root.children].filter((child) => child !== action && !grouped.has(child));
  wrapDirectChildren(root, "unit-supporting-info", supporting);
}

function decorateDiscoveryCards(mount: HTMLElement): void {
  for (const card of mount.querySelectorAll<HTMLElement>('[data-a2ui-component="Card"]')) {
    card.classList.add("stay-card");
    card.setAttribute("role", "listitem");
    const list = card.parentElement;
    if (list instanceof HTMLElement) {
      list.classList.add("stay-grid");
      list.setAttribute("role", "list");
      list.setAttribute("aria-label", "Stay search results");
    }
    const body = card.querySelector<HTMLElement>(":scope > [data-weaver-mount] > [data-a2ui-component=\"Column\"], :scope > [data-a2ui-component=\"Column\"]");
    if (!body) continue;
    body.classList.add("stay-card__body");
    const children = [...body.children];
    const headings = children.filter((child) => child.tagName === "H3");
    // Issue 11: the fit-reason caption is matched by its text, not its position.
    const fit = children.find((child) => child.tagName === "SMALL" && (child.textContent ?? "").startsWith("Why it fits:"));
    fit?.classList.add("stay-card__fit");
    const smalls = children.filter((child) => child.tagName === "SMALL" && child !== fit);
    headings[0]?.classList.add("stay-card__title");
    const location = smalls[0];
    location?.classList.add("stay-card__location");
    children.find((child) => child.tagName === "P")?.classList.add("stay-card__facts");
    smalls[1]?.classList.add("stay-card__amenities");

    const priceLabel = children.find((child) => isPriceLabel(child.textContent?.trim() ?? ""));
    const action = children.find((child) => child.tagName === "BUTTON");
    if (priceLabel) {
      const priceStart = children.indexOf(priceLabel);
      const priceNodes = children.slice(priceStart, action ? children.indexOf(action) + 1 : undefined);
      const price = priceNodes.find((child) => child.tagName === "H3" && /^(₦|NGN\b)/.test(child.textContent?.trim() ?? ""));
      priceLabel.classList.add("stay-card__price-label");
      price?.classList.add("stay-card__price-total");
      if (action) action.classList.add("stay-card__action");
      wrapDirectChildren(body, "stay-card__price-area", priceNodes);
    }
  }
}

function enhanceSurfacePresentation(mount: HTMLElement, kind: string): void {
  mount.dataset.surfaceKind = kind;
  for (const button of mount.querySelectorAll<HTMLButtonElement>("button")) button.classList.add("guest-action");
  for (const field of mount.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select")) field.classList.add("guest-field");
  for (const text of mount.querySelectorAll<HTMLElement>('[data-a2ui-component="Text"]')) {
    const value = text.textContent?.trim() ?? "";
    const isHeading = /^H[1-6]$/.test(text.tagName);
    const tone = isHeading ? undefined : guestStatusTone(value);
    if (tone) text.classList.add("guest-status", `guest-status--${tone}`);
    if (/^No stays match|^No current matches/i.test(value)) text.classList.add("empty-state-title");
  }
  if (kind === "discovery") decorateDiscoveryCards(mount);
  if (kind === "unit-detail") organizeUnitDetail(mount);
}

function isPriceLabel(text: string): boolean {
  return text.startsWith(GUEST_GLOSSARY.allInStayTotal) || text.startsWith("Indicative nightly rate");
}

function isSafeInternalRoute(value: unknown): value is string {
  if (typeof value !== "string" || value === "" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return false;
  try { return new URL(value, window.location.origin).origin === window.location.origin; } catch { return false; }
}

function isStringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isWaitingState(value: unknown): value is GuestWaitingState {
  return isRecord(value)
    && ["operator-response", "offer-payment-window", "payment-window"].includes(String(value.kind))
    && typeof value.heading === "string" && typeof value.deadlineText === "string"
    && typeof value.deadlineAt === "string" && Number.isFinite(Date.parse(value.deadlineAt))
    && typeof value.serverNow === "string" && Number.isFinite(Date.parse(value.serverNow))
    && isStringList(value.outcomes) && isStringList(value.meanwhile);
}

function isSurfacePayload(value: unknown): value is GuestSurfacePayload {
  if (!isRecord(value) || typeof value.surfaceId !== "string" || value.surfaceId.trim() === "" || !Array.isArray(value.a2uiMessages)) return false;
  if (value.mode !== undefined && value.mode !== "text" && value.mode !== "inline-surface" && value.mode !== "focused-surface") return false;
  if (value.status !== undefined && (typeof value.status !== "string" || !["active", "superseded", "stale", "expired", "deleted", "fallback"].includes(value.status))) return false;
  if (value.summary !== undefined && typeof value.summary !== "string") return false;
  if (value.textFallback !== undefined && typeof value.textFallback !== "string") return false;
  if (value.conventionalRouteLabel !== undefined && typeof value.conventionalRouteLabel !== "string") return false;
  if (value.waiting !== undefined && !isWaitingState(value.waiting)) return false;
  return value.conventionalRoute === undefined || isSafeInternalRoute(value.conventionalRoute);
}

const JOURNEY_STATE_TEXT: Readonly<Record<JourneyStepState, string>> = {
  done: "completed", current: "current step", failed: "not completed", upcoming: "not started",
};

function isJourney(value: unknown): value is GuestJourney {
  if (!isRecord(value) || typeof value.current !== "string" || !Array.isArray(value.steps) || value.steps.length === 0) return false;
  return value.steps.every((step) => isRecord(step) && typeof step.id === "string" && typeof step.label === "string"
    && typeof step.state === "string" && step.state in JOURNEY_STATE_TEXT);
}

function isCriteria(value: unknown): value is GuestCriteria {
  if (!isRecord(value) || typeof value.key !== "string" || typeof value.editable !== "boolean" || typeof value.canUndo !== "boolean") return false;
  if (!Array.isArray(value.areas) || !value.areas.every((area) => isRecord(area) && typeof area.id === "string" && typeof area.label === "string")) return false;
  const labelled = (field: unknown): boolean => field === undefined || (isRecord(field) && typeof field.label === "string");
  return labelled(value.where) && labelled(value.when) && labelled(value.guests) && labelled(value.budget);
}

function readGuestResponse(value: unknown): GuestResponse {
  if (!isRecord(value) || typeof value.ok !== "boolean") throw new Error("Invalid server response");
  if (value.messages !== undefined && (!Array.isArray(value.messages) || value.messages.some((message) => typeof message !== "string"))) throw new Error("Invalid response messages");
  if (value.receipts !== undefined && (!Array.isArray(value.receipts) || value.receipts.some((receipt) => typeof receipt !== "string"))) throw new Error("Invalid response receipts");
  if (value.surfaces !== undefined && (!Array.isArray(value.surfaces) || value.surfaces.some((surface) => !isSurfacePayload(surface)))) throw new Error("Invalid response surface");
  if (value.journey !== undefined && !isJourney(value.journey)) throw new Error("Invalid response journey");
  if (value.criteria !== undefined && !isCriteria(value.criteria)) throw new Error("Invalid response criteria");
  if (value.quickReplies !== undefined && !isStringList(value.quickReplies)) throw new Error("Invalid response quick replies");
  return value as unknown as GuestResponse;
}

const threadId = getThreadId();
let shellState: ConversationShellState = createConversationShellState();
let activePayload: GuestSurfacePayload | undefined;
let isLoading = false;
let eventInFlight = false;
let lastActivatedControl: HTMLElement | undefined;
let workspaceOpener: HTMLElement | undefined;
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
  }).catch(() => { /* Observability must never block the interaction. */ });
}

function announce(text: string, assertive = false): void {
  // ADR-0078: separate polite progress from assertive errors so normal turns
  // never upgrade the live region's urgency.
  (assertive ? errorAnnouncer : announcer).textContent = text;
}

function addTurn(role: "assistant" | "user", text: string): void {
  emptyState.hidden = true;
  const turn = document.createElement("article");
  turn.className = `turn ${role}`;
  turn.setAttribute("aria-label", role === "user" ? "You" : "Shortlet Concierge");
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  turn.appendChild(bubble);
  transcript.appendChild(turn);
  transcript.scrollTop = transcript.scrollHeight;
  requestAnimationFrame(() => {
    if (turn.isConnected) transcript.scrollTop = transcript.scrollHeight;
  });
}

function addRetryTurn(text: string, retry: () => void): void {
  addTurn("assistant", text);
  const turn = transcript.lastElementChild;
  if (!(turn instanceof HTMLElement)) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ui-button retry-action";
  button.textContent = "Retry";
  button.addEventListener("click", () => { button.remove(); retry(); }, { once: true });
  turn.appendChild(button);
}

function addMarker(text: string, className: string): void {
  if (text === "") return;
  emptyState.hidden = true;
  const item = document.createElement("p");
  item.className = className;
  item.textContent = text;
  transcript.appendChild(item);
}

function addHistoricalSummary(summary: ConversationShellState["historicalSummaries"][number]): void {
  addMarker(formatGuestHistorySummary(summary.summary, summary.status), "historical-summary");
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
  return surface.surfaceId.includes(":unit:") || surface.surfaceId.includes(":request:") || surface.surfaceId.includes(":offer:") || surface.surfaceId.includes(":booking:") || surface.surfaceId.includes(":payment:")
    ? "focused-surface" : "inline-surface";
}

function presentationFor(surface: GuestSurfacePayload): SurfacePresentation {
  const mode = modeFor(surface);
  return {
    surfaceId: surface.surfaceId,
    mode,
    // Missing authority metadata is unsafe: the browser must not infer that
    // a rich surface is actionable (ADR-0074).
    status: surface.status ?? "fallback",
    summary: surface.summary ?? (mode === "focused-surface" ? "Stay details" : "Stays for your search"),
    ...(surface.textFallback === undefined ? {} : { textFallback: surface.textFallback }),
    ...(surface.conventionalRoute === undefined ? {} : { conventionalRoute: surface.conventionalRoute }),
    ...(surface.conventionalRouteLabel === undefined ? {} : { conventionalRouteLabel: surface.conventionalRouteLabel }),
  };
}

function fallback(mount: HTMLElement, surface: SurfacePresentation): void {
  // ADR-0074: retain safe explanatory text and conventional navigation when rich UI cannot mount.
  mount.replaceChildren();
  mount.dataset.renderer = "fallback";
  const box = document.createElement("div");
  box.className = "surface-fallback";
  const text = document.createElement("p");
  text.textContent = surface.textFallback ?? fallbackSummary(surface);
  box.appendChild(text);
  if (surface.conventionalRoute) {
    const link = document.createElement("a");
    link.href = surface.conventionalRoute;
    link.className = "fallback-link";
    link.textContent = surface.conventionalRouteLabel ?? "Open full details";
    box.appendChild(link);
    trackTelemetry("conventional-route-fallback");
  }
  mount.appendChild(box);
}

function showReopen(): void {
  const current = shellState.activeSurface;
  const canReopen = current?.mode === "focused-surface" && current.status === "active" && activePayload !== undefined;
  workspaceReopen.hidden = !canReopen || shellState.focusedSurfaceOpen;
  if (canReopen) workspaceReopen.textContent = `Return to ${guestSurfaceHeading(current.summary).toLocaleLowerCase()}`;
}

function enhanceGuestContactField(mount: HTMLElement): void {
  const synchronize = (): void => {
    const wrapper = mount.querySelector<HTMLElement>('[data-a2ui-component="TextField"]');
    const label = wrapper?.querySelector<HTMLLabelElement>("label");
    const input = wrapper?.querySelector<HTMLInputElement>("input");
    if (!wrapper || !label || !input) return;
    const labelText = label.textContent?.trim() ?? "";
    const kind = /^phone number/i.test(labelText) ? "phone" : /^email address/i.test(labelText) ? "email" : undefined;
    if (!kind) return;

    const hint = wrapper.previousElementSibling instanceof HTMLElement && wrapper.previousElementSibling.dataset.a2uiComponent === "Text"
      ? wrapper.previousElementSibling
      : undefined;
    const error = wrapper.nextElementSibling instanceof HTMLElement && wrapper.nextElementSibling.dataset.a2uiComponent === "Text"
      ? wrapper.nextElementSibling
      : undefined;
    if (hint) hint.id = `guest-contact-${kind}-help`;
    input.required = true;
    input.type = kind === "phone" ? "tel" : "email";
    input.inputMode = kind === "phone" ? "tel" : "email";
    input.autocomplete = kind === "phone" ? "tel" : "email";
    if (error) {
      error.id = `guest-contact-${kind}-error`;
      error.setAttribute("role", "alert");
      error.classList.add("guest-field-error");
    }
    input.setAttribute("aria-describedby", [hint?.id, error?.id].filter(Boolean).join(" "));
    if (error) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  };
  synchronize();
  new MutationObserver(synchronize).observe(mount, { childList: true, subtree: true, characterData: true });
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
  return minutes < 60 ? `${minutes} min left` : `${Math.floor(minutes / 60)} h ${minutes % 60} min left`;
}

/**
 * Issue 10 AC2 / ADR-0079: at zero the browser asks the server for the
 * authoritative state; it never marks anything expired itself. Refetches are
 * spaced so a deadline on the boundary cannot loop.
 */
function refetchWaitingState(): void {
  const wait = Math.max(0, WAITING_REFETCH_GAP_MS - (performance.now() - lastWaitingRefetch));
  setTimeout(() => {
    lastWaitingRefetch = performance.now();
    void refreshServerState();
  }, wait);
}

/**
 * Issue 10 AC1: the remaining time is the server's deadline minus the
 * server's own clock, then counted down with the monotonic clock. Changing
 * the device clock moves neither the countdown nor the displayed deadline.
 */
function startCountdown(waiting: GuestWaitingState, output: HTMLElement): void {
  stopCountdown();
  const remainingAtReceipt = Date.parse(waiting.deadlineAt) - Date.parse(waiting.serverNow);
  const receivedAt = performance.now();
  const tick = (): void => {
    const remaining = remainingAtReceipt - (performance.now() - receivedAt);
    output.textContent = formatRemaining(remaining);
    if (remaining <= 0) {
      stopCountdown();
      refetchWaitingState();
    }
  };
  tick();
  if (remainingAtReceipt > 0) countdownTimer = setInterval(tick, 1_000);
}

function renderWaiting(waiting: GuestWaitingState): HTMLElement {
  const panel = document.createElement("section");
  panel.className = "waiting-panel";
  panel.dataset.waiting = waiting.kind;
  panel.setAttribute("aria-label", waiting.heading);
  const heading = document.createElement("h3");
  heading.textContent = waiting.heading;
  const deadline = document.createElement("p");
  deadline.className = "waiting-deadline";
  const absolute = document.createElement("span");
  absolute.className = "waiting-deadline-time";
  absolute.textContent = waiting.deadlineText;
  const countdown = document.createElement("span");
  countdown.className = "waiting-countdown";
  deadline.append(absolute, " · ", countdown);
  const nextLabel = document.createElement("p");
  nextLabel.className = "waiting-label";
  nextLabel.textContent = "What happens next";
  const list = (items: readonly string[], className: string): HTMLElement => {
    const element = document.createElement("ul");
    element.className = className;
    for (const item of items) {
      const entry = document.createElement("li");
      entry.textContent = item;
      element.appendChild(entry);
    }
    return element;
  };
  panel.append(heading, deadline, nextLabel, list(waiting.outcomes, "waiting-outcomes"), list(waiting.meanwhile, "waiting-meanwhile"));
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
  shellState = closeFocusedSurface(shellState);
  composerForm.dataset.focused = "false";
  activeWorkspace.hidden = true;
  showReopen();
  const target = focusTarget.isConnected && !focusTarget.hidden ? focusTarget : workspaceReopen;
  target.focus({ preventScroll: true });
  workspaceOpener = target;
  syncSheetHistory();
  trackTelemetry("focused-surface-closed");
  announce("Returned to the conversation. Your stay details are still here.");
}

function renderSurface(surface: GuestSurfacePayload, moveFocus = false): void {
  stopCountdown();
  const presentation = presentationFor(surface);
  composerForm.dataset.focused = presentation.mode === "focused-surface" ? "true" : "false";
  activePayload = surface;
  activeWorkspace.replaceChildren();
  activeWorkspace.hidden = false;
  activeWorkspace.tabIndex = -1;
  workspaceRegion.hidden = false;
  activeWorkspace.dataset.mode = presentation.mode;
  activeWorkspace.dataset.status = presentation.status;
  activeWorkspace.dataset.surfaceKind = surface.surfaceId.includes(":unit:") ? "unit-detail"
    : surface.surfaceId.includes(":discovery:") ? "discovery"
      : surface.surfaceId.includes(":payment:") || surface.surfaceId.includes(":offer:") ? "payment"
        : surface.surfaceId.includes(":request:") ? "booking"
          : "general";
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
    close.append("Back to conversation");
    close.addEventListener("click", () => closeWorkspace(workspaceReopen));
    heading.appendChild(close);
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
  if (surface.waiting && presentation.status === "active") activeWorkspace.appendChild(renderWaiting(surface.waiting));

  const mount = document.createElement("div");
  mount.className = "weaver-mount";
  activeWorkspace.appendChild(mount);
  if (presentation.status === "stale") trackTelemetry("stale-surface-encountered");
  if (presentation.status === "expired") trackTelemetry("expired-surface-encountered");
  if (!canUseSurfaceActions(presentation.status)) {
    mount.setAttribute("inert", "");
    mount.setAttribute("aria-disabled", "true");
  }
  if (presentation.status === "fallback") { trackTelemetry("fallback-rendered"); fallback(mount, presentation); showReopen(); return; }

  if (createdSurfaceIds.has(surface.surfaceId)) {
    // ADR-0074: a refreshed server projection re-creates a surface this page
    // already holds. Weaver rejects duplicate createSurface ids, so the local
    // copy is removed first instead of falling back (issue 04a AC5).
    weaver.runtime.process({ version: "v0.9.1", deleteSurface: { surfaceId: surface.surfaceId } });
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
      return;
    }
  }
  const mounted = weaver.mount({ surfaceId: surface.surfaceId, target: mount });
  if (!mounted.ok) {
    trackTelemetry("weaver-rendering-failure");
    trackTelemetry("fallback-rendered");
    fallback(mount, { ...presentation, status: "fallback" });
    announce("The workspace could not be displayed safely. A standard route remains available.", true);
    showReopen();
    return;
  }
  mount.dataset.renderer = "weaver";
  mount.dataset.surfaceId = surface.surfaceId;
  enhanceSurfacePresentation(mount, activeWorkspace.dataset.surfaceKind ?? "general");
  enhanceGuestContactField(mount);
  enhanceListingImages(mount);
  if (presentation.conventionalRoute) {
    const link = document.createElement("a");
    link.href = presentation.conventionalRoute;
    link.className = "fallback-link";
    link.textContent = surface.conventionalRouteLabel ?? "Open full details";
    mount.appendChild(link);
  }
  showReopen();
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
  if (moveFocus) announce(`${guestSurfaceHeading(presentation.summary)} is ready.`);
  syncSheetHistory();
}

function acceptSurface(surface: GuestSurfacePayload): void {
  const before = shellState.historicalSummaries.length;
  const replaced = shellState.activeSurface !== undefined && shellState.activeSurface.surfaceId !== surface.surfaceId;
  shellState = replaceActiveSurface(shellState, presentationFor(surface));
  if (replaced) trackTelemetry("surface-replaced");
  for (const summary of shellState.historicalSummaries.slice(before)) addHistoricalSummary(summary);
  renderSurface(surface, replaced);
  syncSheetHistory();
}

function renderSurfaces(surfaces: readonly GuestSurfacePayload[]): void {
  for (const historical of surfaces.slice(0, -1)) {
    const presentation = presentationFor(historical);
    addHistoricalSummary({
      surfaceId: historical.surfaceId,
      status: presentation.status === "active" ? "superseded" : presentation.status,
      summary: presentation.summary,
    });
  }
  const current = surfaces.at(-1);
  if (current) acceptSurface(current);
}

/**
 * Issue 08: the journey rail mirrors the server's projection; the browser
 * never advances it. State is spoken as text, not only shown as colour
 * (ADR-0078). Not announced itself: the conversation log carries the turn.
 */
function renderJourney(journey: GuestJourney | undefined): void {
  if (!journey) return;
  const list = document.createElement("ol");
  let current: HTMLElement | undefined;
  for (const step of journey.steps) {
    const item = document.createElement("li");
    item.dataset.step = step.id;
    item.dataset.state = step.state;
    const tone = step.state === "failed" ? guestStatusTone(step.label) : undefined;
    if (tone) item.dataset.tone = tone;
    item.append(step.label);
    const state = document.createElement("span");
    state.className = "sr-only";
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
    chip.className = "ui-chip criteria-chip";
    chip.dataset.field = field;
    chip.setAttribute("aria-expanded", String(openCriteriaField === field));
    chip.setAttribute("aria-controls", "criteria-editor");
    const name = document.createElement("span");
    name.className = "criteria-chip-name";
    name.textContent = `${CRITERIA_NAMES[field]}: `;
    // An empty chip names what it adds, since narrow screens hide the field name.
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
      criteriaStatus.textContent = response.message ?? "That change could not be applied.";
      if (response.code === "STALE_SURFACE" || response.code === "CRITERIA_LOCKED") void refreshServerState();
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
 * Issue 11 AC3: one-tap answers to the question just asked. Tapping one sends
 * it as the Guest's own message; the server interprets it like typed text.
 */
function renderQuickReplies(replies: readonly string[] | undefined): void {
  clearQuickReplies();
  if (!replies || replies.length === 0) return;
  const group = document.createElement("div");
  group.className = "quick-replies";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Suggested replies");
  for (const text of replies) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ui-chip quick-reply";
    button.textContent = text;
    button.addEventListener("click", () => {
      if (isLoading) return;
      clearQuickReplies();
      addTurn("user", text);
      void sendTurn(text);
    });
    group.appendChild(button);
  }
  transcript.appendChild(group);
  transcript.scrollTop = transcript.scrollHeight;
}

function renderResponse(response: GuestResponse): boolean {
  if (!response.ok) {
    const message = response.message ?? "That action could not be completed.";
    if (response.code === "STALE_SURFACE" || response.code === "STALE_ACTION" || response.code === "EXPIRED_SURFACE") {
      shellState = markActiveSurfaceStatus(shellState, response.code === "EXPIRED_SURFACE" ? "expired" : "stale");
      if (activePayload) renderSurface({ ...activePayload, status: shellState.activeSurface?.status });
      void refreshServerState();
    }
    addTurn("assistant", message);
    announce(message, true);
    return false;
  }
  renderJourney(response.journey);
  renderCriteria(response.criteria);
  for (const message of response.messages ?? []) addTurn("assistant", message);
  renderQuickReplies(response.quickReplies);
  if ((response.messages ?? []).length > 0) trackTelemetry("text-response-rendered");
  const surfaces = response.surfaces ?? [];
  renderSurfaces(surfaces);
  // Receipts follow the markers for the steps they complete.
  for (const receipt of response.receipts ?? []) addReceipt(receipt);
  return true;
}

async function refreshServerState(): Promise<void> {
  try {
    const response = await postJson(`/api/state?threadId=${encodeURIComponent(threadId)}`) as GuestStateResponse;
    if (response.ok) { renderJourney(response.journey); renderCriteria(response.criteria); }
    if (response.ok && response.surfaces && response.surfaces.length > 0) {
      renderSurfaces(response.surfaces);
    }
  } catch { /* Recovery is best-effort over network */ }
}

async function postJson(path: string, body?: unknown): Promise<GuestResponse> {
  const response = await fetch(path, body === undefined ? {} : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    // ADR-0079 bounds establishment; aborting the client wait never rolls back
    // a command that the server may already have committed.
    signal: AbortSignal.timeout(10_000),
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
  workingStatus.textContent = next ? "Working on your request… Your stay details will stay here." : "";
  if (next) announce("Message sent. The concierge is working on your request.");
}

async function sendTurn(text: string): Promise<void> {
  if (isLoading) return;
  setLoading(true);
  try {
    if (renderResponse(await postJson("/api/turn", { threadId, text }))) {
      if (composerInput.value.trim() === text) composerInput.value = "";
    }
  } catch {
    addRetryTurn("The concierge is temporarily unavailable. Your message is still in the composer; please try again.", () => { void sendTurn(text); });
    announce("The concierge is temporarily unavailable. Your message remains in the composer.", true);
  } finally { setLoading(false); }
}

async function sendEvent(action: { readonly name: string; readonly surfaceId: string; readonly sourceComponentId: string; readonly timestamp: string; readonly context: unknown }): Promise<void> {
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
    control?.removeAttribute("data-loading");
    control?.removeAttribute("aria-busy");
    activeWorkspace.removeAttribute("aria-busy");
  }
}

activeWorkspace.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>("button") : null;
  if (target) lastActivatedControl = target;
}, { capture: true });

const created = createBasicWebRuntime({
  basic: {
    resourcePolicy: ({ kind, url }) => kind === "image" ? safeImageResourceUrl(url) : undefined,
  },
  rendering: { onServerEvent: (event) => { void sendEvent(event.message.action); } },
});
if (!created.ok) {
  addTurn("assistant", "The interface runtime could not start. Please reload the page.");
  announce("The interface runtime could not start. Please reload the page.", true);
  throw new Error("Unable to create the Weaver web runtime");
}
const weaver = created.value;

workspaceReopen.addEventListener("click", () => {
  workspaceOpener = workspaceReopen;
  shellState = reopenFocusedSurface(shellState);
  if (activePayload) {
    renderSurface(activePayload, true);
    activeWorkspace.querySelector<HTMLElement>(".workspace-close")?.focus({ preventScroll: true });
  }
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

// The sheet stops at the composer, so its height is shared with the CSS.
new ResizeObserver(() => {
  document.documentElement.style.setProperty("--composer-block-size", `${Math.ceil(composerForm.getBoundingClientRect().height)}px`);
}).observe(composerForm);
sheetQuery.addEventListener("change", syncSheetHistory);

for (const suggestion of document.querySelectorAll<HTMLButtonElement>(".prompt-suggestion[data-prompt]")) {
  suggestion.addEventListener("click", () => {
    const text = suggestion.dataset.prompt?.trim();
    if (!text || isLoading) return;
    addTurn("user", text);
    void sendTurn(text);
  });
}
composerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = composerInput.value.trim();
  if (text === "" || isLoading) return;
  clearQuickReplies();
  addTurn("user", text);
  void sendTurn(text);
});

async function restoreServerState(): Promise<boolean> {
  try {
    const response = await postJson(`/api/state?threadId=${encodeURIComponent(threadId)}`) as GuestStateResponse;
    if (!response.ok || !response.timeline || response.timeline.length === 0) return false;
    for (const entry of response.timeline) addTimelineEntry(entry);
    renderJourney(response.journey);
    renderCriteria(response.criteria);
    renderSurfaces(response.surfaces ?? []);
    announce("Your conversation has been restored.");
    return true;
  } catch { return false; }
}

// Issue 10: a tab that was hidden may have missed its deadline; ask the server.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && activePayload?.waiting) void refreshServerState();
});

void restoreServerState();
