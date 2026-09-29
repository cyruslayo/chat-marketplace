import assert from "node:assert/strict";
import test from "node:test";
import { launchRealBrowser, type RealBrowserTab } from "./helpers/chrome-devtools.js";
import { restartFixture } from "./helpers/guest-restart.js";

const SEARCH = "/stays/search?area=old-ikoyi&checkIn=2026-09-10&checkOut=2026-09-13&partySize=2";
const STAY = "I need an apartment in Ikoyi from 10 Sept for 3 nights for 2 people";

/** The parts of a stay card that both the page and the workspace draw, with the action's tag ignored. */
const CARD_PARTS = `(root) => {
  const pick = (selector) => root.querySelector(selector)?.outerHTML.replace(/ data-[a-z-]+="[^"]*"/g, "").trim() ?? null;
  const view = root.querySelector(".ui-stay-card__view");
  return { photo: pick(".ui-stay-card__photo"), where: pick(".ui-stay-card__where"), title: pick(".ui-stay-card__title"), facts: pick(".ui-stay-card__facts"), total: pick(".ui-stay-card__total"), viewText: view ? (() => { const copy = view.cloneNode(true); copy.querySelectorAll(".ui-sr-only").forEach((node) => node.remove()); return copy.textContent.trim(); })() : null, viewClasses: [...(view?.classList ?? [])].filter((name) => name.startsWith("ui-")).sort() };
}`;

async function openChat(tab: RealBrowserTab, base: string, cookie: string, threadId: string, width: number): Promise<void> {
  await tab.setViewport(width, 900);
  await tab.setExtraHeaders({ cookie });
  await tab.navigate(`${base}/?threadId=${threadId}`);
  await tab.waitForSelector("#active-workspace .ui-stay-card", 15_000);
}

test("AC1: the search page and the chat workspace render each stay with the same .ui-stay-card structure and text for the same search", async () => {
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    await fixture.advance("discovery");
    const tab = await browser.createTab();
    await openChat(tab, fixture.base, fixture.cookie, fixture.threadId, 1280);
    const both = await tab.evaluate<{ chat: Record<string, unknown>; page: Record<string, unknown> }>(`(async () => {
      const parts = ${CARD_PARTS};
      const html = await (await fetch(${JSON.stringify(SEARCH)})).text();
      const page = new DOMParser().parseFromString(html, "text/html").querySelector(".ui-stay-card");
      return { chat: parts(document.querySelector("#active-workspace .ui-stay-card")), page: parts(page) };
    })()`);
    assert.ok(both.page.total && both.page.where, "the page card is complete");
    assert.deepEqual(both.chat, both.page);
    // The chat's extras (fit reason, Compare) sit inside the same card without changing its parts.
    assert.equal(await tab.evaluate<boolean>("Boolean(document.querySelector('#active-workspace .ui-stay-card .stay-card__fit'))"), true);
    // AC3 in the workspace: the money figure and its label precede the deposit, and there is no rating, badge or map.
    const text = await tab.evaluate<string>("document.querySelector('#active-workspace .ui-stay-card').innerText");
    assert.ok(text.indexOf("All-In Stay Total for 3 nights") < text.indexOf("Refundable Security Deposit (separate)"));
    assert.doesNotMatch(text, /Verified|★|rating/i);
  } finally { await browser.close(); await fixture.close(); }
});

test("AC2: in the chat each discovery result is a compact row with the title and All-In Stay Total, and activating it opens that stay", async () => {
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setViewport(390, 900);
    await tab.navigate(`${fixture.base}/`);
    await tab.focus("#composer-input");
    await tab.insertText(STAY);
    await tab.pressKey("Enter");
    await tab.waitForSelector("#active-workspace .ui-result-row", 15_000);
    const row = await tab.evaluate<{ visible: boolean; text: string; cardsHidden: boolean }>(`(() => { const row = document.querySelector("#active-workspace .ui-result-row"); return { visible: row.getClientRects().length > 0, text: row.innerText, cardsHidden: document.querySelector("#active-workspace .stay-grid").getClientRects().length === 0 }; })()`);
    assert.equal(row.visible, true);
    assert.match(row.text, /Luxury 2-Bedroom Apartment in Old Ikoyi/);
    assert.match(row.text, /₦370,000/);
    assert.match(row.text, /All-In Stay Total for 3 nights/);
    assert.equal(row.cardsHidden, true, "phones show rows for the inline results, not the cards");
    await tab.evaluate("document.querySelector('#active-workspace .ui-result-row').click()");
    await tab.waitForSelector("#active-workspace .unit-detail-root", 15_000);
    assert.equal(await tab.evaluate<boolean>("document.querySelector('#active-workspace').textContent.includes('Luxury 2-Bedroom Apartment in Old Ikoyi')"), true);
  } finally { await browser.close(); await fixture.close(); }
});

