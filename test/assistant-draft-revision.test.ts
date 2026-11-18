import assert from "node:assert/strict";
import test from "node:test";
import { DRAFT_REPLACEMENT_ACCEPT_EVENT, DRAFT_REPLACEMENT_KEEP_EVENT, REQUEST_DRAFT_REVIEW_EVENT } from "../apps/web-agent/src/index.js";
import { firstButtonAction } from "./helpers/guest-date-fixtures.js";
import { repricedByOwner } from "./helpers/owner-terms.js";
import type { Unit } from "../domains/shortlet/src/index.js";
import { actionNamed, buttonActions, changeDraft, draftJourney, event, rejected, replacementSurface, success } from "./helpers/assistant-draft-journey.js";

// Issue 13a (ADR 0106, ADR 0080): the assistant twins of the deterministic draft-revision tests for nights and party changes.
// Each turn and each event runs on a cold restore (a new application over the same store), on a fresh thread, with the
// assistant runtime enabled, the staging-like clock (27 Oct 2026) and a staging-like guest (no seeded phone or email).
// The journey, script and cold-restore helpers live in test/helpers/assistant-draft-journey.ts.

test("AC1: \"make it 3 nights\" on a draft shows the re-quoted replacement with accept and keep", async () => {
  const j = await draftJourney("ac1");
  try {
    const proposed = success(await changeDraft(j, "make it 3 nights"), "make it 3 nights");
    const proposal = replacementSurface(proposed);
    const events = buttonActions(proposal).map((action) => action.name);
    assert.ok(events.includes(DRAFT_REPLACEMENT_ACCEPT_EVENT), "accept is offered");
    assert.ok(events.includes(DRAFT_REPLACEMENT_KEEP_EVENT), "keep is offered");
    assert.equal(j.f.environment.bookingRequestApp.getDraft(j.draftId).checkOut, "2026-12-16", "the draft is unchanged until the guest chooses");
  } finally { j.f.close(); }
});

test("AC2: accepting the replacement replaces the Request Draft and the criteria follow the accepted stay", async () => {
  const j = await draftJourney("ac2a");
  try {
    const proposal = replacementSurface(success(await changeDraft(j, "make it 3 nights"), "make it 3 nights"));
    const accepted = success(await event(j, actionNamed(proposal, DRAFT_REPLACEMENT_ACCEPT_EVENT)), "accept");
    const next = accepted.surfaces[0]!;
    assert.match(next.surfaceId, /:request:draft:/);
    const newDraftId = next.surfaceId.split(":").at(-1)!;
    assert.notEqual(newDraftId, j.draftId);
    assert.equal(j.f.environment.bookingRequestApp.getDraft(newDraftId).checkOut, "2026-12-17");
    rejected(await event(j, { ...firstButtonAction(j.draftSurface), name: REQUEST_DRAFT_REVIEW_EVENT }), "STALE_SURFACE");
  } finally { j.f.close(); }
});

test("AC2: keeping the current draft changes nothing", async () => {
  const j = await draftJourney("ac2k");
  try {
    const proposal = replacementSurface(success(await changeDraft(j, "make it 3 nights"), "make it 3 nights"));
    const kept = success(await event(j, actionNamed(proposal, DRAFT_REPLACEMENT_KEEP_EVENT)), "keep");
    assert.deepEqual(kept.messages, ["Your Request Draft is unchanged."]);
    assert.equal(kept.surfaces[0]!.surfaceId.split(":").at(-1), j.draftId);
    assert.equal(j.f.environment.bookingRequestApp.getDraft(j.draftId).checkOut, "2026-12-16");
    rejected(await event(j, actionNamed(proposal, DRAFT_REPLACEMENT_ACCEPT_EVENT)), "STALE_SURFACE");
  } finally { j.f.close(); }
});

test("AC3 failure path: a stay over the 180-night maximum is refused and the draft is unchanged", async () => {
  const j = await draftJourney("ac3n");
  try {
    const refused = success(await changeDraft(j, "make it 181 nights"), "make it 181 nights");
    assert.equal(refused.surfaces.length, 0, "no replacement is proposed");
    assert.equal(j.f.environment.bookingRequestApp.getDraft(j.draftId).checkOut, "2026-12-16");
  } finally { j.f.close(); }
});

