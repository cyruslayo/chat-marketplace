/**
 * Server-side markup for the guest UI kit (guest-ui-consistency issue 02). One source per component: the standalone
 * pages call these helpers, and the chat organizers in client.ts produce the same DOM and classes from Weaver output.
 * Styling lives in apps/web/src/shortlet-foundations.css (`ui-*`). Every value is escaped here; helpers never build URLs.
 */
import { GUEST_FACT_LABELS, GUEST_GLOSSARY, GUEST_JOURNEY, UNIT_DETAIL_ABOUT_HEADING, stayTotalLabel } from "../../web-agent/src/guest-content.js";
import { formatNgnKobo } from "../../web-agent/src/discovery-a2ui.js";
import { formatBookingDeadline, formatStayFoot, formatTicketDate } from "../../web-agent/src/booking-presentation.js";
import { appBarHtml, escapeHtml, icon, statusBadge } from "../../web/src/ui-kit.js";
export { appBarHtml, type AppBarInput } from "../../web/src/ui-kit.js";
import { projectJourney, type GuestJourney, type JourneyStep, type JourneyStepState } from "./journey-rail.js";
import { guestStatusTone } from "./conversational-shell.js";
import type { RequestScreenContent } from "../../web-agent/src/request-presentation.js";
import type { ConfirmationContent } from "../../web-agent/src/confirmation-presentation.js";
import type { OfferScreenContent } from "../../web-agent/src/offer-presentation.js";
import type { PaymentScreenContent } from "../../web-agent/src/payment-presentation.js";

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
  readonly bookingReference?: string;
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
  return ticketHtml({ title: facts.unitTitle, checkIn: part(facts.checkIn, facts.arrivalTime), checkOut: part(facts.checkOut, facts.checkoutTime), foot: formatStayFoot(facts.nights, facts.guestCount) + (facts.bookingReference === undefined ? "" : ` · Booking reference ${facts.bookingReference}`) });
}

export interface PriceBreakdownInput {
  readonly allInStayTotalKobo?: number;
  readonly refundableSecurityDepositKobo?: number;
  readonly amountDueNowKobo?: number;
  readonly amountPaidKobo?: number;
  /** A condition tag above the total, for example "If your request is accepted". */
  readonly heading?: string;
  /** The total's own label; defaults to the All-In Stay Total. The unit detail names the stay here (issue 06). */
  readonly totalLabel?: string;
  readonly depositCollected?: boolean;
  /** The component the guest pays next, for example "stay payment · ₦370,000" (issue 09). */
  readonly next?: string;
}

/** The breakdown's display text: money already formatted, in the order the section shows it (ADR 0015). */
export interface BreakdownParts {
  readonly depositCollected?: boolean;
  readonly condition?: string;
  readonly total?: string;
  readonly totalLabel?: string;
  readonly deposit?: string;
  readonly due?: string;
  readonly paid?: string;
  readonly next?: string;
}

export function breakdownHtml(parts: BreakdownParts): string {
  const money = (value: string): string => `<span class="ui-price-breakdown__value">${escapeHtml(value)}</span>`;
  const total = parts.total === undefined ? "" : `<div><p class="ui-price-breakdown__label">${escapeHtml(parts.totalLabel ?? GUEST_FACT_LABELS.allInStayTotal)}</p><p class="ui-money-total">${escapeHtml(parts.total)}</p></div>`;
  const deposit = parts.deposit === undefined ? "" : `<p class="ui-price-breakdown__row">${parts.depositCollected ? `${GUEST_GLOSSARY.refundableSecurityDeposit} collected` : GUEST_FACT_LABELS.refundableSecurityDeposit}: ${money(parts.deposit)}</p>`;
  const due = parts.due === undefined ? "" : `<p class="ui-price-breakdown__due">${GUEST_FACT_LABELS.amountDueNow}: ${money(parts.due)}</p>`;
  const paid = parts.paid === undefined ? "" : `<p class="ui-price-breakdown__paid">${GUEST_FACT_LABELS.amountPaid}: ${money(parts.paid)}</p>`;
  const next = parts.next === undefined ? "" : `<p class="ui-price-breakdown__row payment-current-component">${GUEST_FACT_LABELS.nextPayment}: ${money(parts.next)}</p>`;
  return `<section class="ui-panel ui-price-breakdown" aria-label="Price breakdown">${parts.condition ? `<p class="ui-price-breakdown__condition">${escapeHtml(parts.condition)}</p>` : ""}${total}${deposit}${due}${paid}${next}</section>`;
}

