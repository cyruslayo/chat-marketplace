# Validate tool arguments against their declared schema before any tool runs

Status: ready-for-agent
Type: task
Blocked by: none
Requested: 25 Oct 2026
PRD: `../PRD.md`

## Why

Every tool declares `parametersSchema` (`AssistantToolParametersSchema` in `apps/local-guest/src/assistant/assistant-model.ts`), but nothing checks the model's arguments against it. The tool loop in `assistant-runtime.ts` (around lines 430–450) only checks that the tool was offered and calls the pack's `validateToolCall`, which checks workflow preconditions (shortlist present, `stayRef` in the shortlist). Types, ranges, required fields and unknown fields are left to each tool's own `typeof` checks, or to nothing.

Model output is untrusted (ADR 0075). Wrong types should be rejected in one place, fail closed, before any domain code sees them.

## What to build

- A small validator for the existing `AssistantToolParametersSchema` subset: `type` (string or union), `minimum`, `maximum`, `items.type`, `required`, `additionalProperties`. It lives beside the model interface in `apps/local-guest/src/assistant/` and has no new dependency. Do not add Zod or a JSON Schema library: the subset is small, and adding a dependency is an owner decision.
- In the tool loop, run it on every call before the platform task-tool path and before `validateToolCall`. A failure returns a tool result with `isError: true`, a stable error code (for example `invalid_arguments`) and a message naming the field, and records a diagnostic with `failureClass: "MODEL_SELECTION_FAILURE"` (existing class; do not invent a new one without checking `AssistantFailureClass`).
- Apply it to platform task tools and to every pack's tools (shortlet and commerce), using each definition's own schema.
- The error message sent back to the model must not echo the argument values (ADR 0075: tool content can carry personal data).

## ADRs

| ADR | Constraint | Affects |
|---|---|---|
| 0075 | Model content is untrusted; no restricted data in logs or interaction state | Validation before execution; error text and diagnostics carry field names, never values |
| 0072 | Consequential tool calls resolve to platform commands validated server-side | This check is an extra front gate; command validation stays where it is |
| 0099 | Domain packs own their tool definitions | The validator reads each pack's schema; it does not move schemas into the platform |

## Acceptance criteria

1. A tool call with a missing required argument is rejected before the tool runs, and the model receives an `invalid_arguments` error naming the field.
2. A tool call with an argument of the wrong type is rejected before the tool runs.
3. A numeric argument outside `minimum`/`maximum` is rejected before the tool runs.
4. An unknown argument is rejected when the schema sets `additionalProperties: false`, and accepted when it does not.
5. A union type such as `["integer", "null"]` accepts each listed type and rejects others.
6. A rejected call leaves the thread's task state and surfaces unchanged and records a failed `tool_execution` diagnostic.
7. The error message and the diagnostic do not contain the rejected argument's value.
8. Every existing tool definition in the shortlet and commerce packs is accepted by the validator for a valid call (a test walks all definitions).

## Tests

`test/assistant-tool-argument-validation.test.ts` (new) for the validator and loop behaviour, using `ScriptedAssistantModel`. Also run the affected suites: `npm run test:assistant`, `test/assistant-pack-registry.test.ts`, `test/assistant-search-unknowns.test.ts`.

## Comments

Implementation (integration/concierge-controls, 28 Oct 2026). Status left at `ready-for-agent`: Definition of Done item 7 is not yet met (see below).

