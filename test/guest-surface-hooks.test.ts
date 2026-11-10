import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { contactFieldAttributes } from "../apps/local-guest/src/contact-field.js";
import { FOCUSED_SURFACE_KINDS, guestSurfaceKindFor } from "../apps/local-guest/src/shortlet-app.js";
import { coldApp, PHONE, SCRIPT, STAY_TEXT, successOf, tap } from "./helpers/assistant-cold-journey-harness.js";
import { datedFixture, firstButtonAction, LIVE_LIKE_CLOCK, scriptedPlanner } from "./helpers/guest-date-fixtures.js";

// Issue 19 (ADR 0074, 0081, 0106): the server declares the surface kind and contact purpose; the client reads them
// instead of guessing from an id prefix or a label.

test("AC1: Every guest surface type carries an explicit kind, and the client reads it instead of the id", () => {
  assert.equal(guestSurfaceKindFor({ surfaceId: "thread-x:discovery:1", kind: "payment" }), "payment");
  assert.equal(guestSurfaceKindFor({ surfaceId: "thread-x:payment:1" }), "payment", "the server still classifies its own id");
  for (const kind of ["unit-detail", "request-draft", "booking", "payment", "contact"] as const) assert.equal(FOCUSED_SURFACE_KINDS.has(kind), true);
  const client = readFileSync("apps/local-guest/src/client.ts", "utf8");
  assert.match(client, /surface\.kind === "unit-detail"/, "the client mode reads the declared kind");
  assert.doesNotMatch(client, /activeWorkspace\.dataset\.surfaceKind = surface\.surfaceId\.includes/, "the client no longer guesses the kind from the id");
});

test("AC2: The phone and email fields get tel/email inputmode and autocomplete from their declared purpose, not their label text", () => {
  assert.deepEqual(contactFieldAttributes("phone"), { type: "tel", inputMode: "tel", autocomplete: "tel" });
  assert.deepEqual(contactFieldAttributes("email"), { type: "email", inputMode: "email", autocomplete: "email" });
  const client = readFileSync("apps/local-guest/src/client.ts", "utf8");
  assert.match(client, /enhanceGuestContactField\(mount, surface\.contactPurpose\)/);
  assert.match(client, /contactFieldAttributes\(kind\)/);
  assert.doesNotMatch(client, /\^phone number/i, "the client no longer reads the label text");
});

test("AC3: Changing a surface id prefix or a field label does not change the enhancement", () => {
  // An explicit kind wins over any id, so a renamed prefix keeps the same placement.
  assert.equal(guestSurfaceKindFor({ surfaceId: "thread-x:renamed:1", kind: "booking" }), "booking");
  // The declared purpose wins over any label; the helper never sees the label.
  assert.equal(contactFieldAttributes("email").type, "email");
});

test("AC4: Kinds and purposes survive a cold restore", async () => {
  const f = datedFixture(scriptedPlanner(SCRIPT).client, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const threadId = "g-d1a0000601";
    const search = successOf(await f.app.handleTurn(threadId, STAY_TEXT), "search");
    assert.equal(search.surfaces[0]?.kind, "discovery");
    const detail = await tap(f, threadId, search.surfaces[0]!, "View");
    assert.equal(detail.surfaces[0]?.kind, "unit-detail");
    const draft = await tap(f, threadId, detail.surfaces[0]!, "Request to Book");
    assert.equal(draft.surfaces[0]?.kind, "request-draft");
    const phoneAsk = await tap(f, threadId, draft.surfaces[0]!, "Review request");
    assert.equal(phoneAsk.surfaces[0]?.kind, "contact");
    assert.equal(phoneAsk.surfaces[0]?.contactPurpose, "phone");

    const restored = coldApp(f, threadId);
    const state = restored.getState(threadId);
    assert.ok(state);
    assert.equal(state.surfaces[0]?.kind, "contact");
    assert.equal(state.surfaces[0]?.contactPurpose, "phone");
    // Saving the phone still works with the declared purpose after the restore.
    const save = firstButtonAction(phoneAsk.surfaces[0]!);
    successOf(await restored.handleEventAsync(threadId, { ...save, context: { ...save.context, contactValue: PHONE } }), "Save phone number");
  } finally {
    f.close();
  }
});