/** ADR 0015: the All-In Stay Total leads, the deposit is separate, then one amount line. */
export function priceBreakdownHtml(input: PriceBreakdownInput): string {
  return breakdownHtml({
    ...(input.depositCollected ? { depositCollected: true } : {}),
    ...(input.heading ? { condition: input.heading } : {}),
    ...(input.allInStayTotalKobo === undefined ? {} : { total: formatNgnKobo(input.allInStayTotalKobo) }),
    ...(input.totalLabel === undefined ? {} : { totalLabel: input.totalLabel }),
    ...(input.refundableSecurityDepositKobo === undefined || input.refundableSecurityDepositKobo <= 0 ? {} : { deposit: formatNgnKobo(input.refundableSecurityDepositKobo) }),
    ...(input.amountDueNowKobo === undefined ? {} : { due: formatNgnKobo(input.amountDueNowKobo) }),
    ...(input.amountPaidKobo === undefined ? {} : { paid: formatNgnKobo(input.amountPaidKobo) }),
    ...(input.next === undefined ? {} : { next: input.next }),
  });
}

/** Issue 06: the unit-detail sheet's facility tiles (.ui-tiles), one markup source for the page and the chat. */
export function unitTilesHtml(tiles: readonly { readonly icon: "bed" | "bath" | "users"; readonly text: string }[]): string {
  return `<ul class="ui-tiles" aria-label="Stay facts">${tiles.map((tile) => `<li class="ui-tiles__tile">${icon(tile.icon)}${escapeHtml(tile.text)}</li>`).join("")}</ul>`;
}

/** Issue 06: the un-quoted unit price, the labelled indicative nightly rate (ADR 0015). */
export function unitIndicativePriceHtml(nightlyKobo: number): string {
  return `<div class="unit-detail-price"><p class="ui-field__hint">Price per night (indicative)</p><p class="ui-money-total">${formatNgnKobo(nightlyKobo)} <span class="ui-money-metadata">per night · dates not yet quoted</span></p></div>`;
}

/** Issue 06: the unit sheet's "About" section (heading plus description), one markup source for both surfaces. */
export function unitAboutHtml(description: string): string {
  return `<h2 class="unit-detail-about-heading">${escapeHtml(UNIT_DETAIL_ABOUT_HEADING)}</h2><p class="unit-detail-description">${escapeHtml(description)}</p>`;
}

/** One deadline style for every screen: an absolute WAT time plus the time left (ADR 0078). */
export function deadlineBannerHtml(input: {readonly label: string;
  readonly deadlineIso: string;
  readonly now: Date;
  readonly countdown?: boolean;
  readonly consequence?: string;
}): string {
  const minutes = minutesUntil(input.deadlineIso, input.now);
  const remaining = `${minutes} ${minutes === 1 ? "minute" : "minutes"} left`;
  const deadline = `${escapeHtml(input.label)} <time datetime="${escapeHtml(input.deadlineIso)}">${escapeHtml(formatWAT(input.deadlineIso))}</time>`;
  return `<p class="ui-banner ui-banner--warning payment-deadline${input.countdown ? " offer-deadline" : ""}">${icon("clock")}<span>${input.countdown ? `<span class="waiting-deadline-time">${deadline}</span> · <span class="waiting-countdown">${remaining}</span>` : `${deadline} · ${remaining}`}${input.consequence ? `<br>${escapeHtml(input.consequence)}` : ""}</span></p>`;
}

