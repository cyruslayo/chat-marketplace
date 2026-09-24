/// <reference lib="dom" />
/**
 * Presentation-only browser shell. Weaver renders server-produced A2UI; the
 * browser never owns booking state or executes generated business logic.
 */
import { createBasicWebRuntime } from "@weaver/web";
import {
  canUseSurfaceActions,
  closeFocusedSurface,
  createConversationShellState,
  fallbackSummary,
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
interface GuestTimelineEntry { readonly role: "assistant" | "user"; readonly text: string; }
interface GuestResponse { readonly ok: boolean; readonly code?: string; readonly message?: string; readonly messages?: readonly string[]; readonly surfaces?: readonly GuestSurfacePayload[]; }
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
    image.referrerPolicy = "no-referrer";
    image.decoding = "async";
    image.loading = index === 0 ? "eager" : "lazy";
    if (index === 0) image.fetchPriority = "high";
    image.addEventListener("error", () => {
      const fallback = document.createElement("div");
      fallback.className = "photo-fallback";
      fallback.setAttribute("role", "img");
      fallback.setAttribute("aria-label", `${image.alt || "Listing photo"} unavailable`);
      fallback.textContent = "Photo unavailable";
      image.replaceWith(fallback);
    }, { once: true });
  }
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
  if (value.surfaces !== undefined && (!Array.isArray(value.surfaces) || value.surfaces.some((surface) => !isSurfacePayload(surface)))) throw new Error("Invalid response surface");
  return value as unknown as GuestResponse;
}

const threadId = getThreadId();
let shellState: ConversationShellState = createConversationShellState();
let activePayload: GuestSurfacePayload | undefined;
let isLoading = false;

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
  announcer.setAttribute("aria-live", assertive ? "assertive" : "polite");
  announcer.textContent = text;
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
}

function addHistoricalSummary(summary: ConversationShellState["historicalSummaries"][number]): void {
  const item = document.createElement("p");
  item.className = "historical-summary";
  const lifecycle = summary.status === "superseded" ? "replaced by a newer workspace"
    : summary.status === "stale" ? "no longer current"
      : summary.status === "expired" ? "expired"
        : summary.status === "deleted" ? "no longer available" : "text view shown";
  item.textContent = `${summary.summary} · ${lifecycle}`;
  transcript.appendChild(item);
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
    summary: surface.summary ?? (mode === "focused-surface" ? "Focused workspace" : "Conversation workspace"),
    ...(surface.textFallback === undefined ? {} : { textFallback: surface.textFallback }),
    ...(surface.conventionalRoute === undefined ? {} : { conventionalRoute: surface.conventionalRoute }),
    ...(surface.conventionalRouteLabel === undefined ? {} : { conventionalRouteLabel: surface.conventionalRouteLabel }),
  };
}

function fallback(mount: HTMLElement, surface: SurfacePresentation): void {
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
    link.textContent = surface.conventionalRouteLabel ?? "Continue on the standard page";
    box.appendChild(link);
    trackTelemetry("conventional-route-fallback");
  }
  mount.appendChild(box);
}

function showReopen(): void {
  const current = shellState.activeSurface;
  const canReopen = current?.mode === "focused-surface" && current.status === "active" && activePayload !== undefined;
  workspaceReopen.hidden = !canReopen || shellState.focusedSurfaceOpen;
  if (canReopen) workspaceReopen.textContent = `Reopen ${current.summary}`;
}

function enhanceGuestContactField(mount: HTMLElement): void {
  const wrapper = mount.querySelector<HTMLElement>('[data-a2ui-component="TextField"]');
  const label = wrapper?.querySelector<HTMLLabelElement>("label");
  const input = wrapper?.querySelector<HTMLInputElement>("input");
  if (!wrapper || !label || !input) return;
  const labelText = label.textContent?.trim() ?? "";
  const kind = /^phone number/i.test(labelText) ? "phone" : /^email address/i.test(labelText) ? "email" : undefined;
  if (!kind) return;

  const hint = wrapper.previousElementSibling instanceof HTMLElement ? wrapper.previousElementSibling : undefined;
  if (hint?.dataset.a2uiComponent === "Text") {
    hint.id = `guest-contact-${kind}-help`;
    input.setAttribute("aria-describedby", hint.id);
  }
  input.required = true;
  input.type = kind === "phone" ? "tel" : "email";
  input.inputMode = kind === "phone" ? "tel" : "email";
  input.autocomplete = kind === "phone" ? "tel" : "email";

  const error = wrapper.nextElementSibling instanceof HTMLElement && wrapper.nextElementSibling.textContent?.trim().startsWith("Error:")
    ? wrapper.nextElementSibling
    : undefined;
  if (error) {
    error.id = `guest-contact-${kind}-error`;
    error.setAttribute("role", "alert");
    input.setAttribute("aria-describedby", [input.getAttribute("aria-describedby"), error.id].filter(Boolean).join(" "));
    input.setAttribute("aria-invalid", "true");
  }
}

