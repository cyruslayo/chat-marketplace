// Captures for the public landing page at /welcome (ADR-0078: 320/390/768/1280, no horizontal overflow,
// controls at least 44 x 44 CSS px). Usage: npx tsx .scratch/landing-page/capture-landing.ts [outputFolder]
// The default output folder is "04" (issue 04). Themes are set through the shortlet_theme cookie, as a browser sends it.
// Writes <folder>/landing-<theme>-<width>.png (reduced motion, final states), landing-light-1280-zoom200.png (640 CSS px,
// the 200% zoom equivalent of 1280), landing-pinned-1280.png (motion, beat 3 pinned), landing-beat4-reviewing-1280.png
// (motion, beat 4 pinned at stage 3; beats play only in the pinned phone since issue 09), and <folder>/findings.txt (overflow, controls, text under 12px, rail breaks, prose line
// length, and the computed size table).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalGuestEnvironment } from "../../apps/local-guest/src/fixture.js";
import { startLocalGuestServer } from "../../apps/local-guest/src/guest-server.js";
import { renderLandingHtml } from "../../apps/local-guest/src/landing-page-html.js";
import { launchRealBrowser, type RealBrowserInstance, type RealBrowserTab } from "../../test/helpers/chrome-devtools.js";

const folder = process.argv[2] ?? "04";
const out = join(import.meta.dirname, "screenshots", folder);
// Issue 10 (folder "10") adds: 1440 wide, placeholders:true renders at 390 and 1440 (served by request interception in this
// harness only, never a public switch), pinned steps 2 and 4 in both themes, content edges and section backgrounds, and the
// deposit row probe. Other folders run as before.
const ISSUE10 = folder === "10" || folder === "15";
mkdirSync(out, { recursive: true });

// Issue 10: content left edges (app bar, sections, footer must match), each section's computed background, and the deposit row
// inside the beat 5 price breakdown (its line boxes and the value's box, for the 390 wrap check).
const LAYOUT_PROBE = `(() => {
  const edgeTargets = {
    "app bar": ".landing-appbar__row",
    "hero": ".landing-hero__inner",
    "chat window": ".landing-chat-wrap",
    "trust strip": ".landing-trust .landing-container",
    "apartments": "#apartments",
    "how it works": "#how .landing-section__intro",
    "your money": "#money .landing-container",
    "questions": "#questions",
    "closing": ".landing-closing .landing-container",
    "footer": ".landing-footer .landing-container",
  };
  const edges = Object.entries(edgeTargets).map(([name, selector]) => {
    const el = document.querySelector(selector);
    if (!el) return { name, left: null };
    const style = getComputedStyle(el);
    return { name, left: Math.round((el.getBoundingClientRect().left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth)) * 100) / 100 };
  });
  const lefts = edges.filter((e) => e.left !== null).map((e) => e.left);
  const backgrounds = [];
  const bar = document.querySelector('header.ui-appbar');
  if (bar) backgrounds.push({ name: 'app bar (' + bar.className + ')', bg: getComputedStyle(bar).backgroundColor });
  for (const el of document.querySelectorAll('main > section, footer')) backgrounds.push({ name: el.tagName.toLowerCase() + ' ' + (el.id ? '#' + el.id : el.getAttribute('class')), bg: getComputedStyle(el).backgroundColor });
  backgrounds.push({ name: 'body', bg: getComputedStyle(document.body).backgroundColor });
  const row = document.querySelector('.landing-breakdown .ui-price-breakdown__row');
  let deposit = null;
  if (row) {
    const range = document.createRange();
    range.selectNodeContents(row);
    const tops = [...new Set([...range.getClientRects()].map((r) => Math.round(r.top + scrollY)))];
    const value = row.querySelector('.ui-price-breakdown__value');
    const vr = value ? value.getBoundingClientRect() : null;
    const rr = row.getBoundingClientRect();
    deposit = { text: row.textContent.trim().replace(/\\s+/g, ' '), lineTops: tops, row: [Math.round(rr.left), Math.round(rr.top + scrollY), Math.round(rr.width), Math.round(rr.height)], value: vr ? [Math.round(vr.left), Math.round(vr.top + scrollY), Math.round(vr.width), Math.round(vr.height)] : null, valueText: value ? value.textContent.trim() : null };
  }
  return { edges, spread: lefts.length ? Math.round((Math.max(...lefts) - Math.min(...lefts)) * 100) / 100 : null, backgrounds, deposit };
})()`;

