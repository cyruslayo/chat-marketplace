import assert from "node:assert/strict";
import test from "node:test";
import { createShortletWebRuntime } from "../apps/local-guest/src/shortlet-runtime.js";
import { commerceCartSurface, commerceDiscoverySurface } from "../apps/web-agent/src/commerce-presentation.js";

// ADR 0103 with the ADR 0104 switch: the commerce catalogues are registered only when commerce is enabled. With commerce
// off, a commerce surface is refused by the registry and the shortlet runtime is unchanged.

function processOutcomes(messages: readonly unknown[], runtime: ReturnType<typeof createShortletWebRuntime>): boolean[] {
  return messages.map((message) => runtime.runtime.process(message as never).ok);
}

test("ADR 0104: with commerce off (default) the commerce catalogue is not registered, so a commerce surface is refused", () => {
  const outcomes = processOutcomes(commerceDiscoverySurface([], "commerce-discovery"), createShortletWebRuntime());
  assert.equal(outcomes[0], false, "the createSurface for an unregistered commerce catalogue must be refused");
});

test("ADR 0104: with commerce explicitly off the commerce catalogue is not registered", () => {
  const outcomes = processOutcomes(commerceCartSurface({ storeId: "s", storeName: "Store", lines: [] }, "commerce-cart"), createShortletWebRuntime({ commerce: false }));
  assert.equal(outcomes[0], false);
});

test("ADR 0103: with commerce on every commerce surface message is accepted and the surface mounts", () => {
  const runtime = createShortletWebRuntime({ commerce: true });
  const messages = [
    ...commerceDiscoverySurface([], "commerce-discovery"),
    ...commerceCartSurface({ storeId: "s", storeName: "Store", lines: [] }, "commerce-cart"),
  ];
  assert.ok(processOutcomes(messages, runtime).every(Boolean));
});
