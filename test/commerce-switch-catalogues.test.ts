import assert from "node:assert/strict";
import test from "node:test";
import { createGuestWebRuntime, createShortletWebRuntime } from "../apps/local-guest/src/shortlet-runtime.js";
import { basicEquivalentCatalogue } from "../apps/web-agent/src/catalogues/weaver-catalogues.js";
import { COMMERCE_CATALOGS } from "../apps/web-agent/src/commerce-catalogs.js";
import { SHORTLET_COMPOSED_CATALOGUES } from "../apps/web-agent/src/shortlet-catalogs.js";
import { commerceCartSurface, commerceDiscoverySurface } from "../apps/web-agent/src/commerce-presentation.js";

// ADR 0103 with the ADR 0104 switch: the commerce catalogues are registered only when commerce is enabled. With commerce
// off, a commerce surface is refused by the registry and the shortlet runtime is unchanged. Where commerce is on, the
// caller passes the commerce catalogues explicitly (ADR 0108 decision 4); the runtime has no `commerce` flag.

function processOutcomes(messages: readonly unknown[], runtime: ReturnType<typeof createGuestWebRuntime>): boolean[] {
  return messages.map((message) => runtime.runtime.process(message as never).ok);
}

test("ADR 0104: with commerce off (default) the commerce catalogue is not registered, so a commerce surface is refused", () => {
  const outcomes = processOutcomes(commerceDiscoverySurface([], "commerce-discovery"), createShortletWebRuntime());
  assert.equal(outcomes[0], false, "the createSurface for an unregistered commerce catalogue must be refused");
});

test("ADR 0104: with no commerce catalogues passed the commerce catalogue is not registered", () => {
  const outcomes = processOutcomes(commerceCartSurface({ storeId: "s", storeName: "Store", lines: [] }, "commerce-cart"), createShortletWebRuntime());
  assert.equal(outcomes[0], false);
});

test("ADR 0103: with commerce on every commerce surface message is accepted and the surface mounts", () => {
  const runtime = createGuestWebRuntime({ catalogues: [...SHORTLET_COMPOSED_CATALOGUES, ...COMMERCE_CATALOGS.map(basicEquivalentCatalogue)] });
  const messages = [
    ...commerceDiscoverySurface([], "commerce-discovery"),
    ...commerceCartSurface({ storeId: "s", storeName: "Store", lines: [] }, "commerce-cart"),
  ];
  assert.ok(processOutcomes(messages, runtime).every(Boolean));
});
