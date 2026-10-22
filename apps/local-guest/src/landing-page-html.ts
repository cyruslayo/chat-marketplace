/**
 * The public landing page at /welcome (landing PRD, issue 01). Server markup only: complete without JavaScript, every beat
 * in its final state. The stage attributes (data-landing-play / -stages / -stage / -only / -field / -message / -caption /
 * -screen) are the contract issue 02's motion script reads; do not rename them.
 *
 * The example conversation (issue 08) is one chat window: the hero's stage contract sits on it, and its app-layer content
 * reuses the guest kit (ticketHtml, resultRowPartsHtml, statusHtml, the `.ui-rail` and `.ui-price-breakdown` classes).
 * The bubbles, criteria chips, composer and window frame are landing-only (shortlet-landing.css). Brand-layer parts (app bar,
 * hero, trust strip) come from landing tokens and LANDING_COPY.
 */
import {
  GUEST_FACT_LABELS,
  GUEST_GLOSSARY,
  GUEST_JOURNEY,
  GUEST_RECEIPTS,
  guestWaitingCopy,
  stayTotalLabel,
} from "../../web-agent/src/guest-content.js";
import { formatNgnKobo } from "../../web-agent/src/discovery-a2ui.js";
import { GUEST_DEMO_COPY } from "../../web-agent/src/guest-content.js";
import {
  formatStayFoot,
  formatTicketDate,
} from "../../web-agent/src/booking-presentation.js";
import { escapeHtml, icon, type IconName } from "../../web/src/ui-kit.js";
import {
  resultRowPartsHtml,
  statusHtml,
  ticketHtml,
  type StayCardParts,
} from "./guest-kit.js";
import {
  LANDING_COPY,
  howHeadingParts,
  splitHeadingAtAccent,
} from "./landing-copy.js";
import { brandMarkSvg } from "./landing-brand.js";
import { MAX_TURN_TEXT_LENGTH } from "./turn-limits.js";
import {
  LANDING_UNITS,
  unitsToRender,
  type LandingUnit,
} from "./landing-units.js";
import {
  LANDING_PHOTOS,
  photoRenders,
  type LandingPhoto,
} from "./landing-photos.js";

export type LandingTheme = "light" | "dark" | "system";

const PHOTO_BASE = "/landing/photos";
/** Call-to-action target: the guest app itself. No message text is carried into it yet (landing direction, decision 3). */
const APP_HREF = "/";

const OLD_IKOYI = {
  title: "Luxury 2-Bedroom Apartment in Old Ikoyi",
  livingPhoto: `${PHOTO_BASE}/ikoyi-living.jpg`,
  bedroomPhoto: `${PHOTO_BASE}/ikoyi-bedroom.jpg`,
  totalKobo: 37_000_000,
  depositKobo: 2_000_000,
};
const LEKKI = {
  title: "Serene 1-Bedroom Suite in Lekki Phase 1",
  livingPhoto: `${PHOTO_BASE}/lekki-living.jpg`,
  depositKobo: 1_000_000,
  totalKobo: 20_000_000,
};
const DUE_KOBO = OLD_IKOYI.totalKobo + OLD_IKOYI.depositKobo;
const NIGHTS = 3;
const GUESTS = 2;
const MESSAGE = "An apartment in Lagos from 10 Sept, 3 nights, 2 of us";
const FIELD_PLACEHOLDER = "Ask about these stays…";
const JOURNEY_STEPS = [
  GUEST_JOURNEY.search,
  GUEST_JOURNEY.stay,
  GUEST_JOURNEY.request,
  GUEST_JOURNEY.offer,
  GUEST_JOURNEY.pay,
  GUEST_JOURNEY.confirmed,
] as const;
const CHECK_IN_ISO = "2026-09-10";
const CHECK_OUT_ISO = "2026-09-13";

function money(kobo: number): string {
  return formatNgnKobo(kobo);
}

// ADR 0008 and owner demo approval: an illustration never acquires a real Unit's photography approval.
function approvedImage(src: string): boolean {
  return (
    Object.values(LANDING_PHOTOS).some(
      (photo) => photo.approved && photo.src === src,
    ) || LANDING_UNITS.some((unit) => unit.approved && unit.photo?.src === src)
  );
}

