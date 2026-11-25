// Captures and ADR 0078 checks for the founding partners page (issue 17): 320, 390, 768 and 1280, light and dark.
// Usage: npx tsx .scratch/landing-page/capture-17.ts [outputFolder]. Writes page-<theme>-<width>-<n>.png in slices of SLICE px,
// demo-<theme>-<width>-<step>.png for the six steps, no-script-390.png, and findings.txt. Local synthetic data only.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startLocalGuestServer } from "../../apps/local-guest/src/guest-server.js";
import {
  launchRealBrowser,
  type RealBrowserTab,
} from "../../test/helpers/chrome-devtools.js";

const out = join(
  import.meta.dirname,
  "screenshots",
  process.argv[2] ?? "17",
);
mkdirSync(out, { recursive: true });
const SLICE = 2400;

const AUDIT = `(() => {
  const vw = document.documentElement.clientWidth;
  const shown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const name = (el) => el.tagName.toLowerCase() + '.' + String(el.className.baseVal ?? el.className).split(' ')[0] + ' "' + (el.textContent || el.name || '').trim().slice(0, 40) + '"';
  const controls = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, summary')]
    .filter((el) => shown(el) && !el.closest('[inert]') && !el.matches('.xp-skip'));
  const small = controls.filter((el) => { const t = el.matches('input[type=checkbox]') ? el.closest('label') : el; const r = t.getBoundingClientRect(); return r.width < 44 || r.height < 44; })
    .map((el) => { const r = el.getBoundingClientRect(); return name(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height); });
  const clipped = (el) => { for (let p = el.parentElement; p; p = p.parentElement) if (p.matches('.xp-screen, .xp-hero__figure, .xp-sr')) return true; return false; };
  const past = [...document.querySelectorAll('.xp *')].filter((el) => shown(el) && !el.matches('.xp-skip, .xp-sr') && !clipped(el) && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().right > vw + 0.5).map(name);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const tiny = [];
  const naira = [];
  while (walker.nextNode()) {
    const el = walker.currentNode.parentElement;
    if (!walker.currentNode.data.trim() || !shown(el) || el.closest('script, style, .xp-sr')) continue;
    const cs = getComputedStyle(el);
    if (parseFloat(cs.fontSize) < 12) tiny.push(name(el));
    if (walker.currentNode.data.includes('\\u20a6') && !cs.fontFamily.startsWith('Newsreader')) naira.push(name(el));
  }
  return { overflow: document.documentElement.scrollWidth - vw, controls: controls.length, small, past, tiny, naira };
})()`;

// Contrast of every visible text node against the nearest solid background behind it (text over gradients is not measured).
const CONTRAST = `(() => {
  const parse = (c) => { const m = c.match(/[\\d.]+/g).map(Number); return m.length < 4 ? [...m, 1] : m; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const fails = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let checked = 0;
  while (walker.nextNode()) {
    const el = walker.currentNode.parentElement;
    if (!walker.currentNode.data.trim() || !el.getClientRects().length || el.closest('script, style, .xp-sr, .xp-skip')) continue;
    let bg = null;
    for (let p = el; p; p = p.parentElement) { const c = parse(getComputedStyle(p).backgroundColor); if (c[3] === 1) { bg = c; break; } }
    if (!bg) continue;
    const cs = getComputedStyle(el); const a = lum(parse(cs.color)), b = lum(bg);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const size = parseFloat(cs.fontSize); const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
    checked++;
    if (ratio < (large ? 3 : 4.5)) fails.add(el.className + ' "' + walker.currentNode.data.trim().slice(0, 30) + '" ' + ratio.toFixed(2));
  }
  return { checked, fails: [...fails] };
})()`;

// What the design calls the must-see parts of a step, and whether each is inside the screen and above the bar and the fade.
const MUST_SEE = `(() => {
  const screen = document.querySelector('.xp-frame.is-on .xp-screen > .ui-page');
  const bar = screen.querySelector('[data-demo-bar]');
  const box = screen.getBoundingClientRect();
  const floor = box.bottom - (bar ? bar.offsetHeight : 0);
  const items = [...screen.querySelectorAll('[data-demo-focal], [data-demo-keep]')].filter((el) => !(bar && bar.contains(el)));
  return { scroll: Math.round(screen.scrollTop), hidden: items.filter((el) => { const r = el.getBoundingClientRect(); return r.bottom > floor + 0.5 || r.top < box.top - 0.5; }).map((el) => el.className) };
})()`;

