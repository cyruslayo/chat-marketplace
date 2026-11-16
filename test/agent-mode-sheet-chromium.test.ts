import assert from "node:assert/strict";
import test from "node:test";
import { launchRealBrowser } from "./helpers/chrome-devtools.js";
import { startLocalGuestServer } from "../apps/local-guest/src/guest-server.js";
import { ScriptedAssistantModel } from "../apps/local-guest/src/assistant/scripted-assistant-model.js";
import { createFakeShopPack } from "./helpers/fake-domain-pack.js";

/*
 * Issue 03g of the agent-modes effort (ADR 0107 decision 9, ADR 0078): the mode sheet opened from the app-bar mark, in real Chrome.
 * Run this file solo. The fake shop pack is registered only here, so two modes are offered (stays and shop).
 */

async function startTwoModeServer() {
  const server = startLocalGuestServer({
    conciergeMode: "assistant-offline",
    modelClient: new ScriptedAssistantModel([]),
    additionalPacks: [createFakeShopPack()],
    port: 0,
  });
  const base = `http://127.0.0.1:${await server.listen()}`;
  return { server, base, close: () => server.close() };
}

/** Every visible control of the chooser and the mark, measured in CSS pixels (ADR 0078: 44 by 44 at least). */
const CONTROL_SIZES = `(() => Array.from(document.querySelectorAll('.mode-choice, .mode-mark, .mode-sheet__close')).map((el) => {
  const box = el.getBoundingClientRect();
  return { name: el.className, width: box.width, height: box.height };
}))()`;