/** A kit result row linking to the app, with the All-In Stay Total label (ADR-0015) and the deposit line under it. */
function resultRow(
  stay: { title: string; livingPhoto: string; totalKobo: number },
  illustrations: boolean,
): string {
  const parts: StayCardParts = {
    href: APP_HREF,
    title: stay.title,
    where: "",
    facts: [],
    total: money(stay.totalKobo),
    totalLabel: stayTotalLabel(true, NIGHTS),
    ...(illustrations || approvedImage(stay.livingPhoto)
      ? { photoSrc: stay.livingPhoto }
      : {}),
  };
  return resultRowPartsHtml(parts);
}

function depositLine(kobo: number): string {
  return `<p class="ui-money-metadata landing-deposit">+ ${escapeHtml(money(kobo))} ${escapeHtml(GUEST_FACT_LABELS.refundableSecurityDeposit)}</p>`;
}

/** A brand photograph (issue 08 follow-up): an empty alt, fixed size, and no image at all until it is approved or placeholders are on. */
function landingPhotoHtml(
  photo: LandingPhoto,
  className: string,
  placeholders: boolean,
): string {
  if (!photoRenders(photo, placeholders)) return "";
  const loading = photo.lazy ? ' loading="lazy"' : "";
  return `<img class="${className}" src="${escapeHtml(photo.src)}" alt="" width="${photo.width}" height="${photo.height}"${loading} decoding="async">`;
}

function chips(
  items: readonly {
    readonly icon: "pin" | "calendar" | "users";
    readonly text: string;
  }[],
): string {
  return `<div class="landing-chips">${items.map((item) => `<span class="landing-chip">${icon(item.icon)}${escapeHtml(item.text)}</span>`).join("")}</div>`;
}

/** The light/dark switch (issue 04): a form that works without JavaScript. The pressed button is the saved choice; neither is pressed when no choice is saved. */
function themeSwitch(theme: LandingTheme): string {
  // CSS shows only the one button for the theme that is NOT in effect, as a 44px icon, at every width; the name is the same.
  const option = (
    value: "light" | "dark",
    label: string,
    glyph: string,
  ): string =>
    `<button class="landing-theme__option" type="submit" name="theme" value="${value}" aria-label="Switch to ${value} theme" aria-pressed="${theme === value ? "true" : "false"}"><svg class="ui-icon landing-theme__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${glyph}</svg><span class="landing-theme__label">${label}</span></button>`;
  const sun = `<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>`;
  const moon = `<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>`;
  return `<form class="ui-segmented landing-theme" method="post" action="/welcome/theme" role="group" aria-label="Colour theme">${option("light", "Light", sun)}${option("dark", "Dark", moon)}</form>`;
}

/** The app bar (issue 08): brand, three in-page links, the theme icon and one filled action. Static on solid ground. */
function appBar(theme: LandingTheme): string {
  const nav = `<nav class="landing-appbar__nav" aria-label="On this page"><a class="ui-link landing-link" href="#how">${escapeHtml(LANDING_COPY.navHowItWorks)}</a><a class="ui-link landing-link" href="#money">${escapeHtml(LANDING_COPY.navYourMoney)}</a><a class="ui-link landing-link" href="#questions">${escapeHtml(LANDING_COPY.navQuestions)}</a></nav>`;
  // The short label shows below 48rem. The link keeps the full name as its accessible name (aria-label), which contains the visible "Start".
  const action = `<a class="ui-button ui-button--primary ui-button--small landing-appbar__action" href="${APP_HREF}" aria-label="${escapeHtml(LANDING_COPY.appBarAction)}"><span class="landing-appbar__long">${escapeHtml(LANDING_COPY.appBarAction)}</span><span class="landing-appbar__short">${escapeHtml(LANDING_COPY.appBarActionShort)}</span></a>`;
  return `<header class="ui-appbar"><div class="landing-container landing-appbar__row"><a class="ui-appbar__brand" href="/welcome">${brandMarkSvg()}Shortlet</a>${nav}<span class="ui-appbar__grow"></span>${themeSwitch(theme)}${action}</div></header>`;
}

/**
 * The hero's composer (issue 08 AC2, issue 14): a real form with a visible label and a text field named `message`. It POSTs to
 * `/welcome/start`, so what is typed travels only in the request body and never in a URL, history or log. Sub-task C reuses it
 * for the closing composer.
 */
export function composerHtml(id: string): string {
  return `<form class="landing-composer" action="/welcome/start" method="post"><label class="landing-composer__label" for="${escapeHtml(id)}">${escapeHtml(LANDING_COPY.composerLabel)}</label><div class="landing-composer__row"><input class="landing-composer__input" id="${escapeHtml(id)}" name="message" type="text" maxlength="${MAX_TURN_TEXT_LENGTH}" required placeholder="${escapeHtml(LANDING_COPY.composerPlaceholder)}" autocomplete="off"><button class="ui-button ui-button--primary landing-composer__send" type="submit"><span class="landing-composer__text">${escapeHtml(LANDING_COPY.primaryAction)}</span>${icon("arrow-right")}</button></div></form>`;
}

