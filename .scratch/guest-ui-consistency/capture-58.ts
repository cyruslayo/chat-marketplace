// Issue 58 captures: the structured "Just me" chip clarification at 320/390/768/1280, light and dark.
// Usage: NODE_ENV=test tsx .scratch/guest-ui-consistency/capture-58.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchRealBrowser } from "../../test/helpers/chrome-devtools.js";
import { restartFixture } from "../../test/helpers/guest-restart.js";
import { scriptedPlanner, STAGING_GUEST_CONFIG } from "../../test/helpers/guest-date-fixtures.js";

const out = join(import.meta.dirname, "screenshots", "58");
mkdirSync(out, { recursive: true });

const model = scriptedPlanner({
  "Apartment in Lekki Phase 1, Lagos": { slots: { city: "Lagos", neighbourhood: "Lekki Phase 1" }, intents: ["search"], search: { city: "Lagos", neighbourhood: "Lekki Phase 1" } },
  "From 12 November 2026 for 6 nights": { slots: { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-11-12", nights: 6 }, intents: ["search"], search: { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-11-12", nights: 6 } },
}).client;

const fixture = await restartFixture({ ...STAGING_GUEST_CONFIG }, { modelClient: model, conciergeMode: "assistant-offline" });
fixture.setTime("2026-10-27T10:00:00Z");
const browser = await launchRealBrowser();
try {
  for (const width of [320, 390, 768, 1280]) {
    const tab = await browser.createTab();
    try {
      const size = (height: number) => width < 768 ? tab.setViewport(width, height) : tab.setCssViewport(width, height);
      await size(900);
      await tab.navigate(`${fixture.base}/`);
      await tab.focus("#composer-input");
      await tab.insertText("Apartment in Lekki Phase 1, Lagos");
      await tab.pressKey("Enter");
      await tab.waitForFunction("document.querySelectorAll('.turn.assistant').length >= 1", 15_000);
      await tab.focus("#composer-input");
      await tab.insertText("From 12 November 2026 for 6 nights");
      await tab.pressKey("Enter");
      await tab.waitForSelector(".quick-replies .quick-reply", 15_000);
      for (const theme of ["light", "dark"] as const) {
        await tab.evaluate(`document.documentElement.setAttribute('data-theme', '${theme}')`);
        await new Promise((resolve) => setTimeout(resolve, 300));
        const info = await tab.evaluate<{ height: number; overflow: number }>("({ height: document.documentElement.scrollHeight, overflow: document.documentElement.scrollWidth - innerWidth })");
        await size(Math.min(info.height, 4000));
        await new Promise((resolve) => setTimeout(resolve, 200));
        writeFileSync(join(out, `chips-${theme}-${width}.png`), await tab.captureScreenshot());
        console.log(`chips-${theme}-${width}: height ${info.height}${info.overflow > 0 ? ` HORIZONTAL OVERFLOW ${info.overflow}px` : ""}`);
      }
    } finally {
      await tab.close();
    }
  }
} finally {
  await browser.close();
  await fixture.close();
}
