import assert from "node:assert/strict";
import test from "node:test";
import { launchRealBrowser } from "./helpers/chrome-devtools.js";
import { restartFixture } from "./helpers/guest-restart.js";

// Issue 15 AC2 (and AC1/AC3 in a real engine): Tab reaches the skip link first, it is at least 44x44 when focused,
// and Enter moves focus to the main region.

test("AC2: The skip link moves focus to the main region", async () => {
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setViewport(390, 900);
    await tab.navigate(`${fixture.base}/stays/search?area=old-ikoyi&checkIn=2026-09-10&checkOut=2026-09-13&partySize=2`);
    await tab.waitForSelector("main#main-content", 10_000);
    await tab.pressKey("Tab");
    const active = await tab.evaluate<{ className: string; tag: string }>("(() => { const el = document.activeElement; return { className: el?.className ?? '', tag: el?.tagName ?? '' }; })()");
    assert.match(active.className, /ui-skip-link/, `the first Tab reaches the skip link (saw ${active.tag}.${active.className})`);
    const size = await tab.evaluate<{ width: number; height: number }>("(() => { const r = document.activeElement.getBoundingClientRect(); return { width: r.width, height: r.height }; })()");
    assert.ok(size.width >= 44 && size.height >= 44, `the focused skip link is ${size.width}x${size.height}`);
    await tab.pressKey("Enter");
    const focusedId = await tab.evaluate<string>("document.activeElement?.id ?? ''");
    assert.equal(focusedId, "main-content", "Enter moves focus to the main region");
  } finally {
    await browser.close();
    await fixture.close();
  }
});
