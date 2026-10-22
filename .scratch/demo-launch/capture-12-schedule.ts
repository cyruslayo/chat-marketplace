import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { startLocalGuestServer } from "../../apps/local-guest/src/guest-server.js";
import { launchRealBrowser } from "../../test/helpers/chrome-devtools.js";
import { addDays, extendUnit, withDemoExtendedJourney } from "../../test/helpers/demo-extended-journey.js";
import type { Unit } from "../../domains/shortlet/src/browse.js";

// Demo-launch issue 12 AC4 capture: the Guest's Billing Period schedule after period 1 is paid and period 2 is payable,
// on a synthetic 180-night demo stay, in light and dark at 320/390/768/1280. Stubbed Paystack TEST; one process only.
const output = ".scratch/demo-launch/screenshots/12";
mkdirSync(output, { recursive: true });
const CHECK_IN = "2026-09-10";
const CHECK_OUT = addDays(CHECK_IN, 180);
const PERIOD_1_STARTED = `${CHECK_IN}T10:00:00.000Z`;
const findings: string[] = [];
const smallTargets = `[...document.querySelectorAll('a, button, input, select, textarea, summary')].filter((el) => { if (el.type === 'hidden' || el.closest('[hidden]')) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44); }).map((el) => el.tagName + ':' + (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40))`;

await withDemoExtendedJourney({ unit: (seeded: Unit) => extendUnit(seeded, { claimsThrough: CHECK_OUT }), checkIn: CHECK_IN, checkOut: CHECK_OUT }, async (context) => {
  const first = context.guest.cardPaymentApp.getCheckoutSession(context.offerId)!;
  await context.guest.cardPaymentApp.verifyAndConfirmPaystack(first.pspReference, { id: "synthetic-system", role: "system", tenantId: context.guest.config.tenantId });
  context.setClock(PERIOD_1_STARTED);
  const server = startLocalGuestServer({ environment: context.guest, port: 0 } as never);
  const base = `http://127.0.0.1:${await server.listen()}`;
  const home = await fetch(base);
  const cookie = (home.headers.get("set-cookie") ?? "").split(";")[0]!;
  await home.text();
  assert.ok(cookie.includes("shortlet_guest_session="), "a guest session cookie");
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setExtraHeaders({ cookie });
    await tab.setViewport(1280, 900);
    await tab.navigate(`${base}/bookings/periods/${encodeURIComponent(context.offerId)}`);
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    const text = await tab.evaluate<string>("document.body.innerText");
    assert.ok(text.includes("Payment schedule"), "the schedule page renders");
    assert.ok(text.includes("Payable now."), "period 2 is shown as payable");
    for (const theme of ["light", "dark"] as const) {
      for (const width of [320, 390, 768, 1280]) {
        await tab.setViewport(width, 900);
        await tab.evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
        await new Promise((resolve) => setTimeout(resolve, 300));
        const height = await tab.evaluate<number>("document.documentElement.scrollHeight");
        await tab.setViewport(width, Math.min(4_000, Math.max(800, height)));
        const audit = await tab.evaluate<{ overflow: number; small: string[] }>(`({ overflow: document.documentElement.scrollWidth - innerWidth, small: ${smallTargets} })`);
        const label = `period-schedule-${theme}-${width}`;
        if (audit.overflow > 0) findings.push(`${label}: horizontal overflow ${audit.overflow}px`);
        if (audit.small.length > 0) findings.push(`${label}: controls below 44px (${audit.small.length}) ${audit.small.slice(0, 3).join(" | ")}`);
        writeFileSync(`${output}/${label}.png`, await tab.captureScreenshot());
      }
    }
    writeFileSync(`${output}/findings-schedule.txt`, findings.length === 0 ? "No horizontal overflow or controls below 44px.\n" : `${findings.join("\n")}\n`);
    console.log(`schedule capture done. Findings: ${findings.length}`);
  } finally {
    await browser.close();
    await server.close?.();
  }
});
