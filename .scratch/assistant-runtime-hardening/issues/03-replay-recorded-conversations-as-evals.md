# Replay recorded assistant conversations as regression evals

Status: ready-for-agent
Type: task
Blocked by: none
Requested: 25 Oct 2026
PRD: `../PRD.md`

## Why

The evals in `test/shortlet-assistant-evals.test.ts` drive the runtime with `ScriptedAssistantModel`, whose replies are hand-written rules (`apps/local-guest/src/assistant/scripted-assistant-model.ts`). They prove the runtime handles the cases someone thought to script. They do not capture what a real model actually did on a real journey, so a runtime change that breaks a real conversation can pass every eval.

Issue 04 moves most of `assistant-runtime.ts`. It needs a safety net that pins today's behaviour on whole journeys first.

## What to build

- **`RecordingModelClient`** (in `apps/local-guest/src/assistant/`): wraps any `AssistantModelClient` and appends each request and response to a recording, in provider-neutral fields only (`history`, tool names offered, `text`, `toolCalls`, `usage`). It never stores `rawStep`, the system instruction, keys or headers.
- **`ReplayModelClient`**: answers from a recording in order. Before each answer it checks that the request matches the recorded one (same tool names offered, same history roles and tool-call names). On mismatch it throws an error naming the step, so divergence fails loudly rather than replaying the wrong answer.
- **A script that records a journey** against the local guest with a real provider, opt-in through an environment variable, writing a JSON recording plus the turn outputs (messages, surface ids, A2UI component types, task rail). It refuses to run against anything but the local fixture database, so recordings contain local test data only (ADR 0075).
- **Committed recordings** under `test/fixtures/assistant-recordings/` for at least: a search with refinement through to a request draft; a missing-information clarification; a confirmation that is cancelled; a stale confirmation after a task switch. Shared loading code goes in `test/helpers/` (AGENTS.md anti-pattern 4).
- **`test/assistant-recorded-journeys.test.ts`**: replays each recording through a fresh `AssistantRuntime` and asserts the turn outputs equal the recorded ones.

If recording with a real provider is not possible in the agent's environment, record the four journeys through `ScriptedAssistantModel` instead, say so in Comments, and leave the real-provider recording to the owner (the script still ships).

## ADRs

| ADR | Constraint | Affects |
|---|---|---|
| 0075 | No restricted personal data, secrets or raw provider payloads in stored interaction data | Neutral fields only; local fixture data only; no `rawStep` or system instruction |
| 0079 | Golden streams and reference-client fixtures are launch evidence | Recordings are golden fixtures for the assistant turn |
| 0070 | Providers are never replayed opaque steps | Replay rebuilds from neutral fields, like `FallbackModelClient` |
| 0081 | Weaver must be independently replaceable | Assert on A2UI component types and surface ids, not Weaver internals |

## Acceptance criteria

1. A recording stores only provider-neutral request and response fields, and contains no `rawStep`, system instruction or credential.
2. Replaying a recording through a fresh runtime reproduces the recorded messages, surface ids, component types and task rail for every turn.
3. Replay fails with an error naming the step when the runtime's request diverges from the recording.
4. The record script refuses to run against anything other than the local fixture database.
5. The four named journeys are committed as recordings and pass.

## Tests

`test/assistant-recorded-journeys.test.ts` (new), plus unit tests for the two clients. Affected: `npm run test:assistant`.

## Comments
