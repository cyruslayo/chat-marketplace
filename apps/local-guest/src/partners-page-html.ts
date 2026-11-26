/**
 * The founding partners page at /partners (landing issue 17), in the Xenia design system: server markup only, complete without
 * JavaScript. Styles: xenia-partners.css. Copy: partners-copy.ts. The demo stage: partners-demo-html.ts.
 */
import { escapeHtml } from "../../web/src/ui-kit.js";
import {
  EMPTY_PARTNER_INPUT,
  PARTNER_AREAS,
  PARTNER_CONSENT_TEXT,
  PARTNER_TEXT_MAX,
  PARTNER_UNIT_RANGES,
  firstWrongField,
  partnerErrorLine,
  type PartnerApplicationErrors,
  type PartnerApplicationInput,
  type PartnerField,
} from "./partner-application.js";
import { demoStageHtml } from "./partners-demo-html.js";
import {
  DOOR_ILLUSTRATION,
  EVENING_ILLUSTRATION,
  MORNING_ILLUSTRATION,
} from "./partners-illustrations.js";
import { PARTNERS_COPY, type PartnersFaqItem } from "./partners-copy.js";
import type { LandingTheme } from "./landing-theme.js";

/** What the application card shows. `closed` renders no field at all, so nothing can be typed that would not be kept. */
export type PartnerFormState =
  | { readonly kind: "closed" }
  | { readonly kind: "sent" }
  | {
      readonly kind: "open";
      readonly privacyNoticeUrl: string;
      /** A fresh value per rendered form; see PartnerApplicationSubmission.submissionKey. */
      readonly formKey: string;
      readonly input?: PartnerApplicationInput;
      readonly errors?: PartnerApplicationErrors;
      /** True when a valid application could not be saved. */
      readonly unavailable?: boolean;
    };

export interface PartnersRenderOptions {
  readonly theme?: LandingTheme;
  readonly form: PartnerFormState;
}

const e = escapeHtml;
const C = PARTNERS_COPY;

const ICON = {
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  tick: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>',
  done: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>',
  money:
    '<rect x="3" y="6.5" width="18" height="11" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6.5 9.5v.01M17.5 14.5v.01"/>',
  ready:
    '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4M9 14.5l2 2 4-4"/>',
  questions: '<path d="M20 15.5H9.5L5 19v-3.5H4V5h16z"/><path d="M8 9h8M8 12h5"/>',
  decision:
    '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
  lengths:
    '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4M7.5 15h9M14 12.5l2.5 2.5-2.5 2.5"/>',
  card: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/>',
  home: '<path d="M3 11l9-7 9 7M5 10v10h14V10"/>',
  requests: '<path d="M4 5h16v11H9l-5 4z"/>',
  bookings:
    '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M8 12.5l3 3 5-6"/>',
  toggle: '<path d="M5 12h14"/><path class="xp-faq__bar" d="M12 5v14"/>',
} as const;

function icon(name: keyof typeof ICON, size: "sm" | "md" | "lg" | ""): string {
  return `<svg class="xp-ic${size === "" ? "" : ` xp-ic--${size}`}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICON[name]}</svg>`;
}

/** Keeps clock times and "30 minutes"-style pairs on one line, as the design does. */
function keepTimes(text: string): string {
  return e(text).replace(
    /\d{1,2}:\d{2} [AP]M(?: WAT\b\.?)?/g,
    (time) => `<span class="xp-nowrap">${time}</span>`,
  );
}

function paragraphs(items: readonly string[]): string {
  return items.map((text) => `<p>${e(text)}</p>`).join("");
}

function eyebrow(text: string): string {
  return `<span class="xp-eyebrow">${e(text)}</span>`;
}

function accent(text: string): string {
  return `<span class="xp-it">${e(text)}</span>`;
}

