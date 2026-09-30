import assert from "node:assert/strict";
import test from "node:test";
import { withRequestScreen } from "./helpers/guest-request-screen.js";
import { withStagePage } from "./helpers/guest-stage-pages.js";

test('AC2: before acceptance, the breakdown carries the "If your request is accepted" tag, and it never does on an offer or later screen', async () => {
  for (const state of ["draft", "review", "sent", "declined", "expired"] as const) {
    await withRequestScreen(state, async (fixture, path) => {
      const html = await (await fetch(`${fixture.base}${path}`, { headers: { cookie: fixture.cookie } })).text();
      assert.match(html, /ui-price-breakdown__condition[^>]*>If your request is accepted/);
    });
  }
  for (const stage of ["offer", "payment-ready", "confirmed"] as const) {
    await withStagePage({ label: stage, stage }, async ({ fixture, path }) => {
      const html = await (await fetch(`${fixture.base}${path}`, { headers: { cookie: fixture.cookie } })).text();
      assert.doesNotMatch(html, /ui-price-breakdown__condition/);
    });
  }
});

test("AC4: a declined or expired request shows the failed rail step and both actions; Find other stays keeps the Guest's criteria", async () => {
  for (const state of ["declined", "expired"] as const) {
    await withRequestScreen(state, async (fixture, path) => {
      const html = await (await fetch(`${fixture.base}${path}`, { headers: { cookie: fixture.cookie } })).text();
      assert.match(html, /data-step="request" data-state="failed"/);
      assert.match(html, /Find other stays/);
      assert.match(html, /Back to your conversation/);
      const response = await fetch(`${fixture.base}${path}/search`, { method: "POST", headers: { cookie: fixture.cookie, origin: fixture.base }, redirect: "manual" });
      assert.equal(response.status, 303);
      const params = new URL(response.headers.get("location")!, fixture.base).searchParams;
      assert.equal(params.get("location"), "Lagos");
      assert.equal(params.get("neighbourhood"), "Old Ikoyi");
      assert.equal(params.get("checkIn"), "2026-09-10");
      assert.equal(params.get("checkOut"), "2026-09-13");
      assert.equal(params.get("partySize"), "2");
    });
  }
});

test("AC5: request form posts reject missing, foreign, stale and cross-origin authority without submitting a request", async () => {
  await withRequestScreen("draft", async (fixture, path) => {
    const rejectedHeaders: Record<string, string>[] = [{}, { cookie: "shortlet_guest_session=foreign" }, { cookie: fixture.cookie, origin: "https://foreign.example" }];
    for (const headers of rejectedHeaders) {
      const response = await fetch(`${fixture.base}${path}/review`, { method: "POST", headers, redirect: "manual" });
      assert.ok([401, 403].includes(response.status));
    }
    for (const action of ["review", "submit"]) {
      const response = await fetch(`${fixture.base}${path}/${action}`, { method: "POST", headers: { cookie: fixture.cookie, origin: fixture.base, "content-type": "application/x-www-form-urlencoded" }, body: "", redirect: "manual" });
      assert.equal(response.status, 409);
    }
    assert.equal(fixture.environment.interactionStore.listBookingRequestIds().length, 0);
    const html = await (await fetch(`${fixture.base}${path}`, { headers: { cookie: fixture.cookie } })).text();
    const draftSurface = /name="surfaceId" value="([^"]+)"/.exec(html)?.[1];
    assert.ok(draftSurface);
    const post = (action: string, surfaceId: string) => fetch(`${fixture.base}${path}/${action}`, {
      method: "POST", headers: { cookie: fixture.cookie, origin: fixture.base, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ surfaceId }), redirect: "manual",
    });
    assert.equal((await post("submit", draftSurface)).status, 409, "cannot bypass review");
    assert.equal((await post("review", draftSurface)).status, 303);
    assert.equal((await post("review", draftSurface)).status, 409, "old draft form loses authority");
    const review = await (await fetch(`${fixture.base}${path}`, { headers: { cookie: fixture.cookie } })).text();
    const reviewSurface = /name="surfaceId" value="([^"]+)"/.exec(review)?.[1];
    assert.ok(reviewSurface);
    assert.equal((await post("submit", draftSurface)).status, 409, "old surface cannot submit");
    assert.equal((await post("submit", reviewSurface)).status, 303);
    assert.equal((await post("submit", reviewSurface)).status, 409, "duplicate submission creates no second request");
    assert.equal(fixture.environment.interactionStore.listBookingRequestIds().length, 1);
    const historicalDraft = await (await fetch(`${fixture.base}${path}`, { headers: { cookie: fixture.cookie } })).text();
    assert.match(historicalDraft, /type="submit" disabled/, "historical draft retains its readable page but disables material authority");
  });
});
