import { mkdirSync, writeFileSync } from "node:fs";
import { AssistantRuntime } from "../../apps/local-guest/src/assistant/assistant-runtime.js";
import { TASK_START_EVENT } from "../../apps/local-guest/src/assistant/assistant-platform.js";
import { createCommerceAssistantPack } from "../../apps/local-guest/src/assistant/commerce-assistant-pack.js";
import { ScriptedAssistantModel } from "../../apps/local-guest/src/assistant/scripted-assistant-model.js";
import { LocalGuestEnvironment } from "../../apps/local-guest/src/fixture.js";
import { launchRealBrowser } from "../../test/helpers/chrome-devtools.js";
import { restartFixture } from "../../test/helpers/guest-restart.js";
import { createCommercePack } from "../../domains/commerce/src/index.js";
import { startLocalGuestServer } from "../../apps/local-guest/src/guest-server.js";
import { LOCAL_TEST_ONLY_COMMERCE_REFERENCE_KEYS } from "../../apps/local-guest/src/commerce-reference-keys-local.js";

// Run from the worktree root: `npx tsx .scratch/guest-ui-consistency/capture-27.ts`.
// Store page, offer page, order tracking (matched and unmatched) on the real guest server, and chat discovery parity.
const output = "screenshots/27";
mkdirSync(output, { recursive: true });
const WIDTHS = [320, 390, 768, 1280];
const THEMES = ["light", "dark"] as const;
const PHONE = "+234 801 234 5678";
// CAPTURE_ONLY=store,offer re-captures only those page kinds and skips tracking and chat.
const ONLY = process.env.CAPTURE_ONLY?.split(",");

// Same bounded audit as capture-23: horizontal overflow and visible controls under 44px (ADR 0078).
const AUDIT = `(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden'; };
  const controls = [...document.querySelectorAll('a,button,input,select,textarea,summary')]
    .filter(el => el.type !== 'hidden' && el.type !== 'radio' && el.type !== 'file' && !el.closest('[hidden]') && !el.classList.contains('skip-link') && !el.classList.contains('sr-only') && visible(el))
    .map(el => ({ el, r: el.getBoundingClientRect() }))
    .filter(({r}) => r.width < 43.5 || r.height < 43.5)
    .map(({el,r}) => (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0,28) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  return { overflow: document.documentElement.scrollWidth - innerWidth, small: controls, text: document.body.innerText };
})()`;

type Audit = { overflow: number; small: string[]; text: string };
const findings: string[] = [];
// One line per capture (AC3 evidence): overflow and undersized-control counts for every page, width and theme.
const records: string[] = [];

function check(name: string, audit: Audit, expected: readonly string[], absent: readonly string[] = []) {
  records.push(`${name}: overflow ${audit.overflow}px, controls under 44px ${audit.small.length}`);
  if (audit.overflow > 0) findings.push(`${name}: horizontal overflow ${audit.overflow}px`);
  if (audit.small.length > 0) findings.push(`${name}: controls below 44px: ${audit.small.join(" | ")}`);
  for (const fact of expected) if (!audit.text.includes(fact)) findings.push(`${name}: expected content '${fact}' is not visible`);
  for (const fact of absent) if (audit.text.includes(fact)) findings.push(`${name}: unexpected content '${fact}' is visible`);
}

// Page data: one verified merchant, one active store, two offers, one matched order (the order takes one tote, so its stock is 17).
const environment = LocalGuestEnvironment.openNode({ databasePath: ":memory:", clock: () => new Date("2026-10-18T10:00:00Z") });
const commerce = createCommercePack({ database: environment.database, clock: environment.clock, paymentReferenceKeys: LOCAL_TEST_ONLY_COMMERCE_REFERENCE_KEYS });
commerce.directory.createMerchant({ id: "capture-merchant", name: "Harbour Goods Ltd", status: "verified" });
commerce.directory.createStore({ id: "capture-store", merchantId: "capture-merchant", slug: "harbour-goods", name: "Harbour Goods", status: "active" });
commerce.catalogue.createProduct({ id: "capture-tote", name: "Northstar Cotton Tote", category: "Accessories", description: "A durable everyday carry bag with reinforced handles." });
commerce.catalogue.createOffer({ id: "capture-tote-offer", productId: "capture-tote", storeId: "capture-store", priceKobo: 850000, stock: 18 });
commerce.catalogue.createProduct({ id: "capture-cup", name: "Coastal Ceramic Cup", category: "Home", description: "Hand-finished stoneware for tea and coffee." });
commerce.catalogue.createOffer({ id: "capture-cup-offer", productId: "capture-cup", storeId: "capture-store", priceKobo: 325000, stock: 7 });
commerce.catalogue.createDeliveryZone({ id: "capture-zone", storeId: "capture-store", city: "Lagos", name: "Lagos Mainland", provider: "Harbour Goods", feeKobo: 120000, isActive: true, sortOrder: 0 });
// A store with a 60-character name, to check the top bar and card text at 320px (issue 27 review).
const LONG_STORE_NAME = "Harbour Goods Import and Trading Company of Lagos Island Ltd";
commerce.directory.createStore({ id: "capture-long-store", merchantId: "capture-merchant", slug: "harbour-goods-import-and-trading", name: LONG_STORE_NAME, status: "active" });
commerce.catalogue.createProduct({ id: "capture-kettle", name: "Enamel Kettle", category: "Home", description: "Two-litre enamel kettle for everyday use." });
commerce.catalogue.createOffer({ id: "capture-kettle-offer", productId: "capture-kettle", storeId: "capture-long-store", priceKobo: 450000, stock: 5 });
const order = commerce.orders.createOrder({ storeId: "capture-store", deliveryZoneId: "capture-zone", customerName: "Capture Guest", customerPhone: PHONE, shippingAddress: { street: "Demo Street" }, items: [{ offerId: "capture-tote-offer", quantity: 1 }], submittedTotalKobo: 970000, paymentReference: "capture-reference" });

