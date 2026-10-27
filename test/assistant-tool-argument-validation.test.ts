import assert from "node:assert/strict";
import test from "node:test";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { AssistantRuntime, type AssistantDiagnosticEvent } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import { ScriptedAssistantModel } from "../apps/local-guest/src/assistant/scripted-assistant-model.js";
import type { AssistantToolParameterProperty, AssistantToolParametersSchema, AssistantToolResult } from "../apps/local-guest/src/assistant/assistant-model.js";
import type { AssistantThreadState } from "../apps/local-guest/src/assistant/assistant-state.js";
import { PLATFORM_TASK_TOOLS, TASK_START_EVENT, type AssistantDomainPack } from "../apps/local-guest/src/assistant/assistant-platform.js";
import { findToolArgumentViolation, toolArgumentFailureMessage } from "../apps/local-guest/src/assistant/assistant-tool-arguments.js";
import { ASSISTANT_TOOL_DEFINITIONS, createShortletAssistantPack } from "../apps/local-guest/src/assistant/shortlet-assistant-pack.js";
import { createCommerceAssistantPack } from "../apps/local-guest/src/assistant/commerce-assistant-pack.js";
import { COMMERCE_TEST_REFERENCE_KEYS, migrateCommerceDatabase } from "./helpers/commerce-database.js";
import { createFakeShopPack } from "./helpers/fake-domain-pack.js";

const SEARCH_SCHEMA = ASSISTANT_TOOL_DEFINITIONS.find((tool) => tool.name === "search_stays")!.parametersSchema;
const VALID_SEARCH = { city: "Lagos", neighbourhood: "Old Ikoyi", checkIn: null, nights: 4, guests: 2 };

/**
 * Scripted planner: a user turn whose text contains a key makes the model call the mapped tool;
 * every tool result sent back to the model is captured in order and answered with a plain plan.
 */
function scriptedToolModel(turns: Readonly<Record<string, { readonly name: string; readonly args: Record<string, unknown> }>>, captured: AssistantToolResult[]): ScriptedAssistantModel {
  return new ScriptedAssistantModel([(request) => {
    const last = request.history.at(-1);
    if (last?.role === "tool_results") {
      captured.push(...last.results);
      return { text: JSON.stringify({ kind: "clarify_stay", references: [] }) };
    }
    if (last?.role === "user") {
      const key = Object.keys(turns).find((candidate) => last.text.includes(candidate));
      const turn = key === undefined ? undefined : turns[key];
      if (turn) return { toolCalls: [{ id: `call-${key}`, name: turn.name, args: turn.args }] };
    }
    return null;
  }]);
}

/** Runs one planner turn whose only model tool call is `name` with `args`, and captures what the model receives back. */
async function runRejectedCall(name: string, args: Record<string, unknown>, text = "Find stays in Old Ikoyi Broken") {
  const env = LocalGuestEnvironment.openNode({ databasePath: ":memory:" });
  const diagnostics: AssistantDiagnosticEvent[] = [];
  const results: AssistantToolResult[] = [];
  try {
    const model = scriptedToolModel({ Broken: { name, args } }, results);
    const runtime = new AssistantRuntime(env, model, { onDiagnostic: (event) => diagnostics.push(event) });
    const response = await runtime.handleTurn("argument-validation", text);
    return { response, diagnostics, results, runtime };
  } finally {
    env.close();
  }
}

function executedToolCount(diagnostics: readonly AssistantDiagnosticEvent[]): number {
  return diagnostics.filter((event) => event.stage === "application_operation" && event.succeeded).length;
}

function threadSnapshot(thread: AssistantThreadState): string {
  return JSON.stringify({
    taskState: thread.taskState,
    activeTaskId: thread.activeTaskId,
    tasks: thread.tasks,
    activeSurfaces: thread.activeSurfaces,
    supersededSurfaces: thread.supersededSurfaces,
    lastSurfaces: thread.lastSurfaces,
    discoveryArtifactId: thread.discoveryArtifactId,
  }, (_key, value: unknown) => value instanceof Map || value instanceof Set ? [...value] : value);
}

/** A valid argument object for a schema: every required property gets the smallest value its declared type allows. */
function sampleArguments(schema: AssistantToolParametersSchema): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const key of schema.required ?? []) args[key] = sampleValue(schema.properties[key]!);
  return args;
}

