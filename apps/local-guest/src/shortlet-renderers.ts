import type { HydratedValue } from "@cylayo/weaver-core";
import type {
  BasicResourcePolicy,
  RendererRegistration,
  WebComponentRenderInput,
  WebRenderedRelationship,
} from "@cylayo/weaver-web";
import {
  PRICE_BREAKDOWN_COMPONENT,
  SHORTLET_BOOKING_CATALOG_ID,
  SHORTLET_DISCOVERY_CATALOG_ID,
  STAY_CARD_COMPONENT,
  STAY_COMPARISON_COMPONENT,
  STAY_RESULTS_COMPONENT,
  STAY_TICKET_COMPONENT,
  UNIT_ACTION_BAR_COMPONENT,
  UNIT_DETAIL_COMPONENT,
  UNIT_DETAIL_SHEET_COMPONENT,
  UNIT_GALLERY_COMPONENT,
} from "../../web-agent/src/shortlet-catalogs.js";
import {
  breakdownHtml,
  demoListingChipHtml,
  resultRowPartsHtml,
  stayCardInnerHtml,
  ticketHtml,
  unitAboutHtml,
  unitLocationHtml,
  unitTilesHtml,
  unitTitleHtml,
  type BreakdownParts,
  type StayCardParts,
  type TicketDatePart,
  type TicketParts,
} from "./guest-kit.js";
import { icon } from "../../web/src/ui-kit.js";
import { buildListingGallery } from "./listing-gallery.js";

/**
 * Trusted renderers for the typed `shortlet-*` catalogue components (ADR 0102). Each renders platform-owned guest-kit
 * markup from schema-validated props, so the chat and the standalone page share one markup source. Every prop value is
 * escaped by the kit helpers; no agent HTML, script or URL reaches the DOM unescaped (ADR 0073, ADR 0075). Photo URLs
 * pass the host resource policy, and a refused URL is dropped rather than rendered.
 */
export interface ShortletRendererOptions {
  readonly resourcePolicy?: BasicResourcePolicy;
  /**
   * Weaver catalogues issue 06: "See both side by side" picks both results through their Compare buttons. The host
   * supplies it (client.ts `compareBoth`); without it the link is not offered, so it is never a dead control.
   */
  readonly onCompareBoth?: () => void;
}

export const UNIT_PHOTOS_UNAVAILABLE = "No property photos are available yet.";

type Tile = { readonly icon: "bed" | "bath" | "users"; readonly text: string };

function record(value: HydratedValue | undefined): Readonly<Record<string, HydratedValue>> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, HydratedValue>>)
    : undefined;
}

function text(value: HydratedValue | undefined): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function list(value: HydratedValue | undefined): readonly HydratedValue[] {
  return Array.isArray(value) ? value : [];
}

function texts(value: HydratedValue | undefined): readonly string[] {
  return list(value).flatMap((item) => {
    const line = text(item);
    return line === undefined ? [] : [line];
  });
}

function tiles(value: HydratedValue | undefined): readonly Tile[] {
  return list(value).flatMap((item) => {
    const tile = record(item);
    const icon = tile?.["icon"];
    const line = text(tile?.["text"]);
    return (icon === "bed" || icon === "bath" || icon === "users") && line !== undefined ? [{ icon, text: line }] : [];
  });
}

/** Kit markup to DOM, in the renderer's own document (the PRD's one-markup-source rule). */
function fromKit(document: Document, html: string): DocumentFragment {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content;
}

function single(relationships: readonly WebRenderedRelationship[], property: string): Node | undefined {
  const relationship = relationships.find((candidate) => candidate.property === property);
  return relationship?.kind === "single" ? relationship.child : undefined;
}

function children(relationships: readonly WebRenderedRelationship[], property: string): readonly Node[] {
  const relationship = relationships.find((candidate) => candidate.property === property);
  return relationship !== undefined && relationship.kind !== "single" ? relationship.children : [];
}