const server = startLocalGuestServer({ port: 0, environment, paymentReferenceKeys: LOCAL_TEST_ONLY_COMMERCE_REFERENCE_KEYS });
const base = `http://127.0.0.1:${await server.listen()}`;
const browser = await launchRealBrowser({ headless: true });
try {
  // Store and offer pages.
  const pages = [
    ["store", "/s/harbour-goods", ["Northstar Cotton Tote", "Coastal Ceramic Cup", "Sold by Harbour Goods Ltd · Harbour Goods", "17 available", "₦8,500"]],
    ["offer", "/s/harbour-goods/offers/capture-tote-offer", ["Northstar Cotton Tote", "Sold by Harbour Goods Ltd · Harbour Goods", "A durable everyday carry bag"]],
    ["store-long", "/s/harbour-goods-import-and-trading", [LONG_STORE_NAME, "Enamel Kettle"]],
    ["offer-long", "/s/harbour-goods-import-and-trading/offers/capture-kettle-offer", [LONG_STORE_NAME, "Enamel Kettle", "Two-litre enamel kettle"]],
  ] as const;
  for (const [kind, path, expected] of pages) {
    if (ONLY && !ONLY.includes(kind)) continue;
    for (const theme of THEMES) for (const width of WIDTHS) {
      const tab = await browser.createTab(base + path);
      try {
        await tab.setViewport(width, 900);
        await tab.navigate(base + path);
        await tab.evaluate(`document.documentElement.dataset.theme = '${theme}'`);
        await tab.waitForText(expected[0]!, 15000);
        const audit = await tab.evaluate<Audit>(AUDIT);
        const name = `${kind}-${theme}-${width}`;
        check(name, audit, expected);
        writeFileSync(`${output}/${name}.png`, await tab.captureScreenshot());
      } finally {
        await tab.close();
      }
    }
  }
  // Order tracking: matched and unmatched lookups through the real form POST.
  const tracking = [
    ["track-matched", PHONE, [order.publicCode, "Pending Verification"], []],
    ["track-unmatched", "08000000000", ["Track your order", "could not find an order"], [order.publicCode]],
  ] as const;
  for (const [kind, phone, expected, absent] of tracking) {
    if (ONLY) break;
    for (const theme of THEMES) for (const width of WIDTHS) {
      const tab = await browser.createTab(base + "/orders/track");
      try {
        await tab.setViewport(width, 900);
        await tab.navigate(base + "/orders/track");
        await tab.evaluate(`document.documentElement.dataset.theme = '${theme}'`);
        await tab.evaluate(`(() => { document.querySelector('#public-code').value = ${JSON.stringify(order.publicCode)}; document.querySelector('#order-phone').value = ${JSON.stringify(phone)}; document.querySelector('form').requestSubmit(); return true; })()`);
        await tab.waitForText(expected[0]!, 15000);
        const audit = await tab.evaluate<Audit>(AUDIT);
        const name = `${kind}-${theme}-${width}`;
        check(name, audit, expected, absent);
        writeFileSync(`${output}/${name}.png`, await tab.captureScreenshot());
      } finally {
        await tab.close();
      }
    }
  }
} finally {
  await browser.close();
  await server.close();
  environment.database.close();
}

if (ONLY) {
  writeFileSync(`${output}/findings-${ONLY.join("-")}.txt`, findings.length === 0 ? `No horizontal overflow and no visible controls below 44px; ${ONLY.join(", ")} pages rendered their expected facts at 320, 390, 768 and 1280 in light and dark.\n` : `${findings.join("\n")}\n`);
  console.log(findings.length === 0 ? "Capture clean for " + ONLY.join(", ") : findings.join("\n"));
  process.exit(0);
}