test("AC2 failure path: with no results the existing empty state shows and no rows render", async () => {
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setViewport(390, 900);
    await tab.navigate(`${fixture.base}/`);
    await tab.focus("#composer-input");
    await tab.insertText("I need an apartment in Ikoyi from 10 Sept for 3 nights for 40 people");
    await tab.pressKey("Enter");
    await tab.waitForText("No stays match", 15_000);
    assert.equal(await tab.evaluate<number>("document.querySelectorAll('.ui-result-row').length"), 0);
  } finally { await browser.close(); await fixture.close(); }
});

test("AC4: the comparison has one column per stay with the listed rows and a View per stay, and stacks without sideways scroll at 320px", async () => {
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setViewport(1280, 900);
    await tab.navigate(`${fixture.base}/`);
    await tab.focus("#composer-input");
    await tab.insertText("I need an apartment in Lagos from 10 Sept for 3 nights for 2 people");
    await tab.pressKey("Enter");
    await tab.waitForSelector("#active-workspace .ui-stay-card .stay-card__compare", 15_000);
    await tab.evaluate("document.querySelectorAll('#active-workspace .stay-card__compare')[0].click()");
    await tab.waitForFunction("document.querySelector('#active-workspace .stay-card__compare')?.textContent.trim() === 'Remove from compare'", 15_000);
    await tab.evaluate("document.querySelectorAll('#active-workspace .stay-card__compare')[1].click()");
    await tab.waitForSelector("#active-workspace .ui-compare", 15_000);
    const table = await tab.evaluate<{ heads: number; keys: string[]; views: number }>(`(() => { const t = document.querySelector("#active-workspace .ui-compare"); return { heads: t.querySelectorAll(".ui-compare__head").length, keys: [...t.querySelectorAll(".ui-compare__key")].map((k) => k.textContent.trim()), views: t.querySelectorAll("button").length }; })()`);
    assert.equal(table.heads, 2, "one column per stay");
    assert.deepEqual(table.keys, ["All-In Stay Total", "Refundable Security Deposit (separate)", "Where", "Bedrooms", "Bathrooms", "Sleeps"]);
    assert.equal(table.views, 2, "a View per stay");
    await tab.setViewport(320, 800);
    assert.equal(await tab.evaluate<boolean>("document.documentElement.scrollWidth <= document.documentElement.clientWidth"), true);
    // A stay's View opens it from the comparison.
    await tab.evaluate("document.querySelector('#active-workspace .ui-compare button').click()");
    await tab.waitForSelector("#active-workspace .unit-detail-root", 15_000);
  } finally { await browser.close(); await fixture.close(); }
});

test("AC5 (browser): with JavaScript off, View apartment on the search page is a link that opens the unit page", async () => {
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setJavaScriptEnabled(false);
    await tab.navigate(`${fixture.base}${SEARCH}`);
    assert.equal(await tab.evaluate<number>("document.querySelectorAll('.ui-stay-card').length"), 1);
    await tab.evaluate("document.querySelector('.ui-stay-card__view').click()");
    await tab.waitForFunction("location.pathname.startsWith('/stays/unit-')", 10_000);
    assert.equal(await tab.evaluate<boolean>("document.body.textContent.includes('Luxury 2-Bedroom Apartment in Old Ikoyi')"), true);
  } finally { await browser.close(); await fixture.close(); }
});
