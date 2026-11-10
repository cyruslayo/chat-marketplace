// Monthly-stays issue 17 AC7: the standalone Notice to End confirmation step and the recorded notice at 320, 390, 768 and
// 1280, light and dark, with overflow and 44px target checks (ADR 0078). Synthetic demo data only; Paystack TEST is stubbed.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createGuestRequestHandler, GUEST_COMMERCE_COMPOSITION } from "../../apps/local-guest/src/guest-server.js";
import { SqliteCheckInSupportStore } from "../../domains/shortlet/src/checkin-support.js";
import { openNodeSqliteDatabase } from "../../packages/platform-core/src/node-sqlite-database.js";
import { addDays, extendUnit, withDemoExtendedJourney, type DemoJourneyContext } from "../../test/helpers/demo-extended-journey.js";
import { launchRealBrowser } from "../../test/helpers/chrome-devtools.js";
import type { Unit } from "../../domains/shortlet/src/browse.js";

const CHECK_IN = "2026-09-10";
const CHECK_OUT = addDays(CHECK_IN, 180);
const PERIOD_1_STARTED = `${CHECK_IN}T10:00:00.000Z`;
const WIDTHS = [320, 390, 768, 1280];
const directory = ".scratch/guest-ui-consistency/screenshots/17";
mkdirSync(directory, { recursive: true });

function unitWithTerms(seeded: Unit): Unit {
  return extendUnit(seeded, { claimsThrough: CHECK_OUT });
}

await withDemoExtendedJourney({ unit: unitWithTerms, checkIn: CHECK_IN, checkOut: CHECK_OUT }, async (context: DemoJourneyContext) => {
  const session = context.guest.cardPaymentApp.getCheckoutSession(context.offerId)!;
  const confirmed = await context.guest.cardPaymentApp.verifyAndConfirmPaystack(session.pspReference, { id: "synthetic-system", role: "system", tenantId: context.guest.config.tenantId });
  assert.equal(confirmed.outcome, "confirmed", "the Extended Stay is confirmed");
  context.setClock(PERIOD_1_STARTED);
  const contract = context.guest.cardPaymentApp.getBookingContract(context.offerId)!;
  const database = openNodeSqliteDatabase(context.databasePath);
  try {
    new SqliteCheckInSupportStore(database).save(contract.reservationId, {
      schedule: null, window: null, evidence: [],
      result: { reservationId: contract.reservationId, status: "verified_access", verifiedAt: PERIOD_1_STARTED, protectionWindowStartsAt: PERIOD_1_STARTED },
      complaints: [],
    });
  } finally {
    database.close();
  }

  const handler = createGuestRequestHandler({
    environment: context.guest,
    commerce: GUEST_COMMERCE_COMPOSITION.disabled,
    landingBinaryAssets: { read: () => new Uint8Array([1]) },
  });
  const server: Server = createServer((req, res) => { void handler.handle(req, res); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const home = await fetch(`${base}/`);
  const cookie = (home.headers.get("set-cookie") ?? "").split(";")[0]!;
  assert.ok(cookie, "a guest session cookie is issued");
  const path = `/bookings/notice/${encodeURIComponent(context.offerId)}`;

  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setExtraHeaders({ cookie });
    const shoot = async (name: string, selector: string) => {
      for (const theme of ["light", "dark"]) {
        for (const width of WIDTHS) {
          await tab.setViewport(width, 900);
          await tab.navigate(`${base}${path}`);
          await tab.waitForSelector(selector, 10_000);
          await tab.waitForFunction("document.readyState === 'complete'", 10_000);
          await tab.evaluate("document.fonts.ready.then(() => true)");
          await tab.evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
          const height = await tab.evaluate<number>(`Math.max(document.documentElement.scrollHeight, document.querySelector(${JSON.stringify(selector)}).scrollHeight + 240)`);
          await tab.setViewport(width, Math.min(4000, height));
          assert.equal(await tab.evaluate<boolean>("document.documentElement.scrollWidth <= innerWidth"), true, `${name}/${theme}/${width}: overflow`);
          const small = await tab.evaluate<unknown[]>(`[...document.querySelectorAll(${JSON.stringify(`${selector} button, ${selector} a`)})].filter(el => el.getBoundingClientRect().width && (el.getBoundingClientRect().height < 44 || el.getBoundingClientRect().width < 44)).map(el => el.textContent)`);
          assert.deepEqual(small, [], `${name}/${theme}/${width}: target under 44px`);
          writeFileSync(`${directory}/${name}-${theme}-${width}.png`, await tab.captureScreenshot());
          console.log(`${name}/${theme}/${width}: overflow and 44px targets pass`);
        }
      }
    };
    // The confirmation step, before notice is given.
    await shoot("notice-step", "[data-notice-step]");
    // Give notice (the page's own commit, through the domain), then the recorded state.
    context.guest.noticeToEnd.giveNotice(contract.contractId, context.guest.guestPrincipal());
    await shoot("notice-recorded", "[data-notice-recorded]");
  } finally {
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
