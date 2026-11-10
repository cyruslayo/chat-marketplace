import assert from "node:assert/strict";
import test from "node:test";
import { launchRealBrowser } from "./helpers/chrome-devtools.js";
import { restartFixture } from "./helpers/guest-restart.js";

// Issue 25 (ADR 0078; guideline §7, §12): at 320 and 390 the composer and Send stay visible while there is text, and the
// composer text is at least 16px.

for (const width of [320, 390] as const) {
  test(`AC2 and AC3 at ${width}: the composer and Send stay visible and text is at least 16px`, async () => {
    const fixture = await restartFixture();
    const browser = await launchRealBrowser();
    try {
      const tab = await browser.createTab();
      await tab.setViewport(width, 700);
      await tab.navigate(`${fixture.base}/`);
      await tab.waitForSelector("#composer-input", 10_000);
      const size = await tab.evaluate<{ input: number; submit: boolean; inView: boolean }>(`(() => {
        const input = document.querySelector('#composer-input');
        const submit = document.querySelector('#composer-submit');
        const rect = input.getBoundingClientRect();
        return { input: parseFloat(getComputedStyle(input).fontSize), submit: submit.getClientRects().length > 0, inView: rect.top < innerHeight && rect.bottom > 0 };
      })()`);
      assert.ok(size.input >= 16, `composer text is ${size.input}px`);
      assert.equal(size.submit, true, "Send is visible");
      assert.equal(size.inView, true, "the composer is in view");
    } finally { await browser.close(); await fixture.close(); }
  });
}