/** Example chips (issue 08 AC8): real buttons. With JavaScript they fill the field; without it they are inert. */
function exampleChipButtons(): string {
  return LANDING_COPY.exampleChips
    .map(
      (chip) =>
        `<button class="landing-suggest" type="button">${escapeHtml(chip.text)}</button>`,
    )
    .join("");
}

function typingDots(): string {
  return `<span class="landing-typing" role="img" aria-label="Concierge is typing"><i></i><i></i><i></i></span>`;
}

function concierge(text: string): string {
  return `<p class="landing-who">Concierge</p><p class="landing-bot">${escapeHtml(text)}</p>`;
}

function rail(current: number): string {
  const items = JOURNEY_STEPS.map((label, index) => {
    const state =
      index < current ? "done" : index === current ? "current" : "upcoming";
    return `<li data-state="${state}">${escapeHtml(label)}</li>`;
  }).join("");
  return `<ol class="ui-rail" aria-hidden="true">${items}</ol>`;
}

interface PhoneInput {
  readonly label: string;
  readonly railCurrent: number;
  readonly body: string;
  readonly composer?: string;
  readonly play: string;
  readonly stages: number;
  readonly screen?: number;
}

function phone(input: PhoneInput): string {
  const screen =
    input.screen === undefined ? "" : ` data-landing-screen="${input.screen}"`;
  return `<div class="landing-phone" role="group" aria-label="${escapeHtml(input.label)}" data-landing-play="${escapeHtml(input.play)}" data-landing-stages="${input.stages}"${screen}><div class="landing-phone__bar"><span class="landing-phone__brand">Shortlet</span></div>${rail(input.railCurrent)}<div class="landing-transcript">${input.body}</div>${input.composer ?? ""}</div>`;
}

/**
 * The example conversation (issue 08 AC3): one chat window that replaces the hero phone and carries the hero stage contract
 * (data-landing-play="hero", stages 1 to 4, and the same field, message and only-element attributes). Its app-layer text
 * keeps the order of the old hero phone; on desktop the results sit in the right pane, on a phone they follow the reply.
 */
function chatWindow(illustrations: boolean): string {
  const body = [
    `<p class="landing-who">Concierge</p>`,
    `<p class="landing-bot">Hello. Tell me the area, your dates and how many guests.</p>`,
    `<p class="landing-me" data-landing-stage="1" data-landing-message>${escapeHtml(MESSAGE)}</p>`,
    `<div data-landing-stage="2">${chips([
      { icon: "pin", text: "Lagos" },
      { icon: "calendar", text: "10–13 Sept" },
      { icon: "users", text: "2 guests" },
    ])}</div>`,
    `<div class="landing-slot"><div data-landing-only="3" hidden><p class="landing-who">Concierge</p><p class="landing-bot">${typingDots()}</p></div><p class="landing-bot" data-landing-stage="4">2 apartments you can book for Thu 10 to Sun 13 Sept. Prices are all-in.</p></div>`,
    `<div class="landing-chat__results" data-landing-stage="4">${resultRow(OLD_IKOYI, illustrations)}${depositLine(OLD_IKOYI.depositKobo)}${resultRow(LEKKI, illustrations)}${depositLine(LEKKI.depositKobo)}</div>`,
  ].join("");
  const composer = `<div class="landing-chat__composer" aria-hidden="true"><span class="landing-chat__field" data-landing-field>${escapeHtml(FIELD_PLACEHOLDER)}</span><span class="landing-chat__send">${icon("arrow-up")}</span></div>`;
  return `<div class="landing-chat" role="group" aria-label="An example booking conversation" data-landing-play="hero" data-landing-stages="4"><div class="landing-chat__bar"><span class="landing-chat__brand">Shortlet</span></div>${rail(1)}<div class="landing-chat__panes">${body}${composer}</div></div>`;
}

