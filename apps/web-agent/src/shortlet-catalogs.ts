import { escapeHtml } from "../../web/src/ui-kit.js";
import {
  defineCatalogueManifest,
  defineSurfaceComponent,
  type ComposedCatalogue,
  type JsonObject,
  type SurfaceComponentDefinition,
} from "../../../packages/surface-kit/src/index.js";
import { composeWeaverCatalogue } from "./catalogues/weaver-catalogues.js";
import { COMPARE_BACK_EVENT, COMPARE_UNIT_EVENT, SEE_ALL_DISCOVERY_EVENT, VIEW_UNIT_EVENT } from "./discovery-actions.js";
import { BACK_TO_RESULTS_EVENT, REQUEST_TO_BOOK_EVENT } from "./unit-detail-actions.js";
import { REQUEST_DRAFT_REVIEW_EVENT, REQUEST_DRAFT_SUBMIT_EVENT } from "./request-draft-actions.js";
import { DRAFT_REPLACEMENT_ACCEPT_EVENT, DRAFT_REPLACEMENT_KEEP_EVENT } from "./draft-replacement-actions.js";
import { EXTENSION_OPEN_EVENT, NOTICE_OPEN_EVENT } from "./booking-contract-actions.js";
import { BANK_TRANSFER_INITIALIZE_EVENT } from "../../web/src/bank-transfer-actions.js";
import { CARD_PAYMENT_INITIALIZE_CHECKOUT_EVENT, CARD_PAYMENT_VERIFY_RETURN_EVENT } from "../../web/src/card-payment-actions.js";
import { CONDITIONAL_OFFER_ACCEPT_EVENT } from "../../web/src/conditional-offer-actions.js";

/** Owner-approved platform URN namespace; it claims no public domain. */
export const SHORTLET_CATALOG_NAMESPACE = "urn:chat-marketplace:shortlet";
export const SHORTLET_DISCOVERY_CATALOG_ID = `${SHORTLET_CATALOG_NAMESPACE}/discovery/v1`;
export const SHORTLET_BOOKING_CATALOG_ID = `${SHORTLET_CATALOG_NAMESPACE}/booking/v1`;

/**
 * Weaver catalogues issues 05 to 07 (ADR 0102): the typed components of `shortlet-discovery/v1`. Every prop is a
 * display string the server formatted (ADR 0077); none is a price, deadline or rule the client could compute.
 */
export const UNIT_DETAIL_COMPONENT = "UnitDetail";
export const UNIT_GALLERY_COMPONENT = "UnitGallery";
export const UNIT_DETAIL_SHEET_COMPONENT = "UnitDetailSheet";
export const UNIT_ACTION_BAR_COMPONENT = "UnitActionBar";
export const STAY_CARD_COMPONENT = "StayCard";
export const STAY_RESULTS_COMPONENT = "StayResults";
export const STAY_COMPARISON_COMPONENT = "StayComparison";
export const STAY_TICKET_COMPONENT = "StayTicket";
export const PRICE_BREAKDOWN_COMPONENT = "PriceBreakdown";

const COMPONENT_ID: JsonObject = { $ref: "common_types.json#/$defs/ComponentId" };
const CHILD_LIST: JsonObject = { $ref: "common_types.json#/$defs/ChildList" };
const TEXT: JsonObject = { type: "string", minLength: 1 };

/** The id, component, accessibility and weight envelope every Basic component carries, so typed components read the same. */
function componentSchema(component: string, properties: JsonObject, required: readonly string[]): JsonObject {
  return {
    type: "object",
    properties: {
      id: { type: "string" },
      accessibility: { $ref: "common_types.json#/$defs/AccessibilityAttributes" },
      weight: { type: "number" },
      component: { const: component },
      ...properties,
    },
    required: ["id", "component", ...required],
    additionalProperties: false,
  };
}

const TILE: JsonObject = {
  type: "object",
  properties: { icon: { enum: ["bed", "bath", "users"] }, text: TEXT },
  required: ["icon", "text"],
  additionalProperties: false,
};

