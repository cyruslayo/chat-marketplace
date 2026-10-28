import assert from "node:assert/strict";
import test from "node:test";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { AssistantRuntime } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import { TASK_START_EVENT, type AssistantDomainPack } from "../apps/local-guest/src/assistant/assistant-platform.js";
import { createFakeShopPack } from "./helpers/fake-domain-pack.js";
import { RecordingTurnModel, STAGING_LIKE_START, SteppedClock } from "./helpers/assistant-turn-model.js";

/**
 * ADR 0099 section 3 (issue 04 follow-up): a pack's platform action runs only when the pack names it, the action is in the
 * pack's own namespace, the pack has a handler, and the active surface is the pack's own. Refusals return STALE_SURFACE and
 * never reach the handler.
 */

const THREAD = "thread-platform-gate";
const CHECKOUT_SURFACE = `thread-${THREAD}:checkout`;

/** A second pack that names a platform action, possibly one owned by another pack. */
function actingPack(actionNames: readonly string[], handled: string[]): AssistantDomainPack {
  return {
    ...createFakeShopPack(),
    platformActionNames: actionNames,
    handlePlatformAction: ({ actionName, activeSurfaceId }) => {
      handled.push(`${actionName}@${activeSurfaceId ?? ""}`);
      return { ok: true, message: "Done.", surface: { surfaceId: `${actionName}:result`, a2uiMessages: [] } };
    },
  };
}

function openGate(pack: AssistantDomainPack) {
  const environment = LocalGuestEnvironment.openNode({
    databasePath: ":memory:",
    clock: new SteppedClock(STAGING_LIKE_START).now,
    initialGuestPhoneNumber: null,
    initialGuestContactEmail: null,
  });
  const runtime = new AssistantRuntime(environment, new RecordingTurnModel(() => ({ text: "{}" })), { additionalPacks: [pack] });
  runtime.handleAssistantEvent(THREAD, TASK_START_EVENT, { domain: "shop" });
  return { environment, runtime };
}

test("a pack refuses a platform action that another pack owns, before its handler runs", () => {
  const handled: string[] = [];
  const { environment, runtime } = openGate(actingPack(["commerce.checkout.confirm"], handled));
  try {
    const thread = runtime.getThread(THREAD);
    const taskId = thread.activeTaskId;
    thread.activeSurfaces.set("shop:checkout", CHECKOUT_SURFACE);
    const output = runtime.handleAssistantEvent(THREAD, "commerce.checkout.confirm", { surfaceId: CHECKOUT_SURFACE, taskId, proposalId: "p1" });
    assert.equal(output.ok, false);
    assert.equal(output.code, "STALE_SURFACE");
    assert.deepEqual(handled, [], "the other pack's action never reaches the acting pack's handler");
  } finally { environment.close(); }
});

test("a pack runs its own namespaced platform action on its own surface", () => {
  const handled: string[] = [];
  const { environment, runtime } = openGate(actingPack(["shop.checkout.confirm"], handled));
  try {
    const thread = runtime.getThread(THREAD);
    const taskId = thread.activeTaskId;
    thread.activeSurfaces.set("shop:checkout", CHECKOUT_SURFACE);
    const output = runtime.handleAssistantEvent(THREAD, "shop.checkout.confirm", { surfaceId: CHECKOUT_SURFACE, taskId, proposalId: "p1" });
    assert.equal(output.ok, true);
    assert.deepEqual(handled, [`shop.checkout.confirm@${CHECKOUT_SURFACE}`]);
  } finally { environment.close(); }
});

test("a pack's own action is refused when the active surface is not the pack's own checkout surface", () => {
  const handled: string[] = [];
  const { environment, runtime } = openGate(actingPack(["shop.checkout.confirm"], handled));
  try {
    const thread = runtime.getThread(THREAD);
    const taskId = thread.activeTaskId;
    // The surface key names another pack's stage, so this pack has no active checkout surface.
    thread.activeSurfaces.set("commerce:checkout", CHECKOUT_SURFACE);
    const output = runtime.handleAssistantEvent(THREAD, "shop.checkout.confirm", { surfaceId: CHECKOUT_SURFACE, taskId, proposalId: "p1" });
    assert.equal(output.code, "STALE_SURFACE");
    assert.deepEqual(handled, []);
  } finally { environment.close(); }
});

test("a pack declaring the action without a handler is refused", () => {
  const handled: string[] = [];
  const pack: AssistantDomainPack = { ...actingPack(["shop.checkout.confirm"], handled), handlePlatformAction: undefined };
  const { environment, runtime } = openGate(pack);
  try {
    const thread = runtime.getThread(THREAD);
    thread.activeSurfaces.set("shop:checkout", CHECKOUT_SURFACE);
    const output = runtime.handleAssistantEvent(THREAD, "shop.checkout.confirm", { surfaceId: CHECKOUT_SURFACE, taskId: thread.activeTaskId });
    assert.equal(output.code, "STALE_SURFACE");
  } finally { environment.close(); }
});
