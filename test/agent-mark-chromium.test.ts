import assert from "node:assert/strict";
import test from "node:test";
import { launchRealBrowser, type RealBrowserTab } from "./helpers/chrome-devtools.js";
import { HELD_TURN_MS, startHeldTurnServer } from "./helpers/agent-mark-fixture.js";
import { AGENT_MARK_STATES } from "../apps/local-guest/src/agent-mark-state.js";
import { startLocalGuestServer } from "../apps/local-guest/src/guest-server.js";
import { createFakeShopPack } from "./helpers/fake-domain-pack.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

test("AC9 tier C: suggestion chip and suggesting mark reflow at 320, 390, 768 and 1280", async () => {
  const server = startLocalGuestServer({ conciergeMode: "assistant-offline", port: 0, additionalPacks: [createFakeShopPack()],
    modelClient: { generate: async () => ({ text: JSON.stringify({ scope: "out_of_scope", targetPack: "shop", risk: "ordinary", intents: [], reasonCode: "outside",
      slots: { city: null, neighbourhood: null, bedrooms: null, nights: null, guests: null, checkIn: null, checkOut: null } }) }) } });
  const base = `http://127.0.0.1:${await server.listen()}`;
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    for (const width of [320, 390, 768, 1280]) {
      await tab.setViewport(width, 850);
      await tab.navigate(`${base}/`);
      await tab.waitForSelector("#composer-input");
      await sendMessage(tab, "buy a kettle");
      await tab.waitForText("Switch to Concierge · Shop", 15_000);
      const size = await tab.evaluate<{ width: number; height: number; overflows: boolean; mark: string }>(`(() => {
        const chip = [...document.querySelectorAll('.quick-reply')].find((node) => node.textContent === 'Switch to Concierge · Shop');
        const rect = chip.getBoundingClientRect();
        return { width: rect.width, height: rect.height, overflows: document.documentElement.scrollWidth > innerWidth,
          mark: document.querySelector('[data-agent-mark="appbar"]')?.getAttribute('data-agent-state') ?? '' };
      })()`);
      assert.ok(size.width >= 44 && size.height >= 44, `${width}px: target is at least 44×44`);
      assert.equal(size.overflows, false, `${width}px: no horizontal overflow`);
      assert.equal(size.mark, "suggesting", `${width}px: suggested response drives the mark`);
      mkdirSync(join("screenshots", "03f"), { recursive: true });
      writeFileSync(join("screenshots", "03f", `suggestion-${width}.png`), await tab.captureScreenshot());
    }
    await tab.close();
  } finally { await browser.close(); await server.close(); }
});

test("AC10 tier C: a busy task event leaves a restored suggestion chip and transcript untouched", async () => {
  const server = startLocalGuestServer({ conciergeMode: "assistant-offline", port: 0, additionalPacks: [createFakeShopPack()],
    modelClient: { generate: async () => ({ text: JSON.stringify({ scope: "out_of_scope", targetPack: "shop", risk: "ordinary", intents: [], reasonCode: "outside",
      slots: { city: null, neighbourhood: null, bedrooms: null, nights: null, guests: null, checkIn: null, checkOut: null } }) }) } });
  const base = `http://127.0.0.1:${await server.listen()}`;
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.navigate(`${base}/`);
    await tab.waitForSelector("#composer-input");
    await sendMessage(tab, "buy a kettle");
    await tab.waitForText("Switch to Concierge · Shop", 15_000);
    // Create a second task and return to stays before a fresh suggestion, so the restored active lane ends with that suggestion.
    const seeded = await tab.evaluate<boolean>(`(async () => {
      const id = sessionStorage.getItem('shortlet-concierge-thread');
      for (const domain of ['shop', 'shortlet']) {
        const response = await fetch('/api/event', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({
          threadId:id, name:'platform.task.start', surfaceId:'thread-'+id+':tasks', sourceComponentId:'task-rail', timestamp:new Date().toISOString(), context:{domain}
        }) });
        if (!(await response.json()).ok) return false;
      }
      return true;
    })()`);
    assert.equal(seeded, true);
    await tab.navigate(`${base}/`);
    await tab.waitForSelector("#composer-input");
    await sendMessage(tab, "buy a kettle again");
    await tab.waitForText("Switch to Concierge · Shop", 15_000);
    await tab.navigate(`${base}/`);
    await tab.waitForSelector('.quick-reply');
    const before = await tab.evaluate<number>(`document.querySelectorAll('.turn.user').length`);
    await tab.evaluate(`(() => {
      const original = window.fetch.bind(window);
      window.fetch = (...args) => {
        if (args[0] === '/api/event') return new Promise((resolve) => { window.__releaseTaskEvent = () => resolve(original(...args)); });
        return original(...args);
      };
      document.querySelector('.ui-task-rail__item[data-domain="shop"]').click();
    })()`);
    await tab.waitForFunction("typeof window.__releaseTaskEvent === 'function'");
    await tab.evaluate(`document.querySelector('.quick-reply').click()`);
    assert.equal(await tab.evaluate<number>(`document.querySelectorAll('.turn.user').length`), before, "no optimistic user turn during another task event");
    assert.equal(await tab.evaluate<boolean>(`!!document.querySelector('.quick-reply')`), true, "the suggestion stays actionable after the busy event");
    await tab.evaluate(`window.__releaseTaskEvent()`);
    await tab.waitForFunction("document.querySelector('.ui-task-rail__item[data-domain=\"shop\"]')?.disabled === true");
    await tab.close();
  } finally { await browser.close(); await server.close(); }
});

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
