import assert from "node:assert/strict";
import type { RealBrowserInstance, RealBrowserTab } from "./chrome-devtools.js";
import type { restartFixture } from "./guest-restart.js";

type Fixture = Awaited<ReturnType<typeof restartFixture>>;

/** No horizontal page scroll, and every visible control at least 44 CSS pixels (ADR 0078). */
export async function assertReflowAndTargets(tab: RealBrowserTab, label: string): Promise<void> {
  const overflow = await tab.evaluate<boolean>("document.documentElement.scrollWidth > document.documentElement.clientWidth");
  assert.equal(overflow, false, `${label}: no horizontal page overflow`);
  const small = await tab.evaluate<string[]>(`Array.from(document.querySelectorAll('main a, main button, main input:not([type=hidden])'))
    .filter((element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0; })
    .filter((element) => element.getBoundingClientRect().height < 44 && !element.matches('input[type=radio], input[type=checkbox]'))
    .map((element) => element.outerHTML.slice(0, 80))`);
  assert.deepEqual(small, [], `${label}: every control is at least 44px`);
}

/**
 * Drives the real shell to a sent Booking Request that awaits the Operator. `beforeReview` runs once the stay results show, before
 * the Guest reviews the request, so a test can give the device's principal the contact details a booking needs.
 */
export async function sendRequest(
  browser: RealBrowserInstance,
  fixture: Fixture,
  viewport: readonly [number, number] = [375, 812],
  beforeReview?: (tab: RealBrowserTab) => Promise<void>,
): Promise<RealBrowserTab> {
  const tab = await browser.createTab();
  await tab.setViewport(viewport[0], viewport[1]);
  await tab.navigate(`${fixture.base}/`);
  await tab.focus("#composer-input");
  await tab.insertText("I need an apartment in Ikoyi from 10 Sept for 3 nights for 2 people");
  await tab.pressKey("Enter");
  for (const [button, next] of [["View apartment", "Request to Book"], ["Request to Book", "Review request"], ["Review request", "Submit Booking Request"], ["Submit Booking Request", "Waiting for"]] as const) {
    // On phones the results are compact rows and the cards stay hidden; the card's button still opens the stay (issue 05).
    if (button === "View apartment") {
      await tab.waitForSelector("#active-workspace .stay-card", 10_000);
      await beforeReview?.(tab);
    } else await tab.waitForText(button, 10_000);
    assert.equal(await tab.clickButton(button), true, button);
    await tab.waitForText(next, 10_000);
  }
  await tab.waitForSelector(".request-screen[data-waiting=\"operator-response\"]", 10_000);
  return tab;
}
