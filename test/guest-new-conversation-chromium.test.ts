import assert from "node:assert/strict";
import test from "node:test";
import { launchRealBrowser, type RealBrowserTab } from "./helpers/chrome-devtools.js";
import { sendRequest } from "./helpers/guest-browser.js";
import { restartFixture } from "./helpers/guest-restart.js";

const storedThread = (tab: RealBrowserTab) => tab.evaluate<string | null>("sessionStorage.getItem('shortlet-concierge-thread')");

test("AC1: In real Chromium, starting a new conversation keeps the Booking Request and says so, at 375px and 1280px", async () => {
  for (const viewport of [[375, 812], [1280, 800]] as const) {
    const fixture = await restartFixture();
    const browser = await launchRealBrowser();
    try {
      const tab = await sendRequest(browser, fixture, viewport);
      const original = await storedThread(tab);
      assert.ok(original);

      // The confirmation opens in the page, takes focus and states the effect.
      assert.equal(await tab.clickButton("New conversation"), true);
      await tab.waitForFunction("!document.getElementById('new-conversation-confirm').hidden", 10_000);
      assert.equal(await tab.isElementFocused("#new-conversation-start"), true);
      const confirmText = await tab.evaluate<string>("document.getElementById('new-conversation-confirm').textContent");
      assert.match(confirmText, /Starting a new conversation doesn't withdraw or cancel your Booking Request for .+\./);
      assert.match(await tab.evaluate<string>("document.querySelector('#new-conversation-confirm a').getAttribute('href')"), /^\/booking-requests\/req-/);

      // Failure path: "Stay here" keeps the conversation and returns focus.
      assert.equal(await tab.clickButton("Stay here"), true);
      assert.equal(await tab.evaluate<boolean>("document.getElementById('new-conversation-confirm').hidden"), true);
      assert.equal(await tab.isElementFocused("#new-conversation"), true);
      assert.equal(await storedThread(tab), original);
      // Escape also cancels.
      assert.equal(await tab.clickButton("New conversation"), true);
      await tab.waitForFunction("!document.getElementById('new-conversation-confirm').hidden", 10_000);
      await tab.pressKey("Escape");
      assert.equal(await tab.evaluate<boolean>("document.getElementById('new-conversation-confirm').hidden"), true);
      assert.equal(await storedThread(tab), original);

      assert.equal(await tab.clickButton("New conversation"), true);
      await tab.waitForFunction("!document.getElementById('new-conversation-confirm').hidden", 10_000);
      assert.equal(await tab.clickButton("Start new conversation"), true);
      await tab.waitForSelector(".committed-work[data-kind=\"request\"]", 10_000);
      const next = await storedThread(tab);
      assert.ok(next && next !== original, "a new thread id is in use");
      assert.equal(await tab.evaluate<number>("document.querySelectorAll('#transcript .turn').length"), 0);
      assert.match(await tab.evaluate<string>("document.querySelector('.committed-work').textContent"), /Your Booking Request for .+ is still active\. Starting this conversation didn't change it\./);
      assert.equal(await tab.evaluate<boolean>("document.documentElement.scrollWidth <= document.documentElement.clientWidth"), true);

      // ADR-0079: the request itself is unchanged.
      const threads = fixture.environment.interactionStore.findThreadsForPrincipal(fixture.environment.guestPrincipal().id, fixture.environment.config.tenantId);
      assert.ok(threads.some((record) => record.threadId === original));
      const requestId = await tab.evaluate<string>("document.querySelector('.committed-work a').getAttribute('href').split('/').pop()");
      assert.equal(fixture.environment.bookingRequestApp.getArtifact(decodeURIComponent(requestId), fixture.environment.guestPrincipal()).facts.status, "disclosed");
    } finally {
      await browser.close();
      await fixture.close();
    }
  }
});

test("AC1 failure path: in real Chromium, with no live work, New conversation starts at once with no confirmation", async () => {
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setCssViewport(320, 640);
    await tab.navigate(`${fixture.base}/`);
    await tab.focus("#composer-input");
    await tab.insertText("I need an apartment in Ikoyi from 10 Sept for 3 nights for 2 people");
    await tab.pressKey("Enter");
    await tab.waitForText("View apartment", 10_000);
    const original = await storedThread(tab);
    // ADR-0078: the header controls never scroll the page sideways at 320px.
    assert.equal(await tab.evaluate<boolean>("document.documentElement.scrollWidth <= document.documentElement.clientWidth"), true);
    assert.equal(await tab.clickButton("New conversation"), true);
    await tab.waitForFunction(`sessionStorage.getItem('shortlet-concierge-thread') !== ${JSON.stringify(original)} && document.readyState === 'complete' && !document.getElementById('empty-state').hidden`, 10_000);
    assert.equal(await tab.evaluate<boolean>("document.getElementById('new-conversation-confirm').hidden"), true);
    assert.equal(await tab.evaluate<number>("document.querySelectorAll('.committed-work').length"), 0);
  } finally {
    await browser.close();
    await fixture.close();
  }
});
