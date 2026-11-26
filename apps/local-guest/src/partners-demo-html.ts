/**
 * The Demo stage of the founding partners page (landing issue 17; spec: .scratch/brand/guest-showcase-spec.md). Six frames of
 * one synthetic booking, all in the server HTML: without JavaScript they read as an ordered list, each screen with its captions
 * (ADR 0080 parity); partners-page.ts turns them into one stage. The data-demo-* attributes are the contract it reads.
 *
 * Every screen is a picture: inert, with no link, form or action in it (spec §5). Screen readers get the step's summary instead.
 * Strings the product shows come from guest-content.ts (ADR 0077); all listings are labelled (ADR 0105).
 */
import {
  GUEST_FACT_LABELS,
  GUEST_GLOSSARY,
  GUEST_JOURNEY,
  GUEST_MODE_CHOOSER,
  GUEST_PAYMENT_COPY,
  GUEST_RECEIPTS,
  guestReservationStatus,
} from "../../web-agent/src/guest-content.js";
import { formatNgnKobo } from "../../web-agent/src/discovery-a2ui.js";
import { escapeHtml } from "../../web/src/ui-kit.js";
import {
  PARTNERS_COPY,
  PARTNERS_DEMO_STEPS,
  type PartnersDemoStep,
} from "./partners-copy.js";

const CONCIERGE = GUEST_MODE_CHOOSER.conciergeLabel("Stays");
const [CONCIERGE_NAME, CONCIERGE_MODE] = CONCIERGE.split(" · ");
const NIGHTS = 30;
const NIGHTS_LABEL = `${NIGHTS} nights`;
const TITLE = "2-bedroom apartment, Wuse";
const TOTAL = formatNgnKobo(138_000_000);
const MATCHES = [
  { title: "2-bedroom, Wuse", total: TOTAL },
  { title: "1-bedroom, Garki", total: formatNgnKobo(103_500_000) },
  { title: "Studio, Wuse 2", total: formatNgnKobo(75_900_000) },
];
const STAY_FOOT = `${NIGHTS_LABEL} · 1 guest · Entire place`;

function glyph(paths: string, extraClass = ""): string {
  return `<svg class="ui-icon${extraClass}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths}</svg>`;
}
const PATH = {
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  pin: '<path d="M12 21s-6-5.5-6-10a6 6 0 0 1 12 0c0 4.5-6 10-6 10z"/><circle cx="12" cy="11" r="2"/>',
  calendar:
    '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  guests:
    '<circle cx="9" cy="9" r="3"/><path d="M3.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5M16 6.5a3 3 0 0 1 0 5.5M17.5 14.7c1.6.6 2.6 2 3 4.3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  send: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  photo:
    '<rect x="3" y="6" width="18" height="13" rx="2"/><circle cx="12" cy="12.5" r="3.5"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
};

function appBar(back: boolean): string {
  const action = back
    ? `<span class="ui-appbar__action">${glyph(PATH.back)}</span>`
    : "";
  return `<div class="ui-appbar">${action}<span class="ui-appbar__brand">${escapeHtml(PARTNERS_COPY.brand)}</span><span class="ui-mode-label"><span class="ui-mode-label__mark"></span>${escapeHtml(CONCIERGE_NAME!)} <span class="ui-mode-label__mode">· ${escapeHtml(CONCIERGE_MODE!)}</span></span><span class="ui-appbar__grow"></span></div>`;
}

const RAIL = [
  GUEST_JOURNEY.search,
  GUEST_JOURNEY.stay,
  GUEST_JOURNEY.request,
  GUEST_JOURNEY.offer,
  GUEST_JOURNEY.pay,
  GUEST_JOURNEY.confirmed,
];