ADRs read and applied: 0075 (values never echoed in the error text or diagnostics; field names only), 0072 (validation is a front gate; command validation unchanged), 0099 (each pack's own `toolDefinition`/`parametersSchema` is used; the platform does not copy schemas), 0106 (fail closed; unknown or unlisted type names match nothing; invalid call denies the turn). Also read 0092 and 0093 for the cold-restore context. No ADR conflicts.

What changed:
- New `apps/local-guest/src/assistant/assistant-tool-arguments.ts`: `findToolArgumentViolation` returns the first violation as `{ field, reason }` with reasons `missing`, `type`, `range`, `length`, `enum`, `unknown`. `toolArgumentFailureMessage` builds a value-free message that names the field. No new dependency.
- `assistant-runtime.ts` tool loop: the argument check runs before the task-tool path and before `validateToolCall`. A violation returns `{ error: "invalid_arguments", message }` with `isError: true` and a `tool_execution` diagnostic with `failureClass: MODEL_SELECTION_FAILURE`. Precondition and state checks are skipped for a call that fails validation.
- `assistant-platform.ts`: the boolean `validateAssistantToolArguments` and its helpers were removed. The precondition code `invalid_tool_arguments` is renamed `invalid_arguments` (no other references).

Tests:
- `test/assistant-tool-argument-validation.test.ts` (new): one test per acceptance criterion, AC1 to AC8, named to mirror the criteria. All 8 pass.

Commands and counts:
- `env -u LLM_API_KEY npm run check`: exit 0 (tsc for root, apps/cloudflare, tsconfig.test and tsconfig.tooling, plus the worker bundle guard).
- `env -u LLM_API_KEY npx tsx --test test/assistant-tool-argument-validation.test.ts`: 8 tests, 8 pass, 0 fail. Before the change it failed (module missing).
- `env -u LLM_API_KEY npm run test:assistant`: 67 tests, 66 pass, 1 fail. The failure is `Unit detail surface projects inspection facts from the authoritative Unit` in `test/shortlet-assistant-evals.test.ts`. It expects "Inspection expiry: 1 Feb 2027", but the surface renders "27 Oct 2027", which comes from `domains/shortlet/src/browse.ts` (unchanged in this branch's diff). The valid `get_unit_details` call still runs and renders, so the failure is a stale data expectation and not caused by argument validation. Not fixed here: changing an expected policy date needs an owner decision.
- `env -u LLM_API_KEY npx tsx --test test/assistant-pack-registry.test.ts`: 3 tests, 3 pass, 0 fail.
- `env -u LLM_API_KEY npx tsx --test test/assistant-search-unknowns.test.ts`: 5 tests, 5 pass, 0 fail.
- `env -u LLM_API_KEY npx tsx --test test/assistant-control-metrics.test.ts test/commerce-agent-tools.test.ts test/assistant-task-rail.test.ts test/conversation-router.test.ts test/assistant-scope-controls.test.ts test/assistant-date-literal-authority.test.ts test/assistant-control-outcome-count.test.ts`: 73 tests, 73 pass, 0 fail (other suites that drive the tool loop).
- Not run, by policy: full `npm test` and `npm run test:workers` (pre-merge gate, once per batch).

Definition of Done:
1. Every criterion has a named test: pass (AC1 to AC8, one `test()` each).
2. Failure paths asserted: pass (missing, wrong type, out of range, unknown, unlisted union member, rejected call with unchanged state).
3. ADRs listed and cited: pass (above).
4. No unused injected dependency: pass (no constructor changes).
5. No invented policy string: pass (`invalid_arguments` is a closed error code, not a policy value).
6. No restricted material in logs or audit: pass (AC7 asserts the canary is absent from the tool result and diagnostics).
7. `npm run check` clean: pass. `npm test` zero failures: NOT MET. The affected `test:assistant` run has one pre-existing stale-date failure (above), and the full suite runs only at the batch gate. Status therefore stays `ready-for-agent` until the owner decides the expiry expectation or the batch gate runs.

Review fixes (second commit on integration/concierge-controls, 28 Oct 2026). Status still `ready-for-agent`.

Pre-existing failure, not caused by this issue: `Unit detail surface projects inspection facts from the authoritative Unit` (test/shortlet-assistant-evals.test.ts) expects "Inspection expiry: 1 Feb 2027", but the surface renders "27 Oct 2027". The fixture expiry changed in commit b68eecd ("refresh synthetic demo trust expiry to twelve months past the staging clock"), which is earlier than this review work. That test file is deliberately not touched here and waits on an owner decision. Because this failure sits in an affected suite, DoD item 7 stays open.

Changes made in response to review:
1. Runtime tests now prove the check runs before the task-tool path and before pack preconditions:
   - switch_task with a numeric taskId: rejected as invalid_arguments, thread snapshot unchanged. A real second task exists, so an unchecked call would have reached UNKNOWN_TASK.
   - start_task without `domain`: rejected as invalid_arguments, task count and thread snapshot unchanged.
   - commerce get_offer with a numeric offerId: a spy on the pack proves validateToolCall and executeTool are never reached.
   - shortlet get_unit_details with a numeric stayRef on a fresh thread: invalid_arguments. An unchecked call would fail the shortlist precondition with invalid_tool_for_state.
2. Fail closed on malformed schemas. A missing or non-record root schema, a root without a properties record, a property without a type, a non-list enum or required, and non-record items or properties each return a `schema` violation and do not throw. New test: "a missing or malformed declared schema fails closed with a schema violation and does not throw".
3. Test names now mirror the criterion text, without the "ACn:" prefix.
4. AC8 caveat: the test checks only that the validator accepts a sample built from each declared schema. It does not exercise real pack calls. The runtime tests above cover real calls.
5. The `!malformedArguments` guard in the `stateUnavailable` condition is not redundant. For a tool that is authorized but not offered in the current state, an unguarded call would still run `validateToolCall` before the argument result is used, so it is kept.

Commands and counts (env -u LLM_API_KEY, after the review fixes):
- `npm run check`: exit 0.
- `npx tsx --test test/assistant-tool-argument-validation.test.ts`: 13 tests, 13 pass, 0 fail.
- `npm run test:assistant`: 67 tests, 66 pass, 1 fail (the b68eecd expiry failure above).
- `npx tsx --test test/assistant-pack-registry.test.ts`: 3 pass, 0 fail.
- `npx tsx --test test/assistant-search-unknowns.test.ts`: 5 pass, 0 fail.

### Test fix (28 Oct 2026, issue 04 follow-up, commit on integration/concierge-controls)

The two failing tests, "a switch_task call with a numeric taskId ..." and "a start_task call without its required domain ...", were failing on d60f82b before issue 04. Cause: commit 0ea551f added `replacedPendingAction` to the task state. The initial state omits the key, while every committed clone writes it as null, so the file-local `threadSnapshot` saw an extra key after a rejected call. Both mean "no replaced proposal". Fix (test only, runtime unchanged): the file-local snapshot writes the key as null, and the assertions are unchanged (no task created or switched, no application call, surfaces and history unchanged). The shared helper in test/helpers/assistant-turn-model.ts is not changed. Counts: this file 13 of 13 pass; npm run test:assistant 67 of 67; safety list 176 of 176.
