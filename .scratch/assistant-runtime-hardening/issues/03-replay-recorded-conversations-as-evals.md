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

### Implementation (28 Oct 2026, branch `integration/concierge-controls`)

**ADR discovery and table.** Listed `docs/adr/` and read ADR 0075, 0079, 0070 and 0081 (the issue's table) and ADR 0106 (concierge path, with its 26 and 27 Oct amendments). Constraints and where they bite:

| ADR | Constraint | Code path |
|---|---|---|
| 0075 | Neutral fields only; no `rawStep`, system instruction or credential; local fixture data only | `neutralRequest` / `neutralResponse` in `assistant-recording.ts`; committed-file check in `test/assistant-recording-clients.test.ts`; the record script refuses other databases |
| 0079 | Recordings are golden fixtures for the assistant turn | Turn outputs (messages, surface ids, A2UI component types, task rail) stored per turn and compared on replay |
| 0070 | Providers are never replayed opaque steps | `ReplayModelClient` rebuilds every response from neutral fields and never returns `rawStep` |
| 0081 | Assert on A2UI component types and surface ids, not Weaver internals | `componentTypesOf` reads A2UI `component` names only |
| 0106 | Concierge tests run with the assistant enabled and a cold restore before every event, on the staging-like clock, for a staging-like guest | `runJourney` builds a new application and runtime over the same store before every guest turn, on 27 Oct 2026, with no seeded phone or email (`openJourneyEnvironment`, `LIVE_LIKE_CLOCK`) |

**Changes.**
- `apps/local-guest/src/assistant/assistant-recording.ts` (new): `RecordingModelClient` (wraps any client, forwards the attempt-reservation flag, records neutral exchanges only); `ReplayModelClient` (answers in order; a mismatch or a call after the end throws `AssistantReplayDivergenceError` naming the step; keeps the first divergence so `assertFaithful()` still fails when a runtime catches it); `assertLocalFixtureDatabase` (accepts `:memory:` or `DEFAULT_LOCAL_GUEST_CONFIG.databasePath` only).
- `test/helpers/assistant-recordings.ts` (new): the four journeys with their planner answers, `runJourney` (cold restore before every turn), turn-output projection, `normaliseGeneratedIds` (runtime-minted draft and pending-action UUIDs become `generated-id-N` in first-appearance order, so two runs compare equal), `loadRecording`, `replayJourney`.
- `test/helpers/guest-date-fixtures.ts`: `wireDatedApp` exported and takes optional `additionalPacks` (for the task-switch journey). No behaviour change for existing callers.
- `scripts/record-assistant-journey.ts` (new): records the named journeys to `test/fixtures/assistant-recordings/` by default. A real provider is used only when `ASSISTANT_RECORD_LIVE=1`; then it builds the production OpenAI-compatible client through `loadConciergeConfiguration` and `createConciergeModelClient`. It refuses any `--database` other than the local fixture before opening a database. It does not print the environment.
- `test/fixtures/assistant-recordings/*.json` (new, four files): `search-refinement-request-draft`, `missing-information-clarification`, `confirmation-cancelled`, `stale-confirmation-after-task-switch`.
- `test/assistant-recording-clients.test.ts` and `test/assistant-recorded-journeys.test.ts` (new): one `test()` per acceptance criterion, named as the criterion text, plus unit tests for the two clients.

**Decisions taken (please confirm).**
1. Real-provider recording not run. No provider key is used in this environment, and the agent does not open the staging secrets. The four recordings were made through `ScriptedAssistantModel`, wrapped in a provider-contract adapter that calls the attempt hook (the quota guard requires it), as the issue allows. The owner can re-record live with `ASSISTANT_RECORD_LIVE=1 node --import tsx scripts/record-assistant-journey.ts --out <dir>`; the committed files should be replaced only after review.
2. Replay compares tool names offered, the structured-output name, history roles, text, and tool-call and tool-result names. It does not compare arguments. The issue's list is the minimum; text is included so a changed guest message also diverges.
3. Thread ids are fixed per journey (`g-d1a00004xx`, THREAD_ID_PATTERN), because surface ids carry them.
4. Runtime-minted UUIDs are normalised in the projection. The structure is compared exactly; the random values are not.
5. The scripted planner answers each journey's texts from an explicit map in `RECORDED_JOURNEYS`, not from the scripted keyword heuristics, so a recorded turn does not change when the heuristics change. The classifier's advisory slots for a planned search come from the same map.
6. Observed, not changed: in `confirmation-cancelled`, "No, cancel that." clears the pending action (no pending surface afterwards) but returns the scope-redirect copy (`rejected_plan_fallback`), not "Action cancelled" as eval 20 expects under the injected test scope. "Yes" after the task switch likewise returns the redirect copy and sends nothing. The recordings pin today's behaviour; the copy question is for the owner or issue 04.
7. `package.json` `test:assistant` not edited. The new files are run explicitly (below).

**Commands and counts.**
- Before implementation the test files could not import the new modules (red).
- `env -u LLM_API_KEY node --import tsx scripts/record-assistant-journey.ts`: recorded 4 journeys (12, 5, 8, 8 model exchanges; 4, 2, 3, 4 turns). Run twice; the replay test passes on the second run's files, which shows the recording is deterministic.
- `env -u LLM_API_KEY node --import tsx --test test/assistant-recording-clients.test.ts test/assistant-recorded-journeys.test.ts`: 7 tests, 7 pass, 0 fail.
- `env -u LLM_API_KEY npm run check`: exit 0 (root tsc, apps/cloudflare tsc, tsconfig.test, tsconfig.tooling, worker bundle guard).
- `env -u LLM_API_KEY npm run test:assistant`: 67 tests, 66 pass, 1 fail. The one failure is the known pre-existing `Unit detail surface projects inspection facts from the authoritative Unit` in `test/shortlet-assistant-evals.test.ts`. Not edited.
- Affected (users of `guest-date-fixtures` and the turn model): `env -u LLM_API_KEY node --import tsx --test test/assistant-artifact-authority.test.ts test/assistant-booking-journey.test.ts test/assistant-cold-journey.test.ts test/assistant-date-literal-authority.test.ts test/assistant-date-literals.test.ts test/assistant-discovery-view.test.ts test/assistant-recorded-journeys.test.ts test/assistant-recording-clients.test.ts test/assistant-turn-stop-cold-restore.test.ts test/assistant-turn-stop-reasons.test.ts test/guest-chip-continuity.test.ts test/assistant-tool-argument-validation.test.ts`: 85 tests, 85 pass, 0 fail.
- Not run: full `npm test` and `npm run test:workers` (batch pre-merge gate, per Test scope).

**Definition of Done (docs/agents/issue-tracker.md).**
1. Named test per criterion: met. Criterion 1 is in `test/assistant-recording-clients.test.ts`; criteria 2 and 5 are in `test/assistant-recorded-journeys.test.ts`; criterion 3 has a unit test and a runtime-level test; criterion 4 is the script-refusal test.
2. Failure paths: criterion 3 asserts a throw naming step 2 for a tool divergence, step 1 for a history divergence, step 2 for a call after the end, and that `assertFaithful` still throws after a runtime catches the divergence. Criterion 4 asserts a non-zero exit, `Recording refused`, no database file and no recording written.
3. ADRs listed and read: met (table above).
4. Injected dependencies used: `RecordingModelClient` calls its inner client; `ReplayModelClient` uses its exchanges and the attempt hook; `AttemptAwareScriptedModel` uses its definition and inner model.
5. No invented policy: the only values are fixture thread ids, planner answers and the staging clock (`LIVE_LIKE_CLOCK`).
6. No bearer credential in recordings: the committed files are checked for `rawStep`, system instruction, `apiKey`, `authorization`, `bearer` and `LLM_API_KEY`; none present.
7. `npm run check` clean: met. Full `npm test`: open for the batch gate, as Test scope requires.

**Status.** Left `ready-for-agent`. DoD item 7's full `npm test` and `npm run test:workers` run once per batch before merge to main, and the live-provider recording (decision 1) is for the owner. Both are open, so the issue is not `resolved`.