/** The money lines `breakdownHtml` draws on the unit sheet: the total, its label, and the separate deposit. */
const UNIT_BREAKDOWN: JsonObject = {
  type: "object",
  properties: { total: TEXT, totalLabel: TEXT, deposit: TEXT },
  required: ["total", "totalLabel"],
  additionalProperties: false,
};

/** A compact result row: the parts `resultRowPartsHtml` draws, keyed by the unit its card shows. */
const RESULT_ROW: JsonObject = {
  type: "object",
  properties: { unitId: TEXT, title: TEXT, total: TEXT, totalLabel: TEXT, photoUrl: TEXT },
  required: ["unitId", "title", "total", "totalLabel"],
  additionalProperties: false,
};

/** One comparison cell: the server-formatted value (empty when the stay has none) and the stay it describes. */
const COMPARE_CELL: JsonObject = {
  type: "object",
  properties: { value: { type: "string" }, unit: TEXT },
  required: ["value"],
  additionalProperties: false,
};

const COMPARE_ROW: JsonObject = {
  type: "object",
  properties: { key: TEXT, cells: { type: "array", items: COMPARE_CELL, minItems: 1 } },
  required: ["key", "cells"],
  additionalProperties: false,
};

const PHOTO: JsonObject = {
  type: "object",
  properties: { url: TEXT, alt: TEXT },
  required: ["url", "alt"],
  additionalProperties: false,
};

const TICKET_DATE: JsonObject = {
  type: "object",
  properties: { day: TEXT, date: TEXT, datetime: TEXT },
  required: ["day", "date"],
  additionalProperties: false,
};

type TileProps = { readonly icon: "bed" | "bath" | "users"; readonly text: string };
type PhotoProps = { readonly url: string; readonly alt: string };
type TicketDateProps = { readonly day: string; readonly date: string; readonly datetime?: string };

/** The complete reading-order text of one ticket date: day and date, then the machine-readable datetime, if any. */
function ticketDateText(date: TicketDateProps): string {
  return [`${date.day} ${date.date}`, date.datetime].filter((part): part is string => part !== undefined).join(" ");
}

interface UnitDetailProps {
  readonly id: string;
  readonly component: "UnitDetail";
  readonly gallery: string;
  readonly sheet: string;
  readonly amenities: readonly string[];
  readonly supporting: readonly string[];
  readonly actionBar: string;
}

interface UnitGalleryProps {
  readonly id: string;
  readonly component: "UnitGallery";
  readonly title: string;
  readonly photos: readonly PhotoProps[];
}

interface UnitDetailSheetProps {
  readonly id: string;
  readonly component: "UnitDetailSheet";
  readonly where: string;
  readonly title: string;
  readonly demo?: boolean;
  readonly tiles: readonly TileProps[];
  readonly breakdown?: { readonly total: string; readonly totalLabel: string; readonly deposit?: string };
  readonly extended?: readonly string[];
  readonly about?: string;
}

interface UnitActionBarProps {
  readonly id: string;
  readonly component: "UnitActionBar";
  readonly total?: string;
  readonly totalLabel?: string;
  readonly child: string;
}

interface StayCardProps {
  readonly id: string;
  readonly component: "StayCard";
  readonly unitId: string;
  readonly title: string;
  readonly where: string;
  readonly demo?: boolean;
  readonly facts: readonly TileProps[];
  readonly total: string;
  readonly totalLabel: string;
  readonly deposit?: string;
  readonly photoUrl?: string;
  readonly photoCount?: number;
  readonly view: string;
  readonly compare: string;
  readonly fit: string;
  readonly notes: readonly string[];
}

interface StayResultsProps {
  readonly id: string;
  readonly component: "StayResults";
  readonly rows: readonly { readonly unitId: string; readonly title: string; readonly total: string; readonly totalLabel: string; readonly photoUrl?: string }[];
  readonly cards: readonly string[];
}

interface StayComparisonProps {
  readonly id: string;
  readonly component: "StayComparison";
  readonly heads: readonly string[];
  readonly rows: readonly { readonly key: string; readonly cells: readonly { readonly value: string; readonly unit?: string }[] }[];
  readonly actions: readonly string[];
}

