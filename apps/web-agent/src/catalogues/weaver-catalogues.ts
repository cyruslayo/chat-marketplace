import {
  createBasicCatalogV091Registration,
  type CatalogRegistration,
  type JsonObject as WeaverJsonObject,
} from "@cylayo/weaver-core";
import {
  composeCatalogueSchema,
  defineCatalogueManifest,
  type CatalogueManifest,
  type ComposedCatalogue,
  type JsonObject,
} from "../../../../packages/surface-kit/src/index.js";

/**
 * The schema adapter between the Weaver-free surface-kit and Weaver 0.2.1 (ADR 0108 decision 5, ADR 0081). One of the
 * two modules that pair the library with Weaver. No DOM, so it is safe on the server and in the client bundle.
 */
export interface WeaverCatalogue {
  readonly composed: ComposedCatalogue;
  readonly registration: CatalogRegistration;
}

/** The composed schema is plain JSON that the library only reads, so it is exactly Weaver's `JsonObject`. */
function asWeaverSchema(schema: JsonObject): WeaverJsonObject {
  return schema as WeaverJsonObject;
}

/** Composes a manifest over the Weaver Basic Catalog (A2UI v0.9.1) and returns the library result and the Weaver registration. */
export function composeWeaverCatalogue(manifest: CatalogueManifest): WeaverCatalogue {
  const basic = createBasicCatalogV091Registration();
  const composed = composeCatalogueSchema(manifest, basic.schema as JsonObject);
  return { composed, registration: { catalogId: manifest.id, schema: asWeaverSchema(composed.schema) } };
}

/**
 * Wraps an existing Basic-clone `CatalogRegistration`, such as commerce's, as a `ComposedCatalogue` with no components,
 * so one runtime factory can register it beside composed catalogues. The registration is read, never modified.
 */
export function basicEquivalentCatalogue(registration: CatalogRegistration): ComposedCatalogue {
  const namespace = /^urn:chat-marketplace:([a-z][a-z0-9-]*)\//.exec(registration.catalogId)?.[1];
  if (namespace === undefined) throw new Error(`Catalogue id is outside the platform namespace: ${registration.catalogId}`);
  const manifest = defineCatalogueManifest({
    id: registration.catalogId,
    owner: namespace,
    base: "basic/v0.9.1",
    components: {},
    actions: [],
  });
  return { manifest, schema: registration.schema as JsonObject, components: [] };
}