interface LayoutProbe {
  readonly edges: readonly { readonly name: string; readonly left: number | null }[];
  readonly spread: number | null;
  readonly backgrounds: readonly { readonly name: string; readonly bg: string }[];
  readonly deposit: { readonly text: string; readonly lineTops: readonly number[]; readonly row: readonly number[]; readonly value: readonly number[] | null; readonly valueText: string | null } | null;
}

function formatLayout(layout: LayoutProbe): string[] {
  const lines = [`  content left edges (px): ${layout.edges.map((e) => `${e.name} ${e.left ?? "absent"}`).join("; ")}`];
  lines.push(`  content edge spread: ${layout.spread ?? "n/a"}px (must be 0 or 1)`);
  lines.push(`  section backgrounds: ${layout.backgrounds.map((b) => `${b.name} = ${b.bg}`).join("; ")}`);
  if (layout.deposit) lines.push(`  deposit row "${layout.deposit.text}": line tops ${layout.deposit.lineTops.join(", ")}; row box ${layout.deposit.row.join(",")}; value "${layout.deposit.valueText}" box ${layout.deposit.value?.join(",") ?? "none"}`);
  return lines;
}

// Issue 04: text under 12px (every visible text node), longest prose line in characters, and the computed sizes.
const TYPE_AUDIT = `(() => {
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
    if (px < 12) small.push(px + 'px "' + node.data.trim().slice(0, 40) + '"');
  }
  const prose = [];
  for (const selector of ['.landing-lede', '.landing-caption__body', '.landing-faq__item > p']) {
    for (const el of document.querySelectorAll(selector)) {
      const perLine = new Map();
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let text;
      while ((text = walk.nextNode())) {
        for (let i = 0; i < text.data.length; i++) {
          const range = document.createRange();
          range.setStart(text, i);
          range.setEnd(text, i + 1);
          const rect = range.getClientRects()[0];
          if (!rect || rect.width === 0) continue;
          const key = Math.round(rect.top);
          perLine.set(key, (perLine.get(key) ?? 0) + 1);
        }
      }
      prose.push({ selector, longest: Math.max(0, ...perLine.values()), text: el.textContent.trim().slice(0, 30) });
    }
  }
  const size = (sel) => { const el = document.querySelector(sel); return el ? parseFloat(getComputedStyle(el).fontSize) : null; };
  const sizes = {
    H1: size('.landing-hero h1'), H2: size('#how-h'), H3: size('.landing-caption > h3'), lede: size('.landing-lede'),
    caption: size('.landing-caption__body'), eyebrow: size('.landing-hero .ui-eyebrow'), faqQuestion: size('.landing-faq__item > summary'),
    faqAnswer: size('.landing-faq__item > p'), bubble: size('.landing-phone .landing-bot'), chip: size('.landing-chip'),
    rail: size('.landing-phone .ui-rail > li'), pain: size('.landing-pain'),
  };
  return { checked, small, prose, sizes, longest: Math.max(0, ...prose.map((p) => p.longest)) };
})()`;

interface TypeAudit {
  readonly checked: number;
  readonly small: readonly string[];
  readonly prose: readonly { readonly selector: string; readonly longest: number; readonly text: string }[];
  readonly sizes: Record<string, number | null>;
  readonly longest: number;
}

function formatType(type: TypeAudit): string[] {
  const lines = [`  text nodes checked: ${type.checked}; text under 12px: ${type.small.length}`];
  for (const entry of type.small) lines.push(`    - ${entry}`);
  lines.push(`  longest prose line: ${type.longest} characters (limit 75)`);
  for (const entry of type.prose) lines.push(`    - ${entry.selector} "${entry.text}...": ${entry.longest}`);
  lines.push(`  sizes (px): ${Object.entries(type.sizes).map(([key, value]) => `${key} ${value}`).join(", ")}`);
  return lines;
}

interface ElementReport {
  readonly tag: string;
  readonly label: string;
  readonly box: string;
}

