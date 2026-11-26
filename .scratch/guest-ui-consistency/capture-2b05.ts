// Issue 2b-05 captures: the ported chip bar, criteria chips and composer, chat and the no-JS /conversation page,
// at 320/390/768/1280, light and dark, with overflow and 44px-target checks (ADR 0078).
// Usage: NODE_ENV=test npx tsx .scratch/guest-ui-consistency/capture-2b05.ts
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { withStagePage } from "../../test/helpers/guest-stage-pages.js";
import { launchRealBrowser } from "../../test/helpers/chrome-devtools.js";

const directory = ".scratch/guest-ui-consistency/screenshots/2b-05";
mkdirSync(directory, { recursive: true });

// Visible interactive targets of the shell and the no-JS page, measured in CSS pixels.
const TARGETS = `[...document.querySelectorAll('#composer-submit, .criteria-chip, .prompt-suggestion, .quick-reply, button, a')].filter((el) => {
  const box = el.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && (box.height < 44 || box.width < 44);
}).map((el) => ({ text: el.textContent?.trim().slice(0, 40), width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height }))`;

await withStagePage(
  { label: "Request review", stage: "review" },
  async ({ fixture, threadId }) => {
    const browser = await launchRealBrowser();
    try {
      const tab = await browser.createTab();
      await tab.setExtraHeaders({ cookie: fixture.cookie });
      for (const [name, route] of [
        ["chat", `/?threadId=${threadId}`],
        ["page", `/conversation?threadId=${threadId}`],
      ]) {
        for (const width of [320, 390, 768, 1280]) {
          const size = (height: number) => width < 768 ? tab.setViewport(width, height) : tab.setCssViewport(width, height);
          await size(900);
          await tab.navigate(`${fixture.base}${route}`);
          await tab.waitForFunction("document.readyState === 'complete'", 10_000);
          await tab.waitForSelector("#composer-submit", 10_000);
          await tab.evaluate("document.fonts.ready.then(() => true)");
          for (const theme of ["light", "dark"] as const) {
            await tab.evaluate(`document.documentElement.dataset.theme = '${theme}'`);
            await new Promise((resolve) => setTimeout(resolve, 300));
            const info = await tab.evaluate<{ height: number; overflow: number }>("({ height: document.documentElement.scrollHeight, overflow: document.documentElement.scrollWidth - innerWidth })");
            assert.ok(info.overflow <= 0, `${name}/${theme}/${width}: horizontal overflow ${info.overflow}px`);
            await size(Math.min(info.height, 4000));
            await new Promise((resolve) => setTimeout(resolve, 200));
            const small = await tab.evaluate<unknown[]>(TARGETS);
            assert.deepEqual(small, [], `${name}/${theme}/${width}: target under 44px`);
            writeFileSync(`${directory}/${name}-${theme}-${width}.png`, await tab.captureScreenshot());
            console.log(`${name}/${theme}/${width}: height ${info.height}, no overflow, targets pass`);
          }
        }
      }
    } finally {
      await browser.close();
    }
  },
);
