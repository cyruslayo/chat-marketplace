/**
 * Server-side markup for the guest UI kit (guest-ui-consistency issue 02). One source per component: the standalone
 * pages call these helpers, and the chat organizers in client.ts produce the same DOM and classes from Weaver output.
 * Styling lives in apps/web/src/shortlet-foundations.css (`ui-*`). Every value is escaped here; helpers never build URLs.
 */
import { GUEST_GLOSSARY, GUEST_JOURNEY } from "../../web-agent/src/guest-content.js";
import { formatNgnKobo } from "../../web-agent/src/discovery-a2ui.js";
import { formatBookingDeadline } from "../../web-agent/src/booking-presentation.js";
import { escapeHtml, icon, statusBadge, type IconName } from "../../web/src/ui-kit.js";
import type { GuestJourney, JourneyStepState } from "./journey-rail.js";

/** The absolute deadline in Africa/Lagos time (ADR 0078), without the "Pay by" prefix. */
export function formatWAT(iso: string): string {
  return formatBookingDeadline(iso).replace(/^Pay by /, "");
}

/** Whole minutes left until `deadlineIso` at `now`, never negative. */
export function minutesUntil(deadlineIso: string, now: Date): number {
  return Math.max(0, Math.ceil((Date.parse(deadlineIso) - now.getTime()) / 60_000));
}

/** "Sat, 3 Oct 2026" for a plain calendar date; anything else is shown as given. */
export function formatTicketDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-NG", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

export interface StayTicketFacts {
  readonly unitTitle: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly nights: number;
  readonly guestCount?: number;
  /** Shown only when the policy projection supplies them (ADR 0031/0032); never a default. */
  readonly arrivalTime?: string;
  readonly checkoutTime?: string;
}

const CHECK_IN_LABEL = "Check-in";
const CHECK_OUT_LABEL = "Check-out";

function ticketDate(label: string, value: string, time: string | undefined, end: boolean): string {
  return `<div class="ui-ticket__date${end ? " ui-ticket__date--end" : ""}"><span class="ui-ticket__label">${label}</span><span class="ui-ticket__day">${escapeHtml(value.slice(8, 10))}</span><time datetime="${escapeHtml(value)}">${escapeHtml(formatTicketDate(value))}</time>${time === undefined ? "" : `<span class="ui-ticket__time">${escapeHtml(time)}</span>`}</div>`;
}

export function stayTicketHtml(facts: StayTicketFacts): string {
  const guests = facts.guestCount === undefined ? "" : ` · ${facts.guestCount} ${facts.guestCount === 1 ? "guest" : "guests"}`;
  return `<section class="ui-ticket" aria-label="Your stay"><div><p class="ui-ticket__label">Your stay</p><h2 class="ui-ticket__name">${escapeHtml(facts.unitTitle)}</h2></div><div class="ui-ticket__dates">${ticketDate(CHECK_IN_LABEL, facts.checkIn, facts.arrivalTime, false)}<span class="ui-ticket__arrow" aria-hidden="true">→</span>${ticketDate(CHECK_OUT_LABEL, facts.checkOut, facts.checkoutTime, true)}</div><p class="ui-ticket__foot">${facts.nights} ${facts.nights === 1 ? "night" : "nights"}${guests}</p></section>`;
}

export interface PriceBreakdownInput {
  readonly allInStayTotalKobo?: number;
  readonly refundableSecurityDepositKobo?: number;
  readonly amountDueNowKobo?: number;
  readonly amountPaidKobo?: number;
  /** A condition tag above the total, for example "If your request is accepted". */
  readonly heading?: string;
}

/** ADR 0015: the All-In Stay Total leads, the deposit is separate, then one amount line. */
export function priceBreakdownHtml(input: PriceBreakdownInput): string {
  const money = (kobo: number): string => `<span class="ui-price-breakdown__value">${formatNgnKobo(kobo)}</span>`;
  const total = input.allInStayTotalKobo === undefined ? "" : `<div><p class="ui-price-breakdown__label">${GUEST_GLOSSARY.allInStayTotal}</p><p class="ui-money-total">${formatNgnKobo(input.allInStayTotalKobo)}</p></div>`;
  const deposit = input.refundableSecurityDepositKobo === undefined || input.refundableSecurityDepositKobo <= 0 ? "" : `<p class="ui-price-breakdown__row">${GUEST_GLOSSARY.refundableSecurityDeposit} (separate): ${money(input.refundableSecurityDepositKobo)}</p>`;
  const due = input.amountDueNowKobo === undefined ? "" : `<p class="ui-price-breakdown__due">Amount due now: ${money(input.amountDueNowKobo)}</p>`;
  const paid = input.amountPaidKobo === undefined ? "" : `<p class="ui-price-breakdown__paid">Amount paid: ${money(input.amountPaidKobo)}</p>`;
  return `<section class="ui-panel ui-price-breakdown" aria-label="Price breakdown">${input.heading ? `<p class="ui-price-breakdown__condition">${escapeHtml(input.heading)}</p>` : ""}${total}${deposit}${due}${paid}</section>`;
}

