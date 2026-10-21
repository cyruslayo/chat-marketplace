import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import {
  startLocalGuestServer,
  type LocalGuestServerHandle,
} from "../apps/local-guest/src/guest-server.js";
import {
  launchRealBrowser,
  type RealBrowserInstance,
  type RealBrowserTab,
} from "./helpers/chrome-devtools.js";
import { renderLandingHtml } from "../apps/local-guest/src/landing-page-html.js";
import {
  contrastRatio,
  contrastRatioOfLuminances,
  landingTokenSets,
  relativeLuminanceRgb,
} from "./helpers/landing-tokens.js";

// Issue 02 (landing motion script) in real Chromium: .scratch/landing-page/issues/02-landing-motion-script.md.

const MESSAGE = "An apartment in Lagos from 10 Sept, 3 nights, 2 of us";
const PLACEHOLDER = "Ask about these stays…";

interface LandingPage {
  readonly server: LocalGuestServerHandle;
  readonly browser: RealBrowserInstance;
  readonly tab: RealBrowserTab;
  readonly base: string;
  close(): Promise<void>;
}

/** The real guest server (public /welcome, /landing.js) in headless Chromium at the given viewport. */
async function openLanding(
  width: number,
  height: number,
  reducedMotion: boolean,
  headers?: Readonly<Record<string, string>>,
): Promise<LandingPage> {
  const directory = mkdtempSync(join(tmpdir(), "landing-motion-browser-"));
  const environment = LocalGuestEnvironment.openNode({
    databasePath: join(directory, "guest.sqlite"),
  });
  const server = startLocalGuestServer({ port: 0, environment });
  let browser: RealBrowserInstance | undefined;
  let tab: RealBrowserTab | undefined;
  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    let browserClosed = false;
    try {
      try {
        await tab?.close();
      } catch {
        // The tab may already be gone; browser.close still verifies owned-process termination.
      }
      await browser?.close({ releaseLock: false });
      browserClosed = true;
    } finally {
      try {
        await server.close();
      } finally {
        // Never release the shared browser lock if Chrome termination failed.
        if (browserClosed) {
          try {
            rmSync(directory, { recursive: true, force: true });
          } finally {
            browser?.releaseLock();
          }
        }
      }
    }
  };
  try {
    const port = await server.listen();
    browser = await launchRealBrowser({ headless: true });
    tab = await browser.createTab();
    await tab.setViewport(width, height);
    await tab.setReducedMotion(reducedMotion);
    // Issue 04: the saved theme travels as the shortlet_theme cookie, exactly as a returning browser would send it.
    if (headers) await tab.setExtraHeaders(headers);
    return { server, browser, tab, base: `http://127.0.0.1:${port}`, close };
  } catch (error) {
    await close();
    throw error;
  }
}

/** A staged element is shown when it is not pending (pending elements keep their space but are invisible). */
const shownExpr = (selector: string): string =>
  `!document.querySelector(${JSON.stringify(selector)}).classList.contains('landing-pending')`;

/**
 * Records every reveal as "<play>|<stage|only><k>" in window.__landingShows (a staged element leaves its pending class,
 * a transient element loses its hidden attribute), and the page height at each change in window.__layout.
 */
const RECORD_SHOWS = `(() => {
  window.__landingShows = [];
  window.__layout = [];
  new MutationObserver((records) => {
    for (const record of records) {
      const el = record.target;
      window.__layout.push(document.documentElement.scrollHeight);
      const play = el.closest('[data-landing-play]')?.dataset.landingPlay ?? '?';
      const wasPending = (record.oldValue ?? '').split(/\\s+/).includes('landing-pending');
      const revealed = record.attributeName === 'class' ? wasPending && !el.classList.contains('landing-pending') : record.oldValue !== null && !el.hasAttribute('hidden');
      if (!revealed) continue;
      const kind = el.dataset.landingStage ? 'stage' + el.dataset.landingStage : 'only' + el.dataset.landingOnly;
      window.__landingShows.push(play + '|' + kind);
    }
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden', 'class'], attributeOldValue: true });
})()`;

async function playShows(tab: RealBrowserTab, play: string): Promise<string[]> {
  const entries = await tab.evaluate<string[]>("window.__landingShows");
  return entries
    .filter((entry) => entry.startsWith(`${play}|`))
    .map((entry) => entry.slice(play.length + 1));
}

test("AC1 — /landing.js is served as JavaScript with 200 from the public path, even with a stale session", async () => {
  const page = await openLanding(390, 800, false);
  try {
    const response = await fetch(`${page.base}/landing.js`);
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get("content-type") ?? "",
      /^text\/javascript/,
    );
    assert.ok((await response.text()).length > 0, "the bundle is not empty");
    const stale = await fetch(`${page.base}/landing.js`, {
      headers: { cookie: "shortlet_guest_session=gs-bad" },
    });
    assert.equal(stale.status, 200, "a stale session does not block it");
  } finally {
    await page.close();
  }
});

test("AC2 — with reduced motion every final state is visible and nothing animates", async () => {
  const page = await openLanding(1280, 800, true);
  try {
    await page.tab.navigate(`${page.base}/welcome`);
    const snapshot = `(() => ({
      hidden: [...document.querySelectorAll('[data-landing-stage], [data-landing-only]')].map((el) => el.hidden || el.classList.contains('landing-pending')),
      moving: document.querySelectorAll('.landing-enter, .landing-pending, .is-sending').length,
      pinned: document.querySelectorAll('.landing-pinned').length,
      field: document.querySelector('[data-landing-field]').textContent,
    }))()`;
    const first = await page.tab.evaluate<{
      hidden: boolean[];
      moving: number;
      pinned: number;
      field: string;
    }>(snapshot);
    await new Promise((resolve) => setTimeout(resolve, 4500));
    const later = await page.tab.evaluate<typeof first>(snapshot);
    assert.deepEqual(later, first, "nothing changes over the sequence length");
    assert.equal(later.moving, 0);
    assert.equal(later.pinned, 0, "no pinned phone");
    assert.equal(
      later.field,
      PLACEHOLDER,
      "the message box shows its placeholder",
    );
    const finalState = await page.tab.evaluate<{
      stagesShown: boolean;
      onlyHidden: boolean;
    }>(`(() => ({
      stagesShown: [...document.querySelectorAll('[data-landing-stage]')].every((el) => !el.classList.contains('landing-pending')),
      onlyHidden: [...document.querySelectorAll('[data-landing-only]')].every((el) => el.hidden),
    }))()`);
    assert.deepEqual(finalState, { stagesShown: true, onlyHidden: true });
  } finally {
    await page.close();
  }
});

test("AC1 — below desktop width the beats keep their final state and never reset or play, so nothing flashes", async () => {
  const page = await openLanding(390, 800, false);
  try {
    await page.tab.navigate(`${page.base}/welcome`);
    await page.tab.evaluate(RECORD_SHOWS);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assert.equal(
      await page.tab.evaluate<boolean>(
        shownExpr('[data-landing-play="beat-3"] [data-landing-stage="1"]'),
      ),
      true,
      "beat 3 stage 1 is shown at 390 px (it is not reset)",
    );
    assert.equal(
      await page.tab.evaluate<number>(
        "document.querySelectorAll('.landing-beats .landing-pending').length",
      ),
      0,
      "no beat element is held back",
    );
    assert.deepEqual(
      await playShows(page.tab, "beat-3"),
      [],
      "nothing in beat 3 is revealed below desktop width",
    );
  } finally {
    await page.close();
  }
});

test("AC2 — the page height does not change while the hero or any beat plays", async () => {
  // Issue 09: beats play in the pinned phone at desktop width, so the height is compared there.
  const page = await openLanding(1280, 800, false);
  try {
    await page.tab.navigate(`${page.base}/welcome`);
    await page.tab.waitForSelector(".landing-pinned", 10_000);
    await page.tab.evaluate(RECORD_SHOWS);
    // The web fonts swap in after navigation and change the height by a few pixels (measured: 8063 before, 8058 after).
    // Measure the start after they settle, so only the motion is compared.
    await page.tab.evaluate("document.fonts.ready.then(() => true)");
    const start = await page.tab.evaluate<number>(
      "document.documentElement.scrollHeight",
    );
    await page.tab.waitForFunction(
      "window.__landingShows.includes('hero|stage4')",
      10_000,
    );
    const last: Record<string, string> = {
      "beat-1": "stage4",
      "beat-2": "stage4",
      "beat-3": "stage4",
      "beat-4": "stage4",
      "beat-5": "stage6",
    };
    for (const [play, stage] of Object.entries(last)) {
      await page.tab.evaluate(
        `document.querySelector('[data-landing-caption="${play.slice(5)}"]').scrollIntoView({ block: 'center' })`,
      );
      await page.tab.waitForFunction(
        `window.__landingShows.includes('${play}|${stage}')`,
        10_000,
      );
    }
    const heights = await page.tab.evaluate<number[]>("window.__layout");
    assert.ok(heights.length > 0, "the sequences changed the page");
    assert.deepEqual(
      [...new Set(heights)],
      [start],
      "the page height stayed the same through the hero and all five beats",
    );
  } finally {
    await page.close();
  }
});

test("AC3 — the hero types the message into the message box, then posts it as a bubble, and ends on the priced results", async () => {
  const page = await openLanding(390, 800, false);
  try {
    await page.tab.navigate(`${page.base}/welcome`);
    await page.tab.evaluate(
      `(() => { window.__typed = []; const field = document.querySelector('[data-landing-field]'); new MutationObserver(() => { window.__typed.push(field.textContent); if (field.textContent === ${JSON.stringify(MESSAGE)} && window.__tail === undefined) { const box = field.getBoundingClientRect(); const text = field.firstChild; const at = (start) => { const range = document.createRange(); range.setStart(text, start); range.setEnd(text, start + 1); return range.getBoundingClientRect(); }; const last = at(text.length - 1); const first = at(0); window.__tail = { lastInside: last.right <= box.right + 0.5 && last.left >= box.left - 0.5, firstClipped: first.left < box.left }; } }).observe(field, { childList: true, characterData: true, subtree: true }); })()`,
    );
    await page.tab.waitForFunction(shownExpr("[data-landing-message]"), 10_000);
    const typed = await page.tab.evaluate<string[]>("window.__typed");
    assert.ok(
      typed.some((text) => text.length > 0 && text.length < MESSAGE.length),
      "the box shows partial text while typing",
    );
    assert.equal(
      await page.tab.evaluate<string>(
        "document.querySelector('[data-landing-message]').textContent",
      ),
      MESSAGE,
      "the bubble carries the full message",
    );
    // Measured by the same observer that sees the full text, before the placeholder returns: the field is longer than its
    // box, so the newest character is inside the box and the first one has scrolled off the start.
    await page.tab.waitForFunction("window.__tail !== undefined", 5_000);
    const tail = await page.tab.evaluate<{
      lastInside: boolean;
      firstClipped: boolean;
    }>("window.__tail");
    assert.deepEqual(
      tail,
      { lastInside: true, firstClipped: true },
      "the newest characters stay visible while typing",
    );
    await page.tab.waitForFunction(
      `document.querySelector('[data-landing-field]').textContent === ${JSON.stringify(PLACEHOLDER)}`,
      5_000,
    );
    await page.tab.waitForFunction(
      shownExpr('[data-landing-play="hero"] [data-landing-stage="4"]'),
      10_000,
    );
    const results = await page.tab.evaluate<number>(
      `document.querySelectorAll('[data-landing-play="hero"] [data-landing-stage="4"] .ui-result-row').length`,
    );
    assert.equal(results, 2, "both priced results end visible");
  } finally {
    await page.close();
  }
});

test("AC4 — a beat plays its stages in order when it becomes active, and scrolling back does not replay it", async () => {
  const page = await openLanding(1280, 800, false);
  try {
    await page.tab.navigate(`${page.base}/welcome`);
    await page.tab.waitForSelector(".landing-pinned", 10_000);
    await page.tab.evaluate(RECORD_SHOWS);
    await page.tab.evaluate(
      `document.querySelector('[data-landing-caption="2"]').scrollIntoView({ block: 'center' })`,
    );
    await page.tab.waitForFunction(
      "window.__landingShows.includes('beat-2|stage4')",
      10_000,
    );
    assert.deepEqual(
      await playShows(page.tab, "beat-2"),
      ["only1", "stage2", "stage3", "stage4"],
      "stages show in order",
    );
    await page.tab.evaluate(
      `document.querySelector('[data-landing-caption="4"]').scrollIntoView({ block: 'center' })`,
    );
    await page.tab.waitForFunction(
      "window.__landingShows.includes('beat-4|stage4')",
      10_000,
    );
    await page.tab.evaluate(
      `document.querySelector('[data-landing-caption="2"]').scrollIntoView({ block: 'center' })`,
    );
    await page.tab.waitForFunction(
      "document.querySelector('[data-landing-caption=\"2\"]').classList.contains('is-active')",
      10_000,
    );
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.deepEqual(
      await playShows(page.tab, "beat-2"),
      ["only1", "stage2", "stage3", "stage4"],
      "scrolling back reactivates beat 2 without replaying it",
    );
  } finally {
    await page.close();
  }
});