function rail(current: number): string {
  const items = RAIL.map(
    (name, index) =>
      `<li${index < current ? ' class="is-done"' : index === current ? ' aria-current="step"' : ""}>${escapeHtml(name)}</li>`,
  ).join("");
  const bar = RAIL.map(
    (_name, index) =>
      `<span${index < current ? ' class="is-done"' : index === current ? ' class="is-now"' : ""}></span>`,
  ).join("");
  return `<div class="ui-rail-nav"><ol class="ui-rail">${items}</ol><p class="ui-rail-nav__compact"><span>Step ${current + 1} of ${RAIL.length} · <b>${escapeHtml(RAIL[current]!)}</b></span><span class="ui-rail-nav__bar">${bar}</span></p></div>`;
}

function composer(placeholder: string): string {
  return `<div class="ui-composer"><input class="ui-composer__input" type="text" readonly tabindex="-1" aria-label="${escapeHtml(placeholder)}" placeholder="${escapeHtml(placeholder)}"><span class="ui-composer__send">${glyph(PATH.send)}</span></div>`;
}

function demoChip(): string {
  return `<span class="ui-chip ui-chip--demo">${escapeHtml(GUEST_FACT_LABELS.demoListing)}</span>`;
}

function band(content: string, attributes = ""): string {
  return `<div class="ui-price-breakdown ui-price-breakdown--band"${attributes}>${content}</div>`;
}

function bandRow(kind: "due" | "paid", label: string): string {
  return `<p class="ui-price-breakdown__${kind}"><span>${escapeHtml(label)}</span><span>${escapeHtml(TOTAL)}</span></p>`;
}

function ticket(input: {
  readonly eyebrow: string;
  readonly name?: string;
  readonly foot: string;
  readonly band: string;
  readonly focal?: boolean;
}): string {
  const date = (
    label: string,
    day: string,
    long: string,
    end: boolean,
  ): string =>
    `<div class="ui-ticket__date${end ? " ui-ticket__date--end" : ""}"><span class="ui-ticket__label">${escapeHtml(label)}</span><span class="ui-ticket__day">${day}</span><span class="ui-ticket__time">${long}</span></div>`;
  return `<div class="ui-ticket"${input.focal ? " data-demo-focal" : ""}><span class="ui-ticket__eyebrow">${escapeHtml(input.eyebrow)}</span>${input.name === undefined ? "" : `<p class="ui-ticket__name">${escapeHtml(input.name)}</p>`}<div class="ui-ticket__dates">${date(GUEST_FACT_LABELS.checkIn, "3", "Thu 3 Dec 2026", false)}${glyph(PATH.arrow, " ui-ticket__arrow")}${date(GUEST_FACT_LABELS.checkOut, "2", "Sat 2 Jan 2027", true)}</div><p class="ui-ticket__foot">${escapeHtml(input.foot)}</p>${input.band}</div>`;
}

function neutral(text: string, focal = false): string {
  return `<div class="ui-banner ui-banner--neutral"${focal ? " data-demo-focal" : ""}><p class="ui-banner__body">${escapeHtml(text)}</p></div>`;
}

function askScreen(): string {
  const chip = (path: string, text: string, kind = ""): string =>
    `<span class="ui-chip${kind}">${glyph(path)}${escapeHtml(text)}</span>`;
  return `${appBar(false)}<div class="ui-conversation"><p class="ui-message ui-message--guest">I need a furnished place in Wuse or Maitama for a month from 3 December. Reliable power, Wi-Fi and a desk to work at.</p><div class="ui-chips"><span class="ui-chip" aria-pressed="true">${glyph(PATH.pin)}Wuse or Maitama</span>${chip(PATH.calendar, `3 Dec – 2 Jan · ${NIGHTS_LABEL}`)}${chip(PATH.guests, "1 guest")}${chip(PATH.plus, "Budget", " ui-chip--add")}</div></div>${composer("City or area, dates, guests")}`;
}

