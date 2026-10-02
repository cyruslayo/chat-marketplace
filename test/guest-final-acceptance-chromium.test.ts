import assert from "node:assert/strict";
import test from "node:test";
import { launchRealBrowser } from "./helpers/chrome-devtools.js";
import { restartFixture } from "./helpers/guest-restart.js";
import { withStagePage } from "./helpers/guest-stage-pages.js";

// Guest UI consistency issue 11 in real Chromium: the desktop split, and reflow at 200% zoom with reduced motion.

const SEARCH = "I need an apartment in Ikoyi from 10 Sept for 3 nights for 2 people";
type Box = { readonly left: number; readonly right: number; readonly width: number };
const box = (selector: string) => `(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r ? { left: r.left, right: r.right, width: r.width } : null; })()`;

test("AC1: at 1280px the conversation and workspace sit side by side, the workspace content is at most 560px (discovery 760px) and nothing overlaps", async () => {
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setViewport(1280, 800);
    await tab.navigate(`${fixture.base}/`);
    await tab.focus("#composer-input");
    await tab.insertText(SEARCH);
    await tab.pressKey("Enter");
    await tab.waitForSelector("#active-workspace .stay-card", 10_000);

    const layout = () => tab.evaluate<{ transcript: Box; workspace: Box; appbar: Box; overflow: number }>(`({ transcript: ${box("#transcript")}, workspace: ${box("#active-workspace")}, appbar: ${box(".ui-appbar")}, overflow: document.documentElement.scrollWidth - innerWidth })`);
    const discovery = await layout();
    // Failure path: a workspace wider than the reading width, or one that overlaps the conversation, fails.
    assert.ok(discovery.workspace.width <= 760, `discovery workspace ${discovery.workspace.width}px`);
    assert.ok(discovery.transcript.right <= discovery.workspace.left, "side by side, no overlap");
    assert.ok(Math.abs(discovery.transcript.width - 460) <= 40, `conversation column ${discovery.transcript.width}px`);
    assert.ok(discovery.appbar.width >= 1279, "the app bar spans the full width");
    assert.equal(discovery.overflow <= 0, true);
    assert.equal(await tab.evaluate<number>("getComputedStyle(document.querySelector('#active-workspace .stay-grid')).gridTemplateColumns.split(' ').length"), 2, "discovery lays out two stay cards per row");

    assert.equal(await tab.clickButton("View apartment"), true);
    await tab.waitForSelector("#active-workspace .unit-detail-root", 10_000);
    const detail = await layout();
    assert.ok(detail.workspace.width <= 560, `reading workspace ${detail.workspace.width}px`);
    assert.ok(detail.transcript.right <= detail.workspace.left, "side by side, no overlap");
  } finally {
    await browser.close();
    await fixture.close();
  }
});

for (const [label, stage, ready] of [["request review", "review", ".request-screen"], ["payment choice", "payment-ready", ".payment-screen"]] as const) {
  test(`AC5: the ${label} screen reflows at 200% zoom and has no motion with reduced motion on`, async () => {
    await withStagePage({ label, stage }, async ({ fixture }) => {
      const browser = await launchRealBrowser();
      try {
        const tab = await browser.createTab();
        await tab.setExtraHeaders({ cookie: fixture.cookie });
        await tab.setReducedMotion(true);
        // 200% zoom of a 1280px window is a 640 CSS px viewport; 400% of 1280 is the 320px reflow case.
        for (const [width, height] of [[640, 400], [320, 256]] as const) {
          await tab.setCssViewport(width, height);
          await tab.navigate(`${fixture.base}/?threadId=${fixture.threadId}`);
          await tab.waitForSelector(`#active-workspace ${ready}`, 10_000);
          const result = await tab.evaluate<{ overflow: number; clipped: string[]; motion: string[] }>(`(() => {
            const bounds = document.documentElement.clientWidth;
            const clipped = [...document.querySelectorAll('#active-workspace *')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > bounds + 1 || r.left < -1); }).map((el) => el.className || el.tagName);
            const motion = [...document.querySelectorAll('#active-workspace, #active-workspace *')].filter((el) => { const s = getComputedStyle(el); return parseFloat(s.animationDuration) > 0.00001 && s.animationName !== 'none' || parseFloat(s.transitionDuration) > 0.00001; }).map((el) => el.className || el.tagName);
            return { overflow: document.documentElement.scrollWidth - bounds, clipped, motion };
          })()`);
          assert.ok(result.overflow <= 0, `${label} overflows ${result.overflow}px at ${width}`);
          assert.deepEqual(result.clipped, [], `${label} clips content at ${width}`);
          assert.deepEqual(result.motion, [], `${label} animates with reduced motion at ${width}`);
        }
      } finally { await browser.close(); }
    });
  });
}
