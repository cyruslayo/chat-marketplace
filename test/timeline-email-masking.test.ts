import assert from "node:assert/strict";
import test from "node:test";
import { datedFixture, firstButtonAction, LIVE_LIKE_CLOCK, scriptedPlanner } from "./helpers/guest-date-fixtures.js";
import { coldApp, PHONE, SCRIPT, STAY_TEXT, successOf, tap, type Surface } from "./helpers/assistant-cold-journey-harness.js";
import { readLaneRows } from "./helpers/lane-event-fixtures.js";

// Issue 03n (ADR 0093 email and general interaction state, ADR 0075 one redaction chokepoint, ADR 0106 cold restore, ADR 0107
// decision 11). A guest's typed email in the chat timeline is stored masked: the in-memory lane, the persisted `guest_threads`
// timeline and the lane rows. Turns the assistant manages (a stay search) write no guest text to the timeline, so the typed
// email here is a turn the assistant hands to the shell (a greeting-style turn). The contact records keep the real address
// through the structured email surface. Every event after the first is a cold restore (a new application over the same store),
// on the staging-like clock (27 Oct 2026) and with a staging-like guest (no seeded phone or email).

const EMAIL = "ada.lovelace@example.test";
const MASK = "[REDACTED]";
const EMAIL_TURN = `My email is ${EMAIL}`;
const MASKED_EMAIL_TURN = `My email is ${MASK}`;

interface TimelineEntry { readonly role: string; readonly text: string }

/**
 * The timeline the guest store holds for the thread: its lane rows, in seq order (issue 03h: the projection no longer carries a
 * timeline, so the rows are the persisted timeline).
 */
function persistedTimeline(f: ReturnType<typeof datedFixture>, threadId: string): readonly TimelineEntry[] {
  const record = f.environment.interactionStore.findThread(threadId);
  if (!record) throw new Error(`thread ${threadId} is not persisted`);
  return readLaneRows(f.databasePath!, threadId).sort((left, right) => left.seq - right.seq).map((row) => ({ role: row.role, text: row.textRedacted }));
}

/** Every serialised surface, lane row and stored projection a guest can read back for a thread. */
function readableText(f: ReturnType<typeof datedFixture>, threadId: string, surfaces: readonly Surface[]): string {
  const rows = readLaneRows(f.databasePath!, threadId).map((row) => row.textRedacted);
  const stored = f.environment.interactionStore.findThread(threadId)?.threadJson ?? "";
  return JSON.stringify({ surfaces: surfaces.map((surface) => surface.a2uiMessages), rows, stored });
}

test("AC1: A timeline entry containing a typed email stores the masked form in the in-memory lane and the persisted timeline, and a cold restore returns the masked form", async () => {
  const f = datedFixture(scriptedPlanner(SCRIPT).client, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const threadId = "g-7e57a0000401";
    successOf(await f.app.handleTurn(threadId, EMAIL_TURN), "typed email turn");
    const live = f.app.getState(threadId)?.timeline ?? [];
    assert.ok(live.some((entry) => entry.role === "user" && entry.text === MASKED_EMAIL_TURN), "the in-memory lane holds the masked user entry");
    assert.equal(JSON.stringify(live).includes(EMAIL), false, "the in-memory lane never holds the plaintext email");
    assert.equal(JSON.stringify(persistedTimeline(f, threadId)).includes(EMAIL), false, "the persisted timeline holds no plaintext email");

    const restored = coldApp(f, threadId).getState(threadId);
    assert.ok(restored, "the conversation is readable after a cold restore");
    assert.ok(restored.timeline.some((entry) => entry.role === "user" && entry.text === MASKED_EMAIL_TURN), "a cold restore returns the masked user entry");
    assert.equal(JSON.stringify(restored.timeline).includes(EMAIL), false, "a cold restore never returns the plaintext email");
  } finally { f.close(); }
});

test("AC2: The same entry written to guest_thread_lane_events keeps the existing 03e rule: the row text is masked and holds no plaintext email", async () => {
  const f = datedFixture(scriptedPlanner(SCRIPT).client, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const threadId = "g-7e57a0000402";
    successOf(await f.app.handleTurn(threadId, EMAIL_TURN), "typed email turn");
    const rows = readLaneRows(f.databasePath!, threadId);
    const userRow = rows.find((row) => row.role === "user");
    assert.ok(userRow, "the user entry is written as a lane row");
    assert.equal(userRow.textRedacted, MASKED_EMAIL_TURN, "the lane row holds the mask in place of the address");
    assert.equal(rows.some((row) => row.textRedacted.includes(EMAIL)), false, "no lane row holds the plaintext email");
  } finally { f.close(); }
});