function sampleValue(schema: AssistantToolParameterProperty): unknown {
  const types = typeof schema.type === "string" ? [schema.type] : schema.type;
  const type = types.find((candidate) => candidate !== "null") ?? "null";
  switch (type) {
    case "string": return schema.enum?.[0] ?? "sample";
    case "integer":
    case "number": return schema.minimum ?? Math.min(1, schema.maximum ?? 1);
    case "boolean": return true;
    case "array": return schema.items ? Array.from({ length: schema.minItems ?? 0 }, () => sampleValue(schema.items!)) : [];
    case "object": return sampleArguments({ type: "object", properties: schema.properties ?? {}, required: schema.required, additionalProperties: schema.additionalProperties });
    default: return null;
  }
}

test("a tool call with a missing required argument is rejected before the tool runs, and the model receives an invalid_arguments error naming the field", async () => {
  const { response, diagnostics, results } = await runRejectedCall("search_stays", { nights: 4, guests: 2 });

  assert.equal(response.ok, true);
  assert.equal(executedToolCount(diagnostics), 0);
  assert.equal(results[0]?.isError, true);
  assert.equal(results[0]?.result.error, "invalid_arguments");
  assert.match(String(results[0]?.result.message), /"city"/);
});

test("a tool call with an argument of the wrong type is rejected before the tool runs", async () => {
  const { response, diagnostics, results } = await runRejectedCall("search_stays", { city: "Lagos", nights: "four", guests: 2 });

  assert.equal(response.ok, true);
  assert.equal(executedToolCount(diagnostics), 0);
  assert.equal(results[0]?.result.error, "invalid_arguments");
  assert.equal(results[0]?.isError, true);
});

test("a numeric argument outside minimum/maximum is rejected before the tool runs", async () => {
  const { diagnostics, results } = await runRejectedCall("search_stays", { city: "Lagos", nights: 99, guests: 2 });

  assert.equal(executedToolCount(diagnostics), 0);
  assert.equal(results[0]?.result.error, "invalid_arguments");
  assert.match(String(results[0]?.result.message), /"nights"/);
  assert.equal(findToolArgumentViolation(SEARCH_SCHEMA, { city: "Lagos", nights: 0 })?.reason, "range");
});

test("an unknown argument is rejected when the schema sets additionalProperties false, and accepted when it does not", () => {
  const withUnknown = { ...VALID_SEARCH, unexpectedField: "x" };
  assert.equal(findToolArgumentViolation(SEARCH_SCHEMA, withUnknown)?.reason, "unknown");

  const open: AssistantToolParametersSchema = { type: "object", properties: { city: { type: "string" } }, required: ["city"] };
  assert.equal(findToolArgumentViolation(open, { city: "Lagos", unexpectedField: "x" }), undefined);
});

test("a union type such as [integer, null] accepts each listed type and rejects others", () => {
  const schema: AssistantToolParametersSchema = {
    type: "object",
    properties: { count: { type: ["integer", "null"] } },
    required: ["count"],
    additionalProperties: false,
  };

  assert.equal(findToolArgumentViolation(schema, { count: 3 }), undefined);
  assert.equal(findToolArgumentViolation(schema, { count: null }), undefined);
  for (const rejected of ["3", 3.5, true, {}, []]) {
    assert.equal(findToolArgumentViolation(schema, { count: rejected })?.reason, "type", JSON.stringify(rejected));
  }
});

test("a rejected call leaves the thread's task state and surfaces unchanged and records a failed tool_execution diagnostic", async () => {
  const env = LocalGuestEnvironment.openNode({ databasePath: ":memory:" });
  const diagnostics: AssistantDiagnosticEvent[] = [];
  try {
    const model = scriptedToolModel({
      "Find stays": { name: "search_stays", args: VALID_SEARCH },
      Broken: { name: "search_stays", args: { city: "Lagos", nights: "four" } },
    }, []);
    const runtime = new AssistantRuntime(env, model, { onDiagnostic: (event) => diagnostics.push(event) });
    await runtime.handleTurn("argument-validation-state", "Find stays in Old Ikoyi");
    const before = runtime.getThread("argument-validation-state");
    assert.ok(before.activeSurfaces.size > 0, "a valid search must leave surfaces so the comparison is meaningful");
    const snapshotBefore = threadSnapshot(before);
    diagnostics.length = 0;

    const response = await runtime.handleTurn("argument-validation-state", "Broken search for Old Ikoyi");

    assert.equal(response.ok, true);
    assert.equal(threadSnapshot(runtime.getThread("argument-validation-state")), snapshotBefore);
    assert.ok(diagnostics.some((event) => event.stage === "tool_execution" && event.succeeded === false && event.failureClass === "MODEL_SELECTION_FAILURE"));
  } finally {
    env.close();
  }
});