function element(document: Document, tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

/** The surface root: the gallery, the sheet, the amenities, the supporting captions and the action bar, in order. */
function renderUnitDetail({ document, relationships }: WebComponentRenderInput): Node {
  const root = element(document, "div", "unit-detail-root");
  const gallery = single(relationships, "gallery");
  if (gallery) root.append(gallery);
  const sheet = single(relationships, "sheet");
  if (sheet) root.append(sheet);
  for (const [property, className] of [["amenities", "unit-amenities"], ["supporting", "unit-supporting-info"]] as const) {
    const nodes = children(relationships, property);
    if (nodes.length === 0) continue;
    const group = element(document, "div", className);
    group.append(...nodes);
    root.append(group);
  }
  const actionBar = single(relationships, "actionBar");
  if (actionBar) root.append(actionBar);
  return root;
}

/** The shared listing gallery (guest-gallery issue 01), or the labelled no-photos group; never an unapproved image. */
function renderUnitGallery(resourcePolicy: BasicResourcePolicy | undefined) {
  return ({ document, properties }: WebComponentRenderInput): Node => {
    const title = text(properties["title"]) ?? "this apartment";
    const images = list(properties["photos"]).flatMap((item) => {
      const photo = record(item);
      const approved = approvedImage(resourcePolicy, text(photo?.["url"]));
      if (approved === undefined) return [];
      const image = document.createElement("img");
      image.setAttribute("src", approved);
      image.alt = text(photo?.["alt"]) ?? "";
      return [image];
    });
    if (images.length > 0) return buildListingGallery(document, title, images);
    const fallback = element(document, "div", "unit-gallery unit-gallery--fallback");
    fallback.setAttribute("role", "group");
    fallback.setAttribute("aria-label", "Property photos");
    const missing = element(document, "p", "unit-photo-missing");
    missing.textContent = UNIT_PHOTOS_UNAVAILABLE;
    fallback.append(missing);
    return fallback;
  };
}

/** The sheet the standalone `/stays/:id` page renders: where, title, tiles, price, Extended Stay lines and about. */
function renderUnitDetailSheet({ document, properties }: WebComponentRenderInput): Node {
  const sheet = element(document, "section", "unit-detail-sheet");
  sheet.setAttribute("aria-label", "Stay details");
  const html: string[] = [];
  // ADR 0105: the demo listing chip leads the sheet, as on the standalone page.
  if (properties["demo"] === true) html.push(demoListingChipHtml());
  const where = text(properties["where"]);
  if (where) html.push(unitLocationHtml(where));
  const title = text(properties["title"]);
  if (title) html.push(unitTitleHtml(title));
  const facts = tiles(properties["tiles"]);
  if (facts.length > 0) html.push(unitTilesHtml(facts));
  const breakdown = record(properties["breakdown"]);
  const total = text(breakdown?.["total"]);
  if (breakdown && total) {
    const totalLabel = text(breakdown["totalLabel"]);
    const deposit = text(breakdown["deposit"]);
    html.push(breakdownHtml({ total, ...(totalLabel ? { totalLabel } : {}), ...(deposit ? { deposit } : {}) }));
  }
  // Demo-launch issue 12 (ADR 0092): an Extended Stay's monthly price and utilities lines sit under the price.
  const extended = texts(properties["extended"]);
  const about = text(properties["about"]);
  sheet.append(fromKit(document, html.join("")));
  if (extended.length > 0) {
    const block = element(document, "div", "unit-detail-extended");
    for (const line of extended) {
      const paragraph = element(document, "p", "ui-money-metadata");
      paragraph.textContent = line;
      block.append(paragraph);
    }
    sheet.append(block);
  }
  if (about) sheet.append(fromKit(document, unitAboutHtml(about)));
  return sheet;
}

/** The sticky action bar: the total and its label, then the Basic Row of Weaver buttons, which keep their events. */
function renderUnitActionBar({ document, properties, relationships }: WebComponentRenderInput): Node {
  const bar = element(document, "div", "ui-action-bar ui-action-bar--sticky unit-action-bar");
  const total = text(properties["total"]);
  const totalLabel = text(properties["totalLabel"]);
  if (total || totalLabel) {
    const sum = element(document, "p", "ui-action-bar__sum");
    if (total) {
      const strong = document.createElement("strong");
      strong.textContent = total;
      sum.append(strong);
    }
    if (totalLabel) {
      const meta = element(document, "span", "ui-money-metadata");
      meta.textContent = totalLabel;
      sum.append(meta);
    }
    bar.append(sum);
  }
  const actions = single(relationships, "child");
  if (actions) {
    if (actions.nodeType === 1) (actions as Element).classList.add("unit-actions");
    bar.append(actions);
  }
  return bar;
}

/** A photo URL the host resource policy approves, or undefined; a refused URL is never rendered. */
function approvedImage(resourcePolicy: BasicResourcePolicy | undefined, url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  const approved = resourcePolicy?.({ kind: "image", url });
  return approved === undefined || approved.trim() === "" ? undefined : approved;
}

function asElement(node: Node | undefined): Element | undefined {
  return node !== undefined && node.nodeType === 1 ? (node as Element) : undefined;
}

/** Sends the same view-unit event as the card's View apartment button; without one the link keeps its real href. */
function openStayFrom(link: Element | null, view: Element | null | undefined): void {
  if (!link || !view) return;
  link.addEventListener("click", (event) => {
    event.preventDefault();
    (view as HTMLButtonElement).click();
  });
}

/**
 * One search result as the search page's `.ui-stay-card` (stayCardInnerHtml). The Weaver View button takes the place of
 * the kit's link and the title link opens the stay through it; the href stays `/stays/<unitId>` for no-JS and new tabs.
 */
function renderStayCard(resourcePolicy: BasicResourcePolicy | undefined) {
  return ({ document, properties, relationships }: WebComponentRenderInput): Node => {
    const unitId = text(properties["unitId"]) ?? "";
    const photoSrc = approvedImage(resourcePolicy, text(properties["photoUrl"]));
    const photoCount = properties["photoCount"];
    const deposit = text(properties["deposit"]);
    const parts: StayCardParts = {
      ...(properties["demo"] === true ? { demoListing: true } : {}),
      href: `/stays/${encodeURIComponent(unitId)}`,
      title: text(properties["title"]) ?? "",
      where: text(properties["where"]) ?? "",
      facts: tiles(properties["facts"]),
      total: text(properties["total"]) ?? "",
      totalLabel: text(properties["totalLabel"]) ?? "",
      ...(deposit === undefined ? {} : { deposit }),
      ...(photoSrc === undefined ? {} : { photoSrc }),
      ...(typeof photoCount === "number" ? { photoCount } : {}),
    };
    const card = element(document, "article", "stay-card ui-stay-card");
    card.setAttribute("role", "listitem");
    card.setAttribute("data-unit-id", unitId);
    card.append(fromKit(document, stayCardInnerHtml(parts)));
    const view = asElement(single(relationships, "view"));
    const anchor = card.querySelector(".ui-stay-card__view");
    if (view && anchor) {
      view.classList.add("ui-button", "ui-button--primary", "ui-button--block", "ui-stay-card__view");
      anchor.replaceWith(view);
    } else anchor?.remove();
    openStayFrom(card.querySelector(".ui-stay-card__title a"), view);
    // The fit reason, then the server's other caption lines (amenity highlights, Extended Stay lines, budget note).
    const fit = asElement(single(relationships, "fit"));
    fit?.classList.add("stay-card__fit");
    const after = [...(fit ? [fit] : []), ...children(relationships, "notes")];
    if (after.length > 0) card.querySelector(".ui-stay-card__facts")?.after(...after);
    // Compare follows View apartment (issue 13b).
    const compare = asElement(single(relationships, "compare"));
    if (compare) {
      compare.classList.add("stay-card__compare", "ui-link");
      (card.querySelector(".ui-stay-card__body") ?? card).append(compare);
    }
    return card;
  };
}

/**
 * The result list: phone result rows, "See both side by side" for exactly two results, then the grid of cards. Each row
 * opens the card whose `data-unit-id` matches its own unitId, never by position. The wrapper is `display: contents`.
 */
function renderStayResults(resourcePolicy: BasicResourcePolicy | undefined, onCompareBoth: (() => void) | undefined) {
  return ({ document, properties, relationships }: WebComponentRenderInput): Node => {
    const results = element(document, "div", "stay-results");
    const cards = children(relationships, "cards");
    const rows = list(properties["rows"]).flatMap((item) => {
      const row = record(item);
      const unitId = text(row?.["unitId"]);
      const title = text(row?.["title"]);
      const total = text(row?.["total"]);
      const totalLabel = text(row?.["totalLabel"]);
      if (!unitId || !title || !total || !totalLabel) return [];
      const photoSrc = approvedImage(resourcePolicy, text(row?.["photoUrl"]));
      return [{ unitId, parts: { href: `/stays/${encodeURIComponent(unitId)}`, title, where: "", facts: [], total, totalLabel, ...(photoSrc === undefined ? {} : { photoSrc }) } satisfies StayCardParts }];
    });
    if (rows.length > 0) {
      const rowList = element(document, "div", "ui-result-rows");
      rowList.setAttribute("role", "list");
      rowList.setAttribute("aria-label", "Stays for your search");
      for (const row of rows) {
        const link = fromKit(document, resultRowPartsHtml(row.parts)).firstElementChild;
        if (!link) continue;
        const card = cards.map(asElement).find((candidate) => candidate?.getAttribute("data-unit-id") === row.unitId);
        openStayFrom(link, card?.querySelector(".ui-stay-card__view"));
        const item = document.createElement("div");
        item.setAttribute("role", "listitem");
        item.append(link);
        rowList.append(item);
      }
      results.append(rowList);
      // "Both" only when there are exactly two; with more, "See all results" leads to each stay's Compare.
      if (rows.length === 2 && onCompareBoth) {
        const both = element(document, "button", "ui-link ui-result-rows__compare");
        both.setAttribute("type", "button");
        both.append(fromKit(document, `See both side by side${icon("arrow-right")}`));
        both.addEventListener("click", () => onCompareBoth());
        results.append(both);
      }
    }
    const grid = element(document, "div", "stay-grid");
    grid.setAttribute("role", "list");
    grid.setAttribute("aria-label", "Stay search results");
    grid.append(...cards);
    results.append(grid);
    return results;
  };
}

/**
 * Weaver catalogues issue 07: the comparison as a table (`.ui-compare[role=table]`), the stays as columns and one row per
 * attribute; the kit CSS stacks it in a narrow column (ADR 0078). Every row draws exactly one cell per head, so a
 * missing value is an empty cell in its own column and never shifts later cells. The View buttons sit in the last row.
 */
function renderStayComparison({ document, properties, relationships }: WebComponentRenderInput): Node {
  const heads = texts(properties["heads"]);
  const table = element(document, "div", "ui-compare");
  table.setAttribute("role", "table");
  table.setAttribute("aria-label", "Compare stays");
  const line = (modifier: string): HTMLElement => {
    const row = element(document, "div", `ui-compare__row compare-row${modifier === "" ? "" : ` ${modifier}`}`);
    row.setAttribute("role", "row");
    table.append(row);
    return row;
  };
  const head = line("ui-compare__row--head");
  const corner = document.createElement("div");
  corner.setAttribute("role", "columnheader");
  head.append(corner);
  for (const title of heads) {
    const heading = element(document, "div", "ui-compare__head");
    heading.setAttribute("role", "columnheader");
    heading.textContent = title;
    head.append(heading);
  }
  for (const item of list(properties["rows"])) {
    const row = record(item);
    const key = text(row?.["key"]);
    if (!key) continue;
    const attribute = line("");
    const label = element(document, "h3", "ui-compare__key");
    label.setAttribute("role", "rowheader");
    label.textContent = key;
    attribute.append(label);
    const cells = list(row?.["cells"]);
    heads.forEach((title, index) => {
      const values = record(cells[index]);
      const cell = element(document, "div", "compare-cell ui-compare__cell");
      cell.setAttribute("role", "cell");
      // Each cell names its stay, so a stacked cell still says what it describes.
      const unit = element(document, "small", "compare-cell__unit");
      unit.textContent = text(values?.["unit"]) ?? title;
      const value = document.createElement("p");
      value.textContent = typeof values?.["value"] === "string" ? values["value"] : "";
      cell.append(unit, value);
      attribute.append(cell);
    });
  }
  const actions = children(relationships, "actions");
  if (actions.length > 0) {
    const row = line("ui-compare__row--actions");
    row.append(document.createElement("div"));
    for (const action of actions) {
      asElement(action)?.classList.add("ui-compare__cell");
      row.append(action);
    }
  }
  return table;
}

/** One end of the stay ticket from its typed props; undefined when the day or the date is missing. */
function ticketEnd(value: HydratedValue | undefined): TicketDatePart | undefined {
  const end = record(value);
  const day = text(end?.["day"]);
  const date = text(end?.["date"]);
  if (day === undefined || date === undefined) return undefined;
  const datetime = text(end?.["datetime"]);
  return { day, date, ...(datetime === undefined ? {} : { datetime }) };
}

/**
 * Weaver catalogues issue 04 (ADR 0102): the kit's ticket from typed props; every value is escaped by the kit (ADR 0075);
 * no amounts are computed here (ADR 0077).
 */
function renderStayTicket({ document, properties }: WebComponentRenderInput): Node {
  const title = text(properties["title"]);
  const checkIn = ticketEnd(properties["checkIn"]);
  const checkOut = ticketEnd(properties["checkOut"]);
  const foot = text(properties["foot"]);
  if (title === undefined || checkIn === undefined || checkOut === undefined || foot === undefined) {
    return document.createElement("div");
  }
  const parts: TicketParts = { title, checkIn, checkOut, foot };
  return fromKit(document, ticketHtml(parts)).firstElementChild ?? document.createElement("div");
}

/**
 * Weaver catalogues issue 04 (ADR 0102): the kit's price breakdown from typed props; every value is escaped by the kit
 * (ADR 0075); no amounts are computed here (ADR 0077).
 */
function renderPriceBreakdown({ document, properties }: WebComponentRenderInput): Node {
  const parts: BreakdownParts = {
    ...(properties["depositCollected"] === true ? { depositCollected: true } : {}),
    ...optionalText("condition", text(properties["condition"])),
    ...optionalText("total", text(properties["total"])),
    ...optionalText("totalLabel", text(properties["totalLabel"])),
    ...optionalText("deposit", text(properties["deposit"])),
    ...optionalText("due", text(properties["due"])),
    ...optionalText("thisPayment", text(properties["thisPayment"])),
    ...optionalText("paid", text(properties["paid"])),
    ...optionalText("next", text(properties["next"])),
  };
  return fromKit(document, breakdownHtml(parts)).firstElementChild ?? document.createElement("div");
}

function optionalText<K extends keyof BreakdownParts>(key: K, value: string | undefined): Partial<Pick<BreakdownParts, K>> {
  return value === undefined ? {} : ({ [key]: value } as Pick<BreakdownParts, K>);
}

/** Every typed component of the `shortlet-*` catalogues, bound to the host's resource policy. */
export function createShortletRenderers(options: ShortletRendererOptions = {}): readonly RendererRegistration[] {
  const catalogId = SHORTLET_DISCOVERY_CATALOG_ID;
  return [
    { catalogId: SHORTLET_BOOKING_CATALOG_ID, component: STAY_TICKET_COMPONENT, render: renderStayTicket },
    { catalogId: SHORTLET_BOOKING_CATALOG_ID, component: PRICE_BREAKDOWN_COMPONENT, render: renderPriceBreakdown },
    { catalogId, component: UNIT_DETAIL_COMPONENT, render: renderUnitDetail },
    { catalogId, component: UNIT_GALLERY_COMPONENT, render: renderUnitGallery(options.resourcePolicy) },
    { catalogId, component: UNIT_DETAIL_SHEET_COMPONENT, render: renderUnitDetailSheet },
    { catalogId, component: UNIT_ACTION_BAR_COMPONENT, render: renderUnitActionBar },
    { catalogId, component: STAY_CARD_COMPONENT, render: renderStayCard(options.resourcePolicy) },
    { catalogId, component: STAY_RESULTS_COMPONENT, render: renderStayResults(options.resourcePolicy, options.onCompareBoth) },
    { catalogId, component: STAY_COMPARISON_COMPONENT, render: renderStayComparison },
  ];
}
