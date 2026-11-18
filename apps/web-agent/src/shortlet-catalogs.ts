import {
  createBasicCatalogV091Registration,
  type CatalogRegistration,
  type JsonObject,
} from "@cylayo/weaver-core";

/** Owner-approved platform URN namespace; it claims no public domain. */
export const SHORTLET_CATALOG_NAMESPACE = "urn:chat-marketplace:shortlet";
export const SHORTLET_DISCOVERY_CATALOG_ID = `${SHORTLET_CATALOG_NAMESPACE}/discovery/v1`;
export const SHORTLET_BOOKING_CATALOG_ID = `${SHORTLET_CATALOG_NAMESPACE}/booking/v1`;

export function defineShortletCatalog<TSchema extends JsonObject>(schema: TSchema): TSchema {
  // Replace with Weaver's defineCatalog when a published release includes it (not present in 0.2.1).
  return schema;
}

/**
 * Weaver catalogues issue 05 (ADR 0102): the typed unit detail components of `shortlet-discovery/v1`. Every prop is a
 * display string the server formatted (ADR 0077); none is a price, deadline or rule the client could compute.
 */
export const UNIT_DETAIL_COMPONENT = "UnitDetail";
export const UNIT_GALLERY_COMPONENT = "UnitGallery";
export const UNIT_DETAIL_SHEET_COMPONENT = "UnitDetailSheet";
export const UNIT_ACTION_BAR_COMPONENT = "UnitActionBar";

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

const PHOTO: JsonObject = {
  type: "object",
  properties: { url: TEXT, alt: TEXT },
  required: ["url", "alt"],
  additionalProperties: false,
};

const UNIT_DETAIL_COMPONENTS: Readonly<Record<string, JsonObject>> = {
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

function shortletCatalog(catalogId: string, components: Readonly<Record<string, JsonObject>> = {}): CatalogRegistration {
  const basic = createBasicCatalogV091Registration();
  const schema = structuredClone(basic.schema);
  schema["$id"] = catalogId;
  schema["catalogId"] = catalogId;
  return { catalogId, schema: defineShortletCatalog(withComponents(schema, components)) };
}

export const SHORTLET_DISCOVERY_CATALOG = shortletCatalog(SHORTLET_DISCOVERY_CATALOG_ID, UNIT_DETAIL_COMPONENTS);
// Issue 04 adds StayTicket and PriceBreakdown to the booking catalogue.
export const SHORTLET_BOOKING_CATALOG = shortletCatalog(SHORTLET_BOOKING_CATALOG_ID);
