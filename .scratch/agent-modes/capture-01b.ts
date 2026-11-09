// Issue 01b evidence: the Agent Mark in its moments (empty state, in-flight turn, reply) and the presence dock beside an open workspace,
// at 320/390/768/1280, light and dark. Reports horizontal overflow, controls under 44px, mark facts (aria-hidden, not focusable, running
// animations) and the state sequence of the app-bar mark during a reply. Copied from .scratch/guest-ui-consistency/capture-11.ts.
// Run one group per process: npx tsx .scratch/agent-modes/capture-01b.ts [empty|flight|reply|split]...
import { mkdirSync, writeFileSync } from "node:fs";
import { launchRealBrowser, type RealBrowserTab } from "../../test/helpers/chrome-devtools.js";
import { startHeldTurnServer } from "../../test/helpers/agent-mark-fixture.js";
import { restartFixture } from "../../test/helpers/guest-restart.js";
import { GUEST_MODES } from "../../apps/web-agent/src/guest-content.js";

const out = ".scratch/agent-modes/screenshots/01b";
mkdirSync(out, { recursive: true });
const only = process.argv.slice(2);
const wanted = (name: string) => only.length === 0 || only.includes(name);
const WIDTHS = [320, 390, 768, 1280] as const;
const THEMES = ["light", "dark"] as const;
const SEARCH = "I need an apartment in Ikoyi from 10 Sept for 3 nights for 2 people";
const TURN = "I need a place in Ikoyi for 4 nights for 2 guests";
const WORKING_COPY = GUEST_MODES.stays.workspace.workingStatus;
const findings: string[] = [];
const sleep = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms); });

// Same rule as capture-11.ts: every control on the page at under 44px, hidden inputs and the skip link excluded.
const SMALL = `[...document.querySelectorAll('a, button, input, select, textarea, summary')].filter((el) => { if (el.type === 'hidden' || el.type === 'file' || el.closest('[hidden]') || el.classList.contains('skip-link') || el.classList.contains('sr-only')) return false; const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && (r.height < 43.5 || r.width < 43.5); }).map((el) => (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 28) + ' ' + Math.round(el.getBoundingClientRect().width) + 'x' + Math.round(el.getBoundingClientRect().height))`;

// Every mark: placement, state, aria-hidden, whether it is focusable or inside a control, its size and its running animations.
const MARKS = `[...document.querySelectorAll('[data-agent-mark]')].map((el) => ({ placement: el.dataset.agentMark, state: el.dataset.agentState, ariaHidden: el.getAttribute('aria-hidden'), focusable: el.matches('a,button,input,select,textarea,[tabindex]') || el.closest('a,button') !== null, width: Math.round(el.getBoundingClientRect().width), height: Math.round(el.getBoundingClientRect().height), running: el.getAnimations().filter((a) => a.playState === 'running').length, displayed: getComputedStyle(el.closest('#agent-dock') || el).display !== 'none' }))`;

async function shoot(tab: RealBrowserTab, name: string, options: { readonly fixedHeight?: boolean } = {}): Promise<void> {
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      const size = (height: number) => (width < 768 ? tab.setViewport(width, height) : tab.setCssViewport(width, height));
      await size(900);
      await tab.evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
      await tab.evaluate("document.fonts.ready.then(() => true)");
      await sleep(250);
      if (!options.fixedHeight) await size(Math.min(4000, Math.max(800, await tab.evaluate<number>("document.documentElement.scrollHeight"))));
      const { overflow, small, marks, dock } = await tab.evaluate<{ overflow: number; small: string[]; marks: unknown[]; dock: unknown }>(`({
        overflow: document.documentElement.scrollWidth - innerWidth,
        small: ${SMALL},
        marks: ${MARKS},
        dock: (() => { const d = document.getElementById('agent-dock'); if (!d) return null; const r = d.getBoundingClientRect(); const w = document.getElementById('active-workspace'); const c = document.getElementById('composer'); const wr = w && !w.hidden ? w.getBoundingClientRect() : null; const cr = c ? c.getBoundingClientRect() : null; const overlap = (a, b) => !!a && !!b && a.width > 0 && b.width > 0 && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom; return { hidden: d.hidden, display: getComputedStyle(d).display, width: Math.round(r.width), height: Math.round(r.height), overlapsWorkspace: overlap(r, wr), overlapsComposer: overlap(r, cr) }; })(),
      })`);
      const label = `${name}-${theme}-${width}`;
      if (overflow > 0) findings.push(`${label}: horizontal overflow ${overflow}px`);
      if (small.length) findings.push(`${label}: controls under 44px: ${small.join(" | ")}`);
      findings.push(`${label}: marks ${JSON.stringify(marks)}`);
      if (dock) findings.push(`${label}: dock ${JSON.stringify(dock)}`);
      writeFileSync(`${out}/${label}.png`, await tab.captureScreenshot());
    }
  }
  console.log(`captured ${name}`);
}