interface Audit {
  readonly viewport: number;
  readonly documentOverflow: number;
  readonly bodyOverflow: number;
  readonly pastEdge: readonly ElementReport[];
  readonly checked: number;
  readonly small: readonly ElementReport[];
  readonly excludedHiddenInputs: number;
  readonly railBreaks: readonly ElementReport[];
}

// Runs in the page. Visible = laid out and not visibility:hidden (pending stage elements keep space but are invisible).
const AUDIT = `(() => {
  const vw = window.innerWidth;
  const visible = (el) => {
    const cs = getComputedStyle(el);
    return el.getClientRects().length > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
  };
  const describe = (el) => {
    const r = el.getBoundingClientRect();
    const label = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 60);
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '';
    return { tag: el.tagName.toLowerCase() + (cls ? '.' + cls : ''), label, box: Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) };
  };
  const pastEdge = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.right > vw + 0.5 || r.left < -0.5) pastEdge.push(describe(el));
  }
  const railBreaks = [];
  for (const li of document.querySelectorAll('.landing-phone .ui-rail > li')) {
    if (!visible(li)) continue;
    const range = document.createRange();
    range.selectNodeContents(li);
    const tops = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
    if (tops.size > 1 && !/\\s/.test(li.textContent.trim())) railBreaks.push(describe(li));
    // Issue 05: at the narrow frame (container query, 21rem) the non-current labels are clipped on purpose (transparent, max-inline-size 0, aria-hidden rail); only the visible label is audited.
    const clippedOnPurpose = li.dataset.state !== 'current' && getComputedStyle(li).color === 'rgba(0, 0, 0, 0)';
    if (!clippedOnPurpose && li.scrollWidth > li.clientWidth + 0.5) railBreaks.push({ ...describe(li), tag: 'overflowing ' + describe(li).tag });
  }
  const focusable = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [tabindex]:not([tabindex="-1"])';
  const small = [];
  let checked = 0;
  let excludedHiddenInputs = 0;
  for (const el of document.body.querySelectorAll(focusable)) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (el.matches('input[type=radio], input[type=checkbox]') && (r.width <= 1 || r.height <= 1)) { excludedHiddenInputs++; continue; }
    checked++;
    if (r.width < 44 || r.height < 44) small.push(describe(el));
  }
  return {
    viewport: vw,
    documentOverflow: document.documentElement.scrollWidth - vw,
    bodyOverflow: document.body.scrollWidth - vw,
    pastEdge,
    checked,
    small,
    excludedHiddenInputs,
    railBreaks,
  };
})()`;

