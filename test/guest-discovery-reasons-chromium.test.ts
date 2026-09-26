import assert from "node:assert/strict";
import test from "node:test";
import { launchRealBrowser, type RealBrowserTab } from "./helpers/chrome-devtools.js";
import { restartFixture } from "./helpers/guest-restart.js";

/** Each card's width against the transcript column and the results list it sits in. */
async function widths(tab: RealBrowserTab) {
  return await tab.evaluate<{ readonly cards: readonly number[]; readonly list: number; readonly transcript: number; readonly overflow: boolean }>(`(() => {
    const list = document.querySelector('#active-workspace .stay-grid');
    const transcript = document.getElementById('transcript');
    const style = getComputedStyle(transcript);
    return {
      cards: [...document.querySelectorAll('#active-workspace .stay-card')].map((card) => card.getBoundingClientRect().width),
      list: list ? list.getBoundingClientRect().width : 0,
      transcript: transcript.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  })()`);
}

test("AC4: The card fills the transcript column width", async () => {
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setViewport(375, 812);
    await tab.navigate(`${fixture.base}/`);
    // AC3 in the browser: the quick replies are tappable and answer the question.
    await tab.focus("#composer-input");
    await tab.insertText("I need a place in Lagos for 2 guests");
    await tab.pressKey("Enter");
    await tab.waitForSelector(".quick-replies .quick-reply", 10_000);
    // An empty criteria chip says what it adds, even where the field name is visually hidden.
    assert.equal(await tab.evaluate<string>("document.querySelector('.criteria-chip[data-field=\"when\"]')?.lastChild?.textContent ?? ''"), "Add dates");
    assert.equal(await tab.clickButton("This weekend"), true);
    await tab.waitForText("Just to check", 10_000);
    assert.equal(await tab.evaluate<number>("document.querySelectorAll('.quick-replies').length"), 0, "answered quick replies are removed");

    await tab.focus("#composer-input");
    await tab.insertText("no, from 10 Sept for 3 nights");
    await tab.pressKey("Enter");
    await tab.waitForSelector("#active-workspace .stay-card", 10_000);
    assert.match(await tab.evaluate<string>("document.querySelector('.stay-card__fit')?.textContent ?? ''"), /^Why it fits: /);

    for (const [width, height] of [[375, 812], [1280, 800]] as const) {
      await tab.setCssViewport(width, height);
      const measured = await widths(tab);
      assert.ok(measured.cards.length >= 2, JSON.stringify(measured));
      // Failure path: a two-column grid would make each card about half the list.
      for (const card of measured.cards) assert.ok(Math.abs(card - measured.list) <= 1, `${width}px: card ${card} vs list ${measured.list}`);
      assert.ok(measured.list >= measured.transcript - 2 * 24 - 2, `${width}px: list ${measured.list} vs transcript column ${measured.transcript}`);
      assert.equal(measured.overflow, false);
    }
  } finally {
    await browser.close();
    await fixture.close();
  }
});
