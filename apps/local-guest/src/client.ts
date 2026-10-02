/// <reference lib="dom" />
/**
 * Presentation-only browser shell. Weaver renders server-produced A2UI; the
 * browser never owns booking state or executes generated business logic.
 */
import { createBasicWebRuntime } from "@weaver/web";
import { icon } from "../../web/src/ui-kit.js";
import {
  buildListingGallery,
  enhanceListingGallery,
  watchPhotoFailure,
} from "./listing-gallery.js";
import {
  GUEST_COMPARE_LABELS,
  GUEST_FACT_LABELS,
  GUEST_GLOSSARY,
  GUEST_NEW_CONVERSATION,
  UNIT_DETAIL_ABOUT_HEADING,
  guestFactValue,
  guestNewConversationCopy,
  type GuestCommittedWorkKind,
} from "../../web-agent/src/guest-content.js";
import {
  breakdownHtml,
  confirmationScreenHtml,
  offerScreenHtml,
  paymentScreenHtml,
  requestScreenHtml,
  resultRowPartsHtml,
  stayCardInnerHtml,
  ticketHtml,
  unitAboutHtml,
  unitTilesHtml,
  type StayCardParts,
} from "./guest-kit.js";
import type { ConfirmationContent } from "../../web-agent/src/confirmation-presentation.js";
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
  readonly requestScreen?: RequestScreenContent;
  readonly confirmation?: ConfirmationContent;
  readonly offerScreen?: OfferScreenContent;
  readonly paymentScreen?: PaymentScreenContent;
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
interface GuestResponse {
  readonly ok: boolean;
  readonly code?: string;
  readonly message?: string;
  readonly messages?: readonly string[];
  readonly receipts?: readonly string[];
  readonly surfaces?: readonly GuestSurfacePayload[];
  readonly journey?: GuestJourney;
  readonly criteria?: GuestCriteria;
  readonly quickReplies?: readonly string[];
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
const workingStatus = requiredElement<HTMLElement>("working-status");
const journeyRail = requiredElement<HTMLElement>("journey-rail");
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

const UNIT_TILE_FACTS = [
  { icon: "bed", label: GUEST_FACT_LABELS.bedrooms },
  { icon: "bath", label: GUEST_FACT_LABELS.bathrooms },
  { icon: "users", label: GUEST_FACT_LABELS.sleeps },
] as const;

function organizeUnitDetail(mount: HTMLElement): void {
  // Weaver adds a surface mount between our target and the Basic Catalog root.
  const root = mount.querySelector<HTMLElement>(
    '[data-a2ui-component="Column"]',
  );
  if (!root) return;
  const tileFacts = UNIT_TILE_FACTS.map((tile) => ({
    ...tile,
    fact: findFact([...root.children], tile.label),
  }));
  // ADR-0080: incomplete presentation facts retain the complete Weaver fallback, rather than a partial sheet.
  if (tileFacts.some((tile) => !tile.fact || tile.fact.value.trim() === ""))
    return;
  root.classList.add("unit-detail-root");

  // Guest gallery issue 01: the photos Weaver rendered become the shared listing gallery, as on the full page.
  const images: HTMLImageElement[] = [];
  for (const child of root.children) {
    if (!(child instanceof HTMLImageElement)) break;
    images.push(child);
  }
  const unitTitle =
    [...root.children]
      .find(
        (child) => child.tagName === "H2" && !isMoney(child.textContent ?? ""),
      )
      ?.textContent?.trim() || "this apartment";
  let gallery: HTMLElement | undefined;
  if (images.length > 0) {
    gallery = buildListingGallery(document, unitTitle, images);
  } else {
    const noPhotos = root.firstElementChild;
    if (
      noPhotos instanceof HTMLElement &&
      noPhotos.matches('[data-a2ui-component="Text"]') &&
      /no property photos/i.test(noPhotos.textContent ?? "")
    ) {
      gallery = document.createElement("div");
      gallery.className = "unit-gallery unit-gallery--fallback";
      gallery.setAttribute("role", "group");
      gallery.setAttribute("aria-label", "Property photos");
      noPhotos.classList.add("unit-photo-missing");
      gallery.appendChild(noPhotos);
    }
  }

  const children = [...root.children];
  const title = children.find(
    (child) => child.tagName === "H2" && !isMoney(child.textContent ?? ""),
  );
  const amount = children.find(
    (child) =>
      child !== title &&
      child.tagName === "H2" &&
      isMoney(child.textContent ?? ""),
  );
  const priceLabel = children.find((child) =>
    isPriceLabel(child.textContent?.trim() ?? ""),
  );
  const where = children.find(
    (child) => child.tagName === "SMALL" && child !== priceLabel,
  );
  const deposit = findFact(
    children,
    GUEST_FACT_LABELS.refundableSecurityDeposit,
  );
  const aboutHeading = children.find(
    (child) => child.textContent?.trim() === UNIT_DETAIL_ABOUT_HEADING,
  );
  const amenitiesHeading = children.find(
    (child) => child.textContent?.trim() === "Amenities",
  );
  const action = root.querySelector<HTMLElement>(
    ':scope > [data-a2ui-component="Row"]',
  );

  // Issue 06: the sheet is the same DOM the standalone page renders: where, serif title, facility tiles, price, about.
  const sheet = document.createElement("section");
  sheet.className = "unit-detail-sheet";
  sheet.setAttribute("aria-label", "Stay details");
  if (where) {
    where.classList.add("unit-detail-location");
    where.insertAdjacentHTML("afterbegin", icon("pin"));
    sheet.append(where);
  }
  if (title) sheet.append(title);
  {
    const template = document.createElement("template");
    template.innerHTML = unitTilesHtml(
      tileFacts.map((tile) => ({ icon: tile.icon, text: tile.fact!.value })),
    );
    sheet.append(template.content);
  }
  if (amount) {
    const template = document.createElement("template");
    template.innerHTML = breakdownHtml({
      total: amount.textContent?.trim() ?? "",
      ...(priceLabel
        ? { totalLabel: priceLabel.textContent?.trim() ?? "" }
        : {}),
      ...(deposit ? { deposit: deposit.value } : {}),
    });
    sheet.append(template.content);
  }
  if (aboutHeading) {
    const description = aboutHeading.nextElementSibling;
    const text = description?.textContent ?? "";
    aboutHeading.remove();
    description?.remove();
    const template = document.createElement("template");
    template.innerHTML = unitAboutHtml(text);
    sheet.append(template.content);
  }
  // Nothing partial: the facts, price and deposit elements became the sheet's kit markup and are removed.
  for (const tile of tileFacts) tile.fact!.element.remove();
  priceLabel?.remove();
  amount?.remove();
  deposit?.element.remove();

  const amenitiesNodes = amenitiesHeading
    ? [
        amenitiesHeading,
        ...(amenitiesHeading.nextElementSibling
          ? [amenitiesHeading.nextElementSibling]
          : []),
      ]
    : [];
  const supporting = [...root.children].filter(
    (child) => child !== action && !amenitiesNodes.includes(child),
  );

  root.replaceChildren();
  if (gallery) root.append(gallery);
  root.append(sheet);
  if (amenitiesNodes.length > 0) {
    const amenities = document.createElement("div");
    amenities.className = "unit-amenities";
    amenities.append(...amenitiesNodes);
    root.append(amenities);
  }
  if (supporting.length > 0) {
    const support = document.createElement("div");
    support.className = "unit-supporting-info";
    support.append(...supporting);
    root.append(support);
  }
  if (action) {
    action.classList.add("unit-actions");
    const bar = document.createElement("div");
    bar.className = "ui-action-bar unit-action-bar";
    const sum = document.createElement("p");
    sum.className = "ui-action-bar__sum";
    const total = amount?.textContent?.trim() ?? "";
    const label = priceLabel?.textContent?.trim() ?? "";
    if (total !== "") {
      const strong = document.createElement("strong");
      strong.textContent = total;
      sum.append(strong);
    }
    if (label !== "") {
      const meta = document.createElement("span");
      meta.className = "ui-money-metadata";
      meta.textContent = label;
      sum.append(meta);
    }
    if (sum.childElementCount > 0) bar.append(sum);
    bar.append(action);
    root.append(bar);
  }
}

/** The first child whose text is the fact `label`, with its value: facts are found only through the shared label table. */
function findFact(
  children: readonly Element[],
  label: string,
): { readonly element: Element; readonly value: string } | undefined {
  for (const child of children) {
    const value = guestFactValue(child.textContent ?? "", label);
    if (value !== undefined) return { element: child, value };
  }
  return undefined;
}

/** The day of the month in a ticket date such as "Thu, 10 Sept 2026": its first whole-number word. */
function dayNumeral(date: string): string | undefined {
  return date
    .replaceAll(",", " ")
    .split(" ")
    .find((word) => word !== "" && Number.isInteger(Number(word)));
}

/**
 * Swaps the Weaver elements that carry one booking fact each for the shared kit markup (guest-kit.ts), so a surface in
 * the chat has the same DOM, classes and text as its standalone page. Presentation only (ADR 0072).
 */
function replaceWithKitMarkup(
  root: HTMLElement,
  html: string,
  consumed: readonly (Element | undefined)[],
): void {
  const present = consumed.filter(
    (element): element is Element =>
      element !== undefined && element.parentElement === root,
  );
  const template = document.createElement("template");
  template.innerHTML = html;
  const markup = template.content.firstElementChild;
  if (present.length === 0 || markup === null) return;
  root.insertBefore(markup, present[0]!);
  for (const element of present) element.remove();
}

/**
 * Guest UI consistency issue 04: facts are found only through GUEST_FACT_LABELS, never by matching free wording. If a fact
 * is missing (no quote yet, an older surface) nothing partial is built and the surface stays as Weaver rendered it.
 */
function organizeBookingTicket(mount: HTMLElement): void {
  const root = mount.querySelector<HTMLElement>(
    '[data-a2ui-component="Column"]',
  );
  if (!root) return;
  const children = [...root.children];
  const title = children.find(
    (child) =>
      child.tagName === "H3" &&
      guestFactValue(
        child.textContent ?? "",
        GUEST_FACT_LABELS.allInStayTotal,
      ) === undefined,
  );
  const checkIn = findFact(children, GUEST_FACT_LABELS.checkIn);
  const checkOut = findFact(children, GUEST_FACT_LABELS.checkOut);
  const stay = findFact(children, GUEST_FACT_LABELS.stay);
  const checkInDay =
    checkIn === undefined ? undefined : dayNumeral(checkIn.value);
  const checkOutDay =
    checkOut === undefined ? undefined : dayNumeral(checkOut.value);
  if (title && checkIn && checkOut && stay && checkInDay && checkOutDay) {
    replaceWithKitMarkup(
      root,
      ticketHtml({
        title: title.textContent?.trim() ?? "",
        checkIn: { day: checkInDay, date: checkIn.value },
        checkOut: { day: checkOutDay, date: checkOut.value },
        foot:
          stay.value +
          (activePayload?.confirmation
            ? ` · Booking reference ${activePayload.confirmation.bookingReference}`
            : ""),
      }),
      [title, checkIn.element, checkOut.element, stay.element],
    );
  }
  const total = findFact(children, GUEST_FACT_LABELS.allInStayTotal);
  if (!total) return;
  const deposit = findFact(
    children,
    GUEST_FACT_LABELS.refundableSecurityDeposit,
  );
  const due = findFact(children, GUEST_FACT_LABELS.amountDueNow);
  const paid = findFact(children, GUEST_FACT_LABELS.amountPaid);
  const next = findFact(children, GUEST_FACT_LABELS.nextPayment);
  const condition = children.find(
    (child) =>
      child.textContent?.trim() === GUEST_FACT_LABELS.ifRequestAccepted,
  );
  replaceWithKitMarkup(
    root,
    breakdownHtml({
      ...(activePayload?.confirmation?.depositCollected
        ? { depositCollected: true }
        : {}),
      ...(condition ? { condition: GUEST_FACT_LABELS.ifRequestAccepted } : {}),
      total: total.value,
      ...(deposit ? { deposit: deposit.value } : {}),
      ...(due ? { due: due.value } : {}),
      ...(paid ? { paid: paid.value } : {}),
      ...(next ? { next: next.value } : {}),
    }),
    [
      condition,
      total.element,
      deposit?.element,
      due?.element,
      paid?.element,
      next?.element,
    ],
  );
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
  root
    .querySelector<HTMLAnchorElement>(".request-actions a")
    ?.addEventListener("click", (event) => {
      event.preventDefault();
      closeWorkspace(workspaceReopen);
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
  root.replaceChildren(template.content);
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

/** The Units a discovery surface offers, in the order its cards are shown, from the view-unit actions the server generated. */
function viewUnitIds(
  payload: GuestSurfacePayload | undefined,
): readonly string[] {
  const ids: string[] = [];
  for (const message of payload?.a2uiMessages ?? []) {
    if (
      !isRecord(message) ||
      !isRecord(message.updateComponents) ||
      !Array.isArray(message.updateComponents.components)
    )
      continue;
    for (const component of message.updateComponents.components) {
      if (
        !isRecord(component) ||
        !isRecord(component.action) ||
        !isRecord(component.action.event)
      )
        continue;
      const context = component.action.event.context;
      if (
        component.action.event.name === "shortlet.discovery.view-unit" &&
        isRecord(context) &&
        typeof context.unitId === "string"
      )
        ids.push(context.unitId);
    }
  }
  return ids;
}

function factIcon(text: string): "bed" | "bath" | "users" {
  return text.includes("bedroom")
    ? "bed"
    : text.includes("bathroom")
      ? "bath"
      : "users";
}

/** Sends the same view-unit event as the card's View apartment button; the link keeps working without JavaScript. */
function openStayFrom(
  link: HTMLElement,
  viewButton: HTMLButtonElement | undefined,
): void {
  if (!viewButton) return;
  link.addEventListener("click", (event) => {
    event.preventDefault();
    viewButton.click();
  });
}

/**
 * Guest UI consistency issue 05: each Weaver stay Card becomes the shared `.ui-stay-card` (the same markup as the search
 * page), and phones also get the compact result rows. Facts are found through the label table; a card missing a required
 * fact is left as Weaver rendered it.
 */
function decorateDiscoveryCards(mount: HTMLElement): void {
  const unitIds = viewUnitIds(activePayload);
  const rows: {
    readonly html: string;
    readonly view: HTMLButtonElement | undefined;
  }[] = [];
  let listElement: HTMLElement | undefined;
  for (const [index, card] of [
    ...mount.querySelectorAll<HTMLElement>('[data-a2ui-component="Card"]'),
  ].entries()) {
    const list = card.parentElement;
    if (list instanceof HTMLElement) {
      list.classList.add("stay-grid");
      list.setAttribute("role", "list");
      list.setAttribute("aria-label", "Stay search results");
      listElement = list;
    }
    const body = card.querySelector<HTMLElement>(
      ':scope > [data-weaver-mount] > [data-a2ui-component="Column"], :scope > [data-a2ui-component="Column"]',
    );
    const unitId = unitIds[index];
    if (!body || unitId === undefined) continue;
    const children = [...body.children];
    const title = children.find(
      (child) => child.tagName === "H3" && !isMoney(child.textContent ?? ""),
    );
    const where = findFact(children, GUEST_FACT_LABELS.where);
    const factLine = children.find((child) => child.tagName === "P");
    const priceLabel = children.find((child) =>
      isPriceLabel(child.textContent?.trim() ?? ""),
    );
    const price = children.find(
      (child) => child.tagName === "H3" && isMoney(child.textContent ?? ""),
    );
    if (!title || !where || !factLine || !priceLabel || !price) continue;
    const deposit = findFact(
      children,
      GUEST_FACT_LABELS.refundableSecurityDeposit,
    );
    const fit = findFact(children, GUEST_FACT_LABELS.fitReason);
    const photos = findFact(children, GUEST_FACT_LABELS.photos);
    const photoCount = photos === undefined ? undefined : Number(photos.value);
    const image = children.find(
      (child): child is HTMLImageElement => child instanceof HTMLImageElement,
    );
    const buttons = children.filter(
      (child): child is HTMLButtonElement => child instanceof HTMLButtonElement,
    );
    const view = buttons[0];
    const parts: StayCardParts = {
      href: `/stays/${encodeURIComponent(unitId)}`,
      title: title.textContent?.trim() ?? "",
      where: where.value,
      facts: (factLine.textContent ?? "")
        .split(" · ")
        .map((text) => text.trim())
        .filter(Boolean)
        .map((text) => ({ icon: factIcon(text), text })),
      total: price.textContent?.trim() ?? "",
      totalLabel: priceLabel.textContent?.trim() ?? "",
      ...(deposit ? { deposit: deposit.value } : {}),
      ...(image?.src ? { photoSrc: image.src } : {}),
      ...(photoCount === undefined ? {} : { photoCount }),
    };
    // Whatever else Weaver rendered (the fit reason, amenity highlights, a budget note) stays, after the facts.
    const known = new Set<Element | undefined>([
      title,
      where.element,
      factLine,
      priceLabel,
      price,
      deposit?.element,
      fit?.element,
      photos?.element,
      image,
      ...buttons,
    ]);
    const extras = children.filter(
      (child) =>
        !known.has(child) &&
        child.getAttribute("data-a2ui-component") !== "Divider",
    );
    const template = document.createElement("template");
    template.innerHTML = stayCardInnerHtml(parts);
    card.replaceChildren(template.content);
    card.classList.add("stay-card", "ui-stay-card");
    card.setAttribute("role", "listitem");
    const anchor = card.querySelector<HTMLAnchorElement>(".ui-stay-card__view");
    if (view && anchor) {
      view.classList.add(
        "ui-button",
        "ui-button--primary",
        "ui-button--block",
        "ui-stay-card__view",
      );
      anchor.replaceWith(view);
    } else anchor?.remove();
    openStayFrom(
      card.querySelector<HTMLElement>(".ui-stay-card__title a")!,
      view,
    );
    fit?.element.classList.add("stay-card__fit");
    const facts = card.querySelector(".ui-stay-card__facts");
    for (const extra of [...extras].reverse()) facts?.after(extra);
    if (fit) facts?.after(fit.element);
    // Compare follows View apartment (issue 13b).
    for (const extra of buttons.slice(1)) {
      extra.classList.add("stay-card__compare", "ui-link");
      card.appendChild(extra);
    }
    rows.push({ html: resultRowPartsHtml(parts), view });
  }
  if (rows.length > 0 && listElement) {
    const rowList = document.createElement("div");
    rowList.className = "ui-result-rows";
    rowList.setAttribute("role", "list");
    rowList.setAttribute("aria-label", "Stays for your search");
    for (const row of rows) {
      const template = document.createElement("template");
      template.innerHTML = row.html;
      const link = template.content.firstElementChild as HTMLElement;
      openStayFrom(link, row.view);
      const item = document.createElement("div");
      item.setAttribute("role", "listitem");
      item.appendChild(link);
      rowList.appendChild(item);
    }
    listElement.before(rowList);
    // "Both" only when there are exactly two; with more, "See all results" leads to each stay's Compare.
    if (rows.length === 2) {
      const both = document.createElement("button");
      both.type = "button";
      both.className = "ui-link ui-result-rows__compare";
      both.insertAdjacentHTML(
        "beforeend",
        `See both side by side${icon("arrow-right")}`,
      );
      both.addEventListener("click", () => void compareBoth());
      rowList.after(both);
    }
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

/**
 * Issue 05: the comparison is a table with the stays as columns and one row per attribute (a stacked list on narrow
 * screens, ADR-0078). It rearranges the Weaver elements, which keep their events.
 */
function decorateComparison(mount: HTMLElement): void {
  const root = mount.querySelector<HTMLElement>(
    '[data-a2ui-component="Column"]',
  );
  if (!root) return;
  const rowElements = [
    ...root.querySelectorAll<HTMLElement>(
      ':scope > [data-a2ui-component="Row"]',
    ),
  ];
  const attributeRows = rowElements.filter(
    (row) => row.previousElementSibling?.tagName === "H3",
  );
  const actionRow = rowElements.find(
    (row) => row.querySelector("button") !== null,
  );
  if (attributeRows.length === 0) return;
  const table = document.createElement("div");
  table.className = "ui-compare";
  table.setAttribute("role", "table");
  table.setAttribute("aria-label", "Compare stays");
  const line = (className: string): HTMLElement => {
    const element = document.createElement("div");
    element.className = `ui-compare__row compare-row ${className}`;
    element.setAttribute("role", "row");
    return element;
  };
  const cellsOf = (row: HTMLElement): HTMLElement[] => [
    ...row.querySelectorAll<HTMLElement>(
      ':scope > [data-a2ui-component="Column"], :scope > [data-weaver-mount] > [data-a2ui-component="Column"]',
    ),
  ];
  const head = line("ui-compare__row--head");
  const corner = document.createElement("div");
  corner.setAttribute("role", "columnheader");
  head.appendChild(corner);
  for (const cell of cellsOf(attributeRows[0]!)) {
    const heading = document.createElement("div");
    heading.className = "ui-compare__head";
    heading.setAttribute("role", "columnheader");
    heading.textContent =
      cell.querySelector("small")?.textContent?.trim() ?? "";
    head.appendChild(heading);
  }
  table.appendChild(head);
  root.insertBefore(table, attributeRows[0]!.previousElementSibling);
  for (const row of attributeRows) {
    const label = row.previousElementSibling as HTMLElement;
    const item = line("");
    label.classList.add("ui-compare__key");
    label.setAttribute("role", "rowheader");
    item.appendChild(label);
    for (const cell of cellsOf(row)) {
      cell.classList.add("compare-cell", "ui-compare__cell");
      cell.setAttribute("role", "cell");
      cell.querySelector("small")?.classList.add("compare-cell__unit");
      item.appendChild(cell);
    }
    row.remove();
    table.appendChild(item);
  }
  if (actionRow) {
    const item = line("ui-compare__row--actions");
    item.appendChild(document.createElement("div"));
    for (const cell of [...actionRow.children]) {
      (cell as HTMLElement).classList.add("ui-compare__cell");
      item.appendChild(cell);
    }
    actionRow.remove();
    table.appendChild(item);
  }
}

function enhanceSurfacePresentation(mount: HTMLElement, kind: string): void {
  mount.dataset.surfaceKind = kind;
  for (const button of mount.querySelectorAll<HTMLButtonElement>("button"))
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
  if (kind === "discovery") decorateDiscoveryCards(mount);
  if (kind === "compare") decorateComparison(mount);
  if (kind === "unit-detail") organizeUnitDetail(mount);
  if (kind === "booking" || kind === "payment") organizeBookingTicket(mount);
  if (activePayload?.requestScreen)
    organizeRequestScreen(mount, activePayload.requestScreen);
  if (activePayload?.confirmation)
    organizeConfirmation(mount, activePayload.confirmation);
  if (activePayload?.offerScreen)
    organizeOfferScreen(mount, activePayload.offerScreen);
  if (activePayload?.paymentScreen)
    organizePaymentScreen(mount, activePayload.paymentScreen);
}

function isMoney(text: string): boolean {
  const value = text.trim();
  return value.startsWith("₦") || value.startsWith("NGN");
}

function isPriceLabel(text: string): boolean {
  return (
    text.startsWith(GUEST_GLOSSARY.allInStayTotal) ||
    text.startsWith("Indicative nightly rate")
  );
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
    !isStringList(value.policies) ||
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
    (value.choosePath === undefined || isSafeInternalRoute(value.choosePath))
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
  if (value.quickReplies !== undefined && !isStringList(value.quickReplies))
    throw new Error("Invalid response quick replies");
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
  }).catch(() => {
    /* Observability must never block the interaction. */
  });
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
  turn.setAttribute(
    "aria-label",
    role === "user" ? "You" : "Shortlet Concierge",
  );
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
  transcript.appendChild(item);
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
  return surface.surfaceId.includes(":unit:") ||
    surface.surfaceId.includes(":request:") ||
    surface.surfaceId.includes(":offer:") ||
    surface.surfaceId.includes(":booking:") ||
    surface.surfaceId.includes(":payment:")
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
  const canReopen =
    current?.mode === "focused-surface" &&
    current.status === "active" &&
    activePayload !== undefined;
  workspaceReopen.hidden = !canReopen || shellState.focusedSurfaceOpen;
  if (canReopen)
    workspaceReopen.textContent = `Return to ${guestSurfaceHeading(current.summary).toLocaleLowerCase()}`;
}

function enhanceGuestContactField(mount: HTMLElement): void {
  const synchronize = (): void => {
    const wrapper = mount.querySelector<HTMLElement>(
      '[data-a2ui-component="TextField"]',
    );
    const label = wrapper?.querySelector<HTMLLabelElement>("label");
    const input = wrapper?.querySelector<HTMLInputElement>("input");
    if (!wrapper || !label || !input) return;
    const labelText = label.textContent?.trim() ?? "";
    const kind = /^phone number/i.test(labelText)
      ? "phone"
      : /^email address/i.test(labelText)
        ? "email"
        : undefined;
    if (!kind) return;

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
    input.type = kind === "phone" ? "tel" : "email";
    input.inputMode = kind === "phone" ? "tel" : "email";
    input.autocomplete = kind === "phone" ? "tel" : "email";
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
    : surface.surfaceId.includes(":compare:") ? "compare"
    : surface.surfaceId.includes(":discovery:") ? "discovery"
      : surface.surfaceId.includes(":payment:") || surface.surfaceId.includes(":offer:") ? "payment"
        : surface.surfaceId.includes(":request:") || surface.surfaceId.includes(":booking:") ? "booking"
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
  if (surface.requestScreen && surface.waiting?.kind === "operator-response" && presentation.status === "active" && !mount.querySelector(".request-screen")) {
    // ADR-0074/0080: a partial older surface retains all waiting guidance as well as its readable Weaver facts.
    mount.before(renderWaiting(surface.waiting));
  }
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

async function refreshServerState(): Promise<boolean> {
  try {
    const response = (await postJson(
      `/api/state?threadId=${encodeURIComponent(threadId)}`,
    )) as GuestStateResponse;
    if (response.ok) { renderJourney(response.journey); renderCriteria(response.criteria);}
    if (response.ok && response.surfaces && response.surfaces.length > 0) {
      renderSurfaces(response.surfaces);
      return true;
    }
  } catch {
    /* The caller may retry a deadline refresh while its safe view remains mounted. */
  }
  return false;
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
  if (target && !target.closest("[hidden]")) lastActivatedControl = target;
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
    const response = await fetch("/api/committed-work", { signal: AbortSignal.timeout(10_000) });
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
  newConversationStart.focus();
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