/** The hero: a photograph under a solid scrim, the headline, the composer, the example chips and the reassurance line. */
function heroSection(placeholders: boolean, demoNotice: string): string {
  const heading = LANDING_COPY.heroHeading;
  return `<section class="landing-hero" aria-label="Introduction">${landingPhotoHtml(LANDING_PHOTOS.hero, "landing-hero__photo", placeholders)}<div class="landing-container landing-hero__inner"><div class="landing-hero__intro">${demoNotice}<p class="ui-eyebrow">${escapeHtml(LANDING_COPY.heroEyebrow)}</p><h1>${escapeHtml(heading.before)}<em class="landing-hero__accent">${escapeHtml(heading.accent)}</em>${escapeHtml(heading.after)}</h1><p class="landing-lede">${escapeHtml(LANDING_COPY.heroLede)}</p></div><div class="landing-hero__cta">${composerHtml("describe-stay")}<div class="landing-suggest-row" role="group" aria-label="Example stays">${exampleChipButtons()}</div><p class="ui-field__hint">${escapeHtml(LANDING_COPY.reassurance)}</p></div></div></section>`;
}

/** The chat window and its label directly under it. The window overlaps the hero's bottom edge (negative margin, shortlet-landing.css). */
function chatWindowSection(illustrations: boolean): string {
  return `<div class="landing-container landing-chat-wrap">${chatWindow(illustrations)}<p class="ui-field__hint landing-example">${escapeHtml(LANDING_COPY.exampleLabel)}</p></div>`;
}

/** The trust strip (issue 08 AC6 layout): four facts in one ruled row. Process facts only; no ratings or guarantees. */
function trustStrip(): string {
  const glyphs = [
    "check",
    "doc",
    "clock",
    "card",
  ] as const satisfies readonly IconName[];
  const items = LANDING_COPY.trust
    .map(
      (item, index) =>
        `<li class="landing-trust__item">${icon(glyphs[index]!)}<p class="landing-trust__text"><span class="landing-trust__title">${escapeHtml(item.title)}</span><span class="landing-trust__line">${escapeHtml(item.line)}</span></p></li>`,
    )
    .join("");
  return `<section class="landing-trust" aria-label="What you can count on"><div class="landing-container"><ul class="landing-trust__list">${items}</ul></div></section>`;
}

function beatOneScreen(): string {
  return phone({
    label: "Search screen: your message and the criteria it produced",
    railCurrent: 0,
    play: "beat-1",
    stages: 4,
    screen: 1,
    body: [
      `<p class="landing-me" data-landing-stage="1">${escapeHtml(MESSAGE)}</p>`,
      `<div data-landing-stage="2">${chips([
        { icon: "pin", text: "Lagos" },
        { icon: "calendar", text: "10–13 Sept · 3 nights" },
        { icon: "users", text: "2 guests" },
      ])}</div>`,
      `<div class="landing-slot"><div data-landing-only="3" hidden><p class="landing-who">Concierge</p><p class="landing-bot">${typingDots()}</p></div>`,
      `<div data-landing-stage="4">${concierge("Got it: Lagos, Thu 10 to Sun 13 Sept, 2 guests. Searching apartments you can book…")}</div></div>`,
    ].join(""),
  });
}

function beatTwoScreen(illustrations: boolean): string {
  return phone({
    label: "Results screen: apartments you can book with all-in prices",
    railCurrent: 1,
    play: "beat-2",
    stages: 4,
    screen: 2,
    body: [
      `<div class="landing-slot"><div data-landing-only="1" hidden><p class="landing-who">Concierge</p><p class="landing-bot">${typingDots()}</p></div>`,
      `<div data-landing-stage="2">${concierge("I found 2 eligible apartments in Lagos for Thu 10 to Sun 13 Sept, 3 nights, 2 guests. Prices are all-in for your dates.")}</div></div>`,
      `<div data-landing-stage="3">${resultRow(OLD_IKOYI, illustrations)}${depositLine(OLD_IKOYI.depositKobo)}</div>`,
      `<div data-landing-stage="4">${resultRow(LEKKI, illustrations)}${depositLine(LEKKI.depositKobo)}</div>`,
    ].join(""),
  });
}