test("AC3 failure path: a party the apartment can't take is refused and the draft is unchanged", async () => {
  const j = await draftJourney("ac3p");
  try {
    const refused = success(await changeDraft(j, "make it 9 guests"), "make it 9 guests");
    assert.equal(refused.surfaces.length, 0, "no replacement is proposed");
    assert.ok(refused.messages.some((message) => /isn't available for .+ for 9 guests\. Your Request Draft is unchanged\.$/.test(message)), refused.messages.join("\n"));
    assert.equal(j.f.environment.bookingRequestApp.getDraft(j.draftId).occupants.length, 2);
  } finally { j.f.close(); }
});

test("AC4 failure path: a tampered or stale accept fails closed", async () => {
  const j = await draftJourney("ac4t");
  try {
    const proposal = replacementSurface(success(await changeDraft(j, "make it 3 nights"), "make it 3 nights"));
    const accept = actionNamed(proposal, DRAFT_REPLACEMENT_ACCEPT_EVENT);
    // A forged surface id is stale; a forged or extended context is refused as an invalid context (the deterministic codes).
    rejected(await event(j, { ...accept, surfaceId: `${proposal.surfaceId}-forged` }), "STALE_SURFACE");
    for (const context of [{ ...accept.context, draftId: "draft-forged" }, { ...accept.context, basedOn: "[]" }, { ...accept.context, extra: true }]) {
      rejected(await event(j, { ...accept, context }), "INVALID_CONTEXT");
    }
    // A newer proposal replaces the older one: the older terms can't be accepted.
    const newer = replacementSurface(success(await changeDraft(j, "make it 4 nights"), "make it 4 nights"));
    assert.equal(newer.surfaceId, proposal.surfaceId);
    rejected(await event(j, accept), "INVALID_CONTEXT");
    assert.equal(j.f.environment.bookingRequestApp.getDraft(j.draftId).checkOut, "2026-12-16");
    const accepted = success(await event(j, actionNamed(newer, DRAFT_REPLACEMENT_ACCEPT_EVENT)), "accept newer");
    assert.equal(j.f.environment.bookingRequestApp.getDraft(accepted.surfaces[0]!.surfaceId.split(":").at(-1)!).checkOut, "2026-12-18");
  } finally { j.f.close(); }
});

test("AC4 failure path: a price change before accepting re-proposes instead of replacing", async () => {
  const j = await draftJourney("ac4p");
  try {
    const proposal = replacementSurface(success(await changeDraft(j, "make it 3 nights"), "make it 3 nights"));
    const unitId = j.f.environment.bookingRequestApp.getDraft(j.draftId).unitId;
    const unit = j.f.environment.unitRepository.findById(unitId) as Unit;
    j.f.environment.unitRepository.save({ id: unitId, price: repricedByOwner(unit.price, { ownerNightlyKobo: unit.price.ownerTerms!.agreed.nightlyKobo + 1_000_000 }) });
    const reproposed = success(await event(j, actionNamed(proposal, DRAFT_REPLACEMENT_ACCEPT_EVENT)), "accept after price change");
    assert.match(reproposed.messages[0]!, /^The price changed before you chose\./);
    assert.match(reproposed.surfaces[0]!.surfaceId, /:request:replacement:/);
    assert.equal(j.f.environment.bookingRequestApp.getDraft(j.draftId).checkOut, "2026-12-16");
  } finally { j.f.close(); }
});

test("AC6: a new place still searches, and the old draft's actions go stale", async () => {
  const j = await draftJourney("ac6p");
  try {
    const searched = success(await changeDraft(j, "Actually, show me Ikoyi instead"), "new place");
    assert.match(searched.surfaces[0]?.surfaceId ?? "", /:discovery:/);
    rejected(await event(j, { ...firstButtonAction(j.draftSurface), name: REQUEST_DRAFT_REVIEW_EVENT }), "STALE_SURFACE");
  } finally { j.f.close(); }
});

test("AC5: relative dates are confirmed before the replacement is proposed", async () => {
  const j = await draftJourney("ac5");
  try {
    const asked = success(await changeDraft(j, "make it from tomorrow"), "make it from tomorrow");
    assert.equal(asked.surfaces.length, 0, "no replacement is proposed before the guest confirms");
    assert.match(asked.messages.join(" "), /Just to check: arriving .+ and leaving .+ \(2 nights\), 2 guests\. Shall I show your Request Draft with these dates\?/);
    assert.equal(j.f.environment.bookingRequestApp.getDraft(j.draftId).checkIn, "2026-12-14", "the draft is unchanged");
    const confirmed = replacementSurface(success(await changeDraft(j, "yes"), "yes"));
    assert.ok(confirmed.surfaceId.endsWith(j.draftId));
  } finally { j.f.close(); }
});

test("AC3 failure path: a date check the Guest doesn't confirm is dropped, so the next change builds on the draft", async () => {
  const j = await draftJourney("ac3d");
  try {
    success(await changeDraft(j, "make it from tomorrow"), "make it from tomorrow");
    success(await changeDraft(j, "no"), "no");
    const proposal = replacementSurface(success(await changeDraft(j, "make it 4 nights"), "make it 4 nights"));
    const accepted = success(await event(j, actionNamed(proposal, DRAFT_REPLACEMENT_ACCEPT_EVENT)), "accept");
    const replacement = j.f.environment.bookingRequestApp.getDraft(accepted.surfaces[0]!.surfaceId.split(":").at(-1)!);
    assert.equal(replacement.checkIn, "2026-12-14", "the unconfirmed day is not used");
    assert.equal(replacement.checkOut, "2026-12-18");
    assert.notEqual(replacement.draftId, j.draftId);
  } finally { j.f.close(); }
});

test("AC3 failure path: answering a date check with different dates uses those dates", async () => {
  const j = await draftJourney("ac3e");
  try {
    success(await changeDraft(j, "make it from tomorrow"), "make it from tomorrow");
    const proposal = replacementSurface(success(await changeDraft(j, "from 3 November"), "from 3 November"));
    const accepted = success(await event(j, actionNamed(proposal, DRAFT_REPLACEMENT_ACCEPT_EVENT)), "accept");
    assert.equal(j.f.environment.bookingRequestApp.getDraft(accepted.surfaces[0]!.surfaceId.split(":").at(-1)!).checkIn, "2026-11-03");
  } finally { j.f.close(); }
});
