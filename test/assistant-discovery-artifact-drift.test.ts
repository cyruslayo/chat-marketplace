import assert from "node:assert/strict";
import test from "node:test";
import { CRITERIA_EDIT_EVENT, type GuestTurnResult } from "../apps/local-guest/src/shortlet-app.js";
import { assertOk, openChipDriver, stagingGuest } from "./helpers/assistant-chip-session.js";
import { firstButtonAction, LIVE_LIKE_CLOCK, scriptedPlanner } from "./helpers/guest-date-fixtures.js";

// Staging defect (9 Nov 2026): after an area-only search the guest set dates with the "When" chip, was asked for the party size,
// tapped the offered "Just me" chip, then tapped View apartment on the card already on screen. Both taps returned
// ARTIFACT_MISMATCH ("The action does not match the authoritative artifact."). ADR 0106: an id the guest holds is never re-minted.

const THREAD = "g-d1a0000901";
const AREA_TEXT = "Somewhere in Old Ikoyi, Lagos";
const SCRIPT = {
  [AREA_TEXT]: { slots: { city: "Lagos", neighbourhood: "Old Ikoyi" }, search: { city: "Lagos", neighbourhood: "Old Ikoyi" } },
  // The live classifier sees "Just me" with no prior question and answers unclear.
  "Just me": { slots: {}, scope: "unclear" as const },
};

function discoveryCard(result: GuestTurnResult) {
  assert.equal(result.ok, true, result.ok ? "" : `${result.code}: ${result.message}`);
  if (!result.ok) throw new Error("unreachable");
  const card = result.surfaces.find((surface) => /:discovery:/.test(surface.surfaceId));
  assert.ok(card, "the area search shows a discovery card");
  return card;
}

for (const cold of [false, true]) {
  const mode = cold ? "cold" : "warm";

  test(`(${mode}) View on the card on screen still opens the unit after a When chip edit that only asks for guests`, async () => {
    const environment = stagingGuest();
    try {
      const driver = openChipDriver(environment, scriptedPlanner(SCRIPT).client, { cold, threadId: THREAD });
      const card = discoveryCard(await driver.typed(AREA_TEXT));
      const edit = await driver.chip(CRITERIA_EDIT_EVENT, { field: "when", checkIn: "2026-11-12", nights: 6 });
      assertOk(edit, "when chip");
      const view = firstButtonAction(card);
      assert.equal(view.name, "shortlet.discovery.view-unit");
      const opened = await driver.step().app.handleEventAsync(THREAD, { ...view, timestamp: LIVE_LIKE_CLOCK().toISOString() });
      assert.equal(opened.ok, true, opened.ok ? "" : `View after the When chip: ${opened.code} ${opened.message}`);
    } finally { environment.close(); }
  });

  test(`(${mode}) View on the card on screen still opens the unit after the guest taps "Just me"`, async () => {
    const environment = stagingGuest();
    try {
      const driver = openChipDriver(environment, scriptedPlanner(SCRIPT).client, { cold, threadId: THREAD });
      const card = discoveryCard(await driver.typed(AREA_TEXT));
      assertOk(await driver.chip(CRITERIA_EDIT_EVENT, { field: "when", checkIn: "2026-11-12", nights: 6 }), "when chip");
      const justMe = await driver.typed("Just me");
      assertOk(justMe, "Just me");
      const view = firstButtonAction(card);
      const opened = await driver.step().app.handleEventAsync(THREAD, { ...view, timestamp: LIVE_LIKE_CLOCK().toISOString() });
      assert.equal(opened.ok, true, opened.ok ? "" : `View after Just me: ${opened.code} ${opened.message}`);
    } finally { environment.close(); }
  });
}

const NEW_AREA_TEXT = "Actually Lekki Phase 1 instead";
const FAIL_CLOSED_SCRIPT = {
  ...SCRIPT,
  [NEW_AREA_TEXT]: { slots: { city: "Lagos", neighbourhood: "Lekki Phase 1" }, search: { city: "Lagos", neighbourhood: "Lekki Phase 1" } },
};

for (const cold of [false, true]) {
  const mode = cold ? "cold" : "warm";

  test(`(${mode}) a forged discovery artifact id still fails closed with ARTIFACT_MISMATCH after "Just me"`, async () => {
    const environment = stagingGuest();
    try {
      const driver = openChipDriver(environment, scriptedPlanner(FAIL_CLOSED_SCRIPT).client, { cold, threadId: THREAD });
      const card = discoveryCard(await driver.typed(AREA_TEXT));
      assertOk(await driver.chip(CRITERIA_EDIT_EVENT, { field: "when", checkIn: "2026-11-12", nights: 6 }), "when chip");
      assertOk(await driver.typed("Just me"), "Just me");
      const view = firstButtonAction(card);
      const forged = await driver.step().app.handleEventAsync(THREAD, { ...view, context: { ...view.context, artifactId: "search_forged" } });
      assert.equal(forged.ok, false);
      assert.equal(forged.ok ? "" : forged.code, "ARTIFACT_MISMATCH");
    } finally { environment.close(); }
  });

  test(`(${mode}) a new planner search retires the earlier card: its View fails closed and the new card's View opens`, async () => {
    const environment = stagingGuest();
    try {
      const driver = openChipDriver(environment, scriptedPlanner(FAIL_CLOSED_SCRIPT).client, { cold, threadId: THREAD });
      const oldCard = discoveryCard(await driver.typed(AREA_TEXT));
      const newCard = discoveryCard(await driver.typed(NEW_AREA_TEXT));
      const old = await driver.step().app.handleEventAsync(THREAD, firstButtonAction(oldCard));
      assert.equal(old.ok, false);
      // The new search also retires the old surface, so the guard refuses it before the artifact check (the client refreshes on this code).
      assert.equal(old.ok ? "" : old.code, "STALE_SURFACE");
      const fresh = await driver.step().app.handleEventAsync(THREAD, firstButtonAction(newCard));
      assert.equal(fresh.ok, true, fresh.ok ? "" : `${fresh.code} ${fresh.message}`);
    } finally { environment.close(); }
  });
}
