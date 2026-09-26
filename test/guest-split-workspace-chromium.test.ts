import assert from "node:assert/strict";
import test from "node:test";
import { launchRealBrowser, type RealBrowserInstance, type RealBrowserTab } from "./helpers/chrome-devtools.js";
import { restartFixture } from "./helpers/guest-restart.js";

const SEARCH = "I need an apartment in Ikoyi from 10 Sept for 3 nights for 2 people";

async function openShell(browser: RealBrowserInstance, base: string, width: number, height: number): Promise<RealBrowserTab> {
  const tab = await browser.createTab();
  await tab.setViewport(width, height);
  await tab.navigate(`${base}/`);
  return tab;
}

async function send(tab: RealBrowserTab, text: string): Promise<void> {
  await tab.focus("#composer-input");
  await tab.insertText(text);
  await tab.pressKey("Enter");
}

type Box = { readonly top: number; readonly left: number; readonly right: number; readonly bottom: number; readonly width: number };
const box = (tab: RealBrowserTab, selector: string) => tab.evaluate<Box | null>(`(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r ? { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width } : null; })()`);

test("AC1: At 1280px, transcript and workspace are both visible with no dead space above the workspace", async () => {
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    const tab = await openShell(browser, fixture.base, 1280, 800);
    // Failure path: with nothing to show there is no second column.
    assert.equal(await tab.evaluate<string>("getComputedStyle(document.querySelector('main')).display"), "flex");

    await send(tab, SEARCH);
    await tab.waitForSelector("#active-workspace .stay-card", 10_000);
    for (const step of ["results", "stay detail"] as const) {
      if (step === "stay detail") {
        assert.equal(await tab.clickButton("View apartment"), true);
        await tab.waitForSelector("#active-workspace[data-mode=\"focused-surface\"] .unit-detail-root", 10_000);
      }
      const main = (await box(tab, "main"))!;
      const transcript = (await box(tab, "#transcript"))!;
      const workspace = (await box(tab, "#active-workspace"))!;
      const composer = (await box(tab, "form#composer"))!;
      assert.ok(transcript.width >= 350 && workspace.width >= 400, `${step}: ${JSON.stringify({ transcript, workspace })}`);
      assert.ok(transcript.right <= workspace.left, `${step}: side by side`);
      assert.ok(workspace.top - main.top <= 24, `${step}: workspace starts at the top (${workspace.top - main.top}px)`);
      assert.ok(workspace.top < 800 && transcript.top < 800 && composer.bottom <= 800, `${step}: all in view`);
      assert.ok(composer.right <= workspace.left, `${step}: the composer stays under the transcript`);
      assert.equal(await tab.evaluate<boolean>("document.documentElement.scrollWidth > document.documentElement.clientWidth"), false);
    }
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test("AC2: At 375px, the workspace opens as a sheet, and both browser Back and header Back close it", async () => {
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    const tab = await openShell(browser, fixture.base, 375, 812);
    await send(tab, SEARCH);
    await tab.waitForSelector("#active-workspace .stay-card", 10_000);
    // Failure path: inline results are not a sheet.
    assert.equal(await tab.evaluate<string>("getComputedStyle(document.getElementById('workspace-region')).position"), "static");
    const historyBefore = await tab.evaluate<number>("history.length");

    const openSheet = async (): Promise<void> => {
      await tab.waitForSelector("#active-workspace[data-mode=\"focused-surface\"]:not([hidden])", 10_000);
      const sheet = (await box(tab, "#workspace-region"))!;
      assert.equal(await tab.evaluate<string>("getComputedStyle(document.getElementById('workspace-region')).position"), "fixed");
      assert.ok(sheet.top <= 1 && sheet.width >= 374, `full-screen sheet: ${JSON.stringify(sheet)}`);
      // The composer is not covered by the sheet.
      assert.equal(await tab.evaluate<boolean>("(() => { const r = document.getElementById('composer-input').getBoundingClientRect(); return document.getElementById('composer').contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); })()"), true);
    };
    const assertClosed = async (): Promise<void> => {
      await tab.waitForFunction("document.getElementById('active-workspace').hidden === true", 5_000);
      assert.equal(await tab.evaluate<string>("getComputedStyle(document.getElementById('workspace-region')).position"), "static");
      assert.equal(await tab.evaluate<boolean>("history.state?.shortletSheet === true"), false);
      assert.match(await tab.evaluate<string>("location.pathname"), /^\/$/, "still in the conversation");
    };

    assert.equal(await tab.clickButton("View apartment"), true);
    await openSheet();
    assert.equal(await tab.evaluate<number>("history.length"), historyBefore + 1, "opening the sheet adds one history entry");

    // Header Back.
    assert.equal(await tab.clickButton("Back to conversation"), true);
    await assertClosed();

    // Reopen, then browser Back.
    assert.equal(await tab.clickButton("Return to"), true);
    await openSheet();
    await tab.evaluate("history.back()");
    await assertClosed();
    assert.equal(await tab.evaluate<boolean>("document.getElementById('transcript').isConnected"), true);
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test("Review fix: after a reload with the sheet open, one browser Back still closes it", async () => {
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    const tab = await openShell(browser, fixture.base, 375, 812);
    await send(tab, SEARCH);
    await tab.waitForSelector("#active-workspace .stay-card", 10_000);
    assert.equal(await tab.clickButton("View apartment"), true);
    await tab.waitForSelector("#active-workspace[data-mode=\"focused-surface\"]:not([hidden])", 10_000);
    const length = await tab.evaluate<number>("history.length");

    await tab.evaluate("location.reload()");
    await tab.waitForSelector("#active-workspace[data-mode=\"focused-surface\"]:not([hidden])", 10_000);
    // Failure path: before the fix the restored sheet pushed a second entry.
    assert.equal(await tab.evaluate<number>("history.length"), length);
    await tab.evaluate("history.back()");
    await tab.waitForFunction("document.getElementById('active-workspace').hidden === true", 5_000);
    assert.match(await tab.evaluate<string>("location.pathname"), /^\/$/);
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test("AC3: Sending a message while the workspace is open keeps it open and updates it where relevant", async () => {
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    // Mobile sheet: a question about the stay is answered and the sheet stays open.
    const phone = await openShell(browser, fixture.base, 375, 812);
    await send(phone, SEARCH);
    await phone.waitForSelector("#active-workspace .stay-card", 10_000);
    assert.equal(await phone.clickButton("View apartment"), true);
    await phone.waitForSelector("#active-workspace[data-mode=\"focused-surface\"]:not([hidden])", 10_000);
    await send(phone, "is there parking?");
    await phone.waitForText("lists Secure parking", 10_000);
    assert.equal(await phone.evaluate<boolean>("document.getElementById('active-workspace').hidden"), false);
    assert.equal(await phone.evaluate<string>("getComputedStyle(document.getElementById('workspace-region')).position"), "fixed");
    assert.equal(await phone.evaluate<boolean>("history.state?.shortletSheet === true"), true);

    // Desktop split: a typed refinement updates the open results in place.
    const desktop = await openShell(browser, fixture.base, 1280, 800);
    await send(desktop, "I need an apartment in Lagos from 10 Sept for 3 nights for 2 people");
    await desktop.waitForSelector("#active-workspace .stay-card", 10_000);
    await send(desktop, "actually make it 3 guests");
    await desktop.waitForFunction("/partySize=3/.test(document.querySelector('#active-workspace .fallback-link')?.getAttribute('href') ?? '')", 10_000);
    assert.equal(await desktop.evaluate<boolean>("document.getElementById('active-workspace').hidden"), false);
    const transcript = (await box(desktop, "#transcript"))!;
    const workspace = (await box(desktop, "#active-workspace"))!;
    assert.ok(transcript.right <= workspace.left, "still side by side after the update");
  } finally {
    await browser.close();
    await fixture.close();
  }
});
