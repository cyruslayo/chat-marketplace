import { COMMERCE_TEST_REFERENCE_KEYS } from "./helpers/commerce-database.js";
import { migrateCommerceDatabase } from "./helpers/commerce-database.js";
import assert from "node:assert/strict";
import test from "node:test";
import type { A2UIServerMessage } from "@cylayo/weaver-core";
import { AssistantRuntime } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import { ShortletAssistantRuntime } from "./helpers/assistant-runtime-host.js";
import { TASK_START_EVENT } from "../apps/local-guest/src/assistant/assistant-platform.js";
import { createCommerceAssistantPack } from "../apps/local-guest/src/assistant/commerce-assistant-pack.js";
import { ScriptedAssistantModel } from "../apps/local-guest/src/assistant/scripted-assistant-model.js";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { COMMERCE_CART_CATALOG_ID, COMMERCE_DISCOVERY_CATALOG_ID, COMMERCE_ORDER_CATALOG_ID, } from "../apps/web-agent/src/commerce-catalogs.js";
import { COMMERCE_CHECKOUT_CONFIRM_ACTION } from "../apps/web-agent/src/commerce-presentation.js";
import { createCommercePack } from "../domains/commerce/src/index.js";
import { launchRealBrowser } from "./helpers/chrome-devtools.js";
import { restartFixture } from "./helpers/guest-restart.js";
import { assertSurfaceReferencesResolve, checkoutConfirmContext } from "./helpers/a2ui-surface-integrity.js";

type Browser = Awaited<ReturnType<typeof launchRealBrowser>>;
type Fixture = Awaited<ReturnType<typeof restartFixture>>;
interface SurfaceToRender { readonly surfaceId: string; readonly a2uiMessages: readonly unknown[] }
interface RenderedSurface { readonly text: string; readonly components: number; readonly fallback: boolean; readonly overflow: boolean }

/** Seeds one verified store with a tote (18 in stock) and one active delivery zone. */
function seedBrowserCommerce() {
  const environment = LocalGuestEnvironment.openNode({ databasePath: ":memory:", clock: () => new Date("2026-10-18T10:00:00Z") });
  migrateCommerceDatabase(environment.database);
  const commerce = createCommercePack({ paymentReferenceKeys: COMMERCE_TEST_REFERENCE_KEYS, database: environment.database, clock: environment.clock });
  commerce.directory.createMerchant({ id: "browser-merchant", name: "Harbour Goods Ltd", status: "verified" });
  commerce.directory.createStore({ id: "browser-store", merchantId: "browser-merchant", slug: "harbour-goods", name: "Harbour Goods", status: "active" });
  commerce.catalogue.createProduct({ id: "browser-tote", name: "Visible Northstar Tote", category: "Accessories", description: "Cotton carry bag with reinforced handles." });
  commerce.catalogue.createOffer({ id: "browser-tote-offer", productId: "browser-tote", storeId: "browser-store", priceKobo: 850000, stock: 18 });
  commerce.catalogue.createDeliveryZone({ id: "browser-zone", storeId: "browser-store", city: "Lagos", name: "Lagos Mainland", provider: "Harbour Goods", feeKobo: 120000, isActive: true, sortOrder: 0 });
  return { environment, commerce };
}

function commercePack(environment: ReturnType<typeof seedBrowserCommerce>["environment"]) {
  return createCommerceAssistantPack({ paymentReferenceKeys: COMMERCE_TEST_REFERENCE_KEYS,
    database: environment.database,
    clock: environment.clock,
    audit: environment.audit,
    authorizeOrderStatus: ({ context }) => context.environment.guestPrincipal().id === environment.guestPrincipal().id,
  });
}

