import assert from "node:assert/strict";
import test from "node:test";
import { launchRealBrowser, type RealBrowserTab } from "./helpers/chrome-devtools.js";
import { restartFixture } from "./helpers/guest-restart.js";
import { createConversationShellState, replaceActiveSurface, reopenFocusedSurface } from "../apps/local-guest/src/conversational-shell.js";

const SEARCH = "I need an apartment in Ikoyi from 10 Sept for 3 nights for 2 people";

async function openDetail(tab: RealBrowserTab): Promise<void> {
  await tab.focus("#composer-input");
  await tab.insertText(SEARCH);
  await tab.pressKey("Enter");
  await tab.waitForSelector("#active-workspace .stay-card", 10_000);
  assert.equal(await tab.clickButton("View apartment"), true);
  await tab.waitForSelector("#active-workspace[data-mode=\"focused-surface\"] .unit-detail-root", 10_000);
}

test("AC1: A focused task on a 320 or 390-pixel phone shows one task scroll area, visible status, and current action without a persistent composer or obstructed content", async () => {
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    for (const width of [320, 390]) {
      const tab = await browser.createTab();
      await tab.setViewport(width, 700);
      await tab.navigate(`${fixture.base}/`);
      await openDetail(tab);
      assert.equal(await tab.evaluate<boolean>("getComputedStyle(document.getElementById('composer')).display === 'none'"), true);
      assert.equal(await tab.evaluate<boolean>("getComputedStyle(document.getElementById('transcript')).display === 'none'"), true);
      assert.equal(await tab.evaluate<boolean>("(() => { const r = document.getElementById('workspace-region'); const b = r.getBoundingClientRect(); return getComputedStyle(r).overflowY === 'auto' && b.top <= 1 && b.bottom >= innerHeight - 1 && document.documentElement.scrollWidth <= innerWidth; })()"), true);
      assert.equal(await tab.evaluate<boolean>("!!document.querySelector('.workspace-stage-label') && !!document.querySelector('#active-workspace .weaver-mount button:not([disabled])')"), true);
      await tab.close();
    }
  } finally { await browser.close(); await fixture.close(); }
});

test("AC2: Ask Shortlet and return preserve an unsent draft, the task state and scroll position, and predictable keyboard focus", async () => {
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setViewport(390, 700);
    await tab.navigate(`${fixture.base}/`);
    await openDetail(tab);
    await tab.evaluate("document.getElementById('workspace-region').scrollTop = 100");
    const before = await tab.evaluate<number>("document.getElementById('workspace-region').scrollTop");
    assert.ok(before > 0);
    // The control is sticky; clicking it must not scroll its original flow position into view.
    assert.equal(await tab.evaluate<boolean>("(() => { const b = document.querySelector('.workspace-ask'); if (!(b instanceof HTMLButtonElement)) return false; b.click(); return true; })()"), true);
    assert.equal(await tab.evaluate<string>("document.activeElement?.id"), "composer-input");
    await tab.insertText("Is there parking?");
    assert.equal(await tab.clickButton("Return to"), true);
    assert.equal(await tab.evaluate<string>("document.getElementById('composer-input').value"), "Is there parking?");
    await tab.waitForFunction(`document.getElementById('workspace-region').scrollTop === ${before}`, 2_000);
    assert.equal(await tab.evaluate<number>("document.getElementById('workspace-region').scrollTop"), before);
    assert.equal(await tab.evaluate<boolean>("document.activeElement?.classList.contains('workspace-close')"), true);
    assert.equal(await tab.evaluate<boolean>("!!document.querySelector('#active-workspace .unit-detail-root')"), true);
  } finally { await browser.close(); await fixture.close(); }
});

test("AC3: Browser Back, visible Back, reopen, and cold restore return to the same safe current task; stale or unknown surfaces cannot regain an enabled action", async () => {
  const unknown = reopenFocusedSurface(createConversationShellState());
  assert.equal(unknown.focusedSurfaceOpen, false);
  const stale = reopenFocusedSurface(replaceActiveSurface(createConversationShellState(), {
    surfaceId: "unknown-surface", mode: "focused-surface", status: "stale", summary: "Old details",
  }));
  assert.equal(stale.focusedSurfaceOpen, false);
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setViewport(390, 700);
    await tab.navigate(`${fixture.base}/`);
    await openDetail(tab);
    const id = await tab.evaluate<string>("document.getElementById('active-workspace').querySelector('.weaver-mount')?.dataset.surfaceId");
    assert.equal(await tab.clickButton("Back to conversation"), true);
    assert.equal(await tab.clickButton("Return to"), true);
    assert.equal(await tab.evaluate<string>("document.querySelector('.weaver-mount')?.dataset.surfaceId"), id);
    await tab.evaluate("history.back()");
    await tab.waitForFunction("document.getElementById('active-workspace').hidden", 5_000);
    assert.equal(await tab.clickButton("Return to"), true);
    await tab.evaluate("location.reload()");
    await tab.waitForSelector("#active-workspace[data-mode=\"focused-surface\"]:not([hidden])", 10_000);
    assert.equal(await tab.evaluate<string>("document.querySelector('.weaver-mount')?.dataset.surfaceId"), id);
  } finally { await browser.close(); await fixture.close(); }
});

test("AC4: Desktop keeps the conversation and workspace split, and conventional routes retain the same facts and actions", async () => {
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setViewport(1280, 800);
    await tab.navigate(`${fixture.base}/`);
    await openDetail(tab);
    assert.equal(await tab.evaluate<boolean>("(() => { const t = document.getElementById('transcript').getBoundingClientRect(); const w = document.getElementById('workspace-region').getBoundingClientRect(); return t.right <= w.left && getComputedStyle(document.getElementById('composer')).display !== 'none'; })()"), true);
    const route = await tab.evaluate<string>("document.querySelector('#active-workspace .fallback-link')?.getAttribute('href') ?? ''");
    assert.match(route, /^\//);
    assert.equal(await tab.evaluate<boolean>("!!document.querySelector('#active-workspace .weaver-mount button:not([disabled])')"), true);
    const title = await tab.evaluate<string>("document.querySelector('#active-workspace .unit-detail-sheet h2')?.textContent?.trim() ?? ''");
    const conventional = await browser.createTab();
    await conventional.setViewport(1280, 800);
    await conventional.navigate(`${fixture.base}${route}`);
    await conventional.waitForSelector(".unit-detail-page h1", 10_000);
    assert.equal(await conventional.evaluate<string>("document.querySelector('.unit-detail-page h1')?.textContent?.trim() ?? ''"), title);
    assert.equal(await conventional.evaluate<boolean>("!!document.querySelector('.unit-detail-page .ui-action-bar a')"), true);
  } finally { await browser.close(); await fixture.close(); }
});
