import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { breakdownHtml, priceBreakdownHtml, stayTicketHtml, stepsHtml, ticketHtml, unitTilesHtml } from "../apps/local-guest/src/guest-kit.js";
import { GUEST_FACT_LABELS } from "../apps/web-agent/src/guest-content.js";
import { launchRealBrowser } from "./helpers/chrome-devtools.js";
import { restartFixture } from "./helpers/guest-restart.js";

const FOUNDATIONS_CSS = readFileSync(new URL("../apps/web/src/shortlet-foundations.css", import.meta.url), "utf8");
const GUEST_KIT_TS = readFileSync(new URL("../apps/local-guest/src/guest-kit.ts", import.meta.url), "utf8");

test("2b-03 AC1 & I2/I3: Ticket, price breakdown (--band), tiles, and steps (--compact) match bundle.css with semantic tokens only", () => {
  assert.match(FOUNDATIONS_CSS, /\.ui-ticket__eyebrow\s*\{[^}]*letter-spacing:\s*0\.14em;\s*text-transform:\s*uppercase;\s*color:\s*var\(--color-accent-on-inverse\)/);
  assert.match(FOUNDATIONS_CSS, /\.ui-ticket\s*:focus-visible\s*\{[^}]*outline-color:\s*var\(--color-accent-on-inverse\)/);
  assert.match(FOUNDATIONS_CSS, /\.ui-price-breakdown--band\s*\{[^}]*border-block-start:\s*1px dashed var\(--color-accent-on-inverse\)/);
  assert.match(FOUNDATIONS_CSS, /\.ui-price-breakdown--band\s+\.ui-price-breakdown__condition\s*\{[^}]*box-shadow:\s*inset 0 0 0 1px var\(--color-accent-on-inverse\)/);
  assert.match(FOUNDATIONS_CSS, /\.ui-steps--compact\s*>\s*li\s*\{/);
  assert.match(FOUNDATIONS_CSS, /\.ui-steps__number\s*\{[^}]*font-family:\s*var\(--font-display\)/);
  assert.doesNotMatch(FOUNDATIONS_CSS, /--radius-badge|--font-weight-label-small|--color-scrim/);

  const ticket = ticketHtml({
    title: "3B Terrace, Ikoyi",
    checkIn: { day: "10", date: "Thu, 10 Sept 2026" },
    checkOut: { day: "13", date: "Sun, 13 Sept 2026" },
    foot: "3 nights · 2 guests",
  });
  assert.match(ticket, /<p class="ui-ticket__eyebrow">Your stay<\/p>/);
  assert.match(ticket, /class="ui-ticket__label">Check-in<\/span>/);
  assert.match(ticket, /class="ui-ticket__label">Check-out<\/span>/);

  const band = breakdownHtml({ condition: "If your request is accepted", total: "₦370,000", due: "₦370,000", band: true });
  assert.match(band, /class="ui-price-breakdown ui-price-breakdown--band"/);
  assert.doesNotMatch(band, /ui-panel ui-price-breakdown--band/);

  const compactSteps = stepsHtml(["Step one", "Step two"], { compact: true });
  assert.match(compactSteps, /class="ui-steps ui-steps--compact"/);
});

test("2b-03 AC2 & I4: Zero-deposit quotes omit deposit line; non-zero keeps '(separate)'; existing copy untouched", () => {
  const zero = priceBreakdownHtml({ allInStayTotalKobo: 370_000_00, refundableSecurityDepositKobo: 0, amountDueNowKobo: 370_000_00 });
  assert.doesNotMatch(zero, /Refundable Security Deposit/);

  const withDeposit = priceBreakdownHtml({ allInStayTotalKobo: 370_000_00, refundableSecurityDepositKobo: 50_000_00, amountDueNowKobo: 420_000_00 });
  assert.match(withDeposit, /Refundable Security Deposit \(separate\)/);
  assert.doesNotMatch(GUEST_KIT_TS, /Refundable Security Deposit, separate/);
  assert.equal(GUEST_FACT_LABELS.refundableSecurityDeposit, "Refundable Security Deposit (separate)");
});

test("2b-03 AC3: Every ₦ figure in ticket band/breakdown uses Newsreader (--font-display) and ticket focus uses sand accent", async () => {
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab(`${fixture.base}/stays/search?area=old-ikoyi&checkIn=2026-09-10&checkOut=2026-09-13&partySize=2`);
    try {
      await tab.waitForFunction("document.readyState === 'complete' && document.styleSheets.length > 0", 5_000);
      await tab.setCssViewport(320, 640);
      const html = [
        `<section class="ui-ticket" aria-label="Your stay">`,
        `<p class="ui-ticket__eyebrow">Your stay</p>`,
        `<h2 class="ui-ticket__name">Test Loft</h2>`,
        `<div class="ui-ticket__dates"><div class="ui-ticket__date"><span class="ui-ticket__label">Check-in</span><span class="ui-ticket__day">10</span><time>Thu, 10 Sept 2026</time></div></div>`,
        `<p class="ui-ticket__foot">3 nights · 2 guests</p>`,
        priceBreakdownHtml({ heading: "If your request is accepted", allInStayTotalKobo: 370_000_00, refundableSecurityDepositKobo: 0, amountDueNowKobo: 370_000_00, band: true }),
        `</section>`,
        unitTilesHtml([{ icon: "bed", text: "2 bedrooms" }, { icon: "bath", text: "2 baths" }, { icon: "users", text: "Up to 4 guests" }]),
        stepsHtml(["Operator checks availability."], { compact: true }),
      ].join("");

      for (const theme of ["light", "dark"] as const) {
        await tab.evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
        const check = await tab.evaluate<{ totalFont: string; dueFont: string; overflow: boolean }>(`(() => {
          const wrap = document.createElement('div');
          wrap.className = 'ui-page';
          wrap.innerHTML = ${JSON.stringify(html)};
          document.body.append(wrap);
          const totalFont = getComputedStyle(wrap.querySelector('.ui-money-total')).fontFamily;
          const dueFont = getComputedStyle(wrap.querySelector('.ui-price-breakdown__due .ui-price-breakdown__value')).fontFamily;
          const overflow = document.documentElement.scrollWidth > document.documentElement.clientWidth;
          wrap.remove();
          return { totalFont, dueFont, overflow };
        })()`);
        assert.match(check.totalFont, /Newsreader/, `${theme} money-total uses Newsreader`);
        assert.match(check.dueFont, /Newsreader/, `${theme} due value uses Newsreader`);
        assert.equal(check.overflow, false, `${theme} 320px zero overflow`);
      }
      assert.ok(stayTicketHtml({ unitTitle: "A", checkIn: "2026-09-10", checkOut: "2026-09-13", nights: 3, guestCount: 2 }));
    } finally {
      await tab.close();
    }
  } finally {
    await browser.close();
    await fixture.close();
  }
});