test("AC5 — every landing sequence finishes in under five seconds in the browser", async () => {
  const page = await openLanding(1280, 800, false);
  try {
    await page.tab.navigate(`${page.base}/welcome`);
    await page.tab.waitForSelector(".landing-pinned", 10_000);
    await page.tab.evaluate(RECORD_SHOWS);
    await page.tab.evaluate("window.__scrolledAt = performance.now()");
    await page.tab.evaluate(
      `document.querySelector('[data-landing-caption="5"]').scrollIntoView({ block: 'center' })`,
    );
    await page.tab.waitForFunction(
      "window.__landingShows.includes('beat-5|stage6')",
      10_000,
    );
    const elapsed = await page.tab.evaluate<number>(
      "performance.now() - window.__scrolledAt",
    );
    assert.ok(elapsed < 5000, `beat 5 finished in ${Math.round(elapsed)} ms`);
    assert.deepEqual(await playShows(page.tab, "beat-5"), [
      "stage1",
      "stage2",
      "stage3",
      "stage4",
      "stage5",
      "stage6",
    ]);
  } finally {
    await page.close();
  }
});

test("AC6 — transient elements are visible only during their own stage", async () => {
  const page = await openLanding(1280, 800, false);
  try {
    await page.tab.navigate(`${page.base}/welcome`);
    await page.tab.waitForSelector(".landing-pinned", 10_000);
    await page.tab.evaluate(RECORD_SHOWS);
    await page.tab.evaluate(
      `document.querySelector('[data-landing-caption="4"]').scrollIntoView({ block: 'center' })`,
    );
    await page.tab.waitForFunction(
      "window.__landingShows.includes('beat-4|stage4')",
      10_000,
    );
    assert.deepEqual(
      await playShows(page.tab, "beat-4"),
      ["stage1", "stage2", "only3", "stage4"],
      "the reviewing line shows only during stage 3",
    );
    assert.equal(
      await page.tab.evaluate<boolean>(
        `document.querySelector('.landing-pinned [data-landing-only="3"]').hidden`,
      ),
      true,
      "and is hidden after it",
    );
  } finally {
    await page.close();
  }
});

test("AC7 — at 1280 px a sticky phone is created beside the captions and shows the active beat, with the inline screens hidden", async () => {
  const page = await openLanding(1280, 800, false);
  try {
    await page.tab.navigate(`${page.base}/welcome`);
    await page.tab.waitForSelector(".landing-pinned", 10_000);
    const inlineVisible = await page.tab.evaluate<number>(
      `[...document.querySelectorAll('.landing-beat [data-landing-screen]')].filter((el) => el.getClientRects().length > 0).length`,
    );
    assert.equal(
      inlineVisible,
      0,
      "the inline screens are hidden while pinned",
    );
    await page.tab.evaluate(
      `document.querySelector('[data-landing-caption="3"]').scrollIntoView({ block: 'center' })`,
    );
    await page.tab.waitForFunction(
      `document.querySelector('.landing-pinned [data-landing-screen]')?.getAttribute('aria-label') === 'Stay summary before sending the request'`,
      10_000,
    );
    const state = await page.tab.evaluate<{
      live: string;
      activeCaptions: string[];
      dimmed: number;
    }>(`(() => ({
      live: document.querySelector('.landing-pinned [aria-live="polite"]')?.textContent ?? '',
      activeCaptions: [...document.querySelectorAll('[data-landing-caption].is-active')].map((el) => el.dataset.landingCaption),
      dimmed: document.querySelectorAll('[data-landing-caption].is-dim').length,
    }))()`);
    assert.deepEqual(state.activeCaptions, ["3"]);
    assert.equal(state.dimmed, 4, "the other captions are dimmed");
    assert.match(
      state.live,
      /3 · Request/,
      "the live region names the active beat only",
    );
  } finally {
    await page.close();
  }
});

test("AC8 — below desktop width, beats stay inline with their own screens", async () => {
  const page = await openLanding(390, 800, false);
  try {
    await page.tab.navigate(`${page.base}/welcome`);
    await page.tab.waitForSelector('[data-landing-play="beat-5"]', 10_000);
    assert.equal(
      await page.tab.evaluate<number>(
        "document.querySelectorAll('.landing-pinned').length",
      ),
      0,
      "nothing is pinned at 390 px",
    );
    const screens = await page.tab.evaluate<number>(
      `[...document.querySelectorAll('.landing-beat [data-landing-screen]')].filter((el) => el.getClientRects().length > 0).length`,
    );
    assert.equal(screens, 5, "each beat keeps its own screen");
  } finally {
    await page.close();
  }
});

test("AC8 — on a page that does not scroll enough, nothing is pinned even at desktop width, and the pin is undone when the viewport changes", async () => {
  const page = await openLanding(1280, 800, false);
  try {
    await page.tab.navigate(`${page.base}/welcome`);
    await page.tab.waitForSelector(".landing-pinned", 10_000);
    const height = await page.tab.evaluate<number>(
      "document.documentElement.scrollHeight",
    );
    await page.tab.setViewport(1280, height);
    await page.tab.waitForFunction(
      "document.querySelectorAll('.landing-pinned').length === 0",
      10_000,
    );
    const screens = await page.tab.evaluate<number>(
      `[...document.querySelectorAll('[data-landing-screen]')].filter((el) => el.getClientRects().length > 0).length`,
    );
    assert.equal(screens, 5, "the inline screens return");
  } finally {
    await page.close();
  }
});

test("AC9 — beforeprint stops the motion and shows every final state", async () => {
  const page = await openLanding(390, 800, false);
  try {
    await page.tab.navigate(`${page.base}/welcome`);
    await page.tab.waitForFunction(shownExpr("[data-landing-message]"), 10_000);
    await page.tab.evaluate("window.dispatchEvent(new Event('beforeprint'))");
    const state = await page.tab.evaluate<{
      pending: number;
      onlyShown: number;
      field: string;
    }>(`(() => ({
      pending: document.querySelectorAll('[data-landing-stage].landing-pending').length,
      onlyShown: [...document.querySelectorAll('[data-landing-only]')].filter((el) => !el.hidden).length,
      field: document.querySelector('[data-landing-field]').textContent,
    }))()`);
    assert.deepEqual(state, { pending: 0, onlyShown: 0, field: PLACEHOLDER });
  } finally {
    await page.close();
  }
});

// Issue 09 (motion for the new layout) in real Chromium: .scratch/landing-page/issues/09-mix-motion.md.

const centreCaption = (step: number): string =>
  `document.querySelector('[data-landing-caption="${step}"]').scrollIntoView({ block: 'center' })`;
const captionIsActive = (step: number): string =>
  `document.querySelector('[data-landing-caption="${step}"]').classList.contains('is-active')`;
const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
const APP_BAR_ON_PHOTO =
  "document.querySelector('header.ui-appbar').classList.contains('landing-appbar--on-photo')";
const HEADLINE_TOP =
  "document.querySelector('.landing-hero h1').getBoundingClientRect().top + window.scrollY";
const FOCUS_OUTLINE =
  "(() => { const cs = getComputedStyle(document.activeElement); return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) }; })()";

test("Issue 09 AC1: On load, the hero chat window plays its sequence once and ends in the same final state as the no-JavaScript page", async () => {
  const page = await openLanding(1280, 800, false);
  try {
    await page.tab.navigate(`${page.base}/welcome`);
    await page.tab.evaluate(RECORD_SHOWS);
    await page.tab.waitForFunction(
      "window.__landingShows.includes('hero|stage4')",
      10_000,
    );
    await pause(300);
    const played = await playShows(page.tab, "hero");
    assert.deepEqual(
      [...new Set(played)],
      ["stage1", "stage2", "only3", "stage4"],
      "the hero plays its stages in order on load",
    );
    const before = played.length;
    await page.tab.evaluate(
      "window.scrollTo(0, document.documentElement.scrollHeight)",
    );
    await pause(800);
    await page.tab.evaluate("window.scrollTo(0, 0)");
    await pause(800);
    assert.equal(
      (await playShows(page.tab, "hero")).length,
      before,
      "scrolling away and back does not replay the hero",
    );
    const live = await page.tab.evaluate<{
      text: string;
      pending: number;
      onlyShown: number;
      sending: number;
      field: string;
    }>(`(() => ({
      text: document.querySelector('.landing-chat').textContent.replace(/\\s+/g, ' ').trim(),
      pending: document.querySelectorAll('.landing-chat [data-landing-stage].landing-pending').length,
      onlyShown: [...document.querySelectorAll('.landing-chat [data-landing-only]')].filter((el) => !el.hidden).length,
      sending: document.querySelectorAll('.landing-chat .is-sending').length,
      field: document.querySelector('.landing-chat [data-landing-field]').textContent,
    }))()`);
    const noScript = await page.tab.evaluate<string>(
      `fetch('/welcome').then((response) => response.text()).then((html) => new DOMParser().parseFromString(html, 'text/html').querySelector('.landing-chat').textContent.replace(/\\s+/g, ' ').trim())`,
    );
    assert.equal(
      live.text,
      noScript,
      "the played window has the same text as the no-JavaScript page",
    );
    assert.deepEqual(
      {
        pending: live.pending,
        onlyShown: live.onlyShown,
        sending: live.sending,
        field: live.field,
      },
      { pending: 0, onlyShown: 0, sending: 0, field: PLACEHOLDER },
      "and ends in the same final state",
    );
  } finally {
    await page.close();
  }
});

test("Issue 09 AC2: At 1280 wide, scrolling through how it works shows each step's screen in the pinned phone while that step is active", async () => {
  const page = await openLanding(1280, 800, false);
  try {
    await page.tab.navigate(`${page.base}/welcome`);
    await page.tab.waitForSelector(".landing-pinned", 10_000);
    const labels = await page.tab.evaluate<string[]>(
      `[1, 2, 3, 4, 5].map((k) => document.querySelector('.landing-beat[data-beat="' + k + '"] [data-landing-screen]').getAttribute('aria-label'))`,
    );
    assert.equal(new Set(labels).size, 5, "each step has its own screen");
    assert.equal(
      await page.tab.evaluate<string>(
        "getComputedStyle(document.querySelector('.landing-pinned')).position",
      ),
      "sticky",
      "the phone is sticky beside the steps",
    );
    for (const [index, label] of labels.entries()) {
      const step = index + 1;
      await page.tab.evaluate(centreCaption(step));
      await page.tab.waitForFunction(captionIsActive(step), 10_000);
      await page.tab.waitForFunction(
        `document.querySelector('.landing-pinned [data-landing-screen]')?.getAttribute('aria-label') === ${JSON.stringify(label)}`,
        10_000,
      );
      const state = await page.tab.evaluate<{
        phones: number;
        active: string[];
      }>(`(() => ({
        phones: document.querySelectorAll('.landing-pinned [data-landing-screen]').length,
        active: [...document.querySelectorAll('[data-landing-caption].is-active')].map((el) => el.dataset.landingCaption),
      }))()`);
      assert.deepEqual(
        state,
        { phones: 1, active: [String(step)] },
        `step ${step} is the active step and the phone holds only its screen`,
      );
    }
  } finally {
    await page.close();
  }
});

/** Six-digit hex to channels, and back. Used to mix a foreground over a background the way the browser composites alpha. */
function hexChannels(hex: string): number[] {
  return [1, 3, 5].map((index) =>
    Number.parseInt(hex.slice(index, index + 2), 16),
  );
}