/** Renders one projected surface in a real Chromium tab at phone width and returns what the page shows. */
async function renderSurfaceInTab(browser: Browser, fixture: Fixture, surface: SurfaceToRender, summary: string, expected: readonly string[]): Promise<RenderedSurface> {
  const cookie = fixture.cookie.split("=", 2);
  const payload = {
    ok: true,
    timeline: [{ role: "assistant", text: "Commerce result." }],
    tasks: [
      { taskId: "task-1", domain: "shortlet", domainLabel: "Stays", status: "available", active: false },
      { taskId: "task-2", domain: "commerce", domainLabel: "Shopping", status: "active", active: true },
    ],
    verticals: [],
    surfaces: [{ surfaceId: surface.surfaceId, a2uiMessages: surface.a2uiMessages, mode: "inline-surface", status: "active", summary }],
  };
  const tab = await browser.createTab();
  await tab.setViewport(390, 844);
  await tab.setCookie(cookie[0]!, cookie[1]!, fixture.base);
  const dispose = await tab.interceptRequests(async url => new URL(url).pathname === "/api/state"
    ? { status: 200, headers: [{ name: "Content-Type", value: "application/json; charset=utf-8" }], body: Buffer.from(JSON.stringify(payload)) }
    : undefined);
  try {
    await tab.navigate(fixture.base);
    for (const fact of expected) await tab.waitForText(fact, 15_000);
    await tab.waitForSelector(`#active-workspace .weaver-mount [data-a2ui-component]`, 5_000);
    return await tab.evaluate<RenderedSurface>(`(() => {
      const mount = document.querySelector('#active-workspace .weaver-mount');
      return {
        text: mount?.textContent ?? '',
        components: mount?.querySelectorAll('[data-a2ui-component]').length ?? 0,
        fallback: mount?.dataset.renderer === 'fallback' || document.querySelector('#active-workspace [data-status="fallback"]') !== null,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    })()`);
  } finally {
    await dispose();
    await tab.close();
  }
}

function assertRenderedFacts(rendered: RenderedSurface, expected: readonly string[], label: string): void {
  for (const fact of expected) assert.ok(rendered.text.includes(fact), `${label}: missing visible fact ${fact} in ${JSON.stringify(rendered.text)}`);
  assert.ok(rendered.components >= 2, `${label}: rendered ${rendered.components} Weaver nodes`);
  assert.equal(rendered.fallback, false, `${label}: Weaver did not fall back`);
  assert.equal(rendered.overflow, false, `${label}: no horizontal overflow`);
}

test("real Chromium renders visible discovery, cart and order facts from registered commerce catalogues", async () => {
  const { environment, commerce } = seedBrowserCommerce();
  const order = commerce.orders.createOrder({ storeId: "browser-store", deliveryZoneId: "browser-zone", customerName: "Capture Guest", customerPhone: "08000000000", shippingAddress: { street: "Demo Street" }, items: [{ offerId: "browser-tote-offer", quantity: 1 }], submittedTotalKobo: 970000, paymentReference: "browser-fixture-reference" });
  const model = new ScriptedAssistantModel([request => {
    const last = request.history.at(-1);
    if (last?.role !== "user") return null;
    const text = last.text.toLowerCase();
    if (text.includes("cart") || text.includes("add")) return { toolCalls: [{ id: "cart-tool", name: "add_to_store_cart", args: { offerId: "browser-tote-offer", quantity: 2 } }] };
    if (text.includes("order") || text.includes("track")) return { toolCalls: [{ id: "order-tool", name: "get_order_status", args: { publicCode: order.publicCode } }] };
    return { toolCalls: [{ id: "discovery-tool", name: "search_products", args: { query: "visible northstar tote" } }] };
  }]);
  const assistant = new ShortletAssistantRuntime(environment, model, { additionalPacks: [commercePack(environment)] });
  const threadId = `commerce-browser-${crypto.randomUUID()}`;
  await assistant.handleTurn(threadId, "I want to shop");
  assert.equal(assistant.handleAssistantEvent(threadId, TASK_START_EVENT, { domain: "commerce" }).ok, true);

  const turns = [
    { prompt: "Search for the tote", expected: ["Visible Northstar Tote", "₦8,500", "17 available"], catalogId: COMMERCE_DISCOVERY_CATALOG_ID },
    { prompt: "Add this to my cart", expected: ["Visible Northstar Tote", "2 × ₦8,500"], catalogId: COMMERCE_CART_CATALOG_ID },
    { prompt: "Track my order", expected: [order.publicCode, "Pending Verification"], catalogId: COMMERCE_ORDER_CATALOG_ID },
  ] as const;
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    for (const item of turns) {
      const turn = await assistant.handleTurn(threadId, item.prompt);
      assert.equal(turn.ok, true);
      const surface = turn.surfaces?.at(-1);
      assert.ok(surface, `${item.expected.join(", ")}: domain runtime emits a projected surface`);
      const messages = surface.a2uiMessages as readonly A2UIServerMessage[];
      const createMessage = messages.find((message): message is Extract<A2UIServerMessage, { createSurface: unknown }> => "createSurface" in message);
      assert.ok(createMessage);
      assert.equal(createMessage.createSurface.catalogId, item.catalogId);
      const componentMessage = messages.find((message): message is Extract<A2UIServerMessage, { updateComponents: unknown }> => "updateComponents" in message);
      assert.ok(componentMessage);
      assert.ok(componentMessage.updateComponents.components.some(component => component.id === "root"), "Weaver protocol root is present");
      assertSurfaceReferencesResolve(messages, item.catalogId);
      const rendered = await renderSurfaceInTab(browser, fixture, surface, "Commerce facts", item.expected);
      assertRenderedFacts(rendered, item.expected, item.catalogId);
    }
  } finally {
    await browser.close();
    await fixture.close();
    environment.database.close();
  }
});

