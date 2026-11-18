import assert from "node:assert/strict";
import test from "node:test";
import { DRAFT_REPLACEMENT_ACCEPT_EVENT, DRAFT_REPLACEMENT_KEEP_EVENT, REQUEST_DRAFT_REVIEW_EVENT } from "../apps/web-agent/src/index.js";
import { firstButtonAction } from "./helpers/guest-date-fixtures.js";
import { actionNamed, buttonActions, changeDraft, coldApp, draftJourney, event, rejected, replacementSurface, success, type Journey, type Surface } from "./helpers/assistant-draft-journey.js";

// Issue 19 (state-machines, Track C; ADR 0074, ADR 0106): a pending Request Draft replacement is shown again after a cold restore.
// Every event runs on a new application over the same store (cold restore), with the assistant runtime enabled, the 27 Oct 2026
// clock and a guest with no seeded phone or email. The replacement is a date change on the draft's own Unit (the planner's
// "make it 3 nights"), which is the only way the live card is proposed.

/** The surface the guest sees on a page load: the thread's current card, restored from the store. */
function restoredCard(j: Journey): Surface {
  const state = coldApp(j).getState(j.threadId);
  assert.ok(state, "the thread restores");
  const surface = state.surfaces[0];
  assert.ok(surface, "a card is shown after the restore");
  return surface;
}

test("AC1: after a cold restore, a thread with a pending draft replacement shows the replacement card, under the same surface id as before the restore", async () => {
  const j = await draftJourney("rc1");
  try {
    const proposal = replacementSurface(success(await changeDraft(j, "make it 3 nights"), "make it 3 nights"));
    const card = restoredCard(j);
    assert.equal(card.surfaceId, proposal.surfaceId, "the same surface id, not a newly minted one");
    assert.deepEqual(card.a2uiMessages, proposal.a2uiMessages, "rebuilt by the same renderer as the live card");
    const events = buttonActions(card).map((action) => action.name);
    assert.ok(events.includes(DRAFT_REPLACEMENT_ACCEPT_EVENT), "accept is offered on the restored card");
    assert.ok(events.includes(DRAFT_REPLACEMENT_KEEP_EVENT), "keep is offered on the restored card");
    assert.equal(j.f.environment.bookingRequestApp.getDraft(j.draftId).checkOut, "2026-12-16", "the draft is unchanged until the guest chooses");
  } finally { j.f.close(); }
});

test("AC2: accept on the restored card replaces the Request Draft, exactly as on the live card", async () => {
  const j = await draftJourney("rc2a");
  try {
    replacementSurface(success(await changeDraft(j, "make it 3 nights"), "make it 3 nights"));
    const accepted = success(await event(j, actionNamed(restoredCard(j), DRAFT_REPLACEMENT_ACCEPT_EVENT)), "accept on the restored card");
    const next = accepted.surfaces[0]!;
    assert.match(next.surfaceId, /:request:draft:/);
    const newDraftId = next.surfaceId.split(":").at(-1)!;
    assert.notEqual(newDraftId, j.draftId);
    assert.equal(j.f.environment.bookingRequestApp.getDraft(newDraftId).checkOut, "2026-12-17");
    rejected(await event(j, { ...firstButtonAction(j.draftSurface), name: REQUEST_DRAFT_REVIEW_EVENT }), "STALE_SURFACE");
  } finally { j.f.close(); }
});

test("AC2: keep on the restored card leaves the original Request Draft, exactly as on the live card", async () => {
  const j = await draftJourney("rc2k");
  try {
    replacementSurface(success(await changeDraft(j, "make it 3 nights"), "make it 3 nights"));
    const kept = success(await event(j, actionNamed(restoredCard(j), DRAFT_REPLACEMENT_KEEP_EVENT)), "keep on the restored card");
    assert.deepEqual(kept.messages, ["Your Request Draft is unchanged."]);
    assert.equal(kept.surfaces[0]!.surfaceId.split(":").at(-1), j.draftId);
    assert.equal(j.f.environment.bookingRequestApp.getDraft(j.draftId).checkOut, "2026-12-16");
  } finally { j.f.close(); }
});

test("AC3: a replacement action with a forged surface id is refused with STALE_SURFACE after a restore, and a superseded one stays refused", async () => {
  const j = await draftJourney("rc3");
  try {
    replacementSurface(success(await changeDraft(j, "make it 3 nights"), "make it 3 nights"));
    const accept = actionNamed(restoredCard(j), DRAFT_REPLACEMENT_ACCEPT_EVENT);
    rejected(await event(j, { ...accept, surfaceId: `${accept.surfaceId}-forged` }), "STALE_SURFACE");
    assert.equal(j.f.environment.bookingRequestApp.getDraft(j.draftId).checkOut, "2026-12-16", "a forged accept changes nothing");
    success(await event(j, accept), "accept on the restored card");
    rejected(await event(j, accept), "STALE_SURFACE");
  } finally { j.f.close(); }
});

test("AC4: a thread with no pending replacement restores its Request Draft exactly as before", async () => {
  const j = await draftJourney("rc4");
  try {
    const card = restoredCard(j);
    assert.equal(card.surfaceId, j.draftSurface.surfaceId, "the draft is restored under its own surface id");
    assert.deepEqual(buttonActions(card).map((action) => action.name).filter((name) => name === DRAFT_REPLACEMENT_ACCEPT_EVENT), [], "no replacement action is offered");
  } finally { j.f.close(); }
});
