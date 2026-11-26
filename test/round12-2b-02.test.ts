import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { railHtml } from "../apps/local-guest/src/guest-kit.js";
import { projectJourney } from "../apps/local-guest/src/journey-rail.js";
import { appBarHtml } from "../apps/web/src/ui-kit.js";
import { launchRealBrowser } from "./helpers/chrome-devtools.js";
import { restartFixture } from "./helpers/guest-restart.js";

const FOUNDATIONS_CSS = readFileSync(new URL("../apps/web/src/shortlet-foundations.css", import.meta.url), "utf8");
const GUEST_KIT_TS = readFileSync(new URL("../apps/local-guest/src/guest-kit.ts", import.meta.url), "utf8");
const CLIENT_TS = readFileSync(new URL("../apps/local-guest/src/client.ts", import.meta.url), "utf8");

test("2b-02 AC1 & AC2: App bar fits one row at 320px with >=44px targets and trims height at 320x568 without losing targets", async () => {
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab(`${fixture.base}/stays/search?area=old-ikoyi&checkIn=2026-09-10&checkOut=2026-09-13&partySize=2`);
    try {
      await tab.waitForFunction("document.readyState === 'complete' && document.styleSheets.length > 0", 5_000);
      await tab.setCssViewport(320, 640);
      const wideBar = await tab.evaluate<{
        brandDisplay: string;
        actionRect: { height: number; width: number; top: number };
        helpRect: { height: number; width: number; top: number };
        modeRect: { top: number; height: number };
        barHeight: number;
      }>(`(() => {
        const host = document.createElement('div');
        host.className = 'ui-page';
        host.setAttribute('data-mode', 'stays');
        host.innerHTML = [
          '<header class="ui-appbar">',
          '  <a class="ui-appbar__action" href="#back" aria-label="Back to results">B</a>',
          '  <a class="ui-appbar__brand" href="/">Shortlet</a>',
          '  <span class="ui-mode-label"><span class="ui-mode-label__mark"></span><span class="ui-mode-label__prefix">Concierge · </span><span class="ui-mode-label__mode">Stays</span></span>',
          '  <span class="ui-appbar__grow"></span>',
          '  <a class="ui-appbar__action ui-appbar__help" href="#help" aria-label="Help">?<span class="ui-appbar__label">Help</span></a>',
          '</header>',
        ].join('');
        document.body.append(host);
        const bar = host.querySelector('.ui-appbar');
        const brand = host.querySelector('.ui-appbar__brand');
        const back = host.querySelector('.ui-appbar__action');
        const help = host.querySelector('.ui-appbar__help');
        const mode = host.querySelector('.ui-mode-label');
        const r = (el) => { const b = el.getBoundingClientRect(); return { height: b.height, width: b.width, top: b.top }; };
        const res = {
          brandDisplay: getComputedStyle(brand).display,
          actionRect: r(back),
          helpRect: r(help),
          modeRect: r(mode),
          barHeight: bar.getBoundingClientRect().height,
        };
        host.remove();
        return res;
      })()`);
      assert.equal(wideBar.brandDisplay, "none", "at <=23rem after Back, wordmark hides so mode label & Help stay on one row");
      assert.ok(wideBar.actionRect.height >= 44 && wideBar.actionRect.width >= 44, "back target >=44x44");
      assert.ok(wideBar.helpRect.height >= 44 && wideBar.helpRect.width >= 44, "help target >=44x44");
      assert.ok(Math.abs(wideBar.actionRect.top - wideBar.helpRect.top) < 12, "controls sit on one row");

      // AC2: Short-phone height (320x568) trims bar height cleanly while keeping controls >=44px.
      await tab.setCssViewport(320, 568);
      const shortBar = await tab.evaluate<{ barHeight: number; backHeight: number }>(`(() => {
        const host = document.createElement('div');
        host.className = 'ui-page ui-app';
        host.innerHTML = '<header class="ui-appbar"><a class="ui-appbar__action" href="#back" aria-label="Back">B</a><a class="ui-appbar__brand" href="/">Shortlet</a></header>';
        document.body.append(host);
        const res = {
          barHeight: host.querySelector('.ui-appbar').getBoundingClientRect().height,
          backHeight: host.querySelector('.ui-appbar__action').getBoundingClientRect().height,
        };
        host.remove();
        return res;
      })()`);
      assert.ok(shortBar.barHeight <= 56, `short-phone app bar trims height (${shortBar.barHeight} <= 56)`);
      assert.ok(shortBar.backHeight >= 44, `short-phone action keeps >=44px target (${shortBar.backHeight})`);
    } finally {
      await tab.close();
    }
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test("2b-02 AC3 & I6: Journey rail shows compact 'Step N of 6 · <step>' below 40rem and full 6-step .ui-rail at 40rem+, across kit and client", async () => {
  const offerRail = railHtml(projectJourney("offer"));
  assert.match(offerRail, /class="ui-rail-nav__compact"/);
  assert.match(offerRail, /Step 4 of 6/);
  assert.match(offerRail, /Offer/);
  assert.match(offerRail, /class="ui-rail-nav__bar"/);

  const failedRail = railHtml(projectJourney("request", { kind: "declined", label: "Request declined" }));
  assert.match(failedRail, /Step 3 of 6/);
  assert.match(failedRail, /Request declined/);
  assert.match(failedRail, /is-failed/);

  // Real Chromium check at 390px (<40rem) vs 768px (>=40rem) on live chat and server railHtml
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab(`${fixture.base}/`);
    try {
      await tab.waitForFunction("document.readyState === 'complete' && document.styleSheets.length > 0", 5_000);
      await tab.setCssViewport(390, 844);
      await tab.focus("#composer-input");
      await tab.insertText("I need an apartment in Ikoyi from 10 Sept for 3 nights for 2 people");
      await tab.pressKey("Enter");
      await tab.waitForFunction("document.querySelector('#journey-rail .ui-rail-nav__compact')?.textContent?.includes('Search') === true", 15_000);
      const mobile = await tab.evaluate<{ compactVisible: boolean; fullDisplay: string; compactText: string; firstChildText: string | null }>(`(() => {
        const compact = document.querySelector('#journey-rail .ui-rail-nav__compact');
        const full = document.querySelector('#journey-rail .ui-rail');
        const cur = document.querySelector('#journey-rail [aria-current="step"]');
        return {
          compactVisible: compact !== null && getComputedStyle(compact).display !== 'none',
          fullDisplay: full ? getComputedStyle(full).display : 'missing',
          compactText: compact?.textContent?.trim() ?? '',
          firstChildText: cur?.firstChild?.textContent ?? null,
        };
      })()`);
      assert.equal(mobile.compactVisible, true, "compact rail is visible at 390px");
      assert.equal(mobile.fullDisplay, "none", "full 6-step rail is hidden below 40rem");
      assert.match(mobile.compactText, /^Step 1 of 6\s*·\s*Search/);
      assert.equal(mobile.firstChildText, "Search", "step label text remains firstChild of aria-current step");

      await tab.setCssViewport(768, 900);
      const desktop = await tab.evaluate<{ compactDisplay: string; fullDisplay: string }>(`(() => {
        const compact = document.querySelector('#journey-rail .ui-rail-nav__compact');
        const full = document.querySelector('#journey-rail .ui-rail');
        return {
          compactDisplay: compact ? getComputedStyle(compact).display : 'missing',
          fullDisplay: full ? getComputedStyle(full).display : 'missing',
        };
      })()`);
      assert.equal(desktop.compactDisplay, "none", "compact rail hides at >=40rem");
      assert.notEqual(desktop.fullDisplay, "none", "full rail shows at >=40rem");

      // Also verify View apartment advances compact & full rail label to Stay
      await tab.setCssViewport(390, 844);
      await tab.clickButton("View apartment");
      await tab.waitForFunction("document.querySelector('#journey-rail [aria-current=\"step\"]')?.firstChild?.textContent === 'Stay'", 15_000);
      const stayText = await tab.evaluate<string>("document.querySelector('#journey-rail .ui-rail-nav__compact')?.textContent?.trim() ?? ''");
      assert.match(stayText, /^Step 2 of 6\s*·\s*Stay/);
    } finally {
      await tab.close();
    }
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test("2b-02 I2 & I4: No unapproved tokens (--color-scrim) or unapproved New copy added", () => {
  assert.doesNotMatch(FOUNDATIONS_CSS, /--color-scrim/);
  assert.match(FOUNDATIONS_CSS, /\.ui-dialog::backdrop/);
  assert.doesNotMatch(GUEST_KIT_TS, /\/plans|\/help|Close \{task\}/);
  assert.doesNotMatch(CLIENT_TS, /\/plans|\/help/);
  assert.match(appBarHtml({ backHref: "/", backLabel: "Back to your conversation" }), />Shortlet</);
});
