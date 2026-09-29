/**
 * Server-side markup for the guest UI kit (guest-ui-consistency issue 02). One source per component: the standalone
 * pages call these helpers, and the chat organizers in client.ts produce the same DOM and classes from Weaver output.
 * Styling lives in apps/web/src/shortlet-foundations.css (`ui-*`). Every value is escaped here; helpers never build URLs.
 */
import { GUEST_FACT_LABELS, GUEST_GLOSSARY, GUEST_JOURNEY, stayTotalLabel } from "../../web-agent/src/guest-content.js";
import { formatNgnKobo } from "../../web-agent/src/discovery-a2ui.js";
import { formatBookingDeadline, formatStayFoot, formatTicketDate } from "../../web-agent/src/booking-presentation.js";
import { escapeHtml, icon, statusBadge, type IconName } from "../../web/src/ui-kit.js";
import { projectJourney, type GuestJourney, type JourneyStep, type JourneyStepState } from "./journey-rail.js";
import { guestStatusTone } from "./conversational-shell.js";

/** The absolute deadline in Africa/Lagos time (ADR 0078), without the "Pay by" prefix. */
export function formatWAT(iso: string): string {
  return formatBookingDeadline(iso).replace(/^Pay by /, "");
}

/** Whole minutes left until `deadlineIso` at `now`, never negative. */
export function minutesUntil(deadlineIso: string, now: Date): number {
  return Math.max(0, Math.ceil((Date.parse(deadlineIso) - now.getTime()) / 60_000));
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

const CHECK_IN_LABEL = GUEST_FACT_LABELS.checkIn;
const CHECK_OUT_LABEL = GUEST_FACT_LABELS.checkOut;

export interface TicketDatePart {
  readonly day: string;
  readonly date: string;
  readonly datetime?: string;
  /** Shown only when supplied by the policy projection (ADR 0031/0032). */
  readonly time?: string;
}

/** The ticket's display text. The chat organizers build it from the label-prefixed Text components, the pages from the projection. */
export interface TicketParts {
  readonly title: string;
  readonly checkIn: TicketDatePart;
  readonly checkOut: TicketDatePart;
  readonly foot: string;
}

function ticketDate(label: string, part: TicketDatePart, end: boolean): string {
  const time = part.datetime === undefined ? `<time>${escapeHtml(part.date)}</time>` : `<time datetime="${escapeHtml(part.datetime)}">${escapeHtml(part.date)}</time>`;
  return `<div class="ui-ticket__date${end ? " ui-ticket__date--end" : ""}"><span class="ui-ticket__label">${label}</span><span class="ui-ticket__day">${escapeHtml(part.day)}</span>${time}${part.time === undefined ? "" : `<span class="ui-ticket__time">${escapeHtml(part.time)}</span>`}</div>`;
}

export function ticketHtml(parts: TicketParts): string {
  return `<section class="ui-ticket" aria-label="Your stay"><div><p class="ui-ticket__label">Your stay</p><h2 class="ui-ticket__name">${escapeHtml(parts.title)}</h2></div><div class="ui-ticket__dates">${ticketDate(CHECK_IN_LABEL, parts.checkIn, false)}<span class="ui-ticket__arrow" aria-hidden="true">→</span>${ticketDate(CHECK_OUT_LABEL, parts.checkOut, true)}</div><p class="ui-ticket__foot">${escapeHtml(parts.foot)}</p></section>`;
}

export function stayTicketHtml(facts: StayTicketFacts): string {
  const part = (iso: string, time: string | undefined): TicketDatePart => ({ day: iso.slice(8, 10), date: formatTicketDate(iso), datetime: iso, ...(time === undefined ? {} : { time }) });
  return ticketHtml({ title: facts.unitTitle, checkIn: part(facts.checkIn, facts.arrivalTime), checkOut: part(facts.checkOut, facts.checkoutTime), foot: formatStayFoot(facts.nights, facts.guestCount) });
}

export interface PriceBreakdownInput {
  readonly allInStayTotalKobo?: number;
  readonly refundableSecurityDepositKobo?: number;
  readonly amountDueNowKobo?: number;
  readonly amountPaidKobo?: number;
  /** A condition tag above the total, for example "If your request is accepted". */
  readonly heading?: string;
}

/** The breakdown's display text: money already formatted, in the order the section shows it (ADR 0015). */
export interface BreakdownParts {
  readonly condition?: string;
  readonly total?: string;
  readonly deposit?: string;
  readonly due?: string;
  readonly paid?: string;
}

export function breakdownHtml(parts: BreakdownParts): string {
  const money = (value: string): string => `<span class="ui-price-breakdown__value">${escapeHtml(value)}</span>`;
  const total = parts.total === undefined ? "" : `<div><p class="ui-price-breakdown__label">${GUEST_FACT_LABELS.allInStayTotal}</p><p class="ui-money-total">${escapeHtml(parts.total)}</p></div>`;
  const deposit = parts.deposit === undefined ? "" : `<p class="ui-price-breakdown__row">${GUEST_FACT_LABELS.refundableSecurityDeposit}: ${money(parts.deposit)}</p>`;
  const due = parts.due === undefined ? "" : `<p class="ui-price-breakdown__due">${GUEST_FACT_LABELS.amountDueNow}: ${money(parts.due)}</p>`;
  const paid = parts.paid === undefined ? "" : `<p class="ui-price-breakdown__paid">${GUEST_FACT_LABELS.amountPaid}: ${money(parts.paid)}</p>`;
  return `<section class="ui-panel ui-price-breakdown" aria-label="Price breakdown">${parts.condition ? `<p class="ui-price-breakdown__condition">${escapeHtml(parts.condition)}</p>` : ""}${total}${deposit}${due}${paid}</section>`;
}

/** ADR 0015: the All-In Stay Total leads, the deposit is separate, then one amount line. */
export function priceBreakdownHtml(input: PriceBreakdownInput): string {
  return breakdownHtml({
    ...(input.heading ? { condition: input.heading } : {}),
    ...(input.allInStayTotalKobo === undefined ? {} : { total: formatNgnKobo(input.allInStayTotalKobo) }),
    ...(input.refundableSecurityDepositKobo === undefined || input.refundableSecurityDepositKobo <= 0 ? {} : { deposit: formatNgnKobo(input.refundableSecurityDepositKobo) }),
    ...(input.amountDueNowKobo === undefined ? {} : { due: formatNgnKobo(input.amountDueNowKobo) }),
    ...(input.amountPaidKobo === undefined ? {} : { paid: formatNgnKobo(input.amountPaidKobo) }),
  });
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

/** Display text for a stay card or result row. The chat organizer builds it from label-prefixed Texts, the pages from the projection. */
export interface StayCardParts {
  /** A route the caller has already validated; escaped here, never built here. */
  readonly href: string;
  readonly title: string;
  /** Neighbourhood-level only (ADR 0066). */
  readonly where: string;
  readonly facts: readonly { readonly icon: "bed" | "bath" | "users"; readonly text: string }[];
  /** The money figure, then its label (ADR 0015: the All-In Stay Total leads). */
  readonly total: string;
  readonly totalLabel: string;
  /** The deposit amount alone; rendered as "+ <amount> Refundable Security Deposit (separate)". */
  readonly deposit?: string;
  /** A photo URL the caller already routed through the no-referrer photo proxy (ADR 0075). */
  readonly photoSrc?: string;
  /** How many photos the stay has; two or more show the "1 / N" badge over the photo. */
  readonly photoCount?: number;
}

function photoCountHtml(count: number | undefined): string {
  if (count === undefined || !Number.isInteger(count) || count < 2) return "";
  return `<span class="ui-stay-card__count">${icon("grid")}<span aria-hidden="true">1 / ${count}</span><span class="ui-sr-only">${count} photos</span></span>`;
}

function stayPhotoHtml(parts: StayCardParts): string {
  return parts.photoSrc === undefined
    ? `<div class="ui-stay-card__photo ui-stay-card__photo--empty" role="img" aria-label="Photos are not available for ${escapeHtml(parts.title)}">${icon("photo")}Photos not available</div>`
    : `<div class="ui-stay-card__media"><img class="ui-stay-card__photo" src="${escapeHtml(parts.photoSrc)}" alt="Photo of ${escapeHtml(parts.title)}" width="800" height="600" loading="lazy" decoding="async" referrerpolicy="no-referrer">${photoCountHtml(parts.photoCount)}</div>`;
}

/** What is inside a stay card; the chat puts this inside Weaver's Card element, the pages inside an article. */
export function stayCardInnerHtml(parts: StayCardParts): string {
  const href = escapeHtml(parts.href);
  const facts = parts.facts.map((fact) => `<span class="ui-fact">${icon(fact.icon)}${escapeHtml(fact.text)}</span>`).join("");
  const deposit = parts.deposit === undefined ? "" : `<p class="ui-money-metadata">+ ${escapeHtml(parts.deposit)} ${GUEST_FACT_LABELS.refundableSecurityDeposit}</p>`;
  return `${stayPhotoHtml(parts)}<p class="ui-stay-card__where">${icon("pin")}${escapeHtml(parts.where)}</p><h2 class="ui-stay-card__title"><a href="${href}">${escapeHtml(parts.title)}</a></h2><div class="ui-stay-card__facts" aria-label="Stay facts">${facts}</div><div class="ui-stay-card__total"><p class="ui-money-total">${escapeHtml(parts.total)}</p><p class="ui-money-metadata">${escapeHtml(parts.totalLabel)}</p>${deposit}</div><a class="ui-button ui-button--primary ui-button--block ui-stay-card__view" href="${href}">${GUEST_GLOSSARY.viewUnit}<span class="ui-sr-only">: ${escapeHtml(parts.title)}</span></a>`;
}

export function stayCardPartsHtml(parts: StayCardParts, unitId?: string): string {
  return `<article class="ui-stay-card"${unitId === undefined ? "" : ` data-unit-id="${escapeHtml(unitId)}"`}>${stayCardInnerHtml(parts)}</article>`;
}

/** The compact result row: thumbnail, title, the All-In Stay Total with its label, and a chevron. */
export function resultRowPartsHtml(parts: StayCardParts): string {
  const thumb = parts.photoSrc === undefined
    ? icon("photo")
    : `<img src="${escapeHtml(parts.photoSrc)}" alt="" width="64" height="64" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
  return `<a class="ui-result-row" href="${escapeHtml(parts.href)}"><span class="ui-result-row__thumb">${thumb}</span><span class="ui-result-row__body"><span class="ui-result-row__title">${escapeHtml(parts.title)}</span><span class="ui-result-row__price">${escapeHtml(parts.total)} <span>${escapeHtml(parts.totalLabel)}</span></span></span>${icon("chevron-right")}</a>`;
}

/** A search result as the pages know it (the projection), before it is turned into display text. */
export interface StayPreview {
  readonly href: string;
  readonly title: string;
  readonly neighbourhood: string;
  readonly city: string;
  readonly bedrooms: number | null;
  readonly bathrooms: number;
  readonly capacity: number;
  /** All-In Stay Total, or null when not yet quoted. */
  readonly allInStayTotalKobo: number | null;
  readonly nightlyKobo: number;
  readonly refundableSecurityDepositKobo: number;
  readonly nights?: number;
  readonly photoSrc?: string;
  readonly photoCount?: number;
  readonly unitId?: string;
}

export function stayCardParts(preview: StayPreview): StayCardParts {
  return {
    href: preview.href,
    title: preview.title,
    where: `${preview.neighbourhood}, ${preview.city}`,
    facts: [
      ...(preview.bedrooms === null ? [] : [{ icon: "bed" as const, text: `${preview.bedrooms} ${preview.bedrooms === 1 ? "bedroom" : "bedrooms"}` }]),
      { icon: "bath", text: `${preview.bathrooms} ${preview.bathrooms === 1 ? "bathroom" : "bathrooms"}` },
      { icon: "users", text: `Sleeps ${preview.capacity}` },
    ],
    total: formatNgnKobo(preview.allInStayTotalKobo ?? preview.nightlyKobo),
    totalLabel: stayTotalLabel(preview.allInStayTotalKobo !== null, preview.nights),
    ...(preview.refundableSecurityDepositKobo > 0 ? { deposit: formatNgnKobo(preview.refundableSecurityDepositKobo) } : {}),
    ...(preview.photoSrc === undefined ? {} : { photoSrc: preview.photoSrc }),
    ...(preview.photoCount === undefined ? {} : { photoCount: preview.photoCount }),
  };
}

export function stayCardHtml(preview: StayPreview): string {
  return stayCardPartsHtml(stayCardParts(preview), preview.unitId);
}

export function resultRowHtml(preview: StayPreview): string {
  return resultRowPartsHtml(stayCardParts(preview));
}

const JOURNEY_STATE_TEXT: Readonly<Record<JourneyStepState, string>> = {
  done: "completed", current: "current step", failed: "not completed", upcoming: "not started",
};

/** The journey rail from the server's projection; `data-state` is the contract shared with the chat's rail. */
export function railHtml(journey: GuestJourney | undefined): string {
  if (!journey) return "";
  const steps = journey.steps.map((step) => {
    const tone = step.state === "failed" ? guestStatusTone(step.label) : undefined;
    return `<li data-step="${step.id}" data-state="${step.state}"${tone === undefined ? "" : ` data-tone="${tone}"`}${step.state === "current" ? " aria-current=\"step\"" : ""}>${escapeHtml(step.label)}<span class="ui-sr-only"> (${JOURNEY_STATE_TEXT[step.state]})</span></li>`;
  }).join("");
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

const BACK_LABEL = "Back to your conversation";

/**
 * The frame every standalone guest page shares: the top bar (back to this page's own conversation, or to "/" when it has
 * none) and the journey rail. The rail is the server's projection for the thread, or the one step a public page is on.
 */
export function appFrameHtml(input: { readonly threadId: string | null; readonly journey?: GuestJourney; readonly publicStep?: JourneyStep }): string {
  const backHref = input.threadId === null ? "/" : `/?threadId=${encodeURIComponent(input.threadId)}`;
  const journey = input.journey ?? (input.publicStep === undefined ? undefined : projectJourney(input.publicStep));
  return `${appBarHtml({ backHref, backLabel: BACK_LABEL })}${railHtml(journey)}`;
}