function renderSurface(surface: GuestSurfacePayload, moveFocus = false): void {
  const presentation = presentationFor(surface);
  activePayload = surface;
  activeWorkspace.replaceChildren();
  activeWorkspace.hidden = false;
  activeWorkspace.tabIndex = -1;
  workspaceRegion.hidden = false;
  activeWorkspace.dataset.mode = presentation.mode;
  activeWorkspace.dataset.status = presentation.status;

  const heading = document.createElement("div");
  heading.className = "workspace-heading";
  const headingText = document.createElement("div");
  headingText.className = "workspace-heading-text";
  const eyebrow = document.createElement("span");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "Current workspace";
  const title = document.createElement("h2");
  title.className = "workspace-title";
  title.textContent = presentation.summary;
  headingText.append(eyebrow, title);
  heading.appendChild(headingText);
  if (presentation.mode === "focused-surface") {
    const close = document.createElement("button");
    close.type = "button";
    close.className = "workspace-close";
    close.textContent = "Back to conversation";
    close.addEventListener("click", () => {
      shellState = closeFocusedSurface(shellState);
      activeWorkspace.hidden = true;
      showReopen();
      workspaceReopen.focus();
      trackTelemetry("focused-surface-closed");
      announce("Focused workspace closed. Conversation context preserved.");
    });
    heading.appendChild(close);
  }
  activeWorkspace.appendChild(heading);

  const state = document.createElement("p");
  state.className = `workspace-status status-${presentation.status}`;
  state.dataset.status = presentation.status;
  state.textContent = presentation.status === "active" ? "Current workspace · Use the details below to continue."
    : presentation.status === "superseded" ? "Superseded · This workspace has been replaced. Use the current workspace below."
      : fallbackSummary(presentation);
  activeWorkspace.appendChild(state);

  const mount = document.createElement("div");
  mount.className = "weaver-mount";
  mount.setAttribute("aria-label", presentation.summary);
  activeWorkspace.appendChild(mount);
  if (presentation.status === "stale") trackTelemetry("stale-surface-encountered");
  if (presentation.status === "expired") trackTelemetry("expired-surface-encountered");
  if (!canUseSurfaceActions(presentation.status)) {
    mount.setAttribute("inert", "");
    mount.setAttribute("aria-disabled", "true");
  }
  if (presentation.status === "fallback") { trackTelemetry("fallback-rendered"); fallback(mount, presentation); showReopen(); return; }

  for (const message of surface.a2uiMessages) {
    const processed = weaver.runtime.process(message);
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
  enhanceGuestContactField(mount);
  enhanceListingImages(mount);
  if (presentation.conventionalRoute) {
    const link = document.createElement("a");
    link.href = presentation.conventionalRoute;
    link.className = "fallback-link";
    link.textContent = surface.conventionalRouteLabel ?? "Continue on the standard page";
    mount.appendChild(link);
  }
  showReopen();
  if (moveFocus) {
    activeWorkspace.scrollIntoView({ block: "start" });
    activeWorkspace.focus({ preventScroll: true });
  }
  trackTelemetry(presentation.mode === "focused-surface" ? "focused-surface-opened" : "inline-surface-rendered");
  if (moveFocus) announce(`${presentation.summary} is now the current workspace.`);
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
  });
  return readGuestResponse(await response.json());
}

function setLoading(next: boolean): void {
  isLoading = next;
  composerSubmit.disabled = next;
  composerForm.setAttribute("aria-busy", String(next));
  composerSubmit.textContent = next ? "Working…" : "Send";
  workingStatus.hidden = !next;
  workingStatus.textContent = next ? "Working on your request… Your current workspace remains available." : "";
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
    addTurn("assistant", "The concierge is temporarily unavailable. Your message is still in the composer; please try again.");
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
  try { renderResponse(await postJson("/api/event", { threadId, ...action })); }
  catch { addTurn("assistant", "The action could not be sent. Please try again."); announce("The action could not be sent. Please try again.", true); }
}

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
  shellState = reopenFocusedSurface(shellState);
  if (activePayload) {
    renderSurface(activePayload, true);
    activeWorkspace.focus({ preventScroll: true });
  }
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
    for (const entry of response.timeline) addTurn(entry.role, entry.text);
    renderSurfaces(response.surfaces ?? []);
    announce("Your conversation has been restored.");
    return true;
  } catch { return false; }
}

void restoreServerState();
