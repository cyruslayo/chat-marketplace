import test from "node:test";
const R = new URL("../../../", import.meta.url).href;
const { addDays, extendUnit, withDemoExtendedJourney } = await import(R + "test/helpers/demo-extended-journey.ts");
const { SqliteCheckInSupportStore } = await import(R + "domains/shortlet/src/checkin-support.ts");
const { openNodeSqliteDatabase } = await import(R + "packages/platform-core/src/node-sqlite-database.ts");
const CI = "2026-09-10", CO = addDays(CI, 180), P1 = `${CI}T10:00:00.000Z`;
test("after a Notice to End, can a later Billing Period still be paid?", async () => {
  await withDemoExtendedJourney({ unit: (s: any) => extendUnit(s, { claimsThrough: CO }), checkIn: CI, checkOut: CO }, async (c: any) => {
    const sys = { id: "synthetic-system", role: "system", tenantId: c.guest.config.tenantId };
    const s1 = c.guest.cardPaymentApp.getCheckoutSession(c.offerId);
    await c.guest.cardPaymentApp.verifyAndConfirmPaystack(s1.pspReference, sys);
    c.setClock(P1);
    const contract = () => c.guest.cardPaymentApp.getBookingContract(c.offerId);
    const db = openNodeSqliteDatabase(c.databasePath); new SqliteCheckInSupportStore(db).save(contract().reservationId, { schedule: null, window: null, evidence: [], result: { reservationId: contract().reservationId, status: "verified_access", verifiedAt: P1, protectionWindowStartsAt: P1 }, complaints: [] }); db.close();
    const r = c.guest.noticeToEnd.giveNotice(contract().contractId, c.guest.guestPrincipal());
    console.log("NOTICE new last night:", r.newLastNight, "| contract checkout now:", contract().dates.checkOut, "| periods still in quote:", contract().quote.billingPeriods.length);
    console.log("SCHEDULE:", c.guest.cardPaymentApp.projectBillingPeriods(c.offerId).map((p: any) => p.periodIndex + ":" + p.status).join(" "));
    try { const s2 = await c.guest.cardPaymentApp.initializePeriodPaystackCheckout(c.offerId, 2, c.guest.guestPrincipal()); console.log("PERIOD 2 START: allowed, amount kobo", s2.amountKobo);
      const v = await c.guest.cardPaymentApp.verifyAndConfirmPaystack(s2.pspReference, sys); console.log("PERIOD 2 VERIFY:", v.outcome); } catch (e: any) { console.log("PERIOD 2 refused:", e.message); }
    console.log("SCHEDULE after:", c.guest.cardPaymentApp.projectBillingPeriods(c.offerId).slice(0, 3).map((p: any) => p.periodIndex + ":" + p.status).join(" "));
    c.setClock(`${addDays(CI, 20)}T10:00:00.000Z`);
    console.log("SCHEDULE after the new last night:", c.guest.cardPaymentApp.projectBillingPeriods(c.offerId).slice(0, 3).map((p: any) => p.periodIndex + ":" + p.status).join(" "));
  });
});
