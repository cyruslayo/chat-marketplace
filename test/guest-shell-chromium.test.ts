import assert from "node:assert/strict";
import test from "node:test";
import { launchRealBrowser } from "./helpers/chrome-devtools.js";
import { restartFixture } from "./helpers/guest-restart.js";

// Issue 15 (AppBar and SideNavigationGuest READMEs): from 48rem the side navigation carries the wordmark and the mode
// label, so each is shown once; below 48rem the tab bar carries the places. Issue 11: a Your stays row has no list marker.

const VISIBLE_COUNT = (selector: string) =>
  `[...document.querySelectorAll(${JSON.stringify(selector)})].filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden").length`;

test("AC1: At 768 and 1280 the wordmark and the mode label show once, in the side navigation", async () => {
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    for (const width of [768, 1280]) {
      await tab.setViewport(width, 900);
      await tab.navigate(`${fixture.base}/`);
      assert.equal(await tab.evaluate<number>(VISIBLE_COUNT(".ui-sidenav")), 1, `side navigation shows at ${width}`);
      assert.equal(await tab.evaluate<number>(VISIBLE_COUNT(".ui-tabbar")), 0, `tab bar hidden at ${width}`);
      assert.equal(await tab.evaluate<number>(VISIBLE_COUNT(".ui-brand, .ui-appbar__brand")), 1, `one wordmark at ${width}`);
      assert.equal(await tab.evaluate<number>(VISIBLE_COUNT(".ui-mode-label")), 1, `one mode label at ${width}`);
      assert.equal(await tab.evaluate<number>(VISIBLE_COUNT("#new-conversation")), 1, `the chat header keeps its action at ${width}`);
    }
  } finally { await browser.close(); await fixture.close(); }
});

test("AC2: At 390 the tab bar carries the places and the side navigation is hidden", async () => {
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setViewport(390, 844);
    await tab.navigate(`${fixture.base}/`);
    assert.equal(await tab.evaluate<number>(VISIBLE_COUNT(".ui-tabbar")), 1, "tab bar shows");
    assert.equal(await tab.evaluate<number>(VISIBLE_COUNT(".ui-sidenav")), 0, "side navigation hidden");
    assert.equal(await tab.evaluate<number>(VISIBLE_COUNT(".ui-brand, .ui-appbar__brand")), 1, "one wordmark");
  } finally { await browser.close(); await fixture.close(); }
});

test("AC3: Result rows (Your stays and search) render without a list marker", async () => {
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setViewport(390, 844);
    await tab.navigate(`${fixture.base}/plans`);
    await tab.waitForFunction("document.readyState === 'complete' && document.styleSheets.length > 0", 5_000);
    const style = await tab.evaluate<string>(`(() => {
      const list = document.createElement("ul");
      list.className = "ui-result-rows";
      list.innerHTML = "<li>row</li>";
      document.body.append(list);
      const item = getComputedStyle(list.firstElementChild);
      const result = [getComputedStyle(list).listStyleType, getComputedStyle(list).paddingInlineStart, item.display].join("|");
      list.remove();
      return result;
    })()`);
    assert.equal(style, "none|0px|list-item");
  } finally { await browser.close(); await fixture.close(); }
});