function beatThreeScreen(illustrations: boolean): string {
  return phone({
    label: "Stay summary before sending the request",
    railCurrent: 2,
    play: "beat-3",
    stages: 4,
    screen: 3,
    body: [
      `<p class="landing-marker" data-landing-stage="1">${escapeHtml(GUEST_RECEIPTS.draftCreated)}</p>`,
      `<div data-landing-stage="2"><div class="landing-photos">${illustrations || approvedImage(OLD_IKOYI.livingPhoto) ? `<img src="${OLD_IKOYI.livingPhoto}" alt="Old Ikoyi apartment living room" width="800" height="600" loading="lazy" decoding="async">` : ""}${illustrations || approvedImage(OLD_IKOYI.bedroomPhoto) ? `<img src="${OLD_IKOYI.bedroomPhoto}" alt="Old Ikoyi apartment bedroom" width="800" height="600" loading="lazy" decoding="async">` : ""}</div>${ticketHtml(
        {
          title: OLD_IKOYI.title,
          checkIn: {
            day: CHECK_IN_ISO.slice(8, 10),
            date: formatTicketDate(CHECK_IN_ISO),
            datetime: CHECK_IN_ISO,
          },
          checkOut: {
            day: CHECK_OUT_ISO.slice(8, 10),
            date: formatTicketDate(CHECK_OUT_ISO),
            datetime: CHECK_OUT_ISO,
          },
          foot: `${formatStayFoot(NIGHTS, GUESTS)} · ${money(OLD_IKOYI.totalKobo)} ${GUEST_GLOSSARY.allInStayTotal}`,
        },
      )}</div>`,
      `<div data-landing-stage="3" class="landing-send">${statusHtml("neutral", GUEST_GLOSSARY.requestDraftStatus)}<span class="ui-button ui-button--primary ui-button--block landing-send__button" aria-hidden="true">Send Booking Request</span></div>`,
      `<p class="ui-field__hint" data-landing-stage="4">${escapeHtml(GUEST_GLOSSARY.revalidation)}</p>`,
    ].join(""),
  });
}

function beatFourScreen(): string {
  // ADR-0077: the waiting copy is the app's own wording, not a second literal.
  const waiting = guestWaitingCopy("operator-response", undefined);
  return phone({
    label: "Waiting for the Operator to confirm",
    railCurrent: 2,
    play: "beat-4",
    stages: 4,
    screen: 4,
    body: [
      `<p class="landing-marker" data-landing-stage="1">${escapeHtml(GUEST_RECEIPTS.requestSent)}</p>`,
      `<div data-landing-stage="2"><p class="landing-who">Concierge</p><div class="landing-bot landing-waiting"><b>${escapeHtml(waiting.heading)}</b>${waiting.outcomes
        .slice(0, 2)
        .map((line) => `<span>${escapeHtml(line)}</span>`)
        .join(
          "",
        )}<span>${escapeHtml(waiting.meanwhile.at(-1) ?? "")}</span></div></div>`,
      `<div class="landing-slot"><p class="landing-marker" data-landing-only="3" hidden>${typingDots()} The Operator is reviewing</p>`,
      `<div class="ui-banner ui-banner--warning" data-landing-stage="4">${icon("clock")}<span><b class="landing-banner__title">Reply due by <time datetime="2026-09-03T10:45:00+01:00">10:45 am WAT, 3 Sept 2026</time></b> Your dates are held while the Operator replies, within 30 minutes during their active hours.</span></div></div>`,
    ].join(""),
  });
}

function beatFiveScreen(illustrations: boolean): string {
  return phone({
    label: "Offer, payment and confirmed Reservation",
    railCurrent: 5,
    play: "beat-5",
    stages: 6,
    screen: 5,
    body: [
      `<div data-landing-stage="1">${concierge(`${GUEST_GLOSSARY.offerReadyHeading}.`)}</div>`,
      `<section class="ui-panel ui-price-breakdown landing-breakdown" aria-label="Price breakdown" data-landing-stage="2"><p class="ui-price-breakdown__label">${escapeHtml(GUEST_FACT_LABELS.allInStayTotal)}</p><p class="ui-money-total">${escapeHtml(money(OLD_IKOYI.totalKobo))}</p><p class="ui-price-breakdown__row" data-landing-stage="3">${escapeHtml(GUEST_FACT_LABELS.refundableSecurityDeposit)}: <span class="ui-price-breakdown__value">${escapeHtml(money(OLD_IKOYI.depositKobo))}</span></p><p class="ui-price-breakdown__due" data-landing-stage="4">${escapeHtml(GUEST_FACT_LABELS.amountDueNow)}: <span class="ui-price-breakdown__value">${escapeHtml(money(DUE_KOBO))}</span></p></section>`,
      `<div data-landing-stage="5">${statusHtml("success", GUEST_RECEIPTS.paymentVerified)}</div>`,
      `<p class="ui-banner ui-banner--success" data-landing-stage="6">${icon("check")}<span><b class="landing-banner__title">Reservation confirmed</b> Old Ikoyi · Thu 10 to Sun 13 Sept</span>${illustrations || approvedImage(OLD_IKOYI.bedroomPhoto) ? `<img class="landing-banner__photo" src="${OLD_IKOYI.bedroomPhoto}" alt="" width="800" height="600" loading="lazy" decoding="async">` : ""}</p>`,
    ].join(""),
  });
}

