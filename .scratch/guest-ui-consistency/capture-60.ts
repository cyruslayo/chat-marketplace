// Issue 60 captures: a real stale View refusal and a real forbidden refusal, at 320/390/768/1280 light and dark.
// - Stale: a second tab advances the thread (View), so the first tab's card is superseded; its View is refused as stale and the client
//   shows the stale copy and refreshes (as RB6 does).
// - Forbidden: the page's request interception returns a forbidden /api/event for the tapped "Request to Book" (as RB14 does), so the
//   client disables that control.
// Each state image must differ from a baseline of the same screen captured before the refusal, and the refused control must be scrolled
// into view and at least 44px. Usage: NODE_ENV=test tsx .scratch/guest-ui-consistency/capture-60.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchRealBrowser, type RealBrowserTab } from "../../test/helpers/chrome-devtools.js";
import { restartFixture } from "../../test/helpers/guest-restart.js";
import { GUEST_REFUSAL_DEFAULT } from "../../apps/web-agent/src/guest-content.js";

const out = join(import.meta.dirname, "screenshots", "60");
mkdirSync(out, { recursive: true });
const PROMPT = "I need an apartment in Ikoyi from 10 Sept for 3 nights for 2 people";
const IKOYI_TITLE = "Luxury 2-Bedroom Apartment in Old Ikoyi";
const MIN_TARGET_PX = 44;
const THEMES = ["light", "dark"] as const;

const fixture = await restartFixture();
const eq = fixture.cookie.indexOf("=");
const cookieName = fixture.cookie.slice(0, eq);
const cookieValue = fixture.cookie.slice(eq + 1);
const threadUrl = `${fixture.base}/?threadId=${encodeURIComponent(fixture.threadId)}`;
const browser = await launchRealBrowser();
const captures = new Map<string, Uint8Array>();
let failures = 0;

function differs(a: Uint8Array | undefined, b: Uint8Array | undefined): boolean {
  return a !== undefined && b !== undefined && Buffer.compare(Buffer.from(a), Buffer.from(b)) !== 0;
}
async function openTab(): Promise<RealBrowserTab> {
  const tab = await browser.createTab();
  await tab.setCookie(cookieName, cookieValue, fixture.base);
  await tab.navigate(threadUrl);
  return tab;
}
async function sendPrompt(tab: RealBrowserTab, text: string): Promise<void> {
  await tab.evaluate(`(() => { const input = document.getElementById("composer-input"); input.value = ${JSON.stringify(text)}; document.getElementById("composer").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); })()`);
}
async function setTheme(tab: RealBrowserTab, theme: string): Promise<void> {
  await tab.evaluate(`document.documentElement.setAttribute('data-theme', '${theme}')`);
  await new Promise((resolve) => setTimeout(resolve, 200));
}
async function shot(tab: RealBrowserTab, name: string): Promise<void> {
  const overflow = await tab.evaluate<number>(`document.documentElement.scrollWidth - innerWidth`);
  if (overflow > 0) {
    console.error(`${name}: HORIZONTAL OVERFLOW ${overflow}px`);
    failures++;
  }
  let image: Uint8Array | undefined;
  for (let attempt = 0; attempt < 3 && image === undefined; attempt++) {
    try {
      image = await tab.captureScreenshot();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (image === undefined) {
    console.error(`${name}: screenshot failed`);
    failures++;
    return;
  }
  captures.set(name, image);
  writeFileSync(join(out, `${name}.png`), image);
  console.log(`${name}: captured${overflow > 0 ? " (overflow)" : ""}`);
}

try {
  for (const width of [320, 390, 768, 1280]) {
    const size = (tab: RealBrowserTab, height: number) => width < 768 ? tab.setViewport(width, height) : tab.setCssViewport(width, height);
    let tabB: RealBrowserTab | undefined;
    let tabA: RealBrowserTab | undefined;
    try {
      // Tab B renders the discovery card and holds it as the baseline.
      tabB = await openTab();
      await size(tabB, 900);
      await sendPrompt(tabB, PROMPT);
      await tabB.waitForText(IKOYI_TITLE, 30_000);
      for (const theme of THEMES) {
        await setTheme(tabB, theme);
        await shot(tabB, `baseline-stale-${theme}-${width}`);
      }

      // Tab A loads the same thread after the search, then advances it (superseding Tab B's card).
      tabA = await openTab();
      await size(tabA, 900);
      await tabA.waitForText(IKOYI_TITLE, 30_000);
      await tabA.clickButton("View apartment", IKOYI_TITLE);
      await tabA.waitForText("Request to Book", 15_000);
      for (const theme of THEMES) {
        await setTheme(tabA, theme);
        await shot(tabA, `baseline-disabled-${theme}-${width}`);
      }

      // Real stale refusal on Tab B.
      await tabB.clickButton("View apartment", IKOYI_TITLE);
      await tabB.waitForText(GUEST_REFUSAL_DEFAULT.stale, 15_000);
      // On narrow widths the focused surface hides the conversation, so open it to show the stale copy (the 1280 split view already shows it).
      if (width < 1024) {
        await tabB.clickButton("Back");
        await tabB.waitForText(GUEST_REFUSAL_DEFAULT.stale, 15_000);
      }
      for (const theme of THEMES) {
        await setTheme(tabB, theme);
        await shot(tabB, `stale-${theme}-${width}`);
        if (!differs(captures.get(`baseline-stale-${theme}-${width}`), captures.get(`stale-${theme}-${width}`))) {
          console.error(`stale-${theme}-${width}: identical to the baseline (state not visible)`);
          failures++;
        }
      }

      // Real forbidden refusal on Tab A: intercept /api/event for the tapped Request to Book.
      let eventRequests = 0;
      const stop = await tabA.interceptRequests(async (url) => {
        if (!url.includes("/api/event")) return undefined;
        eventRequests += 1;
        return {
          status: 200,
          headers: [{ name: "content-type", value: "application/json" }],
          body: new TextEncoder().encode(JSON.stringify({ ok: false, code: "ACTION_NOT_AUTHORIZED", refusal: "forbidden", message: GUEST_REFUSAL_DEFAULT.forbidden })),
        };
      });
      try {
        await tabA.clickButton("Request to Book");
        await tabA.waitForText(GUEST_REFUSAL_DEFAULT.forbidden, 15_000);
        const measured = await tabA.evaluate<{ height: number; found: boolean }>(`(() => { const button = document.querySelector('#active-workspace button[aria-disabled="true"]'); if (!button) return { height: 0, found: false }; button.scrollIntoView({ block: "center" }); return { height: button.getBoundingClientRect().height, found: true }; })()`);
        if (!measured.found || measured.height < MIN_TARGET_PX) {
          console.error(`disabled-${width}: refused control ${measured.found ? `${measured.height}px` : "not found"}`);
          failures++;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
        for (const theme of THEMES) {
          await setTheme(tabA, theme);
          await shot(tabA, `disabled-${theme}-${width}`);
          if (!differs(captures.get(`baseline-disabled-${theme}-${width}`), captures.get(`disabled-${theme}-${width}`))) {
            console.error(`disabled-${theme}-${width}: identical to the baseline (state not visible)`);
            failures++;
          }
        }
        console.log(`disabled-${width}: ${eventRequests} event request(s), target ${measured.height}px`);
      } finally {
        await stop();
      }
    } finally {
      await tabA?.close();
      await tabB?.close();
    }
  }
} finally {
  await browser.close();
  await fixture.close();
}
if (failures > 0) {
  console.error(`${failures} capture check(s) failed`);
  process.exitCode = 1;
}
