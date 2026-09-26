import test from "node:test";
import assert from "node:assert/strict";
import type { A2UIServerMessage } from "@weaver/core";
import { createStayQuote, type Unit } from "../domains/shortlet/src/index.js";
import {
  DRAFT_REPLACEMENT_ACCEPT_EVENT,
  DRAFT_REPLACEMENT_KEEP_EVENT,
  REQUEST_DRAFT_REVIEW_EVENT,
  REQUEST_DRAFT_SUBMIT_EVENT,
  formatNgnKobo,
} from "../apps/web-agent/src/index.js";
import type { GuestSurfacePayload, GuestTurnResult, GuestTurnSuccess } from "../apps/local-guest/src/guest-server.js";
import { guestAction, restartFixture } from "./helpers/guest-restart.js";

const TWO_NIGHTS = "I need an apartment in Ikoyi from 10 Sept for 2 nights for 2 people";

function success(result: GuestTurnResult): GuestTurnSuccess {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result as GuestTurnSuccess;
}

function rejected(result: GuestTurnResult, code: string): void {
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal((result as { code: string }).code, code);
}

function texts(surface: GuestSurfacePayload): string[] {
  const update = surface.a2uiMessages.find((message): message is Extract<A2UIServerMessage, { updateComponents: unknown }> => "updateComponents" in message);
  assert.ok(update);
  return (update.updateComponents.components as readonly { text?: string }[]).flatMap((component) => component.text === undefined ? [] : [component.text]);
}

/** A 2-night Request Draft for Old Ikoyi, on screen. */
async function twoNightDraft() {
  const fixture = await restartFixture();
  const draft = await fixture.advance("draft", undefined, TWO_NIGHTS);
  const surface = draft.surfaces[0]!;
  assert.match(surface.surfaceId, /:request:draft:/);
  const draftId = surface.surfaceId.split(":").at(-1)!;
  return { fixture, surface, draftId };
}

function quoteFor(fixture: Awaited<ReturnType<typeof restartFixture>>, unitId: string, checkOut: string, partySize = 2) {
  const unit = fixture.environment.unitRepository.findById(unitId) as Unit;
  return createStayQuote({ unit, checkIn: "2026-09-10", checkOut, partySize, clock: fixture.environment.clock });
}

test("AC3: \"make it 3 nights\" on a draft proposes a re-quoted draft that needs confirmation", async () => {
  const { fixture, surface: draftSurface, draftId } = await twoNightDraft();
  try {
    const manager = fixture.environment.bookingRequestApp.manager;
    const unitId = manager.getDraft(draftId).unitId;
    const proposed = success(await fixture.send("/api/turn", { text: "make it 3 nights" }));
    const proposal = proposed.surfaces[0]!;
    assert.match(proposal.surfaceId, /:request:replacement:/);
    assert.match(proposed.messages[0]!, /changes only if you choose/);

    // The proposal is re-quoted by the same deterministic quote (ADR-0015).
    const quote = quoteFor(fixture, unitId, "2026-09-13");
    const current = quoteFor(fixture, unitId, "2026-09-12");
    const lines = texts(proposal);
    assert.ok(lines.includes("Change your Request Draft?"));
    assert.ok(lines.some((line) => line.includes("3 nights") && line.endsWith(`All-In Stay Total: ${formatNgnKobo(quote.allInStayTotalKobo)}`)), lines.join("\n"));
    assert.ok(lines.some((line) => line.includes("2 nights") && line.endsWith(`All-In Stay Total: ${formatNgnKobo(current.allInStayTotalKobo)}`)));
    assert.ok(lines.includes(`Total to complete booking if confirmed: ${formatNgnKobo(quote.totalAmountDueNowKobo)}`));

    // Needs confirmation: nothing changed yet, and the current draft still works.
    const state = await fixture.state();
    assert.equal(state.ok, true);
    assert.equal(manager.getDraft(draftId).checkOut, "2026-09-12");
    assert.equal(fixture.app.conventionalBookingPage("draft", draftId, fixture.environment.guestPrincipal())?.threadId, fixture.threadId);

    const accepted = success(await fixture.send("/api/event", guestAction(proposal, DRAFT_REPLACEMENT_ACCEPT_EVENT)));
    const next = accepted.surfaces[0]!;
    assert.match(next.surfaceId, /:request:draft:/);
    const newDraftId = next.surfaceId.split(":").at(-1)!;
    assert.notEqual(newDraftId, draftId);
    const replacement = manager.getDraft(newDraftId);
    assert.equal(replacement.checkIn, "2026-09-10");
    assert.equal(replacement.checkOut, "2026-09-13");
    assert.equal(replacement.occupants.length, 2);
    assert.deepEqual(accepted.receipts, ["Draft updated"]);
    assert.match(accepted.messages[0]!, /now covers .+ for 2 guests\. Review it before you send it\.$/);
    assert.ok(texts(next).includes(`All-In Stay Total: ${formatNgnKobo(quote.allInStayTotalKobo)}`));
    // The criteria follow the accepted stay.
    const after = await fixture.state();
    assert.equal(after.ok && after.criteria?.when?.nights, 3);

    // Failure path: the old 2-night draft can no longer be reviewed or sent.
    rejected(await fixture.send("/api/event", guestAction(draftSurface, REQUEST_DRAFT_REVIEW_EVENT)), "STALE_SURFACE");
    // Accepting twice fails closed.
    rejected(await fixture.send("/api/event", guestAction(proposal, DRAFT_REPLACEMENT_ACCEPT_EVENT)), "STALE_SURFACE");
    // The new draft continues to a request as normal.
    success(await fixture.send("/api/event", guestAction(next, REQUEST_DRAFT_REVIEW_EVENT)));
  } finally { await fixture.close(); }
});