/** One deadline style for every screen: an absolute WAT time plus the time left (ADR 0078). */
export function deadlineBannerHtml(input: { readonly label: string; readonly deadlineIso: string; readonly now: Date }): string {
  const minutes = minutesUntil(input.deadlineIso, input.now);
  return `<p class="ui-banner ui-banner--warning payment-deadline">${icon("clock")}<span>${escapeHtml(input.label)} <time datetime="${escapeHtml(input.deadlineIso)}">${escapeHtml(formatWAT(input.deadlineIso))}</time> · ${minutes} ${minutes === 1 ? "minute" : "minutes"} left</span></p>`;
}

/** "What happens next": a plain numbered list. */
export function stepsHtml(items: readonly string[]): string {
  return `<ol class="ui-steps">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>`;
}

export type KitStatusTone = "success" | "warning" | "danger" | "neutral";

export function statusHtml(tone: KitStatusTone, text: string): string {
  return statusBadge(text, tone);
}

// Hidden until /payment.js reveals it: without JavaScript the account number stays plain, selectable text (ADR 0080).
export function copyAccountNumberHtml(accountNumber: string): string {
  return ` <button class="ui-button ui-button--secondary transfer-copy" type="button" data-copy-text="${escapeHtml(accountNumber)}" hidden>Copy account number</button><span class="ui-field__hint transfer-copy-status" role="status" data-copy-status></span>`;
}

export interface BankDetailsInput {
  readonly bankName: string;
  readonly accountName?: string;
  readonly accountNumber: string;
  readonly amountKobo: number;
  readonly bookingReference?: string;
}

export function bankDetailsHtml(input: BankDetailsInput): string {
  return `<dl class="ui-facts ui-facts--stacked"><dt>Bank</dt><dd>${escapeHtml(input.bankName)}</dd>${input.accountName === undefined ? "" : `<dt>Account name</dt><dd>${escapeHtml(input.accountName)}</dd>`}<dt>Account number</dt><dd class="transfer-account">${escapeHtml(input.accountNumber)}${copyAccountNumberHtml(input.accountNumber)}</dd><dt>Exact amount</dt><dd class="ui-money-total">${formatNgnKobo(input.amountKobo)}</dd>${input.bookingReference === undefined ? "" : `<dt>Booking reference</dt><dd class="transfer-reference">${escapeHtml(input.bookingReference)}</dd>`}</dl>`;
}

export interface StayPreview {
  /** A route the caller has already validated; escaped here, never built here. */
  readonly href: string;
  readonly title: string;
  readonly neighbourhood: string;
  readonly city: string;
  /** All-In Stay Total, or null when not yet quoted. */
  readonly allInStayTotalKobo: number | null;
  readonly refundableSecurityDepositKobo: number;
  readonly nights?: number;
  /** A photo URL the caller already routed through the no-referrer photo proxy (ADR 0075). */
  readonly photoSrc?: string;
  readonly unitId?: string;
}

