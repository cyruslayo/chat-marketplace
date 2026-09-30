import assert from "node:assert/strict";
import test from "node:test";
import { launchRealBrowser } from "./helpers/chrome-devtools.js";
import { withStagePage } from "./helpers/guest-stage-pages.js";
import { restartFixture } from "./helpers/guest-restart.js";

test("AC1: the confirmed reservation renders the same ticket, paid breakdown, steps and actions in the chat workspace and on /booking-contracts/:id", async () => {
  await withStagePage({ label: "confirmed", stage: "confirmed" }, async ({ fixture, path, threadId }) => {
    const browser = await launchRealBrowser();
    try {
      const tab = await browser.createTab();
      await tab.setExtraHeaders({ cookie: fixture.cookie });
      await tab.navigate(`${fixture.base}/?threadId=${threadId}`);
      await tab.waitForSelector(".confirmed-screen", 10_000);
      const result = await tab.evaluate<{ chat: string; page: string }>(`(async () => {
        const page = new DOMParser().parseFromString(await (await fetch(${JSON.stringify(path)})).text(), 'text/html');
        const normalise = el => el.outerHTML.replace(/ datetime="[^"]*"/g, '');
        return { chat: normalise(document.querySelector('.confirmed-screen')), page: normalise(page.querySelector('.confirmed-screen')) };
      })()`);
      assert.equal(result.chat, result.page);
      assert.match(result.chat, /Stay payment verified/);
      assert.match(result.chat, /Booking reference.*res_/);
      assert.match(result.chat, /Before you arrive.*ui-steps/);
      assert.match(result.chat, /does not itself grant physical access/);
      assert.match(result.chat, /View booking details/);
      assert.doesNotMatch(result.chat, /Amount due now|If your request is accepted/);
    } finally { await browser.close(); }
  });
});

test("AC3: the no-JavaScript conversation uses the chat app bar, rail, bubbles and composer classes, with result rows linking to conventional routes", async () => {
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    const result = await fixture.advance("review");
    const tab = await browser.createTab();
    await tab.setJavaScriptEnabled(false);
    await tab.setExtraHeaders({ cookie: fixture.cookie });
    await tab.navigate(`${fixture.base}/conversation?threadId=${fixture.threadId}`);
    for (const selector of [".ui-appbar", ".ui-rail", ".turn.user .bubble", ".turn.assistant .bubble", ".receipt-marker", "#composer.composer", ".ui-result-row"]) {
      assert.equal(await tab.evaluate<boolean>(`Boolean(document.querySelector(${JSON.stringify(selector)}))`), true, selector);
    }
    assert.equal(await tab.evaluate<string>("document.querySelector('.ui-result-row').getAttribute('href')"), result.surfaces[0]!.conventionalRoute);
    assert.equal(await tab.evaluate<string>("document.querySelector('#composer').method"), "post");
    assert.equal(await tab.evaluate<number>("document.querySelectorAll('script').length"), 0);
  } finally { await browser.close(); await fixture.close(); }
});

test("AC4: without JavaScript, posting a turn from the conversation page still produces a server-rendered reply", async () => {
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setJavaScriptEnabled(false);
    await tab.navigate(`${fixture.base}/`);
    await tab.navigate(`${fixture.base}/conversation`);
    await tab.focus("#composer-input");
    await tab.insertText("I need an apartment in Ikoyi from 10 Sept for 3 nights for 2 people");
    await tab.pressKey("Enter");
    await tab.waitForText("I found 1 eligible place in Lagos", 10_000);
    assert.match(await tab.evaluate<string>("location.pathname + location.search"), /^\/conversation\?threadId=g-/);
    assert.equal(await tab.evaluate<string>("document.querySelector('.ui-result-row').getAttribute('href').split('?')[0]"), "/stays/search");
  } finally { await browser.close(); await fixture.close(); }
});
