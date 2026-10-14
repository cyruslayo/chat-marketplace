// Issue 09 check: the hero headline's document position and the app bar's box with JavaScript on and off, at 1280 and 390.
// Usage: npx tsx .scratch/landing-page/check-09-nojs.ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalGuestEnvironment } from "../../apps/local-guest/src/fixture.js";
import { startLocalGuestServer } from "../../apps/local-guest/src/guest-server.js";
import { launchRealBrowser } from "../../test/helpers/chrome-devtools.js";

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const directory = mkdtempSync(join(tmpdir(), "landing-check-09-"));
const environment = new LocalGuestEnvironment({ databasePath: join(directory, "guest.sqlite") });
const server = startLocalGuestServer({ port: 0, environment });
const port = await server.listen();
const base = `http://127.0.0.1:${port}`;
const browser = await launchRealBrowser({ headless: true });
const state = `(() => { const h1 = document.querySelector('.landing-hero h1').getBoundingClientRect(); const bar = document.querySelector('header.ui-appbar').getBoundingClientRect(); return { h1DocumentTop: Math.round(h1.top + window.scrollY), h1Left: Math.round(h1.left), barTop: Math.round(bar.top), barHeight: Math.round(bar.height), composerTop: Math.round(document.querySelector('form.landing-composer').getBoundingClientRect().top + window.scrollY) }; })()`;
const rows: string[] = [];
try {
  for (const width of [1280, 390]) {
    for (const js of [true, false]) {
      const tab = await browser.createTab();
      try {
        await tab.setReducedMotion(true);
        await tab.setJavaScriptEnabled(js);
        if (width === 390) await tab.setViewport(390, 800);
        else await tab.setCssViewport(1280, 800);
        await tab.navigate(`${base}/welcome`);
        await pause(600);
        rows.push(`${width}px JS ${js ? "on " : "off"}: ${JSON.stringify(await tab.evaluate<Record<string, number>>(state))}`);
      } finally {
        await tab.close();
      }
    }
  }
} finally {
  try { await browser.close(); } catch {}
  try { await server.close(); } catch {}
  rmSync(directory, { recursive: true, force: true });
}
console.log(rows.join("\n"));
