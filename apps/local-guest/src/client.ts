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
}
interface GuestTimelineEntry { readonly role: "assistant" | "user" | "receipt"; readonly text: string; }
interface GuestResponse { readonly ok: boolean; readonly code?: string; readonly message?: string; readonly messages?: readonly string[]; readonly receipts?: readonly string[]; readonly surfaces?: readonly GuestSurfacePayload[]; }
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
    const smalls = children.filter((child) => child.tagName === "SMALL");
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

function isSurfacePayload(value: unknown): value is GuestSurfacePayload {
  if (!isRecord(value) || typeof value.surfaceId !== "string" || value.surfaceId.trim() === "" || !Array.isArray(value.a2uiMessages)) return false;
  if (value.mode !== undefined && value.mode !== "text" && value.mode !== "inline-surface" && value.mode !== "focused-surface") return false;
  if (value.status !== undefined && (typeof value.status !== "string" || !["active", "superseded", "stale", "expired", "deleted", "fallback"].includes(value.status))) return false;
  if (value.summary !== undefined && typeof value.summary !== "string") return false;
  if (value.textFallback !== undefined && typeof value.textFallback !== "string") return false;
  if (value.conventionalRouteLabel !== undefined && typeof value.conventionalRouteLabel !== "string") return false;
  return value.conventionalRoute === undefined || isSafeInternalRoute(value.conventionalRoute);
}

function readGuestResponse(value: unknown): GuestResponse {
  if (!isRecord(value) || typeof value.ok !== "boolean") throw new Error("Invalid server response");
  if (value.messages !== undefined && (!Array.isArray(value.messages) || value.messages.some((message) => typeof message !== "string"))) throw new Error("Invalid response messages");
  if (value.receipts !== undefined && (!Array.isArray(value.receipts) || value.receipts.some((receipt) => typeof receipt !== "string"))) throw new Error("Invalid response receipts");
  if (value.surfaces !== undefined && (!Array.isArray(value.surfaces) || value.surfaces.some((surface) => !isSurfacePayload(surface)))) throw new Error("Invalid response surface");
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

function renderSurface(surface: GuestSurfacePayload, moveFocus = false): void {
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
    close.addEventListener("click", () => {
      shellState = closeFocusedSurface(shellState);
      composerForm.dataset.focused = "false";
      activeWorkspace.hidden = true;
      showReopen();
      workspaceOpener = workspaceReopen;
      workspaceOpener.focus({ preventScroll: true });
      trackTelemetry("focused-surface-closed");
      announce("Returned to the conversation. Your stay details are still here.");
    });
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
}

function acceptSurface(surface: GuestSurfacePayload): void {
  const before = shellState.historicalSummaries.length;
  const replaced = shellState.activeSurface !== undefined && shellState.activeSurface.surfaceId !== surface.surfaceId;
  shellState = replaceActiveSurface(shellState, presentationFor(surface));
  if (replaced) trackTelemetry("surface-replaced");
  for (const summary of shellState.historicalSummaries.slice(before)) addHistoricalSummary(summary);
  renderSurface(surface, replaced);
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
  for (const message of response.messages ?? []) addTurn("assistant", message);
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
  shellState = closeFocusedSurface(shellState);
  composerForm.dataset.focused = "false";
  activeWorkspace.hidden = true;
  showReopen();
  const target = workspaceOpener?.isConnected && !workspaceOpener.hidden ? workspaceOpener : workspaceReopen;
  target.focus({ preventScroll: true });
  workspaceOpener = target;
  trackTelemetry("focused-surface-closed");
  announce("Returned to the conversation. Your stay details are still here.");
});

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
  addTurn("user", text);
  void sendTurn(text);
});

async function restoreServerState(): Promise<boolean> {
  try {
    const response = await postJson(`/api/state?threadId=${encodeURIComponent(threadId)}`) as GuestStateResponse;
    if (!response.ok || !response.timeline || response.timeline.length === 0) return false;
    for (const entry of response.timeline) addTimelineEntry(entry);
    renderSurfaces(response.surfaces ?? []);
    announce("Your conversation has been restored.");
    return true;
  } catch { return false; }
}

void restoreServerState();
