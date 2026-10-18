import assert from "node:assert/strict";
import test from "node:test";
import { launchRealBrowser, type RealBrowserInstance, type RealBrowserTab } from "./helpers/chrome-devtools.js";
import { createCommercePack } from "../domains/commerce/src/index.js";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { startLocalGuestServer, type LocalGuestServerHandle } from "../apps/local-guest/src/guest-server.js";

test("AC3: Captures at the four widths pass the overflow and 44px checks", async () => {
  const environment = LocalGuestEnvironment.openNode({ databasePath: ":memory:" });
  const commerce = createCommercePack({ database: environment.database, clock: environment.clock });
  commerce.directory.createMerchant({ id: "browser-merchant", name: "Browser Merchant", status: "verified" });
  commerce.directory.createStore({ id: "browser-store", merchantId: "browser-merchant", slug: "browser-store", name: "Browser Store", status: "active" });
  commerce.catalogue.createProduct({ id: "browser-product", name: "Visible Store Offer", category: "Home", description: "A visible commerce offer for browser layout verification." });
  commerce.catalogue.createOffer({ id: "browser-offer", productId: "browser-product", storeId: "browser-store", priceKobo: 420000, stock: 8 });
  const server: LocalGuestServerHandle = startLocalGuestServer({ port: 0, environment });
  let browser: RealBrowserInstance | undefined;
  let tab: RealBrowserTab | undefined;
  try {
    const port = await server.listen();
    browser = await launchRealBrowser({ headless: true });
    tab = await browser.createTab(`http://127.0.0.1:${port}/s/browser-store`);
    await tab.waitForText("Visible Store Offer");
    const results: Array<{ width: number; theme: string; path: string; overflow: boolean; undersized: string[]; text: string }> = [];
    for (const path of ["/s/browser-store", "/orders/track"]) {
      for (const theme of ["light", "dark"]) {
        for (const width of [320, 390, 768, 1280]) {
          await tab.setViewport(width, 900);
          await tab.navigate(`http://127.0.0.1:${port}${path}`);
          await tab.evaluate(`document.documentElement.dataset.theme = '${theme}'`);
          await tab.waitForFunction("document.documentElement.clientWidth > 0");
          results.push(await tab.evaluate(`(() => ({
            width: document.documentElement.clientWidth,
            theme: document.documentElement.dataset.theme || '',
            overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
            undersized: [...document.querySelectorAll('a,button,input,select,textarea')]
              .filter((node) => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44); })
              .map((node) => node.textContent?.trim() || node.getAttribute('aria-label') || node.tagName),
            text: document.querySelector('main')?.innerText || ''
          }))()`));
          results[results.length - 1]!.path = path;
        }
      }
    }
    for (const result of results) {
      assert.equal(result.overflow, false, `horizontal overflow on ${result.path} at ${result.width}px in ${result.theme} theme`);
      assert.deepEqual(result.undersized, [], `controls below 44px on ${result.path} at ${result.width}px in ${result.theme} theme`);
      if (result.path === "/s/browser-store") {
        assert.match(result.text, /Visible Store Offer/);
        assert.match(result.text, /₦4,200/);
      } else assert.match(result.text, /Track your order/);
    }
    await tab.navigate(`http://127.0.0.1:${port}/s/browser-store`);
    assert.match(await tab.getContent(), /Visible Store Offer/);
  } finally {
    await tab?.close();
    await browser?.close();
    await server.close();
  }
});
