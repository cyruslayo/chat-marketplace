import assert from "node:assert/strict";
import test from "node:test";
import { launchRealBrowser, type RealBrowserTab } from "./helpers/chrome-devtools.js";
import { restartFixture } from "./helpers/guest-restart.js";

interface CellBox { readonly left: number; readonly top: number; readonly width: number }

/** Every attribute row's cell boxes, in document order. */
const cellBoxes = (tab: RealBrowserTab) => tab.evaluate<CellBox[][]>(`[...document.querySelectorAll('#active-workspace .compare-row')].map((row) =>
  [...row.querySelectorAll('.compare-cell')].map((cell) => { const box = cell.getBoundingClientRect(); return { left: Math.round(box.left), top: Math.round(box.top), width: Math.round(box.width) }; }))`);

const noHorizontalScroll = (tab: RealBrowserTab) => tab.evaluate<boolean>(`document.documentElement.scrollWidth <= document.documentElement.clientWidth
  && [...document.querySelectorAll('#active-workspace, #active-workspace *')].every((element) => element.scrollWidth <= element.clientWidth + 1 || !['auto', 'scroll'].includes(getComputedStyle(element).overflowX))`);

async function openComparison(tab: RealBrowserTab, base: string): Promise<void> {
  await tab.navigate(`${base}/`);
  await tab.focus("#composer-input");
  await tab.insertText("I need an apartment in Lagos from 10 Sept for 3 nights for 2 people");
  await tab.pressKey("Enter");
  await tab.waitForText("Compare", 10_000);
  // Card buttons take their context from the listed card, like "View apartment".
  const titles = await tab.evaluate<string[]>("[...document.querySelectorAll('#active-workspace .stay-card')].filter((card) => [...card.querySelectorAll('button')].some((button) => button.textContent.trim() === 'Compare')).map((card) => card.querySelector('.stay-card__title').textContent.trim())");
  assert.ok(titles.length >= 2, "each result has a Compare control");
  assert.equal(await tab.clickButton("Compare", titles[0]), true);
  await tab.waitForText("Remove from compare", 10_000);
  assert.equal(await tab.clickButton("Compare", titles[1]), true);
  await tab.waitForSelector("#active-workspace .compare-row .compare-cell", 10_000);
}

test("AC3: At 320px, the comparison stacks attributes vertically with no horizontal scroll", async () => {
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setCssViewport(320, 640);
    await openComparison(tab, fixture.base);
    const rows = await cellBoxes(tab);
    assert.equal(rows.length, 4, "price, deposit, capacity and amenities");
    for (const [first, second] of rows) {
      assert.ok(first && second);
      assert.equal(first.left, second.left, "stacked cells share a left edge");
      assert.ok(second.top > first.top, "the second stay sits under the first");
    }
    assert.equal(await noHorizontalScroll(tab), true);
    // Each stacked cell still names its stay.
    assert.equal(await tab.evaluate<boolean>("[...document.querySelectorAll('.compare-cell')].every((cell) => cell.querySelector('.compare-cell__unit')?.textContent.trim().length > 0)"), true);
    // The comparison is left for the same results.
    assert.equal(await tab.clickButton("Back to results"), true);
    await tab.waitForText("Remove from compare", 500).then(() => assert.fail("the pick was cleared"), () => undefined);
    await tab.waitForSelector("#active-workspace[data-surface-kind=\"discovery\"]", 10_000);
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test("AC3 control: at 1280px and 375px the comparison lays the stays out as expected", async () => {
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    const wide = await browser.createTab();
    await wide.setViewport(1280, 800);
    await openComparison(wide, fixture.base);
    for (const [first, second] of await cellBoxes(wide)) {
      assert.ok(first && second);
      assert.equal(first.top, second.top, "side by side on a wide screen");
      assert.ok(second.left > first.left);
    }
    assert.equal(await noHorizontalScroll(wide), true);

    const phone = await browser.createTab();
    await phone.setViewport(375, 812);
    await openComparison(phone, fixture.base);
    for (const [first, second] of await cellBoxes(phone)) {
      assert.ok(first && second);
      assert.equal(first.left, second.left);
    }
    assert.equal(await noHorizontalScroll(phone), true);
  } finally {
    await browser.close();
    await fixture.close();
  }
});