interface StayTicketProps {
  readonly id: string;
  readonly component: "StayTicket";
  readonly title: string;
  readonly checkIn: TicketDateProps;
  readonly checkOut: TicketDateProps;
  readonly foot: string;
}

interface PriceBreakdownProps {
  readonly id: string;
  readonly component: "PriceBreakdown";
  readonly condition?: string;
  readonly total?: string;
  readonly totalLabel?: string;
  readonly deposit?: string;
  readonly depositCollected?: boolean;
  readonly due?: string;
  readonly thisPayment?: string;
  readonly paid?: string;
  readonly next?: string;
}

/**
 * One Tier 3 Surface Component (ADR 0108 decision 2; issue-02 Follow-up B, owner decision D34): the schema is the
 * shipped one, so the composed wire stays byte-identical. `html` and `text` are the plain fallbacks every component
 * carries (ADR 0074, ADR 0075): escaped display props only, in reading order. The live chat and page markup still
 * comes from the trusted DOM renderers until per-alias host-aware renderers land (issue-02 Follow-up C), so no
 * markup or copy is invented here.
 */
function shortletComponent<TProps>(
  name: string,
  required: readonly string[],
  properties: JsonObject,
  html: (props: TProps) => string,
  text: (props: TProps) => string,
  fixtures: { readonly valid: readonly TProps[]; readonly invalid: readonly JsonObject[] },
): SurfaceComponentDefinition<TProps> {
  return defineSurfaceComponent<TProps>({
    name,
    version: "1.0.0",
    tier: 3,
    schema: componentSchema(name, properties, required),
    html,
    text,
    fixtures,
  });
}

/** The surface root: the unit detail's sections in their fixed order, so the client never searches the DOM for them. */
const UNIT_DETAIL = shortletComponent<UnitDetailProps>(
  UNIT_DETAIL_COMPONENT,
  ["gallery", "sheet", "amenities", "supporting", "actionBar"],
  { gallery: COMPONENT_ID, sheet: COMPONENT_ID, amenities: CHILD_LIST, supporting: CHILD_LIST, actionBar: COMPONENT_ID },
  () => `<div class="unit-detail-root"></div>`,
  () => "",
  {
    valid: [
      { id: "unit-detail", component: "UnitDetail", gallery: "gallery", sheet: "sheet", amenities: ["a1"], supporting: [], actionBar: "action-bar" },
    ],
    invalid: [
      { id: "unit-detail", component: "UnitDetail", gallery: "gallery", sheet: "sheet", amenities: ["a1"], supporting: [], actionBar: "action-bar", extra: 1 },
      { id: "unit-detail", component: "UnitDetail", gallery: "gallery", sheet: "sheet", amenities: [], supporting: [], actionBar: "action-bar" },
    ],
  },
);

const UNIT_GALLERY = shortletComponent<UnitGalleryProps>(
  UNIT_GALLERY_COMPONENT,
  ["title", "photos"],
  { title: TEXT, photos: { type: "array", items: PHOTO } },
  (props) => `<div class="unit-gallery" role="group">${props.photos.map((photo) => `<img src="${escapeHtml(photo.url)}" alt="${escapeHtml(photo.alt)}">`).join("")}</div>`,
  (props) => [props.title, ...props.photos.map((photo) => photo.alt)].join("\n"),
  {
    valid: [
      { id: "gallery", component: "UnitGallery", title: "Photos", photos: [{ url: "https://example.test/a.jpg", alt: "Living room" }] },
    ],
    invalid: [
      { id: "gallery", component: "UnitGallery", title: "Photos", photos: [{ url: "https://example.test/a.jpg", alt: "Living room" }], extra: 1 },
      { id: "gallery", component: "UnitGallery", title: "Photos", photos: [] },
    ],
  },
);

