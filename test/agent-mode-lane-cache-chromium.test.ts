import assert from "node:assert/strict";
import test from "node:test";
import { launchRealBrowser, type RealBrowserTab } from "./helpers/chrome-devtools.js";
import { startTaskRailServer } from "./helpers/assistant-task-rail.js";

/*
 * Issue 03i (ADR 0107 decision 11, analysis 5.5 and 11.5): the lane cache and scroll memory, in real Chrome. Run this file solo.
 * Two tasks are made by the scripted model (stays, then shop), exactly as the task-rail journey makes them.
 */

const STAYS_TEXT = "I need a place in Ikoyi for 4 nights for 2 guests";

/** Counts each /api/state read once its JSON is parsed, so a test can wait for the lane load a switch makes. */
async function countStateReads(tab: RealBrowserTab): Promise<void> {
  await tab.evaluate(`(() => {
    window.__stateLoads = 0;
    const json = Response.prototype.json;
    Response.prototype.json = function () {
      return json.call(this).then((value) => { if (this.url.includes("/api/state")) { window.__stateLoads += 1; window.__stateUrl = this.url; } return value; });
    };
  })()`);
}

/** Switches lanes from the task rail by domain, and waits until the server's answer and the lane's timeline read have landed. */
async function switchTo(tab: RealBrowserTab, domain: "shortlet" | "shop"): Promise<void> {
  const before = await tab.evaluate<number>("window.__stateLoads");
  await tab.evaluate(`document.querySelector('.ui-task-rail__item[data-domain="${domain}"]').click()`);
  await tab.waitForFunction(`document.querySelector('.ui-task-rail__item--current')?.dataset.domain === '${domain}' && !document.getElementById('task-rail').hasAttribute('aria-busy') && window.__stateLoads > ${before}`, 15_000);
}

