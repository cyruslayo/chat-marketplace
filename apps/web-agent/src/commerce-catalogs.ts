import { createBasicCatalogV091Registration, type CatalogRegistration, type JsonObject } from "@cylayo/weaver-core";

/** Owner-approved platform-controlled commerce namespace (ADR 0073). */
export const COMMERCE_CATALOG_NAMESPACE = "urn:chat-marketplace:commerce";
export const COMMERCE_DISCOVERY_CATALOG_ID = `${COMMERCE_CATALOG_NAMESPACE}/discovery/v1`;
export const COMMERCE_CART_CATALOG_ID = `${COMMERCE_CATALOG_NAMESPACE}/cart/v1`;
export const COMMERCE_ORDER_CATALOG_ID = `${COMMERCE_CATALOG_NAMESPACE}/order/v1`;

function commerceCatalog(catalogId: string): CatalogRegistration {
  const schema = structuredClone(createBasicCatalogV091Registration().schema);
  schema["$id"] = catalogId;
  schema["catalogId"] = catalogId;
  return { catalogId, schema: schema as JsonObject };
}

export const COMMERCE_DISCOVERY_CATALOG = commerceCatalog(COMMERCE_DISCOVERY_CATALOG_ID);
export const COMMERCE_CART_CATALOG = commerceCatalog(COMMERCE_CART_CATALOG_ID);
export const COMMERCE_ORDER_CATALOG = commerceCatalog(COMMERCE_ORDER_CATALOG_ID);
export const COMMERCE_CATALOGS = [COMMERCE_DISCOVERY_CATALOG, COMMERCE_CART_CATALOG, COMMERCE_ORDER_CATALOG] as const;
