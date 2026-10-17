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

function shortletCatalog(catalogId: string): CatalogRegistration {
  const basic = createBasicCatalogV091Registration();
  const schema = structuredClone(basic.schema);
  schema["$id"] = catalogId;
  schema["catalogId"] = catalogId;
  // Deliberately no custom components until issues 04–07.
  return { catalogId, schema: defineShortletCatalog(schema) };
}

export const SHORTLET_DISCOVERY_CATALOG = shortletCatalog(SHORTLET_DISCOVERY_CATALOG_ID);
export const SHORTLET_BOOKING_CATALOG = shortletCatalog(SHORTLET_BOOKING_CATALOG_ID);