test("AC3 failure path: keeping the current draft changes nothing and costs nothing", async () => {
  const { fixture, draftId } = await twoNightDraft();
  try {
    const proposal = success(await fixture.send("/api/turn", { text: "make it 3 nights" })).surfaces[0]!;
    const kept = success(await fixture.send("/api/event", guestAction(proposal, DRAFT_REPLACEMENT_KEEP_EVENT)));
    assert.deepEqual(kept.messages, ["Your Request Draft is unchanged."]);
    assert.equal(kept.surfaces[0]!.surfaceId.split(":").at(-1), draftId);
    assert.equal(fixture.environment.bookingRequestApp.manager.getDraft(draftId).checkOut, "2026-09-12");
    rejected(await fixture.send("/api/event", guestAction(proposal, DRAFT_REPLACEMENT_ACCEPT_EVENT)), "STALE_SURFACE");
    // The kept draft still reviews and submits.
    const review = success(await fixture.send("/api/event", guestAction(kept.surfaces[0]!, REQUEST_DRAFT_REVIEW_EVENT)));
    success(await fixture.send("/api/event", guestAction(review.surfaces[0]!, REQUEST_DRAFT_SUBMIT_EVENT)));
  } finally { await fixture.close(); }
});

test("AC3 failure path: a stay over the 14-night limit is refused and the draft is unchanged", async () => {
  const { fixture, draftId } = await twoNightDraft();
  try {
    const refused = success(await fixture.send("/api/turn", { text: "make it 20 nights" }));
    assert.equal(refused.surfaces.length, 0);
    assert.match(refused.messages[0]!, /14 nights/);
    assert.equal(refused.messages.at(-1), "Your Request Draft is unchanged.");
    assert.equal(fixture.environment.bookingRequestApp.manager.getDraft(draftId).checkOut, "2026-09-12");
  } finally { await fixture.close(); }
});