function channelsToHex(channels: readonly number[]): string {
  return `#${channels
    .map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

/** The colour a foreground at the given alpha shows over a background (the old dimming: ink at 45% over the ground). */
function mixOver(
  foreground: string,
  alpha: number,
  background: string,
): string {
  const fore = hexChannels(foreground);
  const back = hexChannels(background);
  return channelsToHex(
    fore.map((channel, index) => alpha * channel + (1 - alpha) * back[index]!),
  );
}

/** A computed opaque rgb() colour as a six-digit hex. Fails on alpha below 1 or a missing colour. */
function opaqueRgbToHex(rgb: string): string {
  const match = /^rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)$/.exec(rgb);
  assert.ok(match, `${rgb} is an rgb colour`);
  assert.ok(
    match[4] === undefined || Number(match[4]) === 1,
    `${rgb} is opaque`,
  );
  return channelsToHex([Number(match[1]), Number(match[2]), Number(match[3])]);
}

test("Issue 09 AC3: Steps that aren't active are dimmed but stay readable and in the accessibility tree", async () => {
  // The contrast tokens come from the stylesheet itself, so the test and the CSS cannot drift apart.
  const sets = landingTokenSets(
    readFileSync(
      join(
        import.meta.dirname,
        "..",
        "apps",
        "web",
        "src",
        "shortlet-landing.css",
      ),
      "utf8",
    ),
  );
  const scenarios: {
    label: string;
    headers: Readonly<Record<string, string>>;
    tokens: Readonly<Record<string, string>>;
  }[] = [
    {
      label: "light",
      headers: { cookie: "shortlet_theme=light" },
      tokens: sets.light,
    },
    {
      label: "dark",
      headers: { cookie: "shortlet_theme=dark" },
      tokens: sets.dark,
    },
  ];
  for (const scenario of scenarios) {
    const ground = scenario.tokens["--landing-ground"]!;
    const ink = scenario.tokens["--landing-ink"]!;
    const muted = scenario.tokens["--landing-ink-muted"]!;
    // Failure path: the old treatment (ink at 45% opacity over the ground) is below 4.5:1, so the old dimming fails this test.
    assert.ok(
      contrastRatio(mixOver(ink, 0.45, ground), ground) < 4.5,
      `${scenario.label}: the old 45% opacity dimming is below 4.5:1`,
    );
    assert.ok(
      contrastRatio(muted, ground) >= 4.5,
      `${scenario.label}: the inactive colour (ink-muted) is at least 4.5:1 on the ground`,
    );

    const page = await openLanding(1280, 800, false, scenario.headers);
    try {
      await page.tab.navigate(`${page.base}/welcome`);
      await page.tab.waitForSelector(".landing-pinned", 10_000);
      await page.tab.evaluate(centreCaption(3));
      await page.tab.waitForFunction(captionIsActive(3), 10_000);
      await pause(600);
      const steps = await page.tab.evaluate<
        {
          step: number;
          active: boolean;
          dimmed: boolean;
          hiddenByAncestor: boolean;
          textVisible: boolean;
          texts: {
            name: string;
            color: string;
            background: string;
            opacity: number;
          }[];
        }[]
      >(`[1, 2, 3, 4, 5].map((step) => {
        const caption = document.querySelector('[data-landing-caption="' + step + '"]');
        let hiddenByAncestor = false;
        let background = null;
        for (let el = caption; el; el = el.parentElement) {
          const style = getComputedStyle(el);
          if (el.getAttribute('aria-hidden') === 'true' || el.hidden || style.display === 'none' || style.visibility === 'hidden') hiddenByAncestor = true;
        }
        const parts = [...caption.querySelectorAll('h3, .landing-caption__body, .landing-pain')];
        const textVisible = parts.length === 3 && parts.every((el) => el.getClientRects().length > 0 && el.textContent.trim().length > 0 && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none');
        const texts = [['eyebrow', caption.querySelector('.ui-eyebrow')], ['heading', caption.querySelector('h3')], ['body', caption.querySelector('.landing-caption__body')], ['pain', caption.querySelector('.landing-pain')]].map(([name, el]) => {
          // The section background: the first ancestor with a background colour (the page ground).
          let ground = 'none';
          for (let e = el; e; e = e.parentElement) {
            const bg = getComputedStyle(e).backgroundColor;
            if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') { ground = bg; break; }
          }
          // Opacity multiplies down the tree: any partial opacity on the text or its ancestors shows here.
          let opacity = 1;
          for (let e = el; e; e = e.parentElement) opacity *= Number(getComputedStyle(e).opacity);
          return { name, color: getComputedStyle(el).color, background: ground, opacity };
        });
        return { step, active: caption.classList.contains('is-active'), dimmed: caption.classList.contains('is-dim'), hiddenByAncestor, textVisible, texts };
      })`);
      assert.equal(
        steps
          .filter((step) => step.active)
          .map((step) => step.step)
          .join(","),
        "3",
        `${scenario.label}: only step 3 is active`,
      );
      for (const step of steps) {
        assert.equal(
          step.hiddenByAncestor,
          false,
          `${scenario.label}: step ${step.step} is not hidden or removed from the accessibility tree`,
        );
        assert.equal(
          step.textVisible,
          true,
          `${scenario.label}: step ${step.step} text is visible`,
        );
        if (!step.active)
          assert.equal(
            step.dimmed,
            true,
            `${scenario.label}: step ${step.step} is marked as inactive`,
          );
        for (const text of step.texts) {
          const label = `${scenario.label}: step ${step.step} ${text.name}`;
          assert.equal(text.opacity, 1, `${label} has no opacity below 1`);
          // Contrast is measured against the computed background the text sits on (the section canvas), not the token.
          const background = opaqueRgbToHex(text.background);
          const colour = opaqueRgbToHex(text.color);
          assert.ok(
            contrastRatio(colour, background) >= 4.5,
            `${label} is ${contrastRatio(colour, background).toFixed(2)}:1 on ${background}, need 4.5:1`,
          );
          if (step.active && (text.name === "heading" || text.name === "body"))
            assert.equal(colour, ink, `${label} is full ink when active`);
          if (!step.active && text.name !== "eyebrow")
            assert.equal(
              colour,
              muted,
              `${label} uses the inactive colour (ink-muted)`,
            );
        }
      }
      const headings = await page.tab.evaluate<string[]>(
        "[...document.querySelectorAll('.landing-caption > h3')].map((heading) => heading.textContent.trim())",
      );
      const tree = await page.tab.getAccessibilityTree();
      for (const heading of headings) {
        assert.ok(
          tree.some((node) => node.role === "heading" && node.name === heading),
          `${scenario.label}: "${heading}" is a heading in the accessibility tree`,
        );
      }
    } finally {
      await page.close();
    }
  }
});

test("Issue 09 AC4: With reduced motion, or below 64rem, every step's screen is visible and nothing animates", async () => {
  const cases = [
    { label: "reduced motion at 1280 px", width: 1280, reduced: true },
    { label: "motion allowed at 390 px", width: 390, reduced: false },
  ] as const;
  for (const scenario of cases) {
    const page = await openLanding(scenario.width, 800, scenario.reduced);
    try {
      await page.tab.navigate(`${page.base}/welcome`);
      await page.tab.evaluate(RECORD_SHOWS);
      await pause(4500);
      for (const step of [1, 2, 3, 4, 5]) {
        await page.tab.evaluate(centreCaption(step));
        await pause(400);
      }
      await pause(4800);
      const state = await page.tab.evaluate<{
        screens: number;
        pinned: number;
        dimmed: number;
        withState: number;
        leftover: number;
        running: number;
      }>(`(() => ({
        screens: [...document.querySelectorAll('.landing-beat [data-landing-screen]')].filter((el) => el.getClientRects().length > 0).length,
        pinned: document.querySelectorAll('.landing-pinned').length,
        dimmed: document.querySelectorAll('.is-dim').length,
        withState: document.querySelectorAll('.landing-beat[data-state]').length,
        leftover: document.querySelectorAll('.landing-beats .landing-pending, .landing-beats .landing-enter').length,
        running: document.getAnimations().filter((animation) => animation.playState === 'running' && animation.effect && animation.effect.target instanceof Element && animation.effect.target.closest('.landing-beats')).length,
      }))()`);
      assert.deepEqual(
        state,
        {
          screens: 5,
          pinned: 0,
          dimmed: 0,
          withState: 0,
          leftover: 0,
          running: 0,
        },
        `${scenario.label}: every step shows its own screen in its final state`,
      );
      const beatReveals = (
        await page.tab.evaluate<string[]>("window.__landingShows")
      ).filter((entry) => !entry.startsWith("hero|"));
      assert.deepEqual(
        beatReveals,
        [],
        `${scenario.label}: no beat sequence plays`,
      );
    } finally {
      await page.close();
    }
  }
});

test("Issue 09 AC5: The app bar changes from its on-photo style to solid once the hero has scrolled out of view", async () => {
  const page = await openLanding(1280, 800, false);
  try {
    await page.tab.navigate(`${page.base}/welcome`);
    await page.tab.waitForSelector(
      "header.ui-appbar.landing-appbar--on-photo",
      10_000,
    );
    assert.equal(
      await page.tab.evaluate<boolean>(APP_BAR_ON_PHOTO),
      true,
      "before scroll the bar is on the photo",
    );
    // The class appears before its 250ms background transition finishes; await the same asserted visual state.
    await page.tab.waitForFunction(
      "getComputedStyle(document.querySelector('header.ui-appbar')).backgroundColor === 'rgba(0, 0, 0, 0)'",
    );
    assert.equal(
      await page.tab.evaluate<string>(
        "getComputedStyle(document.querySelector('header.ui-appbar')).backgroundColor",
      ),
      "rgba(0, 0, 0, 0)",
      "the on-photo bar is transparent",
    );
    const top = await page.tab.evaluate<number>(HEADLINE_TOP);
    // Only the class changes, so the headline does not move when the bar changes style (no layout jump).
    const toggled = await page.tab.evaluate<number[]>(
      `(() => { const bar = document.querySelector('header.ui-appbar'); const at = () => ${HEADLINE_TOP}; bar.classList.remove('landing-appbar--on-photo'); const solid = at(); bar.classList.add('landing-appbar--on-photo'); return [solid, at()]; })()`,
    );
    assert.deepEqual(
      toggled,
      [top, top],
      "the headline does not move when the bar toggles",
    );
    await page.tab.evaluate(
      "document.activeElement && document.activeElement.blur()",
    );
    await page.tab.pressKey("Tab");
    await page.tab.pressKey("Tab");
    assert.equal(
      await page.tab.evaluate<boolean>(
        "document.activeElement.classList.contains('ui-appbar__brand')",
      ),
      true,
      "keyboard focus reaches the brand link",
    );
    const focusOnPhoto = await page.tab.evaluate<{
      style: string;
      width: number;
    }>(FOCUS_OUTLINE);
    assert.ok(
      focusOnPhoto.style !== "none" && focusOnPhoto.width > 0,
      "the focus ring is visible on the photo",
    );
    await page.tab.evaluate(
      "document.querySelector('#how').scrollIntoView({ block: 'start' })",
    );
    await page.tab.waitForFunction(`!${APP_BAR_ON_PHOTO}`, 10_000);
    // The background fades over 250 ms (no-preference only): read it once the fade has finished.
    await pause(400);
    const solid = await page.tab.evaluate<{
      position: string;
      top: number;
      background: string;
      focus: { style: string; width: number };
    }>(`(() => ({
      position: getComputedStyle(document.querySelector('header.ui-appbar')).position,
      top: document.querySelector('header.ui-appbar').getBoundingClientRect().top,
      background: getComputedStyle(document.querySelector('header.ui-appbar')).backgroundColor,
      focus: ${FOCUS_OUTLINE},
    }))()`);
    assert.equal(solid.position, "sticky", "the bar stays at the top");
    assert.equal(
      solid.top,
      0,
      "the solid bar is pinned to the top of the viewport",
    );
    assert.notEqual(
      solid.background,
      "rgba(0, 0, 0, 0)",
      "the solid bar has its ground colour",
    );
    assert.ok(
      solid.focus.style !== "none" && solid.focus.width > 0,
      "the focus ring is still visible on the solid bar",
    );
    assert.equal(
      await page.tab.evaluate<number>(HEADLINE_TOP),
      top,
      "the headline has not moved",
    );
  } finally {
    await page.close();
  }
});

test("Issue 09 AC5: The app bar changes from its on-photo style to solid once the hero has scrolled out of view, with no transition under reduced motion", async () => {
  const page = await openLanding(1280, 800, true);
  try {
    await page.tab.navigate(`${page.base}/welcome`);
    await page.tab.waitForSelector(
      "header.ui-appbar.landing-appbar--on-photo",
      10_000,
    );
    // The foundations' reduced-motion reset sets every transition to 0.00001 ms, so "no transition" means under 1 ms.
    const duration = async (): Promise<number> =>
      parseFloat(
        await page.tab.evaluate<string>(
          "getComputedStyle(document.querySelector('header.ui-appbar')).transitionDuration",
        ),
      );
    assert.ok((await duration()) < 0.001, "no transition on the bar");
    await page.tab.evaluate(
      "document.querySelector('#how').scrollIntoView({ block: 'start' })",
    );
    await page.tab.waitForFunction(`!${APP_BAR_ON_PHOTO}`, 10_000);
    assert.ok(
      (await duration()) < 0.001,
      "still no transition after the toggle",
    );
  } finally {
    await page.close();
  }
});

// Issue 04 (light/dark switch and typography scale) in real Chromium. Computed sizes are measured at 320, 390, 640 (1280
// at 200% zoom) and 1280 CSS px. Dark and light come from the shortlet_theme cookie.
const THEME_COOKIE_DARK = { cookie: "shortlet_theme=dark" };
const THEME_COOKIE_LIGHT = { cookie: "shortlet_theme=light" };

const SIZE_PROBE = `(() => {
  const size = (sel) => {
    const el = document.querySelector(sel);
    return el ? parseFloat(getComputedStyle(el).fontSize) : null;
  };
  return {
    h1: size('.landing-hero h1'),
    h2: size('#how-h'),
    h3: size('.landing-caption > h3'),
    lede: size('.landing-lede'),
    caption: size('.landing-caption__body'),
    eyebrow: size('.landing-hero .ui-eyebrow'),
    pain: size('.landing-pain'),
    faqQuestion: size('.landing-faq__item > summary'),
    faqAnswer: size('.landing-faq__item > p'),
    bubble: size('.landing-phone .landing-bot'),
    bubbleMe: size('.landing-phone .landing-me'),
    chip: size('.landing-chip'),
    rail: size('.landing-phone .ui-rail > li'),
  };
})()`;

interface SizeProbe {
  readonly h1: number;
  readonly h2: number;
  readonly h3: number;
  readonly lede: number;
  readonly caption: number;
  readonly eyebrow: number;
  readonly pain: number;
  readonly faqQuestion: number;
  readonly faqAnswer: number;
  readonly bubble: number;
  readonly bubbleMe: number;
  readonly chip: number;
  readonly rail: number;
}

/** Sets the CSS viewport (1280 at 200% zoom is 640 CSS px) and waits for the page to lay out. */
async function sizeAt(page: LandingPage, width: number): Promise<SizeProbe> {
  await page.tab.setCssViewport(width, 800);
  await page.tab.evaluate(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  );
  return page.tab.evaluate<SizeProbe>(SIZE_PROBE);
}

test("Issue 04 AC1: The landing page offers a Light and Dark choice that is saved and applied before the page paints", async () => {
  // The saved choice is in the first HTML the browser receives, so the page paints in that theme with no script.
  const page = await openLanding(390, 800, true, THEME_COOKIE_DARK);
  try {
    // Re-apply the saved-theme cookie header right before navigating, so the first request carries it.
    await page.tab.setExtraHeaders(THEME_COOKIE_DARK);
    await page.tab.navigate(`${page.base}/welcome`);
    await page.tab.waitForSelector("form.landing-theme", 10_000);
    const state = await page.tab.evaluate<{
      theme: string | undefined;
      pressed: string[];
    }>(`({
      theme: document.documentElement.dataset.theme,
      pressed: [...document.querySelectorAll('form.landing-theme button')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.value),
    })`);
    assert.deepEqual(state, { theme: "dark", pressed: ["dark"] });
    const bg = await page.tab.evaluate<string>(
      "getComputedStyle(document.body).backgroundColor",
    );
    assert.notEqual(
      bg,
      "rgba(0, 0, 0, 0)",
      "the body has the token background in dark",
    );
  } finally {
    await page.close();
  }
});

test("Issue 04 AC2: An invalid theme value is rejected with 400 and leaves the saved theme unchanged", async () => {
  const page = await openLanding(390, 800, true, THEME_COOKIE_LIGHT);
  try {
    await page.tab.navigate(`${page.base}/welcome`);
    await page.tab.waitForSelector("form.landing-theme", 10_000);
    // A forged form value that the page script never sends still gets a 400 from the server. The Set-Cookie header is
    // asserted over HTTP (test/landing-page.test.ts, Issue 04 AC2); a browser does not expose it to script.
    const forged = await page.tab.evaluate<number>(
      `fetch('/welcome/theme', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'theme=neon' }).then((r) => r.status)`,
    );
    assert.equal(forged, 400);
    assert.equal(
      await page.tab.evaluate<string>("document.documentElement.dataset.theme"),
      "light",
      "the page keeps the saved theme",
    );
  } finally {
    await page.close();
  }
});

test("Issue 04 AC3: Without JavaScript the theme choice still works through the form", async () => {
  // With scripts off the page is the server HTML: the form posts to /welcome/theme, and the saved choice is pressed.
  // The POST and redirect round trip is asserted over HTTP in test/landing-page.test.ts (Issue 04 AC3).
  const page = await openLanding(390, 800, true, THEME_COOKIE_DARK);
  try {
    await page.tab.setJavaScriptEnabled(false);
    await page.tab.setExtraHeaders(THEME_COOKIE_DARK);
    await page.tab.navigate(`${page.base}/welcome`);
    const html = await page.tab.getContent();
    assert.match(
      html,
      /<form class="ui-segmented landing-theme" method="post" action="\/welcome\/theme"/,
    );
    assert.match(
      html,
      /<button class="landing-theme__option" type="submit" name="theme" value="dark" aria-label="Switch to dark theme" aria-pressed="true">/,
    );
    assert.match(html, /<html lang="en-NG" data-theme="dark">/);
  } finally {
    await page.close();
  }
});

test("Issue 04 AC4: With JavaScript the theme changes immediately without reloading the page", async () => {
  const page = await openLanding(390, 800, true);
  try {
    await page.tab.navigate(`${page.base}/welcome`);
    await page.tab.waitForSelector("form.landing-theme", 10_000);
    // Record the save request the script makes, without changing what it does.
    await page.tab.evaluate(
      "window.__sameDocument = 'yes'; window.__saves = []; const nativeFetch = window.fetch.bind(window); window.fetch = (input, init) => { window.__saves.push(String(input)); return nativeFetch(input, init); };",
    );
    await page.tab.evaluate(
      "document.querySelector('form.landing-theme button[value=\"dark\"]').click()",
    );
    // Read straight after the click: the change is immediate, not after a reload.
    const immediate = await page.tab.evaluate<{
      theme: string;
      pressed: string;
      marker: string | undefined;
      path: string;
    }>(`({
      theme: document.documentElement.dataset.theme,
      pressed: document.querySelector('form.landing-theme button[value="dark"]').getAttribute('aria-pressed'),
      marker: window.__sameDocument,
      path: location.pathname,
    })`);
    assert.deepEqual(immediate, {
      theme: "dark",
      pressed: "true",
      marker: "yes",
      path: "/welcome",
    });
    await page.tab.waitForFunction("window.__saves.length === 1", 5_000);
    assert.deepEqual(
      await page.tab.evaluate<string[]>("window.__saves"),
      ["/welcome/theme"],
      "the choice is saved with one POST to /welcome/theme",
    );
    await page.tab.waitForFunction(
      "document.cookie.includes('shortlet_theme=dark')",
      5_000,
    );
    const cookie = (await page.tab.getCookies()).find(
      (c) => c.name === "shortlet_theme",
    );
    assert.equal(
      cookie?.value,
      "dark",
      "the saved choice is the cookie the browser holds",
    );
  } finally {
    await page.close();
  }
});

test("Issue 04 AC4b: If the save fails the visual theme change stays", async () => {
  const page = await openLanding(390, 800, true);
  try {
    await page.tab.navigate(`${page.base}/welcome`);
    await page.tab.waitForSelector("form.landing-theme", 10_000);
    await page.tab.setOffline(true);
    await page.tab.evaluate(
      "document.querySelector('form.landing-theme button[value=\"light\"]').click()",
    );
    const theme = await page.tab.evaluate<string>(
      "document.documentElement.dataset.theme",
    );
    await page.tab.setOffline(false);
    assert.equal(
      theme,
      "light",
      "the visual change is kept when the save fails",
    );
  } finally {
    await page.close();
  }
});

test("Issue 04 AC5: Headings step down in size from the hero to section to beat headings at both phone and desktop widths", async () => {
  const page = await openLanding(390, 800, true, THEME_COOKIE_LIGHT);
  try {
    await page.tab.navigate(`${page.base}/welcome`);
    await page.tab.waitForSelector(".landing-hero h1", 10_000);
    for (const width of [320, 390, 1280]) {
      const sizes = await sizeAt(page, width);
      assert.ok(
        sizes.h1 > sizes.h2,
        `hero H1 (${sizes.h1}px) is larger than section H2 (${sizes.h2}px) at ${width}`,
      );
      assert.ok(
        sizes.h2 > sizes.h3,
        `section H2 (${sizes.h2}px) is larger than beat H3 (${sizes.h3}px) at ${width}`,
      );
      assert.ok(
        sizes.h3 > sizes.caption,
        `beat H3 (${sizes.h3}px) is larger than the caption body (${sizes.caption}px) at ${width}`,
      );
    }
  } finally {
    await page.close();
  }
});

/** Issue 05: one width per fresh page. A vw-based size read right after a viewport change in the same tab can still show the
 *  previous layout (innerWidth is already the new width), so each measurement loads its own page at its own width. */
async function freshSizeAt(width: number): Promise<SizeProbe> {
  const page = await openLanding(width, 800, true, THEME_COOKIE_LIGHT);
  try {
    await page.tab.setExtraHeaders(THEME_COOKIE_LIGHT);
    await page.tab.navigate(`${page.base}/welcome`);
    await page.tab.waitForSelector(".landing-hero h1", 10_000);
    return await page.tab.evaluate<SizeProbe>(SIZE_PROBE);
  } finally {
    await page.close();
  }
}

test("Issue 04 AC6: Heading and body sizes grow between phone and desktop widths and keep growing at 200% zoom", async () => {
  const phone = await freshSizeAt(320);
  const mid = await freshSizeAt(390);
  const zoomed = await freshSizeAt(640);
  const desktop = await freshSizeAt(1280);
  for (const key of ["h1", "h2", "h3", "lede", "caption"] as const) {
    assert.ok(
      phone[key] < mid[key] && mid[key] < desktop[key],
      `${key} grows from 320 (${phone[key]}) to 390 (${mid[key]}) to 1280 (${desktop[key]})`,
    );
    assert.ok(
      zoomed[key] > phone[key] && zoomed[key] < desktop[key],
      `${key} keeps growing at 200% zoom (640 CSS px is ${zoomed[key]})`,
    );
  }
});

/** Longest rendered line of each element, in characters (every character on one line, spaces included). */
const LONGEST_LINE = `(() => {
  const selectors = ['.landing-lede', '.landing-caption__body', '.landing-faq__item > p'];
  const lines = [];
  for (const selector of selectors) {
    for (const el of document.querySelectorAll(selector)) {
      const perLine = new Map();
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        for (let i = 0; i < node.data.length; i++) {
          const range = document.createRange();
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          const rect = range.getClientRects()[0];
          if (!rect || rect.width === 0) continue;
          const key = Math.round(rect.top);
          perLine.set(key, (perLine.get(key) ?? 0) + 1);
        }
      }
      lines.push({ selector, longest: Math.max(0, ...perLine.values()) });
    }
  }
  return lines;
})()`;

test("Issue 04 AC7: Prose lines stay at or under 75 characters and headings use the display face", async () => {
  const page = await openLanding(390, 800, true, THEME_COOKIE_LIGHT);
  try {
    await page.tab.navigate(`${page.base}/welcome`);
    await page.tab.waitForSelector(".landing-hero h1", 10_000);
    for (const width of [320, 390, 1280]) {
      await page.tab.setCssViewport(width, 800);
      await page.tab.evaluate(
        "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
      );
      const lines =
        await page.tab.evaluate<{ selector: string; longest: number }[]>(
          LONGEST_LINE,
        );
      assert.ok(lines.length > 0, "prose found");
      for (const line of lines) {
        assert.ok(
          line.longest <= 75,
          `${line.selector} at ${width}: ${line.longest} characters on its longest line`,
        );
      }
      const faces = await page.tab.evaluate<{
        display: string;
        h1: string;
        h2: string;
        h3: string;
      }>(`(() => {
        const probe = document.createElement('span');
        probe.style.fontFamily = 'var(--font-display)';
        document.body.append(probe);
        const display = getComputedStyle(probe).fontFamily;
        probe.remove();
        return {
          display,
          h1: getComputedStyle(document.querySelector('.landing-hero h1')).fontFamily,
          h2: getComputedStyle(document.querySelector('#how-h')).fontFamily,
          h3: getComputedStyle(document.querySelector('.landing-caption > h3')).fontFamily,
        };
      })()`);
      // Issue 07 replaces the display face for brand-layer headings.
      // The brand display face is Newsreader with the old display stack as its fallback.
      const brandDisplay = `Newsreader, ${faces.display}`;
      assert.equal(
        faces.h1,
        brandDisplay,
        "the hero H1 uses the brand display face",
      );
      assert.equal(
        faces.h2,
        brandDisplay,
        "section H2 uses the brand display face",
      );
      assert.equal(
        faces.h3,
        brandDisplay,
        "beat H3 uses the brand display face",
      );
    }
  } finally {
    await page.close();
  }
});

const RAIL_BREAKS = `(() => {
  const breaks = [];
  for (const li of document.querySelectorAll('.landing-phone .ui-rail > li, .landing-chat .ui-rail > li')) {
    if (li.getClientRects().length === 0) continue;
    // A step whose label is not shown (transparent, narrow frames only) has no visible text to break or overflow.
    if (getComputedStyle(li).color === 'rgba(0, 0, 0, 0)') continue;
    const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
    let node;
    let previousTop = null;
    let previousWasLetter = false;
    while ((node = walker.nextNode())) {
      for (let i = 0; i < node.data.length; i++) {
        const ch = node.data[i];
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const rect = range.getClientRects()[0];
        if (!rect) continue;
        const isLetter = !/\\s/.test(ch);
        if (isLetter && previousWasLetter && previousTop !== null && Math.abs(rect.top - previousTop) > 1) {
          breaks.push(li.textContent.trim());
          break;
        }
        previousTop = rect.top;
        previousWasLetter = isLetter;
      }
    }
    if (li.scrollWidth > li.clientWidth + 0.5) breaks.push('overflow: ' + li.textContent.trim());
  }
  return breaks;
})()`;

test("Issue 04 AC8: Text inside the phone screens matches the app sizes and the rail labels never break mid-word", async () => {
  const page = await openLanding(390, 800, true, THEME_COOKIE_LIGHT);
  try {
    await page.tab.navigate(`${page.base}/welcome`);
    await page.tab.waitForSelector(
      ".landing-phone .ui-rail, .landing-chat .ui-rail",
      10_000,
    );
    for (const width of [320, 390, 1280]) {
      const sizes = await sizeAt(page, width);
      assert.equal(sizes.bubble, 15, `bubble at ${width}`);
      assert.equal(sizes.bubbleMe, 15, `guest bubble at ${width}`);
      assert.equal(sizes.chip, 14, `chip at ${width}`);
      assert.ok(sizes.rail >= 12, `rail label at ${width} is ${sizes.rail}px`);
      const breaks = await page.tab.evaluate<string[]>(RAIL_BREAKS);
      assert.deepEqual(
        breaks,
        [],
        `rail labels at ${width} break mid-word or overflow`,
      );
    }
  } finally {
    await page.close();
  }
});

const TEXT_SIZES = `(() => {
  const small = [];
  let checked = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (!node.data.trim()) continue;
    const el = node.parentElement;
    if (!el || el.closest('script, style, [hidden]')) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || el.getClientRects().length === 0) continue;
    checked++;
    const px = parseFloat(cs.fontSize);
    if (px < 12) small.push(px + 'px ' + node.data.trim().slice(0, 40));
  }
  return { checked, small };
})()`;

test("Issue 04 AC9: No text on the landing page is smaller than 12 pixels in either theme", async () => {
  for (const theme of [THEME_COOKIE_LIGHT, THEME_COOKIE_DARK]) {
    for (const width of [320, 390, 1280]) {
      const page = await openLanding(width, 800, true, theme);
      try {
        // The theme cookie is set by the page itself (it is not HttpOnly), then the page is loaded again with it.
        await page.tab.navigate(`${page.base}/welcome`);
        await page.tab.waitForSelector(".landing-phone", 10_000);
        await page.tab.evaluate(
          `document.cookie = ${JSON.stringify(`${theme.cookie}; path=/`)}`,
        );
        await page.tab.navigate(`${page.base}/welcome`);
        await page.tab.waitForSelector(".landing-phone", 10_000);
        await page.tab.setCssViewport(width, 800);
        const applied = await page.tab.evaluate<string>(
          "document.documentElement.dataset.theme",
        );
        assert.equal(
          applied,
          theme.cookie.endsWith("dark") ? "dark" : "light",
          `${theme.cookie} is applied at ${width}`,
        );
        const result = await page.tab.evaluate<{
          checked: number;
          small: string[];
        }>(TEXT_SIZES);
        assert.ok(
          result.checked > 50,
          `text nodes checked at ${width} (${result.checked})`,
        );
        assert.deepEqual(
          result.small,
          [],
          `${theme.cookie} at ${width}: text under 12px`,
        );
      } finally {
        await page.close();
      }
    }
  }
});

// Issue 04 review corrections: kit sizes inside the phones, the hero's first viewport on phones, and the one-row header.
const PHONE_KIT_TITLES = `(() => {
  const size = (sel) => {
    const el = document.querySelector(sel);
    return el ? { px: parseFloat(getComputedStyle(el).fontSize), tag: el.tagName.toLowerCase() } : null;
  };
  return { ticket: size('[data-landing-screen="3"] .ui-ticket__name'), result: size('[data-landing-screen="2"] .ui-result-row__title'), heroResult: size('.landing-chat .ui-result-row__title') };
})()`;

test("Issue 04 review 1: Ticket and result titles inside the phones keep the kit sizes (ticket 19px, result 16px) at 390 and 1280", async () => {
  // The kit's ticket title is an h2 with its own size (--font-size-h3, 1.1875rem); a result title is 1rem. The landing's
  // section headings must not reach them.
  const page = await openLanding(390, 800, true, THEME_COOKIE_LIGHT);
  try {
    await page.tab.navigate(`${page.base}/welcome`);
    await page.tab.waitForSelector(
      '[data-landing-screen="3"] .ui-ticket__name',
      10_000,
    );
    for (const width of [390, 1280]) {
      await page.tab.setCssViewport(width, 800);
      await page.tab.evaluate(
        "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
      );
      const titles = await page.tab.evaluate<{
        ticket: { px: number; tag: string };
        result: { px: number };
        heroResult: { px: number };
      }>(PHONE_KIT_TITLES);
      assert.deepEqual(
        titles.ticket,
        { px: 19, tag: "h2" },
        `ticket title at ${width}`,
      );
      assert.equal(titles.result.px, 16, `beat 2 result title at ${width}`);
      assert.equal(titles.heroResult.px, 16, `hero result title at ${width}`);
    }
  } finally {
    await page.close();
  }
});

test("Issue 04 review 2 (Issue 08 AC2/AC3): At 390 x 800 the hero composer and reassurance are inside the first viewport, the chat window peeks in, and the hero plays on load without scrolling", async () => {
  const page = await openLanding(390, 800, false, THEME_COOKIE_LIGHT);
  try {
    await page.tab.navigate(`${page.base}/welcome`);
    await page.tab.waitForSelector("form.landing-composer", 10_000);
    const box = await page.tab.evaluate<{
      top: number;
      bottom: number;
      viewport: number;
      scrollY: number;
      reassurance: number;
      chatTop: number;
    }>(`(() => {
      const r = document.querySelector('form.landing-composer').getBoundingClientRect();
      return {
        top: r.top, bottom: r.bottom, viewport: window.innerHeight, scrollY: window.scrollY,
        reassurance: document.querySelector('.landing-hero .ui-field__hint').getBoundingClientRect().bottom,
        chatTop: document.querySelector('.landing-chat').getBoundingClientRect().top,
      };
    })()`);
    assert.ok(
      box.top >= 0 && box.bottom <= 800,
      `composer ${Math.round(box.top)}..${Math.round(box.bottom)} inside 800`,
    );
    assert.ok(
      box.reassurance <= 800,
      `the reassurance line ends inside 800 (bottom ${Math.round(box.reassurance)})`,
    );
    assert.ok(
      box.chatTop < 800,
      `the chat window's top edge is in the first viewport (top ${Math.round(box.chatTop)})`,
    );
    assert.equal(box.scrollY, 0, "no scroll was needed");
    // The hero plays on load: the guest message appears without any scrolling.
    await page.tab.waitForFunction(shownExpr("[data-landing-message]"), 10_000);
    assert.equal(
      await page.tab.evaluate<number>("window.scrollY"),
      0,
      "still at the top after the sequence started",
    );
  } finally {
    await page.close();
  }
});

