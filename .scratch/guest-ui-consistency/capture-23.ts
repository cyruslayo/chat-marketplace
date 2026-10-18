import { mkdirSync, writeFileSync } from "node:fs";
import { AssistantRuntime } from "../../apps/local-guest/src/assistant/assistant-runtime.js";
import { TASK_START_EVENT } from "../../apps/local-guest/src/assistant/assistant-platform.js";
import { createCommerceAssistantPack } from "../../apps/local-guest/src/assistant/commerce-assistant-pack.js";
import { ScriptedAssistantModel } from "../../apps/local-guest/src/assistant/scripted-assistant-model.js";
import { LocalGuestEnvironment } from "../../apps/local-guest/src/fixture.js";
import { launchRealBrowser } from "../../test/helpers/chrome-devtools.js";
import { restartFixture } from "../../test/helpers/guest-restart.js";
import { createCommercePack } from "../../domains/commerce/src/index.js";
import { COMMERCE_CHECKOUT_CONFIRM_ACTION } from "../../apps/web-agent/src/commerce-presentation.js";
import { checkoutConfirmContext } from "../../test/helpers/a2ui-surface-integrity.js";

// Run from the worktree root: `npx tsx .scratch/guest-ui-consistency/capture-23.ts`.
// Earlier captures stay as evidence: screenshots/23 (original) and screenshots/23-root-fix (before the checkout fix).
const output = "screenshots/23-checkout-fix";
mkdirSync(output, { recursive: true });

const environment = LocalGuestEnvironment.openNode({ databasePath: ":memory:", clock: () => new Date("2026-10-18T10:00:00Z") });
const commerce = createCommercePack({ database: environment.database, clock: environment.clock });
commerce.directory.createMerchant({ id: "capture-merchant", name: "Harbour Goods Ltd", status: "verified" });
commerce.directory.createStore({ id: "capture-store", merchantId: "capture-merchant", slug: "harbour-goods", name: "Harbour Goods", status: "active" });
commerce.catalogue.createProduct({ id: "capture-tote", name: "Northstar Cotton Tote", category: "Accessories", description: "A durable everyday carry bag with reinforced handles." });
commerce.catalogue.createOffer({ id: "capture-tote-offer", productId: "capture-tote", storeId: "capture-store", priceKobo: 850000, stock: 18 });
commerce.catalogue.createProduct({ id: "capture-cup", name: "Coastal Ceramic Cup", category: "Home", description: "Hand-finished stoneware for tea and coffee." });
commerce.catalogue.createOffer({ id: "capture-cup-offer", productId: "capture-cup", storeId: "capture-store", priceKobo: 325000, stock: 7 });
commerce.catalogue.createDeliveryZone({ id: "capture-zone", storeId: "capture-store", city: "Lagos", name: "Lagos Mainland", provider: "Harbour Goods", feeKobo: 120000, isActive: true, sortOrder: 0 });
const order = commerce.orders.createOrder({ storeId: "capture-store", deliveryZoneId: "capture-zone", customerName: "Capture Guest", customerPhone: "08000000000", shippingAddress: { street: "Demo Street" }, items: [{ offerId: "capture-tote-offer", quantity: 1 }], submittedTotalKobo: 970000, paymentReference: "capture-reference" });
const model = new ScriptedAssistantModel([request => {
  const last = request.history.at(-1);
  if (last?.role !== "user") return null;
  const text = last.text.toLowerCase();
  if (text.includes("checkout")) return { toolCalls: [{ id: "capture-checkout", name: "propose_checkout", args: { storeId: "capture-store", deliveryZoneId: "capture-zone" } }] };
  if (text.includes("cart") || text.includes("add")) return { toolCalls: [{ id: "capture-cart", name: "add_to_store_cart", args: { offerId: "capture-tote-offer", quantity: 2 } }] };
  if (text.includes("order") || text.includes("track")) return { toolCalls: [{ id: "capture-order", name: "get_order_status", args: { publicCode: order.publicCode } }] };
  return { toolCalls: [{ id: "capture-search", name: "search_products", args: { query: "cotton tote" } }] };
}]);
const pack = createCommerceAssistantPack({
  database: environment.database,
  clock: environment.clock,
  audit: environment.audit,
  authorizeOrderStatus: ({ context }) => context.environment.guestPrincipal().id === environment.guestPrincipal().id,
});
const assistant = new AssistantRuntime(environment, model, { additionalPacks: [pack] });
const threadId = `g-${crypto.randomUUID()}`;
await assistant.handleTurn(threadId, "I want to shop");
const started = assistant.handleAssistantEvent(threadId, TASK_START_EVENT, { domain: "commerce" });
if (!started.ok) throw new Error(`Could not start Commerce task: ${JSON.stringify(started)}`);

// Checkout captures: the proposed state, then the result of the real confirm event (payment_unavailable).
const captures = [
  { kind: "discovery", prompt: "Search for a cotton tote", expected: ["Northstar Cotton Tote", "NGN 8,500", "17 available"], summary: "Products" },
  { kind: "cart", prompt: "Add this to my cart", expected: ["Northstar Cotton Tote", "2 × NGN 8,500"], summary: "Harbour Goods" },
  { kind: "order", prompt: "Track my order", expected: [order.publicCode, "Pending Verification"], summary: "Order status" },
  { kind: "checkout-proposed", prompt: "Prepare checkout", expected: ["Checkout · Harbour Goods", "Total: NGN 18,200", "Confirm checkout"], summary: "Checkout" },
  { kind: "checkout-result", prompt: "", expected: ["Checkout · Harbour Goods", "Total: NGN 18,200", "Payment unavailable. No order or payment was created."], summary: "Checkout result" },
] as const;

