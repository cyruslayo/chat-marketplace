import assert from "node:assert/strict";
import test from "node:test";
import { launchRealBrowser, type RealBrowserTab } from "./helpers/chrome-devtools.js";
import { restartFixture } from "./helpers/guest-restart.js";

/** Each card's width against the transcript column and the results list it sits in. */
async function widths(tab: RealBrowserTab) {
  return await tab.evaluate<{ readonly cards: readonly number[]; readonly rows: readonly number[]; readonly rowList: number; readonly list: number; readonly transcript: number; readonly overflow: boolean }>(`(() => {
    const list = document.querySelector('#active-workspace .stay-grid');
    const transcript = document.getElementById('transcript');
    const style = getComputedStyle(transcript);
    return {
      cards: [...document.querySelectorAll('#active-workspace .stay-card')].map((card) => card.getBoundingClientRect().width),
      rows: [...document.querySelectorAll('#active-workspace .ui-result-row')].map((row) => row.getBoundingClientRect().width),
      rowList: document.querySelector('#active-workspace .ui-result-rows')?.getBoundingClientRect().width ?? 0,
      list: list ? list.getBoundingClientRect().width : 0,
      transcript: transcript.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  })()`);
}

test("AC4: The result rows fill the transcript column width on phones, and the cards sit two to a row on wide screens", async () => {
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

    // Phones show one compact row per result; wide screens show two cards per row (issue 05).
    await tab.setCssViewport(375, 812);
    const phone = await widths(tab);
    assert.ok(phone.rows.length >= 2, JSON.stringify(phone));
    for (const row of phone.rows) assert.ok(Math.abs(row - phone.rowList) <= 1, `375px: row ${row} vs list ${phone.rowList}`);
    assert.ok(phone.rowList >= phone.transcript - 2 * 24 - 2, `375px: list ${phone.rowList} vs transcript column ${phone.transcript}`);
    assert.equal(phone.overflow, false);
    await tab.setCssViewport(1280, 800);
    const wide = await widths(tab);
    assert.ok(wide.cards.length >= 2, JSON.stringify(wide));
    // Failure path: a single column would make each card as wide as the list.
    for (const card of wide.cards) assert.ok(card < wide.list * 0.6, `1280px: card ${card} vs list ${wide.list}`);
    assert.equal(wide.overflow, false);
  } finally {
    await browser.close();
    await fixture.close();
  }
});
