// Issue 09 extra captures (motion allowed, 1280 x 800, JavaScript on), light and dark: the pinned phone at step 2 and step 4,
// the app bar on the photo at the top, and the solid bar once the hero has scrolled out. It also prints the measured contrast
// of each inactive step's eyebrow, heading, body and pain line against its computed background.
// Usage: npx tsx .scratch/landing-page/capture-09-extra.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalGuestEnvironment } from "../../apps/local-guest/src/fixture.js";
import { startLocalGuestServer } from "../../apps/local-guest/src/guest-server.js";
import { launchRealBrowser } from "../../test/helpers/chrome-devtools.js";

const out = join(import.meta.dirname, "screenshots", "09");
mkdirSync(out, { recursive: true });
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const directory = mkdtempSync(join(tmpdir(), "landing-capture-09-"));
const environment = new LocalGuestEnvironment({ databasePath: join(directory, "guest.sqlite") });
const server = startLocalGuestServer({ port: 0, environment });
const port = await server.listen();
const base = `http://127.0.0.1:${port}`;
const browser = await launchRealBrowser({ headless: true });
const bar = `(() => { const bar = document.querySelector('header.ui-appbar'); const cs = getComputedStyle(bar); return { onPhoto: bar.classList.contains('landing-appbar--on-photo'), position: cs.position, top: Math.round(bar.getBoundingClientRect().top), background: cs.backgroundColor, height: Math.round(bar.getBoundingClientRect().height) }; })()`;
const h1 = `Math.round(document.querySelector('.landing-hero h1').getBoundingClientRect().top + window.scrollY)`;
// Contrast of every inactive step's text (eyebrow, heading, body, pain line) against its computed background, in the page.
const CONTRAST = `(() => {
  const lum = (rgb) => { const [r, g, b] = rgb.match(/[\\d.]+/g).slice(0, 3).map((c) => { const v = Number(c) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  const rows = [];
  for (const caption of document.querySelectorAll('[data-landing-caption]')) {
    if (caption.classList.contains('is-active')) continue;
    let bg = null;
    for (let e = caption; e && !bg; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (c !== 'rgba(0, 0, 0, 0)') bg = c; }
    for (const [name, el] of [['eyebrow', caption.querySelector('.ui-eyebrow')], ['heading', caption.querySelector('h3')], ['body', caption.querySelector('.landing-caption__body')], ['pain', caption.querySelector('.landing-pain')]]) {
      const color = getComputedStyle(el).color;
      rows.push('step ' + caption.dataset.landingCaption + ' ' + name + ' ' + color + ' on ' + bg + ': ' + ratio(color, bg).toFixed(2) + ':1');
    }
  }
  return rows;
})()`;

const themes = ["light", "dark"] as const;
try {
  for (const theme of themes) {
    const tab = await browser.createTab();
    try {
      await tab.setReducedMotion(false);
      await tab.setCssViewport(1280, 800);
      await tab.setExtraHeaders({ cookie: `shortlet_theme=${theme}` });
      await tab.navigate(`${base}/welcome`);
      await tab.waitForSelector(".landing-pinned", 10_000);
      await pause(4800);
      const top = await tab.evaluate<Record<string, unknown>>(bar);
      const topHeadline = await tab.evaluate<number>(h1);
      writeFileSync(join(out, `top-bar-on-photo-1280-${theme}.png`), await tab.captureScreenshot());
      console.log(`[${theme}] top (scrollY 0):`, JSON.stringify({ bar: top, headlineTop: topHeadline }));

      for (const step of [2, 4]) {
        await tab.evaluate(`document.querySelector('[data-landing-caption="${step}"]').scrollIntoView({ block: 'center' })`);
        await tab.waitForFunction(`document.querySelector('[data-landing-caption="${step}"]').classList.contains('is-active')`, 10_000);
        await pause(3300);
        const state = await tab.evaluate<Record<string, unknown>>(`(() => ({
          active: [...document.querySelectorAll('[data-landing-caption].is-active')].map((el) => el.dataset.landingCaption),
          dimmed: document.querySelectorAll('[data-landing-caption].is-dim').length,
          phone: document.querySelector('.landing-pinned [data-landing-screen]')?.getAttribute('aria-label'),
          states: [...document.querySelectorAll('.landing-beat')].map((el) => el.dataset.state),
        }))()`);
        writeFileSync(join(out, `pinned-step${step}-1280-${theme}.png`), await tab.captureScreenshot());
        console.log(`[${theme}] pinned step ${step}:`, JSON.stringify(state));
        if (step === 2) for (const row of await tab.evaluate<string[]>(CONTRAST)) console.log(`[${theme}] (step 2 active) ${row}`);
      }
      for (const row of await tab.evaluate<string[]>(CONTRAST)) console.log(`[${theme}] (step 4 active) ${row}`);

      await tab.evaluate("document.querySelector('#how').scrollIntoView({ block: 'start' })");
      await tab.waitForFunction("!document.querySelector('header.ui-appbar').classList.contains('landing-appbar--on-photo')", 10_000);
      await pause(500);
      const solid = await tab.evaluate<Record<string, unknown>>(bar);
      const solidHeadline = await tab.evaluate<number>(h1);
      writeFileSync(join(out, `scrolled-bar-solid-1280-${theme}.png`), await tab.captureScreenshot());
      console.log(`[${theme}] scrolled past hero:`, JSON.stringify({ bar: solid, headlineDocumentTop: solidHeadline }));
    } finally {
      try { await tab.close(); } catch {}
    }
  }
} finally {
  try { await browser.close(); } catch {}
  try { await server.close(); } catch {}
  rmSync(directory, { recursive: true, force: true });
}