test("AC6: The sheet opens from the mark, closes on Escape and Close, returns focus to the mark, and adds no history entry", async () => {
  const fixture = await startTwoModeServer();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setViewport(1280, 900);
    await tab.navigate(`${fixture.base}/`);
    await tab.waitForSelector(".mode-mark");

    const historyBefore = await tab.evaluate<number>("history.length");
    await tab.evaluate("document.querySelector('.mode-mark').focus(); document.querySelector('.mode-mark').click()");
    await tab.waitForFunction("document.querySelector('dialog.mode-sheet')?.open === true", 5_000);
    assert.equal(await tab.evaluate<number>("history.length"), historyBefore, "opening the sheet adds no history entry");

    await tab.pressKey("Escape");
    await tab.waitForFunction("document.querySelector('dialog.mode-sheet')?.open !== true", 5_000);
    await tab.waitForFunction("document.activeElement === document.querySelector('.mode-mark')", 5_000);

    await tab.evaluate("document.querySelector('.mode-mark').focus(); document.querySelector('.mode-mark').click()");
    await tab.waitForFunction("document.querySelector('dialog.mode-sheet')?.open === true", 5_000);
    await tab.evaluate("document.querySelector('.mode-sheet__close').click()");
    await tab.waitForFunction("document.querySelector('dialog.mode-sheet')?.open !== true", 5_000);
    await tab.waitForFunction("document.activeElement === document.querySelector('.mode-mark')", 5_000);
    assert.equal(await tab.evaluate<number>("history.length"), historyBefore, "closing the sheet adds no history entry");
    await tab.close();
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test("AC8: Every chooser control is at least 44 by 44 CSS pixels and nothing overflows at 320 px", async () => {
  const fixture = await startTwoModeServer();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setViewport(320, 640);
    await tab.navigate(`${fixture.base}/`);
    await tab.waitForSelector(".mode-mark");
    await tab.evaluate("document.querySelector('.mode-mark').focus(); document.querySelector('.mode-mark').click()");
    await tab.waitForFunction("document.querySelector('dialog.mode-sheet')?.open === true", 5_000);

    const sizes = await tab.evaluate<{ name: string; width: number; height: number }[]>(CONTROL_SIZES);
    assert.ok(sizes.length >= 4, "the mark, two choices and Close are measured");
    for (const control of sizes) {
      assert.ok(control.width >= 44 && control.height >= 44, `${control.name} is at least 44 by 44 (got ${control.width} by ${control.height})`);
    }
    const overflow = await tab.evaluate<boolean>("document.documentElement.scrollWidth > document.documentElement.clientWidth");
    assert.equal(overflow, false, "no horizontal page scroll at 320 px");
    await tab.close();
  } finally {
    await browser.close();
    await fixture.close();
  }
});

/*
 * Issue 03g follow-up (orchestrator): preview, refused start and visible state, in real Chrome. Each test records the page's own
 * /api requests with a fetch wrapper installed after the first load, so the count covers only what the guest's action sent.
 */

/** Records /api requests from now on. With `window.__refuseStart` set, a platform.task.start is answered with a refusal (ok false). */
const RECORD_API = `(() => {
  window.__api = [];
  window.__refuseStart = false;
  const original = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const body = typeof init?.body === 'string' ? init.body : '';
    if (url.includes('/api/')) window.__api.push({ url, body });
    if (window.__refuseStart && url.includes('/api/event') && body.includes('platform.task.start')) {
      return Promise.resolve(new Response(JSON.stringify({ ok: false, code: 'ACTION_NOT_AUTHORIZED', message: 'That task could not be opened.' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    }
    return original(input, init);
  };
})()`;

test("AC3: A preview of the shop mode makes no request, changes the heading, starters and placeholder, and leaves data-mode on stays", async () => {
  const fixture = await startTwoModeServer();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setViewport(1280, 900);
    await tab.navigate(`${fixture.base}/`);
    await tab.waitForSelector('.mode-choice input[value="shop"]');
    await tab.evaluate(RECORD_API);

    await tab.evaluate("document.querySelector('.mode-choice input[value=\"shop\"]').click()");
    await new Promise((resolve) => { setTimeout(resolve, 400); });

    assert.equal(await tab.evaluate<number>("window.__api.length"), 0, "a preview sends no /api request");
    assert.equal(await tab.evaluate<string>("document.getElementById('route-heading').textContent"), "Shop for products", "the heading follows the preview");
    assert.equal(await tab.evaluate<string>("document.querySelector('.prompt-suggestions .prompt-suggestion')?.textContent ?? ''"), "Browse products", "the starters follow the preview");
    assert.equal(await tab.evaluate<string>("document.getElementById('composer-input').placeholder"), "Ask about a product", "the placeholder follows the preview");
    assert.equal(await tab.evaluate<string>("document.documentElement.dataset.mode"), "stays", "data-mode on html stays on the committed mode");
    assert.equal(await tab.evaluate<string>("document.getElementById('vertical-starters').dataset.previewMode"), "shop", "the strip carries data-preview-mode");
    await tab.close();
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test("AC5: A refused platform.task.start sends no turn, keeps stays, drops the preview and keeps the composer text", async () => {
  const fixture = await startTwoModeServer();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setViewport(1280, 900);
    await tab.navigate(`${fixture.base}/`);
    await tab.waitForSelector('.mode-choice input[value="shop"]');
    await tab.evaluate(RECORD_API);
    await tab.evaluate("window.__refuseStart = true");

    await tab.evaluate("document.querySelector('.mode-choice input[value=\"shop\"]').click()");
    await tab.focus("#composer-input");
    await tab.insertText("Show me products");
    await tab.pressKey("Enter");
    await tab.waitForFunction("window.__api.some((call) => call.url.includes('/api/event'))", 5_000);
    await new Promise((resolve) => { setTimeout(resolve, 600); });

    assert.equal(await tab.evaluate<boolean>("window.__api.some((call) => call.url.includes('/api/turn'))"), false, "no turn is sent after a refused start");
    assert.equal(await tab.evaluate<string>("document.documentElement.dataset.mode"), "stays", "data-mode stays on the server's mode");
    assert.equal(await tab.evaluate<string | undefined>("document.getElementById('vertical-starters').dataset.previewMode"), undefined, "the preview is dropped");
    assert.equal(await tab.evaluate<string>("document.getElementById('composer-input').value"), "Show me products", "the composer keeps the guest's text");
    await tab.close();
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test("ADR 0078 (WCAG 1.4.11, 2.4.7): the checked choice looks different from an unchecked one, and a focused radio draws a visible outline", async () => {
  const fixture = await startTwoModeServer();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setViewport(1280, 900);
    await tab.navigate(`${fixture.base}/`);
    await tab.waitForSelector('.mode-choice input[value="shop"]');

    const look = (domain: string) => `(() => { const s = getComputedStyle(document.querySelector('.mode-choice[data-domain="${domain}"]')); return { border: s.borderColor, background: s.backgroundColor }; })()`;
    const checked = await tab.evaluate<{ border: string; background: string }>(look("shortlet"));
    const unchecked = await tab.evaluate<{ border: string; background: string }>(look("shop"));
    assert.ok(checked.border !== unchecked.border || checked.background !== unchecked.background, `the checked choice differs (${JSON.stringify(checked)} vs ${JSON.stringify(unchecked)})`);

    const focus = await tab.evaluate<{ visible: boolean; outlineStyle: string }>(`(() => {
      const input = document.querySelector('.mode-choice input[value="shop"]');
      input.focus();
      return { visible: input.matches(':focus-visible'), outlineStyle: getComputedStyle(document.querySelector('.mode-choice[data-domain="shop"]')).outlineStyle };
    })()`);
    assert.equal(focus.visible, true, "the focused radio matches :focus-visible");
    assert.notEqual(focus.outlineStyle, "none", "the focused radio's label draws an outline");
    await tab.close();
  } finally {
    await browser.close();
    await fixture.close();
  }
});
