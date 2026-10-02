import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { withRequestScreen } from "../../test/helpers/guest-request-screen.js";
import { launchRealBrowser } from "../../test/helpers/chrome-devtools.js";

const directory = ".scratch/guest-ui-consistency/screenshots/07";
mkdirSync(directory, { recursive: true });
for (const state of ["draft", "review", "sent", "declined", "expired"] as const) {
  await withRequestScreen(state, async (fixture, path) => {
    const browser = await launchRealBrowser();
    try {
      const tab = await browser.createTab();
      await tab.setExtraHeaders({ cookie: fixture.cookie });
      for (const surface of ["page", "chat"] as const) {
        for (const width of [320, 390, 768, 1280]) {
          await tab.setViewport(width, 900);
          await tab.navigate(`${fixture.base}${surface === "page" ? path : `/?threadId=${fixture.threadId}`}`);
          await tab.waitForSelector(".request-screen", 10_000);
          await tab.waitForFunction("document.readyState === 'complete'", 10_000);
          await tab.evaluate("document.documentElement.dataset.theme = 'light'");
          const height = await tab.evaluate<number>("Math.max(document.documentElement.scrollHeight, document.querySelector('.request-screen').scrollHeight + 240)");
          await tab.setViewport(width, Math.min(2400, height));
          assert.equal(await tab.evaluate<boolean>("document.documentElement.scrollWidth <= innerWidth"), true, `${state}/${surface}/${width}: horizontal overflow`);
          const small = await tab.evaluate<unknown[]>("[...document.querySelectorAll('.request-screen button, .request-screen a')].filter(el => el.getBoundingClientRect().width && (el.getBoundingClientRect().height < 44 || el.getBoundingClientRect().width < 44)).map(el => ({text: el.textContent, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height}))");
          assert.deepEqual(small, [], `${state}/${surface}/${width}: targets under 44px`);
          writeFileSync(`${directory}/${state}-${surface}-light-${width}.png`, await tab.captureScreenshot());
          console.log(`${state}/${surface}/${width}: reflow and targets pass`);
        }
      }
    } finally { await browser.close(); }
  });
}
