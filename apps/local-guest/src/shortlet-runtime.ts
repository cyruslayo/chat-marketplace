import type { WeaverRuntimeSafetyConfig } from "@cylayo/weaver-core";
import {
  createBasicWebRuntime,
  type BasicResourcePolicy,
  type BasicWebRuntime,
  type WebServerEventHandoff,
} from "@cylayo/weaver-web";
import {
  SHORTLET_BOOKING_CATALOG,
  SHORTLET_DISCOVERY_CATALOG,
} from "../../web-agent/src/shortlet-catalogs.js";
import { createBasicCatalogRendererRegistrations } from "@cylayo/weaver-web";
import { SHORTLET_RENDERERS } from "./shortlet-renderers.js";
import { COMMERCE_CATALOGS } from "../../web-agent/src/commerce-catalogs.js";

export interface ShortletWebRuntimeOptions {
  readonly onServerEvent?: (event: WebServerEventHandoff) => void;
  readonly resourcePolicy?: BasicResourcePolicy;
  readonly safety?: WeaverRuntimeSafetyConfig;
  /**
   * Registers the commerce catalogues (ADR 0103). Off by default, so the registry refuses commerce surfaces unless the
   * caller turns commerce on with the COMMERCE_ENABLED switch (ADR 0104). Shortlet catalogues are always registered.
   */
  readonly commerce?: boolean;
}

export function createShortletWebRuntime(options: ShortletWebRuntimeOptions = {}): BasicWebRuntime {
  const resourcePolicy = options.resourcePolicy ?? (() => undefined);
  // ADR 0103 / ADR 0104: the commerce catalogues and their renderers exist only when commerce is enabled.
  const commerceCatalogs = options.commerce === true ? COMMERCE_CATALOGS : [];
  const created = createBasicWebRuntime({
    additionalCatalogs: [SHORTLET_DISCOVERY_CATALOG, SHORTLET_BOOKING_CATALOG, ...commerceCatalogs],
    additionalRenderers: [
      ...createBasicCatalogRendererRegistrations({ catalogId: SHORTLET_DISCOVERY_CATALOG.catalogId, resourcePolicy }),
      ...createBasicCatalogRendererRegistrations({ catalogId: SHORTLET_BOOKING_CATALOG.catalogId, resourcePolicy }),
      ...commerceCatalogs.flatMap(({ catalogId }) => createBasicCatalogRendererRegistrations({ catalogId, resourcePolicy })),
      ...SHORTLET_RENDERERS,
    ],
    ...(options.safety === undefined ? {} : { runtime: { safety: options.safety } }),
    basic: { resourcePolicy },
    ...(options.onServerEvent === undefined ? {} : { rendering: { onServerEvent: options.onServerEvent } }),
  });
  if (!created.ok) throw new Error("Unable to create the Shortlet Weaver web runtime", { cause: created.error });
  return created.value;
}
