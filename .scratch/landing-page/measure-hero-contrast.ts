// Scratch measurement (not a test): contrast of each hero text element against the lightest pixel behind its box.
// Background = the hero with its text hidden (photo + scrim as rendered). Text = the element's computed colour.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { LocalGuestEnvironment } from "../../apps/local-guest/src/fixture.js";
import { startLocalGuestServer } from "../../apps/local-guest/src/guest-server.js";
import { launchRealBrowser } from "../../test/helpers/chrome-devtools.js";

const directory = mkdtempSync(join(tmpdir(), "hero-contrast-"));
const environment = new LocalGuestEnvironment({ databasePath: join(directory, "guest.sqlite") });
const server = startLocalGuestServer({ port: 0, environment });
const port = await server.listen();
const base = `http://127.0.0.1:${port}`;
const browser = await launchRealBrowser({ headless: true });
const tab = await browser.createTab();
await tab.setReducedMotion(true);

const TARGETS = `(() => {
  const list = [];
  const add = (name, el) => {
    if (!el) return;
    const r = el.getBoundingClientRect();
    list.push({ name, color: getComputedStyle(el).color, box: [r.left, r.top, r.right, r.bottom] });
  };
  add('eyebrow', document.querySelector('.landing-hero .ui-eyebrow'));
  add('h1', document.querySelector('.landing-hero h1'));
  add('h1 accent', document.querySelector('.landing-hero__accent'));
  add('lede', document.querySelector('.landing-lede'));
  add('composer label', document.querySelector('.landing-composer__label'));
  document.querySelectorAll('.landing-suggest').forEach((el, i) => add('chip ' + (i + 1), el));
  add('reassurance', document.querySelector('.landing-hero .ui-field__hint'));
  return { list, innerWidth: window.innerWidth };
})()`;

const lin = (v: number): number => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = (r: number, g: number, b: number): number => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

interface Target { name: string; color: string; box: [number, number, number, number] }

const CASES = [
  { label: "light 1440x900", theme: "light", width: 1440, height: 900 },
  { label: "light 390x844", theme: "light", width: 390, height: 844 },
  { label: "dark 1440x900", theme: "dark", width: 1440, height: 900 },
] as const;

try {
  for (const c of CASES) {
    await tab.setExtraHeaders({ cookie: `shortlet_theme=${c.theme}` });
    if (c.width < 768) await tab.setViewport(c.width, c.height);
    else await tab.setCssViewport(c.width, c.height);
    await tab.navigate(`${base}/welcome`);
    await tab.waitForFunction("document.readyState === 'complete'", 10_000);
    const { list, innerWidth } = await tab.evaluate<{ list: Target[]; innerWidth: number }>(TARGETS);
    await tab.evaluate("document.querySelector('.landing-hero__inner').style.visibility='hidden'; document.querySelector('.landing-chat-wrap').style.visibility='hidden'");
    await tab.evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))");
    const png = Buffer.from(await tab.captureScreenshot());
    (await import("node:fs")).writeFileSync(`C:/Users/Cyrus/AppData/Local/Temp/claude/C--AI2026-chat-marketplace/a3b6460a-f087-4059-be6b-68fc290ac055/scratchpad/bg-${c.theme}-${c.width}.png`, png);
    await tab.evaluate("document.querySelector('.landing-hero__inner').style.visibility=''; document.querySelector('.landing-chat-wrap').style.visibility=''");
    const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const scale = info.width / innerWidth;
    console.log(`== ${c.label} (screenshot ${info.width}x${info.height}, scale ${scale.toFixed(3)})`);
    for (const t of list) {
      const [x0, y0, x1, y1] = t.box;
      const left = Math.max(0, Math.floor(x0 * scale)), top = Math.max(0, Math.floor(y0 * scale));
      const right = Math.min(info.width, Math.ceil(x1 * scale)), bottom = Math.min(info.height, Math.ceil(y1 * scale));
      let maxBg = 0;
      for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) {
          const i = (y * info.width + x) * 3;
          const L = lum(data[i]!, data[i + 1]!, data[i + 2]!);
          if (L > maxBg) maxBg = L;
        }
      }
      const m = t.color.match(/[\d.]+/g)!.map(Number);
      const textL = lum(m[0]!, m[1]!, m[2]!);
      const ratio = (Math.max(textL, maxBg) + 0.05) / (Math.min(textL, maxBg) + 0.05);
      console.log(`${t.name.padEnd(14)} text ${t.color.padEnd(22)} lightest bg L=${maxBg.toFixed(3)}  contrast ${ratio.toFixed(2)}:1`);
    }
  }
} finally {
  await browser.close?.();
  await server.close?.();
}
process.exit(0);
