import assert from "node:assert/strict";
import test from "node:test";
import { withStagePage, railSteps } from "./helpers/guest-stage-pages.js";

const readPage = async (
  fixture: Parameters<Parameters<typeof withStagePage>[1]>[0]["fixture"],
  path: string,
) =>
  (
    await fetch(`${fixture.base}${path}`, {
      headers: { cookie: fixture.cookie },
    })
  ).text();

test("AC2: the offer deadline shows absolute WAT and remaining minutes from its payment window; lazy expiry renders at or after the deadline", async () => {
  await withStagePage(
    { label: "Offer", stage: "offer" },
    async ({ fixture, path }) => {
      let html = await readPage(fixture, path);
      assert.match(html, /offer-screen/);
      assert.match(html, /Pay by.*WAT/);
      assert.match(html, /20 minutes left/);
      fixture.setTime("2026-09-03T10:19:00Z");
      html = await readPage(fixture, path);
      assert.match(html, /1 minute left/);
      for (const time of ["2026-09-03T10:20:00Z", "2026-09-03T10:20:01Z"]) {
        fixture.setTime(time);
        html = await readPage(fixture, path);
        assert.match(html, /data-offer-state="expired"/);
        assert.match(html, /The deadline was.*WAT/);
        assert.doesNotMatch(html, /Accept and pay/);
      }
    },
  );
});

test("AC3: an expired offer has a failed rail step, no accept action and both navigation actions; posting accept after expiry is refused", async () => {
  await withStagePage(
    { label: "Expired offer", stage: "offer" },
    async ({ fixture, path }) => {
      const current = await fixture.state();
      assert.equal(current.ok, true);
      const surfaceId = current.surfaces[0]!.surfaceId;
      fixture.setTime("2026-09-03T10:20:00Z");
      const html = await readPage(fixture, path);
      assert.ok(
        railSteps(html).some(
          ([step, state]) => step === "offer" && state === "failed",
        ),
      );
      assert.match(html, /data-offer-state="expired"/);
      assert.match(html, /Back to your conversation/);
      assert.match(html, /Find other stays/);
      assert.doesNotMatch(html, /Accept and pay/);
      const response = await fetch(`${fixture.base}${path}/accept`, {
        method: "POST",
        headers: {
          cookie: fixture.cookie,
          "content-type": "application/x-www-form-urlencoded",
          accept: "text/html",
        },
        body: new URLSearchParams({ surfaceId }),
        redirect: "manual",
      });
      assert.equal(response.status, 409);
      const offerId = decodeURIComponent(path.split("/").at(-1)!);
      assert.equal(
        fixture.environment.conditionalOfferApp.manager.getOffer(offerId)
          .status,
        "issued",
        "projection expiry grants no acceptance",
      );
      const recovery = await fetch(`${fixture.base}${path}/search`, {
        method: "POST",
        headers: { cookie: fixture.cookie },
        redirect: "manual",
      });
      assert.equal(recovery.status, 303);
      assert.match(
        recovery.headers.get("location") ?? "",
        /checkIn=2026-09-10/,
      );
    },
  );
});

test("AC5: native offer acceptance fails closed for missing, duplicate, stale and cross-origin authority", async () => {
  await withStagePage(
    { label: "Offer", stage: "offer" },
    async ({ fixture, path }) => {
      const state = await fixture.state();
      assert.equal(state.ok, true);
      const surfaceId = state.surfaces[0]!.surfaceId;
      for (const body of [
        "",
        "surfaceId=wrong",
        `surfaceId=${encodeURIComponent(surfaceId)}&surfaceId=${encodeURIComponent(surfaceId)}`,
      ]) {
        const response = await fetch(`${fixture.base}${path}/accept`, {
          method: "POST",
          headers: {
            cookie: fixture.cookie,
            "content-type": "application/x-www-form-urlencoded",
          },
          body,
          redirect: "manual",
        });
        assert.equal(response.status, 409);
      }
      const foreign = await fetch(`${fixture.base}${path}/accept`, {
        method: "POST",
        headers: {
          cookie: fixture.cookie,
          origin: "https://untrusted.invalid",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ surfaceId }),
        redirect: "manual",
      });
      assert.equal(foreign.status, 403);
    },
  );
});