test("AC3 failure path: a party the apartment can't take is refused and the draft is unchanged", async () => {
  const { fixture, draftId } = await twoNightDraft();
  try {
    const refused = success(await fixture.send("/api/turn", { text: "make it 9 guests" }));
    assert.equal(refused.surfaces.length, 0);
    assert.match(refused.messages[0]!, /isn't available for .+ for 9 guests\.$/);
    assert.equal(refused.messages.at(-1), "Your Request Draft is unchanged.");
    assert.equal(fixture.environment.bookingRequestApp.manager.getDraft(draftId).occupants.length, 2);
  } finally { await fixture.close(); }
});

test("AC3 failure path: a tampered or stale accept fails closed", async () => {
  const { fixture, draftId } = await twoNightDraft();
  try {
    const proposal = success(await fixture.send("/api/turn", { text: "make it 3 nights" })).surfaces[0]!;
    const accept = guestAction(proposal, DRAFT_REPLACEMENT_ACCEPT_EVENT);
    for (const context of [
      { ...accept.context, draftId: "draft-forged" },
      { ...accept.context, basedOn: "[]" },
      { ...accept.context, extra: true },
      { draftId },
    ]) {
      rejected(await fixture.send("/api/event", { ...accept, context }), "INVALID_CONTEXT");
    }
    // A newer proposal replaces the older one: its terms can't be accepted.
    const newer = success(await fixture.send("/api/turn", { text: "make it 4 nights" })).surfaces[0]!;
    assert.equal(newer.surfaceId, proposal.surfaceId);
    rejected(await fixture.send("/api/event", accept), "INVALID_CONTEXT");
    assert.equal(fixture.environment.bookingRequestApp.manager.getDraft(draftId).checkOut, "2026-09-12");
    const accepted = success(await fixture.send("/api/event", guestAction(newer, DRAFT_REPLACEMENT_ACCEPT_EVENT)));
    assert.equal(fixture.environment.bookingRequestApp.manager.getDraft(accepted.surfaces[0]!.surfaceId.split(":").at(-1)!).checkOut, "2026-09-14");
  } finally { await fixture.close(); }
});

test("AC3 failure path: a price change before accepting re-proposes instead of replacing", async () => {
  const { fixture, draftId } = await twoNightDraft();
  try {
    const proposal = success(await fixture.send("/api/turn", { text: "make it 3 nights" })).surfaces[0]!;
    const unitId = fixture.environment.bookingRequestApp.manager.getDraft(draftId).unitId;
    const unit = fixture.environment.unitRepository.findById(unitId) as Unit;
    fixture.environment.unitRepository.save({ id: unitId, price: { ...unit.price, nightlyKobo: unit.price.nightlyKobo + 1_000_000 } });
    const reproposed = success(await fixture.send("/api/event", guestAction(proposal, DRAFT_REPLACEMENT_ACCEPT_EVENT)));
    assert.match(reproposed.messages[0]!, /^The price changed before you chose\./);
    assert.match(reproposed.surfaces[0]!.surfaceId, /:request:replacement:/);
    assert.ok(texts(reproposed.surfaces[0]!).some((line) => line.endsWith(`All-In Stay Total: ${formatNgnKobo(quoteFor(fixture, unitId, "2026-09-13").allInStayTotalKobo)}`)));
    assert.equal(fixture.environment.bookingRequestApp.manager.getDraft(draftId).checkOut, "2026-09-12");
  } finally { await fixture.close(); }
});

test("AC3 failure path: relative dates are confirmed before a replacement is proposed", async () => {
  const { fixture, draftId } = await twoNightDraft();
  try {
    const asked = success(await fixture.send("/api/turn", { text: "make it from next Friday" }));
    assert.equal(asked.surfaces.length, 0);
    assert.equal(asked.messages.at(-1), "Your Request Draft is unchanged.");
    const confirmed = success(await fixture.send("/api/turn", { text: "yes" }));
    assert.match(confirmed.surfaces[0]!.surfaceId, /:request:replacement:/);
    assert.equal(fixture.environment.bookingRequestApp.manager.getDraft(draftId).checkIn, "2026-09-10");
  } finally { await fixture.close(); }
});

test("AC3 failure path: a new place still searches, and the old draft's actions go stale", async () => {
  const { fixture, surface } = await twoNightDraft();
  try {
    const searched = success(await fixture.send("/api/turn", { text: "Actually, show me Lekki instead" }));
    assert.match(searched.surfaces[0]?.surfaceId ?? "", /:discovery:/);
    rejected(await fixture.send("/api/event", guestAction(surface, REQUEST_DRAFT_REVIEW_EVENT)), "STALE_SURFACE");
  } finally { await fixture.close(); }
});