function stayPhotoHtml(preview: StayPreview): string {
  return preview.photoSrc === undefined
    ? `<div class="ui-stay-card__photo ui-stay-card__photo--empty" role="img" aria-label="Photos are not available for ${escapeHtml(preview.title)}">${icon("photo")}Photos not available</div>`
    : `<img class="ui-stay-card__photo" src="${escapeHtml(preview.photoSrc)}" alt="Photo of ${escapeHtml(preview.title)}" width="800" height="600" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
}

/** The full stay card: photo, place, facts, All-In Stay Total, deposit and one action. */
export function stayCardHtml(preview: StayPreview & { readonly bedrooms: number | null; readonly bathrooms: number; readonly capacity: number }): string {
  const total = preview.allInStayTotalKobo === null ? "not yet quoted" : formatNgnKobo(preview.allInStayTotalKobo);
  const nights = preview.nights === undefined ? "" : ` for ${preview.nights} ${preview.nights === 1 ? "night" : "nights"}`;
  const href = escapeHtml(preview.href);
  return `<article class="ui-stay-card"${preview.unitId === undefined ? "" : ` data-unit-id="${escapeHtml(preview.unitId)}"`}>${stayPhotoHtml(preview)}<p class="ui-stay-card__where">${icon("pin")}${escapeHtml(preview.neighbourhood)}, ${escapeHtml(preview.city)}</p><h2 class="ui-stay-card__title"><a href="${href}">${escapeHtml(preview.title)}</a></h2><div class="ui-stay-card__facts" aria-label="Stay facts"><span class="ui-fact">${icon("bed")}${preview.bedrooms ?? "Bedrooms not provided"} ${preview.bedrooms === 1 ? "bedroom" : "bedrooms"}</span><span class="ui-fact">${icon("bath")}${preview.bathrooms} ${preview.bathrooms === 1 ? "bathroom" : "bathrooms"}</span><span class="ui-fact">${icon("users")}Entire Place · ${preview.capacity} guests</span></div><div class="ui-stay-card__total"><p class="ui-price-breakdown__label">${GUEST_GLOSSARY.allInStayTotal}${nights} · all-in</p><p class="ui-money-total">${total}</p><p class="ui-money-metadata">${GUEST_GLOSSARY.refundableSecurityDeposit} (separate): ${formatNgnKobo(preview.refundableSecurityDepositKobo)}</p><a class="ui-button ui-button--primary ui-button--block" href="${href}">${GUEST_GLOSSARY.viewUnit}<span class="ui-sr-only">: ${escapeHtml(preview.title)}</span></a></div></article>`;
}

/** The compact result row used for the long list in chat results. */
export function resultRowHtml(preview: StayPreview): string {
  const total = preview.allInStayTotalKobo === null ? "not yet quoted" : formatNgnKobo(preview.allInStayTotalKobo);
  const thumb = preview.photoSrc === undefined
    ? icon("photo")
    : `<img src="${escapeHtml(preview.photoSrc)}" alt="" width="64" height="64" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
  return `<a class="ui-result-row" href="${escapeHtml(preview.href)}"><span class="ui-result-row__thumb">${thumb}</span><span class="ui-result-row__body"><span class="ui-result-row__title">${escapeHtml(preview.title)}</span><span class="ui-result-row__where">${escapeHtml(preview.neighbourhood)}, ${escapeHtml(preview.city)}</span><span class="ui-result-row__price">${total} <span>${GUEST_GLOSSARY.allInStayTotal}</span></span></span>${icon("chevron-right")}</a>`;
}

const JOURNEY_STATE_TEXT: Readonly<Record<JourneyStepState, string>> = {
  done: "completed", current: "current step", failed: "not completed", upcoming: "not started",
};

/** The journey rail from the server's projection; `data-state` is the contract shared with the chat's rail. */
export function railHtml(journey: GuestJourney | undefined): string {
  if (!journey) return "";
  const steps = journey.steps.map((step) => `<li data-step="${step.id}" data-state="${step.state}"${step.state === "current" ? " aria-current=\"step\"" : ""}>${escapeHtml(step.label)}<span class="ui-sr-only"> (${JOURNEY_STATE_TEXT[step.state]})</span></li>`).join("");
  return `<nav class="ui-rail-nav" aria-label="${GUEST_JOURNEY.railLabel}"><ol class="ui-rail">${steps}</ol></nav>`;
}

export interface AppBarInput {
  /** Where the back control goes: the page's own conversation, or "/" without one. */
  readonly backHref: string;
  readonly backLabel: string;
  readonly action?: { readonly href: string; readonly label: string; readonly icon: IconName };
}

export function appBarHtml(input: AppBarInput): string {
  const action = input.action === undefined ? "" : `<a class="ui-button ui-button--small ui-appbar__action" href="${escapeHtml(input.action.href)}">${icon(input.action.icon)}${escapeHtml(input.action.label)}</a>`;
  return `<header class="ui-appbar"><a class="ui-icon-button" href="${escapeHtml(input.backHref)}" aria-label="${escapeHtml(input.backLabel)}">${icon("arrow-left")}</a><a class="ui-appbar__brand" href="/">Shortlet</a><span class="ui-appbar__grow"></span>${action}</header>`;
}
