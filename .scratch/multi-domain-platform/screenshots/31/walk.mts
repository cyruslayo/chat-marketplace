// Scratch UX walk for the commerce question. Read-only against the repo: it only imports repo modules and
// writes under the scratchpad. Modes: pack (commerce local + Shop assistant pack), nopack (commerce local, no pack,
// i.e. the CLI default), disabled (Cloudflare Shortlet composition). Run one mode at a time.
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const REPO = "C:/AI2026/chat-marketplace/";
const load = (p: string): Promise<any> => import(pathToFileURL(REPO + p).href);
const MODE = process.env.MODE ?? "pack";
const WIDTHS = (process.env.WIDTHS ?? "390,1280").split(",").map(Number);
const SCRATCH = "C:/Users/Cyrus/AppData/Local/Temp/claude/C--AI2026-chat-marketplace/a3b6460a-f087-4059-be6b-68fc290ac055/scratchpad/commerce-ux";
const PHONE = "+234 801 234 5678";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const { LOCAL_TEST_ONLY_COMMERCE_REFERENCE_KEYS: KEYS } = await load("apps/local-guest/src/commerce-reference-keys-local.ts");
const { LocalGuestEnvironment } = await load("apps/local-guest/src/fixture.ts");
const { startLocalGuestServer } = await load("apps/local-guest/src/guest-server.ts");
const { createCommercePack } = await load("domains/commerce/src/index.ts");
const { createCommerceAssistantPack } = await load("apps/local-guest/src/assistant/commerce-assistant-pack.ts");
const { ScriptedAssistantModel } = await load("apps/local-guest/src/assistant/scripted-assistant-model.ts");
const { launchRealBrowser } = await load("test/helpers/chrome-devtools.ts");
const { applySchemaMigrations } = await load("packages/platform-core/src/schema-migrations.ts");

const COMMERCE_SYS = "Commerce catalogue and Commerce tools are authoritative";
const latestUser = (req: any): string => {
  for (let i = req.history.length - 1; i >= 0; i--) if (req.history[i].role === "user") return req.history[i].text;
  return "";
};
// Scripted stand-in for the model, only for commerce turns. Stays turns fall through to the default script.
const scripted = new ScriptedAssistantModel([(req: any) => {
  if (!String(req.systemInstruction).includes(COMMERCE_SYS)) return null;
  const last = req.history.at(-1);
  if (last?.role === "tool_results") {
    const names = last.results.map((r: any) => r.name);
    if (names.includes("quote_delivery")) return { toolCalls: [{ id: "c-propose", name: "propose_checkout", args: { storeId: "s-harbour", deliveryZoneId: "z-lagos" } }] };
    if (names.includes("propose_checkout")) return { text: "Your checkout is ready. Confirm the exact total to continue." };
    if (names.includes("add_to_store_cart")) return { text: "I added the tote to your Store Cart." };
    if (names.includes("search_products")) return { text: "Here is what I found from verified merchants." };
    return { text: "Done." };
  }
  const text = latestUser(req).toLowerCase();
  if (text.includes("tote") && /find|search|looking|show/.test(text)) return { toolCalls: [{ id: "c-search", name: "search_products", args: { query: "cotton tote" } }] };
  if (/\badd\b/.test(text)) return { toolCalls: [{ id: "c-add", name: "add_to_store_cart", args: { offerId: "tote-offer", quantity: 1 } }] };
  if (/check ?out|\bpay\b/.test(text)) return { toolCalls: [{ id: "c-quote", name: "quote_delivery", args: { storeId: "s-harbour" } }] };
  return { text: "I can help you shop from verified merchants. What product are you looking for?" };
}]);

// Same bounded audit as .scratch/guest-ui-consistency/capture-27.ts, plus text under 12px (ADR 0078 profile).
const AUDIT = `(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const hid = (el) => !!el.closest('[hidden],.ui-sr-only,.sr-only');
  const controls = [...document.querySelectorAll('a,button,input,select,textarea,summary,[role=button]')]
    .filter(el => el.type !== 'hidden' && el.type !== 'radio' && el.type !== 'file' && !hid(el) && !el.classList.contains('skip-link') && visible(el))
    .map(el => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.width < 43.5 || r.height < 43.5)
    .map(({ el, r }) => (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 28) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  const smallText = [...document.querySelectorAll('body *')]
    .filter(el => !hid(el) && visible(el) && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(el).fontSize) < 12)
    .map(el => el.tagName.toLowerCase() + ' ' + getComputedStyle(el).fontSize + ' "' + el.textContent.trim().slice(0, 30) + '"');
  return { overflow: document.documentElement.scrollWidth - innerWidth, small: controls, smallText, text: document.body.innerText,
    buttons: [...document.querySelectorAll('button,a')].filter(visible).map(b => b.tagName.toLowerCase() + ':' + b.textContent.trim().slice(0, 40)),
    rail: [...document.querySelectorAll('.ui-task-rail__item')].map(b => b.dataset.domain + (b.getAttribute('aria-current') ? '*' : '') + ' [' + b.textContent.trim().replace(/\\s+/g,' ') + ']'),
    starters: [...document.querySelectorAll('.ui-vertical-starter')].map(b => b.tagName.toLowerCase() + ':' + b.dataset.domain + ':' + b.textContent.trim().slice(0,60)),
    composer: !!document.querySelector('#composer-input') };
})()`;