test("Issue 04 review 3 (Issue 08 AC4 app bar): The header is one row at 320 and 390, and at every width one theme button is shown: the one that switches to the other theme", async () => {
  const check = `(() => {
    // The empty flex spacer (.ui-appbar__grow) is centred on the row's axis; it is not content, so it is left out.
    const visible = [...document.querySelector('.landing-appbar__row').children].filter((el) => el.getClientRects().length > 0 && !el.classList.contains('ui-appbar__grow'));
    const tops = visible.map((el) => el.getBoundingClientRect().top);
    const buttons = [...document.querySelectorAll('form.landing-theme button')].filter((b) => b.getClientRects().length > 0);
    return { tops, spread: Math.max(...tops) - Math.min(...tops), buttons: buttons.map((b) => ({ name: b.getAttribute('aria-label'), w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height) })) };
  })()`;
  for (const [width, cookie, expected] of [
    [320, THEME_COOKIE_LIGHT, "Switch to dark theme"],
    [390, THEME_COOKIE_DARK, "Switch to light theme"],
  ] as const) {
    const page = await openLanding(width, 800, true, cookie);
    try {
      await page.tab.navigate(`${page.base}/welcome`);
      await page.tab.waitForSelector("form.landing-theme", 10_000);
      const header = await page.tab.evaluate<{
        spread: number;
        buttons: { name: string; w: number; h: number }[];
      }>(check);
      assert.ok(
        header.spread <= 4,
        `header children share one row at ${width} (spread ${header.spread}px)`,
      );
      assert.deepEqual(
        header.buttons.map((b) => b.name),
        [expected],
        `one theme button at ${width}`,
      );
      assert.deepEqual(
        [header.buttons[0]!.w, header.buttons[0]!.h],
        [44, 44],
        `icon button is 44 x 44 at ${width}`,
      );
    } finally {
      await page.close();
    }
  }
  const wide = await openLanding(1280, 800, true, THEME_COOKIE_LIGHT);
  try {
    await wide.tab.navigate(`${wide.base}/welcome`);
    await wide.tab.waitForSelector("form.landing-theme", 10_000);
    const header = await wide.tab.evaluate<{ buttons: { name: string }[] }>(
      check,
    );
    // Issue 08: the switch is one 44px round icon at every width, the one that is not in effect (light is saved here).
    assert.deepEqual(
      header.buttons.map((b) => b.name),
      ["Switch to dark theme"],
      "one icon button at 1280 (Issue 08 app bar)",
    );
  } finally {
    await wide.close();
  }
});

