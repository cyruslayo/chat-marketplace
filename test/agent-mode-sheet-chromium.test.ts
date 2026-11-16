import assert from "node:assert/strict";
import test from "node:test";
import { launchRealBrowser } from "./helpers/chrome-devtools.js";
import { startLocalGuestServer } from "../apps/local-guest/src/guest-server.js";
import { ScriptedAssistantModel } from "../apps/local-guest/src/assistant/scripted-assistant-model.js";
import { createFakeShopPack } from "./helpers/fake-domain-pack.js";

/*
 * Issue 03g of the agent-modes effort (ADR 0107 decision 9, ADR 0078): the mode sheet opened from the app-bar mark, in real Chrome.
 * Run this file solo. The fake shop pack is registered only here, so two modes are offered (stays and shop).
 */

async function startTwoModeServer() {
  const server = startLocalGuestServer({
    conciergeMode: "assistant-offline",
    modelClient: new ScriptedAssistantModel([]),
    additionalPacks: [createFakeShopPack()],
    port: 0,
  });
  const base = `http://127.0.0.1:${await server.listen()}`;
  return { server, base, close: () => server.close() };
}

/** Every visible control of the chooser and the mark, measured in CSS pixels (ADR 0078: 44 by 44 at least). */
const CONTROL_SIZES = `(() => Array.from(document.querySelectorAll('.mode-choice, .mode-mark, .mode-sheet__close')).map((el) => {
  const box = el.getBoundingClientRect();
  return { name: el.className, width: box.width, height: box.height };
}))()`;

test("AC6: The sheet opens from the mark, closes on Escape and Close, returns focus to the mark, and adds no history entry", async () => {
  const fixture = await startTwoModeServer();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setViewport(1280, 900);
    await tab.navigate(`${fixture.base}/`);
    await tab.waitForSelector(".mode-mark");

    const historyBefore = await tab.evaluate<number>("history.length");
    await tab.evaluate("document.querySelector('.mode-mark').focus(); document.querySelector('.mode-mark').click()");
    await tab.waitForFunction("document.querySelector('dialog.mode-sheet')?.open === true", 5_000);
    assert.equal(await tab.evaluate<number>("history.length"), historyBefore, "opening the sheet adds no history entry");

    await tab.pressKey("Escape");
    await tab.waitForFunction("document.querySelector('dialog.mode-sheet')?.open !== true", 5_000);
    await tab.waitForFunction("document.activeElement === document.querySelector('.mode-mark')", 5_000);

    await tab.evaluate("document.querySelector('.mode-mark').focus(); document.querySelector('.mode-mark').click()");
    await tab.waitForFunction("document.querySelector('dialog.mode-sheet')?.open === true", 5_000);
    await tab.evaluate("document.querySelector('.mode-sheet__close').click()");
    await tab.waitForFunction("document.querySelector('dialog.mode-sheet')?.open !== true", 5_000);
    await tab.waitForFunction("document.activeElement === document.querySelector('.mode-mark')", 5_000);
    assert.equal(await tab.evaluate<number>("history.length"), historyBefore, "closing the sheet adds no history entry");
    await tab.close();
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test("AC8: Every chooser control is at least 44 by 44 CSS pixels and nothing overflows at 320 px", async () => {
  const fixture = await startTwoModeServer();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setViewport(320, 640);
    await tab.navigate(`${fixture.base}/`);
    await tab.waitForSelector(".mode-mark");
    await tab.evaluate("document.querySelector('.mode-mark').focus(); document.querySelector('.mode-mark').click()");
    await tab.waitForFunction("document.querySelector('dialog.mode-sheet')?.open === true", 5_000);

    const sizes = await tab.evaluate<{ name: string; width: number; height: number }[]>(CONTROL_SIZES);
    assert.ok(sizes.length >= 4, "the mark, two choices and Close are measured");
    for (const control of sizes) {
      assert.ok(control.width >= 44 && control.height >= 44, `${control.name} is at least 44 by 44 (got ${control.width} by ${control.height})`);
    }
    const overflow = await tab.evaluate<boolean>("document.documentElement.scrollWidth > document.documentElement.clientWidth");
    assert.equal(overflow, false, "no horizontal page scroll at 320 px");
    await tab.close();
  } finally {
    await browser.close();
    await fixture.close();
  }
});