function matchesScreen(): string {
  const rows = MATCHES.map(
    (stay, index) =>
      `<li><span class="ui-result-row"${index === 0 ? " data-demo-focal" : ""}><span class="ui-result-row__thumb">${glyph(PATH.photo)}</span><span class="ui-result-row__body"><span class="ui-result-row__title">${escapeHtml(stay.title)}</span><span class="ui-result-row__price">${escapeHtml(stay.total)} <span>all-in · ${NIGHTS_LABEL}</span></span>${demoChip()}</span>${glyph(PATH.chevron)}</span></li>`,
  ).join("");
  return `${appBar(false)}<div class="ui-conversation"><p class="ui-persona"><span class="ui-persona__mark"></span>${escapeHtml(CONCIERGE_NAME!)} <span class="ui-persona__mode">· ${escapeHtml(CONCIERGE_MODE!)}</span></p><p class="ui-message">Three apartments are free for those dates. Each price is the ${escapeHtml(GUEST_GLOSSARY.allInStayTotal)} for ${NIGHTS_LABEL}.</p><ul class="ui-result-rows">${rows}</ul></div>${composer("Ask about these stays…")}`;
}

function apartmentScreen(): string {
  const facts = [
    ["Rooms", "2 bedrooms · 2 bathrooms · sleeps 4"],
    ["Included", "Power and generator fuel, water, internet"],
    ["Cleaning", "Weekly"],
  ]
    .map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`)
    .join("");
  const price = ticket({
    eyebrow: "Price for your dates",
    foot: STAY_FOOT,
    focal: true,
    band: band(
      `<p class="ui-price-breakdown__label">${escapeHtml(GUEST_GLOSSARY.allInStayTotal)} · ${NIGHTS_LABEL}</p><p class="ui-money-total">${escapeHtml(TOTAL)}</p>`,
    ),
  });
  return `${appBar(true)}${rail(1)}<div class="xp-screen__body"><div class="xp-screen__listing"><span class="ui-result-row__thumb">${glyph(PATH.photo)}</span><div><p class="xp-screen__title">${TITLE}</p><span class="ui-result-row__where">Photo coming soon</span>${demoChip()}</div></div><dl class="ui-facts">${facts}</dl>${price}</div><div class="ui-action-bar ui-action-bar--sticky" data-demo-bar><div class="ui-action-bar__sum"><span class="ui-money-total">${escapeHtml(TOTAL)}</span><span>All-in · ${NIGHTS_LABEL}</span></div><span class="ui-button ui-button--primary ui-button--pill">Request to book</span></div>`;
}

function requestScreen(): string {
  const stay = ticket({
    eyebrow: "Your stay",
    name: TITLE,
    foot: STAY_FOOT,
    band: band(
      `<span class="ui-price-breakdown__condition">${escapeHtml(GUEST_FACT_LABELS.ifRequestAccepted)}</span>${bandRow("due", GUEST_FACT_LABELS.amountDueNow)}`,
    ),
  });
  return `${appBar(true)}${rail(2)}<div class="xp-screen__body"><p class="ui-status ui-status--info">${glyph(PATH.info)}${escapeHtml(GUEST_RECEIPTS.requestSent)}</p>${stay}${neutral(guestReservationStatus("request-sent"), true)}<p class="ui-deadline ui-deadline--info" data-demo-keep><span class="ui-deadline__at">${glyph(PATH.clock)}The Operator replies by 11:42 AM WAT</span></p></div>`;
}

function offerScreen(): string {
  const stay = ticket({
    eyebrow: "Your stay",
    name: TITLE,
    foot: STAY_FOOT,
    band: band(
      bandRow("due", GUEST_FACT_LABELS.amountDueNow),
      " data-demo-keep",
    ),
  });
  return `${appBar(true)}${rail(3)}<div class="xp-screen__body"><p class="xp-screen__heading">${escapeHtml(GUEST_GLOSSARY.conditionalBookingOffer)}</p>${stay}${neutral(guestReservationStatus("offer-issued"))}<p class="ui-deadline" data-demo-focal><span class="ui-deadline__at">${glyph(PATH.clock)}Pay by 11:44 AM WAT</span></p></div><div class="ui-action-bar ui-action-bar--sticky" data-demo-bar><span class="ui-button ui-button--primary ui-button--pill">${escapeHtml(GUEST_PAYMENT_COPY.accept)}</span></div>`;
}

function confirmedScreen(): string {
  const stay = ticket({
    eyebrow: "Your stay",
    name: TITLE,
    foot: "Booking 0412",
    focal: true,
    band: band(bandRow("paid", GUEST_FACT_LABELS.amountPaid)),
  });
  const receipt = (text: string, attributes = ""): string =>
    `<li class="ui-status ui-status--success"${attributes}>${glyph(PATH.check)}${escapeHtml(text)}</li>`;
  return `${appBar(true)}${rail(5)}<div class="xp-screen__body"><p class="xp-screen__heading">${escapeHtml(guestReservationStatus("confirmed"))}</p>${stay}<span class="ui-button ui-button--secondary" data-demo-keep>${glyph(PATH.download)}Download receipt</span><ul class="xp-stack xp-stack--8">${receipt(GUEST_RECEIPTS.offerAccepted)}${receipt(GUEST_RECEIPTS.paymentVerified, " data-demo-keep")}</ul></div>`;
}

const SCREENS: readonly (() => string)[] = [
  askScreen,
  matchesScreen,
  apartmentScreen,
  requestScreen,
  offerScreen,
  confirmedScreen,
];

function youTag(): string {
  return `<span class="xp-you">${escapeHtml(PARTNERS_COPY.guest.you)}</span>`;
}

function captions(step: PartnersDemoStep): string {
  const copy = PARTNERS_COPY.guest;
  const link = step.link
    ? `<a href="#request" class="xp-link">${escapeHtml(copy.requestLink)}</a>`
    : "";
  return `<div class="xp-caps"><div class="xp-cap"><p class="xp-cap__head">${escapeHtml(copy.captionGuest)}</p><p class="xp-soft">${escapeHtml(step.guest)}</p></div><div class="xp-cap${step.marked ? " xp-cap--you" : ""}"><p class="xp-cap__head">${escapeHtml(copy.captionYou)}${step.marked ? youTag() : ""}</p><p>${escapeHtml(step.you)}</p>${link}</div></div>`;
}

function frame(step: PartnersDemoStep, index: number): string {
  const total = PARTNERS_DEMO_STEPS.length;
  return `<li class="xp-frame" data-demo-frame="${index + 1}" data-demo-name="${escapeHtml(step.name)}"><div class="xp-frame__screen"><p class="xp-frame__now">Step ${index + 1} of ${total} · ${escapeHtml(step.name)}</p><p class="xp-sr">${escapeHtml(step.summary)}</p><div class="xp-screen"><div class="ui-page" data-mode="stays" inert>${SCREENS[index]!()}</div><span class="xp-screen__fade" aria-hidden="true"></span></div></div>${captions(step)}</li>`;
}

/** The whole stage. The step list, the live line and the controls need the script, so they are hidden until it runs. */
export function demoStageHtml(): string {
  const copy = PARTNERS_COPY.guest;
  const steps = PARTNERS_DEMO_STEPS.map(
    (step, index) =>
      `<li data-demo-step="${index + 1}"${index === 0 ? ' aria-current="step"' : ""}><span class="xp-ssteps__n">${index + 1}</span>${escapeHtml(step.name)}${step.marked ? youTag() : ""}</li>`,
  ).join("");
  return `<div class="xp-stage" role="group" aria-label="${escapeHtml(copy.stageGroup)}" data-demo-stage><span class="xp-tag xp-stage__label">${escapeHtml(copy.stageLabel)}</span><ol class="xp-ssteps" aria-label="${escapeHtml(copy.stepsLabel)}" data-demo-steps hidden>${steps}</ol><ol class="xp-stage__frames">${PARTNERS_DEMO_STEPS.map(frame).join("")}</ol><p class="xp-sr" aria-live="polite" data-demo-live></p><div class="xp-sctl" data-demo-controls hidden><button type="button" class="xp-sbtn" data-demo-previous aria-disabled="true">${escapeHtml(copy.previous)}</button><button type="button" class="xp-btn xp-btn--sm" data-demo-next data-demo-again="${escapeHtml(copy.again)}">${escapeHtml(copy.next)}</button></div></div>`;
}
