import assert from "node:assert/strict";
import test from "node:test";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { AssistantRuntime, type AssistantDiagnosticEvent } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import { ScriptedAssistantModel } from "../apps/local-guest/src/assistant/scripted-assistant-model.js";
import type { AssistantToolParameterProperty, AssistantToolParametersSchema, AssistantToolResult } from "../apps/local-guest/src/assistant/assistant-model.js";
import type { AssistantThreadState } from "../apps/local-guest/src/assistant/assistant-state.js";
import { PLATFORM_TASK_TOOLS, type AssistantDomainPack } from "../apps/local-guest/src/assistant/assistant-platform.js";
import { findToolArgumentViolation, toolArgumentFailureMessage } from "../apps/local-guest/src/assistant/assistant-tool-arguments.js";
import { ASSISTANT_TOOL_DEFINITIONS, createShortletAssistantPack } from "../apps/local-guest/src/assistant/shortlet-assistant-pack.js";
import { createCommerceAssistantPack } from "../apps/local-guest/src/assistant/commerce-assistant-pack.js";
import { COMMERCE_TEST_REFERENCE_KEYS, migrateCommerceDatabase } from "./helpers/commerce-database.js";

const SEARCH_SCHEMA = ASSISTANT_TOOL_DEFINITIONS.find((tool) => tool.name === "search_stays")!.parametersSchema;
const VALID_SEARCH = { city: "Lagos", neighbourhood: "Old Ikoyi", checkIn: null, nights: 4, guests: 2 };

/** Runs one planner turn whose only model tool call is `name` with `args`, and captures what the model receives back. */
async function runRejectedCall(name: string, args: Record<string, unknown>, text = "Find stays in Old Ikoyi Broken") {
  const env = LocalGuestEnvironment.openNode({ databasePath: ":memory:" });
  const diagnostics: AssistantDiagnosticEvent[] = [];
  const results: AssistantToolResult[] = [];
  try {
    const model = new ScriptedAssistantModel([(request) => {
      const last = request.history.at(-1);
      if (last?.role === "tool_results") {
        results.push(...last.results);
        return { text: JSON.stringify({ kind: "clarify_stay", references: [] }) };
      }
      if (last?.role === "user" && last.text.includes("Broken")) return { toolCalls: [{ id: "call-1", name, args }] };
      return null;
    }]);
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

test("AC1: a tool call with a missing required argument is rejected before the tool runs, and the model receives an invalid_arguments error naming the field", async () => {
  const { response, diagnostics, results } = await runRejectedCall("search_stays", { nights: 4, guests: 2 });

  assert.equal(response.ok, true);
  assert.equal(executedToolCount(diagnostics), 0);
  assert.equal(results[0]?.isError, true);
  assert.equal(results[0]?.result.error, "invalid_arguments");
  assert.match(String(results[0]?.result.message), /"city"/);
});

test("AC2: a tool call with an argument of the wrong type is rejected before the tool runs", async () => {
  const { response, diagnostics, results } = await runRejectedCall("search_stays", { city: "Lagos", nights: "four", guests: 2 });

  assert.equal(response.ok, true);
  assert.equal(executedToolCount(diagnostics), 0);
  assert.equal(results[0]?.result.error, "invalid_arguments");
  assert.equal(results[0]?.isError, true);
});

test("AC3: a numeric argument outside minimum/maximum is rejected before the tool runs", async () => {
  const { diagnostics, results } = await runRejectedCall("search_stays", { city: "Lagos", nights: 99, guests: 2 });

  assert.equal(executedToolCount(diagnostics), 0);
  assert.equal(results[0]?.result.error, "invalid_arguments");
  assert.match(String(results[0]?.result.message), /"nights"/);
  assert.equal(findToolArgumentViolation(SEARCH_SCHEMA, { city: "Lagos", nights: 0 })?.reason, "range");
});

test("AC4: an unknown argument is rejected when the schema sets additionalProperties false, and accepted when it does not", () => {
  const withUnknown = { ...VALID_SEARCH, unexpectedField: "x" };
  assert.equal(findToolArgumentViolation(SEARCH_SCHEMA, withUnknown)?.reason, "unknown");

  const open: AssistantToolParametersSchema = { type: "object", properties: { city: { type: "string" } }, required: ["city"] };
  assert.equal(findToolArgumentViolation(open, { city: "Lagos", unexpectedField: "x" }), undefined);
});

test("AC5: a union type such as [integer, null] accepts each listed type and rejects others", () => {
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

test("AC6: a rejected call leaves the thread's task state and surfaces unchanged and records a failed tool_execution diagnostic", async () => {
  const env = LocalGuestEnvironment.openNode({ databasePath: ":memory:" });
  const diagnostics: AssistantDiagnosticEvent[] = [];
  try {
    const model = new ScriptedAssistantModel([(request) => {
      const last = request.history.at(-1);
      if (last?.role === "tool_results") return { text: JSON.stringify({ kind: "clarify_stay", references: [] }) };
      if (last?.role === "user" && last.text.includes("Broken")) return { toolCalls: [{ id: "bad", name: "search_stays", args: { city: "Lagos", nights: "four" } }] };
      if (last?.role === "user") return { toolCalls: [{ id: "good", name: "search_stays", args: VALID_SEARCH }] };
      return null;
    }]);
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

test("AC7: the error message and the diagnostic do not contain the rejected argument's value", async () => {
  const canary = "PRIVATE_ARGUMENT_CANARY_7319";
  const { diagnostics, results } = await runRejectedCall("search_stays", { city: "Lagos", nights: canary, guests: 2 });

  assert.equal(results[0]?.result.error, "invalid_arguments");
  assert.doesNotMatch(JSON.stringify(results), new RegExp(canary));
  assert.doesNotMatch(JSON.stringify(diagnostics), new RegExp(canary));
  assert.doesNotMatch(toolArgumentFailureMessage({ field: "nights", reason: "type" }), new RegExp(canary));
});

test("AC8: every existing tool definition in the shortlet and commerce packs is accepted by the validator for a valid call", () => {
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