test("real Chromium renders the proposed checkout and the post-confirm payment-unavailable result without a blank surface", async () => {
  const { environment } = seedBrowserCommerce();
  const model = new ScriptedAssistantModel([request => {
    const last = request.history.at(-1);
    if (last?.role !== "user") return null;
    const text = last.text.toLowerCase();
    if (text.includes("checkout")) return { toolCalls: [{ id: "checkout-tool", name: "propose_checkout", args: { storeId: "browser-store", deliveryZoneId: "browser-zone" } }] };
    return { toolCalls: [{ id: "cart-tool", name: "add_to_store_cart", args: { offerId: "browser-tote-offer", quantity: 2 } }] };
  }]);
  const assistant = new ShortletAssistantRuntime(environment, model, { additionalPacks: [commercePack(environment)] });
  const threadId = `commerce-checkout-browser-${crypto.randomUUID()}`;
  await assistant.handleTurn(threadId, "I want to shop");
  assert.equal(assistant.handleAssistantEvent(threadId, TASK_START_EVENT, { domain: "commerce" }).ok, true);
  assert.equal((await assistant.handleTurn(threadId, "Add this to my cart")).ok, true);

  const proposedTurn = await assistant.handleTurn(threadId, "Prepare checkout");
  assert.equal(proposedTurn.ok, true);
  const proposed = proposedTurn.surfaces?.at(-1);
  assert.ok(proposed, "checkout proposal projects a surface");
  assertSurfaceReferencesResolve(proposed.a2uiMessages, "proposed checkout");
  // Subtotal ₦17,000 (2 x ₦8,500) plus delivery ₦1,200 is the total shown to the guest.
  const proposedFacts = ["Checkout · Harbour Goods", "Subtotal: ₦17,000", "Delivery: ₦1,200", "Total: ₦18,200", "Confirm checkout"];

  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    const proposedRender = await renderSurfaceInTab(browser, fixture, proposed, "Checkout", proposedFacts);
    assertRenderedFacts(proposedRender, proposedFacts, "proposed checkout");

    const confirmContext = checkoutConfirmContext(proposed.a2uiMessages);
    // The same event the rendered Confirm button sends: the platform command path, not a direct payment call.
    const confirmed = assistant.handleAssistantEvent(threadId, COMMERCE_CHECKOUT_CONFIRM_ACTION, confirmContext);
    assert.equal(confirmed.ok, true);
    const result = confirmed.surfaces?.at(-1);
    assert.ok(result, "confirmation projects a post-confirm checkout surface");
    assertSurfaceReferencesResolve(result.a2uiMessages, "post-confirm checkout");
    const resultFacts = ["Checkout · Harbour Goods", "Total: ₦18,200", "Payment unavailable. No order or payment was created."];
    const resultRender = await renderSurfaceInTab(browser, fixture, result, "Checkout result", resultFacts);
    assertRenderedFacts(resultRender, resultFacts, "post-confirm checkout");
    assert.equal(resultRender.text.includes("Confirm checkout"), false, "post-confirm surface does not offer a second confirm action");
  } finally {
    await browser.close();
    await fixture.close();
    environment.database.close();
  }
});