// Issue 04 review 2 (coordinator): one-row rails and the first screen on short phones.
const RAIL_ROWS = `(() => [...document.querySelectorAll('.landing-phone .ui-rail, .landing-chat .ui-rail')].map((rail) => {
  const tops = [...rail.querySelectorAll(':scope > li')].map((li) => li.getBoundingClientRect().top);
  return { items: tops.length, spread: Math.round((Math.max(...tops) - Math.min(...tops)) * 10) / 10 };
}))()`;

test("Issue 04 review 4: Each phone rail (hero and five beats) is one row, with no visible label broken or overflowing, at 320, 360 and 390", async () => {
  const page = await openLanding(390, 800, true, THEME_COOKIE_LIGHT);
  try {
    await page.tab.navigate(`${page.base}/welcome`);
    await page.tab.waitForSelector(
      ".landing-phone .ui-rail, .landing-chat .ui-rail",
      10_000,
    );
    for (const width of [320, 360, 390]) {
      await page.tab.setCssViewport(width, 800);
      await page.tab.evaluate(
        "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
      );
      const rows =
        await page.tab.evaluate<{ items: number; spread: number }[]>(RAIL_ROWS);
      assert.equal(rows.length, 6, `six phone rails at ${width}`);
      for (const row of rows) {
        assert.equal(row.items, 6, `six steps at ${width}`);
        assert.ok(
          row.spread <= 1,
          `one row at ${width} (tops differ by ${row.spread}px)`,
        );
      }
      const breaks = await page.tab.evaluate<string[]>(RAIL_BREAKS);
      assert.deepEqual(
        breaks,
        [],
        `visible rail labels at ${width} break mid-word or overflow`,
      );
    }
  } finally {
    await page.close();
  }
});

test("Issue 04 review 5: At 360 x 640 and 390 x 800 the hero message box is inside the first viewport on load, and the guest message shows without scrolling", async () => {
  for (const [width, height] of [
    [360, 640],
    [390, 800],
  ] as const) {
    const page = await openLanding(width, height, false, THEME_COOKIE_LIGHT);
    try {
      await page.tab.navigate(`${page.base}/welcome`);
      await page.tab.waitForSelector("form.landing-composer", 10_000);
      const box = await page.tab.evaluate<{
        top: number;
        bottom: number;
        scrollY: number;
        reassurance: number;
      }>(`(() => {
        const r = document.querySelector('form.landing-composer').getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, scrollY: window.scrollY, reassurance: document.querySelector('.landing-hero .ui-field__hint').getBoundingClientRect().bottom };
      })()`);
      assert.ok(
        box.top >= 0 && box.bottom <= height,
        `composer ${Math.round(box.top)}..${Math.round(box.bottom)} inside ${height} at ${width}`,
      );
      assert.ok(
        box.reassurance <= height,
        `reassurance ends at ${Math.round(box.reassurance)} inside ${height} at ${width}`,
      );
      assert.equal(box.scrollY, 0, `no scroll at ${width}x${height}`);
      await page.tab.waitForFunction(
        shownExpr("[data-landing-message]"),
        10_000,
      );
    } finally {
      await page.close();
    }
  }
});

