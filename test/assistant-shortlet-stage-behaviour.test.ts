import assert from "node:assert/strict";
import test from "node:test";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { AssistantRuntime, type AssistantDiagnosticEvent } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import type { AssistantModelResponse } from "../apps/local-guest/src/assistant/assistant-model.js";
import { approvedTestScope } from "./helpers/assistant-scope.js";
import { RecordingTurnModel, STAGING_LIKE_START, SteppedClock } from "./helpers/assistant-turn-model.js";

/**
 * Shortlet stage behaviour through the real runtime (issue 04 follow-up). Each test pins one handler's supersede rule or its
 * diagnostic, so removing that line in the handler fails here, not only in the shortlet evals.
 */

const THREAD = "thread-shortlet-stage";
const STAGING_DEMO_CHECK_IN = "2026-12-20";
const SEARCH: AssistantModelResponse = { toolCalls: [{ id: "call-search", name: "search_stays", args: { city: "Lagos", neighbourhood: "Old Ikoyi", checkIn: null, nights: 4, guests: 2 } }] };
const REPLY: AssistantModelResponse = { text: JSON.stringify({ kind: "show_results", references: ["search_stays"] }) };

function open(plan: (index: number) => AssistantModelResponse) {
  const model = new RecordingTurnModel((_request, index) => plan(index));
  const environment = LocalGuestEnvironment.openNode({
    databasePath: ":memory:",
    clock: new SteppedClock(STAGING_LIKE_START).now,
    demoCheckIn: STAGING_DEMO_CHECK_IN,
    initialGuestPhoneNumber: null,
    initialGuestContactEmail: null,
  });
  const diagnostics: AssistantDiagnosticEvent[] = [];
  const runtime = new AssistantRuntime(environment, model, { scopeClassifier: approvedTestScope, onDiagnostic: (event) => diagnostics.push(event) });
  return { environment, runtime, diagnostics };
}

test("a second shortlet search supersedes the first discovery surface (discovery handler retires its stages)", async () => {
  // Planner requests: 0 search, 1 reply, 2 search, 3 reply.
  const { environment, runtime } = open((index) => index % 2 === 0 ? SEARCH : REPLY);
  try {
    const first = await runtime.handleTurn(THREAD, "Find stays in Old Ikoyi");
    const firstId = first.surfaces?.[0]?.surfaceId ?? "";
    assert.match(firstId, /:discovery:/);
    const second = await runtime.handleTurn(THREAD, "Find stays in Old Ikoyi again");
    const secondId = second.surfaces?.[0]?.surfaceId ?? "";
    assert.notEqual(secondId, firstId);
    const thread = runtime.getThread(THREAD);
    assert.equal(thread.supersededSurfaces.has(firstId), true, "the earlier search surface is superseded");
    assert.equal(thread.activeSurfaces.get("discovery"), secondId);
  } finally { environment.close(); }
});

test("a unit detail call supersedes the discovery and the earlier unit surface (unit handler retires its stages)", async () => {
  let runtime: AssistantRuntime | undefined;
  // 0 search, 1 reply, 2 unit details of the first shortlisted stay, 3 reply.
  const opened = open((index) => {
    if (index === 2) {
      const stayRef = runtime?.getThread(THREAD).taskState.shortlist[0]?.stayRef ?? "";
      return { toolCalls: [{ id: "call-unit", name: "get_unit_details", args: { stayRef } }] };
    }
    return index % 2 === 0 ? SEARCH : REPLY;
  });
  runtime = opened.runtime;
  try {
    const search = await opened.runtime.handleTurn(THREAD, "Find stays in Old Ikoyi");
    const discoveryId = search.surfaces?.[0]?.surfaceId ?? "";
    const unit = await opened.runtime.handleTurn(THREAD, "Tell me about the first stay");
    const unitId = unit.surfaces?.[0]?.surfaceId ?? "";
    assert.equal(unitId, `thread-${THREAD}:unit:detail`);
    const thread = opened.runtime.getThread(THREAD);
    assert.equal(thread.supersededSurfaces.has(discoveryId), true, "the discovery surface is superseded by the unit detail");
    assert.equal(thread.activeSurfaces.get("unit"), unitId);
  } finally { opened.environment.close(); }
});

test("a shortlet prepare_request_draft reports its authoritative effect code in the tool diagnostics", async () => {
  let runtime: AssistantRuntime | undefined;
  // 0 search, 1 reply, 2 unit details, 3 reply, 4 request draft for the first stay, 5 reply.
  const opened = open((index) => {
    const stayRef = runtime?.getThread(THREAD).taskState.shortlist[0]?.stayRef ?? "";
    if (index === 2) return { toolCalls: [{ id: "call-unit", name: "get_unit_details", args: { stayRef } }] };
    if (index === 4) return { toolCalls: [{ id: "call-draft", name: "prepare_request_draft", args: { stayRef, nights: 4, guests: 2 } }] };
    return index % 2 === 0 ? SEARCH : REPLY;
  });
  runtime = opened.runtime;
  try {
    await opened.runtime.handleTurn(THREAD, "Find stays in Old Ikoyi");
    await opened.runtime.handleTurn(THREAD, "Tell me about the first stay");
    const draft = await opened.runtime.handleTurn(THREAD, "Prepare a request draft for it");
    assert.equal(draft.ok, true);
    assert.match(draft.surfaces?.[0]?.surfaceId ?? "", /:request:draft:/);
    const effect = opened.diagnostics.find((event) => event.toolName === "prepare_request_draft" && event.succeeded === true);
    assert.equal(effect?.effectCode, "request_draft_created_availability_checked_not_reserved");
  } finally { opened.environment.close(); }
});