/** The sheet the standalone `/stays/:id` page renders: where, title, tiles, price, Extended Stay lines and about. */
const UNIT_DETAIL_SHEET = shortletComponent<UnitDetailSheetProps>(
  UNIT_DETAIL_SHEET_COMPONENT,
  ["where", "title", "tiles"],
  { where: TEXT, title: TEXT, demo: { type: "boolean" }, tiles: { type: "array", items: TILE, minItems: 1 }, breakdown: UNIT_BREAKDOWN, extended: { type: "array", items: TEXT }, about: TEXT },
  (props) => `<section class="unit-detail-sheet"><p class="unit-detail-location">${escapeHtml(props.where)}</p><h2 class="unit-detail-title">${escapeHtml(props.title)}</h2><ul class="ui-tiles">${props.tiles.map((tile) => `<li class="ui-tiles__tile">${escapeHtml(tile.text)}</li>`).join("")}</ul>${props.breakdown === undefined ? "" : `<p class="ui-money-total">${escapeHtml(props.breakdown.total)}</p>`}${(props.extended ?? []).map((entry) => `<p class="ui-money-metadata">${escapeHtml(entry)}</p>`).join("")}${props.about === undefined ? "" : `<p class="unit-detail-description">${escapeHtml(props.about)}</p>`}</section>`,
  (props) => [
    props.where,
    props.title,
    ...props.tiles.map((tile) => tile.text),
    props.breakdown === undefined ? undefined : [props.breakdown.total, props.breakdown.totalLabel, props.breakdown.deposit].filter((part): part is string => part !== undefined).join(" "),
    ...(props.extended ?? []),
    props.about,
  ].filter((part): part is string => part !== undefined && part !== "").join("\n"),
  {
    valid: [
      { id: "sheet", component: "UnitDetailSheet", where: "Ikoyi, Lagos", title: "Sunny flat", tiles: [{ icon: "bed", text: "2 bedrooms" }] },
      { id: "sheet-full", component: "UnitDetailSheet", where: "Ikoyi, Lagos", title: "Sunny flat", demo: true, tiles: [{ icon: "bed", text: "2 bedrooms" }], breakdown: { total: "NGN 80,000", totalLabel: "total", deposit: "NGN 40,000" }, extended: ["Utilities included"], about: "A bright flat." },
    ],
    invalid: [
      { id: "sheet", component: "UnitDetailSheet", where: "Ikoyi, Lagos", title: "Sunny flat", tiles: [{ icon: "bed", text: "2 bedrooms" }], extra: 1 },
      { id: "sheet", component: "UnitDetailSheet", where: "Ikoyi, Lagos", title: "Sunny flat", tiles: [] },
    ],
  },
);

/** The sticky action bar: the total and its label, then the child Row of Weaver buttons, which keep their events. */
const UNIT_ACTION_BAR = shortletComponent<UnitActionBarProps>(
  UNIT_ACTION_BAR_COMPONENT,
  ["child"],
  { total: TEXT, totalLabel: TEXT, child: COMPONENT_ID },
  (props) => `<div class="ui-action-bar unit-action-bar"><p class="ui-action-bar__sum">${escapeHtml(props.total ?? "")} ${escapeHtml(props.totalLabel ?? "")}</p></div>`,
  (props) => [props.total, props.totalLabel].filter((part): part is string => part !== undefined).join(" "),
  {
    valid: [
      { id: "action-bar", component: "UnitActionBar", total: "NGN 80,000", totalLabel: "total", child: "actions" },
    ],
    invalid: [
      { id: "action-bar", component: "UnitActionBar", total: "NGN 80,000", totalLabel: "total", child: "actions", extra: 1 },
      { id: "action-bar", component: "UnitActionBar", child: "actions", total: 80_000 },
    ],
  },
);