// Chat parity: the discovery surface from the Shop assistant, rendered in the workspace (as capture-23 does).
const chatEnvironment = LocalGuestEnvironment.openNode({ databasePath: ":memory:", clock: () => new Date("2026-10-18T10:00:00Z") });
const chatCommerce = createCommercePack({ database: chatEnvironment.database, clock: chatEnvironment.clock, paymentReferenceKeys: LOCAL_TEST_ONLY_COMMERCE_REFERENCE_KEYS });
chatCommerce.directory.createMerchant({ id: "capture-merchant", name: "Harbour Goods Ltd", status: "verified" });
chatCommerce.directory.createStore({ id: "capture-store", merchantId: "capture-merchant", slug: "harbour-goods", name: "Harbour Goods", status: "active" });
chatCommerce.catalogue.createProduct({ id: "capture-tote", name: "Northstar Cotton Tote", category: "Accessories", description: "A durable everyday carry bag with reinforced handles." });
chatCommerce.catalogue.createOffer({ id: "capture-tote-offer", productId: "capture-tote", storeId: "capture-store", priceKobo: 850000, stock: 18 });
const chatModel = new ScriptedAssistantModel([request => {
  const last = request.history.at(-1);
  if (last?.role !== "user") return null;
  return { toolCalls: [{ id: "capture-search", name: "search_products", args: { query: "cotton tote" } }] };
}]);
const chatPack = createCommerceAssistantPack({ database: chatEnvironment.database, clock: chatEnvironment.clock, audit: chatEnvironment.audit });
const assistant = new AssistantRuntime(chatEnvironment, chatModel, { additionalPacks: [chatPack] });
const threadId = `g-${crypto.randomUUID()}`;
await assistant.handleTurn(threadId, "I want to shop");
const started = assistant.handleAssistantEvent(threadId, TASK_START_EVENT, { domain: "commerce" });
if (!started.ok) throw new Error(`Could not start Commerce task: ${JSON.stringify(started)}`);
const chatExpected = ["Northstar Cotton Tote", "Sold by Harbour Goods Ltd · Harbour Goods", "18 available"];
const chatTurn = await assistant.handleTurn(threadId, "Search for a cotton tote");
if (!chatTurn.ok) throw new Error(`Commerce discovery turn failed: ${JSON.stringify(chatTurn)}`);
const surface = chatTurn.surfaces?.at(-1);
if (!surface) throw new Error("Commerce discovery did not project an A2UI surface.");
const chatPayload = {
  ok: true,
  timeline: [{ role: "assistant", text: "Commerce discovery result." }],
  tasks: [
    { taskId: "task-1", domain: "shortlet", domainLabel: "Stays", status: "available", active: false },
    { taskId: "task-2", domain: "commerce", domainLabel: "Shopping", status: "active", active: true },
  ],
  verticals: [],
  surfaces: [{ surfaceId: surface.surfaceId, a2uiMessages: surface.a2uiMessages, mode: "inline-surface", status: "active", summary: "Products" }],
};
const chatFixture = await restartFixture();
const cookie = chatFixture.cookie.split("=", 2);
const chatBrowser = await launchRealBrowser();
try {
  for (const theme of THEMES) for (const width of WIDTHS) {
    const tab = await chatBrowser.createTab();
    await tab.setCookie(cookie[0]!, cookie[1]!, chatFixture.base);
    const dispose = await tab.interceptRequests(async url => {
      if (new URL(url).pathname !== "/api/state") return undefined;
      return { status: 200, headers: [{ name: "Content-Type", value: "application/json; charset=utf-8" }], body: Buffer.from(JSON.stringify(chatPayload)) };
    });
    try {
      await tab.navigate(chatFixture.base);
      await tab.waitForSelector(`#active-workspace .weaver-mount[data-surface-id="${surface.surfaceId}"]`, 15000);
      for (const fact of chatExpected) await tab.waitForText(fact, 15000);
      if (width < 768) await tab.setViewport(width, 900); else await tab.setCssViewport(width, 900);
      await tab.evaluate(`document.documentElement.dataset.theme = '${theme}'`);
      for (const fact of chatExpected) await tab.waitForText(fact, 5000);
      const audit = await tab.evaluate<Audit>(AUDIT);
      const name = `chat-discovery-${theme}-${width}`;
      check(name, audit, chatExpected);
      writeFileSync(`${output}/${name}.png`, await tab.captureScreenshot());
    } finally {
      await dispose();
      await tab.close();
    }
  }
} finally {
  await chatBrowser.close();
  await chatFixture.close();
  chatEnvironment.database.close();
}

writeFileSync(`${output}/findings.txt`, `${records.join("\n")}\n${findings.length === 0 ? "No horizontal overflow and no visible controls below 44px; store, offer, long-name store, tracking (matched and unmatched) and chat discovery rendered their expected facts at 320, 390, 768 and 1280 in light and dark.\n" : `${findings.join("\n")}\n`}`);
console.log(findings.length === 0 ? "Capture clean: no overflow, no undersized controls, expected facts visible." : findings.join("\n"));
