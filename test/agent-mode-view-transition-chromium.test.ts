import assert from "node:assert/strict";
import test from "node:test";
import { launchRealBrowser, type RealBrowserTab } from "./helpers/chrome-devtools.js";
import { startLocalGuestServer } from "../apps/local-guest/src/guest-server.js";
import { ScriptedAssistantModel } from "../apps/local-guest/src/assistant/scripted-assistant-model.js";
import { createFakeShopPack } from "./helpers/fake-domain-pack.js";

/*
 * Issue 03j of the agent-modes effort (ADR 0107 decision 7, ADR 0078), in real Chrome. Run this file solo. The fake shop pack is
 * registered only here, so two modes are offered (stays and shop). The page's startViewTransition is wrapped before the switch, so
 * the calls and the view transition's own state are read from the page, not assumed.
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

/**
 * Records every startViewTransition call: whether it was typed, its types, the named app bar during the transition, whether the page
 * ever overflowed horizontally while the transition ran, and whether it did after it finished.
 */
const RECORD_VIEW_TRANSITIONS = `(() => {
  window.__vt = [];
  const original = document.startViewTransition.bind(document);
  document.startViewTransition = function (arg) {
    const typed = typeof arg === 'object' && arg !== null;
    const entry = { typed, types: typed && Array.isArray(arg.types) ? [...arg.types] : null, names: [], overflowDuring: false, overflowAfter: null, frames: 0, done: false, readyOk: false };
    window.__vt.push(entry);
    const transition = original(arg);
    const overflows = () => document.documentElement.scrollWidth > document.documentElement.clientWidth;
    const sample = () => {
      if (overflows()) entry.overflowDuring = true;
      const bar = document.querySelector('.ui-appbar');
      if (bar && entry.names.length < 3) entry.names.push(getComputedStyle(bar).getPropertyValue('view-transition-name').trim());
      entry.frames += 1;
      if (document.activeViewTransition && entry.frames < 240) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    transition.ready.then(() => { entry.readyOk = true; }, () => { entry.failed = true; });
    transition.finished.then(() => { entry.overflowAfter = overflows(); entry.done = true; }, () => { entry.done = true; entry.failed = true; });
    return transition;
  };
})()`;

/** Opens the mode sheet from the app-bar mark and commits the shop mode from its choices (the sheet commits at once). */
async function switchToShopFromSheet(tab: RealBrowserTab): Promise<void> {
  await tab.waitForSelector(".mode-mark");
  await tab.evaluate("document.querySelector('.mode-mark').click()");
  await tab.waitForFunction("document.querySelector('dialog.mode-sheet')?.open === true", 5_000);
  await tab.evaluate("document.querySelector('dialog.mode-sheet .mode-choice input[value=\"shop\"]').click()");
  await tab.waitForFunction("document.documentElement.dataset.mode === 'shop'", 10_000);
}

const TRANSITIONS = "window.__vt";

