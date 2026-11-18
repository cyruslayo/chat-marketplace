import type { WeaverRuntimeSafetyConfig } from "@cylayo/weaver-core";
import {
  createBasicWebRuntime,
  type BasicResourcePolicy,
  type BasicWebRuntime,
  type RendererRegistration,
  type WebServerEventHandoff,
} from "@cylayo/weaver-web";
import {
  catalogRegistrationFor,
  catalogueIds,
  type ComposedCatalogue,
} from "../../web-agent/src/catalogues/weaver-catalogues.js";
import { SHORTLET_COMPOSED_CATALOGUES } from "../../web-agent/src/shortlet-catalogs.js";
import { rendererRegistrationsFor } from "./catalogue-renderers.js";
import { createShortletRenderers } from "./shortlet-renderers.js";

export interface ShortletWebRuntimeOptions {
  readonly onServerEvent?: (event: WebServerEventHandoff) => void;
  readonly resourcePolicy?: BasicResourcePolicy;
  readonly safety?: WeaverRuntimeSafetyConfig;
  /** Weaver catalogues issue 06: the guest browser's "See both side by side" handler (client.ts `compareBoth`). */
  readonly onCompareBoth?: () => void;
}

export interface GuestWebRuntimeOptions extends ShortletWebRuntimeOptions {
  /**
   * The catalogues of the registered packs, from one list (ADR 0108 decision 4, ADR 0107 decision 10). The runtime
   * registers exactly these and their renderers; a catalogue of an unregistered or parked pack is simply absent, so its
   * surfaces are refused (ADR 0104). Commerce is no longer a runtime flag: a host that enables commerce passes the
   * commerce catalogues here explicitly.
   */
  readonly catalogues: readonly ComposedCatalogue[];
}

export function createGuestWebRuntime(options: GuestWebRuntimeOptions): BasicWebRuntime {
  // Throws on a duplicate id, so one id never has two registrations.
  catalogueIds(options.catalogues);
  const resourcePolicy = options.resourcePolicy ?? (() => undefined);
  // ADR 0102 / issue-02 Follow-up C: the nine typed shortlet components keep their trusted host renderers (the same
  // host image policy as Basic Image, plus the "See both side by side" handler); rendererRegistrationsFor overlays them
  // per alias, and any alias without a host renderer falls back to its component's kit html.
  const hostRenderers: readonly RendererRegistration[] = createShortletRenderers({
    resourcePolicy,
    ...(options.onCompareBoth === undefined ? {} : { onCompareBoth: options.onCompareBoth }),
  });
  const created = createBasicWebRuntime({
    additionalCatalogs: options.catalogues.map(catalogRegistrationFor),
    additionalRenderers: options.catalogues.flatMap((composed) => rendererRegistrationsFor(composed, resourcePolicy, hostRenderers)),
    ...(options.safety === undefined ? {} : { runtime: { safety: options.safety } }),
    basic: { resourcePolicy },
    ...(options.onServerEvent === undefined ? {} : { rendering: { onServerEvent: options.onServerEvent } }),
  });
  if (!created.ok) throw new Error("Unable to create the guest Weaver web runtime", { cause: created.error });
  return created.value;
}

/** The shortlet runtime: exactly the shortlet catalogues. Commerce catalogues are passed explicitly where a test needs them (ADR 0104). */
export function createShortletWebRuntime(options: ShortletWebRuntimeOptions = {}): BasicWebRuntime {
  return createGuestWebRuntime({ ...options, catalogues: SHORTLET_COMPOSED_CATALOGUES });
}
