import assert from "node:assert/strict";
import test from "node:test";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { AssistantRuntime } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import { pendingProposalAuthorised, TASK_START_EVENT, type AssistantDomainPack } from "../apps/local-guest/src/assistant/assistant-platform.js";
import type { PendingAssistantAction } from "../apps/local-guest/src/assistant/pending-actions.js";
import { ASSISTANT_CONFIRM_ACTION_EVENT } from "../apps/local-guest/src/assistant/pending-action-a2ui.js";
import { createFakeShopPack } from "./helpers/fake-domain-pack.js";
import { RecordingTurnModel, STAGING_LIKE_START, SteppedClock } from "./helpers/assistant-turn-model.js";

/**
 * ADR 0099 section 6 (issue 04 decision b): the host is the composition root. The runtime constructs no Shortlet pack, and the
 * proposal-authority rule is a pack hook (ADR 0074), not a Shortlet import. A pack without the hook fails closed.
 */

const THREAD = "thread-host-composition";
const SEARCH_CALL = { toolCalls: [{ id: "call-shortlet", name: "search_stays", args: { city: "Lagos", neighbourhood: "Old Ikoyi", checkIn: null, nights: 4, guests: 2 } }] };

function openWith(packs: readonly AssistantDomainPack[], model: RecordingTurnModel) {
  const environment = LocalGuestEnvironment.openNode({
    databasePath: ":memory:",
    clock: new SteppedClock(STAGING_LIKE_START).now,
    initialGuestPhoneNumber: null,
    initialGuestContactEmail: null,
  });
  // The host passes its packs; the runtime adds none of its own.
  const runtime = new AssistantRuntime(environment, model, { packs });
  return { environment, runtime };
}

function pendingProposal(environment: LocalGuestEnvironment): PendingAssistantAction {
  return {
    id: "pa-host-1", threadId: THREAD, guestActorId: environment.config.guestId, tenantId: environment.config.tenantId,
    type: "request_to_book", authoritativeReferences: {}, summary: "Request this stay.",
    createdAt: "2026-10-27T08:30:00Z", expiresAt: "2026-10-27T12:00:00Z", executed: false,
  };
}

test("the runtime constructs no Shortlet pack: a runtime given only a fake pack registers only that pack", () => {
  const { environment, runtime } = openWith([createFakeShopPack()], new RecordingTurnModel(() => ({ text: "{}" })));
  try {
    assert.deepEqual(runtime.registeredVerticals().map((vertical) => vertical.domain), ["shop"]);
  } finally { environment.close(); }
});

test("a runtime without the Shortlet pack refuses a Shortlet tool fail closed, without throwing", async () => {
  const { environment, runtime } = openWith([createFakeShopPack()], new RecordingTurnModel((_request, index) => index === 0 ? SEARCH_CALL : { text: JSON.stringify({ kind: "clarify_stay", references: [] }) }));
  try {
    const output = await runtime.handleTurn(THREAD, "Find stays in Old Ikoyi");
    assert.equal(output.ok, true);
    assert.equal(output.controlOutcome, "tool_denial", "search_stays is not offered by the fake pack, so the call is denied");
  } finally { environment.close(); }
});

test("a runtime without the Shortlet pack refuses a Shortlet confirmation as an unsupported action, without throwing", () => {
  const { environment, runtime } = openWith([createFakeShopPack()], new RecordingTurnModel(() => ({ text: "{}" })));
  try {
    runtime.handleAssistantEvent(THREAD, TASK_START_EVENT, { domain: "shop" });
    const thread = runtime.getThread(THREAD);
    thread.taskState.pendingAction = pendingProposal(environment);
    thread.activeSurfaces.set("pending_action", `thread-${THREAD}:pending-action:pa-host-1`);
    const output = runtime.handleAssistantEvent(THREAD, ASSISTANT_CONFIRM_ACTION_EVENT, {
      surfaceId: `thread-${THREAD}:pending-action:pa-host-1`, actionId: "pa-host-1",
    });
    assert.equal(output.ok, false);
    assert.equal(output.code, "UNSUPPORTED_ACTION");
  } finally { environment.close(); }
});

test("a pack's proposal hook decides whether an open proposal survives a discovery change (ADR 0074)", () => {
  const kept = { ...createFakeShopPack(), proposalStillAuthorised: () => true };
  const { environment, runtime } = openWith([kept], new RecordingTurnModel(() => ({ text: "{}" })));
  try {
    runtime.handleAssistantEvent(THREAD, TASK_START_EVENT, { domain: "shop" });
    runtime.getThread(THREAD).taskState.pendingAction = pendingProposal(environment);
    runtime.applyDiscoveryShortlist(THREAD, []);
    assert.equal(runtime.getThread(THREAD).taskState.pendingAction?.id, "pa-host-1", "a pack that confirms the proposal keeps it");
  } finally { environment.close(); }
});

test("a pack without the proposal hook fails closed: the open proposal is treated as not authorised", () => {
  const { environment, runtime } = openWith([createFakeShopPack()], new RecordingTurnModel(() => ({ text: "{}" })));
  try {
    runtime.handleAssistantEvent(THREAD, TASK_START_EVENT, { domain: "shop" });
    runtime.getThread(THREAD).taskState.pendingAction = pendingProposal(environment);
    runtime.applyDiscoveryShortlist(THREAD, []);
    const state = runtime.getThread(THREAD).taskState;
    assert.equal(state.pendingAction, null, "the proposal is removed, never kept by default");
    assert.equal(state.replacedPendingAction?.id, "pa-host-1");
  } finally { environment.close(); }
});

test("pendingProposalAuthorised: no proposal is authorised; a proposal needs the pack's hook to say so", () => {
  const state = { goal: null, stayIntent: {}, shortlist: [], pendingAction: null, replacedPendingAction: null } as unknown as Parameters<typeof pendingProposalAuthorised>[1];
  assert.equal(pendingProposalAuthorised(createFakeShopPack(), state), true);
  const withProposal = { ...state, pendingAction: { id: "pa-x" } } as unknown as Parameters<typeof pendingProposalAuthorised>[1];
  assert.equal(pendingProposalAuthorised(createFakeShopPack(), withProposal), false);
  assert.equal(pendingProposalAuthorised({ ...createFakeShopPack(), proposalStillAuthorised: () => true }, withProposal), true);
});