async function settle(tab: RealBrowserTab): Promise<void> {
  await tab.evaluate(
    "document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))))",
  );
}

const server = startLocalGuestServer({
  port: 0,
  conciergeMode: "deterministic",
  partnerPrivacyNoticeUrl: "https://example.com/privacy",
});
const base = `http://127.0.0.1:${await server.listen()}`;
const browser = await launchRealBrowser({ headless: true });
const lines: string[] = [];
try {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [320, 390, 768, 1280]) {
      const open = async (): Promise<RealBrowserTab> => {
        const tab = await browser.createTab();
        await tab.setReducedMotion(true);
        await tab.setCssViewport(width, 900);
        await tab.setCookie("shortlet_theme", theme, base);
        await tab.navigate(`${base}/partners`);
        await tab.waitForSelector(".xp-stage.is-live", 10_000);
        await settle(tab);
        return tab;
      };
      let tab = await open();
      const audit = await tab.evaluate<{
        overflow: number;
        controls: number;
        small: string[];
        past: string[];
        tiny: string[];
        naira: string[];
      }>(AUDIT);
      const contrast = await tab.evaluate<{
        checked: number;
        fails: string[];
      }>(CONTRAST);
      const height = await tab.evaluate<number>(
        "document.documentElement.scrollHeight",
      );
      lines.push(
        `${theme} ${width}: height ${height}, overflow ${audit.overflow}px, ${audit.controls} controls, under 44px: ${JSON.stringify(audit.small)}, past the edge: ${JSON.stringify(audit.past)}, under 12px: ${JSON.stringify(audit.tiny)}, naira outside Newsreader: ${JSON.stringify(audit.naira)}, contrast ${contrast.checked} checked, fails ${JSON.stringify(contrast.fails)}`,
      );
      await tab.close();
      for (let top = 0, n = 1; top < height; top += SLICE, n += 1) {
        tab = await open();
        await tab.setCssViewport(width, SLICE);
        await settle(tab);
        await tab.evaluate(`window.scrollTo(0, ${top})`);
        await settle(tab);
        writeFileSync(
          join(out, `page-${theme}-${width}-${n}.png`),
          await tab.captureScreenshot(),
        );
        await tab.close();
      }
      tab = await open();
      for (let step = 1; step <= 6; step += 1) {
        if (step > 1) {
          await tab.clickButton("Next");
          await settle(tab);
        }
        await tab.evaluate(
          "document.querySelector('[data-demo-stage]').scrollIntoView({ block: 'start', behavior: 'instant' })",
        );
        await settle(tab);
        const seen = await tab.evaluate<{ scroll: number; hidden: string[] }>(
          MUST_SEE,
        );
        const stepAudit = await tab.evaluate<{
          overflow: number;
          small: string[];
          tiny: string[];
        }>(AUDIT);
        const stepContrast = await tab.evaluate<{ fails: string[] }>(CONTRAST);
        lines.push(
          `  step ${step}: screen scrolled ${seen.scroll}px, must-see hidden ${JSON.stringify(seen.hidden)}, overflow ${stepAudit.overflow}, small ${stepAudit.small.length}, tiny ${stepAudit.tiny.length}, contrast fails ${JSON.stringify(stepContrast.fails)}`,
        );
        if (theme === "light" || step === 4)
          writeFileSync(
            join(out, `demo-${theme}-${width}-${step}.png`),
            await tab.captureScreenshot(),
          );
      }
      await tab.close();
    }
  }
  const plain = await browser.createTab();
  await plain.setJavaScriptEnabled(false);
  await plain.setCssViewport(390, SLICE);
  await plain.navigate(`${base}/partners#guest`);
  writeFileSync(join(out, "no-script-390.png"), await plain.captureScreenshot());
  await plain.close();
} finally {
  await browser.close();
  await server.close();
}
writeFileSync(join(out, "findings.txt"), `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