// Issue 04 review 6 (coordinator): the hero transcript stays anchored to its newest revealed item on phones.
const TRANSCRIPT_BOX = `(() => {
  const t = document.querySelector('.landing-chat').getBoundingClientRect();
  const inside = (el) => {
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), fits: r.top >= t.top - 0.5 && r.bottom <= t.bottom + 0.5 };
  };
  const rows = [...document.querySelectorAll('.landing-chat .ui-result-row')];
  return {
    transcript: { top: Math.round(t.top), bottom: Math.round(t.bottom) },
    message: document.querySelector('[data-landing-message]') ? inside(document.querySelector('[data-landing-message]')) : null,
    lastRow: rows.length ? inside(rows[rows.length - 1]) : null,
    rows: rows.length,
  };
})()`;

test("Issue 04 review 6: On phones the example chat window keeps its newest revealed item fully inside it, after the bubble is posted and at the results, at 360 x 640 and 390 x 800", async () => {
  for (const [width, height] of [
    [360, 640],
    [390, 800],
  ] as const) {
    const page = await openLanding(width, height, false, THEME_COOKIE_LIGHT);
    try {
      await page.tab.navigate(`${page.base}/welcome`);
      await page.tab.waitForSelector(".landing-chat", 10_000);
      // Measure in the window where the bubble is the newest revealed item: shown, and the next stage (chips) still pending.
      await page.tab.waitForFunction(
        `(() => { const m = document.querySelector('[data-landing-message]'); const c = document.querySelector('[data-landing-play="hero"] [data-landing-stage="2"]'); return !!m && !m.classList.contains('landing-pending') && !!c && c.classList.contains('landing-pending'); })()`,
        10_000,
      );
      const bubble = await page.tab.evaluate<{
        transcript: { top: number; bottom: number };
        message: { top: number; bottom: number; fits: boolean };
      }>(TRANSCRIPT_BOX);
      assert.ok(
        bubble.message?.fits,
        `bubble ${bubble.message?.top}..${bubble.message?.bottom} inside transcript ${bubble.transcript.top}..${bubble.transcript.bottom} at ${width}x${height}`,
      );
      await page.tab.waitForFunction(
        shownExpr('[data-landing-play="hero"] [data-landing-stage="4"]'),
        15_000,
      );
      await page.tab.waitForFunction(
        "document.querySelectorAll('.landing-chat .ui-result-row').length === 2",
        5_000,
      );
      await new Promise((resolve) => setTimeout(resolve, 900));
      const results = await page.tab.evaluate<{
        transcript: { top: number; bottom: number };
        lastRow: { top: number; bottom: number; fits: boolean };
      }>(TRANSCRIPT_BOX);
      assert.ok(
        results.lastRow?.fits,
        `last result row ${results.lastRow?.top}..${results.lastRow?.bottom} inside transcript ${results.transcript.top}..${results.transcript.bottom} at ${width}x${height}`,
      );
    } finally {
      await page.close();
    }
  }
});

test("Issue 07 AC2: Headings use the self-hosted display face and body text the self-hosted body face, with no request to another host", async () => {
  const page = await openLanding(1280, 800, true, THEME_COOKIE_LIGHT);
  try {
    await page.tab.navigate(`${page.base}/welcome`);
    await page.tab.waitForSelector(".landing-hero h1", 10_000);
    await page.tab.evaluate("document.fonts.ready.then(() => true)");
    const faces = await page.tab.evaluate<{
      h1: string;
      heading: string;
      body: string;
      loaded: string[];
      origins: string[];
      resources: string[];
      phone: string;
    }>(`(() => ({
      h1: getComputedStyle(document.querySelector('.landing-hero h1')).fontFamily,
      heading: getComputedStyle(document.querySelector('.landing-caption > h3')).fontFamily,
      body: getComputedStyle(document.querySelector('.landing-lede')).fontFamily,
      loaded: [...document.fonts].filter((face) => face.status === 'loaded').map((face) => face.family.replace(/"/g, '')),
      origins: [...new Set(performance.getEntriesByType('resource').map((entry) => new URL(entry.name).origin))],
      resources: performance.getEntriesByType('resource').map((entry) => new URL(entry.name).pathname),
      phone: getComputedStyle(document.querySelector('.landing-phone .landing-bot')).fontFamily,
    }))()`);
    assert.match(faces.h1, /^"?Newsreader"?/, `hero H1 family ${faces.h1}`);
    assert.match(
      faces.heading,
      /^"?Newsreader"?/,
      `beat heading family ${faces.heading}`,
    );
    assert.match(faces.body, /"?Hanken Grotesk"?/, `body family ${faces.body}`);
    assert.ok(
      faces.loaded.includes("Newsreader"),
      `Newsreader FontFace loaded: ${faces.loaded.join(", ")}`,
    );
    assert.ok(
      faces.loaded.includes("Hanken Grotesk"),
      `Hanken Grotesk FontFace loaded: ${faces.loaded.join(", ")}`,
    );
    // No request leaves the page's own origin, and both shipped files came from the local server.
    assert.deepEqual(
      faces.origins,
      [page.base],
      "every request is to the page's own origin",
    );
    assert.ok(
      faces.resources.includes("/landing/fonts/newsreader-500.woff2"),
      "the H1 weight is fetched from the local server",
    );
    assert.ok(
      faces.resources.includes("/landing/fonts/hanken-grotesk-400-700.woff2"),
      "the body face is fetched from the local server",
    );
    // Failure path: the app layer inside a phone keeps the app's own fonts, not the brand faces.
    assert.doesNotMatch(
      faces.phone,
      /Newsreader|Hanken/,
      `phone text family ${faces.phone}`,
    );
  } finally {
    await page.close();
  }
});

test("Issue 07 AC3: Prices with ₦ render in one font from the first digit to the last", async (t) => {
  const page = await openLanding(1280, 800, true, THEME_COOKIE_LIGHT);
  try {
    await page.tab.navigate(`${page.base}/welcome`);
    await page.tab.waitForSelector("main", 10_000);
    await page.tab.evaluate("document.fonts.ready.then(() => true)");
    // A price set in the money class (the brand display face) and one set in the body face, which has no ₦ glyph.
    await page.tab.evaluate(`(() => {
      const money = document.createElement('span');
      money.className = 'landing-money landing-money-probe';
      money.textContent = '₦370,000';
      const body = document.createElement('span');
      body.className = 'landing-money-probe-body';
      body.style.fontFamily = 'var(--landing-font-body)';
      body.textContent = '₦370,000';
      document.querySelector('main').append(money, body);
      return document.fonts.load('500 16px Newsreader').then(() => document.fonts.ready).then(() => true);
    })()`);
    const money = await page.tab.getPlatformFonts(".landing-money-probe");
    const moneyNames = money.map(
      (font) =>
        `${font.familyName} (${font.postScriptName}, custom=${font.isCustomFont}, glyphs=${font.glyphCount})`,
    );
    assert.equal(
      money.length,
      1,
      `one platform font for the whole price, found: ${moneyNames.join("; ")}`,
    );
    assert.match(
      money[0]!.familyName,
      /Newsreader/,
      `the one font is Newsreader, found: ${moneyNames.join("; ")}`,
    );
    assert.equal(
      money[0]!.isCustomFont,
      true,
      `it is the self-hosted file, not a system font, found: ${moneyNames.join("; ")}`,
    );
    // Failure path: the body face has no ₦ glyph, so the price spans more than one font and this check would fail.
    const body = await page.tab.getPlatformFonts(".landing-money-probe-body");
    const bodyNames = body.map(
      (font) =>
        `${font.familyName} (${font.postScriptName}, custom=${font.isCustomFont}, glyphs=${font.glyphCount})`,
    );
    t.diagnostic(`money span platform fonts: ${moneyNames.join("; ")}`);
    t.diagnostic(`body-face span platform fonts: ${bodyNames.join("; ")}`);
    assert.ok(
      body.length > 1,
      `the body face alone splits the price across ${body.length} fonts: ${bodyNames.join("; ")}`,
    );
  } finally {
    await page.close();
  }
});

// Issue 08 (sub-task A): the hero composer is a real form, and submitting it never puts the typed text in the URL.
test("Issue 08 AC2: The hero composer is a labelled text field with a submit button, and submitting it never places the typed text in the URL", async () => {
  const page = await openLanding(390, 800, true, THEME_COOKIE_LIGHT);
  try {
    await page.tab.navigate(`${page.base}/welcome`);
    await page.tab.waitForSelector("#describe-stay", 10_000);
    const label = await page.tab.evaluate<string>(
      "document.querySelector('label[for=\"describe-stay\"]')?.textContent ?? ''",
    );
    assert.equal(label, "Describe your stay", "the field has a visible label");
    await page.tab.focus("#describe-stay");
    const typed = "Ikoyi 2 weeks for Ada Lovelace 08031234567";
    await page.tab.insertText(typed);
    assert.equal(
      await page.tab.evaluate<string>(
        "document.querySelector('#describe-stay').value",
      ),
      typed,
      "the text is in the field before submit",
    );
    await page.tab.evaluate(
      "document.querySelector('.landing-composer button[type=\"submit\"]').click()",
    );
    await page.tab.waitForFunction(
      `location.href !== ${JSON.stringify(`${page.base}/welcome`)}`,
      10_000,
    );
    const href = await page.tab.evaluate<string>("location.href");
    // Failure path: any of the typed words in the address bar fails this check.
    for (const fragment of [
      "Ikoyi",
      "Ada",
      "Lovelace",
      "08031234567",
      "weeks",
      "%20",
    ]) {
      assert.ok(
        !href.includes(fragment),
        `the URL carries no part of the typed text (${fragment}): ${href}`,
      );
    }
    // Issue 14: the composer POSTs, so the only query is the opaque thread id of the conversation it opened.
    assert.match(
      new URL(href).search,
      /^\?threadId=g-[a-f0-9-]+$/,
      `only the opaque thread id is in the URL: ${href}`,
    );
    assert.ok(
      (
        await page.tab.evaluate<string>(
          "document.querySelector('.no-js-transcript')?.textContent ?? ''",
        )
      ).includes(typed),
      "the typed text is the first Guest message in the opened conversation",
    );
  } finally {
    await page.close();
  }
});

// Issue 08 sub-task B: banner spacing and the no-JavaScript step screens.
test("Issue 08 AC7: Banner headings and their following text are separated in both the rendered text and the accessible name", async () => {
  // The two banners have no role, so their accessible name is their text content: the check reads both the rendered text
  // (innerText) and the text content, and requires a whitespace boundary between the heading and the text that follows it.
  const page = await openLanding(390, 800, true);
  try {
    await page.tab.navigate(`${page.base}/welcome`);
    await page.tab.waitForSelector(".ui-banner", 10_000);
    const banners = await page.tab.evaluate<{
      reply: { inner: string; text: string };
      confirmed: { inner: string; text: string };
    }>(`(() => {
      const find = (phrase) => [...document.querySelectorAll('.ui-banner')].find((el) => el.textContent.includes(phrase));
      const reply = find('Reply due by');
      const confirmed = find('Reservation confirmed');
      return {
        reply: { inner: reply.innerText, text: reply.textContent },
        confirmed: { inner: confirmed.innerText, text: confirmed.textContent },
      };
    })()`);
    for (const [name, pattern] of [
      ["reply banner", /3 Sept 2026\s+Your dates are held/],
      ["confirmed banner", /Reservation confirmed\s+Old Ikoyi/],
    ] as const) {
      const source =
        name === "reply banner" ? banners.reply : banners.confirmed;
      assert.match(
        source.inner,
        pattern,
        `${name}: innerText separates the heading from the text`,
      );
      assert.match(
        source.text,
        pattern,
        `${name}: text content separates the heading from the text`,
      );
    }
    // Failure path: the run-together forms are gone from both readings.
    assert.doesNotMatch(
      banners.reply.text,
      /2026Your dates/,
      "no run-together reply banner",
    );
    assert.doesNotMatch(
      banners.confirmed.text,
      /confirmedOld Ikoyi/,
      "no run-together confirmed banner",
    );
  } finally {
    await page.close();
  }
});

