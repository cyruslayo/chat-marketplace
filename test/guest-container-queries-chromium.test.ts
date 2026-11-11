import assert from "node:assert/strict";
import test from "node:test";
import { launchRealBrowser, type RealBrowserTab } from "./helpers/chrome-devtools.js";
import { restartFixture } from "./helpers/guest-restart.js";

// Issue 18 (ADR 0078; guideline §7): kit layout follows its column, not the viewport.

async function openChat(fixture: Awaited<ReturnType<typeof restartFixture>>, tab: RealBrowserTab, width: number): Promise<void> {
  await tab.setViewport(width, 900);
  await tab.setExtraHeaders({ cookie: fixture.cookie });
  await tab.navigate(`${fixture.base}/?threadId=${fixture.threadId}`);
  await tab.waitForSelector("#active-workspace .ui-stay-card", 15_000);
}

test("AC1: In the 1280 split view, compare uses its narrow layout inside the workspace and facts stay two-column", async () => {
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    // Two results so the compare control exists.
    const [first] = fixture.environment.unitRepository.findAll();
    assert.ok(first);
    fixture.environment.unitRepository.save({ ...first, id: "unit-lagos-ikoyi-003", title: "Garden 2-Bedroom Apartment in Old Ikoyi" });
    await fixture.advance("discovery");
    const tab = await browser.createTab();
    await openChat(fixture, tab, 1280);
    // Facts inside the real workspace container: a label/value list fits two columns down to about 30rem, so the value
    // sits beside its label in the desktop workspace (it stacks only in a phone-width column; see AC3).
    const factsSideBySide = await tab.evaluate<boolean>(`(() => { const dl = document.createElement("dl"); dl.className = "ui-facts"; dl.innerHTML = "<dt>Check-in</dt><dd>10 Sept 2026</dd>"; document.querySelector("#active-workspace").append(dl); const dt = dl.querySelector("dt").getBoundingClientRect(); const dd = dl.querySelector("dd").getBoundingClientRect(); const sideBySide = dd.top < dt.bottom - 1; dl.remove(); return sideBySide; })()`);
    assert.equal(factsSideBySide, true, "the workspace facts stay two-column");
    // Compare in the same workspace: the compact rows offer "See both side by side" with two results.
    assert.equal(await tab.clickButton("See both side by side"), true);
    await tab.waitForSelector("#active-workspace .ui-compare", 15_000);
    const compareStacked = await tab.evaluate<boolean>("(() => { const cells = [...document.querySelector('#active-workspace .ui-compare__row').children].map((el) => el.getBoundingClientRect()); return cells[1].top >= cells[0].bottom - 1; })()");
    assert.equal(compareStacked, true, "the workspace comparison stacks");
  } finally { await browser.close(); await fixture.close(); }
});

test("AC2: On a 1280 standard page with a wide main region, compare and facts use the wide layout", async () => {
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setViewport(1280, 900);
    await tab.navigate(`${fixture.base}/stays/search?area=old-ikoyi&checkIn=2026-09-10&checkOut=2026-09-13&partySize=2`);
    await tab.waitForSelector("main.ui-page", 10_000);
    const factsWide = await tab.evaluate<boolean>(`(() => { const main = document.querySelector("main.ui-page"); const dl = document.createElement("dl"); dl.className = "ui-facts"; dl.innerHTML = "<dt>Check-in</dt><dd>10 Sept 2026</dd>"; main.append(dl); const dt = dl.querySelector("dt").getBoundingClientRect(); const dd = dl.querySelector("dd").getBoundingClientRect(); const sideBySide = dd.top < dt.bottom - 1; dl.remove(); return sideBySide; })()`);
    assert.equal(factsWide, true, "the standard-page facts are side by side");
    const compareWide = await tab.evaluate<boolean>(`(() => { const main = document.querySelector("main.ui-page"); const table = document.createElement("div"); table.className = "ui-compare"; table.innerHTML = '<div class="ui-compare__row"><span>Key</span><span>A</span><span>B</span></div>'; main.append(table); const cells = [...table.querySelector(".ui-compare__row").children].map((el) => el.getBoundingClientRect()); const sideBySide = Math.abs(cells[0].top - cells[1].top) < 1; table.remove(); return sideBySide; })()`);
    assert.equal(compareWide, true, "the standard-page comparison is side by side");
  } finally { await browser.close(); await fixture.close(); }
});

test("AC3: There is no overflow at 320 in chat or on a standard page", async () => {
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    await fixture.advance("discovery");
    const tab = await browser.createTab();
    await openChat(fixture, tab, 320);
    const chatOverflow = await tab.evaluate<number>("document.documentElement.scrollWidth - innerWidth");
    assert.equal(chatOverflow, 0, "chat at 320 does not overflow");
    // Failure path: in a phone-width column the facts stack.
    const factsStacked = await tab.evaluate<boolean>(`(() => { const dl = document.createElement("dl"); dl.className = "ui-facts"; dl.innerHTML = "<dt>Check-in</dt><dd>10 Sept 2026</dd>"; document.querySelector("#active-workspace").append(dl); const dt = dl.querySelector("dt").getBoundingClientRect(); const dd = dl.querySelector("dd").getBoundingClientRect(); const stacked = dd.top >= dt.bottom - 1; dl.remove(); return stacked; })()`);
    assert.equal(factsStacked, true, "facts stack at 320");
    await tab.navigate(`${fixture.base}/stays/search?area=old-ikoyi&checkIn=2026-09-10&checkOut=2026-09-13&partySize=2`);
    await tab.waitForSelector("main.ui-page", 10_000);
    const pageOverflow = await tab.evaluate<number>("document.documentElement.scrollWidth - innerWidth");
    assert.equal(pageOverflow, 0, "standard page at 320 does not overflow");
  } finally { await browser.close(); await fixture.close(); }
});