test("AC3: The typed email still reaches the contact record and the payment handoff unmasked through the structured email surface, after the masked chat turn", async () => {
  const f = datedFixture(scriptedPlanner(SCRIPT).client, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const threadId = "g-7e57a0000403";
    const search = successOf(await f.app.handleTurn(threadId, STAY_TEXT), "search");
    successOf(await coldApp(f, threadId).handleTurn(threadId, EMAIL_TURN), "typed email turn");
    const detail = await tap(f, threadId, search.surfaces[0]!, "View");
    const draft = await tap(f, threadId, detail.surfaces[0]!, "Request to Book");
    const phoneAsk = await tap(f, threadId, draft.surfaces[0]!, "Review request");
    const phoneSave = firstButtonAction(phoneAsk.surfaces[0]!);
    const saved = successOf(await coldApp(f, threadId).handleEventAsync(threadId, { ...phoneSave, context: { ...phoneSave.context, contactValue: PHONE } }), "Save phone number");
    const sent = await tap(f, threadId, saved.surfaces[0]!, "Send booking request");
    f.environment.simulateOperatorAcceptance(sent.surfaces[0]!.surfaceId.split(":").at(-1)!);
    const offer = coldApp(f, threadId).getState(threadId);
    assert.ok(offer, "the conversation is readable after acceptance");
    const payment = await tap(f, threadId, offer.surfaces[0]!, "Accept offer");
    const checkout = await tap(f, threadId, payment.surfaces[0]!, "Start checkout");
    assert.match(checkout.surfaces[0]!.surfaceId, /:contact:email:/, "checkout asks for the contact email");

    const emailAsk = firstButtonAction(checkout.surfaces[0]!);
    const emailSaved = successOf(await coldApp(f, threadId).handleEventAsync(threadId, { ...emailAsk, context: { ...emailAsk.context, contactValue: EMAIL } }), "Save email");
    assert.equal(f.environment.guestContactApp.get(f.environment.guestPrincipal())?.contactEmail, EMAIL, "the contact record holds the real email");
    assert.match(emailSaved.surfaces[0]!.textFallback ?? "", /payment handoff ready|payment has not succeeded/i, "payment is ready to hand off");
    assert.equal(persistedTimeline(f, threadId).some((entry) => entry.text.includes(EMAIL)), false, "the timeline still holds no plaintext email");
  } finally { f.close(); }
});

test("AC4: An email typed in one lane does not appear in plaintext in any other lane or surface", async () => {
  const f = datedFixture(scriptedPlanner(SCRIPT).client, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const threadId = "g-7e57a0000404";
    const search = successOf(await f.app.handleTurn(threadId, STAY_TEXT), "search");
    const typed = successOf(await coldApp(f, threadId).handleTurn(threadId, EMAIL_TURN), "typed email turn");
    const detail = await tap(f, threadId, search.surfaces[0]!, "View");
    const after = await tap(f, threadId, detail.surfaces[0]!, "Request to Book");
    const surfaces = [...search.surfaces, ...typed.surfaces, ...detail.surfaces, ...after.surfaces];
    assert.equal(readableText(f, threadId, surfaces).includes(EMAIL), false, "no timeline, lane row, surface or stored projection holds the plaintext email");
  } finally { f.close(); }
});

test("AC5: A chat reply for a turn that carries an email uses the masked form, and no timeline entry of any role holds the plaintext email", async () => {
  const f = datedFixture(scriptedPlanner(SCRIPT).client, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const threadId = "g-7e57a0000405";
    successOf(await f.app.handleTurn(threadId, EMAIL_TURN), "typed email turn");
    const restored = coldApp(f, threadId).getState(threadId);
    assert.ok(restored, "the conversation is readable after a cold restore");
    assert.ok(restored.timeline.some((entry) => entry.role === "assistant"), "the turn left an assistant reply in the timeline");
    assert.equal(JSON.stringify(restored.timeline).includes(EMAIL), false, "no timeline entry of any role holds the plaintext email");
    assert.ok(restored.timeline.some((entry) => entry.role === "user" && entry.text === MASKED_EMAIL_TURN), "the guest's own echoed address is masked");
  } finally { f.close(); }
});
