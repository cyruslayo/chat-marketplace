import assert from "node:assert/strict";
import test from "node:test";
import { launchRealBrowser } from "./helpers/chrome-devtools.js";
import { restartFixture } from "./helpers/guest-restart.js";

// Issue 14 (ADR 0078; guideline §12): the first workspace receives focus, and each route has one H1 naming the task.

test("AC1: The first workspace receives focus on its heading", async () => {
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setViewport(390, 900);
    await tab.navigate(`${fixture.base}/`);
    await tab.focus("#composer-input");
    await tab.insertText("I need an apartment in Ikoyi from 10 Sept for 3 nights for 2 people");
    await tab.pressKey("Enter");
    await tab.waitForSelector("#active-workspace:not([hidden])", 15_000);
    const focused = await tab.evaluate<boolean>("document.querySelector('#active-workspace').contains(document.activeElement)");
    assert.equal(focused, true, "focus moves into the first workspace");
  } finally { await browser.close(); await fixture.close(); }
});

test("AC4: Each guest route has exactly one H1, naming the current task", async () => {
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setViewport(390, 900);
    await tab.navigate(`${fixture.base}/`);
    await tab.focus("#composer-input");
    await tab.insertText("I need an apartment in Ikoyi from 10 Sept for 3 nights for 2 people");
    await tab.pressKey("Enter");
    await tab.waitForSelector("#active-workspace:not([hidden])", 15_000);
    const h1 = await tab.evaluate<{ count: number; text: string }>("(() => ({ count: document.querySelectorAll('h1').length, text: document.querySelector('h1')?.textContent ?? '' }))()");
    assert.equal(h1.count, 1, "one H1 on the route");
    assert.ok(h1.text.trim() !== "" && h1.text.trim() !== "Shortlet", `the H1 names the task: ${h1.text}`);
  } finally { await browser.close(); await fixture.close(); }
});