test("the error message and the diagnostic do not contain the rejected argument's value", async () => {
  const canary = "PRIVATE_ARGUMENT_CANARY_7319";
  const { diagnostics, results } = await runRejectedCall("search_stays", { city: "Lagos", nights: canary, guests: 2 });

  assert.equal(results[0]?.result.error, "invalid_arguments");
  assert.doesNotMatch(JSON.stringify(results), new RegExp(canary));
  assert.doesNotMatch(JSON.stringify(diagnostics), new RegExp(canary));
  assert.doesNotMatch(toolArgumentFailureMessage({ field: "nights", reason: "type" }), new RegExp(canary));
});

// Sample-based: this checks that the validator accepts a sample built from each declared schema.
// It does not exercise real pack calls; the runtime tests below cover those.
test("every existing tool definition in the shortlet and commerce packs is accepted by the validator for a valid call", () => {
  const env = LocalGuestEnvironment.openNode({ databasePath: ":memory:" });
  try {
    migrateCommerceDatabase(env.database);
    const shortlet = createShortletAssistantPack(env);
    const commerce = createCommerceAssistantPack({ database: env.database, clock: env.clock, paymentReferenceKeys: COMMERCE_TEST_REFERENCE_KEYS });
    const packs: readonly AssistantDomainPack[] = [shortlet, commerce];
    let walked = 0;
    for (const pack of packs) {
      for (const name of pack.toolNames) {
        const definition = pack.toolDefinition?.(name);
        assert.ok(definition, `${pack.id}:${name} has a declared schema`);
        const args = sampleArguments(definition.parametersSchema);
        assert.equal(findToolArgumentViolation(definition.parametersSchema, args), undefined, `${pack.id}:${name}`);
        walked++;
      }
    }
    for (const tool of PLATFORM_TASK_TOOLS) {
      assert.equal(findToolArgumentViolation(tool.parametersSchema, sampleArguments(tool.parametersSchema)), undefined, tool.name);
      walked++;
    }
    assert.ok(walked >= ASSISTANT_TOOL_DEFINITIONS.length + PLATFORM_TASK_TOOLS.length);
  } finally {
    env.close();
  }
});

test("a switch_task call with a numeric taskId is rejected before the task-tool path changes any task", async () => {
  const env = LocalGuestEnvironment.openNode({ databasePath: ":memory:" });
  const results: AssistantToolResult[] = [];
  try {
    const model = scriptedToolModel({ "Switch broken": { name: "switch_task", args: { taskId: 7 } } }, results);
    const runtime = new AssistantRuntime(env, model, { additionalPacks: [createFakeShopPack()] });
    // A second task exists, so an unchecked switch would reach the task lookup (UNKNOWN_TASK) rather than change anything.
    assert.equal(runtime.handleAssistantEvent("task-switch-numeric", TASK_START_EVENT, { domain: "shop" }).ok, true);
    assert.equal(runtime.getThread("task-switch-numeric").tasks.length, 2);
    const before = runtime.getThread("task-switch-numeric");
    const snapshotBefore = threadSnapshot(before);

    const response = await runtime.handleTurn("task-switch-numeric", "Switch broken");

    assert.equal(response.ok, true);
    assert.equal(results[0]?.isError, true);
    assert.equal(results[0]?.result.error, "invalid_arguments", "validation runs before the task-tool path, so UNKNOWN_TASK never appears");
    assert.equal(threadSnapshot(runtime.getThread("task-switch-numeric")), snapshotBefore);
  } finally {
    env.close();
  }
});

