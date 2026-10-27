import assert from "node:assert/strict";
import test from "node:test";
import type { GuestTurnResult, GuestTurnSuccess } from "../apps/local-guest/src/shortlet-app.js";
import { CRITERIA_EDIT_EVENT, criteriaSurfaceId } from "../apps/local-guest/src/guest-server.js";
import { datedFixture, firstButtonAction, restartedDatedApp, runtimeDiscoveryArtifact, scriptedPlanner, type DatedFixture } from "./helpers/guest-date-fixtures.js";

// A fresh thread's whole booking journey with the assistant runtime enabled (ADR 0106): planner search, View, Request to
// Book, review, submit, operator acceptance, offer, payment handoff, and payment verification. Each guest step is a
// guest action on the surface the previous step returned. The restored variant runs every step in a new application over
// the same store, as the browser's requests do in production.

const LEKKI_TEXT = "Apartment in Lekki for 2 guests, 3 nights from 20 November 2026";
const LEKKI_SEARCH = { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-11-20", nights: 3, guests: 2 };
const LEKKI_DETAILS_TEXT = "Tell me more about the first one";
const LEKKI_SLOTS = { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-11-20", nights: 3, guests: 2 };
const SCRIPT = {
  [LEKKI_TEXT]: { slots: LEKKI_SLOTS, search: LEKKI_SEARCH },
  [LEKKI_DETAILS_TEXT]: { slots: LEKKI_SLOTS, intents: ["details"], tool: { name: "get_unit_details", args: { stayRef: "stay-1" } } },
};

function successOf(result: GuestTurnResult, label = "turn"): GuestTurnSuccess {
  assert.equal(result.ok, true, result.ok ? "" : `${label}: expected success, saw ${result.code}: ${result.message}`);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

type Mode = "same-process" | "restored-each-step";

/** The first action on a surface, sent in the mode's application instance; returns the raw turn result. */
async function send(f: DatedFixture, mode: Mode, threadId: string, surface: { readonly surfaceId: string; readonly a2uiMessages: readonly unknown[] }): Promise<GuestTurnResult> {
  if (mode === "same-process") return f.app.handleEventAsync(threadId, firstButtonAction(surface));
  const restored = restartedDatedApp(f, scriptedPlanner({}).client);
  restored.app.getState(threadId);
  return restored.app.handleEventAsync(threadId, firstButtonAction(surface));
}

/** One guest step that must succeed. */
async function step(f: DatedFixture, mode: Mode, threadId: string, surface: { readonly surfaceId: string; readonly a2uiMessages: readonly unknown[] }, label = "step"): Promise<GuestTurnSuccess> {
  return successOf(await send(f, mode, threadId, surface), label);
}

for (const mode of ["same-process", "restored-each-step"] as const) {
  test(`a fresh thread's planner search carries the whole booking journey (${mode})`, async () => {
    const f = datedFixture(scriptedPlanner(SCRIPT).client);
    try {
      const threadId = "g-d1a0000201";
      const search = successOf(await f.app.handleTurn(threadId, LEKKI_TEXT));
      assert.ok(runtimeDiscoveryArtifact(f.runtime, threadId), "the planner search leaves a discovery artifact");

      // View: the unit detail opens with a Request to Book action.
      const detail = await step(f, mode, threadId, search.surfaces[0]!, "View");
      assert.match(detail.surfaces[0]!.surfaceId, /:unit:detail:/, "View opens the unit detail");

      // Request to Book: the draft opens.
      const draft = await step(f, mode, threadId, detail.surfaces[0]!, "Request to Book");
      assert.match(draft.surfaces[0]!.surfaceId, /:request:draft:/, "Request to Book opens the draft");

      // Review, then submit: the Booking Request is sent and pending.
      const review = await step(f, mode, threadId, draft.surfaces[0]!, "Review");
      assert.match(review.surfaces[0]!.summary ?? "", /review/i, "the draft opens for review");
      const pending = await step(f, mode, threadId, review.surfaces[0]!, "Submit");
      assert.match(pending.surfaces[0]!.surfaceId, /:request:req-/, "submit sends the Booking Request");
      assert.deepEqual(pending.receipts, ["Booking Request sent"]);

      // The Operator accepts; the guest sees the offer.
      const requestId = pending.surfaces[0]!.surfaceId.split(":").at(-1)!;
      f.environment.simulateOperatorAcceptance(requestId);
      const offerState = mode === "same-process" ? f.app.getState(threadId) : restartedDatedApp(f, scriptedPlanner({}).client).app.getState(threadId);
      assert.ok(offerState, "the conversation is still readable");
      assert.match(offerState.surfaces[0]!.summary ?? "", /Offer/i, "the accepted request shows its offer");

      // Accept the offer: the payment is ready to hand off.
      const payment = await step(f, mode, threadId, offerState.surfaces[0]!, "Accept offer");
      assert.match(payment.surfaces[0]!.summary ?? "", /payment/i);
      const handoff = await step(f, mode, threadId, payment.surfaces[0]!, "Payment handoff");
      assert.match(handoff.surfaces[0]!.textFallback ?? "", /payment handoff ready|payment has not succeeded/i);
      assert.doesNotMatch(handoff.surfaces[0]!.textFallback ?? "", /checkout_initiated|Payment status:/i);

      // The PSP return shows the stay's deposit disclosure; a repeated return from the same handoff fails closed (ADR 0046).
      const returned = await step(f, mode, threadId, handoff.surfaces[0]!, "Payment return");
      assert.match(returned.messages.join(" "), /separate Refundable Security Deposit/i);
      const repeated = await send(f, mode, threadId, handoff.surfaces[0]!);
      assert.equal(repeated.ok, false, "a repeated return from the handoff is refused");

      // Verification confirms the payment and the Reservation.
      const verifying = await step(f, mode, threadId, returned.surfaces[0]!, "Verify payment");
      const confirmed = await step(f, mode, threadId, verifying.surfaces[0]!, "Confirm payment");
      assert.deepEqual(confirmed.receipts, ["Payment verified"]);
      assert.match(confirmed.surfaces[0]!.summary ?? "", /Reservation confirmed/i);
    } finally { f.close(); }
  });

  // The planner opens a unit's details itself (get_unit_details), not through the View button. Its Request to Book
  // must still be authorized by the thread, in the same process and after a cold restore (ADR 0106).
  test(`a unit the planner opens keeps its Request to Book authorized (${mode})`, async () => {
    const f = datedFixture(scriptedPlanner(SCRIPT).client);
    try {
      const threadId = "g-d1a0000202";
      successOf(await f.app.handleTurn(threadId, LEKKI_TEXT));
      const details = successOf(await f.app.handleTurn(threadId, LEKKI_DETAILS_TEXT));
      assert.match(details.surfaces[0]!.surfaceId, /:unit:detail/, "the planner opens the unit detail");
      const draft = await step(f, mode, threadId, details.surfaces[0]!, "Request to Book");
      assert.match(draft.surfaces[0]!.surfaceId, /:request:draft:/, "Request to Book opens the draft from the planner's detail");
    } finally { f.close(); }
  });

  // A criteria-strip edit runs the shell's own search on an assistant thread; its new card must stay openable after a restore.
  test(`a criteria edit's new results keep their card openable after a cold restore (${mode})`, async () => {
    const f = datedFixture(scriptedPlanner(SCRIPT).client);
    try {
      const threadId = "g-d1a0000205";
      const search = successOf(await f.app.handleTurn(threadId, LEKKI_TEXT));
      assert.ok(search.criteria, "the search reports its criteria");
      const edited = successOf(await f.app.handleEventAsync(threadId, {
        name: CRITERIA_EDIT_EVENT,
        surfaceId: criteriaSurfaceId(threadId),
        sourceComponentId: "criteria-strip",
        timestamp: new Date().toISOString(),
        context: { field: "guests", partySize: 1, basedOn: search.criteria.key },
      }));
      const card = edited.surfaces[0];
      assert.ok(card, "the edit re-runs the search and shows its results");
      const opened = await step(f, mode, threadId, card, "View after edit");
      assert.match(opened.surfaces[0]!.surfaceId, /:unit:detail:/, "the edited results open their unit");
    } finally { f.close(); }
  });

  test(`the discovery card the planner supersedes by opening a unit fails closed (${mode})`, async () => {
    const f = datedFixture(scriptedPlanner(SCRIPT).client);
    try {
      const threadId = "g-d1a0000203";
      const search = successOf(await f.app.handleTurn(threadId, LEKKI_TEXT));
      successOf(await f.app.handleTurn(threadId, LEKKI_DETAILS_TEXT));
      const stale = await send(f, mode, threadId, search.surfaces[0]!);
      assert.equal(stale.ok, false);
      assert.equal(stale.ok ? "" : stale.code, "STALE_SURFACE");
    } finally { f.close(); }
  });
}