test("Issue 08 AC9: Without JavaScript, every step's screen is visible next to or below its step", async () => {
  for (const width of [1280, 390]) {
    const page = await openLanding(width, 800, true);
    try {
      await page.tab.setJavaScriptEnabled(false);
      await page.tab.navigate(`${page.base}/welcome`);
      await page.tab.waitForSelector('[data-landing-play="beat-5"]', 10_000);
      const steps = await page.tab.evaluate<
        {
          index: number;
          shown: boolean;
          sized: boolean;
          beside: boolean;
          below: boolean;
        }[]
      >(`[1, 2, 3, 4, 5].map((n) => {
        const caption = document.querySelector('[data-landing-caption="' + n + '"]').getBoundingClientRect();
        const screenEl = document.querySelector('[data-landing-screen="' + n + '"]');
        const box = screenEl.getBoundingClientRect();
        const style = getComputedStyle(screenEl);
        return {
          index: n,
          shown: screenEl.getClientRects().length > 0 && style.display !== 'none' && style.visibility !== 'hidden',
          sized: box.width > 0 && box.height > 0,
          beside: box.left >= caption.right - 1,
          below: box.top >= caption.bottom - 1,
        };
      })`);
      assert.equal(
        await page.tab.evaluate<number>(
          "document.querySelectorAll('.landing-pinned').length",
        ),
        0,
        `nothing is pinned without JavaScript at ${width} px`,
      );
      for (const step of steps) {
        assert.ok(
          step.shown,
          `${width} px: the screen of step ${step.index} is shown`,
        );
        assert.ok(
          step.sized,
          `${width} px: the screen of step ${step.index} has a size`,
        );
        assert.ok(
          step.beside || step.below,
          `${width} px: the screen of step ${step.index} sits to the right of or below its step`,
        );
      }
      if (width === 1280)
        assert.ok(
          steps.every((step) => step.beside),
          "at desktop width every screen sits beside its step",
        );
      else
        assert.ok(
          steps.every((step) => step.below),
          "on a phone every screen sits below its step",
        );
    } finally {
      await page.close();
    }
  }
});

// Issue 08 sub-task C: one left content edge for the app bar, every section container and the footer.
const CONTENT_EDGES = `(() => {
  const targets = {
    "app bar": ".landing-appbar__row",
    "hero": ".landing-hero__inner",
    "chat window": ".landing-chat-wrap",
    "trust strip": ".landing-trust .landing-container",
    "apartments": "#apartments",
    "how it works": "#how",
    "your money": "#money .landing-container",
    "questions": "#questions",
    "closing": ".landing-closing .landing-container",
    "footer": ".landing-footer .landing-container",
  };
  return Object.entries(targets).map(([name, selector]) => {
    const el = document.querySelector(selector);
    if (!el) return { name, left: null };
    const style = getComputedStyle(el);
    return { name, left: el.getBoundingClientRect().left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth) };
  });
})()`;

test("Issue 08 AC10: The app bar, every section container and the footer share the same left content edge at 1280 and 1440", async () => {
  const page = await openLanding(1280, 800, true);
  try {
    await page.tab.navigate(`${page.base}/welcome`);
    await page.tab.waitForSelector(".landing-footer", 10_000);
    // The public page: every section but apartments (which is omitted until a unit is approved) shares the edge.
    for (const width of [1280, 1440]) {
      await page.tab.setCssViewport(width, 800);
      await page.tab.evaluate(
        "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
      );
      const edges =
        await page.tab.evaluate<{ name: string; left: number | null }[]>(
          CONTENT_EDGES,
        );
      const present = edges.filter((edge) => edge.left !== null);
      assert.equal(
        present.length,
        edges.length - 1,
        `${width} px: every section except apartments is rendered on the public page`,
      );
      assert.equal(
        edges.find((edge) => edge.name === "apartments")?.left ?? null,
        null,
        "the public page omits apartments",
      );
      const lefts = present.map((edge) => edge.left as number);
      assert.ok(
        Math.max(...lefts) - Math.min(...lefts) <= 1,
        `${width} px public page: left edges ${JSON.stringify(present)}`,
      );
    }
    // With placeholders on (the local build), apartments joins the same edge. The page is replaced in place, same origin.
    const withPlaceholders = renderLandingHtml("system", {
      placeholders: true,
    });
    await page.tab.evaluate(
      `document.open(); document.write(${JSON.stringify(withPlaceholders)}); document.close(); true`,
    );
    await page.tab.waitForSelector("#apartments", 10_000);
    for (const width of [1280, 1440]) {
      await page.tab.setCssViewport(width, 800);
      await page.tab.evaluate(
        "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
      );
      const edges =
        await page.tab.evaluate<{ name: string; left: number | null }[]>(
          CONTENT_EDGES,
        );
      // Failure path: a section with no container (a null edge) or an edge off by more than 1 px fails.
      assert.ok(
        edges.every((edge) => edge.left !== null),
        `${width} px placeholder page: every section is rendered ${JSON.stringify(edges)}`,
      );
      const lefts = edges.map((edge) => edge.left as number);
      assert.ok(
        Math.max(...lefts) - Math.min(...lefts) <= 1,
        `${width} px placeholder page: left edges differ by more than 1 px ${JSON.stringify(edges)}`,
      );
    }
  } finally {
    await page.close();
  }
});

// Issue 10 (verification gate): hero and closing text over their photos, and the font and hero image budgets.

const PHOTO_BUDGET_FONTS_BYTES = 160 * 1024;
const PHOTO_BUDGET_HERO_1440_BYTES = 120 * 1024;
const PHOTO_BUDGET_HERO_390_BYTES = 50 * 1024;

/** Serves /welcome from the given HTML through request interception. Harness only: no public switch, no production change. */
async function serveWelcome(
  tab: RealBrowserTab,
  base: string,
  html: string,
): Promise<() => Promise<void>> {
  return tab.interceptRequests(async (url) =>
    url === `${base}/welcome`
      ? {
          status: 200,
          headers: [
            { name: "Content-Type", value: "text/html; charset=utf-8" },
            { name: "Cache-Control", value: "no-store" },
          ],
          body: new TextEncoder().encode(html),
        }
      : undefined,
  );
}

type Rgb = readonly [number, number, number];

/** The text elements the criterion names: hero text and closing text (with their accent words and the composer labels). */
const TEXT_TARGETS = `(() => {
  const targets = [
    ['hero eyebrow', '.landing-hero .ui-eyebrow'],
    ['hero H1', '.landing-hero h1'],
    ['hero H1 accent', '.landing-hero__accent'],
    ['hero lede', '.landing-hero .landing-lede'],
    ['hero composer label', '.landing-hero .landing-composer__label'],
    ['hero reassurance', '.landing-hero__cta .ui-field__hint'],
    ['closing H2', '.landing-closing h2'],
    ['closing accent', '.landing-closing__accent'],
    ['closing composer label', '.landing-closing .landing-composer__label'],
    ['closing reassurance', '.landing-closing .ui-field__hint'],
  ];
  return targets.map(([name, selector]) => {
    const el = document.querySelector(selector);
    if (!el) return { name, found: false, color: '', fontSize: 0, box: [0, 0, 0, 0] };
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { name, found: true, color: cs.color, fontSize: parseFloat(cs.fontSize), box: [r.left, r.top, r.right, r.bottom] };
  });
})()`;

interface TextTarget {
  readonly name: string;
  readonly found: boolean;
  readonly color: string;
  readonly fontSize: number;
  readonly box: readonly [number, number, number, number];
}

/**
 * The lightest colour behind each box, found from the screenshot (decoded in the page). Every distinct colour in the box is
 * returned, and the luminance comes from the shared helper in Node, so the maximum is exact.
 */
async function coloursBehind(
  tab: RealBrowserTab,
  png: Uint8Array,
  viewportWidth: number,
  boxes: readonly (readonly [number, number, number, number])[],
): Promise<number[][]> {
  // The landing page's Content-Security-Policy (img-src 'self' https:) refuses data: and blob: images, but a blob made from the
  // bytes and decoded with createImageBitmap is not an image fetch, so it is allowed. The screenshot is the viewport at device
  // scale 1, so its PNG width over the page's viewport width is the box scale.
  const base64 = Buffer.from(png).toString("base64");
  const scale = Buffer.from(png).readUInt32BE(16) / viewportWidth;
  return tab.evaluate<number[][]>(`(async () => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(base64)}), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const scale = ${scale};
    return ${JSON.stringify(boxes)}.map(([x0, y0, x1, y1]) => {
      const seen = new Set();
      const left = Math.max(0, Math.floor(x0 * scale));
      const right = Math.min(canvas.width, Math.ceil(x1 * scale));
      const top = Math.max(0, Math.floor(y0 * scale));
      const bottom = Math.min(canvas.height, Math.ceil(y1 * scale));
      for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) {
          const i = (y * canvas.width + x) * 4;
          seen.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
        }
      }
      return [...seen];
    });
  })()`);
}

const rgbOf = (css: string): [number, number, number, number] => {
  const parts = css.match(/[\d.]+/g)!.map(Number);
  return [parts[0]!, parts[1]!, parts[2]!, parts[3] ?? 1];
};

test("Issue 10 AC3: Hero and closing text meet WCAG AA contrast over their photos in light and dark", async (t) => {
  const failures: string[] = [];
  const report: string[] = [];
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ] as const) {
    const page = await openLanding(width, height, true, THEME_COOKIE_LIGHT);
    try {
      for (const theme of ["light", "dark"] as const) {
        for (const rendering of ["placeholders", "default"] as const) {
          const scenario = `${theme} ${width}x${height} ${rendering} render`;
          await page.tab.setExtraHeaders({ cookie: `shortlet_theme=${theme}` });
          const stop =
            rendering === "placeholders"
              ? await serveWelcome(
                  page.tab,
                  page.base,
                  renderLandingHtml(theme, { placeholders: true }),
                )
              : undefined;
          try {
            await page.tab.navigate(`${page.base}/welcome`);
            await page.tab.waitForFunction(
              "document.readyState === 'complete' && (!document.querySelector('.landing-hero__photo') || document.querySelector('.landing-hero__photo').complete)",
              20_000,
            );
            // Two screens per scenario: the hero at the top, then the closing after it is centred (its photo lazy-loads).
            for (const section of ["hero", "closing"] as const) {
              if (section === "closing") {
                await page.tab.evaluate(
                  "document.querySelector('.landing-closing').scrollIntoView({ block: 'center' })",
                );
                await page.tab.waitForFunction(
                  "(() => { const i = document.querySelector('.landing-closing__photo'); return !i || (i.complete && i.naturalWidth > 0); })()",
                  20_000,
                );
                await pause(300);
              }
              // Hide the text, the app bar and the chat window (solid surfaces), leaving the photo and its scrim as rendered.
              const container =
                section === "hero"
                  ? ".landing-hero__inner"
                  : ".landing-closing__inner";
              await page.tab.evaluate(
                `(() => { const style = document.createElement('style'); style.id = 'ac3-backdrop-mask'; style.textContent = ${JSON.stringify(`header.ui-appbar, .landing-chat-wrap, ${container}, ${container} * { visibility: hidden !important; }`)}; document.head.append(style); return true; })()`,
              );
              // Fail closed: the text must be hidden in the computed style and painted hidden (two frames) before the capture.
              await page.tab.evaluate(
                "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
              );
              const textSelectors =
                section === "hero"
                  ? [
                      ".landing-hero .ui-eyebrow",
                      ".landing-hero h1",
                      ".landing-hero .landing-lede",
                      ".landing-hero .landing-composer__label",
                      ".landing-hero__cta .ui-field__hint",
                    ]
                  : [
                      ".landing-closing h2",
                      ".landing-closing .landing-composer__label",
                      ".landing-closing .ui-field__hint",
                    ];
              const hiddenState = await page.tab.evaluate<string[]>(
                `${JSON.stringify([container, ...textSelectors])}.map((sel) => { const el = document.querySelector(sel); return sel + '=' + (el ? getComputedStyle(el).visibility : 'missing'); })`,
              );
              assert.ok(
                hiddenState.every((entry) => entry.endsWith("=hidden")),
                `${scenario}: the ${section} text must be hidden before the backdrop capture (${hiddenState.join(", ")})`,
              );
              const png = await page.tab.captureScreenshot();
              await page.tab.evaluate(
                "(() => { document.getElementById('ac3-backdrop-mask')?.remove(); return true; })()",
              );
              // The text boxes are in viewport coordinates when the screenshot was taken, so they are measured again here.
              const boxes = (
                await page.tab.evaluate<TextTarget[]>(TEXT_TARGETS)
              ).filter((target) => target.name.startsWith(section));
              const palettes = await coloursBehind(
                page.tab,
                png,
                width,
                boxes.map((target) => target.box),
              );
              for (const [index, target] of boxes.entries()) {
                assert.ok(
                  target.found,
                  `${scenario}: ${target.name} is on the page`,
                );
                const palette = palettes[index] ?? [];
                assert.ok(
                  palette.length > 0,
                  `${scenario}: ${target.name} has no backdrop pixels under box ${JSON.stringify(target.box)}`,
                );
                let lightest: Rgb = [0, 0, 0];
                let lightestLuminance = -1;
                for (const packed of palette) {
                  const rgb: Rgb = [
                    (packed >> 16) & 255,
                    (packed >> 8) & 255,
                    packed & 255,
                  ];
                  const luminance = relativeLuminanceRgb(
                    rgb[0],
                    rgb[1],
                    rgb[2],
                  );
                  if (luminance > lightestLuminance) {
                    lightestLuminance = luminance;
                    lightest = rgb;
                  }
                }
                // A translucent text colour is composited over the lightest backdrop pixel (the worst case).
                const [r, g, b, a] = rgbOf(target.color);
                const text: Rgb = [
                  a * r + (1 - a) * lightest[0],
                  a * g + (1 - a) * lightest[1],
                  a * b + (1 - a) * lightest[2],
                ];
                const ratio = contrastRatioOfLuminances(
                  relativeLuminanceRgb(text[0], text[1], text[2]),
                  lightestLuminance,
                );
                const required = target.fontSize >= 24 ? 3 : 4.5;
                const line = `${scenario} | ${target.name} | ${target.fontSize}px | text ${target.color} | lightest backdrop rgb(${lightest.join(", ")}) | ${ratio.toFixed(2)}:1 (needs ${required}:1)`;
                report.push(line);
                if (ratio < required) failures.push(line);
              }
            }
          } finally {
            if (stop) await stop();
          }
        }
      }
    } finally {
      await page.close();
    }
  }
  for (const line of report) t.diagnostic(line);
  // Failure path: a text box below its required ratio is listed with its measured ratio and the required one.
  assert.equal(
    failures.length,
    0,
    `text below WCAG AA over the photo:\n${failures.join("\n")}`,
  );
  assert.equal(
    report.length,
    80,
    `every hero and closing text element was measured in all 8 scenarios (${report.length} measurements)`,
  );
});

