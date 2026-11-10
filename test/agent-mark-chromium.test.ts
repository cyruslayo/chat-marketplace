import assert from "node:assert/strict";
import test from "node:test";
import { launchRealBrowser, type RealBrowserTab } from "./helpers/chrome-devtools.js";
import { HELD_TURN_MS, startHeldTurnServer } from "./helpers/agent-mark-fixture.js";
import { AGENT_MARK_STATES } from "../apps/local-guest/src/agent-mark-state.js";

/*
 * Issue 01b of the agent-modes effort (ADR 0107 decision 9, WCAG 2.2.2, ADR 0078). Real Chrome, one file at a time.
 * Seams (see test/agent-mark-shell.test.ts for the full contract): marks are [data-agent-mark="hero|appbar|dock"] with
 * data-agent-state; the presence dock is #agent-dock, hidden when no turn is in flight; #working-status is the
 * accessible signal. The held turn comes from test/helpers/agent-mark-fixture.ts.
 */

/** Counts the running animations on the agent marks and the dock. Zero means nothing loops (AC3, AC4, AC5). */
const RUNNING_MARK_ANIMATIONS = `(() => document.getAnimations().filter((animation) => {
  const target = animation.effect && animation.effect.target;
  return target instanceof Element && target.closest('[data-agent-mark], #agent-dock') !== null && animation.playState === 'running';
}).length)()`;

/** Sets every mark and the dock to one state, so the reduced-motion and pause checks cover each state without a live turn. */
function setAllMarksTo(state: string): string {
  return `(() => {
    for (const el of document.querySelectorAll('[data-agent-mark], #agent-dock')) el.setAttribute('data-agent-state', ${JSON.stringify(state)});
    const dock = document.getElementById('agent-dock');
    if (dock) dock.hidden = false;
  })()`;
}

async function sendMessage(tab: RealBrowserTab, text: string): Promise<void> {
  await tab.focus("#composer-input");
  await tab.insertText(text);
  await tab.pressKey("Enter");
}

test("AC3: Reduced motion has no animation", async () => {
  const fixture = await startHeldTurnServer();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setReducedMotion(true);
    await tab.navigate(`${fixture.base}/`);
    await tab.waitForSelector('[data-agent-mark="hero"]');
    assert.equal(await tab.evaluate("!!document.getElementById('agent-dock')"), true, "the presence dock is in the shell");

    for (const state of AGENT_MARK_STATES) {
      await tab.evaluate(setAllMarksTo(state));
      assert.equal(await tab.evaluate<number>(RUNNING_MARK_ANIMATIONS), 0, `no mark or dock animates in ${state} under reduced motion`);
    }
    await tab.close();
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test("AC4: Nothing loops past 5 seconds while a turn is held in flight", async () => {
  assert.ok(HELD_TURN_MS > 5_000, "the held turn outlasts the 5 second limit");
  const fixture = await startHeldTurnServer();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setReducedMotion(false);
    await tab.navigate(`${fixture.base}/`);
    await tab.waitForSelector("#composer-input");
    await sendMessage(tab, "I need a place in Ikoyi for 4 nights for 2 guests");
    await tab.waitForFunction("!document.getElementById('working-status').hidden", 5_000);

    await new Promise((resolve) => {
      setTimeout(resolve, 5_200);
    });
    assert.equal(await tab.evaluate<boolean>("document.getElementById('working-status').hidden"), false, "#working-status still reports the turn after 5 seconds");
    assert.notEqual(await tab.evaluate<string>("document.getElementById('working-status').textContent"), "", "#working-status carries the working copy");
    assert.equal(
      await tab.evaluate<string | null>("document.querySelector('[data-agent-mark=\"dock\"]')?.getAttribute('data-agent-state') ?? null"),
      "thinking",
      "the dock mark is thinking while the turn is held",
    );
    assert.equal(await tab.evaluate<number>(RUNNING_MARK_ANIMATIONS), 0, "the thinking mark has settled into its still form after 5 seconds");

    await tab.waitForFunction("document.getElementById('working-status').hidden", HELD_TURN_MS + 15_000);
    await tab.close();
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test("AC5: Mark animation pauses while the document is hidden", async () => {
  const fixture = await startHeldTurnServer();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setReducedMotion(false);
    await tab.navigate(`${fixture.base}/`);
    await tab.waitForSelector('[data-agent-mark="hero"]');
    await tab.evaluate(setAllMarksTo("thinking"));
    assert.ok((await tab.evaluate<number>(RUNNING_MARK_ANIMATIONS)) > 0, "a mark animates while the page is visible");

    // Simulate the page becoming hidden and let the shell's visibilitychange handler run.
    await tab.evaluate(`(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    })()`);
    await new Promise((resolve) => {
      setTimeout(resolve, 200);
    });
    assert.equal(await tab.evaluate<number>(RUNNING_MARK_ANIMATIONS), 0, "mark animations are paused while the document is hidden");
    await tab.close();
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test("AC7: The dock is visible while a turn is in flight, drops away when the reply lands, and the landmarks are unchanged", async () => {
  const fixture = await startHeldTurnServer();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setReducedMotion(false);
    await tab.navigate(`${fixture.base}/`);
    await tab.waitForSelector("#composer-input");
    const landmarks = `Array.from(document.querySelectorAll('main, [role="log"], form#composer, #criteria-strip, #workspace-region')).map((el) => el.id || el.tagName).join('|')`;
    const before = await tab.evaluate<string>(landmarks);

    await sendMessage(tab, "I need a place in Ikoyi for 4 nights for 2 guests");
    await tab.waitForFunction("!document.getElementById('agent-dock').hidden", 5_000);
    assert.equal(await tab.evaluate<boolean>("document.getElementById('agent-dock').hidden"), false, "the dock is visible while the turn is in flight");

    await tab.waitForFunction("document.getElementById('agent-dock').hidden === true", HELD_TURN_MS + 15_000);
    assert.equal(await tab.evaluate<string>(landmarks), before, "the conversation landmarks are unchanged after the reply");
    await tab.close();
  } finally {
    await browser.close();
    await fixture.close();
  }
});
