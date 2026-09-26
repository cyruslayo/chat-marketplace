import assert from "node:assert/strict";
import test from "node:test";
import { launchRealBrowser, type RealBrowserInstance, type RealBrowserTab } from "./helpers/chrome-devtools.js";
import { restartFixture } from "./helpers/guest-restart.js";

type Fixture = Awaited<ReturnType<typeof restartFixture>>;

/** Drives the real shell to a sent Booking Request that awaits the Operator. */
async function sendRequest(browser: RealBrowserInstance, fixture: Fixture): Promise<RealBrowserTab> {
  const tab = await browser.createTab();
  await tab.setViewport(375, 812);
  await tab.navigate(`${fixture.base}/`);
  await tab.focus("#composer-input");
  await tab.insertText("I need an apartment in Ikoyi from 10 Sept for 3 nights for 2 people");
  await tab.pressKey("Enter");
  for (const [button, next] of [["View apartment", "Request to Book"], ["Request to Book", "Review request"], ["Review request", "Submit Booking Request"], ["Submit Booking Request", "Waiting for"]] as const) {
    await tab.waitForText(button, 10_000);
    assert.equal(await tab.clickButton(button), true, button);
    await tab.waitForText(next, 10_000);
  }
  await tab.waitForSelector(".waiting-panel[data-waiting=\"operator-response\"]", 10_000);
  return tab;
}

const panelText = (tab: RealBrowserTab) => tab.evaluate<{ readonly deadline: string; readonly countdown: string }>(
  "({ deadline: document.querySelector('.waiting-deadline-time')?.textContent ?? '', countdown: document.querySelector('.waiting-countdown')?.textContent ?? '' })",
);

test("AC1: In real Chromium, changing the client clock doesn't move the displayed deadline time or the countdown", async () => {
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    const tab = await sendRequest(browser, fixture);
    const before = await panelText(tab);
    assert.match(before.deadline, /^Response due by .+ WAT/);
    assert.equal(before.countdown, "30 min left");

    // Move the device clock three hours ahead, then let the countdown tick.
    await tab.evaluate(`(() => {
      const RealDate = Date; const shift = 3 * 3600 * 1000;
      globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [RealDate.now() + shift])); } static now() { return RealDate.now() + shift; } };
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    const after = await panelText(tab);
    assert.equal(after.deadline, before.deadline);
    assert.equal(after.countdown, before.countdown);
    // Failure path: nothing was marked expired by the skewed clock.
    assert.equal(await tab.evaluate<string>("document.getElementById('active-workspace').dataset.status"), "active");
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test("AC2: In real Chromium, at zero the UI refetches state and never marks the request expired on its own", async () => {
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    const tab = await sendRequest(browser, fixture);
    const deadline = Date.parse("2026-09-03T10:30:00Z");
    // The server is 3 s from the deadline; a reload picks up that server time.
    fixture.setTime(new Date(deadline - 3_000).toISOString());
    await tab.navigate(`${fixture.base}/`);
    await tab.waitForSelector(".waiting-panel", 10_000);
    await tab.evaluate(`(() => {
      window.__stateFetches = 0; const realFetch = window.fetch;
      window.fetch = (...args) => { if (String(args[0]).includes('/api/state')) window.__stateFetches += 1; return realFetch(...args); };
    })()`);
    await tab.waitForFunction("window.__stateFetches >= 1", 10_000);
    await tab.waitForFunction("document.querySelector('.waiting-panel') !== null", 5_000);
    // The server still says the wait is open, so the page still says so too.
    assert.equal(await tab.evaluate<string>("document.getElementById('active-workspace').dataset.status"), "active");
    assert.equal(await tab.evaluate<boolean>("/expired/i.test(document.getElementById('active-workspace').textContent)"), false);
    assert.equal(fixture.environment.interactionStore.listBookingRequestIds().length, 1);

    // Once the server's deadline has passed, the next refetch shows the server's outcome.
    fixture.setTime(new Date(deadline + 1_000).toISOString());
    await tab.waitForFunction("/Request expired/.test(document.getElementById('active-workspace').textContent)", 15_000);
    assert.equal(await tab.evaluate<boolean>("document.querySelector('.waiting-panel') === null"), true);
    assert.equal(await tab.evaluate<string>("document.querySelector('#journey-rail [data-step=\"request\"]').dataset.state"), "failed");

    // AC4 in the browser: the composer stays usable throughout.
    assert.equal(await tab.evaluate<boolean>("document.getElementById('composer-submit').disabled"), false);
  } finally {
    await browser.close();
    await fixture.close();
  }
});
