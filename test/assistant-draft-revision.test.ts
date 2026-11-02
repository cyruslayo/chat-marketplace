import assert from "node:assert/strict";
import test from "node:test";
import type { GuestTurnResult, GuestTurnSuccess } from "../apps/local-guest/src/shortlet-app.js";
import type { AssistantModelClient } from "../apps/local-guest/src/assistant/assistant-model.js";
import { DRAFT_REPLACEMENT_ACCEPT_EVENT, DRAFT_REPLACEMENT_KEEP_EVENT, REQUEST_DRAFT_REVIEW_EVENT } from "../apps/web-agent/src/index.js";
import { datedFixture, coldTurn, firstButtonAction, LIVE_LIKE_CLOCK, restartedDatedApp, scriptedPlanner, successfulTurn, type DatedFixture } from "./helpers/guest-date-fixtures.js";
import { repricedByOwner } from "./helpers/owner-terms.js";
import type { Unit } from "../domains/shortlet/src/index.js";

// Issue 13a (ADR 0106, ADR 0080): the assistant twins of the deterministic draft-revision tests for nights and party changes.
// Each turn and each event runs on a cold restore (a new application over the same store), on a fresh thread, with the
// assistant runtime enabled, the staging-like clock (27 Oct 2026) and a staging-like guest (no seeded phone or email).

const TWO_NIGHT_TEXT = "Apartment in Lekki for 2 guests, 2 nights from 14 December 2026";
const SEARCH_TWO = { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-14", nights: 2, guests: 2 };
const SCRIPT = {
  [TWO_NIGHT_TEXT]: { slots: { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-14", nights: 2, guests: 2 }, search: SEARCH_TWO },
  "make it 3 nights": { slots: { nights: 3 }, search: { city: "Lagos", nights: 3, guests: 2 } },
  "make it 4 nights": { slots: { nights: 4 }, search: { city: "Lagos", nights: 4, guests: 2 } },
  "make it 181 nights": { slots: { nights: 181 }, search: { city: "Lagos", nights: 181, guests: 2 } },
  "make it 9 guests": { slots: { guests: 9 }, search: { city: "Lagos", nights: 2, guests: 9 } },
  "Actually, show me Ikoyi instead": { slots: { neighbourhood: "Ikoyi" }, search: { city: "Lagos", neighbourhood: "Ikoyi", checkIn: "2026-12-14", nights: 2, guests: 2 } },
};

type Action = ReturnType<typeof firstButtonAction>;
interface Surface { readonly surfaceId: string; readonly a2uiMessages: readonly unknown[] }

interface Journey {
  readonly f: DatedFixture;
  readonly threadId: string;
  readonly model: AssistantModelClient;
  readonly draftSurface: Surface;
  readonly draftId: string;
}

function success(result: GuestTurnResult, label: string): GuestTurnSuccess {
  return successfulTurn(result, label);
}

function rejected(result: GuestTurnResult, code: string): void {
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal((result as { code: string }).code, code);
}

/** A new application over the same store, loaded as a page load does, before the event is sent (ADR 0106 cold restore). */
function coldApp(j: Journey) {
  const restored = restartedDatedApp(j.f, j.model);
  restored.app.getState(j.threadId);
  return restored.app;
}

/** Every Button action on a surface, in document order. */
function buttonActions(surface: Surface): Action[] {
  const found: Action[] = [];
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    const record = node as Record<string, unknown>;
    const event = (record.action as { readonly event?: { readonly name?: unknown; readonly context?: unknown } } | undefined)?.event;
    if (record.component === "Button" && event && typeof event.name === "string" && event.context !== null && typeof event.context === "object") {
      found.push({ ...firstButtonAction({ surfaceId: surface.surfaceId, a2uiMessages: [record] }), name: event.name, context: event.context as Record<string, unknown> });
      return;
    }
    Object.values(record).forEach(walk);
  };
  walk(surface.a2uiMessages);
  return found;
}

/** The Button action on a surface that sends the named event. */
function actionNamed(surface: Surface, name: string): Action {
  const action = buttonActions(surface).find((candidate) => candidate.name === name);
  assert.ok(action, `${surface.surfaceId} has no ${name} action`);
  return { ...action, surfaceId: surface.surfaceId };
}

/** A 2-night Request Draft in Lekki, on screen, reached by the guest's journey: search, View, Request to Book (cold restore before each). */
async function draftJourney(label: string): Promise<Journey> {
  const model = scriptedPlanner(SCRIPT).client;
  const f = datedFixture(model, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  const threadId = `g-d13a${Buffer.from(label).toString("hex")}0001`;
  const j = { f, threadId, model } as const;
  const search = success(await coldTurn(f, threadId, TWO_NIGHT_TEXT, model), "search");
  const detail = success(await coldApp({ ...j, draftSurface: search.surfaces[0]!, draftId: "" }).handleEventAsync(threadId, firstButtonAction(search.surfaces[0]!)), "View");
  assert.match(detail.surfaces[0]!.surfaceId, /:unit:detail:/);
  const draft = success(await coldApp({ ...j, draftSurface: detail.surfaces[0]!, draftId: "" }).handleEventAsync(threadId, firstButtonAction(detail.surfaces[0]!)), "Request to Book");
  const draftSurface = draft.surfaces[0]!;
  assert.match(draftSurface.surfaceId, /:request:draft:/);
  return { f, threadId, model, draftSurface, draftId: draftSurface.surfaceId.split(":").at(-1)! };
}

/** The planner's "make it N nights" or party change, on a cold restore. */
async function changeDraft(j: Journey, text: string): Promise<GuestTurnResult> {
  return coldTurn(j.f, j.threadId, text, j.model);
}

function event(j: Journey, action: Action): Promise<GuestTurnResult> {
  return coldApp(j).handleEventAsync(j.threadId, action);
}

function replacementSurface(result: GuestTurnSuccess): Surface {
  const surface = result.surfaces[0];
  assert.ok(surface, "a replacement surface is shown");
  assert.match(surface.surfaceId, /:request:replacement:/);
  return surface;
}

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