function formatAudit(audit: Audit): string[] {
  const lines: string[] = [];
  lines.push(`  horizontal overflow (document): ${audit.documentOverflow > 0 ? `${audit.documentOverflow}px FOUND` : "none"}`);
  lines.push(`  horizontal overflow (body): ${audit.bodyOverflow > 0 ? `${audit.bodyOverflow}px FOUND` : "none"}`);
  lines.push(`  elements past the viewport edge: ${audit.pastEdge.length}`);
  for (const element of audit.pastEdge) lines.push(`    - ${element.tag} "${element.label}" at ${element.box}`);
  lines.push(`  visible controls checked: ${audit.checked} (hidden native radio/checkbox inputs excluded: ${audit.excludedHiddenInputs})`);
  lines.push(`  journey rail labels broken mid-word or overflowing: ${audit.railBreaks.length}`);
  for (const element of audit.railBreaks) lines.push(`    - ${element.tag} "${element.label}" at ${element.box}`);
  lines.push(`  controls under 44x44: ${audit.small.length}`);
  for (const element of audit.small) lines.push(`    - ${element.tag} "${element.label}" at ${element.box}`);
  return lines;
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const directory = mkdtempSync(join(tmpdir(), "landing-capture-"));
const environment = LocalGuestEnvironment.openNode({ databasePath: join(directory, "guest.sqlite") });
const server = startLocalGuestServer({ port: 0, environment });
const findings: string[] = [];
let browser: RealBrowserInstance | undefined;
let tabs: RealBrowserTab[] = [];

try {
  const port = await server.listen();
  const base = `http://127.0.0.1:${port}`;
  browser = await launchRealBrowser({ headless: true });

  // Reduced motion: every screen in its final state, light and dark (by cookie), at each width.
  const still = await browser.createTab();
  tabs.push(still);
  await still.setReducedMotion(true);
  // Issue 10: a second tab serves the placeholders:true render through request interception (this harness only).
  let placeholderTheme: "light" | "dark" = "light";
  const placeholderTab = ISSUE10 ? await browser.createTab() : undefined;
  let stopPlaceholders: (() => Promise<void>) | undefined;
  if (placeholderTab) {
    tabs.push(placeholderTab);
    await placeholderTab.setReducedMotion(true);
    stopPlaceholders = await placeholderTab.interceptRequests(async (url) => (url === `${base}/welcome`
      ? { status: 200, headers: [{ name: "Content-Type", value: "text/html; charset=utf-8" }, { name: "Cache-Control", value: "no-store" }], body: new TextEncoder().encode(renderLandingHtml(placeholderTheme, { placeholders: true })) }
      : undefined));
  }
  const shoot = async (theme: "light" | "dark", width: number, name: string, cssWidth: number, cssHeight?: number, shared: RealBrowserTab = still, placeholders = false): Promise<void> => {
    // Harness-only: a second tall screenshot in one tab stalls headless Chrome (CDP captureScreenshot times out), so each still capture gets a fresh tab.
    const fresh = shared === still ? await browser!.createTab() : undefined;
    if (fresh) await fresh.setReducedMotion(true);
    const page = fresh ?? shared;
    try {
    await page.setExtraHeaders({ cookie: `shortlet_theme=${theme}` });
    placeholderTheme = theme;
    const size = (height: number) => (cssWidth < 768 ? page.setViewport(cssWidth, height) : page.setCssViewport(cssWidth, height));
    await size(900);
    await page.navigate(`${base}/welcome`);
    await page.waitForFunction("document.readyState === 'complete'", 10_000);
    await pause(400);
    const height = await page.evaluate<number>("document.documentElement.scrollHeight");
    await size(cssHeight ?? height);
    await pause(300);
    const audit = await page.evaluate<Audit>(AUDIT);
    const type = await page.evaluate<TypeAudit>(TYPE_AUDIT);
    // The hero plays on load only if its phone is at least 35% inside the first viewport (landing-motion PLAY_ENTER_RATIO).
    const hero = await page.evaluate<{ top: number; bottom: number; viewport: number }>(`(() => { const r = document.querySelector('[data-landing-play="hero"]').getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), viewport: window.innerHeight }; })()`);
    findings.push(`  hero phone top ${hero.top}px, bottom ${hero.bottom}px (viewport height ${hero.viewport}px at this capture)`);
    console.log(`about to shoot ${name} height=${height} viewport=${hero.viewport}`);
    writeFileSync(join(out, name), await page.captureScreenshot());
    console.log(`${name}: page height ${height}, document overflow ${audit.documentOverflow}px, controls under 44: ${audit.small.length}, text under 12px: ${type.small.length}, longest line ${type.longest}`);
    findings.push(`theme ${theme}${placeholders ? " (placeholders:true)" : ""} (page height ${height}px)`, ...formatAudit(audit), ...formatType(type));
    if (ISSUE10) findings.push(...formatLayout(await page.evaluate<LayoutProbe>(LAYOUT_PROBE)));
    } finally {
      if (fresh) await fresh.close();
    }
  };
  for (const width of ISSUE10 ? [320, 390, 768, 1280, 1440] : [320, 390, 768, 1280]) {
    findings.push(`== width ${width}px ==`);
    for (const theme of ["light", "dark"] as const) {
      await shoot(theme, width, `landing-${theme}-${width}.png`, width);
    }
    findings.push("");
  }
  if (placeholderTab) {
    for (const width of [390, 1440]) {
      findings.push(`== placeholders:true render, width ${width}px ==`);
      for (const theme of ["light", "dark"] as const) {
        await shoot(theme, width, `landing-placeholders-${theme}-${width}.png`, width, undefined, placeholderTab, true);
      }
      findings.push("");
    }
  }
  // 200% zoom: a 1280 physical-pixel display at 200% has a 640 CSS px viewport. Light and dark.
  findings.push("== 1280 at 200% zoom (640 CSS px) ==");
  for (const theme of ["light", "dark"] as const) {
    await shoot(theme, 640, `landing-${theme}-1280-zoom200.png`, 640);
  }
  findings.push("");

  // Issue 04 review: the first screen on a phone, motion allowed, no scrolling. The hero phone's message box must be inside
  // the first viewport and the hero must have played (its guest message shown) without any scroll.
  findings.push("== first viewport, motion allowed, no scrolling ==");
  for (const [w, h] of [[390, 800], [360, 640], [320, 568]] as const) {
    const first = await browser.createTab();
    tabs.push(first);
    await first.setReducedMotion(false);
    await first.setExtraHeaders({ cookie: "shortlet_theme=light" });
    await first.setViewport(w, h);
    await first.setCssViewport(w, h);
    await first.navigate(`${base}/welcome`);
    await first.waitForSelector(".landing-hero form.landing-composer", 10_000);
    if (w === 360) {
      // The hero's results stage, as it appears: the newest result row is anchored at the bottom of the transcript.
      await first.waitForFunction("document.querySelectorAll('[data-landing-play=\"hero\"] .ui-result-row').length === 2 && !document.querySelector('[data-landing-play=\"hero\"] [data-landing-stage=\"4\"]').classList.contains('landing-pending')", 15_000);
      await pause(900);
      writeFileSync(join(out, "landing-hero-360-results.png"), await first.captureScreenshot());
    }
    await pause(3500);
    const at = await first.evaluate<{ h1Top: number; h1Bottom: number; reassuranceTop: number; reassuranceBottom: number; composerTop: number; composerBottom: number; ctaTop: number; ctaBottom: number; scrollY: number; messageShown: boolean; viewport: number }>(`(() => {
      const c = document.querySelector('.landing-hero form.landing-composer').getBoundingClientRect();
      const cta = document.querySelector('.landing-hero__cta').getBoundingClientRect();
      const h1 = document.querySelector('.landing-hero h1').getBoundingClientRect();
      const reassurance = document.querySelector('.landing-hero__cta .ui-field__hint').getBoundingClientRect();
      return { h1Top: Math.round(h1.top), h1Bottom: Math.round(h1.bottom), reassuranceTop: Math.round(reassurance.top), reassuranceBottom: Math.round(reassurance.bottom), composerTop: Math.round(c.top), composerBottom: Math.round(c.bottom), ctaTop: Math.round(cta.top), ctaBottom: Math.round(cta.bottom), scrollY: window.scrollY, messageShown: !document.querySelector('[data-landing-message]').classList.contains('landing-pending'), viewport: window.innerHeight };
    })()`);
    const inside = at.composerTop >= 0 && at.composerBottom <= h;
    const headlineInside = at.h1Top >= 0 && at.h1Bottom <= h;
    const reassuranceInside = at.reassuranceTop >= 0 && at.reassuranceBottom <= h;
    writeFileSync(join(out, `landing-first-${w}x${h}.png`), await first.captureScreenshot());
    findings.push(`  ${w}x${h}: hero H1 ${at.h1Top}..${at.h1Bottom}px (${headlineInside ? "inside" : "NOT inside"} the first viewport); reassurance ${at.reassuranceTop}..${at.reassuranceBottom}px (${reassuranceInside ? "inside" : "NOT inside"}); hero composer ${at.composerTop}..${at.composerBottom}px (${inside ? "inside" : "NOT inside"} the first viewport); CTA ${at.ctaTop}..${at.ctaBottom}px; scrollY ${at.scrollY}; guest message shown on load: ${at.messageShown}`);
    console.log(`first ${w}x${h}: composer ${at.composerTop}..${at.composerBottom}, inside ${inside}, scrollY ${at.scrollY}, message shown ${at.messageShown}`);
  }
  findings.push("");

  // Issue 10: pinned desktop at steps 2 and 4 (light and dark), each caption centred and its beat active.
  if (ISSUE10) {
    findings.push("== pinned desktop 1280 (motion allowed) ==");
    const pinnedTab = await browser.createTab();
    tabs.push(pinnedTab);
    await pinnedTab.setReducedMotion(false);
    await pinnedTab.setCssViewport(1280, 800);
    for (const step of [2, 4]) {
      for (const theme of ["light", "dark"] as const) {
        await pinnedTab.setExtraHeaders({ cookie: `shortlet_theme=${theme}` });
        await pinnedTab.navigate(`${base}/welcome`);
        await pinnedTab.waitForSelector(".landing-pinned", 10_000);
        await pinnedTab.evaluate(`document.querySelector('[data-landing-caption="${step}"]').scrollIntoView({ block: 'center' })`);
        await pinnedTab.waitForFunction(`document.querySelector('[data-landing-caption="${step}"]').classList.contains('is-active')`, 10_000);
        await pause(2500);
        const pinned = await pinnedTab.evaluate<{ active: string; phoneTop: number; phoneBottom: number; viewport: number }>(`(() => { const p = document.querySelector('.landing-pinned').getBoundingClientRect(); return { active: document.querySelector('[data-landing-caption].is-active')?.dataset.landingCaption ?? '', phoneTop: Math.round(p.top), phoneBottom: Math.round(p.bottom), viewport: window.innerHeight }; })()`);
        writeFileSync(join(out, `landing-pinned-step${step}-1280-${theme}.png`), await pinnedTab.captureScreenshot());
        findings.push(`  step ${step} ${theme}: active caption ${pinned.active}; pinned phone ${pinned.phoneTop}..${pinned.phoneBottom}px of ${pinned.viewport}px viewport`);
        console.log(`pinned step ${step} ${theme}: active ${pinned.active}, phone ${pinned.phoneTop}..${pinned.phoneBottom}`);
      }
    }
    findings.push("");
  }

  // Motion allowed, 1280 wide: beat 3 pinned beside its caption, caption in the middle band.
  const moving = await browser.createTab();
  tabs.push(moving);
  await moving.setReducedMotion(false);
  await moving.setCssViewport(1280, 800);
  await moving.navigate(`${base}/welcome`);
  await moving.waitForSelector(".landing-pinned", 10_000);
  await moving.evaluate(`document.querySelector('[data-landing-caption="3"]').scrollIntoView({ block: 'center' })`);
  await moving.waitForFunction(`document.querySelector('.landing-pinned [data-landing-screen]')?.getAttribute('aria-label') === 'Stay summary before sending the request'`, 10_000);
  await pause(2500);
  const pinnedState = await moving.evaluate<{ pinned: boolean; caption: string; top: number; bottom: number }>(`(() => {
    const phone = document.querySelector('.landing-pinned');
    const caption = document.querySelector('[data-landing-caption="3"]').getBoundingClientRect();
    return { pinned: Boolean(phone), caption: document.querySelector('[data-landing-caption].is-active')?.dataset.landingCaption ?? '', top: caption.top, bottom: caption.bottom };
  })()`);
  writeFileSync(join(out, "landing-pinned-1280.png"), await moving.captureScreenshot());
  console.log(`pinned-1280: ${JSON.stringify(pinnedState)}`);

  // Motion allowed, 1280 wide (issue 09: beats play only in the pinned phone): beat 4 stage 3 while "The Operator is reviewing" shows.
  const reviewing = await browser.createTab();
  tabs.push(reviewing);
  await reviewing.setReducedMotion(false);
  await reviewing.setCssViewport(1280, 800);
  await reviewing.navigate(`${base}/welcome`);
  await reviewing.waitForSelector(".landing-pinned", 10_000);
  await reviewing.evaluate(`document.querySelector('[data-landing-caption="4"]').scrollIntoView({ block: 'center' })`);
  await reviewing.waitForFunction(`(() => { const el = document.querySelector('.landing-pinned [data-landing-only="3"]'); return Boolean(el && !el.hidden && el.getClientRects().length > 0); })()`, 10_000);
  writeFileSync(join(out, "landing-beat4-reviewing-1280.png"), await reviewing.captureScreenshot());
  console.log("beat4-reviewing-1280 captured");

  writeFileSync(join(out, "findings.txt"), `${findings.join("\n")}\n`);
  console.log(`findings written to ${join(out, "findings.txt")}`);
} finally {
  try { await stopPlaceholders?.(); } catch {}
  for (const tab of tabs) {
    try { await tab.close(); } catch {}
  }
  try { await browser?.close(); } catch {}
  try { await server.close(); } catch {}
  rmSync(directory, { recursive: true, force: true });
}