/**
 * One step of How it works (issue 08 sub-task B): eyebrow, H3, body, then the approved pain line as plain text. No status tag
 * (those are in the money timeline) and no strike-through or icon on the pain line.
 */
function caption(
  index: number,
  eyebrow: string,
  pain: string,
  heading: string,
  text: string,
  cta = "",
): string {
  return `<div class="landing-caption" data-landing-caption="${index}"><p class="ui-eyebrow">${escapeHtml(eyebrow)}</p><h3>${escapeHtml(heading)}</h3><p class="landing-caption__body">${escapeHtml(text)}</p><p class="landing-pain">Instead of ${escapeHtml(pain)}</p>${cta}</div>`;
}

/** One step as a list item: its caption, then the beat screen it describes (the stage contract is unchanged). */
function beat(index: number, captionHtml: string, screenHtml: string): string {
  return `<li class="landing-beat" data-beat="${index}"><div class="landing-beat__caption">${captionHtml}</div><div class="landing-beat__screen">${screenHtml}</div></li>`;
}

/** The money timeline (issue 08 AC5): a deep band with three cards; the status tags are text, one per card. */
function moneySection(): string {
  const heading = LANDING_COPY.moneyHeading;
  const cards = LANDING_COPY.moneyCards
    .map(
      (card) =>
        `<li class="landing-timeline__card landing-timeline__card--${card.tone}"><p class="landing-timeline__numeral" aria-hidden="true">${escapeHtml(card.number)}</p><h3>${escapeHtml(card.title)}</h3><p class="landing-timeline__body">${escapeHtml(card.body)}</p>${statusHtml(card.tone, card.status)}</li>`,
    )
    .join("");
  return `<section id="money" class="landing-timeline" aria-labelledby="money-h"><div class="landing-container landing-timeline__inner"><div class="landing-timeline__intro"><p class="ui-eyebrow">${escapeHtml(LANDING_COPY.navYourMoney)}</p><h2 id="money-h">${escapeHtml(heading.before)}<em class="landing-timeline__accent">${escapeHtml(heading.accent)}</em></h2></div><ol class="landing-timeline__cards">${cards}</ol></div></section>`;
}

/** The How it works H2: the second sentence is the italic accent (the copy text is unchanged). */
function howHeadingMarkup(): string {
  const parts = howHeadingParts();
  return `${escapeHtml(parts.before)}${parts.accent === "" ? "" : ` <em class="landing-section__accent">${escapeHtml(parts.accent)}</em>`}`;
}

/** Options for the whole page. Both are off by default, so the public page shows no placeholder and no unconfigured link. */
export interface LandingRenderOptions {
  /** Owner-approved live demonstration: labelled illustrations, never bookable inventory. */
  readonly demo?: boolean;
  /** true on local builds only: the bracketed FAQ answers and the unapproved apartments show (Issue 08 AC6). */
  readonly placeholders?: boolean;
  /** Support, privacy and terms URLs. The footer's Help column is omitted unless at least one is set. */
  readonly helpLinks?: LandingHelpLinks;
}

export interface LandingHelpLinks {
  readonly support?: string;
  readonly privacy?: string;
  readonly terms?: string;
}

/** A help link is an https URL or a path on this site; anything else never reaches an href on a public page. */
function helpHref(url: string): string {
  if (!/^(https:\/\/|\/(?!\/))/.test(url))
    throw new TypeError(
      `a help link must be an https URL or a site path: ${url}`,
    );
  return escapeHtml(url);
}

/** One apartment card (direction doc row 5): the area and bedrooms, then the city. Only a real photo links to the app. */
function apartmentCard(unit: LandingUnit): string {
  const area = `${unit.area} · ${unit.bedrooms}`;
  if (unit.photo === null) {
    return `<li class="landing-unit landing-unit--placeholder"><div class="landing-unit__link"><div class="landing-unit__photo landing-unit__photo--placeholder" role="img" aria-label="Photo placeholder for a ${escapeHtml(unit.city)} apartment">${escapeHtml(unit.placeholderLabel ?? "")}</div><span class="landing-unit__area">${escapeHtml(area)}</span><span class="landing-unit__city">${escapeHtml(unit.city)}</span></div></li>`;
  }
  const photo = unit.photo;
  return `<li class="landing-unit"><a class="landing-unit__link" href="${APP_HREF}"><img class="landing-unit__photo" src="${escapeHtml(photo.src)}" alt="${escapeHtml(photo.alt)}" width="${photo.width}" height="${photo.height}" loading="lazy" decoding="async"><span class="landing-unit__area">${escapeHtml(area)}</span><span class="landing-unit__city">${escapeHtml(unit.city)}</span></a></li>`;
}