/** Weaver catalogues issue 06: one search result, the search page's `.ui-stay-card`. `view` and `compare` are the Basic Buttons that carry the allow-listed discovery events; `fit` and `notes` are Basic caption Texts the server words. */
const STAY_CARD = shortletComponent<StayCardProps>(
  STAY_CARD_COMPONENT,
  ["unitId", "title", "where", "facts", "total", "totalLabel"],
  {
    unitId: TEXT,
    title: TEXT,
    where: TEXT,
    demo: { type: "boolean" },
    facts: { type: "array", items: TILE, minItems: 1 },
    total: TEXT,
    totalLabel: TEXT,
    deposit: TEXT,
    photoUrl: TEXT,
    photoCount: { type: "integer", minimum: 0 },
    view: COMPONENT_ID,
    compare: COMPONENT_ID,
    fit: COMPONENT_ID,
    notes: CHILD_LIST,
  },
  (props) => `<article class="stay-card ui-stay-card"><h2 class="ui-stay-card__title">${escapeHtml(props.title)}</h2><p>${escapeHtml(props.where)}</p><p class="ui-stay-card__price">${escapeHtml(props.total)} ${escapeHtml(props.totalLabel)}</p></article>`,
  (props) => [props.title, props.where, ...props.facts.map((fact) => fact.text), props.total, props.totalLabel, props.deposit].filter((part): part is string => part !== undefined).join("\n"),
  {
    valid: [
      { id: "stay-card", component: "StayCard", unitId: "unit-1", title: "Sunny flat", where: "Ikoyi, Lagos", facts: [{ icon: "bed", text: "2 bedrooms" }], total: "NGN 80,000", totalLabel: "total", view: "view", compare: "compare", fit: "fit", notes: [] },
    ],
    invalid: [
      { id: "stay-card", component: "StayCard", unitId: "unit-1", title: "Sunny flat", where: "Ikoyi, Lagos", facts: [{ icon: "bed", text: "2 bedrooms" }], total: "NGN 80,000", totalLabel: "total", view: "view", compare: "compare", fit: "fit", notes: [], extra: 1 },
      { id: "stay-card", component: "StayCard", unitId: "unit-1", title: "Sunny flat", where: "Ikoyi, Lagos", facts: [], total: "NGN 80,000", totalLabel: "total", view: "view", compare: "compare", fit: "fit", notes: [] },
    ],
  },
);

/** The result list: the phone result rows (each opening its own card by unitId), then the grid of StayCards. */
const STAY_RESULTS = shortletComponent<StayResultsProps>(
  STAY_RESULTS_COMPONENT,
  ["rows", "cards"],
  { rows: { type: "array", items: RESULT_ROW, minItems: 1 }, cards: CHILD_LIST },
  (props) => `<div class="stay-results"><div class="ui-result-rows">${props.rows.map((row) => `<a class="ui-result-row" href="/stays/${escapeHtml(row.unitId)}"><span class="ui-result-row__body"><span class="ui-result-row__title">${escapeHtml(row.title)}</span><span class="ui-result-row__price">${escapeHtml(row.total)} ${escapeHtml(row.totalLabel)}</span></span></a>`).join("")}</div></div>`,
  (props) => props.rows.map((row) => [row.title, row.total, row.totalLabel].join(" ")).join("\n"),
  {
    valid: [
      { id: "stay-results", component: "StayResults", rows: [{ unitId: "unit-1", title: "Sunny flat", total: "NGN 80,000", totalLabel: "total" }], cards: ["card-1"] },
    ],
    invalid: [
      { id: "stay-results", component: "StayResults", rows: [{ unitId: "unit-1", title: "Sunny flat", total: "NGN 80,000", totalLabel: "total" }], cards: ["card-1"], extra: 1 },
      { id: "stay-results", component: "StayResults", rows: [], cards: ["card-1"] },
    ],
  },
);

