import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { withStagePage } from "../../test/helpers/guest-stage-pages.js";
import { launchRealBrowser } from "../../test/helpers/chrome-devtools.js";

const directory = ".scratch/guest-ui-consistency/screenshots/10";
mkdirSync(directory, { recursive: true });
await withStagePage({ label: "confirmed", stage: "confirmed" }, async ({ fixture, path, threadId }) => {
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setExtraHeaders({ cookie: fixture.cookie });
    for (const [name, route, selector] of [
      ["confirmed-page", path, ".confirmed-screen"],
      ["confirmed-chat", `/?threadId=${threadId}`, ".confirmed-screen"],
      ["no-js-conversation", `/conversation?threadId=${threadId}`, ".no-js-conversation"],
      ["error", "/booking-contracts/missing", ".ui-empty"],
    ]) {
      for (const width of [320, 390, 768, 1280]) {
        await tab.setJavaScriptEnabled(name === "confirmed-chat");
        await tab.setViewport(width, 900);
        await tab.navigate(`${fixture.base}${route}`);
        await tab.waitForSelector(selector!, 10_000);
        await tab.waitForFunction("document.readyState === 'complete'", 10_000);
        await tab.evaluate("document.fonts.ready.then(() => true)");
        await tab.evaluate("document.documentElement.dataset.theme = 'light'");
        const height = await tab.evaluate<number>(`Math.max(document.documentElement.scrollHeight, document.querySelector(${JSON.stringify(selector)}).scrollHeight + 240)`);
        await tab.setViewport(width, Math.min(4000, height));
        assert.equal(await tab.evaluate<boolean>("document.documentElement.scrollWidth <= innerWidth"), true, `${name}/${width}: overflow`);
        const small = await tab.evaluate<unknown[]>(`[...document.querySelectorAll(${JSON.stringify(`${selector} button, ${selector} a`)})].filter(el => el.getBoundingClientRect().width && (el.getBoundingClientRect().height < 44 || el.getBoundingClientRect().width < 44)).map(el => ({text: el.textContent, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height}))`);
        assert.deepEqual(small, [], `${name}/${width}: target under 44px`);
        writeFileSync(`${directory}/${name}-light-${width}.png`, await tab.captureScreenshot());
        console.log(`${name}/${width}: reflow and targets pass`);
      }
    }
  } finally { await browser.close(); }
});
