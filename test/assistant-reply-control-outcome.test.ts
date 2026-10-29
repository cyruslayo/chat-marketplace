import assert from "node:assert/strict";
import test from "node:test";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { AssistantRuntime, type AssistantDiagnosticEvent } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import { ShortletAssistantRuntime } from "./helpers/assistant-runtime-host.js";
import type { AssistantModelResponse } from "../apps/local-guest/src/assistant/assistant-model.js";
import { approvedTestScope } from "./helpers/assistant-scope.js";
import { createFakeShopPack } from "./helpers/fake-domain-pack.js";
import { RecordingTurnModel, STAGING_LIKE_START, SteppedClock } from "./helpers/assistant-turn-model.js";

/**
 * ADR 0106 control outcomes that a pack names for a reply (issue 04 follow-up). A booking status with no active booking is
 * reported as `no_current_booking` whichever task is open when the reply is written, as the platform checked it before the
 * pack hook existed.
 */

const STATUS_CALL: AssistantModelResponse = { toolCalls: [{ id: "call-status", name: "get_booking_status", args: {} }] };
const STATUS_REPLY: AssistantModelResponse = { text: JSON.stringify({ kind: "show_status", references: ["get_booking_status"] }) };

function open(model: RecordingTurnModel, extraPacks: ReturnType<typeof createFakeShopPack>[] = []) {
  const environment = LocalGuestEnvironment.openNode({
    databasePath: ":memory:",
    clock: new SteppedClock(STAGING_LIKE_START).now,
    initialGuestPhoneNumber: null,
    initialGuestContactEmail: null,
  });
  const diagnostics: AssistantDiagnosticEvent[] = [];
  const runtime = new ShortletAssistantRuntime(environment, model, {
    additionalPacks: extraPacks,
    scopeClassifier: approvedTestScope,
    onDiagnostic: (event) => diagnostics.push(event),
  });
  return { environment, runtime, diagnostics };
}

test("criterion 6 (issue 04 follow-up): a shortlet status with no active booking is reported as no_current_booking", async () => {
  const model = new RecordingTurnModel((_request, index) => index === 0 ? STATUS_CALL : STATUS_REPLY);
  const { environment, runtime } = open(model);
  try {
    const output = await runtime.handleTurn("thread-status-shortlet", "Do I have a booking?");
    assert.equal(output.ok, true);
    assert.equal(output.controlOutcome, "no_current_booking");
  } finally { environment.close(); }
});

test("criterion 6 (issue 04 follow-up): a no-booking status followed by a task switch is still reported as no_current_booking", async () => {
  // One round: the shortlet status (no booking), then a switch to the shop task. The reply is written with the shop task open,
  // and the registered shortlet pack still names the outcome, as it did before the split.
  const model = new RecordingTurnModel((_request, index) => index === 0
    ? { toolCalls: [
      { id: "call-status-first", name: "get_booking_status", args: {} },
      { id: "call-switch", name: "start_task", args: { domain: "shop" } },
    ] }
    : { text: JSON.stringify({ kind: "support_guidance", references: ["get_booking_status"] }) });
  const { environment, runtime } = open(model, [createFakeShopPack()]);
  try {
    const output = await runtime.handleTurn("thread-status-then-switch", "Do I have a booking?");
    assert.equal(output.ok, true);
    assert.equal(runtime.getThread("thread-status-then-switch").tasks.some((task) => task.domain === "shop"), true, "the switch must have happened");
    assert.equal(output.controlOutcome, "no_current_booking", "the outcome is not replaced by the open task's reply kind");
  } finally { environment.close(); }
});
