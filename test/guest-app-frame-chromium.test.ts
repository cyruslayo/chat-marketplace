import assert from "node:assert/strict";
import test from "node:test";
import { launchRealBrowser, type RealBrowserTab } from "./helpers/chrome-devtools.js";
import { withStagePage } from "./helpers/guest-stage-pages.js";
import { restartFixture } from "./helpers/guest-restart.js";

const overflow = (tab: RealBrowserTab) => tab.evaluate<number>("document.documentElement.scrollWidth - innerWidth");
/** The rendered height of every visible control matching `selector`. */
const controlHeights = (tab: RealBrowserTab, selector: string) => tab.evaluate<number[]>(`[...document.querySelectorAll(${JSON.stringify(selector)})].filter((el) => el.getClientRects().length > 0).map((el) => Math.round(el.getBoundingClientRect().height))`);

test("AC4: at 320px no page or the chat scrolls sideways, and app bar, rail and criteria strip controls are at least 44px tall", async () => {
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setViewport(320, 720);
    await tab.setExtraHeaders({ cookie: fixture.cookie });
    await fixture.advance("discovery");

    // The chat: bar, rail and the criteria strip (collapsed to its summary, then opened).
    await tab.navigate(`${fixture.base}/?threadId=${fixture.threadId}`);
    await tab.waitForFunction("document.getElementById('journey-rail').hidden === false && document.getElementById('criteria-strip').hidden === false", 10_000);
    assert.ok(await overflow(tab) <= 0, "the chat does not scroll sideways");
    const bar = await controlHeights(tab, ".ui-appbar a, .ui-appbar button");
    assert.ok(bar.length >= 2, "the app bar has controls");
    assert.ok(bar.every((height) => height >= 44), `app bar controls are 44px or taller: ${bar}`);
    assert.ok((await controlHeights(tab, "#journey-rail a, #journey-rail button")).every((height) => height >= 44), "rail controls, if any, are 44px or taller");
    assert.ok((await controlHeights(tab, "#criteria-toggle")).every((height) => height >= 44), "the criteria toggle is 44px or taller");
    await tab.evaluate("document.getElementById('criteria-toggle').click()");
    await tab.waitForFunction("document.getElementById('criteria-toggle').getAttribute('aria-expanded') === 'true'", 5_000);
    const chips = await controlHeights(tab, ".criteria-chip");
    assert.ok(chips.length >= 3, "the criteria chips are shown");
    assert.ok(chips.every((height) => height >= 44), `criteria chips are 44px or taller: ${chips}`);
    assert.ok(await overflow(tab) <= 0, "the open strip does not scroll sideways");
  } finally {
    await browser.close();
    await fixture.close();
  }
  // Failure path: a page with long content still reflows, checked on a payment page with a bank account.
  await withStagePage({ label: "Provider bank transfer", stage: "payment-ready", start: "transfer" }, async ({ fixture: paying, path }) => {
    const other = await launchRealBrowser();
    try {
      const tab = await other.createTab();
      await tab.setViewport(320, 720);
      await tab.setExtraHeaders({ cookie: paying.cookie });
      await tab.navigate(`${paying.base}${path}`);
      await tab.waitForSelector(".ui-appbar", 10_000);
      assert.ok(await overflow(tab) <= 0, "the transfer page does not scroll sideways");
      const bar = await controlHeights(tab, ".ui-appbar a, .ui-appbar button");
      assert.ok(bar.length > 0 && bar.every((height) => height >= 44), `page app bar controls are 44px or taller: ${bar}`);
    } finally {
      await other.close();
    }
  });
});

test("AC5: with JavaScript disabled, the back control and the rail render and the back link works", async () => {
  await withStagePage({ label: "Request review", stage: "review" }, async ({ fixture, path, threadId }) => {
    const browser = await launchRealBrowser();
    try {
      const tab = await browser.createTab();
      await tab.setJavaScriptEnabled(false);
      await tab.setExtraHeaders({ cookie: fixture.cookie });
      await tab.navigate(`${fixture.base}${path}`);
      assert.equal(await tab.evaluate<number>("document.querySelectorAll('.ui-rail > li').length"), 6, "the rail renders");
      assert.equal(await tab.evaluate<string>("document.querySelector('.ui-rail > li[aria-current=\"step\"]')?.dataset.step ?? ''"), "request");
      assert.equal(await tab.evaluate<string>("document.querySelector('.ui-appbar .ui-icon-button')?.getAttribute('href') ?? ''"), `/?threadId=${threadId}`);
      // The back link works: it is a plain link to the conversation.
      await tab.evaluate("document.querySelector('.ui-appbar .ui-icon-button').click()");
      await tab.waitForFunction(`location.pathname === '/' && location.search === '?threadId=${threadId}'`, 10_000);
      assert.ok(await tab.evaluate<boolean>("Boolean(document.getElementById('composer'))"), "the conversation page loaded");
    } finally {
      await browser.close();
    }
  });
});