function header(): string {
  const link = (href: string, text: string): string =>
    `<li><a href="${href}" class="xp-link">${e(text)}</a></li>`;
  return `<header class="xp-header"><div class="xp-wrap xp-header__row"><a href="/partners" class="xp-disp xp-header__brand">${e(C.brand)}</a><nav class="xp-header__nav" aria-label="${e(C.nav.label)}"><ul>${link("#how", C.nav.how)}${link("#payment", C.nav.payment)}${link("#questions", C.nav.questions)}</ul></nav><a href="#apply" class="xp-btn xp-btn--sm"><span class="xp-long">${e(C.apply)}</span><span class="xp-short">${e(C.applyShort)}</span></a></div></header>`;
}

function hero(): string {
  const copy = C.hero;
  return `<section class="xp-hero" aria-labelledby="hero-title"><figure class="xp-hero__figure xp-figure">${EVENING_ILLUSTRATION}<figcaption class="xp-meta">${e(C.illustration)}</figcaption></figure><div class="xp-hero__text">${eyebrow(copy.eyebrow)}<h1 id="hero-title" class="xp-disp xp-h1">${e(copy.headingBefore)}<span class="xp-it xp-nowrap">${e(copy.headingAccent)}</span></h1><p class="xp-lede">${e(copy.lede)}</p><a href="#apply" class="xp-btn">${e(C.apply)}</a><p class="xp-soft">${e(copy.note)}</p></div></section>`;
}

function problem(): string {
  const copy = C.problem;
  const messages = copy.messages
    .map((text) => `<p class="xp-messages__bubble">${e(text)}</p>`)
    .join("");
  return `<section id="problem" aria-labelledby="problem-title" class="xp-sec xp-sec--rule"><div class="xp-wrap xp-split"><div class="xp-problem__text xp-stack">${eyebrow(copy.eyebrow)}<h2 id="problem-title" class="xp-disp xp-h2 xp-h2--16">${e(copy.heading)}</h2><div class="xp-measure xp-soft xp-stack xp-stack--16 xp-large">${paragraphs(copy.paragraphs)}</div></div><figure class="xp-messages" aria-label="${e(copy.figureLabel)}"><figcaption class="xp-tag">${e(copy.figureTag)}</figcaption>${messages}<p class="xp-meta">${e(copy.figureFoot)}</p></figure></div></section>`;
}

function guest(): string {
  const copy = C.guest;
  return `<section id="guest" aria-labelledby="guest-title" class="xp-sec xp-sec--rule"><div class="xp-wrap xp-stack xp-stack--stage"><div class="xp-stack">${eyebrow(copy.eyebrow)}<h2 id="guest-title" class="xp-disp xp-h2 xp-h2--16">${e(copy.heading)}</h2><p class="xp-lede xp-measure">${e(copy.lede)}</p></div>${demoStageHtml()}</div></section>`;
}

