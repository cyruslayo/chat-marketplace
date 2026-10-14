// Sub-task C captures: full-page shots of the public page and of the placeholder page (local builds), and the
// bounding boxes of the regions to crop (apartments, questions, closing, footer). Usage:
//   npx tsx .scratch/landing-page/capture-08c-regions.ts
// Writes screenshots/audit/08c-public-<theme>-<width>.png, 08c-placeholders-<theme>-<width>.png and 08c-regions.json.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalGuestEnvironment } from "../../apps/local-guest/src/fixture.js";
import { startLocalGuestServer } from "../../apps/local-guest/src/guest-server.js";
import { renderLandingHtml } from "../../apps/local-guest/src/landing-page-html.js";
import { launchRealBrowser } from "../../test/helpers/chrome-devtools.js";

const out = join(import.meta.dirname, "screenshots", "audit");
mkdirSync(out, { recursive: true });
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const directory = mkdtempSync(join(tmpdir(), "landing-08c-"));
const environment = new LocalGuestEnvironment({ databasePath: join(directory, "guest.sqlite") });
const server = startLocalGuestServer({ port: 0, environment });
const port = await server.listen();
const base = `http://127.0.0.1:${port}`;
const browser = await launchRealBrowser({ headless: true });
const tab = await browser.createTab();
await tab.setReducedMotion(true);

// Page-coordinate boxes (top includes the scroll offset, which is 0 after load).
const BOXES = `(() => {
  const pick = (name, selector) => {
    const el = document.querySelector(selector);
    if (!el) return [name, null];
    const r = el.getBoundingClientRect();
    return [name, { top: Math.round(r.top + window.scrollY), bottom: Math.round(r.bottom + window.scrollY), left: Math.round(r.left), width: Math.round(r.width) }];
  };
  return Object.fromEntries([
    pick("apartments", "#apartments"),
    pick("questions", "#questions"),
    pick("closing", ".landing-closing"),
    pick("footer", ".landing-footer"),
    pick("money", "#money"),
    pick("hero", ".landing-hero"),
    pick("unit-photo", ".landing-unit__photo"),
  ]);
})()`;

const boxes: Record<string, unknown> = {};
try {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [1440, 390] as const) {
      await tab.setExtraHeaders({ cookie: `shortlet_theme=${theme}` });
      const size = (height: number) => (width < 768 ? tab.setViewport(width, height) : tab.setCssViewport(width, height));
      await size(900);
      await tab.navigate(`${base}/welcome`);
      await tab.waitForFunction("document.readyState === 'complete'", 10_000);
      await pause(400);
      boxes[`public-${theme}-${width}`] = await tab.evaluate<unknown>(BOXES);
      const publicHeight = await tab.evaluate<number>("document.documentElement.scrollHeight");
      await size(publicHeight);
      await pause(300);
      writeFileSync(join(out, `08c-public-${theme}-${width}.png`), await tab.captureScreenshot());

      // The placeholder page: the same markup with placeholders on, written into this origin in place.
      await size(900);
      await tab.navigate(`${base}/welcome`);
      await tab.waitForFunction("document.readyState === 'complete'", 10_000);
      await tab.evaluate(`document.open(); document.write(${JSON.stringify(renderLandingHtml(theme, { placeholders: true }))}); document.close(); true`);
      await tab.waitForSelector("#apartments", 10_000);
      await tab.waitForFunction("document.readyState === 'complete'", 10_000);
      await pause(400);
      boxes[`placeholders-${theme}-${width}`] = await tab.evaluate<unknown>(BOXES);
      const placeholderHeight = await tab.evaluate<number>("document.documentElement.scrollHeight");
      await size(placeholderHeight);
      await pause(300);
      writeFileSync(join(out, `08c-placeholders-${theme}-${width}.png`), await tab.captureScreenshot());
    }
  }
  writeFileSync(join(out, "08c-regions.json"), `${JSON.stringify(boxes, null, 2)}\n`);
  console.log("captured", Object.keys(boxes));
} finally {
  try { await tab.close(); } catch {}
  await browser.close({ releaseLock: false });
  await server.close();
  rmSync(directory, { recursive: true, force: true });
  browser.releaseLock();
}