/** Shared live/closed offer kit. No policy URL is synthesized from policy text (ADR-0075/0077). */
export function offerScreenHtml(
  content: OfferScreenContent,
  ticket: string,
  breakdown: string,
): string {
  const form = (
    path: string,
    label: string,
    primary: boolean,
    surfaceId?: string,
  ): string =>
    `<form method="post" action="${escapeHtml(path)}">${surfaceId === undefined ? "" : `<input type="hidden" name="surfaceId" value="${escapeHtml(surfaceId)}">`}<button class="ui-button ui-button--${primary ? "primary" : "secondary"}" type="submit">${escapeHtml(label)}</button></form>`;
  const live = content.state === "live";
  const banner = live
    ? deadlineBannerHtml({
        label: "Pay by",
        deadlineIso: content.deadlineIso,
        now: new Date(content.serverNow),
        countdown: true,
        consequence: content.consequence,
      })
    : content.state === "expired"
      ? `<p class="ui-banner ui-banner--neutral offer-deadline">${icon("clock")}<span>The deadline was <time datetime="${escapeHtml(content.deadlineIso)}">${escapeHtml(formatWAT(content.deadlineIso))}</time><br>${escapeHtml(content.consequence)}</span></p>`
      : "";
  const policies = live
    ? `<section class="ui-panel offer-policies" aria-label="Before you pay"><h2>Before you pay</h2><p>${escapeHtml(content.provider)}</p>${content.policies.map((text) => `<p>${escapeHtml(text)}</p>`).join("")}${content.notes.map((text) => `<p>${escapeHtml(text)}</p>`).join("")}</section>`
    : "";
  const actions = content.accept
    ? `<div class="ui-action-bar offer-actions"><div><strong>${escapeHtml(content.amount)}</strong><span class="ui-price-breakdown__label">Amount due now</span></div>${form(content.accept.path, "Accept and pay", true, content.accept.surfaceId)}</div>`
    : `<div class="offer-actions request-actions">${form(content.conversationPath, "Back to your conversation", true)}${content.searchPath ? form(content.searchPath, "Find other stays", false) : ""}</div>`;
  return `<section class="offer-screen" data-offer-state="${content.state}" data-server-now="${escapeHtml(content.serverNow)}"><header class="request-head offer-head" data-page="booking-record"><p class="ui-eyebrow">Conditional Booking Offer</p><h1>${escapeHtml(content.title)}</h1><span class="ui-status ui-status--${live ? "success" : content.state === "expired" || content.state === "closed" ? "danger" : "warning"}">${escapeHtml(content.status)}</span></header>${banner}${ticket}${live ? breakdown : ""}${policies}${content.steps.length ? `<section class="ui-panel"><h2>What happens next</h2>${stepsHtml(content.steps)}</section>` : ""}${actions}</section>`;
}

/**
 * Issue 09: the one payment layout. Head with a status pill, then the banner, ticket, breakdown, the screen's own
 * sections and the actions. Every slot is markup from this kit, never artifact-supplied HTML.
 */
export function paymentLayoutHtml(input: {
  readonly state: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly tone: KitStatusTone;
  readonly status?: string;
  readonly banner?: string;
  readonly ticket?: string;
  readonly breakdown?: string;
  readonly sections?: readonly string[];
  readonly actions?: string;
  readonly serverNow?: string;
}): string {
  const actions =
    input.actions === undefined || input.actions === ""
      ? ""
      : `<div class="payment-actions ui-action-bar">${input.actions}</div>`;
  return `<section class="payment-screen" data-payment-state="${escapeHtml(input.state)}"${input.serverNow === undefined ? "" : ` data-server-now="${escapeHtml(input.serverNow)}"`}><header class="request-head payment-head" data-page="booking-record"><p class="ui-eyebrow">${escapeHtml(input.eyebrow)}</p><h1>${escapeHtml(input.title)}</h1>${input.status === undefined ? "" : statusHtml(input.tone, input.status)}</header>${input.banner ?? ""}${input.ticket ?? ""}${input.breakdown ?? ""}${(input.sections ?? []).join("")}${actions}</section>`;
}

/** The chat's and the payment page's shared screen: the deadline banner, steps and the explanation (ADR 0078). */
export function paymentScreenHtml(
  content: PaymentScreenContent,
  ticket: string,
  breakdown: string,
  slots: {
    readonly sections?: string;
    readonly actions?: string;
    readonly countdown?: boolean;
  },
): string {
  const banner =
    content.deadlineIso === undefined
      ? ""
      : deadlineBannerHtml({
          label: "Pay by",
          deadlineIso: content.deadlineIso,
          now: new Date(content.serverNow),
          ...(slots.countdown ? { countdown: true } : {}),
        });
  return paymentLayoutHtml({
    state: content.state,
    eyebrow: "Booking payment",
    title: content.title,
    tone: content.tone,
    status: content.status,
    banner,
    ticket,
    breakdown,
    sections: [
      `<p class="payment-explanation">${escapeHtml(content.explanation)}</p>`,
      ...(content.steps.length
        ? [
            `<section class="ui-panel payment-steps"><h2>What happens next</h2>${stepsHtml(content.steps)}</section>`,
          ]
        : []),
      ...(slots.sections === undefined ? [] : [slots.sections]),
    ],
    actions: `${slots.actions ?? ""}${content.choosePath === undefined ? "" : `<a class="ui-button ui-button--secondary ui-button--block" href="${escapeHtml(content.choosePath)}">Choose another way to pay</a>`}`,
    serverNow: content.serverNow,
  });
}

