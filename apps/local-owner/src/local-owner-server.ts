import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import {
  DECLINE_REASONS,
  OperatorDecisionInputError,
  type DeclineReasonCode,
  LocalApartmentOwnerEnvironment,
  resetLocalOwnerFixture,
  DEFAULT_LOCAL_OWNER_CONFIG,
  type LocalOwnerStateOverview,
  type OperatorBooking,
  type OperatorReservation,
  COMPLAINT_CATEGORY_LABELS,
  CheckInInputError,
  CheckInStaleError,
} from "./local-owner-environment.js";
import { SUPPORT_VERIFICATION_BASES, type AccessStatus, type ComplaintCategory, type SupportVerificationBasis } from "../../../domains/shortlet/src/index.js";
import { BOOKING_ENDED_REASONS, BOOKING_PAYMENT_METHOD_LABELS, BOOKING_STAGE_LABELS, type BookingStage } from "./booking-projection.js";
import { escapeHtml, formatMoney, icon, pageShell, type StatusTone } from "../../web/src/ui-kit.js";
import { OPERATOR_RESPONSE_REMINDER_MINUTES, operatorResponseReminderDue, type OperatorAuthenticatedPrincipal } from "../../../domains/shortlet/src/index.js";
import type { CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import { backOfficePage, SIGN_IN_REASONS, signInReason, watTime, type BackOfficeViewer, type SignInReason } from "./back-office-view.js";
import { formatStayDates } from "../../web-agent/src/booking-presentation.js";

const OPERATOR_SESSION_COOKIE = "shortlet_operator_session";
const OPERATOR_SECRET_COOKIE = "shortlet_operator_secret";
const SHORTLET_FOUNDATION_CSS = readFileSync(new URL("../../web/src/shortlet-foundations.css", import.meta.url), "utf8");

function cookieValue(req: IncomingMessage, name: string): string | null {
  const raw = req.headers.cookie ?? "";
  const pair = raw.split(";").map((value) => value.trim()).find((value) => value.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : null;
}

function operatorPrincipal(req: IncomingMessage, env: LocalApartmentOwnerEnvironment): OperatorAuthenticatedPrincipal | null {
  return env.sessionAuthority.resolveSession(cookieValue(req, OPERATOR_SESSION_COOKIE), cookieValue(req, OPERATOR_SECRET_COOKIE));
}

/** Where a page request without a usable session goes: sign-in, with a fixed reason code when there is one (ADR 0086). */
function signInLocation(req: IncomingMessage, env: LocalApartmentOwnerEnvironment): string {
  const rejection = env.sessionAuthority.sessionRejection(cookieValue(req, OPERATOR_SESSION_COOKIE), cookieValue(req, OPERATOR_SECRET_COOKIE));
  const reason: SignInReason | null = rejection === "expired" ? "expired" : rejection === "revoked" ? "signed-out" : null;
  return reason ? `/operator/login?reason=${reason}` : "/operator/login";
}

type OperatorPrincipal = OperatorAuthenticatedPrincipal;

function commandPrincipal(principal: OperatorPrincipal): CommandPrincipal {
  return { id: principal.actorId, role: "operator", tenantId: principal.tenantId };
}

function viewer(env: LocalApartmentOwnerEnvironment, principal: OperatorPrincipal): BackOfficeViewer {
  return { name: env.representativeDisplayName(principal.actorId) };
}

function operatorLoginHtml(error = "", reason: SignInReason | null = null): string {
  const notice = error
    ? `<p class="ui-banner ui-banner--danger" role="alert">${icon("alert")}<span>${escapeHtml(error)}</span></p>`
    : reason ? `<p class="ui-banner" role="status">${icon("info")}<span>${escapeHtml(SIGN_IN_REASONS[reason])}</span></p>` : "";
  return pageShell({
    title: "Operator sign in",
    width: "narrow",
    body: `<header class="ui-page__header"><p class="ui-eyebrow">Shortlet back office</p><h1>Operator sign in</h1><p>Enter the one-time access token provided by operations.</p></header>${notice}<form class="ui-panel" method="post" action="/operator/login"><div class="ui-field"><label class="ui-field__label" for="token">One-time access token</label><input id="token" name="token" autocomplete="one-time-code" required></div><button class="ui-button ui-button--primary ui-button--block" type="submit">Sign in</button></form>`,
  });
}

/**
 * Something waiting on you, with the instant it is due. Later slices add kinds here
 * (manual transfers to verify, B6; owner payouts due, B7) and a builder in `waitingItems`.
 */
interface WaitingItem {
  readonly kind: "request";
  readonly href: string;
  readonly title: string;
  readonly ownerName: string;
  readonly apartmentTitle: string;
  /** Projected ISO instant, never recalculated (ADR 0077). */
  readonly dueAt: string;
  readonly dueLabel: string;
}

function waitingItems(env: LocalApartmentOwnerEnvironment, principal: OperatorPrincipal): readonly WaitingItem[] {
  // listOperatorRequestArtifacts re-checks the grant per owner (ADR 0082) and resolves expiry lazily on read.
  const requests: WaitingItem[] = env.listOperatorRequestArtifacts(commandPrincipal(principal))
    .filter((request) => request.facts.status === "disclosed" && request.actions.length > 0)
    .map((request) => ({
      kind: "request",
      href: `/operator/requests/${encodeURIComponent(request.facts.requestId)}`,
      title: "Booking Request to answer",
      ...env.requestLabels(request.facts.requestId),
      dueAt: request.facts.operatorResponseDeadlineAt,
      dueLabel: "Respond by",
    }));
  return [...requests].sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
}

function operatorHomeHtml(env: LocalApartmentOwnerEnvironment, principal: OperatorPrincipal): string {
  const items = waitingItems(env, principal);
  const list = items.length === 0
    ? `<section class="ui-panel ui-empty"><div class="ui-empty__art">${icon("check")}</div><h2>Nothing is waiting on you</h2><p>New Booking Requests appear here as soon as a Guest sends one.</p></section>`
    : `<ol class="bo-waiting">${items.map((item) => `<li class="bo-waiting__item" data-kind="${item.kind}"><a href="${escapeHtml(item.href)}"><span class="bo-waiting__title">${escapeHtml(item.title)}</span><span>${escapeHtml(item.apartmentTitle)}</span><span>${escapeHtml(item.ownerName)}</span><span>${escapeHtml(item.dueLabel)} ${watTime(item.dueAt)}</span></a></li>`).join("")}</ol>`;
  const summary = items.length === 0 ? "" : `<p>${items.length} ${items.length === 1 ? "item is" : "items are"} waiting on you, soonest deadline first.</p>`;
  return backOfficePage({
    title: "Home",
    viewer: viewer(env, principal),
    current: "home",
    body: `<header class="ui-page__header"><h1>Waiting on you</h1>${summary}</header>${list}`,
  });
}

/** Operator-facing lifecycle labels. The raw domain status stays in data-status for tooling. */
function requestStatus(status: string, delivered = true): { readonly label: string; readonly tone: StatusTone } {
  if (status === "disclosed") return delivered ? { label: "Awaiting your response", tone: "info" } : { label: "Delivery pending", tone: "neutral" };
  if (status === "confirmed") return { label: "Request confirmed", tone: "success" };
  if (status === "declined") return { label: "Request declined", tone: "danger" };
  if (status === "expired") return { label: "Request expired", tone: "warning" };
  // ADR 0043: a failed delivery is its own state; it never started your clock and is not a missed response.
  if (status === "delivery_failed") return { label: "Delivery Failed", tone: "stale" };
  return { label: `Request ${status}`, tone: "neutral" };
}

function requestBadge(status: string, delivered = true): string {
  const { label, tone } = requestStatus(status, delivered);
  return `<span class="ui-status ui-status--${tone}" data-status="${escapeHtml(status)}">${escapeHtml(label)}</span>`;
}

function guestParty(facts: { readonly occupantCount?: number; readonly occupants: readonly string[] }): string {
  const count = facts.occupantCount ?? facts.occupants.length;
  return `${count} ${count === 1 ? "occupant" : "occupants"}`;
}

function minutesLeft(deadlineIso: string, now: Date): number {
  return Math.max(0, Math.ceil((Date.parse(deadlineIso) - now.getTime()) / 60_000));
}

function minutesPhrase(minutes: number): string {
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"} left`;
}

/** In-page reminder wording (decision D2); the offsets themselves live in the domain (ADR 0041). */
function reminderLabel(reminder: number, left: number): string {
  const last = OPERATOR_RESPONSE_REMINDER_MINUTES[OPERATOR_RESPONSE_REMINDER_MINUTES.length - 1];
  return `${reminder === last ? "Final reminder" : "Reminder"}: ${minutesPhrase(left)}`;
}

/**
 * Speaks the page's reminder summary once per reminder: a re-render with the same key stays silent.
 * Progressive enhancement only; without JavaScript the rows still show each reminder and absolute deadline.
 */
const REMINDER_ANNOUNCER = `(() => { const region = document.getElementById("bo-reminders"); if (!region) return; const announceKey = region.dataset.announceKey; const text = region.dataset.announce; if (!announceKey || !text) return; let spoken = []; try { spoken = JSON.parse(sessionStorage.getItem("bo-reminders-spoken") || "[]"); } catch { spoken = []; } const fresh = announceKey.split(" ").filter((key) => !spoken.includes(key)); if (fresh.length === 0) return; setTimeout(() => { region.textContent = text; }, 250); try { sessionStorage.setItem("bo-reminders-spoken", JSON.stringify([...spoken, ...fresh].slice(-200))); } catch { /* storage may be unavailable */ } })();`;

function operatorInboxHtml(env: LocalApartmentOwnerEnvironment, principal: OperatorPrincipal): string {
  // Read time is server time from the injected clock (ADR 0077); the list read also resolves expiry lazily.
  const requests = env.listOperatorRequestArtifacts(commandPrincipal(principal));
  const now = env.clock();
  const awaiting = requests.filter((request) => request.facts.status === "disclosed" && request.facts.delivered).length;
  const reminders: { readonly requestId: string; readonly reminder: number }[] = [];
  const rows = requests.map((request) => {
    const facts = request.facts;
    const labels = env.requestLabels(facts.requestId);
    const awaitingResponse = facts.status === "disclosed" && facts.delivered;
    const reminder = operatorResponseReminderDue(facts, now);
    if (reminder !== null) reminders.push({ requestId: facts.requestId, reminder });
    const left = minutesLeft(facts.operatorResponseDeadlineAt, now);
    const deadlineId = `deadline-${encodeURIComponent(facts.requestId)}`;
    const timing = awaitingResponse
      ? `<span class="bo-request__deadline" id="${escapeHtml(deadlineId)}">Respond by ${watTime(facts.operatorResponseDeadlineAt)} · ${reminder === null ? minutesPhrase(left) : `<strong class="bo-request__reminder">${escapeHtml(reminderLabel(reminder, left))}</strong>`}</span>`
      : "";
    const guest = facts.primaryGuestName ? `${escapeHtml(facts.primaryGuestName)} · ` : "";
    return `<li class="bo-request" data-request-id="${escapeHtml(facts.requestId)}"${reminder === null ? "" : ` data-reminder="${reminder}"`}><a class="ui-list__row" href="/operator/requests/${encodeURIComponent(facts.requestId)}"${timing ? ` aria-describedby="${escapeHtml(deadlineId)}"` : ""}><span class="ui-list__primary">${guest}${escapeHtml(labels.apartmentTitle)}</span><span class="ui-list__aside"><span class="ui-sr-only">All-In Stay Total </span>${formatMoney(facts.quote?.allInStayTotalKobo ?? 0)}</span><span class="ui-list__secondary">${escapeHtml(labels.ownerName)} · ${escapeHtml(formatStayDates(facts.checkIn, facts.checkOut))} · ${facts.nights} ${facts.nights === 1 ? "night" : "nights"} · ${guestParty(facts)}</span><span class="ui-list__status">${requestBadge(facts.status, facts.delivered)}</span>${timing}</a></li>`;
  }).join("");
  const summary = requests.length === 0 ? "" : `<p>${awaiting === 0 ? "Nothing needs a response right now." : `${awaiting} ${awaiting === 1 ? "request needs" : "requests need"} your response.`}</p>`;
  const announce = reminders.length === 0 ? "" : `${reminders.length} ${reminders.length === 1 ? "request has" : "requests have"} reached a reminder. Answer the soonest deadline first.`;
  const liveRegion = `<p id="bo-reminders" class="ui-sr-only" role="status" data-announce="${escapeHtml(announce)}" data-announce-key="${escapeHtml(reminders.map((item) => `${item.requestId}:${item.reminder}`).join(" "))}"></p>`;
  const list = rows
    ? `<ul class="ui-list">${rows}</ul>`
    : `<section class="ui-panel ui-empty"><div class="ui-empty__art">${icon("inbox")}</div><h2>No Booking Requests yet</h2><p>No Booking Requests are visible to this representative. New requests appear here as soon as a Guest sends one.</p></section>`;
  return backOfficePage({
    title: "Requests",
    viewer: viewer(env, principal),
    current: "requests",
    style: ".bo-request__deadline{grid-column:1/-1;color:var(--color-text-secondary)}.bo-request[data-reminder] .bo-request__reminder{color:var(--color-warning)}",
    body: `<header class="ui-page__header"><h1>Booking Requests</h1>${summary}</header>${liveRegion}<h2 class="ui-sr-only">Requests</h2>${list}<script>${REMINDER_ANNOUNCER}</script>`,
  });
}

/**
 * Confirm re-attests the ADR 0041 facts for the named owner behind an explicit affirmative; decline takes a D1
 * reason code only. Both carry the version they were rendered from (ADR 0072). Works without JavaScript (ADR 0080).
 */
function decisionFormsHtml(requestId: string, ownerName: string, allInStayTotalKobo: number, version: number): string {
  const action = (kind: "confirm" | "decline") => `/operator/requests/${encodeURIComponent(requestId)}/${kind}`;
  const owner = escapeHtml(ownerName);
  const versionField = `<input type="hidden" name="basedOnVersion" value="${version}">`;
  // ADR 0041: "Confirmation explicitly re-attests availability, price, included services, arrival, maintenance, access, and absence of external conflict."
  // Items are the ADR's own words; only the price carries this request's amount.
  const attested = ["Availability", `Price (All-In Stay Total ${formatMoney(allInStayTotalKobo)})`, "Included services", "Arrival", "Maintenance", "Access", "No external conflict"]
    .map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const reasons = (Object.keys(DECLINE_REASONS) as DeclineReasonCode[]).map((code) => `<label class="bo-choice"><input type="radio" name="reason" value="${code}" required> ${escapeHtml(DECLINE_REASONS[code])}</label>`).join("");
  // Declining is irreversible for the Guest, so it sits behind a disclosure that restates the consequence.
  return `<section class="ui-panel" aria-labelledby="decision-heading"><h2 id="decision-heading">Your decision</h2>`
    + `<form method="post" action="${action("confirm")}" class="ui-stack">${versionField}<h3>Confirm on behalf of ${owner}</h3><p>By confirming you re-attest, on behalf of ${owner}:</p><ul class="bo-attest">${attested}</ul><p>Confirming creates a Conditional Booking Offer for the Guest. The stay becomes a Reservation only after the Guest pays.</p><label class="bo-choice"><input type="checkbox" name="attest" value="yes" required> I have checked each of these with ${owner} and attest to them on their behalf.</label><button class="ui-button ui-button--primary ui-button--block" type="submit">Confirm for ${owner}</button></form>`
    + `<details class="ui-confirm"><summary>Decline this request…</summary><div class="ui-confirm__body"><form method="post" action="${action("decline")}" class="ui-stack">${versionField}<fieldset class="bo-reasons"><legend>Reason</legend>${reasons}</fieldset><p>Declining releases these dates immediately. The Guest never sees the reason.</p><button class="ui-button ui-button--destructive ui-button--block" type="submit">Decline Booking Request</button></form></div></details></section>`;
}

const DECISION_STYLE = ".bo-attest{margin:0;padding-inline-start:var(--space-5);display:grid;gap:var(--space-1)}.bo-choice{display:flex;gap:var(--space-3);align-items:flex-start;min-block-size:var(--control-min-target);padding-block:var(--space-2);cursor:pointer}.bo-choice input{inline-size:1.5rem;block-size:1.5rem;flex:none;margin:0}.bo-reasons{border:0;margin:0;padding:0;display:grid;gap:var(--space-1)}.bo-reasons legend{font-weight:600;padding:0}.ui-panel h3{margin:0;font-size:var(--font-size-body)}";

/** Why a decision was refused, in plain words, from the request's current state (B3 AC4). */
function refusalNotice(env: LocalApartmentOwnerEnvironment, principal: OperatorPrincipal, requestId: string, error: unknown): string {
  if (error instanceof OperatorDecisionInputError) {
    return error.problem === "attestation_required"
      ? `Tick the box to attest these facts for ${env.requestLabels(requestId).ownerName} before confirming. Nothing was changed.`
      : "Choose Dates not available or Other reason before declining. Nothing was changed.";
  }
  if (error instanceof DecisionFormError) return "This form could not be read. Review the request and decide again. Nothing was changed.";
  const status = env.operatorRequestDetail(requestId, commandPrincipal(principal)).facts.status;
  if (status === "confirmed" || status === "declined") return `This request is already ${status}. Your decision was not applied.`;
  if (status === "expired") return "This request has expired. Your decision was not applied.";
  if (status === "delivery_failed") return "This request failed delivery. Your decision was not applied.";
  return "This request changed since you opened it. Review it and decide again.";
}

class DecisionFormError extends Error {}

/** Only the fields each form sends are accepted, so no free text can ride along (ADR 0075, D1). */
function decisionFromForm(kind: "confirm" | "decline", body: string): { readonly basedOnVersion: number; readonly attested: boolean; readonly reason: string } {
  const params = new URLSearchParams(body);
  const allowed = kind === "confirm" ? ["basedOnVersion", "attest"] : ["basedOnVersion", "reason"];
  const keys = [...params.keys()];
  if (keys.some((key) => !allowed.includes(key)) || new Set(keys).size !== keys.length) throw new DecisionFormError("Unexpected decision fields");
  const version = params.get("basedOnVersion") ?? "";
  if (!/^\d{1,6}$/.test(version)) throw new DecisionFormError("Missing decision version");
  return { basedOnVersion: Number(version), attested: params.get("attest") === "yes", reason: params.get("reason") ?? "" };
}

async function readForm(req: IncomingMessage, limit = 4096): Promise<string> {
  const buffers: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) { const buffer = Buffer.from(chunk); size += buffer.length; if (size > limit) throw new DecisionFormError("Form too large"); buffers.push(buffer); }
  return Buffer.concat(buffers).toString("utf8");
}

function operatorRequestHtml(env: LocalApartmentOwnerEnvironment, principal: OperatorPrincipal, requestId: string, error = ""): string {
  const request = env.operatorRequestDetail(requestId, commandPrincipal(principal));
  const facts = request.facts;
  const labels = env.requestLabels(requestId);
  const decision = request.actions.find((candidate) => candidate.type === "confirm");
  const decisions = decision && facts.status === "disclosed"
    ? decisionFormsHtml(requestId, labels.ownerName, facts.quote?.allInStayTotalKobo ?? 0, decision.projectionVersion)
    : `<p class="ui-banner">${icon("info")}<span>This request is no longer actionable.</span></p>`;
  const phone = facts.phoneNumber ? `<dt>Phone number</dt><dd>${escapeHtml(facts.phoneNumber)}</dd>` : "";
  return backOfficePage({
    title: `Booking Request · ${labels.apartmentTitle}`,
    style: DECISION_STYLE,
    viewer: viewer(env, principal),
    current: "requests",
    body: `<p><a class="ui-button ui-button--quiet" href="/operator/requests">${icon("arrow-left")}Back to requests</a></p><header class="ui-page__header" data-request-id="${escapeHtml(facts.requestId)}"><p class="ui-eyebrow">Booking Request</p><h1>${escapeHtml(labels.apartmentTitle)}</h1><div class="ui-row">${requestBadge(facts.status, facts.delivered)}</div></header>${error ? `<p class="ui-banner ui-banner--danger" role="alert">${icon("alert")}<span>${escapeHtml(error)}</span></p>` : ""}<section class="ui-panel" aria-label="Request facts"><dl class="ui-facts"><dt>Owner</dt><dd>${escapeHtml(labels.ownerName)}</dd><dt>Apartment</dt><dd>${escapeHtml(labels.apartmentTitle)}</dd><dt>Dates</dt><dd><time datetime="${escapeHtml(facts.checkIn)}">${escapeHtml(facts.checkIn)}</time> to <time datetime="${escapeHtml(facts.checkOut)}">${escapeHtml(facts.checkOut)}</time> (${facts.nights} nights)</dd><dt>Guest party</dt><dd>${guestParty(facts)}</dd>${phone}<dt>All-In Stay Total</dt><dd class="ui-money-total">${formatMoney(facts.quote?.allInStayTotalKobo ?? 0)}</dd>${facts.quote?.refundableSecurityDepositKobo ? `<dt>Refundable Security Deposit</dt><dd>${formatMoney(facts.quote.refundableSecurityDepositKobo)}</dd>` : ""}<dt>Response deadline</dt><dd>${watTime(facts.operatorResponseDeadlineAt)}</dd></dl></section>${decisions}`,
  });
}

const BOOKING_TONES: Readonly<Record<BookingStage, StatusTone>> = { offer_not_issued: "warning", offer_issued: "info", awaiting_payment: "info", reservation_confirmed: "success", ended: "neutral" };

function bookingBadge(booking: OperatorBooking): string {
  return `<span class="ui-status ui-status--${BOOKING_TONES[booking.stage]}">${escapeHtml(BOOKING_STAGE_LABELS[booking.stage])}</span>`;
}

function bookingPaymentMethod(booking: OperatorBooking): string {
  return booking.paymentMethod ? BOOKING_PAYMENT_METHOD_LABELS[booking.paymentMethod] : "Not chosen yet";
}

/**
 * What the booking is waiting for, or why it ended. Deadlines are the projected instants as absolute WAT (ADR 0044, 0077).
 * An ended booking gives only its reason: never a card, account, reference or contact detail (ADR 0075).
 */
function bookingTiming(booking: OperatorBooking): string {
  if (booking.stage === "ended" && booking.endedReason) return escapeHtml(BOOKING_ENDED_REASONS[booking.endedReason]);
  if ((booking.stage === "offer_issued" || booking.stage === "awaiting_payment") && booking.paymentDeadlineAt) {
    return booking.graceEndsAt ? `Payment-Processing Grace until ${watTime(booking.graceEndsAt)}` : `Pay by ${watTime(booking.paymentDeadlineAt)}`;
  }
  return "";
}

function bookingTotal(booking: OperatorBooking): string {
  return booking.allInStayTotalKobo === null ? "" : formatMoney(booking.allInStayTotalKobo);
}

function operatorBookingsHtml(env: LocalApartmentOwnerEnvironment, principal: OperatorPrincipal): string {
  // Re-read on every view from the authoritative records; expiry resolves lazily against server time (ADR 0077).
  const bookings = env.listOperatorBookings(commandPrincipal(principal));
  const rows = bookings.map((booking) => {
    const timing = bookingTiming(booking);
    const timingId = `booking-timing-${encodeURIComponent(booking.requestId)}`;
    return `<li class="bo-booking" data-request-id="${escapeHtml(booking.requestId)}" data-stage="${booking.stage}"><a class="ui-list__row" href="/operator/bookings/${encodeURIComponent(booking.requestId)}"${timing ? ` aria-describedby="${escapeHtml(timingId)}"` : ""}><span class="ui-list__primary">${escapeHtml(booking.apartmentTitle)}</span><span class="ui-list__aside"><span class="ui-sr-only">All-In Stay Total </span>${bookingTotal(booking)}</span><span class="ui-list__secondary">${escapeHtml(booking.ownerName)} · ${escapeHtml(formatStayDates(booking.checkIn, booking.checkOut))} · Payment method: ${escapeHtml(bookingPaymentMethod(booking))}</span><span class="ui-list__status">${bookingBadge(booking)}</span>${timing ? `<span class="bo-booking__timing" id="${escapeHtml(timingId)}">${timing}</span>` : ""}</a></li>`;
  }).join("");
  const list = rows
    ? `<ul class="ui-list">${rows}</ul>`
    : `<section class="ui-panel ui-empty"><div class="ui-empty__art">${icon("calendar")}</div><h2>No bookings yet</h2><p>A Booking Request appears here once you confirm it.</p></section>`;
  const summary = bookings.length === 0 ? "" : `<p>Each confirmed request, with its payment and whether it became a Reservation.</p>`;
  return backOfficePage({
    title: "Bookings",
    viewer: viewer(env, principal),
    current: "bookings",
    style: BOOKING_STYLE,
    body: `<header class="ui-page__header"><h1>Bookings</h1>${summary}</header><h2 class="ui-sr-only">Bookings</h2>${list}`,
  });
}

const BOOKING_STYLE = ".bo-booking__timing{grid-column:1/-1;color:var(--color-text-secondary)}";

const ACCESS_STATUS_LABELS: Readonly<Record<AccessStatus, string>> = {
  awaiting_access: "Awaiting Verified Access",
  verified_access: "Verified Access recorded",
  late_voluntary_arrival: "Verified Access recorded (late voluntary arrival)",
  failed_access: "Access failed",
  // ADR 0022: conflicting evidence needs a human fulfilment review, which the back office does not resolve.
  under_human_review: "Under human fulfilment review",
};

/**
 * Check-in forms (ADR 0091): Verified Access needs one documented basis, and a complaint one fixed category.
 * No free text; each form carries the version it was rendered from (ADR 0072). Works without JavaScript (ADR 0080).
 */
function checkInFormsHtml(reservation: OperatorReservation): string {
  const action = (kind: "verified-access" | "blocking-complaint") => `/operator/bookings/${encodeURIComponent(reservation.requestId)}/${kind}`;
  const versionField = `<input type="hidden" name="basedOnVersion" value="${escapeHtml(reservation.version)}">`;
  const bases = (Object.keys(SUPPORT_VERIFICATION_BASES) as SupportVerificationBasis[]).map((code) => `<label class="bo-choice"><input type="radio" name="basis" value="${code}" required> ${escapeHtml(SUPPORT_VERIFICATION_BASES[code])}</label>`).join("");
  const categories = (Object.keys(COMPLAINT_CATEGORY_LABELS) as ComplaintCategory[]).map((code) => `<label class="bo-choice"><input type="radio" name="category" value="${code}" required> ${escapeHtml(COMPLAINT_CATEGORY_LABELS[code])}</label>`).join("");
  const access = reservation.accessStatus === "awaiting_access"
    ? `<form method="post" action="${action("verified-access")}" class="ui-stack">${versionField}<h3>Record Verified Access</h3><fieldset class="bo-reasons"><legend>How was access verified?</legend>${bases}</fieldset><p>The owner's word alone is not enough to record Verified Access.</p><button class="ui-button ui-button--primary ui-button--block" type="submit">Record Verified Access</button></form>`
    : "";
  const complaint = `<details class="ui-confirm"><summary>Report a Blocking Fulfilment Complaint…</summary><div class="ui-confirm__body"><form method="post" action="${action("blocking-complaint")}" class="ui-stack">${versionField}<fieldset class="bo-reasons"><legend>Category</legend>${categories}</fieldset><p>While the complaint is open, the owner payable is not due.</p><button class="ui-button ui-button--destructive ui-button--block" type="submit">Report complaint</button></form></div></details>`;
  return `<section class="ui-panel" aria-labelledby="checkin-heading"><h2 id="checkin-heading">Check-in</h2>${access}${complaint}</section>`;
}

function operatorReservationHtml(env: LocalApartmentOwnerEnvironment, principal: OperatorPrincipal, requestId: string, error = ""): string {
  const reservation = env.operatorReservation(requestId, commandPrincipal(principal));
  const window = reservation.checkInWindow ? `${reservation.checkInWindow.earliestAccessTime}–${reservation.checkInWindow.latestPermittedArrival} WAT` : "Not on file";
  const payable = reservation.openComplaints.length > 0
    ? "Not due while a Blocking Fulfilment Complaint is open"
    : reservation.ownerPayableDueAt ? `Due ${watTime(reservation.ownerPayableDueAt)}` : "Not due until Verified Access is recorded";
  const complaints = reservation.openComplaints.map((category) => `<dt>Open Blocking Fulfilment Complaint</dt><dd>${escapeHtml(COMPLAINT_CATEGORY_LABELS[category])}</dd>`).join("");
  const facts = `<dl class="ui-facts"><dt>Owner</dt><dd>${escapeHtml(reservation.ownerName)}</dd><dt>Apartment</dt><dd>${escapeHtml(reservation.apartmentTitle)}</dd><dt>Dates</dt><dd>${escapeHtml(formatStayDates(reservation.checkIn, reservation.checkOut))} (${reservation.nights} ${reservation.nights === 1 ? "night" : "nights"})</dd><dt>Guest party</dt><dd>${reservation.partySize} ${reservation.partySize === 1 ? "occupant" : "occupants"}</dd><dt>Arrival window</dt><dd>${escapeHtml(window)}</dd><dt>Checkout</dt><dd>${reservation.checkoutTime ? `${escapeHtml(reservation.checkoutTime)} WAT` : "Not on file"}</dd>${reservation.phoneNumber ? `<dt>Guest phone</dt><dd>${escapeHtml(reservation.phoneNumber)}</dd>` : ""}<dt>Amount paid</dt><dd class="ui-money-total">${formatMoney(reservation.amountPaidKobo)}</dd><dt>Payment method</dt><dd>${escapeHtml(reservation.paidWith ? BOOKING_PAYMENT_METHOD_LABELS[reservation.paidWith] : "Not on file")}</dd></dl>`;
  const status = `<dl class="ui-facts"><dt>Check-in</dt><dd>${escapeHtml(ACCESS_STATUS_LABELS[reservation.accessStatus])}</dd>${complaints}<dt>Owner payable</dt><dd>${payable}</dd></dl>`;
  return backOfficePage({
    title: `Reservation · ${reservation.apartmentTitle}`,
    viewer: viewer(env, principal),
    current: "bookings",
    style: DECISION_STYLE,
    body: `<p><a class="ui-button ui-button--quiet" href="/operator/bookings">${icon("arrow-left")}Back to bookings</a></p><header class="ui-page__header"><p class="ui-eyebrow">Reservation</p><h1>${escapeHtml(reservation.apartmentTitle)}</h1><div class="ui-row">${bookingBadge(reservation)}</div></header>${error ? `<p class="ui-banner ui-banner--danger" role="alert">${icon("alert")}<span>${escapeHtml(error)}</span></p>` : ""}<section class="ui-panel" aria-label="Reservation facts">${facts}</section><section class="ui-panel" aria-label="Check-in status">${status}</section>${checkInFormsHtml(reservation)}`,
  });
}

/** Only the fields each check-in form sends are accepted, so no free text can ride along (ADR 0075, 0091). */
function checkInFromForm(kind: "verified-access" | "blocking-complaint", body: string): { readonly basedOnVersion: string; readonly value: string } {
  const params = new URLSearchParams(body);
  const field = kind === "verified-access" ? "basis" : "category";
  const keys = [...params.keys()];
  if (keys.some((key) => key !== "basedOnVersion" && key !== field) || new Set(keys).size !== keys.length) throw new DecisionFormError("Unexpected check-in fields");
  const version = params.get("basedOnVersion") ?? "";
  if (!/^[0-9a-f]{16}$/.test(version)) throw new DecisionFormError("Missing check-in version");
  return { basedOnVersion: version, value: params.get(field) ?? "" };
}

/** Why a check-in action was refused, in plain words. Domain refusals keep their own wording (ADR 0091). */
function checkInRefusal(error: unknown): string {
  if (error instanceof CheckInInputError) return `${error.message}. Nothing was recorded.`;
  if (error instanceof DecisionFormError) return "This form could not be read. Review the Reservation and try again. Nothing was recorded.";
  if (error instanceof CheckInStaleError) return "This Reservation changed since you opened it. Review it and try again. Nothing was recorded.";
  const message = error instanceof Error ? error.message : "";
  const known = ["Verified Access cannot be recorded before the Contractual Check-In Window begins", "Verified Access is already recorded for this Reservation", "This Reservation has no Contractual Check-In Window on file"].find((text) => message.includes(text));
  return known ? `${known}. Nothing was recorded.` : "This action could not be completed. Nothing was recorded.";
}

function operatorBookingHtml(env: LocalApartmentOwnerEnvironment, principal: OperatorPrincipal, requestId: string): string {
  const booking = env.operatorBooking(requestId, commandPrincipal(principal));
  if (booking.stage === "reservation_confirmed") return operatorReservationHtml(env, principal, requestId);
  const timing = bookingTiming(booking);
  const total = bookingTotal(booking);
  return backOfficePage({
    title: `Booking · ${booking.apartmentTitle}`,
    viewer: viewer(env, principal),
    current: "bookings",
    body: `<p><a class="ui-button ui-button--quiet" href="/operator/bookings">${icon("arrow-left")}Back to bookings</a></p><header class="ui-page__header"><p class="ui-eyebrow">Booking</p><h1>${escapeHtml(booking.apartmentTitle)}</h1><div class="ui-row">${bookingBadge(booking)}</div></header><section class="ui-panel" aria-label="Booking facts"><dl class="ui-facts"><dt>Owner</dt><dd>${escapeHtml(booking.ownerName)}</dd><dt>Apartment</dt><dd>${escapeHtml(booking.apartmentTitle)}</dd><dt>Dates</dt><dd>${escapeHtml(formatStayDates(booking.checkIn, booking.checkOut))} (${booking.nights} ${booking.nights === 1 ? "night" : "nights"})</dd><dt>Guest party</dt><dd>${booking.partySize} ${booking.partySize === 1 ? "occupant" : "occupants"}</dd>${total ? `<dt>All-In Stay Total</dt><dd class="ui-money-total">${total}</dd>` : ""}<dt>Stage</dt><dd>${escapeHtml(BOOKING_STAGE_LABELS[booking.stage])}</dd><dt>Payment method</dt><dd>${escapeHtml(bookingPaymentMethod(booking))}</dd>${timing ? `<dt>${booking.stage === "ended" ? "Outcome" : "Payment deadline"}</dt><dd>${timing}</dd>` : ""}</dl></section>`,
  });
}

function bookingNotFoundHtml(env: LocalApartmentOwnerEnvironment, principal: OperatorPrincipal): string {
  return backOfficePage({
    title: "Not found",
    viewer: viewer(env, principal),
    current: "bookings",
    body: `<section class="ui-panel ui-empty"><div class="ui-empty__art">${icon("search")}</div><h1>Booking not found</h1><p>This booking does not exist, or you no longer act for its owner.</p><a class="ui-button ui-button--primary" href="/operator/bookings">Back to bookings</a></section>`,
  });
}

function operatorNotFoundHtml(env: LocalApartmentOwnerEnvironment, principal: OperatorPrincipal): string {
  return backOfficePage({
    title: "Not found",
    viewer: viewer(env, principal),
    current: "requests",
    body: `<section class="ui-panel ui-empty"><div class="ui-empty__art">${icon("search")}</div><h1>Request not found</h1><p>This Booking Request does not exist, or you no longer act for its owner.</p><a class="ui-button ui-button--primary" href="/operator/requests">Back to requests</a></section>`,
  });
}

const formatKobo = formatMoney;

export function renderOwnerDashboardHtml(overview: LocalOwnerStateOverview): string {
  const latestRequest = overview.pendingRequests[overview.pendingRequests.length - 1];

  return `<!DOCTYPE html>
<html lang="en-NG" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Shortlet Marketplace — Local Apartment Owner Test Surface</title>
  <link rel="stylesheet" href="/shortlet-foundations.css">
  <style>
    :root {
      /* Developer-only surface: the shared dark roles from shortlet-foundations.css. */
      --bg: var(--color-canvas);
      --card-bg: var(--color-surface);
      --border: var(--color-border-subtle);
      --text: var(--color-text-secondary);
      --text-heading: var(--color-text);
      --text-muted: var(--color-text-muted);
      --accent: var(--color-action);
      --accent-hover: var(--color-action-hover);
      --danger: var(--color-danger);
      --warning: var(--color-warning);
    }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: var(--font-sans);
      margin: 0;
      padding: 24px;
      line-height: 1.5;
    }
    .container {
      max-width: 1100px;
      margin: 0 auto;
    }
    header {
      border-bottom: 1px solid var(--border);
      padding-bottom: 16px;
      margin-bottom: 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    h1 {
      color: var(--text-heading);
      font-size: 24px;
      margin: 0 0 4px 0;
    }
    .badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: var(--radius-control);
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .badge-success { background: var(--color-success-surface); color: var(--color-success); border: 1px solid var(--color-success-border); }
    .badge-warning { background: var(--color-warning-surface); color: var(--color-warning); border: 1px solid var(--color-warning-border); }
    .badge-info { background: var(--color-info-surface); color: var(--color-info); border: 1px solid var(--color-info-border); }
    .badge-danger { background: var(--color-danger-surface); color: var(--color-danger); border: 1px solid var(--color-danger-border); }
    
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 20px;
      margin-bottom: 24px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius-card);
      padding: 20px;
    }
    .card h2 {
      color: var(--text-heading);
      font-size: 16px;
      margin-top: 0;
      margin-bottom: 16px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .meta-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
      font-size: 14px;
    }
    .meta-label { color: var(--text-muted); }
    .muted { color: var(--text-muted); font-size: var(--font-size-small); }
    .positive { color: var(--color-success); }
    .meta-value { color: var(--text-heading); font-weight: 500; }
    .mono { font-family: var(--font-mono); }
    
    .actions-panel {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius-card);
      padding: 20px;
      margin-bottom: 24px;
    }
    .btn {
      display: inline-block;
      padding: 8px 16px;
      font-size: 14px;
      font-weight: 600;
      border-radius: var(--radius-control);
      cursor: pointer;
      border: none;
      text-decoration: none;
    }
    .btn-primary { background: var(--accent); color: var(--color-on-action); }
    .btn-primary:hover { background: var(--accent-hover); }
    .btn-danger { background: var(--color-danger-surface); color: var(--danger); border: 1px solid var(--color-danger-border); }
    .btn-danger:hover { background: var(--color-danger-border); }
    .btn-secondary { background: var(--color-surface-subtle); color: var(--text); border: 1px solid var(--color-border); }
    .btn-secondary:hover { background: var(--color-surface-elevated); }
    
    .btn-group {
      display: flex;
      gap: 12px;
      margin-top: 16px;
    }
    
    .request-box {
      border: 1px solid var(--border);
      border-radius: var(--radius-control);
      padding: 16px;
      background: var(--bg);
      margin-top: 12px;
    }
    
    pre {
      background: var(--bg);
      padding: 12px;
      border-radius: var(--radius-control);
      border: 1px solid var(--border);
      font-family: var(--font-mono);
      font-size: 12px;
      overflow-x: auto;
      color: var(--text-muted);
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>Shortlet Apartment Owner Dashboard</h1>
        <div class="muted">Local Developer Simulation & Testing Experience (Local Owner Ready)</div>
      </div>
      <div>
        <span class="badge badge-success">Localhost Fixture Active</span>
      </div>
    </header>

    <div class="grid">
      <!-- Card 1: Operator & Representative Authority -->
      <div class="card">
        <h2>
          <span>Operator & Representative</span>
          <span class="badge ${overview.representative.isAuthorized ? 'badge-success' : 'badge-danger'}">
            ${overview.representative.isAuthorized ? 'Authorized' : 'Unauthorized'}
          </span>
        </h2>
        <div class="meta-row">
          <span class="meta-label">Operator Legal Entity:</span>
          <span class="meta-value">${overview.operator.name}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Operator ID:</span>
          <span class="meta-value mono">${overview.operator.id}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Representative Person:</span>
          <span class="meta-value">${overview.representative.name}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Actor ID:</span>
          <span class="meta-value mono">${overview.representative.actorId}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Verification Status:</span>
          <span class="meta-value">${overview.operator.verified ? 'CAC & ID Verified (Responsible Person)' : 'Pending'}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Grant ID:</span>
          <span class="meta-value mono">${overview.representative.grant?.grantId ?? 'No active grant'}</span>
        </div>
      </div>

      <!-- Card 2: Apartment Unit Profile -->
      <div class="card">
        <h2>
          <span>Apartment Status</span>
          <span class="badge ${overview.unit.published ? 'badge-success' : 'badge-warning'}">
            ${overview.unit.published ? 'Published & Eligible' : 'Draft'}
          </span>
        </h2>
        <div class="meta-row">
          <span class="meta-label">Title:</span>
          <span class="meta-value">${overview.unit.title}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Location:</span>
          <span class="meta-value">${overview.unit.neighbourhood}, ${overview.unit.city}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Occupancy Model:</span>
          <span class="meta-value">${overview.unit.occupancyModel} (Capacity: ${overview.unit.capacity})</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Nightly Rate:</span>
          <span class="meta-value">${formatKobo(overview.unit.nightlyKobo)} / night</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Security Deposit:</span>
          <span class="meta-value">${formatKobo(overview.unit.refundableSecurityDepositKobo)} (refundable)</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Physical Inspection:</span>
          <span class="meta-value">${overview.unit.inspectionStatus === 'passed' ? 'Passed (All 9 Safety Scopes)' : 'Pending'}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Management Authority:</span>
          <span class="meta-value">${overview.unit.authorityStatus === 'verified' ? 'Verified (8 Permissions)' : 'Pending'}</span>
        </div>
      </div>

      <!-- Card 3: Trust Tier & Settlement Projections -->
      <div class="card">
        <h2>
          <span>Settlement & Trust Tier</span>
          <span class="badge badge-info">Tier: ${overview.trustTier.tier}</span>
        </h2>
        <div class="meta-row">
          <span class="meta-label">Current Trust Tier:</span>
          <span class="meta-value" style="text-transform: capitalize;">${overview.trustTier.tier}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Enforcement Status:</span>
          <span class="meta-value">${overview.enforcement.operatorStatus} (Level: ${overview.enforcement.enforcementLevel})</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Commission Base (3 nights):</span>
          <span class="meta-value">${formatKobo(overview.payoutProjections.commissionBaseKobo)}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Captured Commission Rate:</span>
          <span class="meta-value">${(overview.payoutProjections.commissionRate * 100).toFixed(0)}% (Preferred tier)</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Operator Net:</span>
          <span class="meta-value">${formatKobo(overview.payoutProjections.operatorNetKobo)}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Ordinary Settlement (100%):</span>
          <span class="meta-value positive">${formatKobo(overview.payoutProjections.payableNowKobo)}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Routine Reserve:</span>
          <span class="meta-value">${formatKobo(overview.payoutProjections.reserveTrancheKobo)} (0% for Preferred)</span>
        </div>
      </div>
    </div>

    <!-- Incoming Booking Request Simulation & Decision Section -->
    <div class="actions-panel">
      <h2>Incoming Booking Request Interaction</h2>
      ${
        latestRequest
          ? `
        <div class="request-box">
          <div class="meta-row">
            <span class="meta-label">Request ID:</span>
            <span class="meta-value mono">${latestRequest.facts.requestId}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">Status:</span>
            <span class="meta-value">
              <span class="badge ${
                latestRequest.facts.status === 'confirmed'
                  ? 'badge-success'
                  : latestRequest.facts.status === 'declined'
                  ? 'badge-danger'
                  : 'badge-warning'
              }">${latestRequest.facts.status}</span>
            </span>
          </div>
          <div class="meta-row">
            <span class="meta-label">Stay Dates:</span>
            <span class="meta-value">${latestRequest.facts.checkIn} to ${latestRequest.facts.checkOut} (${latestRequest.facts.nights} nights)</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">All-In Stay Total:</span>
            <span class="meta-value">${formatKobo(latestRequest.facts.quote?.allInStayTotalKobo ?? 0)}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">Refundable Security Deposit:</span>
            <span class="meta-value">${formatKobo(latestRequest.facts.quote?.refundableSecurityDepositKobo ?? 0)}</span>
          </div>

          ${
            latestRequest.facts.status === 'disclosed' && latestRequest.actions.length > 0
              ? `
            <div class="btn-group">
              <form method="POST" action="/action/confirm" style="display:inline;">
                <input type="hidden" name="requestId" value="${latestRequest.facts.requestId}" />
                <button type="submit" class="btn btn-primary">Confirm Booking (Lock Availability)</button>
              </form>
              <form method="POST" action="/action/decline" style="display:inline;">
                <input type="hidden" name="requestId" value="${latestRequest.facts.requestId}" />
                <button type="submit" class="btn btn-danger">Decline Booking</button>
              </form>
            </div>
          `
              : `
            <div class="muted" style="margin-top: 12px;">
              Request finalized with status <strong>${latestRequest.facts.status}</strong>.
            </div>
          `
          }
        </div>
      `
          : `
        <p class="muted">No demo booking requests active. Click below to simulate a verified incoming guest request.</p>
        <form method="POST" action="/action/demo-request">
          <button type="submit" class="btn btn-secondary">Generate Demo Booking Request</button>
        </form>
      `
      }

      <div style="margin-top: 20px; border-top: 1px solid var(--border); padding-top: 16px; display: flex; gap: 12px;">
        <form method="POST" action="/action/demo-request">
          <button type="submit" class="btn btn-secondary">New Demo Request</button>
        </form>
        <form method="POST" action="/action/reset">
          <button type="submit" class="btn btn-danger">Reset Fixture</button>
        </form>
      </div>
    </div>

    <!-- API State Payload JSON -->
    <details>
      <summary class="muted" style="cursor: pointer; margin-bottom: 8px;">View Authoritative Local State JSON</summary>
      <pre>${JSON.stringify(overview, null, 2)}</pre>
    </details>
  </div>
</body>
</html>`;
}