/** Weaver catalogues issue 07: the side-by-side table, stays as columns and one row per attribute. The builder guarantees every row has one cell per head. */
const STAY_COMPARISON = shortletComponent<StayComparisonProps>(
  STAY_COMPARISON_COMPONENT,
  ["heads", "rows"],
  { heads: { type: "array", items: TEXT, minItems: 1 }, rows: { type: "array", items: COMPARE_ROW, minItems: 1 }, actions: CHILD_LIST },
  (props) => `<div class="ui-compare" role="table"><div role="row">${props.heads.map((head) => `<span role="columnheader">${escapeHtml(head)}</span>`).join("")}</div>${props.rows.map((row) => `<div role="row"><span role="rowheader">${escapeHtml(row.key)}</span>${row.cells.map((cell) => `<span role="cell">${escapeHtml(cell.value)}</span>`).join("")}</div>`).join("")}</div>`,
  (props) => [props.heads.join(" "), ...props.rows.map((row) => [row.key, ...row.cells.map((cell) => cell.value)].join(" "))].join("\n"),
  {
    valid: [
      { id: "stay-comparison", component: "StayComparison", heads: ["Stay"], rows: [{ key: "Total", cells: [{ value: "NGN 80,000" }] }], actions: ["view-1"] },
    ],
    invalid: [
      { id: "stay-comparison", component: "StayComparison", heads: ["Stay"], rows: [{ key: "Total", cells: [{ value: "NGN 80,000" }] }], actions: ["view-1"], extra: 1 },
      { id: "stay-comparison", component: "StayComparison", heads: [], rows: [{ key: "Total", cells: [{ value: "NGN 80,000" }] }], actions: ["view-1"] },
    ],
  },
);

/** Weaver catalogues issue 04 (ADR 0102): the stay ticket, mirroring the kit's TicketParts. Every value is a display string formatted on the server (ADR 0077). */
const STAY_TICKET = shortletComponent<StayTicketProps>(
  STAY_TICKET_COMPONENT,
  ["title", "checkIn", "checkOut", "foot"],
  { title: TEXT, checkIn: TICKET_DATE, checkOut: TICKET_DATE, foot: TEXT },
  (props) => `<section class="ui-ticket"><h2 class="ui-ticket__name">${escapeHtml(props.title)}</h2><div class="ui-ticket__dates">${escapeHtml(ticketDateText(props.checkIn))} → ${escapeHtml(ticketDateText(props.checkOut))}</div><p class="ui-ticket__foot">${escapeHtml(props.foot)}</p></section>`,
  (props) => [props.title, ticketDateText(props.checkIn), ticketDateText(props.checkOut), props.foot].join("\n"),
  {
    valid: [
      { id: "stay-ticket", component: "StayTicket", title: "Sunny flat", checkIn: { day: "Thu", date: "10 Sept" }, checkOut: { day: "Sun", date: "13 Sept" }, foot: "3 nights" },
    ],
    invalid: [
      { id: "stay-ticket", component: "StayTicket", title: "Sunny flat", checkIn: { day: "Thu", date: "10 Sept" }, checkOut: { day: "Sun", date: "13 Sept" }, foot: "3 nights", extra: 1 },
      { id: "stay-ticket", component: "StayTicket", title: "Sunny flat", checkIn: {}, checkOut: { day: "Sun", date: "13 Sept" }, foot: "3 nights" },
    ],
  },
);

/** Weaver catalogues issue 04 (ADR 0102): the price breakdown, mirroring the kit's BreakdownParts. The order is breakdownHtml's (ADR 0015). */
const PRICE_BREAKDOWN = shortletComponent<PriceBreakdownProps>(
  PRICE_BREAKDOWN_COMPONENT,
  [],
  { condition: TEXT, total: TEXT, totalLabel: TEXT, deposit: TEXT, depositCollected: { type: "boolean" }, due: TEXT, thisPayment: TEXT, paid: TEXT, next: TEXT },
  (props) => `<div class="ui-price-breakdown">${[props.condition, props.total, props.totalLabel, props.deposit, props.due, props.thisPayment, props.paid, props.next].filter((part): part is string => part !== undefined).map((part) => `<p>${escapeHtml(part)}</p>`).join("")}</div>`,
  (props) => [props.condition, props.total, props.totalLabel, props.deposit, props.due, props.thisPayment, props.paid, props.next].filter((part): part is string => part !== undefined).join("\n"),
  {
    valid: [
      { id: "price-breakdown", component: "PriceBreakdown", total: "NGN 80,000", totalLabel: "total", deposit: "NGN 40,000", due: "NGN 40,000" },
    ],
    invalid: [
      { id: "price-breakdown", component: "PriceBreakdown", total: "NGN 80,000", totalLabel: "total", deposit: "NGN 40,000", due: "NGN 40,000", extra: 1 },
      { id: "price-breakdown", component: "PriceBreakdown", total: 80_000 },
    ],
  },
);

