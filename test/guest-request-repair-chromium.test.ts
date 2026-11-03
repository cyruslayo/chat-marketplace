import assert from "node:assert/strict";
import test from "node:test";
import { withRequestScreen } from "./helpers/guest-request-screen.js";
import { launchRealBrowser } from "./helpers/chrome-devtools.js";
import { withStagePage } from "./helpers/guest-stage-pages.js";

const surface = (html: string) => /name="surfaceId" value="([^"]+)"/.exec(html)![1]!;

test("AC1: each editable review fact has a direct edit path with valid facts retained; a superseded draft cannot submit", async () => {
  await withRequestScreen("review", async (fixture, path) => {
    const get = async (route: string) => (await fetch(`${fixture.base}${route}`, { headers: { cookie: fixture.cookie } })).text();
    const html = await get(path);
    assert.match(html, /Edit dates/); assert.match(html, /Edit guests/); assert.match(html, /Edit phone number/);
    const post = (route: string, fields: Record<string, string>) => fetch(`${fixture.base}${route}`, { method: "POST", headers: { cookie: fixture.cookie, origin: fixture.base }, body: new URLSearchParams(fields), redirect: "manual" });
    const fields = { surfaceId: surface(html), checkIn: "2026-09-10", checkOut: "2026-09-14", partySize: "2" };
    assert.equal((await post(`${path}/edit`, { ...fields, checkOut: "2026-09-09" })).status, 400);
    assert.match(await get(path), /Named Primary/);
    const saved = await post(`${path}/edit`, fields);
    assert.equal(saved.status, 303);
    let destination = saved.headers.get("location")!;
    assert.match(await get(destination), /Named Primary/);
    assert.match(await get(destination), /2026-09-14/);
    assert.ok([404, 409].includes((await post(`${path}/submit`, { surfaceId: surface(html) })).status));
    assert.equal(fixture.environment.guestContactApp.get(fixture.environment.guestPrincipal())?.phoneNumber, "+2348012345678");
    const guestEdit = await post(`${destination}/edit`, { ...fields, surfaceId: surface(await get(destination)), partySize: "3" });
    assert.equal(guestEdit.status, 303);
    destination = guestEdit.headers.get("location")!;
    assert.match(await get(destination), /3 guests/);
    assert.match(await get(destination), /Named Primary/);
    await fixture.restart();
    assert.match(await get(destination), /2026-09-14/);
  }, { guestName: "Named Primary" });
});

test("AC2: phone entry uses plain guidance and a specific error, preserves failure values, and restores review after correction", async () => {
  await withRequestScreen("review", async (fixture, path) => {
    const route = `/guest/contact?kind=phone&returnTo=${encodeURIComponent(path)}`;
    const get = await fetch(`${fixture.base}${route}`, { headers: { cookie: fixture.cookie } });
    const html = await get.text();
    assert.doesNotMatch(html, /E\.164/);
    assert.match(html, /0801 234 5678/);
    const revision = /name="expectedRevision" value="(\d+)"/.exec(html)![1]!;
    const post = (phoneNumber: string) => fetch(`${fixture.base}/guest/contact/phone`, { method: "POST", headers: { cookie: fixture.cookie, origin: fixture.base }, body: new URLSearchParams({ phoneNumber, expectedRevision: revision, returnTo: path }), redirect: "manual" });
    const failed = await post("08012");
    assert.equal(failed.status, 400);
    const error = await failed.text();
    assert.match(error, /value="08012"/); assert.match(error, /Enter a Nigerian mobile number, such as 0801 234 5678/);
    const foreign = await fetch(`${fixture.base}/guest/contact/phone`, { method: "POST", headers: { cookie: fixture.cookie, origin: fixture.base }, body: new URLSearchParams({ phoneNumber: "0801 234 5678", expectedRevision: revision, returnTo: "https://example.invalid/" }), redirect: "manual" });
    assert.equal(foreign.status, 409, "external return cannot save contact or redirect");
    const saved = await post("0801 234 5678");
    assert.equal(saved.status, 303); assert.equal(saved.headers.get("location"), path);
  });
  await withRequestScreen("draft", async (fixture, path) => {
    const headers = { cookie: fixture.cookie, origin: fixture.base };
    const draft = await (await fetch(`${fixture.base}${path}`, { headers })).text();
    const ask = await fetch(`${fixture.base}${path}/review`, { method: "POST", headers, body: new URLSearchParams({ surfaceId: surface(draft) }), redirect: "manual" });
    const contactPath = ask.headers.get("location")!;
    assert.match(contactPath, /returnTo=/);
    const contact = await (await fetch(`${fixture.base}${contactPath}`, { headers })).text();
    const revision = /name="expectedRevision" value="(\d+)"/.exec(contact)![1]!;
    const save = await fetch(`${fixture.base}/guest/contact/phone`, { method: "POST", headers, body: new URLSearchParams({ phoneNumber: "0801 234 5678", expectedRevision: revision, returnTo: path }), redirect: "manual" });
    assert.equal(save.status, 303);
    const review = await (await fetch(`${fixture.base}${save.headers.get("location")!}`, { headers })).text();
    assert.match(review, /Submit Booking Request/);
    assert.equal(fixture.environment.interactionStore.listBookingRequestIds().length, 0);
  }, { initialGuestPhoneNumber: null, initialGuestContactEmail: null });
});

test("AC3: screen-reader output announces each step number once across request, waiting, offer, payment, and confirmation; terms stay visible", async () => {
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    for (const stage of ["review", "pending", "offer", "payment-ready", "confirmed"] as const) {
      await withStagePage({ label: stage, stage }, async ({ fixture, path }) => {
        await tab.setExtraHeaders({ cookie: fixture.cookie });
        for (const route of [path, `/?threadId=${fixture.threadId}`]) {
        await tab.navigate(`${fixture.base}${route}`);
        await tab.waitForSelector(".ui-steps", 15000);
        await tab.waitForFunction("document.readyState === 'complete'", 15000);
        const ax = await tab.getAccessibilityTree();
        const numbers = ax.filter(node => node.role === "StaticText" && /^[1-9]$/.test(node.name));
        const count = await tab.evaluate<number>("document.querySelectorAll('.ui-steps > li').length");
        assert.equal(numbers.length, count, `${stage}: ${JSON.stringify(numbers)}`);
        assert.equal(ax.filter(node => node.role === "ListMarker" && /^\d/.test(node.name)).length, 0, `${stage}: duplicate native markers`);
        if (stage === "review") assert.match(await tab.getContent(), /Cancellation terms/);
        }
      });
    }
  } finally { await browser.close(); }
});