/** How to pay: a native radio group and one submit (works without JavaScript, ADR 0080), then the manual option. */
export function paymentChoiceHtml(input: {
  readonly action: string;
  readonly manualAction?: string;
  readonly providerTransfer: boolean;
  readonly amount: string;
  readonly switching: string;
  readonly manualCopy: string;
}): string {
  const methods = input.providerTransfer
    ? `<fieldset class="ui-segmented"><legend class="ui-sr-only">Payment method</legend><label><input type="radio" name="method" value="card" checked>${icon("card")}Card</label><label><input type="radio" name="method" value="bank_transfer">${icon("bank")}Bank transfer</label></fieldset>`
    : `<input type="hidden" name="method" value="card">`;
  const manual =
    input.manualAction === undefined
      ? ""
      : `<form method="post" action="${escapeHtml(input.manualAction)}" class="payment-manual"><section class="ui-panel"><button class="ui-button ui-button--secondary ui-button--block" type="submit">${icon("upload")}Pay by manual bank transfer</button><p class="ui-field__hint">${escapeHtml(input.manualCopy)}</p></section></form>`;
  return `<form method="post" action="${escapeHtml(input.action)}" class="payment-choice-form"><section class="ui-panel payment-choice" aria-label="Choose how to pay"><h2>How would you like to pay?</h2><p class="ui-field__hint">${escapeHtml(input.switching)}</p>${methods}</section><div class="payment-actions ui-action-bar"><button class="ui-button ui-button--primary ui-button--block" type="submit">Continue · ${escapeHtml(input.amount)}</button></div></form>${manual}`;
}

/** The bank-transfer details in one card (account number with its copy button, exact amount, booking-only note). */
export function bankDetailsCardHtml(
  input: BankDetailsInput,
  notes: readonly string[],
): string {
  return `<section class="ui-panel bank-details" aria-label="Transfer details">${bankDetailsHtml(input)}${notes.map((note) => `<p class="ui-field__hint">${escapeHtml(note)}</p>`).join("")}</section>`;
}

/** A receipt or transfer summary card: label and value rows. */
export function transferSummaryHtml(
  rows: readonly {
    readonly label: string;
    readonly value: string;
    readonly mono?: boolean;
  }[],
): string {
  return `<section class="ui-panel transfer-summary" aria-label="Your transfer"><dl class="ui-facts ui-facts--stacked">${rows.map((row) => `<dt>${escapeHtml(row.label)}</dt><dd${row.mono ? ' class="transfer-reference"' : ""}>${escapeHtml(row.value)}</dd>`).join("")}</dl></section>`;
}

/** The receipt upload: a real file input inside a `.ui-upload` label; the form and limits are the existing ones. */
export function uploadCardHtml(input: {
  readonly action: string;
  readonly limitMb: number;
}): string {
  return `<form method="post" action="${escapeHtml(input.action)}" enctype="multipart/form-data" class="ui-stack"><label class="ui-upload" for="receipt">${icon("upload")}<span>Transfer receipt (photo or PDF, up to ${input.limitMb} MB)<input id="receipt" name="receipt" type="file" accept="image/jpeg,image/png,application/pdf" required></span></label><button class="ui-button ui-button--primary ui-button--block" type="submit">Upload receipt</button></form>`;
}

/** A banner for a payment outcome: danger for no reservation, neutral for waiting states, success when received. */
export function paymentOutcomeBannerHtml(
  tone: "danger" | "neutral" | "success",
  text: string,
  at?: { readonly label: string; readonly iso: string },
): string {
  const time =
    at === undefined
      ? ""
      : `${escapeHtml(at.label)} <time datetime="${escapeHtml(at.iso)}">${escapeHtml(formatWAT(at.iso))}</time>`;
  return `<p class="ui-banner ui-banner--${tone}"${tone === "danger" ? ' role="alert"' : ""}>${icon(tone === "danger" ? "alert" : tone === "success" ? "check" : "clock")}<span>${time}${time && text ? "<br>" : ""}${escapeHtml(text)}</span></p>`;
}

/** The recovery actions after a payment closes with no Reservation. */
export function paymentRecoveryActionsHtml(conversationHref: string): string {
  return `<a class="ui-button ui-button--primary ui-button--block" href="${escapeHtml(conversationHref)}">Back to your conversation</a><a class="ui-button ui-button--secondary ui-button--block" href="/stays/search">Find other stays</a>`;
}