const log: string[] = [];
const findings: string[] = [];
const outDir = `${SCRATCH}/shots-${MODE}`;
mkdirSync(outDir, { recursive: true });

async function seed(env: any) {
  const commerce = createCommercePack({ database: env.database, clock: env.clock, paymentReferenceKeys: KEYS });
  applySchemaMigrations(env.database, commerce.migrations, env.clock().toISOString());
  commerce.directory.createMerchant({ id: "m-harbour", name: "Harbour Goods Ltd", status: "verified" });
  commerce.directory.createStore({ id: "s-harbour", merchantId: "m-harbour", slug: "harbour-goods", name: "Harbour Goods", status: "active" });
  commerce.catalogue.createProduct({ id: "p-tote", name: "Northstar Cotton Tote", category: "Accessories", description: "A durable everyday carry bag with reinforced handles." });
  commerce.catalogue.createOffer({ id: "tote-offer", productId: "p-tote", storeId: "s-harbour", priceKobo: 850000, stock: 18 });
  commerce.catalogue.createProduct({ id: "p-cup", name: "Coastal Ceramic Cup", category: "Home", description: "Hand-finished stoneware for tea and coffee." });
  commerce.catalogue.createOffer({ id: "cup-offer", productId: "p-cup", storeId: "s-harbour", priceKobo: 325000, stock: 7 });
  commerce.catalogue.createDeliveryZone({ id: "z-lagos", storeId: "s-harbour", city: "Lagos", name: "Lagos Mainland", provider: "Harbour Goods", feeKobo: 120000, isActive: true, sortOrder: 0 });
  // Unverified merchant (ADR 0100): its store must not be offered in chat or on a page.
  commerce.directory.createMerchant({ id: "m-pending", name: "Pending Traders Ltd", status: "pending" });
  commerce.directory.createStore({ id: "s-pending", merchantId: "m-pending", slug: "pending-traders", name: "Pending Traders", status: "active" });
  commerce.catalogue.createProduct({ id: "p-kettle", name: "Pending Kettle", category: "Home", description: "Kettle from an unverified merchant." });
  commerce.catalogue.createOffer({ id: "kettle-offer", productId: "p-kettle", storeId: "s-pending", priceKobo: 450000, stock: 5 });
  commerce.catalogue.createDeliveryZone({ id: "z-pending", storeId: "s-pending", city: "Lagos", name: "Lagos Mainland", provider: "Pending", feeKobo: 100000, isActive: true, sortOrder: 0 });
  return commerce.orders.createOrder({ storeId: "s-harbour", deliveryZoneId: "z-lagos", customerName: "Test Guest", customerPhone: PHONE, shippingAddress: { street: "Demo Street" }, items: [{ offerId: "tote-offer", quantity: 1 }], submittedTotalKobo: 970000, paymentReference: "walk-reference" });
}