interface ResourceRecord {
  readonly path: string;
  readonly origin: string;
  readonly transferSize: number;
  readonly responseEnd: number;
}
const RESOURCES = `(() => performance.getEntriesByType('resource').map((entry) => {
  const url = new URL(entry.name);
  return { path: url.pathname, origin: url.origin, transferSize: entry.transferSize, responseEnd: entry.responseEnd };
}))()`;
const PAINTS = `(() => performance.getEntriesByType('paint').map((entry) => ({ name: entry.name, startTime: entry.startTime })))()`;
const HERO_PHOTO_PATH = "/landing/photos/ikoyi-living.jpg";
const kilobytes = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;

const OWNER_DEFERRED_PHOTOS =
  "Owner-deferred 14 Oct 2026 until approved photography (issue 06 item 5); stand-in photos stay at current size";

test("Issue 10 AC4: Font payload stays within budget, every request is same-origin, and the default render requests no hero or closing photo", async (t) => {
  const failures: string[] = [];
  const numbers: string[] = [];
  const check = (ok: boolean, message: string): void => {
    if (!ok) failures.push(message);
  };

  // Placeholders render (fonts and every request as the local build serves them), Fast 3G, at 1440.
  {
    const page = await openLanding(1440, 900, true, THEME_COOKIE_LIGHT);
    try {
      const stop = await serveWelcome(
        page.tab,
        page.base,
        renderLandingHtml("light", { placeholders: true }),
      );
      try {
        await page.tab.setNetworkProfile("fast3g");
        await page.tab.navigate(`${page.base}/welcome`);
        await page.tab.waitForFunction(
          "document.readyState === 'complete' && document.querySelector('.landing-hero__photo').complete",
          60_000,
        );
        await page.tab.evaluate(
          "window.scrollTo(0, document.documentElement.scrollHeight)",
        );
        await pause(3_000);
        const resources = await page.tab.evaluate<ResourceRecord[]>(RESOURCES);
        const fonts = resources.filter((r) => r.path.endsWith(".woff2"));
        const fontBytes = fonts.reduce((sum, r) => sum + r.transferSize, 0);
        const thirdParty = resources.filter((r) => r.origin !== page.base);
        const label = "placeholders 1440px, Fast 3G";
        numbers.push(
          `${label}: fonts ${fonts.map((f) => `${f.path.split("/").pop()} ${f.transferSize} B`).join(", ")} = ${fontBytes} B (${kilobytes(fontBytes)}; budget ${kilobytes(PHOTO_BUDGET_FONTS_BYTES)})`,
        );
        numbers.push(
          `${label}: requests ${resources.length}, to other origins ${thirdParty.length}`,
        );
        check(
          fonts.length > 0 && fontBytes <= PHOTO_BUDGET_FONTS_BYTES,
          `${label}: font payload ${fontBytes} B (${kilobytes(fontBytes)}) is over ${kilobytes(PHOTO_BUDGET_FONTS_BYTES)} (or no font was fetched)`,
        );
        check(
          thirdParty.length === 0,
          `${label}: requests to other origins: ${thirdParty.map((r) => r.origin + r.path).join(", ")}`,
        );
      } finally {
        await stop();
      }
    } finally {
      await page.close();
    }
  }

  // Default (public) render: no hero or closing photo element is on the page, so neither is requested. The app-layer example
  // phones still load their own photos (the same files); those are reported, not counted here.
  for (const width of [1440, 390] as const) {
    const page = await openLanding(
      width,
      width === 390 ? 844 : 900,
      true,
      THEME_COOKIE_LIGHT,
    );
    try {
      await page.tab.setNetworkProfile("fast3g");
      await page.tab.navigate(`${page.base}/welcome`);
      await page.tab.waitForFunction(
        "document.readyState === 'complete'",
        60_000,
      );
      await page.tab.evaluate(
        "window.scrollTo(0, document.documentElement.scrollHeight)",
      );
      await pause(3_000);
      const resources = await page.tab.evaluate<ResourceRecord[]>(RESOURCES);
      const photoElements = await page.tab.evaluate<number>(
        "document.querySelectorAll('.landing-hero__photo, .landing-closing__photo').length",
      );
      const photos = resources.filter((r) =>
        r.path.startsWith("/landing/photos/"),
      );
      const thirdParty = resources.filter((r) => r.origin !== page.base);
      numbers.push(
        `default ${width}px, Fast 3G: hero or closing photo elements ${photoElements}; app-layer photo requests ${photos.map((r) => `${r.path.split("/").pop()} ${r.transferSize} B`).join(", ") || "none"}; to other origins ${thirdParty.length}`,
      );
      check(
        photoElements === 0,
        `default ${width}px: the hero and closing photo elements are absent (found ${photoElements})`,
      );
      check(
        thirdParty.length === 0,
        `default ${width}px: requests to other origins: ${thirdParty.map((r) => r.origin + r.path).join(", ")}`,
      );
    } finally {
      await page.close();
    }
  }

  for (const line of numbers) t.diagnostic(line);
  assert.equal(
    failures.length,
    0,
    `font, origin or default-photo check failed:\n${failures.join("\n")}`,
  );
});

test("Owner demo approval: the illustrative-photo notice is unobscured, with accessible reflow and controls at 320, 390, 768 and 1280 in both themes", async () => {
  const directory = join(
    process.cwd(),
    ".scratch",
    "landing-page",
    "screenshots",
    "11",
  );
  mkdirSync(directory, { recursive: true });
  const reports: unknown[] = [];
  for (const theme of ["light", "dark"] as const) {
    const page = await openLanding(320, 900, true);
    const stop = await serveWelcome(
      page.tab,
      page.base,
      renderLandingHtml(theme, { demo: true }),
    );
    try {
      for (const width of [320, 390, 768, 1280]) {
        await page.tab.setCssViewport(width, 900);
        await page.tab.navigate(`${page.base}/welcome`);
        await page.tab.waitForSelector("[data-landing-demo]");
        await page.tab.evaluate("document.fonts.ready");
        const findings = await page.tab.evaluate<{
          noticeTop: number;
          headerBottom: number;
          overflow: number;
          shortControls: string[];
        }>(`(() => {
          const notice = document.querySelector('[data-landing-demo]').getBoundingClientRect();
          const header = document.querySelector('header.ui-appbar').getBoundingClientRect();
          const shortControls = [...document.querySelectorAll('a, button, input:not([type=hidden]), textarea, select, summary')].filter((element) => {
            const box = element.getBoundingClientRect();
            return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== 'hidden' && (box.width < 44 || box.height < 44);
          }).map((element) => element.tagName + ':' + (element.getAttribute('aria-label') || element.textContent.trim()).slice(0, 50));
          return { noticeTop: notice.top, headerBottom: header.bottom, overflow: document.documentElement.scrollWidth - innerWidth, shortControls };
        })()`);
        const text = await page.tab.evaluate<{
          checked: number;
          small: string[];
        }>(TEXT_SIZES);
        reports.push({ theme, width, ...findings, text });
        writeFileSync(
          join(directory, `demo-${theme}-${width}.png`),
          await page.tab.captureScreenshot(),
        );
        writeFileSync(
          join(directory, "demo-findings.json"),
          JSON.stringify(reports, null, 2),
        );
        assert.ok(
          findings.noticeTop >= findings.headerBottom,
          `${theme} ${width}: the sticky header obscures the demo notice (${JSON.stringify(findings)})`,
        );
        assert.ok(
          findings.overflow <= 1,
          `${theme} ${width}: horizontal overflow`,
        );
        assert.deepEqual(
          findings.shortControls,
          [],
          `${theme} ${width}: every control meets the 44px target`,
        );
        assert.ok(text.checked > 0);
        assert.deepEqual(
          text.small,
          [],
          `${theme} ${width}: no text under 12px`,
        );
      }
    } finally {
      try {
        await stop();
      } finally {
        await page.close();
      }
    }
  }
});

// Owner-deferred (14 Oct 2026): the same assertions as before the split. Remove the skip once approved photography replaces the
// stand-in photos (issue 06 item 5). Nothing in the assertions is weakened.
test("Issue 10 AC4 (owner-deferred): Hero image stays within budget at 1440 and 390, and the H1 and composer paint before it finishes", {
  skip: OWNER_DEFERRED_PHOTOS,
}, async (t) => {
  const failures: string[] = [];
  const numbers: string[] = [];
  const check = (ok: boolean, message: string): void => {
    if (!ok) failures.push(message);
  };

  // Placeholders render (the hero photo is present), Fast 3G, at 1440 and at 390.
  // Paint check: the first contentful paint (buffered by the browser, no script in the page) is the first text or
  // image painted. The H1 and the composer sit in that first frame, so if the first paint is after the hero image has
  // finished, neither can have been painted before it. A pass does not prove the H1 alone: it only bounds the first paint.
  for (const [width, height, heroBudget] of [
    [1440, 900, PHOTO_BUDGET_HERO_1440_BYTES],
    [390, 844, PHOTO_BUDGET_HERO_390_BYTES],
  ] as const) {
    const page = await openLanding(width, height, true, THEME_COOKIE_LIGHT);
    try {
      const stop = await serveWelcome(
        page.tab,
        page.base,
        renderLandingHtml("light", { placeholders: true }),
      );
      try {
        await page.tab.setNetworkProfile("fast3g");
        await page.tab.navigate(`${page.base}/welcome`);
        await page.tab.waitForFunction(
          "document.readyState === 'complete' && document.querySelector('.landing-hero__photo').complete",
          60_000,
        );
        await page.tab.evaluate(
          "window.scrollTo(0, document.documentElement.scrollHeight)",
        );
        await pause(3_000);
        const resources = await page.tab.evaluate<ResourceRecord[]>(RESOURCES);
        const paints =
          await page.tab.evaluate<{ name: string; startTime: number }[]>(
            PAINTS,
          );
        const hero = resources.find((r) => r.path === HERO_PHOTO_PATH);
        const heroBytes = hero?.transferSize ?? 0;
        const heroDone = hero?.responseEnd ?? 0;
        const firstPaint =
          paints.find((p) => p.name === "first-contentful-paint")?.startTime ??
          0;
        const label = `placeholders ${width}px, Fast 3G`;
        numbers.push(
          `${label}: hero image ${HERO_PHOTO_PATH} transferSize ${heroBytes} B (${kilobytes(heroBytes)}; budget ${kilobytes(heroBudget)}), finished at ${Math.round(heroDone)} ms`,
        );
        numbers.push(
          `${label}: first contentful paint at ${Math.round(firstPaint)} ms (H1 and composer are in this first frame)`,
        );
        check(
          hero !== undefined && heroBytes <= heroBudget,
          `${label}: hero image ${heroBytes} B (${kilobytes(heroBytes)}) is over ${kilobytes(heroBudget)} (or it was not fetched)`,
        );
        check(
          firstPaint > 0 && firstPaint < heroDone,
          `${label}: first contentful paint at ${Math.round(firstPaint)} ms is not before the hero image finished at ${Math.round(heroDone)} ms, so the H1 and composer were not painted before the photo`,
        );
      } finally {
        await stop();
      }
    } finally {
      await page.close();
    }
  }

  for (const line of numbers) t.diagnostic(line);
  assert.equal(
    failures.length,
    0,
    `budget or paint check failed:\n${failures.join("\n")}`,
  );
});