/** "What happens next": a plain numbered list. */
export function stepsHtml(items: readonly string[]): string {
  return `<ol class="ui-steps">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>`;
}

/** Issue 10: the confirmation uses the same kit sections on the page and in the workspace. */
export function confirmationScreenHtml(content: ConfirmationContent, ticket: string, breakdown: string): string {
  return `<section class="confirmed-screen"><header class="ui-page__header request-head" data-page="booking-record"><p class="ui-eyebrow">Your booking</p><h2>Reservation confirmed</h2>${statusHtml("success", "Stay payment verified")}</header>${ticket}${breakdown}<section class="ui-panel request-next" aria-label="Before you arrive"><h2>Before you arrive</h2>${stepsHtml(content.steps)}</section><div class="request-actions"><a class="ui-button ui-button--primary ui-button--block" href="${escapeHtml(content.conversationHref)}">Back to your conversation</a><a class="ui-button ui-button--secondary ui-button--block" href="${escapeHtml(content.detailsHref)}">View booking details</a></div><section class="ui-panel booking-details" id="booking-details" tabindex="-1"><h2>Booking details</h2><p>${escapeHtml(content.details)}</p></section></section>`;
}

/** Issue 07: one request screen layout. Slots receive only markup from this kit, never artifact-supplied HTML. */
export function requestScreenHtml(content: RequestScreenContent, ticket: string, breakdown: string, actionTotal?: string): string {
  const form = (action: RequestScreenContent["primary"], primary: boolean): string => `<form method="post" action="${escapeHtml(action.path)}">${action.surfaceId === undefined ? "" : `<input type="hidden" name="surfaceId" value="${escapeHtml(action.surfaceId)}">`}<button class="ui-button ui-button--${primary ? "primary" : "secondary"} ui-button--block" type="submit"${action.surfaceId === "" ? " disabled" : ""}>${escapeHtml(action.label)}</button></form>`;
  const who = content.guests === undefined ? "" : `<section class="ui-panel request-guests" aria-label="Who's staying"><h2>Who's staying</h2><dl class="ui-facts ui-facts--stacked"><dt>Guests</dt><dd>${escapeHtml(content.guests)}</dd>${content.selfBooking === undefined ? "" : `<dt>You're booking for yourself</dt><dd>${content.selfBooking ? "Yes" : "No"}</dd>`}</dl>${content.changeHref === undefined ? "" : `<a class="ui-link" href="${escapeHtml(content.changeHref)}">Change dates or guests${icon("arrow-right")}</a>`}</section>`;
  const banner = content.banner === undefined ? "" : `<p class="ui-banner ui-banner--neutral">${icon("info")}<span>${escapeHtml(content.banner)}</span></p>`;
  const deadline = content.deadline === undefined ? "" : `<p class="request-deadline"><time class="waiting-deadline-time" datetime="${escapeHtml(content.deadline.iso)}">${escapeHtml(content.deadline.text)}</time><span class="waiting-countdown"></span></p>`;
  const editable = content.state === "draft" || content.state === "review";
  const sum = editable && actionTotal !== undefined ? `<p class="ui-action-bar__sum"><strong>${escapeHtml(actionTotal)}</strong><span class="ui-money-metadata">${GUEST_GLOSSARY.allInStayTotal}</span></p>` : "";
  return `<section class="request-screen" data-request-state="${content.state}"><header class="ui-page__header request-head" data-page="booking-record"><p class="ui-eyebrow">${GUEST_GLOSSARY.bookingRequest}</p><h2>${escapeHtml(content.title)}</h2>${statusHtml(content.tone, content.status)}</header>${banner}<div class="request-ticket">${ticket}</div>${who}<div class="request-breakdown">${breakdown}</div>${content.provider === undefined ? "" : `<p class="request-provider">${escapeHtml(content.provider)}</p>`}${content.sentAt === undefined ? "" : `<p class="ui-field__hint">${escapeHtml(content.sentAt)}</p>`}${deadline}<section class="ui-panel request-next"><h2>What happens next</h2>${stepsHtml(content.steps)}</section>${content.notes.length ? `<div class="request-notes">${content.notes.map((note) => `<p>${escapeHtml(note)}</p>`).join("")}</div>` : ""}<div class="request-actions${editable ? " ui-action-bar" : ""}">${sum}${form(content.primary, true)}${content.secondary === undefined ? "" : form(content.secondary, false)}</div></section>`;
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