type ProjectedSurface = { readonly surfaceId: string; readonly a2uiMessages: readonly unknown[] };

const fixture = await restartFixture();
const cookie = fixture.cookie.split("=", 2);
const browser = await launchRealBrowser();
const findings: string[] = [];
let proposedContext: Record<string, unknown> | undefined;
try {
  for (const capture of captures) {
    let surface: ProjectedSurface | undefined;
    if (capture.kind === "checkout-result") {
      if (!proposedContext) throw new Error("Checkout result requires the proposed checkout to be captured first.");
      const confirmed = assistant.handleAssistantEvent(threadId, COMMERCE_CHECKOUT_CONFIRM_ACTION, proposedContext);
      if (!confirmed.ok) throw new Error(`Checkout confirmation failed: ${JSON.stringify(confirmed)}`);
      surface = confirmed.surfaces?.at(-1);
    } else {
      const turn = await assistant.handleTurn(threadId, capture.prompt);
      if (!turn.ok) throw new Error(`Commerce ${capture.kind} turn failed: ${JSON.stringify(turn)}`);
      surface = turn.surfaces?.at(-1);
    }
    if (!surface) throw new Error(`Commerce ${capture.kind} did not project an A2UI surface.`);
    if (capture.kind === "checkout-proposed") proposedContext = checkoutConfirmContext(surface.a2uiMessages);
    const payload = {
      ok: true,
      timeline: [{ role: "assistant", text: `Commerce ${capture.kind} result.` }],
      tasks: [
        { taskId: "task-1", domain: "shortlet", domainLabel: "Stays", status: "available", active: false },
        { taskId: "task-2", domain: "commerce", domainLabel: "Shopping", status: "active", active: true },
      ],
      verticals: [],
      surfaces: [{
        surfaceId: surface.surfaceId,
        a2uiMessages: surface.a2uiMessages,
        mode: "inline-surface",
        status: "active",
        summary: capture.summary,
      }],
    };
    const tab = await browser.createTab();
    await tab.setCookie(cookie[0]!, cookie[1]!, fixture.base);
    const dispose = await tab.interceptRequests(async url => {
      if (new URL(url).pathname !== "/api/state") return undefined;
      return { status: 200, headers: [{ name: "Content-Type", value: "application/json; charset=utf-8" }], body: Buffer.from(JSON.stringify(payload)) };
    });
    try {
      await tab.navigate(fixture.base);
      await tab.waitForSelector(`#active-workspace .weaver-mount[data-surface-id="${surface.surfaceId}"]`, 15000);
      for (const fact of capture.expected) await tab.waitForText(fact, 15000);
      for (const width of [320, 390, 768, 1280]) {
        if (width < 768) await tab.setViewport(width, 900);
        else await tab.setCssViewport(width, 900);
        await tab.evaluate("document.documentElement.dataset.theme = 'light'");
        await tab.evaluate("document.fonts.ready.then(() => true)");
        for (const fact of capture.expected) await tab.waitForText(fact, 5000);
        const audit = await tab.evaluate<{ overflow: number; small: string[]; text: string }>(`(() => {
          const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden'; };
          const controls = [...document.querySelectorAll('a,button,input,select,textarea,summary')]
            .filter(el => el.type !== 'hidden' && el.type !== 'radio' && el.type !== 'file' && !el.closest('[hidden]') && !el.classList.contains('skip-link') && !el.classList.contains('sr-only') && visible(el))
            .map(el => ({ el, r: el.getBoundingClientRect() }))
            .filter(({r}) => r.width < 43.5 || r.height < 43.5)
            .map(({el,r}) => (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0,28) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
          return { overflow: document.documentElement.scrollWidth - innerWidth, small: controls, text: document.body.innerText };
        })()`);
        const name = `${capture.kind}-light-${width}`;
        if (audit.overflow > 0) findings.push(`${name}: horizontal overflow ${audit.overflow}px`);
        if (audit.small.length > 0) findings.push(`${name}: controls below 44px: ${audit.small.join(" | ")}`);
        for (const fact of capture.expected) if (!audit.text.includes(fact)) findings.push(`${name}: expected catalogue content '${fact}' is not visible; surface=${surface.surfaceId}`);
        if (capture.kind === "checkout-result" && audit.text.includes("Confirm checkout")) findings.push(`${name}: post-confirm surface still shows a confirm action`);
        writeFileSync(`${output}/${name}.png`, await tab.captureScreenshot());
      }
    } finally {
      await dispose();
      await tab.close();
    }
  }
} finally {
  await browser.close();
  await fixture.close();
  environment.database.close();
}

writeFileSync(`${output}/findings.txt`, findings.length === 0 ? "No horizontal overflow; no visible controls below 44px; all commerce surfaces (discovery, cart, order, checkout proposed, checkout payment_unavailable) rendered their expected content at 320, 390, 768 and 1280.\n" : `${findings.join("\n")}\n`);
console.log(findings.length === 0 ? "No horizontal overflow, undersized controls, or missing commerce content." : findings.join("\n"));