/**
 * The two approved shortlet catalogues (ADR 0102) declared as Catalogue Manifests (ADR 0108 decision 3; issue-02
 * Follow-up B, owner decision D34). The nine typed components enter as Tier 3 Surface Components under their shipped
 * names, so each composed schema is byte-identical to the wire these catalogues had before; the canonical snapshots in
 * `test/fixtures/catalogues/` pin it. `actions` allow-lists every event a builder emits on a surface under these ids —
 * the six discovery events and the ten booking events — each named by its existing constant.
 */
export const SHORTLET_DISCOVERY_MANIFEST = defineCatalogueManifest({
  id: SHORTLET_DISCOVERY_CATALOG_ID,
  owner: "shortlet",
  base: "basic/v0.9.1",
  components: {
    [UNIT_DETAIL_COMPONENT]: { major: UNIT_DETAIL.major, component: UNIT_DETAIL },
    [UNIT_GALLERY_COMPONENT]: { major: UNIT_GALLERY.major, component: UNIT_GALLERY },
    [UNIT_DETAIL_SHEET_COMPONENT]: { major: UNIT_DETAIL_SHEET.major, component: UNIT_DETAIL_SHEET },
    [UNIT_ACTION_BAR_COMPONENT]: { major: UNIT_ACTION_BAR.major, component: UNIT_ACTION_BAR },
    [STAY_CARD_COMPONENT]: { major: STAY_CARD.major, component: STAY_CARD },
    [STAY_RESULTS_COMPONENT]: { major: STAY_RESULTS.major, component: STAY_RESULTS },
    [STAY_COMPARISON_COMPONENT]: { major: STAY_COMPARISON.major, component: STAY_COMPARISON },
  },
  actions: [VIEW_UNIT_EVENT, SEE_ALL_DISCOVERY_EVENT, COMPARE_UNIT_EVENT, COMPARE_BACK_EVENT, REQUEST_TO_BOOK_EVENT, BACK_TO_RESULTS_EVENT],
});

export const SHORTLET_BOOKING_MANIFEST = defineCatalogueManifest({
  id: SHORTLET_BOOKING_CATALOG_ID,
  owner: "shortlet",
  base: "basic/v0.9.1",
  components: {
    [STAY_TICKET_COMPONENT]: { major: STAY_TICKET.major, component: STAY_TICKET },
    [PRICE_BREAKDOWN_COMPONENT]: { major: PRICE_BREAKDOWN.major, component: PRICE_BREAKDOWN },
  },
  actions: [
    REQUEST_DRAFT_REVIEW_EVENT,
    REQUEST_DRAFT_SUBMIT_EVENT,
    DRAFT_REPLACEMENT_ACCEPT_EVENT,
    DRAFT_REPLACEMENT_KEEP_EVENT,
    CONDITIONAL_OFFER_ACCEPT_EVENT,
    BANK_TRANSFER_INITIALIZE_EVENT,
    CARD_PAYMENT_INITIALIZE_CHECKOUT_EVENT,
    CARD_PAYMENT_VERIFY_RETURN_EVENT,
    NOTICE_OPEN_EVENT,
    EXTENSION_OPEN_EVENT,
  ],
});

const DISCOVERY = composeWeaverCatalogue(SHORTLET_DISCOVERY_MANIFEST);
const BOOKING = composeWeaverCatalogue(SHORTLET_BOOKING_MANIFEST);

export const SHORTLET_DISCOVERY_CATALOG = DISCOVERY.registration;
export const SHORTLET_BOOKING_CATALOG = BOOKING.registration;

/** Both composed shortlet catalogues, discovery first. The one list the runtime and the registry are fed from (issue 04). */
export const SHORTLET_COMPOSED_CATALOGUES: readonly ComposedCatalogue[] = [DISCOVERY.composed, BOOKING.composed];
