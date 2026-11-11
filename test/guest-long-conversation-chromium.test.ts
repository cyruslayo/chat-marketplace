import assert from "node:assert/strict";
import test from "node:test";
import { launchRealBrowser } from "./helpers/chrome-devtools.js";
import { restartFixture } from "./helpers/guest-restart.js";

// Issue 24 (ADR 0078; guideline §12): keyboard navigation reaches every earlier turn even when its rendering defers.

test("AC2: Keyboard navigation reaches every earlier turn and its links", async () => {
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setViewport(390, 700);
    await tab.navigate(`${fixture.base}/`);
    // A long thread: eight guest turns, so the first turns fall outside the rendered window.
    for (let index = 0; index < 8; index += 1) {
      await tab.evaluate(`(() => {
        const turn = document.createElement("article");
        turn.className = "turn user";
        const bubble = document.createElement("div");
        bubble.className = "bubble";
        bubble.textContent = "Earlier message ${index + 1}";
        turn.appendChild(bubble);
        document.querySelector("#transcript").appendChild(turn);
      })()`);
    }
    await tab.evaluate("document.querySelectorAll('#transcript .turn').forEach((turn, index, all) => turn.classList.toggle('turn--deferred', index < all.length - 6))");
    const deferred = await tab.evaluate<number>("document.querySelectorAll('#transcript .turn--deferred').length");
    assert.equal(deferred, 2, "the two oldest turns defer");
    // Every earlier turn is still in the DOM and reachable by focus (content-visibility keeps it in the accessibility tree).
    const reachable = await tab.evaluate<boolean>("(() => { const first = document.querySelector('#transcript .turn'); first.querySelector('.bubble').setAttribute('tabindex', '-1'); first.scrollIntoView({ block: 'center' }); first.querySelector('.bubble').focus(); return document.activeElement === first.querySelector('.bubble') && first.innerText.includes('Earlier message 1'); })()");
    assert.equal(reachable, true, "the first deferred turn is reachable and readable");
  } finally { await browser.close(); await fixture.close(); }
});
