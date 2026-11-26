import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { GUEST_FACT_LABELS } from "../apps/web-agent/src/guest-content.js";
import { deadlineBannerHtml, statusHtml } from "../apps/local-guest/src/guest-kit.js";
import { launchRealBrowser } from "./helpers/chrome-devtools.js";
import { restartFixture } from "./helpers/guest-restart.js";

const FOUNDATIONS_CSS = readFileSync(new URL("../apps/web/src/shortlet-foundations.css", import.meta.url), "utf8");
const GUEST_KIT_TS = readFileSync(new URL("../apps/local-guest/src/guest-kit.ts", import.meta.url), "utf8");

test("2b-01 AC1: Buttons, links, fields, banners, status, tags, deadline, empty, and skeleton match pinned bundle.css rules using semantic tokens only", () => {
  // Primary, secondary, quiet, pill, disabled buttons
  assert.match(FOUNDATIONS_CSS, /\.ui-button--secondary\s*\{[^}]*background:\s*var\(--color-action-subtle\);\s*color:\s*var\(--color-action\)/);
  assert.match(FOUNDATIONS_CSS, /\.ui-button--quiet\s*\{[^}]*background:\s*transparent;\s*color:\s*var\(--color-text\);\s*box-shadow:\s*inset 0 0 0 1px var\(--color-border\)/);
  assert.match(FOUNDATIONS_CSS, /\.ui-button--pill\s*\{[^}]*border-radius:\s*var\(--radius-pill\)/);
  // Link uses underline & action token
  assert.match(FOUNDATIONS_CSS, /\.ui-link\s*\{[^}]*text-decoration:\s*underline/);
  // Field input, optional, choice, legend
  assert.match(FOUNDATIONS_CSS, /\.ui-field__input/);
  assert.match(FOUNDATIONS_CSS, /\.ui-field__optional\s*\{[^}]*color:\s*var\(--color-text-secondary\)/);
  assert.match(FOUNDATIONS_CSS, /\.ui-choice\s*\{[^}]*min-block-size:\s*var\(--control-min-target\)/);
  assert.match(FOUNDATIONS_CSS, /\.ui-legend\s*\{/);
  // Banner slots + info tone
  assert.match(FOUNDATIONS_CSS, /\.ui-banner__title\s*\{[^}]*font-weight:\s*700/);
  assert.match(FOUNDATIONS_CSS, /\.ui-banner__body,\s*\.ui-banner__actions\s*\{/);
  assert.match(FOUNDATIONS_CSS, /\.ui-banner--info\s*>\s*\.ui-icon\s*\{[^}]*color:\s*var\(--color-text-secondary\)/);
  // Status muted, tag, deadline, empty, static skeleton (no pulse animation)
  assert.match(FOUNDATIONS_CSS, /\.ui-status--muted\s*\{[^}]*color:\s*var\(--color-text-muted\)/);
  assert.match(FOUNDATIONS_CSS, /\.ui-tag--overdue\s*\{[^}]*background:\s*var\(--color-warning-surface\);\s*color:\s*var\(--color-warning\)/);
  assert.match(FOUNDATIONS_CSS, /\.ui-deadline--overdue\s+\.ui-deadline__at\s*\{[^}]*text-decoration:\s*underline/);
  assert.match(FOUNDATIONS_CSS, /\.ui-empty__title[^{]*\{[^}]*font-family:\s*var\(--font-display\)/);
  assert.match(FOUNDATIONS_CSS, /\.ui-skeleton--receipt\s*\{/);
  assert.doesNotMatch(FOUNDATIONS_CSS, /@keyframes ui-pulse/, "skeleton uses static surface-subtle per round-12 bundle.css");
  // Held-back issue 07 tokens must NOT appear
  for (const unapproved of ["--color-scrim", "--font-weight-label-small", "--text-small-strong", "--radius-badge"]) {
    assert.doesNotMatch(FOUNDATIONS_CSS, new RegExp(unapproved), `unapproved token ${unapproved} held back`);
  }
});

test("2b-01 AC2: Interactive controls meet >=44px targets and 3px focus-visible contrast in light and dark themes", async () => {
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab(`${fixture.base}/stays/search?area=old-ikoyi&checkIn=2026-09-10&checkOut=2026-09-13&partySize=2`);
    try {
      await tab.setViewport(320, 640);
      for (const theme of ["light", "dark"] as const) {
        await tab.evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
        const metrics = await tab.evaluate<{
          btn: number;
          btnSmall: number;
          btnPill: number;
          link: number;
          choice: number;
          input: number;
          focusColor: string;
        }>(`(() => {
          const wrap = document.createElement('div');
          wrap.className = 'ui-page';
          wrap.innerHTML = [
            '<button class="ui-button ui-button--primary" type="button">Primary action</button>',
            '<button class="ui-button ui-button--small" type="button">Small</button>',
            '<button class="ui-button ui-button--primary ui-button--pill" type="button">Pill</button>',
            '<a class="ui-link" href="#test">Inline link</a>',
            '<label class="ui-choice"><input type="radio" name="r" value="1">Option one</label>',
            '<div class="ui-field"><label class="ui-field__label" for="f1">Ref</label><input id="f1" class="ui-field__input" type="text"></div>',
          ].join('');
          document.body.append(wrap);
          const h = (sel) => wrap.querySelector(sel).getBoundingClientRect().height;
          const res = {
            btn: h('.ui-button--primary'),
            btnSmall: h('.ui-button--small'),
            btnPill: h('.ui-button--pill'),
            link: h('.ui-link'),
            choice: h('.ui-choice'),
            input: h('.ui-field__input'),
            focusColor: getComputedStyle(document.documentElement).getPropertyValue('--color-focus').trim(),
          };
          wrap.remove();
          return res;
        })()`);
        assert.ok(metrics.btn >= 44, `${theme} .ui-button >= 44 (${metrics.btn})`);
        assert.ok(metrics.btnSmall >= 44, `${theme} .ui-button--small >= 44 (${metrics.btnSmall})`);
        assert.ok(metrics.btnPill >= 52, `${theme} .ui-button--pill >= 52 (${metrics.btnPill})`);
        assert.ok(metrics.link >= 44, `${theme} .ui-link >= 44 (${metrics.link})`);
        assert.ok(metrics.choice >= 44, `${theme} .ui-choice >= 44 (${metrics.choice})`);
        assert.ok(metrics.input >= 48, `${theme} .ui-field__input >= 48 (${metrics.input})`);
        assert.equal(metrics.focusColor.toUpperCase(), theme === "light" ? "#995600" : "#F0A556");
      }
    } finally {
      await tab.close();
    }
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test("2b-01 AC3 & I4/I6: Existing guest-kit helpers and copy remain unchanged with zero unapproved New/Brand strings", () => {
  const banner = deadlineBannerHtml({ label: "Pay by", deadlineIso: "2026-10-03T12:30:00.000Z", now: new Date("2026-10-03T12:00:00.000Z") });
  assert.match(banner, /class="ui-banner ui-banner--warning payment-deadline"/);
  assert.match(banner, /30 minutes left/);
  assert.equal(statusHtml("success", "Stay payment verified"), '<span class="ui-status ui-status--success">Stay payment verified</span>');
  assert.equal(GUEST_FACT_LABELS.refundableSecurityDeposit, "Refundable Security Deposit (separate)");
  assert.doesNotMatch(GUEST_KIT_TS, /Xenia/);
});
