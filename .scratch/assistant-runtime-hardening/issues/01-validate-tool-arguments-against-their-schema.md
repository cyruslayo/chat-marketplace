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