/** Apartments (issue 08 sub-task C, row 5). Omitted entirely when no entry is approved and placeholders are off. */
function apartmentsSection(placeholders: boolean, demo: boolean): string {
  const units = unitsToRender(LANDING_UNITS, placeholders || demo).filter(
    (unit) => !demo || placeholders || unit.photo !== null,
  );
  if (units.length === 0) return "";
  const heading = LANDING_COPY.apartmentsHeading;
  return `<section id="apartments" class="landing-section landing-apartments" aria-labelledby="apartments-h"><div class="landing-section__intro"><h2 id="apartments-h">${escapeHtml(heading.before)}<em class="landing-section__accent">${escapeHtml(heading.accent)}</em></h2><p>${escapeHtml(LANDING_COPY.apartmentsLine)}</p></div><ul class="landing-units">${units.map(apartmentCard).join("")}</ul></section>`;
}

/** Questions (row 8): native details, the first one open. A placeholder answer renders only with placeholders on. */
function questionsSection(placeholders: boolean): string {
  const heading = splitHeadingAtAccent(
    LANDING_COPY.faqHeading,
    "answered plainly",
  );
  const items = LANDING_COPY.faq
    .filter((item) => placeholders || item.placeholder !== true)
    .map(
      (item, index) =>
        `<details class="landing-faq__item"${index === 0 ? " open" : ""}><summary>${escapeHtml(item.question)}</summary><p>${escapeHtml(item.answer)}</p></details>`,
    )
    .join("");
  return `<section id="questions" class="landing-section landing-questions" aria-labelledby="questions-h"><div class="landing-section__intro"><h2 id="questions-h">${escapeHtml(heading.before)}<em class="landing-section__accent">${escapeHtml(heading.accent)}</em></h2></div><div class="landing-faq">${items}</div></section>`;
}

/** Closing (row 9): a photograph under the solid scrim, the H2, the closing composer and the reassurance line. */
function closingSection(placeholders: boolean): string {
  const heading = splitHeadingAtAccent(
    LANDING_COPY.closingHeading,
    "not the form.",
  );
  return `<section class="landing-closing" aria-labelledby="end-h">${landingPhotoHtml(LANDING_PHOTOS.closing, "landing-closing__photo", placeholders)}<div class="landing-container landing-closing__inner"><h2 id="end-h">${escapeHtml(heading.before)}<em class="landing-closing__accent">${escapeHtml(heading.accent)}</em></h2>${composerHtml("describe-trip")}<p class="ui-field__hint">${escapeHtml(LANDING_COPY.reassurance)}</p></div></section>`;
}

/** The Help column: only the links that are configured. Empty when none is. */
function helpColumn(links: LandingHelpLinks): string {
  const entries: [string, string][] = [];
  if (links.support !== undefined)
    entries.push([LANDING_COPY.helpSupport, links.support]);
  if (links.privacy !== undefined)
    entries.push([LANDING_COPY.helpPrivacy, links.privacy]);
  if (links.terms !== undefined)
    entries.push([LANDING_COPY.helpTerms, links.terms]);
  if (entries.length === 0) return "";
  const items = entries
    .map(
      ([label, url]) =>
        `<li><a class="landing-link" href="${helpHref(url)}">${escapeHtml(label)}</a></li>`,
    )
    .join("");
  return `<div><p class="landing-footer__heading">${escapeHtml(LANDING_COPY.footerHelp)}</p><ul class="landing-footer__list">${items}</ul></div>`;
}