/** A picture of the planned partner app: nothing in it is a control, so its "buttons" are spans. */
function requestCard(): string {
  const facts = [
    ["Apartment", "2-bedroom, Wuse"],
    ["Dates", "Thu 3 Dec to Sat 2 Jan"],
    ["Stay", "30 nights, 1 guest"],
    ["You receive", "Your agreed amount for these 30 nights"],
  ]
    .map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`)
    .join("");
  return `<div class="xp-app xp-rq"><div class="xp-rq__head"><p><span class="xp-app__brand">${e(C.partnerBrand)}</span><span class="xp-h3">Booking request</span></p><span class="xp-app__cap">Delivered 11:12 AM WAT</span></div><div class="xp-rq__body"><div class="xp-rq__due"><p class="xp-app__st xp-app__st--warning">${icon("clock", "sm")}Answer by 11:42 AM WAT</p><p class="xp-soft">18 minutes left. Waiting for your yes or no. Dates held.</p></div><dl class="xp-rq__facts">${facts}</dl><div class="xp-rq__answer"><span class="xp-app__btn">Accept request</span><p class="xp-rq__label">Or decline, with a reason</p><span class="xp-app__radio"><i></i>Dates not available</span><span class="xp-app__radio"><i></i>Other reason</span><p class="xp-app__cap xp-app__cap--soft">The guest never sees the reason.</p><span class="xp-app__btn xp-app__btn--quiet">Decline request</span></div></div></div>`;
}

function how(): string {
  const copy = C.how;
  return `<section id="how" aria-labelledby="how-title" class="xp-sec--lg xp-sec--surface xp-sec--block"><div class="xp-wrap xp-stack xp-stack--sections"><div class="xp-stack">${eyebrow(copy.eyebrow)}<h2 id="how-title" class="xp-disp xp-h2 xp-h2--18">${e(copy.headingBefore)}${accent(copy.headingAccent)}</h2><p class="xp-measure xp-soft xp-large">${e(copy.line)}</p></div><div class="xp-how"><div class="xp-how__requests"><h3 class="xp-eyebrow">${e(copy.requestsHeading)}</h3><div class="xp-thirty__box"><div class="xp-thirty"><p class="xp-disp xp-thirty__n" aria-hidden="true">${copy.minutes}</p><p class="xp-thirty__text"><span class="xp-sr">${copy.minutes} </span>${e(copy.minutesText)}</p></div><p class="xp-soft xp-large">${e(copy.held)}</p></div><ul class="xp-rules"><li>${icon("clock", "md")}<p>${keepTimes("Requests reach you between 8:00 AM and 7:30 PM WAT.")}</p></li><li>${icon("tick", "md")}<p>${e(copy.nothingBooked)}</p></li></ul></div><figure id="request" class="xp-request" aria-label="${e(copy.requestLabel)}"><span class="xp-tag xp-tag--soft">${e(copy.requestTag)}</span><span class="xp-tag">${e(C.plannedApp)}</span>${requestCard()}<p class="xp-soft">${e(copy.atLaunch)}</p></figure></div></div></section>`;
}

function benefits(): string {
  const copy = C.benefits;
  const items = copy.items
    .map(
      (item, index) =>
        `<div class="xp-benefit${index >= 3 ? " xp-benefit--wide" : ""}">${icon(item.icon as keyof typeof ICON, "md")}<h3 class="xp-h3 xp-h3--semi">${e(item.heading)}</h3><p class="xp-soft">${e(item.body)}</p></div>`,
    )
    .join("");
  return `<section id="benefits" aria-labelledby="benefits-title" class="xp-sec"><div class="xp-wrap xp-benefits"><div class="xp-benefits__head xp-stack">${eyebrow(copy.eyebrow)}<h2 id="benefits-title" class="xp-disp xp-h2 xp-h2--12">${e(copy.heading)}</h2></div><div class="xp-benefits__lead">${icon("money", "lg")}<h3 class="xp-disp">${e(copy.lead.heading)}</h3><p class="xp-lede">${e(copy.lead.body)}</p></div>${items}</div></section>`;
}

function naira(amount: string): string {
  return `<span class="xp-money xp-money--inline">${e(amount)}</span>`;
}

/** The partner home picture. Rows marked `full` are left out on phones, where a one-line summary stands in, as in the design. */
function partnerHome(): string {
  const row = (
    full: boolean,
    cap: string,
    title: string,
    line: string,
    when: string,
    button: string,
    quiet: boolean,
  ): string =>
    `<div class="xp-dash__row${full ? " xp-dash__row--full" : ""}"><div class="xp-dash__what"><span class="xp-app__cap xp-app__cap--soft">${e(cap)}</span><b>${title}</b><span class="xp-soft">${e(line)}</span></div><div class="xp-dash__when">${when}</div><span class="xp-app__btn${quiet ? " xp-app__btn--quiet" : ""}">${e(button)}</span></div>`;
  const status = (
    mark: "clock" | "info",
    text: string,
    warning: boolean,
  ): string =>
    `<span class="xp-app__st${warning ? " xp-dash__due" : ""}">${icon(mark, "sm")}${e(text)}</span>`;
  const short = (mark: "clock" | "info", content: string): string =>
    `<p class="xp-dash__short">${icon(mark, "sm")}<span>${content}</span></p>`;
  const group = (heading: string, count: string, content: string): string =>
    `<div class="xp-dash__group"><h3>${e(heading)} <span>${e(count)}</span></h3>${content}</div>`;
  return `<div class="xp-app xp-dash"><div class="xp-dash__nav"><p class="xp-dash__brand"><span class="xp-app__brand">${e(C.partnerBrand)}</span></p><span class="xp-dash__item xp-dash__item--on">${icon("home", "sm")}Home<span class="xp-dash__badge">1</span></span><span class="xp-dash__item">${icon("requests", "sm")}Requests</span><span class="xp-dash__item">${icon("bookings", "sm")}Bookings</span><p class="xp-app__cap xp-dash__who">Signed in for Example Apartments Ltd · 3 apartments in Abuja</p></div><div class="xp-dash__main"><div class="xp-stack xp-stack--8">${eyebrow("Thursday 26 November · 11:24 AM WAT")}<p class="xp-disp xp-dash__title">Waiting on you</p><p class="xp-soft xp-dash__intro">Sorted by the earliest deadline. Requests come first because they have 30 minutes.</p></div>${group("Requests to answer", "1 open", row(false, "Booking request · Delivered 11:12 AM WAT", "2-bedroom, Aminu Kano Crescent, Wuse · 3 Dec to 2 Jan", "30 nights · 1 guest · your agreed amount", `${status("clock", "Answer by 11:42 AM WAT", true)}<span class="xp-app__cap xp-app__cap--soft">18 minutes left · dates held</span>`, "Answer", false))}${group("Check-ins today", "1", row(true, "Booking 0405 · paid", "1-bedroom, Gana Street, Maitama · arriving from 2:00 PM WAT", "We confirm when the guest gets in", status("info", "Not yet in", false), "View booking", true) + short("info", "1 check-in today · not yet in"))}${group("Payments to you", "1 due today", row(true, "Booking 0398 · Studio, Jabi", `Your agreed ${naira("₦210,000")}`, "24 hours after the guest got in, by bank transfer", status("clock", "Due 3:10 PM WAT today", false), "View payment", true) + short("clock", `1 payment due today · ${naira("₦210,000")} at 3:10 PM WAT`))}<p class="xp-app__cap xp-dash__foot">Example data. Nothing here is a rating, a volume or a trend: only what needs an answer and when.</p></div></div>`;
}

function side(): string {
  const copy = C.side;
  return `<section id="your-side" aria-labelledby="side-title" class="xp-sec xp-sec--surface"><div class="xp-wrap xp-stack xp-stack--stage"><div class="xp-stack">${eyebrow(copy.eyebrow)}<h2 id="side-title" class="xp-disp xp-h2 xp-h2--16">${e(copy.heading)}</h2></div><figure class="xp-figure--full" aria-label="${e(copy.figureLabel)}"><figcaption class="xp-tag">${e(C.plannedApp)}</figcaption>${partnerHome()}</figure></div></section>`;
}

function payment(): string {
  const copy = C.payment;
  const row = (
    title: string,
    amount: string,
    note: string,
    status: string,
    mark: "clock" | "info" | "done",
  ): string =>
    `<div class="xp-pay__row"><b>${e(title)}</b><span class="xp-money">${e(amount)}</span><span class="xp-app__cap xp-app__cap--soft">${e(note)}</span><span class="xp-app__st${mark === "done" ? " xp-app__st--success" : ""}">${icon(mark, "sm")}${e(status)}</span></div>`;
  const rows = [
    row(
      "Studio, Jabi",
      "₦210,000",
      "Booking 0398 · guest got in Wed 25 Nov, 3:10 PM WAT",
      "Due Thu 26 Nov, 3:10 PM WAT",
      "clock",
    ),
    row(
      "1-bedroom, Gana Street, Maitama",
      "₦150,000",
      "Booking 0405 · arriving Thu 26 Nov from 2:00 PM WAT",
      "Due 24 hours after check-in",
      "info",
    ),
    row(
      "3-bedroom, Ontario Crescent, Asokoro",
      "₦540,000",
      "Booking 0371 · paid by bank transfer Mon 23 Nov, 10:05 AM WAT",
      "Paid",
      "done",
    ),
  ].join("");
  return `<section id="payment" aria-label="${e(copy.label)}" class="xp-band xp-sec--lg"><div class="xp-wrap"><div class="xp-pay">${eyebrow(copy.eyebrow)}<h2 class="xp-disp xp-pay__line">Your agreed amount, <span class="xp-it"><span class="xp-nowrap">24 hours</span> after <span class="xp-nowrap">check-in</span></span></h2><p class="xp-pay__text">${e(copy.body)}</p></div><figure class="xp-pay__figure" aria-label="${e(copy.figureLabel)}"><figcaption class="xp-tag">${e(C.plannedApp)}</figcaption><div class="xp-app xp-pay__card"><div class="xp-pay__head"><p class="xp-disp xp-pay__title">Payments to you</p><span class="xp-app__cap">Agreed amounts only · Example Apartments Ltd</span></div>${rows}</div></figure><p class="xp-disp xp-pay__close">${e(copy.close)}</p></div></section>`;
}

function founding(): string {
  const copy = C.founding;
  const items = copy.items
    .map(
      (item) =>
        `<li><p class="xp-strong">${e(item.heading)}</p><p class="xp-soft">${e(item.body)}</p></li>`,
    )
    .join("");
  return `<section id="founding" aria-labelledby="founding-title" class="xp-sec"><div class="xp-wrap xp-split xp-split--48"><div class="xp-founding__text xp-stack">${eyebrow(copy.eyebrow)}<h2 id="founding-title" class="xp-disp xp-h2">${e(copy.headingBefore)}${accent(copy.headingAccent)}${e(copy.headingAfter)}</h2><div class="xp-soft xp-stack xp-stack--16 xp-large">${paragraphs(copy.paragraphs)}</div></div><div class="xp-founding__box"><h3 class="xp-h3">${e(copy.listHeading)}</h3><ul class="xp-founding__list">${items}</ul><div class="xp-founding__cta"><h3 class="xp-disp xp-h2--small">${e(copy.ctaHeading)}</h3><a href="#apply" class="xp-btn">${e(C.apply)}</a><p class="xp-soft">${e(C.applyLede)}</p></div></div></div></section>`;
}

function faqItem(item: PartnersFaqItem): string {
  const [first, ...rest] = item.paragraphs;
  const list =
    item.list === undefined
      ? ""
      : `<ul>${item.list.map((text) => `<li>${e(text)}</li>`).join("")}</ul>`;
  return `<details${item.open === true ? " open" : ""}><summary>${e(item.question)}${icon("toggle", "sm")}</summary><div class="xp-faq__answer"><p>${e(first!)}</p>${list}${paragraphs(rest)}</div></details>`;
}

function questions(): string {
  const copy = C.questions;
  return `<section id="questions" aria-labelledby="questions-title" class="xp-sec xp-sec--subtle"><div class="xp-wrap xp-split xp-split--40"><div class="xp-faq__head xp-stack">${eyebrow(copy.eyebrow)}<h2 id="questions-title" class="xp-disp xp-h2">${e(copy.heading)}</h2></div><div class="xp-faq">${copy.items.map(faqItem).join("")}</div></div></section>`;
}

function closing(): string {
  const copy = C.closing;
  return `<section id="closing" aria-labelledby="closing-title" class="xp-sec xp-sec--rule"><div class="xp-wrap xp-split xp-split--center"><div class="xp-closing__text"><h2 id="closing-title" class="xp-disp xp-h2 xp-h2--14">${e(copy.heading)}</h2><p class="xp-lede xp-measure">${e(copy.lede)}</p><p class="xp-soft">${e(copy.place)}</p></div><figure class="xp-closing__figure xp-figure">${MORNING_ILLUSTRATION}<figcaption class="xp-meta">${e(C.illustration)}</figcaption></figure></div></section>`;
}

/** Field errors are always in the markup, hidden when there is none, so the browser check fills the same elements. */
function fieldError(
  field: PartnerField,
  errors: PartnerApplicationErrors,
): string {
  const text = errors[field];
  return `<p class="xp-error" id="e-${field}" data-apply-error="${field}"${text === undefined ? " hidden" : ""}>${icon("alert", "sm")}<span>${text === undefined ? "" : e(text)}</span></p>`;
}

function openForm(
  form: Extract<PartnerFormState, { readonly kind: "open" }>,
): string {
  const copy = C.form;
  const input = form.input ?? EMPTY_PARTNER_INPUT;
  const errors = form.errors ?? {};
  const firstWrong = firstWrongField(errors);
  const state = (field: PartnerField): string =>
    ` aria-invalid="${errors[field] === undefined ? "false" : "true"}" aria-describedby="e-${field}"${firstWrong === field ? " autofocus" : ""}`;
  const text = (
    field: "fullName" | "business" | "phone" | "email",
    label: string,
    attributes: string,
  ): string =>
    `<div><label class="xp-label" for="f-${field}">${e(label)}</label><input class="xp-field" id="f-${field}" name="${field}" maxlength="${PARTNER_TEXT_MAX[field]}" ${attributes} value="${e(input[field])}"${state(field)}>${fieldError(field, errors)}</div>`;
  const select = (
    field: "area" | "units",
    label: string,
    empty: string,
    options: readonly string[],
  ): string =>
    `<div><label class="xp-label" for="f-${field}">${e(label)}</label><select class="xp-field" id="f-${field}" name="${field}"${state(field)}><option value="">${e(empty)}</option>${options.map((option) => `<option${input[field] === option ? " selected" : ""}>${e(option)}</option>`).join("")}</select>${fieldError(field, errors)}</div>`;
  const stay = (value: string, label: string, focus: boolean): string =>
    `<label class="xp-check"><input type="checkbox" name="stays" value="${value}"${input.stays.includes(value) ? " checked" : ""}${focus ? " autofocus" : ""}><span>${e(label)}</span></label>`;
  const count = Object.keys(errors).length;
  const alertLine =
    form.unavailable === true
      ? copy.unavailable
      : count > 0
        ? partnerErrorLine(count)
        : "";
  const alert = `<div class="xp-apply__alert" role="alert" data-apply-alert${alertLine === "" ? " hidden" : ""}${form.unavailable === true ? ' tabindex="-1" autofocus' : ""}>${icon("alert", "")}<p><strong>${e(copy.notSent)}</strong> <span data-apply-alert-text>${e(alertLine)}</span></p></div>`;
  return `<div class="xp-stack xp-stack--8"><h3 class="xp-disp xp-h2--small">${e(C.apply)}</h3><p class="xp-soft">${e(C.applyLede)}</p></div><form class="xp-apply__form" method="post" action="/partners/apply" novalidate data-apply-form data-apply-sending="${e(copy.sending)}"><input type="hidden" name="formKey" value="${e(form.formKey)}">${alert}<div class="xp-apply__grid">${text("fullName", copy.fullName, 'type="text" autocomplete="name"')}${text("business", copy.business, 'type="text" autocomplete="organization"')}${text("phone", copy.phone, `type="tel" inputmode="tel" autocomplete="tel" placeholder="${e(copy.phonePlaceholder)}"`)}${text("email", copy.email, 'type="email" autocomplete="email"')}${select("area", copy.area, copy.areaEmpty, PARTNER_AREAS)}${select("units", copy.units, copy.unitsEmpty, PARTNER_UNIT_RANGES)}</div><fieldset class="xp-apply__set" aria-describedby="e-stays"><legend class="xp-label">${e(copy.stays)}</legend><div class="xp-apply__checks">${stay("short", copy.staysShort, firstWrong === "stays")}${stay("monthly", copy.staysMonthly, false)}</div>${fieldError("stays", errors)}</fieldset><div><label class="xp-label" for="f-how">${e(copy.how)} <span class="xp-label__opt">${e(copy.optional)}</span></label><textarea class="xp-field" id="f-how" name="how" rows="3" maxlength="${PARTNER_TEXT_MAX.how}">${e(input.how)}</textarea></div><div class="xp-apply__consent"><label class="xp-check"><input type="checkbox" name="consent" value="yes"${input.consent ? " checked" : ""}${state("consent")}><span>${e(PARTNER_CONSENT_TEXT)}</span></label>${fieldError("consent", errors)}<a class="xp-link" href="${e(form.privacyNoticeUrl)}">${e(copy.privacyNotice)}</a></div><div><button type="submit" class="xp-btn" data-apply-send>${e(copy.send)}</button></div></form>`;
}

function applyCard(form: PartnerFormState): string {
  const copy = C.form;
  if (form.kind === "sent")
    return `<div class="xp-apply__sent" role="status"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICON.tick}</svg><p class="xp-disp">${e(copy.sentHeading)}</p><p class="xp-soft xp-large">${e(copy.sentBody)}</p></div>`;
  if (form.kind === "closed")
    return `<div class="xp-apply__sent xp-apply__sent--closed">${icon("clock", "lg")}<h3 class="xp-disp xp-h2--small">${e(C.apply)}</h3><p class="xp-strong">${e(copy.closedHeading)}</p><p class="xp-soft">${e(copy.closedBody)}</p></div>`;
  return openForm(form);
}

function join(form: PartnerFormState): string {
  const copy = C.join;
  const compact = form.kind !== "open";
  const steps = copy.steps
    .map(
      (text, index) =>
        `<li><span class="xp-join__n" aria-hidden="true">${index + 1}</span><p>${e(text)}</p></li>`,
    )
    .join("");
  return `<section id="apply" aria-labelledby="join-title" class="xp-sec xp-sec--rule"><div class="xp-wrap xp-split xp-split--48${compact ? " xp-split--center" : ""}"><div class="xp-join xp-stack">${eyebrow(copy.eyebrow)}<h2 id="join-title" class="xp-disp xp-h2">${e(copy.heading)}</h2><ol class="xp-join__steps">${steps}</ol><figure class="xp-join__figure xp-figure">${DOOR_ILLUSTRATION}<figcaption class="xp-meta">${e(C.illustration)}</figcaption></figure></div><div class="xp-apply${compact ? " xp-apply--compact" : ""}" id="application">${applyCard(form)}</div></div></section>`;
}

function footer(): string {
  return `<footer class="xp-band xp-footer"><div class="xp-wrap xp-footer__row"><div class="xp-stack xp-stack--8"><span class="xp-disp xp-footer__brand">${e(C.brand)}</span><span class="xp-large xp-footer__line">${e(C.footer.place)}</span></div><a href="/welcome" class="xp-link">${e(C.footer.guestPage)}</a></div></footer>`;
}

/** The whole document. Pure: no session, no clock, no request data beyond the form state. */
export function renderPartnersHtml(options: PartnersRenderOptions): string {
  return `<!doctype html><html lang="en-NG" data-theme="${options.theme ?? "system"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="preload" as="font" type="font/woff2" crossorigin href="/landing/fonts/newsreader-500.woff2"><title>${e(C.pageTitle)}</title><meta name="description" content="${e(C.pageDescription)}"><link rel="stylesheet" href="/xenia-partners.css"><script src="/partners.js" defer></script></head><body><div class="xp" id="top"><a class="xp-skip" href="#main">${e(C.skip)}</a>${header()}<main id="main">${hero()}${problem()}${guest()}${how()}${benefits()}${side()}${payment()}${founding()}${questions()}${closing()}${join(options.form)}</main>${footer()}</div></body></html>`;
}
