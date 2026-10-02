import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { withStagePage } from "../../test/helpers/guest-stage-pages.js";
import { launchRealBrowser } from "../../test/helpers/chrome-devtools.js";

const directory = ".scratch/guest-ui-consistency/screenshots/08";
mkdirSync(directory, { recursive: true });
await withStagePage(
  { label: "offer", stage: "offer" },
  async ({ fixture, path, threadId }) => {
    const browser = await launchRealBrowser();
    try {
      const tab = await browser.createTab();
      await tab.setExtraHeaders({ cookie: fixture.cookie });
      for (const state of ["live", "expired"]) {
        if (state === "expired") fixture.setTime("2026-09-03T10:20:00Z");
        for (const [name, route] of [
          ["page", path],
          ["chat", `/?threadId=${threadId}`],
        ]) {
          for (const width of [320, 390, 768, 1280]) {
            await tab.setViewport(width, 900);
            await tab.navigate(`${fixture.base}${route}`);
            await tab.waitForSelector(
              `.offer-screen[data-offer-state="${state}"]`,
              10_000,
            );
            await tab.evaluate("document.fonts.ready.then(() => true)");
            await tab.evaluate(
              "document.documentElement.dataset.theme = 'light'",
            );
            const height = await tab.evaluate<number>(
              "document.documentElement.scrollHeight",
            );
            await tab.setViewport(width, Math.min(4000, height));
            assert.equal(
              await tab.evaluate<boolean>(
                "document.documentElement.scrollWidth <= innerWidth",
              ),
              true,
              `${state}/${name}/${width}: overflow`,
            );
            const small = await tab.evaluate<unknown[]>(
              "[...document.querySelectorAll('.offer-screen button, .offer-screen a')].filter(el => el.getBoundingClientRect().width && (el.getBoundingClientRect().height < 44 || el.getBoundingClientRect().width < 44)).map(el => ({text: el.textContent, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height}))",
            );
            assert.deepEqual(
              small,
              [],
              `${state}/${name}/${width}: target under 44px`,
            );
            writeFileSync(
              `${directory}/${state}-${name}-light-${width}.png`,
              await tab.captureScreenshot(),
            );
            console.log(`${state}/${name}/${width}: reflow and targets pass`);
          }
        }
      }
    } finally {
      await browser.close();
    }
  },
);
