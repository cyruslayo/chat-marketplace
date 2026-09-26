import assert from "node:assert/strict";
import test from "node:test";
import { launchRealBrowser, type RealBrowserTab } from "./helpers/chrome-devtools.js";
import { restartFixture } from "./helpers/guest-restart.js";

/** Presses Tab until the element matching `selector` has focus, as a keyboard user would. */
async function tabTo(tab: RealBrowserTab, selector: string): Promise<void> {
  for (let presses = 0; presses < 80; presses++) {
    if (await tab.evaluate<boolean>(`document.activeElement?.matches(${JSON.stringify(selector)}) === true`)) return;
    await tab.pressKey("Tab");
  }
  assert.fail(`Tab never reached ${selector}`);
}

const chipLabel = (tab: RealBrowserTab, field: string) =>
  tab.evaluate<string>(`document.querySelector('.criteria-chip[data-field="${field}"]')?.textContent ?? ''`);
const stripHeight = (tab: RealBrowserTab) => tab.evaluate<number>("document.getElementById('criteria-strip').getBoundingClientRect().height");
const expanded = (tab: RealBrowserTab) => tab.evaluate<boolean>("document.getElementById('criteria-toggle').getAttribute('aria-expanded') === 'true'");

/** On a phone the chips sit behind "Edit search"; open them from the keyboard. */
async function expandByKeyboard(tab: RealBrowserTab): Promise<void> {
  if (await expanded(tab)) return;
  await tabTo(tab, "#criteria-toggle");
  await tab.pressKey("Enter");
  await tab.waitForFunction("document.getElementById('criteria-toggle').getAttribute('aria-expanded') === 'true'", 5_000);
}

test("AC5: The strip can be operated by keyboard alone and reflows at 320px", async () => {
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setViewport(375, 812);
    await tab.navigate(`${fixture.base}/`);
    await tab.focus("#composer-input");
    await tab.insertText("I need an apartment in Ikoyi from 10 Sept for 3 nights for 2 people");
    await tab.pressKey("Enter");
    await tab.waitForFunction("document.getElementById('criteria-strip').hidden === false", 10_000);
    assert.equal(await chipLabel(tab, "guests"), "Guests: 2 guests");

    // Review decision: on a phone the strip is one summary line of the filled criteria.
    assert.equal(await tab.evaluate<string>("document.getElementById('criteria-summary').textContent"), "Old Ikoyi, Lagos · 10–13 Sept 2026 · 3 nights · 2 guests");
    assert.equal(await expanded(tab), false);
    assert.ok(await stripHeight(tab) <= 70, `collapsed strip is one line (${await stripHeight(tab)}px)`);
    // Failure path: the chips are not reachable until the strip is expanded.
    assert.equal(await tab.evaluate<boolean>("document.querySelector('.criteria-chip').getClientRects().length === 0"), true);

    // Expand, then open the Guests editor with the keyboard; focus lands in the field.
    await expandByKeyboard(tab);
    await tabTo(tab, '.criteria-chip[data-field="guests"]');
    await tab.pressKey("Enter");
    await tab.waitForFunction("document.activeElement?.id === 'criteria-guests'", 5_000);
    assert.equal(await tab.evaluate<string>("document.querySelector('.criteria-chip[data-field=\"guests\"]').getAttribute('aria-expanded')"), "true");

    // Escape closes it and returns focus to the chip.
    await tab.pressKey("Escape");
    await tab.waitForFunction("document.activeElement?.matches('.criteria-chip[data-field=\"guests\"]') === true", 5_000);
    assert.equal(await tab.evaluate<boolean>("document.getElementById('criteria-editor').hidden"), true);

    // Edit by keyboard: reopen, replace the value, submit with Enter. The strip folds back to its summary.
    await tab.pressKey("Enter");
    await tab.waitForFunction("document.activeElement?.id === 'criteria-guests'", 5_000);
    await tab.pressKey("Backspace");
    await tab.insertText("3");
    await tab.pressKey("Enter");
    await tab.waitForFunction("document.querySelector('.criteria-chip[data-field=\"guests\"]')?.textContent === 'Guests: 3 guests'", 10_000);
    assert.match(await tab.evaluate<string>("document.querySelector('#active-workspace .fallback-link')?.getAttribute('href') ?? ''"), /partySize=3/);
    assert.equal(await expanded(tab), false);
    assert.match(await tab.evaluate<string>("document.getElementById('criteria-summary').textContent"), /· 3 guests$/);

    // A refused edit is explained inline and the chip keeps its value (AC3 in the browser).
    await expandByKeyboard(tab);
    await tabTo(tab, '.criteria-chip[data-field="when"]');
    await tab.pressKey("Enter");
    await tab.waitForFunction("document.activeElement?.id === 'criteria-check-in'", 5_000);
    await tabTo(tab, "#criteria-nights");
    await tab.pressKey("Backspace");
    await tab.insertText("15");
    await tab.pressKey("Enter");
    await tab.waitForText("Stays can be at most 14 nights", 10_000);
    assert.equal(await tab.evaluate<string>("document.getElementById('criteria-status').getAttribute('role')"), "alert");
    assert.equal(await chipLabel(tab, "when"), "When: 10–13 Sept 2026 · 3 nights");
    await tab.pressKey("Escape");

    // Undo by keyboard.
    await tabTo(tab, ".criteria-undo");
    await tab.pressKey("Enter");
    await tab.waitForFunction("document.querySelector('.criteria-chip[data-field=\"guests\"]')?.textContent === 'Guests: 2 guests'", 10_000);

    // ADR-0078: 44px targets, and at 320px neither the summary nor the expanded chips widen the page.
    await expandByKeyboard(tab);
    const heights = await tab.evaluate<number[]>("[...document.querySelectorAll('#criteria-strip button')].filter((button) => button.getClientRects().length > 0).map((button) => button.getBoundingClientRect().height)");
    assert.ok(heights.length >= 4 && heights.every((height) => height >= 44), JSON.stringify(heights));
    await tab.setCssViewport(320, 640);
    const layout = () => tab.evaluate<{ readonly overflow: boolean; readonly inside: boolean }>(
      "({ overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, inside: [...document.querySelectorAll('#criteria-strip button')].filter((button) => button.getClientRects().length > 0).every((button) => button.getBoundingClientRect().right <= document.documentElement.clientWidth) })",
    );
    assert.deepEqual(await layout(), { overflow: false, inside: true });
    await tab.evaluate("document.getElementById('criteria-toggle').click()");
    assert.deepEqual(await layout(), { overflow: false, inside: true });
    assert.ok(await stripHeight(tab) <= 70, `collapsed at 320px (${await stripHeight(tab)}px)`);
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test("Review decision: at 48rem and wider the chips are always shown and there is no Edit search toggle", async () => {
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setViewport(1280, 800);
    await tab.navigate(`${fixture.base}/`);
    await tab.focus("#composer-input");
    await tab.insertText("I need an apartment in Ikoyi from 10 Sept for 3 nights for 2 people");
    await tab.pressKey("Enter");
    await tab.waitForFunction("document.getElementById('criteria-strip').hidden === false", 10_000);
    assert.equal(await tab.evaluate<boolean>("document.getElementById('criteria-toggle').getClientRects().length === 0"), true);
    assert.equal(await tab.evaluate<boolean>("document.querySelector('.criteria-chip').getClientRects().length > 0"), true);
  } finally {
    await browser.close();
    await fixture.close();
  }
});