async function runWidth(width: number) {
  const env = LocalGuestEnvironment.openNode({ databasePath: ":memory:", clock: () => new Date("2026-10-18T10:00:00Z") });
  let order: any = null;
  if (MODE !== "disabled") order = await seed(env);
  const server = MODE === "pack"
    ? startLocalGuestServer({ port: 0, environment: env, paymentReferenceKeys: KEYS, conciergeMode: "assistant-offline", modelClient: scripted,
        additionalPacks: [createCommerceAssistantPack({ database: env.database, clock: env.clock, paymentReferenceKeys: KEYS, audit: env.audit })] })
    : MODE === "nopack"
      ? startLocalGuestServer({ port: 0, environment: env, paymentReferenceKeys: KEYS, conciergeMode: "assistant-offline", modelClient: scripted })
      : startLocalGuestServer({ port: 0, environment: env, commerce: "disabled", conciergeMode: "assistant-offline", modelClient: scripted });
  const base = `http://127.0.0.1:${await server.listen()}`;
  const browser = await launchRealBrowser({ headless: true });
  const W = `w${width}`;
  const shot = async (tab: any, name: string, opts: { theme?: string } = {}) => {
    await tab.evaluate(`document.documentElement.dataset.theme = '${opts.theme ?? "light"}'`);
    await sleep(300);
    const h = await tab.evaluate<number>("document.documentElement.scrollHeight");
    await tab.setViewport(width, Math.min(Math.max(h, 900), 3200));
    await sleep(300);
    const a = await tab.evaluate<any>(AUDIT);
    const file = `${outDir}/${name}-${W}${opts.theme ? "-" + opts.theme : ""}`;
    writeFileSync(`${file}.png`, await tab.captureScreenshot());
    writeFileSync(`${file}.txt`, a.text);
    log.push(`[${name} ${W}${opts.theme ? " " + opts.theme : ""}] overflow=${a.overflow}px; controls<44px=${a.small.length} ${a.small.join(" | ")}; text<12px=${a.smallText.length} ${a.smallText.slice(0, 6).join(" | ")}; composer=${a.composer}; starters=${JSON.stringify(a.starters)}; rail=${JSON.stringify(a.rail)}; buttons=${JSON.stringify(a.buttons.slice(0, 30))}`);
    if (a.overflow > 0) findings.push(`${name} ${W}: horizontal overflow ${a.overflow}px`);
    if (a.small.length) findings.push(`${name} ${W}: controls under 44px: ${a.small.join(" | ")}`);
    if (a.smallText.length) findings.push(`${name} ${W}: text under 12px: ${a.smallText.slice(0, 6).join(" | ")}`);
    return a;
  };
  const send = async (tab: any, text: string, wait = 2800) => {
    await tab.focus("#composer-input");
    await tab.insertText(text);
    await tab.pressKey("Enter");
    await sleep(wait);
  };
  const clickEval = (sel: string) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'MISSING'; el.click(); return 'clicked'; })()`;
  try {
    // ---- Chat flow (pack and nopack) / first visit (all modes)
    const tab = await browser.createTab();
    await tab.navigate(base + "/");
    await tab.waitForSelector("#composer-input", 20000).catch(() => findings.push("composer not found on /"));
    await sleep(1500);
    await shot(tab, "01-home-first-visit");

    if (MODE === "pack") {
      // 01b: a router-free first message ("hello"); starters seem to appear only after a turn with tasks (see log)
      await send(tab, "hello", 2500);
      await shot(tab, "01b-after-hello");
      // 02: start Shop from the starter card
      log.push("starter click: " + (await tab.evaluate<string>(clickEval("button.ui-vertical-starter[data-domain=\"commerce\"]"))));
      await tab.waitForText("Started a Shop task.", 15000).catch(() => log.push("no 'Started a Shop task.' message"));
      await sleep(800);
      await shot(tab, "02-shop-started");
      // 03: search
      await send(tab, "I'm looking for a cotton tote");
      await shot(tab, "03-search-results");
      // 04: add to cart
      await send(tab, "add the cotton tote to my cart");
      await shot(tab, "04-added-to-cart");
      // 05: checkout from chat
      await send(tab, "I want to check out", 3500);
      await shot(tab, "05-checkout-proposal");
      if (process.env.STALE === "1") {
        // Stale-surface check: switch to Stays while the checkout confirmation is still open, then try to confirm there.
        log.push("STALE rail to stays: " + (await tab.evaluate<string>(clickEval("button.ui-task-rail__item[data-domain=\"shortlet\"]"))));
        await sleep(2500);
        const stale = await shot(tab, "05b-stays-with-open-checkout");
        log.push(`STALE: Confirm checkout still on screen in Stays task: ${stale.buttons.some((b: string) => b.includes("Confirm checkout"))}; checkout card visible: ${stale.text.includes("Checkout · Harbour Goods")}`);
        const clicked = await tab.clickButton("Confirm checkout").catch(() => false);
        log.push("STALE confirm click from Stays: " + clicked);
        await sleep(2500);
        await shot(tab, "05c-confirm-from-stays");
        return;
      }
      // 06: confirm
      const confirmed = await tab.clickButton("Confirm checkout").catch(() => false);
      log.push("confirm click: " + confirmed);
      await sleep(3000);
      await shot(tab, "06-after-confirm");
      // 07: rail switch to Stays (via rail)
      log.push("rail to stays: " + (await tab.evaluate<string>(clickEval("button.ui-task-rail__item[data-domain=\"shortlet\"]"))));
      await sleep(2500);
      await shot(tab, "07-switched-to-stays-via-rail");
      // 08: a stays request
      await send(tab, "I need an apartment in Lekki for two nights for two guests", 3500);
      await shot(tab, "08-stays-turn");
      // 09: cross-domain intent typed in Stays
      await send(tab, "I want to buy a kettle", 3000);
      await shot(tab, "09-cross-domain-typed");
      // 09b: the guest answers the confirmation ("yes"); this goes to the active Stays task.
      await send(tab, "yes, start the shop search", 3000);
      await shot(tab, "09b-reply-yes");
      // 10: the rail has gone after the router turn; reload, then switch back to Shop via the rail
      await tab.navigate(base + "/");
      await sleep(2500);
      await shot(tab, "10a-reload-after-router");
      log.push("rail to shop: " + (await tab.evaluate<string>(clickEval("button.ui-task-rail__item[data-domain=\"commerce\"]"))));
      await sleep(2500);
      const back = await shot(tab, "10-back-to-shop-via-rail");
      log.push(`cart/checkout retained after switching back: tote=${back.text.includes("Northstar Cotton Tote")} checkout=${back.text.includes("Checkout")}`);
      // 11: reload keeps tasks?
      await tab.navigate(base + "/");
      await sleep(2500);
      await shot(tab, "11-reload-home");
      await shot(tab, "11d-reload-home", { theme: "dark" });
      // no-JS markup check (fetch, JS independent)
      const res = await fetch(base + "/");
      const html = await res.text();
      const starters = html.match(/<section class="ui-vertical-starters"[\s\S]*?<\/section>/)?.[0] ?? "NONE";
      const railHtml = html.match(/<nav class="ui-task-rail-nav"[\s\S]*?<\/nav>/)?.[0] ?? "NONE";
      log.push("NO-JS starters markup: " + starters.slice(0, 500));
      log.push("NO-JS rail markup: " + railHtml.slice(0, 400));
      // Pages.
      const pagesTab = await browser.createTab();
      await pagesTab.navigate(base + "/s/harbour-goods");
      await pagesTab.waitForText("Northstar Cotton Tote", 15000).catch(() => log.push("store page: tote not found"));
      await shot(pagesTab, "12-store-page");
      await pagesTab.navigate(base + "/s/pending-traders");
      await sleep(1200);
      const pend = await shot(pagesTab, "13-unverified-store-page");
      log.push(`unverified store shows kettle=${pend.text.includes("Pending Kettle")} title=${pend.text.slice(0, 80).replace(/\n/g, " / ")}`);
      await pagesTab.navigate(base + "/s/harbour-goods/offers/tote-offer");
      await sleep(1200);
      await shot(pagesTab, "14-offer-page");
      await pagesTab.navigate(base + "/cart");
      await sleep(1000);
      await shot(pagesTab, "15-cart-page");
      await pagesTab.navigate(base + "/orders/track");
      await sleep(1000);
      await shot(pagesTab, "16-track-empty");
      await pagesTab.evaluate(`(() => { document.querySelector('#public-code').value = ${JSON.stringify(order.publicCode)}; document.querySelector('#order-phone').value = ${JSON.stringify(PHONE)}; document.querySelector('form').requestSubmit(); return true; })()`);
      await pagesTab.waitForText(order.publicCode, 15000).catch(() => log.push("track found: not shown"));
      await shot(pagesTab, "17-track-found");
      await pagesTab.navigate(base + "/orders/track");
      await sleep(800);
      await pagesTab.evaluate(`(() => { document.querySelector('#public-code').value = ${JSON.stringify(order.publicCode)}; document.querySelector('#order-phone').value = '08000000000'; document.querySelector('form').requestSubmit(); return true; })()`);
      await sleep(2000);
      await shot(pagesTab, "18-track-wrong-phone");
      await pagesTab.close();
    } else if (MODE === "nopack") {
      await send(tab, "I want to buy a tote", 2800);
      await shot(tab, "03-buy-tote-typed");
      const pg = await browser.createTab();
      await pg.navigate(base + "/s/harbour-goods");
      await pg.waitForText("Northstar Cotton Tote", 15000).catch(() => log.push("store page: tote not found"));
      await shot(pg, "12-store-page");
      await pg.close();
    } else {
      // disabled: Cloudflare Shortlet composition today
      await send(tab, "I want to buy a tote", 2800);
      await shot(tab, "03-buy-tote-typed");
      for (const path of ["/s/harbour-goods", "/cart", "/orders/track"]) {
        const r = await fetch(base + path);
        log.push(`GET ${path} -> ${r.status}`);
      }
    }
    await tab.close();
  } finally {
    await browser.close();
    await server.close();
    env.database.close();
  }
}

try {
  for (const width of WIDTHS) {
    log.push(`===== MODE ${MODE} width ${width}`);
    try {
      await runWidth(width);
    } catch (error) {
      log.push(`ERROR at width ${width}: ${error instanceof Error ? error.stack : String(error)}`);
      findings.push(`run aborted at width ${width}`);
    }
  }
} finally {
  writeFileSync(`${outDir}/log.txt`, log.join("\n") + "\n");
  writeFileSync(`${outDir}/findings.txt`, (findings.length ? findings.join("\n") : "no overflow, no undersized controls, no text under 12px") + "\n");
  console.log(log.join("\n"));
  console.log("FINDINGS:\n" + findings.join("\n"));
  process.exit(0);
}
