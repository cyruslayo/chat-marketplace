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
}

export function createShortletWebRuntime(options: ShortletWebRuntimeOptions = {}): BasicWebRuntime {
  const resourcePolicy = options.resourcePolicy ?? (() => undefined);
  const created = createBasicWebRuntime({
    additionalCatalogs: [SHORTLET_DISCOVERY_CATALOG, SHORTLET_BOOKING_CATALOG, ...COMMERCE_CATALOGS],
    additionalRenderers: [
      ...createBasicCatalogRendererRegistrations({ catalogId: SHORTLET_DISCOVERY_CATALOG.catalogId, resourcePolicy }),
      ...createBasicCatalogRendererRegistrations({ catalogId: SHORTLET_BOOKING_CATALOG.catalogId, resourcePolicy }),
      ...COMMERCE_CATALOGS.flatMap(({ catalogId }) => createBasicCatalogRendererRegistrations({ catalogId, resourcePolicy })),
      ...SHORTLET_RENDERERS,
    ],
    ...(options.safety === undefined ? {} : { runtime: { safety: options.safety } }),
    basic: { resourcePolicy },
    ...(options.onServerEvent === undefined ? {} : { rendering: { onServerEvent: options.onServerEvent } }),
  });
  if (!created.ok) throw new Error("Unable to create the Shortlet Weaver web runtime", { cause: created.error });
  return created.value;
}
