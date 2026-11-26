// Issue 2b-05 captures: the ported concierge chooser — the two-mode strip on the empty state and the opened sheet —
// at 320/390/768/1280, light and dark, with overflow and 44px-target checks (ADR 0078). The fake shop pack is
// registered only here, so two modes are offered (stays and shop), exactly like test/agent-mode-sheet-chromium.test.ts.
// Usage: NODE_ENV=test npx tsx .scratch/guest-ui-consistency/capture-2b05b.ts
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { startLocalGuestServer } from "../../apps/local-guest/src/guest-server.js";
import { ScriptedAssistantModel } from "../../apps/local-guest/src/assistant/scripted-assistant-model.js";
import { createFakeShopPack } from "../../test/helpers/fake-domain-pack.js";
import { launchRealBrowser } from "../../test/helpers/chrome-devtools.js";

const directory = ".scratch/guest-ui-consistency/screenshots/2b-05";
mkdirSync(directory, { recursive: true });

const server = startLocalGuestServer({
  conciergeMode: "assistant-offline",
  modelClient: new ScriptedAssistantModel([]),
  additionalPacks: [createFakeShopPack()],
  port: 0,
});
const base = `http://127.0.0.1:${await server.listen()}`;

const TARGETS = `[...document.querySelectorAll('.mode-choice, .mode-mark, .mode-sheet__close, #composer-submit, .prompt-suggestion')].filter((el) => {
  const box = el.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && (box.height < 44 || box.width < 44);
}).map((el) => ({ name: el.className, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height }))`;

const browser = await launchRealBrowser();
try {
  for (const width of [320, 390, 768, 1280]) {
    const tab = await browser.createTab();
    try {
      const size = (height: number) => width < 768 ? tab.setViewport(width, height) : tab.setCssViewport(width, height);
      await size(900);
      await tab.navigate(`${base}/`);
      await tab.waitForSelector(".mode-mark", 10_000);
      await tab.waitForSelector(".mode-choices .mode-choice", 10_000);
      for (const [name, open] of [["chooser-strip", false], ["chooser-sheet", true]] as const) {
        if (open) {
          await tab.evaluate("document.querySelector('.mode-mark').focus(); document.querySelector('.mode-mark').click()");
          await tab.waitForFunction("document.querySelector('dialog.mode-sheet')?.open === true", 5_000);
        }
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
        if (open) {
          await tab.evaluate("document.querySelector('.mode-sheet__close').click()");
          await tab.waitForFunction("document.querySelector('dialog.mode-sheet')?.open !== true", 5_000);
        }
      }
    } finally {
      await tab.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
