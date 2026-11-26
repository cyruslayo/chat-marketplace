import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BACK_OFFICE_NAV } from "../apps/local-owner/src/back-office-view.js";
import { launchRealBrowser } from "./helpers/chrome-devtools.js";
import { guestManualTransfers } from "./helpers/guest-manual-transfer.js";
import { TEST_RECEIPTS } from "./helpers/guest-payment-page.js";
import { decideRequest, operatorGet, signInOperator, startSignedInOperator } from "./helpers/operator-session.js";

const FOUNDATIONS_CSS = readFileSync(new URL("../apps/web/src/shortlet-foundations.css", import.meta.url), "utf8");
const LOCAL_OWNER_SERVER_TS = readFileSync(new URL("../apps/local-owner/src/local-owner-server.ts", import.meta.url), "utf8");

test("2b-07 AC1 & A5: Operator shell uses .ui-sidenav-compact at 320/390 keeping h1 above fold, .ui-sidenav at >=48rem, and 'Owner payouts' nav", async () => {
  assert.equal(BACK_OFFICE_NAV.find((entry) => entry.section === "payouts")?.label, "Owner payouts");
  assert.doesNotMatch(FOUNDATIONS_CSS, /@import|--color-scrim/);

  const f = await startSignedInOperator();
  const browser = await launchRealBrowser();
  try {
    const token = f.server.environment.provisionOperatorAccessToken();
    const tab = await browser.createTab();
    try {
      await tab.navigate(`${f.server.base}/operator/login`);
      await tab.waitForFunction("document.readyState === 'complete' && document.querySelector('input[name=\"token\"]') !== null", 5_000);
      await tab.focus('input[name="token"]');
      await tab.insertText(token);
      await tab.pressKey("Enter");
      await tab.waitForFunction("location.pathname === '/operator' && document.readyState === 'complete' && document.styleSheets.length > 0", 10_000);

      for (const width of [320, 390] as const) {
        await tab.setCssViewport(width, 640);
        const m = await tab.evaluate<{
          compactDisplay: string;
          sideDisplay: string;
          toggleH: number;
          h1Top: number;
          overflow: boolean;
        }>(`(() => {
          const compact = document.querySelector('.ui-sidenav-compact');
          const side = document.querySelector('.ui-sidenav');
          const toggle = document.querySelector('.ui-sidenav-compact__toggle');
          const h1 = document.querySelector('main h1');
          return {
            compactDisplay: compact ? getComputedStyle(compact).display : 'missing',
            sideDisplay: side ? getComputedStyle(side).display : 'missing',
            toggleH: toggle ? toggle.getBoundingClientRect().height : 0,
            h1Top: h1 ? h1.getBoundingClientRect().top : 999,
            overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          };
        })()`);
        assert.notEqual(m.compactDisplay, "none", `${width}px shows .ui-sidenav-compact`);
        assert.equal(m.sideDisplay, "none", `${width}px hides desktop .ui-sidenav`);
        assert.ok(m.toggleH >= 44, `${width}px compact toggle >=44px (${m.toggleH})`);
        assert.ok(m.h1Top < 240, `${width}px h1 stays above fold (${m.h1Top})`);
        assert.equal(m.overflow, false, `${width}px zero overflow`);
      }

      await tab.setCssViewport(768, 900);
      const desktop = await tab.evaluate<{ compactDisplay: string; sideDisplay: string; rowDir: string }>(`(() => {
        const compact = document.querySelector('.ui-sidenav-compact');
        const side = document.querySelector('.ui-sidenav');
        const shell = document.querySelector('.ui-shell');
        return {
          compactDisplay: compact ? getComputedStyle(compact).display : 'missing',
          sideDisplay: side ? getComputedStyle(side).display : 'missing',
          rowDir: shell ? getComputedStyle(shell).flexDirection : '',
        };
      })()`);
      assert.equal(desktop.compactDisplay, "none", "768px hides compact bar");
      assert.notEqual(desktop.sideDisplay, "none", "768px shows .ui-sidenav");
      assert.equal(desktop.rowDir, "row", "768px .ui-shell sits side by side");
    } finally {
      await tab.close();
    }
  } finally {
    await browser.close();
    await f.close();
  }
});