/** Footer (row 10): the mark, the approved eyebrow line, three columns and the copyright line. Deep green, theme-independent. */
function footerSection(helpLinks: LandingHelpLinks): string {
  const anchors = [
    [LANDING_COPY.navHowItWorks, "#how"],
    [LANDING_COPY.navYourMoney, "#money"],
    [LANDING_COPY.navQuestions, "#questions"],
  ] as const;
  const links = anchors
    .map(
      ([label, href]) =>
        `<li><a class="landing-link" href="${href}">${escapeHtml(label)}</a></li>`,
    )
    .join("");
  return `<footer class="landing-footer"><div class="landing-container landing-footer__inner"><div class="landing-footer__brand"><span class="ui-appbar__brand">${brandMarkSvg()}Shortlet</span><p class="landing-footer__line">${escapeHtml(LANDING_COPY.heroEyebrow)}</p></div><div class="landing-footer__columns"><div><p class="landing-footer__heading">${escapeHtml(LANDING_COPY.footerCities)}</p><p class="landing-footer__text">Lagos</p><p class="landing-footer__text">Abuja</p></div><nav aria-label="${escapeHtml(LANDING_COPY.footerShortlet)}"><p class="landing-footer__heading">${escapeHtml(LANDING_COPY.footerShortlet)}</p><ul class="landing-footer__list">${links}</ul></nav>${helpColumn(helpLinks)}</div><p class="landing-footer__copy">${escapeHtml(LANDING_COPY.footerCopyright)}</p></div></footer>`;
}

/** The whole landing document. Pure: no session, no clock, no request data. */
export function renderLandingHtml(
  theme: LandingTheme = "system",
  options: LandingRenderOptions = {},
): string {
  const placeholders = options.placeholders === true;
  const demo = options.demo === true;
  const illustrations = placeholders || demo;
  // ADR 0078: keep the disclosure inside the hero's padded content, below the sticky app bar.
  const demoNotice = demo
    ? `<p class="ui-banner ui-banner--neutral" data-landing-demo>${escapeHtml(LANDING_COPY.demoNotice)} ${escapeHtml(GUEST_DEMO_COPY.testPayments)}</p>`
    : "";
  const beatCaptions = [
    caption(
      1,
      "1 · Search",
      LANDING_COPY.pain[0]!,
      LANDING_COPY.headings[0]!,
      LANDING_COPY.bodies[0]!,
    ),
    caption(
      2,
      "2 · Stay",
      LANDING_COPY.pain[1]!,
      LANDING_COPY.headings[1]!,
      LANDING_COPY.bodies[1]!,
    ),
    caption(
      3,
      "3 · Request",
      LANDING_COPY.pain[2]!,
      LANDING_COPY.headings[2]!,
      LANDING_COPY.bodies[2]!,
    ),
    caption(
      4,
      "4 · Confirmation",
      LANDING_COPY.pain[3]!,
      LANDING_COPY.headings[3]!,
      LANDING_COPY.bodies[3]!,
    ),
    caption(
      5,
      "5 · Pay and confirmed",
      LANDING_COPY.pain[4]!,
      LANDING_COPY.headings[4]!,
      LANDING_COPY.bodies[4]!,
      `<a class="ui-button ui-button--primary ui-button--block landing-cta" href="${APP_HREF}">${escapeHtml(LANDING_COPY.primaryAction)}</a>`,
    ),
  ];

  // The progress line is drawn by CSS on the step list; the screens sit beside their steps (desktop) or below them (phones).
  const how = `<section id="how" class="landing-section" aria-labelledby="how-h"><div class="landing-section__intro"><p class="ui-eyebrow">${escapeHtml(LANDING_COPY.howEyebrow)}</p><h2 id="how-h">${howHeadingMarkup()}</h2><p class="ui-field__hint landing-example">${escapeHtml(LANDING_COPY.exampleLabel)}</p></div><div class="landing-beats"><ol class="landing-steps">${[
    beat(1, beatCaptions[0]!, beatOneScreen()),
    beat(2, beatCaptions[1]!, beatTwoScreen(illustrations)),
    beat(3, beatCaptions[2]!, beatThreeScreen(illustrations)),
    beat(4, beatCaptions[3]!, beatFourScreen()),
    beat(5, beatCaptions[4]!, beatFiveScreen(illustrations)),
  ].join("")}</ol></div></section>`;

  return `<!doctype html><html lang="en-NG" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="preload" as="font" type="font/woff2" crossorigin href="/landing/fonts/newsreader-500.woff2"><title>${escapeHtml(LANDING_COPY.pageTitle)}</title><link rel="stylesheet" href="/shortlet-foundations.css"><link rel="stylesheet" href="/shortlet-landing.css"><script src="/landing.js" defer></script></head><body><a class="landing-skip" href="#main">Skip to main content</a>${appBar(theme)}<main id="main">${heroSection(illustrations, demoNotice)}${chatWindowSection(illustrations)}${trustStrip()}${apartmentsSection(placeholders, demo)}${how}${moneySection()}${questionsSection(placeholders)}${closingSection(illustrations)}</main>${footerSection(options.helpLinks ?? {})}</body></html>`;
}
