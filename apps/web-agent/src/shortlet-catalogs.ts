import {
  createBasicCatalogV091Registration,
  defineCatalog,
  type A2UIV091CatalogSchema,
  type CatalogDefinition,
  type JsonObject,
} from "@cylayo/weaver-core";

/** Owner-approved platform URN namespace; it claims no public domain. */
export const SHORTLET_CATALOG_NAMESPACE = "urn:chat-marketplace:shortlet";
export const SHORTLET_DISCOVERY_CATALOG_ID = `${SHORTLET_CATALOG_NAMESPACE}/discovery/v1`;
export const SHORTLET_BOOKING_CATALOG_ID = `${SHORTLET_CATALOG_NAMESPACE}/booking/v1`;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Narrows a Basic-derived schema to the catalogue document shape `defineCatalog` takes (Weaver 0.3.0+). `defineCatalog`
 * does not validate; registration does. This check only refuses a document whose identity does not match, fail closed.
 */
function asCatalogSchema(schema: JsonObject, catalogId: string): A2UIV091CatalogSchema {
  const defs = schema["$defs"];
  if (
    schema["$schema"] !== "https://json-schema.org/draft/2020-12/schema" ||
    schema["catalogId"] !== catalogId ||
    !isJsonObject(schema["components"]) ||
    !isJsonObject(defs) ||
    !isJsonObject(defs["theme"])
  ) {
    throw new TypeError(`Catalogue ${catalogId} is not an A2UI v0.9.1 catalogue document`);
  }
  return schema as A2UIV091CatalogSchema;
}

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

const DISCOVERY_COMPONENTS: Readonly<Record<string, JsonObject>> = {
  // The surface root: the unit detail's sections in their fixed order, so the client never searches the DOM for them.
  [UNIT_DETAIL_COMPONENT]: componentSchema(UNIT_DETAIL_COMPONENT, {
    gallery: COMPONENT_ID,
    sheet: COMPONENT_ID,
    amenities: CHILD_LIST,
    supporting: CHILD_LIST,
    actionBar: COMPONENT_ID,
  }, ["gallery", "sheet", "amenities", "supporting", "actionBar"]),
  [UNIT_GALLERY_COMPONENT]: componentSchema(UNIT_GALLERY_COMPONENT, {
    title: TEXT,
    photos: { type: "array", items: PHOTO },
  }, ["title", "photos"]),
  [UNIT_DETAIL_SHEET_COMPONENT]: componentSchema(UNIT_DETAIL_SHEET_COMPONENT, {
    where: TEXT,
    title: TEXT,
    demo: { type: "boolean" },
    tiles: { type: "array", items: TILE, minItems: 1 },
    breakdown: UNIT_BREAKDOWN,
    extended: { type: "array", items: TEXT },
    about: TEXT,
  }, ["where", "title", "tiles"]),
  [UNIT_ACTION_BAR_COMPONENT]: componentSchema(UNIT_ACTION_BAR_COMPONENT, {
    total: TEXT,
    totalLabel: TEXT,
    child: COMPONENT_ID,
  }, ["child"]),
  // Weaver catalogues issue 06: one search result, the search page's `.ui-stay-card`. `view` and `compare` are the Basic
  // Buttons that carry the allow-listed discovery events; `fit` and `notes` are Basic caption Texts the server words.
  [STAY_CARD_COMPONENT]: componentSchema(STAY_CARD_COMPONENT, {
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
  }, ["unitId", "title", "where", "facts", "total", "totalLabel"]),
  // The result list: the phone result rows (each opening its own card by unitId), "See both side by side" for exactly
  // two results, and the grid of StayCards.
  [STAY_RESULTS_COMPONENT]: componentSchema(STAY_RESULTS_COMPONENT, {
    rows: { type: "array", items: RESULT_ROW, minItems: 1 },
    cards: CHILD_LIST,
  }, ["rows", "cards"]),
  // Weaver catalogues issue 07: the side-by-side table, stays as columns and one row per attribute. `actions` are the
  // Basic View Buttons, one per stay in head order. The builder guarantees every row has one cell per head.
  [STAY_COMPARISON_COMPONENT]: componentSchema(STAY_COMPARISON_COMPONENT, {
    heads: { type: "array", items: TEXT, minItems: 1 },
    rows: { type: "array", items: COMPARE_ROW, minItems: 1 },
    actions: CHILD_LIST,
  }, ["heads", "rows"]),
};

const TICKET_DATE: JsonObject = {
  type: "object",
  properties: { day: TEXT, date: TEXT, datetime: TEXT },
  required: ["day", "date"],
  additionalProperties: false,
};

/**
 * Weaver catalogues issue 04 (ADR 0102): the typed components of `shortlet-booking/v1`, mirroring the kit's TicketParts and
 * BreakdownParts. Every value is a display string formatted on the server (ADR 0077); the order is breakdownHtml's (ADR 0015).
 */
const BOOKING_COMPONENTS: Readonly<Record<string, JsonObject>> = {
  [STAY_TICKET_COMPONENT]: componentSchema(STAY_TICKET_COMPONENT, {
    title: TEXT,
    checkIn: TICKET_DATE,
    checkOut: TICKET_DATE,
    foot: TEXT,
  }, ["title", "checkIn", "checkOut", "foot"]),
  [PRICE_BREAKDOWN_COMPONENT]: componentSchema(PRICE_BREAKDOWN_COMPONENT, {
    condition: TEXT,
    total: TEXT,
    totalLabel: TEXT,
    deposit: TEXT,
    depositCollected: { type: "boolean" },
    due: TEXT,
    thisPayment: TEXT,
    paid: TEXT,
    next: TEXT,
  }, []),
};

/** Adds typed components to a Basic-derived schema: both the component table and the `anyComponent` union list them. */
function withComponents(schema: JsonObject, components: Readonly<Record<string, JsonObject>>): JsonObject {
  const table = schema["components"] as JsonObject;
  const anyComponent = (schema["$defs"] as JsonObject)["anyComponent"] as JsonObject;
  const oneOf = anyComponent["oneOf"] as JsonObject[];
  for (const [name, component] of Object.entries(components)) {
    table[name] = structuredClone(component);
    oneOf.push({ $ref: `#/components/${name}` });
  }
  return schema;
}

function shortletCatalog(catalogId: string, components: Readonly<Record<string, JsonObject>> = {}): CatalogDefinition {
  const basic = createBasicCatalogV091Registration();
  const schema = structuredClone(basic.schema);
  schema["$id"] = catalogId;
  schema["catalogId"] = catalogId;
  return defineCatalog(asCatalogSchema(withComponents(schema, components), catalogId));
}

export const SHORTLET_DISCOVERY_CATALOG = shortletCatalog(SHORTLET_DISCOVERY_CATALOG_ID, DISCOVERY_COMPONENTS);
export const SHORTLET_BOOKING_CATALOG = shortletCatalog(SHORTLET_BOOKING_CATALOG_ID, BOOKING_COMPONENTS);
