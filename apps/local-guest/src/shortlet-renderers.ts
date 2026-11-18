import type { HydratedValue } from "@cylayo/weaver-core";
import type {
  BasicResourcePolicy,
  RendererRegistration,
  WebComponentRenderInput,
  WebRenderedRelationship,
} from "@cylayo/weaver-web";
import {
  SHORTLET_DISCOVERY_CATALOG_ID,
  UNIT_ACTION_BAR_COMPONENT,
  UNIT_DETAIL_COMPONENT,
  UNIT_DETAIL_SHEET_COMPONENT,
  UNIT_GALLERY_COMPONENT,
} from "../../web-agent/src/shortlet-catalogs.js";
import {
  breakdownHtml,
  demoListingChipHtml,
  unitAboutHtml,
  unitLocationHtml,
  unitTilesHtml,
  unitTitleHtml,
} from "./guest-kit.js";
import { buildListingGallery } from "./listing-gallery.js";

/**
 * Trusted renderers for the typed `shortlet-*` catalogue components (ADR 0102). Each renders platform-owned guest-kit
 * markup from schema-validated props, so the chat and the standalone page share one markup source. Every prop value is
 * escaped by the kit helpers; no agent HTML, script or URL reaches the DOM unescaped (ADR 0073, ADR 0075). Photo URLs
 * pass the host resource policy, and a refused URL is dropped rather than rendered.
 */
export interface ShortletRendererOptions {
  readonly resourcePolicy?: BasicResourcePolicy;
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
      const url = text(photo?.["url"]);
      const approved = url === undefined ? undefined : resourcePolicy?.({ kind: "image", url });
      if (approved === undefined || approved.trim() === "") return [];
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
  const bar = element(document, "div", "ui-action-bar unit-action-bar");
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

/** Every typed component of the `shortlet-*` catalogues, bound to the host's resource policy. */
export function createShortletRenderers(options: ShortletRendererOptions = {}): readonly RendererRegistration[] {
  const catalogId = SHORTLET_DISCOVERY_CATALOG_ID;
  return [
    { catalogId, component: UNIT_DETAIL_COMPONENT, render: renderUnitDetail },
    { catalogId, component: UNIT_GALLERY_COMPONENT, render: renderUnitGallery(options.resourcePolicy) },
    { catalogId, component: UNIT_DETAIL_SHEET_COMPONENT, render: renderUnitDetailSheet },
    { catalogId, component: UNIT_ACTION_BAR_COMPONENT, render: renderUnitActionBar },
  ];
}
