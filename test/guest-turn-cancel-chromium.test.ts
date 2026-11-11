import assert from "node:assert/strict";
import test from "node:test";
import { launchRealBrowser } from "./helpers/chrome-devtools.js";
import { restartFixture } from "./helpers/guest-restart.js";

// Issue 21 (ADR 0106; guideline §6, §12): a slow turn offers Cancel after the still-working threshold; cancelling keeps
// the message and says the server may still answer.

const TEXT = "I need an apartment in Ikoyi from 10 Sept for 3 nights for 2 people";

test("AC1 and AC2: Cancel appears after the still-working threshold, stops the wait and keeps the guest's text", async () => {
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setViewport(390, 900);
    await tab.navigate(`${fixture.base}/`);
    // Hold /api/turn open until the client aborts, then let /api/state answer normally.
    await tab.evaluate(`(() => {
      const original = window.fetch;
      window.fetch = (url, init) => String(url).includes('/api/turn')
        ? new Promise((_, reject) => { init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))); })
        : original(url, init);
    })()`);
    await tab.focus("#composer-input");
    await tab.insertText(TEXT);
    await tab.pressKey("Enter");
    await tab.waitForSelector("#turn-cancel:not([hidden])", 20_000);
    assert.equal(await tab.evaluate<boolean>("document.querySelector('#turn-cancel').getClientRects().length > 0"), true, "Cancel is visible after the threshold");
    await tab.clickButton("Cancel");
    await tab.waitForText("Stopped waiting. Your message may still be answered.", 10_000);
    const value = await tab.evaluate<string>("document.querySelector('#composer-input').value");
    assert.equal(value, TEXT, "the guest's message stays in the composer");
  } finally { await browser.close(); await fixture.close(); }
});
