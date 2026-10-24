import assert from "node:assert/strict";
import test from "node:test";
import { AssistantRuntime, type AssistantDiagnosticEvent } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import { ModelRequestGuardError } from "../apps/local-guest/src/assistant/assistant-model.js";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";

test("AC6: classifier guard failures and quota refusals emit separate metadata-only outcomes once", async () => {
  for (const failure of ["malformed", "outage", "quota"] as const) {
    const environment = LocalGuestEnvironment.openNode({ databasePath: ":memory:" });
    const diagnostics: AssistantDiagnosticEvent[] = [];
    try {
      const runtime = new AssistantRuntime(environment, { generate: async () => { throw new Error("Planner cannot run"); } }, {
        onDiagnostic: (event) => diagnostics.push(event),
        scopeClassifier: { assess: async () => {
          if (failure === "quota") throw new ModelRequestGuardError("quota_denied");
          if (failure === "outage") throw new Error("PRIVATE_GUARD_FAILURE_CANARY");
          return { invalid: "PRIVATE_GUARD_FAILURE_CANARY" };
        } },
      });
      const result = await runtime.handleTurn(`metrics-${failure}`, "PRIVATE_GUEST_INPUT_CANARY");
      assert.equal(result.ok, true);
      const events = environment.telemetry.events().filter((event) => event.type === "assistant.control.outcome.v1");
      assert.deepEqual(events.map((event) => event.outcome), [failure === "quota" ? "quota_refusal" : "guard_failure", "scope_unavailable"]);
      assert.ok(events.every((event) => typeof event.elapsedMs === "number" && Number.isSafeInteger(event.elapsedMs) && event.elapsedMs >= 0));
      assert.doesNotMatch(JSON.stringify(events), /PRIVATE_|guestId|tenantId|prompt|reply/);
      assert.equal(diagnostics.length, 1);
      assert.equal(diagnostics[0]?.round, 0);
      assert.equal(diagnostics[0]?.succeeded, false);
      assert.doesNotMatch(JSON.stringify(diagnostics), /PRIVATE_|message|prompt|reply/);
    } finally { environment.close(); }
  }
});