test("AC1 and AC9 (real Chrome): a confirmed switch runs one typed mode-switch transition, names the app bar, and leaves no horizontal overflow at 375 px", async () => {
  const fixture = await startTwoModeServer();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setViewport(375, 812);
    await tab.navigate(`${fixture.base}/`);
    await tab.waitForSelector("#composer-input");
    await tab.evaluate(RECORD_VIEW_TRANSITIONS);

    await switchToShopFromSheet(tab);
    await tab.waitForFunction(`${TRANSITIONS}.length === 1 && ${TRANSITIONS}[0].done === true`, 10_000);

    const entries = await tab.evaluate<{ typed: boolean; types: string[] | null; names: string[]; overflowDuring: boolean; overflowAfter: boolean | null; readyOk: boolean; failed?: boolean }[]>(TRANSITIONS);
    assert.equal(entries.length, 1, "the switch starts exactly one view transition");
    assert.equal(entries[0]!.typed, true, "the switch uses the typed form");
    assert.deepEqual(entries[0]!.types, ["mode-switch"], "the transition type is mode-switch");
    assert.ok(entries[0]!.names.includes("app-bar"), "the app bar keeps its shared name during the switch");
    assert.equal(entries[0]!.readyOk, true, "the transition is ready (it was not skipped)");
    assert.equal(entries[0]!.failed, undefined, "the transition finishes");
    assert.equal(entries[0]!.overflowDuring, false, "no horizontal overflow while the transition runs at 375 px");
    assert.equal(entries[0]!.overflowAfter, false, "no horizontal overflow after the transition at 375 px");
    assert.equal(await tab.evaluate<boolean>("document.documentElement.scrollWidth > document.documentElement.clientWidth"), false, "no horizontal overflow after the switch");
    await tab.close();
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test("AC9 fallback (real Chrome): when the typed form throws, the untyped transition runs a switch with no horizontal overflow at 375 px", async () => {
  const fixture = await startTwoModeServer();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setViewport(375, 812);
    await tab.navigate(`${fixture.base}/`);
    await tab.waitForSelector("#composer-input");
    await tab.evaluate(RECORD_VIEW_TRANSITIONS);
    // A browser without transition types rejects the options object; only the callback form is accepted.
    await tab.evaluate(`(() => {
      const recorded = document.startViewTransition;
      document.startViewTransition = function (arg) {
        if (typeof arg === 'object' && arg !== null) throw new TypeError('startViewTransition: argument is not a function');
        return recorded.call(document, arg);
      };
    })()`);

    await switchToShopFromSheet(tab);
    await tab.waitForFunction(`${TRANSITIONS}.length === 1 && ${TRANSITIONS}[0].done === true`, 10_000);

    const entries = await tab.evaluate<{ typed: boolean; types: string[] | null; overflowDuring: boolean; overflowAfter: boolean | null; readyOk: boolean; failed?: boolean }[]>(TRANSITIONS);
    assert.equal(entries.length, 1, "the fallback starts exactly one untyped transition");
    assert.equal(entries[0]!.typed, false, "the fallback is the untyped form");
    assert.equal(entries[0]!.types, null, "the untyped form carries no type");
    assert.equal(entries[0]!.readyOk, true, "the untyped transition is ready");
    assert.equal(entries[0]!.overflowDuring, false, "no horizontal overflow during the untyped transition at 375 px");
    assert.equal(entries[0]!.overflowAfter, false, "no horizontal overflow after the untyped transition at 375 px");
    assert.equal(await tab.evaluate<string>("document.documentElement.dataset.mode"), "shop", "the switch still applies");
    await tab.close();
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test("AC10 (real Chrome): under prefers-reduced-motion: reduce a switch applies at once, starts no view transition, and leaves no animation running", async () => {
  const fixture = await startTwoModeServer();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setViewport(390, 844);
    await tab.setReducedMotion(true);
    await tab.navigate(`${fixture.base}/`);
    await tab.waitForSelector("#composer-input");
    await tab.evaluate(RECORD_VIEW_TRANSITIONS);

    await switchToShopFromSheet(tab);
    await new Promise((resolve) => { setTimeout(resolve, 450); });

    assert.equal(await tab.evaluate<number>(`${TRANSITIONS}.length`), 0, "no view transition is started under reduced motion");
    assert.equal(await tab.evaluate<boolean>("document.activeViewTransition !== null && document.activeViewTransition !== undefined"), false, "no view transition is running after the switch");
    assert.equal(await tab.evaluate<number>("document.getAnimations().length"), 0, "document.getAnimations() is empty after the switch");
    assert.equal(await tab.evaluate<string>("document.documentElement.dataset.mode"), "shop", "the switch still applies");
    await tab.close();
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test("AC3 (real Chrome): the first-message hero transition is unchanged: one untyped call, no mode-switch type", async () => {
  const fixture = await startTwoModeServer();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setViewport(1280, 900);
    await tab.navigate(`${fixture.base}/`);
    await tab.waitForSelector("#composer-input");
    await tab.evaluate(RECORD_VIEW_TRANSITIONS);

    await tab.focus("#composer-input");
    await tab.insertText("Find me a flat in Lekki");
    await tab.pressKey("Enter");
    await tab.waitForFunction(`${TRANSITIONS}.length >= 1`, 10_000);

    const entries = await tab.evaluate<{ typed: boolean; types: string[] | null }[]>(TRANSITIONS);
    assert.equal(entries.length, 1, "the first message starts one transition (the hero)");
    assert.equal(entries[0]!.typed, false, "the hero transition keeps the untyped form");
    assert.equal(entries[0]!.types, null, "the hero transition has no transition type");
    await tab.close();
  } finally {
    await browser.close();
    await fixture.close();
  }
});