test("AC10: In Chromium at 320 px, a lane's scroll position survives two switches away and back, with no horizontal overflow", async () => {
  const fixture = await startTaskRailServer();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setViewport(320, 640);
    await tab.navigate(`${fixture.base}/`);
    await tab.waitForSelector("#composer-input");
    await countStateReads(tab);
    await tab.focus("#composer-input");
    await tab.insertText(STAYS_TEXT);
    await tab.pressKey("Enter");
    await tab.waitForSelector("#active-workspace .stay-card", 15_000);
    await tab.focus("#composer-input");
    await tab.insertText("start a new task");
    await tab.pressKey("Enter");
    await tab.waitForFunction("!document.querySelector('#task-rail').hidden", 15_000);

    // The transcript is made shorter than the stays lane, so the lane can scroll (a test-side height, not a product style).
    await switchTo(tab, "shortlet");
    await tab.evaluate("document.getElementById('transcript').style.minHeight = '0px'; document.getElementById('transcript').style.flex = '0 0 90px'");
    const scrollable = await tab.evaluate<boolean>("document.getElementById('transcript').scrollHeight > document.getElementById('transcript').clientHeight + 40");
    assert.equal(scrollable, true, `the stays lane is taller than the transcript (${await tab.evaluate<string>("[document.getElementById('transcript').scrollHeight, document.getElementById('transcript').clientHeight, document.querySelectorAll('.transcript-lane:not([hidden]) .turn').length].join('/')")})`);
    await tab.evaluate("document.getElementById('transcript').scrollTop = 40");
    const left = await tab.evaluate<number>("document.getElementById('transcript').scrollTop");
    assert.ok(Math.abs(left - 40) <= 2, "the guest scrolled the stays lane to 40");

    for (let round = 0; round < 2; round += 1) {
      await switchTo(tab, "shop");
      await switchTo(tab, "shortlet");
      const restored = await tab.evaluate<number>("document.getElementById('transcript').scrollTop");
      const shape = await tab.evaluate<string>("[document.querySelectorAll('.transcript-lane:not([hidden]) .turn').length, document.getElementById('transcript').scrollHeight, document.getElementById('transcript').clientHeight, document.querySelectorAll('.transcript-lane').length].join('/')");
      const rows = await tab.evaluate<string>("fetch(window.__stateUrl).then((r) => r.json()).then((s) => JSON.stringify((s.timeline ?? []).map((e) => e.role + ':' + e.text.slice(0, 24))))");
      assert.ok(Math.abs(restored - 40) <= 2, `round ${round + 1}: the stays lane came back at its scroll position (got ${restored}; turns/scrollHeight/clientHeight/lanes ${shape}; rows ${rows})`);
    }

    const overflow = await tab.evaluate<number>("document.documentElement.scrollWidth - document.documentElement.clientWidth");
    assert.ok(overflow <= 0, "no horizontal page scroll at 320 px");
    await tab.close();
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test("AC1 and AC3: A visited lane appears before the server answers a switch, and a switch replaces the history entry", async () => {
  const fixture = await startTaskRailServer();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setViewport(1280, 900);
    await tab.navigate(`${fixture.base}/`);
    await tab.waitForSelector("#composer-input");
    await countStateReads(tab);
    await tab.focus("#composer-input");
    await tab.insertText(STAYS_TEXT);
    await tab.pressKey("Enter");
    await tab.waitForSelector("#active-workspace .stay-card", 15_000);
    await tab.focus("#composer-input");
    await tab.insertText("start a new task");
    await tab.pressKey("Enter");
    await tab.waitForFunction("!document.querySelector('#task-rail').hidden", 15_000);

    // Hold the switch event at the network until the test releases it, and count pushState calls and browser storage writes.
    await tab.evaluate(`(() => {
      window.__held = null;
      window.__pushes = 0;
      window.__storageWrites = 0;
      const originalPush = history.pushState.bind(history);
      history.pushState = (...args) => { window.__pushes += 1; return originalPush(...args); };
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (...args) { window.__storageWrites += 1; return originalSetItem.apply(this, args); };
      const originalFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = String(input instanceof Request ? input.url : input);
        const body = typeof init?.body === 'string' ? init.body : '';
        if (url.includes('/api/event') && body.includes('platform.task.switch')) {
          return new Promise((resolve, reject) => { window.__held = () => originalFetch(input, init).then(resolve, reject); });
        }
        return originalFetch(input, init);
      };
    })()`);
    const historyBefore = await tab.evaluate<number>("history.length");
    await tab.evaluate("document.querySelector('.ui-task-rail__item[data-domain=\"shortlet\"]').click()");
    await tab.waitForFunction("typeof window.__held === 'function'", 5_000);

    const shownBeforeAnswer = await tab.evaluate<string>("document.querySelector('.transcript-lane:not([hidden])')?.textContent ?? ''");
    assert.ok(shownBeforeAnswer.includes("Ikoyi"), `the stays lane is shown from memory while the switch is still with the server (lane text: ${JSON.stringify(shownBeforeAnswer.slice(0, 160))}, lanes: ${await tab.evaluate<number>("document.querySelectorAll('.transcript-lane').length")})`);
    assert.equal(await tab.evaluate<string>("document.activeElement?.id ?? ''"), "route-heading", "a switch from the switcher moves focus to the lane heading (analysis 5.5)");
    await tab.evaluate("window.__held()");
    await tab.waitForFunction("document.querySelector('.ui-task-rail__item--current')?.dataset.domain === 'shortlet'", 15_000);

    assert.equal(await tab.evaluate<number>("history.length"), historyBefore, "a lane switch adds no history entry");
    assert.equal(await tab.evaluate<number>("window.__pushes"), 0, "pushState is never called for a lane switch");
    assert.equal(await tab.evaluate<number>("window.__storageWrites"), 0, "no lane content is written to browser storage");
    await tab.close();
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test("Owner decision (17 Nov 2026): a guest's own line in a lane is still shown after a switch away and back", async () => {
  const fixture = await startTaskRailServer();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setViewport(390, 900);
    await tab.navigate(`${fixture.base}/`);
    await tab.waitForSelector("#composer-input");
    await countStateReads(tab);
    await tab.focus("#composer-input");
    await tab.insertText(STAYS_TEXT);
    await tab.pressKey("Enter");
    await tab.waitForSelector("#active-workspace .stay-card", 15_000);
    await tab.focus("#composer-input");
    await tab.insertText("start a new task");
    await tab.pressKey("Enter");
    await tab.waitForFunction("!document.querySelector('#task-rail').hidden", 15_000);

    // Back in the stays lane, the guest sends a message; its own line is then in the lane.
    await switchTo(tab, "shortlet");
    await tab.focus("#composer-input");
    await tab.insertText("Ikoyi for 2 nights");
    await tab.pressKey("Enter");
    await tab.waitForFunction("[...document.querySelectorAll('.transcript-lane:not([hidden]) .turn.user')].some((turn) => turn.textContent.includes('Ikoyi for 2 nights')) && !document.getElementById('composer-submit').disabled", 20_000);
    await new Promise((resolve) => { setTimeout(resolve, 300); });

    await switchTo(tab, "shop");
    await switchTo(tab, "shortlet");
    const guestLines = await tab.evaluate<number>("[...document.querySelectorAll('.transcript-lane:not([hidden]) .turn.user')].filter((turn) => turn.textContent.includes('Ikoyi for 2 nights')).length");
    assert.equal(guestLines, 1, "the guest's own message is still in the lane after a switch away and back");
    await tab.close();
  } finally {
    await browser.close();
    await fixture.close();
  }
});