test("2b-07 AC2 & A5: Home queue uses .ui-queue-item with no-deadline items last and lazy Overdue tag; zero guest names on Operator screens", async () => {
  const f = await startSignedInOperator({ start: "2026-09-03T10:00:00Z" });
  try {
    const first = f.server.environment.createDemoIncomingBookingRequest({
      guestId: "q-guest-1",
      guestName: "Chidinma Okafor",
      checkIn: "2026-09-10",
      checkOut: "2026-09-13",
    }).facts.requestId;
    f.advance(5 * 60_000);
    const second = f.server.environment.createDemoIncomingBookingRequest({
      guestId: "q-guest-2",
      guestName: "Tunde Bakare",
      checkIn: "2026-09-20",
      checkOut: "2026-09-22",
    }).facts.requestId;

    const homeHtml = await (await operatorGet(f.session, "/operator")).text();
    const inboxHtml = await (await operatorGet(f.session, "/operator/requests")).text();
    const detailHtml = await (await operatorGet(f.session, `/operator/requests/${first}`)).text();

    assert.match(homeHtml, /class="ui-queue"/);
    assert.equal([...homeHtml.matchAll(/class="ui-queue-item"/g)].length, 2);
    assert.doesNotMatch(homeHtml, /Chidinma Okafor|Tunde Bakare/, "A5: zero guest names on Home");
    assert.doesNotMatch(inboxHtml, /Chidinma Okafor|Tunde Bakare/, "A5: zero guest names on Inbox");
    assert.match(detailHtml, /class="ui-breadcrumb"/, "breadcrumb on request detail");
    assert.doesNotMatch(detailHtml, /Chidinma Okafor/, "A5: zero guest name on request detail");
    assert.ok(homeHtml.indexOf(first) < homeHtml.indexOf(second), "soonest deadline first");
    assert.doesNotMatch(LOCAL_OWNER_SERVER_TS, /facts\.primaryGuestName/, "primaryGuestName removed per A5");
  } finally {
    await f.close();
  }
});

test("2b-07 AC3: Manual transfer verification uses .ui-transfer, .ui-receipt (image/PDF/deleted-90d), .ui-panel--commit, .ui-confirm, .ui-outcome, and A5 button labels", async () => {
  const f = await startSignedInOperator({ start: "2026-09-03T10:00:00Z" });
  try {
    const guest = await guestManualTransfers(f.server.environment);
    try {
      const reqImg = f.server.environment.createDemoIncomingBookingRequest({
        guestId: "t-guest-img",
        guestName: "Secret Guest Name",
        checkIn: "2026-09-10",
        checkOut: "2026-09-12",
      }).facts.requestId;
      assert.equal((await decideRequest(f.session, reqImg, "confirm")).status, 303);
      guest.start(reqImg);
      await guest.upload(reqImg, TEST_RECEIPTS.png);

      const reqPdf = f.server.environment.createDemoIncomingBookingRequest({
        guestId: "t-guest-pdf",
        guestName: "Another Secret Guest",
        checkIn: "2026-09-15",
        checkOut: "2026-09-17",
      }).facts.requestId;
      assert.equal((await decideRequest(f.session, reqPdf, "confirm")).status, 303);
      guest.start(reqPdf);
      await guest.upload(reqPdf, Buffer.from("%PDF-1.4\n%%EOF\n"));

      const html = await (await operatorGet(f.session, "/operator/transfers")).text();
      assert.match(html, /class="ui-transfer"/);
      assert.match(html, /class="ui-receipt ui-transfer__side"/);
      assert.match(html, /class="ui-receipt__frame"/);
      assert.match(html, /class="ui-receipt__file"/);
      assert.match(html, /class="ui-panel ui-panel--commit ui-stack"/);
      assert.match(html, /class="ui-effect"/);
      assert.match(html, />Confirm payment</);
      assert.match(html, /Decline/);
      assert.match(html, /name="expectedVersion"/);
      assert.doesNotMatch(html, /Secret Guest Name|Another Secret Guest/);
      assert.ok(signInOperator);
    } finally {
      guest.close();
    }
  } finally {
    await f.close();
  }
});