test("a start_task call without its required domain is rejected before any task is created", async () => {
  const env = LocalGuestEnvironment.openNode({ databasePath: ":memory:" });
  const results: AssistantToolResult[] = [];
  try {
    const model = scriptedToolModel({ "Start broken": { name: "start_task", args: {} } }, results);
    const runtime = new AssistantRuntime(env, model, { additionalPacks: [createFakeShopPack()] });
    const before = runtime.getThread("task-start-missing-domain");
    const snapshotBefore = threadSnapshot(before);
    const taskCountBefore = before.tasks.length;

    const response = await runtime.handleTurn("task-start-missing-domain", "Start broken");

    assert.equal(response.ok, true);
    assert.equal(results[0]?.result.error, "invalid_arguments");
    assert.match(String(results[0]?.result.message), /"domain"/);
    const after = runtime.getThread("task-start-missing-domain");
    assert.equal(after.tasks.length, taskCountBefore);
    assert.equal(threadSnapshot(after), snapshotBefore);
  } finally {
    env.close();
  }
});

test("a commerce tool call with bad arguments is rejected before the pack's validateToolCall or executeTool runs", async () => {
  const env = LocalGuestEnvironment.openNode({ databasePath: ":memory:" });
  const results: AssistantToolResult[] = [];
  try {
    migrateCommerceDatabase(env.database);
    const base = createCommerceAssistantPack({ database: env.database, clock: env.clock, paymentReferenceKeys: COMMERCE_TEST_REFERENCE_KEYS });
    let validations = 0;
    let executions = 0;
    const spied: AssistantDomainPack = {
      ...base,
      validateToolCall: (name, args) => { validations++; return base.validateToolCall(name, args); },
      executeTool: (name, args, context) => { executions++; return base.executeTool(name, args, context); },
    };
    const model = scriptedToolModel({ "Details broken": { name: "get_offer", args: { offerId: 42 } } }, results);
    const runtime = new AssistantRuntime(env, model, { additionalPacks: [spied] });
    assert.equal(runtime.handleAssistantEvent("commerce-bad-args", TASK_START_EVENT, { domain: "commerce" }).ok, true);
    results.length = 0;
    validations = 0;
    executions = 0;

    const response = await runtime.handleTurn("commerce-bad-args", "Details broken");

    assert.equal(response.ok, true);
    assert.equal(results[0]?.result.error, "invalid_arguments");
    assert.match(String(results[0]?.result.message), /"offerId"/);
    assert.equal(validations, 0, "validateToolCall must not be reached for a rejected commerce call");
    assert.equal(executions, 0, "executeTool must not run for a rejected commerce call");
  } finally {
    env.close();
  }
});

test("a shortlet tool call with bad arguments is rejected before the shortlet precondition check", async () => {
  const env = LocalGuestEnvironment.openNode({ databasePath: ":memory:" });
  const results: AssistantToolResult[] = [];
  try {
    // A fresh thread has no shortlist, so an unchecked call would fail the shortlet precondition with invalid_tool_for_state.
    const model = scriptedToolModel({ "Open broken": { name: "get_unit_details", args: { stayRef: 5 } } }, results);
    const runtime = new AssistantRuntime(env, model);
    const response = await runtime.handleTurn("shortlet-bad-args", "Open broken");

    assert.equal(response.ok, true);
    assert.equal(results[0]?.result.error, "invalid_arguments");
  } finally {
    env.close();
  }
});

test("a missing or malformed declared schema fails closed with a schema violation and does not throw", () => {
  const malformed: readonly (readonly [string, unknown])[] = [
    ["an undefined root schema", undefined],
    ["a root schema without properties", { type: "object" }],
    ["a root schema whose properties are not an object", { type: "object", properties: 5 }],
    ["a property schema without a type", { type: "object", properties: { city: {} } }],
    ["a property enum that is not a list", { type: "object", properties: { city: { type: "string", enum: "Lagos" } } }],
    ["a required list that is not a list", { type: "object", properties: {}, required: "city" }],
  ];
  for (const [label, schema] of malformed) {
    const violation = findToolArgumentViolation(schema as unknown as AssistantToolParametersSchema, { city: "Lagos" });
    assert.equal(violation?.reason, "schema", label);
    assert.doesNotThrow(() => toolArgumentFailureMessage(violation!), label);
  }
});
