import assert from "node:assert/strict";
import test from "node:test";
import { assertSurfaceReferencesResolve } from "./helpers/a2ui-surface-integrity.js";
import { commerceCartSurface, commerceCheckoutSurface, commerceDiscoverySurface, commerceOrderSurface, type CommerceCheckoutPresentation, type CommerceCheckoutStatus } from "../apps/web-agent/src/commerce-presentation.js";

const checkout: Omit<CommerceCheckoutPresentation, "status"> = {
  proposalId: "proposal-1",
  taskId: "task-1",
  expectedVersion: 1,
  cartVersion: "cart-v1",
  storeName: "Harbour Goods",
  lines: [{ productName: "Northstar Tote", quantity: 2, priceKobo: 850000 }],
  subtotalKobo: 1700000,
  shippingFeeKobo: 120000,
  totalKobo: 1820000,
};

// Every status the checkout command path can project: proposed, dispatching, payment_unavailable, payment_started.
const checkoutStatuses = ["proposed", "dispatching", "payment_unavailable", "payment_started"] as const;

test("AC3 checkout surface references only emitted components and keeps one root for every checkout status", () => {
  for (const status of checkoutStatuses) {
    assertSurfaceReferencesResolve(commerceCheckoutSurface({ ...checkout, status }, `checkout-${status}`), `checkout ${status}`);
  }
});

test("AC3 discovery, cart and order surfaces reference only emitted components and keep one root", () => {
  assertSurfaceReferencesResolve(commerceDiscoverySurface([{ offerId: "offer-1", productName: "Northstar Tote", category: "Accessories", description: "Cotton tote.", priceKobo: 850000, stock: 18, storeName: "Harbour Goods", merchantName: "Northstar Trading" }], "discovery"), "discovery");
  assertSurfaceReferencesResolve(commerceDiscoverySurface([], "discovery-empty"), "empty discovery");
  assertSurfaceReferencesResolve(commerceCartSurface({ storeId: "store-1", storeName: "Harbour Goods", lines: [{ productName: "Northstar Tote", quantity: 2, priceKobo: 850000 }] }, "cart"), "cart");
  assertSurfaceReferencesResolve(commerceOrderSurface({ publicCode: "ORD-1", status: "Pending Verification", updatedAt: "2026-10-18" }, "order"), "order");
});

test("AC3 surface reference assertion rejects a dangling child reference", () => {
  const dangling = [
    { version: "v0.9.1", createSurface: { surfaceId: "dangling", catalogId: "urn:test" } },
    { version: "v0.9.1", updateComponents: { surfaceId: "dangling", components: [{ id: "root", component: "Column", children: ["title", "missing-label"] }, { id: "title", component: "Text", text: "Title" }] } },
  ];
  assert.throws(() => assertSurfaceReferencesResolve(dangling, "dangling"), /references missing component missing-label/);
});

test("AC3 surface reference assertion rejects a component rendered under two parents", () => {
  const duplicated = [
    { version: "v0.9.1", createSurface: { surfaceId: "duplicated", catalogId: "urn:test" } },
    { version: "v0.9.1", updateComponents: { surfaceId: "duplicated", components: [{ id: "root", component: "Column", children: ["label", "button"] }, { id: "button", component: "Button", child: "label" }, { id: "label", component: "Text", text: "Confirm" }] } },
  ];
  assert.throws(() => assertSurfaceReferencesResolve(duplicated, "duplicated"), /label must be referenced by exactly one parent/);
});

test("AC4 each non-proposed checkout status renders only its own existing copy", () => {
  const copy = {
    payment_unavailable: "Payment unavailable. No order or payment was created.",
    payment_started: "The platform accepted the payment-start command.",
    dispatching: "This checkout command is already being processed.",
  } as const;
  for (const status of Object.keys(copy) as Array<keyof typeof copy>) {
    const text = JSON.stringify(commerceCheckoutSurface({ ...checkout, status }, `copy-${status}`));
    assert.ok(text.includes(copy[status]), `${status} renders its own copy`);
    for (const other of Object.keys(copy) as Array<keyof typeof copy>) {
      if (other !== status) assert.equal(text.includes(copy[other]), false, `${status} does not render the ${other} copy`);
    }
  }
});

test("AC4 payment_started never renders the payment-unavailable copy", () => {
  const text = JSON.stringify(commerceCheckoutSurface({ ...checkout, status: "payment_started" }, "copy-started"));
  assert.doesNotMatch(text, /Payment unavailable/);
});

test("AC3 surface reference assertion rejects any component that references root as a child", () => {
  const referencesRoot = [
    { version: "v0.9.1", createSurface: { surfaceId: "root-child", catalogId: "urn:test" } },
    { version: "v0.9.1", updateComponents: { surfaceId: "root-child", components: [{ id: "root", component: "Column", children: ["title"] }, { id: "title", component: "Column", children: ["root"] }] } },
  ];
  assert.throws(() => assertSurfaceReferencesResolve(referencesRoot, "root-child"), /no component may reference root as a child/);
});

test("AC4 checkout surface rejects a stored status with no approved copy instead of rendering a blank confirmation", () => {
  const storedStatus = "shipped" as unknown as CommerceCheckoutStatus;
  assert.throws(() => commerceCheckoutSurface({ ...checkout, status: storedStatus }, "copy-unknown"), /no approved copy/);
});