async function sendMessage(tab: RealBrowserTab, text: string): Promise<void> {
  await tab.focus("#composer-input");
  await tab.insertText(text);
  await tab.pressKey("Enter");
}

const browser = await launchRealBrowser();
try {
  // Empty state: the hero mark, idle, no turn in flight.
  if (wanted("empty")) {
    const fixture = await startHeldTurnServer();
    try {
      const tab = await browser.createTab();
      await tab.setReducedMotion(false);
      await tab.navigate(`${fixture.base}/`);
      await tab.waitForSelector('[data-agent-mark="hero"]', 15_000);
      await tab.waitForFunction("document.readyState === 'complete'", 10_000);
      await shoot(tab, "empty", { fixedHeight: true });
      await tab.close();
    } finally {
      await fixture.close();
    }
  }

  // In flight: the dock and the thinking mark. The turn is held 40 s; the shots wait past the 4.8 s thinking loop so the mark is in its still form.
  if (wanted("flight")) {
    const fixture = await startHeldTurnServer(40_000);
    try {
      const tab = await browser.createTab();
      await tab.setReducedMotion(false);
      await tab.navigate(`${fixture.base}/`);
      await tab.waitForSelector("#composer-input", 15_000);
      await sendMessage(tab, TURN);
      await tab.waitForFunction("!document.getElementById('agent-dock').hidden", 10_000);
      await sleep(5_500);
      await shoot(tab, "flight", { fixedHeight: true });
      await tab.close();
    } finally {
      await fixture.close();
    }
  }

  // Reply: a 300 ms turn. The app-bar mark's state sequence is recorded from a MutationObserver, then the settled idle form is shot.
  if (wanted("reply")) {
    const fixture = await startHeldTurnServer(300);
    try {
      const tab = await browser.createTab();
      await tab.setReducedMotion(false);
      await tab.navigate(`${fixture.base}/`);
      await tab.waitForSelector("#composer-input", 15_000);
      await tab.evaluate(`(() => {
        window.__markLog = [];
        new MutationObserver((records) => { for (const record of records) { const el = record.target; if (el.dataset && el.dataset.agentMark) window.__markLog.push([el.dataset.agentMark, el.dataset.agentState]); } })
          .observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-agent-state'] });
      })()`);
      await sendMessage(tab, TURN);
      await tab.waitForFunction("document.getElementById('working-status').hidden === true && document.querySelector('[data-agent-mark=\"appbar\"]').dataset.agentState === 'idle'", 20_000);
      await sleep(600);
      const sequence = await tab.evaluate<string[]>("window.__markLog.filter((entry) => entry[0] === 'appbar').map((entry) => entry[1]).filter((state, index, all) => index === 0 || all[index - 1] !== state)");
      findings.push(`reply: app-bar mark state sequence ${sequence.join(" -> ")}`);
      await shoot(tab, "reply", { fixedHeight: true });
      await tab.close();
    } finally {
      await fixture.close();
    }
  }

  // Desktop split: a real search opens the workspace. The in-flight dock is forced by setting the same attributes setLoading sets (a
  // real turn beside a workspace completes too quickly to shoot); the CSS rule that hides the dock is what is under test.
  if (wanted("split")) {
    const fixture = await restartFixture();
    try {
      const tab = await browser.createTab();
      await tab.setReducedMotion(false);
      await tab.navigate(`${fixture.base}/`);
      await tab.waitForSelector("#composer-input", 15_000);
      await sendMessage(tab, SEARCH);
      await tab.waitForSelector("#active-workspace .stay-card", 15_000);
      await tab.waitForFunction("document.getElementById('working-status').hidden === true", 15_000);
      await tab.evaluate(`(() => {
        const dock = document.getElementById('agent-dock');
        dock.hidden = false;
        dock.querySelector('.agent-dock__chip').textContent = ${JSON.stringify(WORKING_COPY)};
        for (const el of document.querySelectorAll('[data-agent-mark]')) el.setAttribute('data-agent-state', 'thinking');
      })()`);
      await sleep(5_500);
      await shoot(tab, "split", { fixedHeight: true });
      await tab.close();
    } finally {
      await fixture.close();
    }
  }
} finally {
  await browser.close();
}
writeFileSync(`${out}/findings-${only.length ? only.join("-") : "all"}.txt`, `${findings.join("\n")}\n`);
console.log(findings.filter((line) => /overflow|under 44px|sequence|dock \{/.test(line)).join("\n") || "no overflow and no controls under 44px");
process.exit(0);
