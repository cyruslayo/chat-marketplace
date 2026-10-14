// Design audit captures: viewport-sized (first fold) and full page, light/dark, 1440 and 390. Reduced motion.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalGuestEnvironment } from "../../apps/local-guest/src/fixture.js";
import { startLocalGuestServer } from "../../apps/local-guest/src/guest-server.js";
import { launchRealBrowser } from "../../test/helpers/chrome-devtools.js";

const out = join(import.meta.dirname, "screenshots", "audit");
mkdirSync(out, { recursive: true });
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const directory = mkdtempSync(join(tmpdir(), "landing-audit-"));
const environment = new LocalGuestEnvironment({ databasePath: join(directory, "guest.sqlite") });
const server = startLocalGuestServer({ port: 0, environment });
const port = await server.listen();
const base = `http://127.0.0.1:${port}`;
const browser = await launchRealBrowser({ headless: true });
const tab = await browser.createTab();
await tab.setReducedMotion(true);
try {
  for (const theme of ["light", "dark"] as const) {
    for (const [w, h] of [[1440, 900], [390, 844]] as const) {
      await tab.setExtraHeaders({ cookie: `shortlet_theme=${theme}` });
      const size = (height: number) => (w < 768 ? tab.setViewport(w, height) : tab.setCssViewport(w, height));
      await size(h);
      await tab.navigate(`${base}/welcome`);
      await tab.waitForFunction("document.readyState === 'complete'", 10_000);
      await pause(500);
      writeFileSync(join(out, `fold-${theme}-${w}.png`), await tab.captureScreenshot());
      const full = await tab.evaluate<number>("document.documentElement.scrollHeight");
      await size(full);
      await pause(400);
      writeFileSync(join(out, `full-${theme}-${w}.png`), await tab.captureScreenshot());
    }
  }
  // Computed style facts for the audit.
  await tab.setExtraHeaders({ cookie: `shortlet_theme=light` });
  await tab.setCssViewport(1440, 900);
  await tab.navigate(`${base}/welcome`);
  await tab.waitForFunction("document.readyState === 'complete'", 10_000);
  const facts = await tab.evaluate<unknown>(`(() => {
    const q = (s) => document.querySelector(s);
    const st = (s, props) => { const el = q(s); if (!el) return null; const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return Object.fromEntries([...props.map(p => [p, cs[p]]), ['box', Math.round(r.left)+','+Math.round(r.top)+' '+Math.round(r.width)+'x'+Math.round(r.height)]]); };
    const t = ['fontFamily','fontSize','fontWeight','lineHeight','letterSpacing','color','backgroundColor'];
    return {
      body: st('body', t), h1: st('.landing-hero h1', t), h2: st('#how-h', t), h3: st('.landing-caption > h3', t), lede: st('.landing-lede', t),
      eyebrow: st('.landing-hero .ui-eyebrow', t), appbar: st('.ui-appbar', [...t,'height','borderBottom','position']), brand: st('.ui-appbar__brand', t),
      navLink: st('.landing-link', t), barCta: st('.ui-appbar__action', [...t,'borderRadius','height']), theme: st('.landing-theme', [...t,'height']),
      composer: st('.landing-hero .landing-composer', [...t,'borderRadius','height','border']), send: st('.landing-hero .landing-composer__send', [...t,'borderRadius']),
      phone: st('.landing-hero .landing-phone', ['borderRadius','boxShadow','border','width','height']), hero: st('.landing-hero', ['display','gridTemplateColumns','paddingTop','paddingBottom','maxWidth','minHeight']),
      main: st('main', ['maxWidth','paddingLeft','paddingRight']), beat: st('.landing-beat', ['display','gridTemplateColumns','gap','paddingTop','paddingBottom','minHeight']),
      faqItem: st('.landing-faq__item', ['borderRadius','padding','border','boxShadow']), footer: st('.landing-footer', [...t,'paddingTop','paddingBottom']),
      fontsLoaded: [...document.fonts].map(f => f.family + ' ' + f.status), docHeight: document.documentElement.scrollHeight,
      sections: [...document.querySelectorAll('main > section')].map(s => { const r = s.getBoundingClientRect(); return (s.getAttribute('aria-label') || s.querySelector('h2')?.textContent || '').slice(0,40) + ': ' + Math.round(r.top + scrollY) + ' h' + Math.round(r.height); }),
      beats: [...document.querySelectorAll('.landing-beat')].map(s => { const r = s.getBoundingClientRect(); return Math.round(r.top + scrollY) + ' h' + Math.round(r.height); }),
      imgs: [...document.images].map(i => i.currentSrc.split('/').pop() + ' ' + i.naturalWidth + 'x' + i.naturalHeight),
    };
  })()`);
  writeFileSync(join(out, "facts.json"), JSON.stringify(facts, null, 2));
} finally {
  await browser.close?.();
  await server.close?.();
}
process.exit(0);