export function startLocalOwnerServer(options: {
  port?: number;
  environment?: LocalApartmentOwnerEnvironment;
  secureCookie?: boolean;
  publicOrigin?: string;
  production?: boolean;
} = {}) {
  const port = options.port ?? 3000;
  let env = options.environment ?? new LocalApartmentOwnerEnvironment();
  const production = options.production === true;
  if (production && !options.publicOrigin) throw new Error("Production Operator server requires SHORTLET_PUBLIC_ORIGIN");
  const cookieFlags = `${(options.secureCookie ?? production) ? "; Secure" : ""}; HttpOnly; SameSite=Lax; Path=/operator`;
  const browserOriginAccepted = (req: IncomingMessage): boolean => {
    const origin = req.headers.origin;
    if (origin === undefined) return true;
    return origin === (options.publicOrigin ?? `http://${req.headers.host ?? "localhost"}`);
  };

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (req.method === "GET" && url.pathname === "/shortlet-foundations.css") {
      res.writeHead(200, { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=3600" });
      res.end(SHORTLET_FOUNDATION_CSS);
      return;
    }

    if (req.method === "GET" && url.pathname === "/operator/login") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(operatorLoginHtml("", signInReason(url.searchParams.get("reason")))); return;
    }
    if (req.method === "POST" && url.pathname === "/operator/login") {
      if (!browserOriginAccepted(req)) { res.writeHead(403); res.end("Origin rejected"); return; }
      const buffers: Buffer[] = []; for await (const chunk of req) buffers.push(Buffer.from(chunk));
      const params = new URLSearchParams(Buffer.concat(buffers).toString("utf8"));
      try {
        const result = env.sessionAuthority.authenticateAccessToken(params.get("token") ?? "");
        res.setHeader("Set-Cookie", [`${OPERATOR_SESSION_COOKIE}=${encodeURIComponent(result.sessionId)}${cookieFlags}`, `${OPERATOR_SECRET_COOKIE}=${encodeURIComponent(result.sessionSecret)}${cookieFlags}`]);
        res.writeHead(302, { Location: "/operator" }); res.end();
      } catch (error) { res.writeHead(401, { "Content-Type": "text/html; charset=utf-8" }); res.end(operatorLoginHtml(error instanceof Error ? error.message : "Authentication failed")); }
      return;
    }

    // Back-office pages fail closed (ADR 0086): a page without a usable session goes to sign-in with a fixed reason.
    const page = (render: (principal: OperatorPrincipal) => string): void => {
      const principal = operatorPrincipal(req, env);
      if (!principal) { res.writeHead(303, { Location: signInLocation(req, env) }); res.end(); return; }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(render(principal));
    };
    if (req.method === "GET" && (url.pathname === "/operator" || url.pathname === "/operator/")) {
      page((principal) => operatorHomeHtml(env, principal)); return;
    }
    if (req.method === "GET" && (url.pathname === "/operator/requests" || url.pathname === "/operator/requests/")) {
      page((principal) => operatorInboxHtml(env, principal)); return;
    }
    const detailMatch = url.pathname.match(/^\/operator\/requests\/([^/]+)$/);
    if (req.method === "GET" && detailMatch) {
      const principal = operatorPrincipal(req, env);
      if (!principal) { res.writeHead(303, { Location: signInLocation(req, env) }); res.end(); return; }
      let body: string;
      // An unknown request and one whose owner grant was revoked (ADR 0082) look the same: not found.
      try { body = operatorRequestHtml(env, principal, decodeURIComponent(detailMatch[1]!)); }
      catch { res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" }); res.end(operatorNotFoundHtml(env, principal)); return; }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(body);
      return;
    }
    // Bookings are read-only (B4): GET only, so there is no command to forge.
    if (req.method === "GET" && (url.pathname === "/operator/bookings" || url.pathname === "/operator/bookings/")) {
      page((principal) => operatorBookingsHtml(env, principal)); return;
    }
    const bookingMatch = url.pathname.match(/^\/operator\/bookings\/([^/]+)$/);
    if (req.method === "GET" && bookingMatch) {
      const principal = operatorPrincipal(req, env);
      if (!principal) { res.writeHead(303, { Location: signInLocation(req, env) }); res.end(); return; }
      let body: string;
      // Unknown, unconfirmed, and another owner's booking (ADR 0082) all look the same: not found.
      try { body = operatorBookingHtml(env, principal, decodeURIComponent(bookingMatch[1]!)); }
      catch { res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" }); res.end(bookingNotFoundHtml(env, principal)); return; }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(body);
      return;
    }
    const checkInMatch = url.pathname.match(/^\/operator\/bookings\/([^/]+)\/(verified-access|blocking-complaint)$/);
    if (req.method === "POST" && checkInMatch) {
      if (!browserOriginAccepted(req)) { res.writeHead(403); res.end("Origin rejected"); return; }
      const principal = operatorPrincipal(req, env);
      if (!principal) { res.writeHead(401); res.end("Authentication required"); return; }
      const requestId = decodeURIComponent(checkInMatch[1]!);
      const kind = checkInMatch[2] === "verified-access" ? "verified-access" : "blocking-complaint";
      try {
        const form = checkInFromForm(kind, await readForm(req));
        if (kind === "verified-access") env.recordVerifiedAccess(requestId, commandPrincipal(principal), { basis: form.value, basedOnVersion: form.basedOnVersion });
        else env.reportBlockingComplaint(requestId, commandPrincipal(principal), { category: form.value, basedOnVersion: form.basedOnVersion });
        res.writeHead(303, { Location: `/operator/bookings/${encodeURIComponent(requestId)}` }); res.end();
      } catch (error) {
        // Refused actions record nothing and re-render the current state. Unknown, not a Reservation, or a lost grant: not found (ADR 0082).
        let body: string;
        try { body = operatorReservationHtml(env, principal, requestId, checkInRefusal(error)); }
        catch { if (!res.headersSent) { res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" }); res.end(bookingNotFoundHtml(env, principal)); } return; }
        const statusCode = error instanceof CheckInInputError || error instanceof DecisionFormError ? 400 : 409;
        if (!res.headersSent) { res.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8" }); res.end(body); }
      }
      return;
    }
    const actionMatch = url.pathname.match(/^\/operator\/requests\/([^/]+)\/(confirm|decline)$/);
    if (req.method === "POST" && actionMatch) {
      if (!browserOriginAccepted(req)) { res.writeHead(403); res.end("Origin rejected"); return; }
      const principal = operatorPrincipal(req, env);
      if (!principal) { res.writeHead(401); res.end("Authentication required"); return; }
      const requestId = decodeURIComponent(actionMatch[1]!);
      const kind = actionMatch[2] === "confirm" ? "confirm" : "decline";
      try {
        const form = decisionFromForm(kind, await readForm(req));
        if (kind === "confirm") env.confirmOperatorRequest(requestId, commandPrincipal(principal), { attested: form.attested, basedOnVersion: form.basedOnVersion });
        else env.declineOperatorRequest(requestId, commandPrincipal(principal), { reason: form.reason, basedOnVersion: form.basedOnVersion });
        res.writeHead(303, { Location: `/operator/requests/${encodeURIComponent(requestId)}` }); res.end();
      } catch (error) {
        // Refused decisions change nothing and re-render the current state (B3 AC4). A grant lost mid-flight stays generic.
        const statusCode = error instanceof OperatorDecisionInputError || error instanceof DecisionFormError ? 400 : 409;
        let body = "Request action rejected";
        try { body = operatorRequestHtml(env, principal, requestId, refusalNotice(env, principal, requestId, error)); } catch { /* authorization may have changed; keep generic */ }
        if (!res.headersSent) { res.writeHead(statusCode, { "Content-Type": body.startsWith("<!doctype") ? "text/html; charset=utf-8" : "text/plain; charset=utf-8" }); res.end(body); }
      }
      return;
    }
    if (req.method === "POST" && url.pathname === "/operator/logout") {
      if (!browserOriginAccepted(req)) { res.writeHead(403); res.end("Origin rejected"); return; }
      const principal = operatorPrincipal(req, env); if (principal) env.sessionAuthority.revokeSession(principal.sessionId);
      res.setHeader("Set-Cookie", [`${OPERATOR_SESSION_COOKIE}=; Max-Age=0${cookieFlags}`, `${OPERATOR_SECRET_COOKIE}=; Max-Age=0${cookieFlags}`]);
      res.writeHead(302, { Location: "/operator/login" }); res.end(); return;
    }

    if (!production && req.method === "GET" && url.pathname === "/") {
      const overview = env.getStateOverview();
      const html = renderOwnerDashboardHtml(overview);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (!production && req.method === "GET" && url.pathname === "/api/state") {
      const overview = env.getStateOverview();
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(overview, null, 2));
      return;
    }

    if (!production && req.method === "POST") {
      const buffers: Buffer[] = [];
      for await (const chunk of req) {
        buffers.push(Buffer.from(chunk));
      }
      const rawBody = Buffer.concat(buffers).toString("utf8");
      const params = new URLSearchParams(rawBody);

      if (url.pathname === "/action/demo-request") {
        env.createDemoIncomingBookingRequest();
        res.writeHead(302, { Location: "/" });
        res.end();
        return;
      }

      if (url.pathname === "/action/confirm") {
        const requestId = params.get("requestId");
        if (requestId) {
          env.confirmBookingRequest(requestId);
        }
        res.writeHead(302, { Location: "/" });
        res.end();
        return;
      }

      if (url.pathname === "/action/decline") {
        const requestId = params.get("requestId");
        if (requestId) {
          env.declineBookingRequest(requestId);
        }
        res.writeHead(302, { Location: "/" });
        res.end();
        return;
      }

      if (url.pathname === "/action/reset") {
        env.close();
        resetLocalOwnerFixture(env.config.databasePath);
        env = new LocalApartmentOwnerEnvironment(env.config);
        res.writeHead(302, { Location: "/" });
        res.end();
        return;
      }
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  });

  return {
    server,
    get env() {
      return env;
    },
    listen: () =>
      new Promise<number>((resolve) => {
        server.listen(port, () => {
          const addr = server.address();
          const actualPort = typeof addr === "object" && addr ? addr.port : port;
          resolve(actualPort);
        });
      }),
    close: () =>
      new Promise<void>((resolve, reject) => {
        env.close();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
