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

### Follow-up review (28 Oct 2026, HEAD 37e49dd)

**A. Pending confirmations after a cold restore (commit 49464b1).** Reproduced: a Booking Request proposal, then a typed cancel or Yes on a cold-restored runtime, reached the planner and got the scope-redirect copy with a classifier call. Read ADR 0106 (in full, with the 26 and 27 Oct amendments), ADR 0092, 0093, 0070, 0075, and AGENTS.md "Concierge assistant path".

Root cause: the open confirmation lives in the runtime's task state (`taskState.pendingAction`). The durable guest projection (`guest-projection.ts`, version 1) never stored it. `#restoreAssistantFromGuestThread` rebuilt the shortlet task state with `pendingAction: null`, so the restored runtime had nothing to cancel or confirm and the deterministic path never ran.

| ADR | Constraint | Where it bites |
|---|---|---|
| 0106 | Existing authorised pending confirmations and cancellations keep their deterministic path, with no classifier call | `pendingAction` restored into the task state; typed cancel and confirm run before the planner |
| 0070 | Identities are not re-minted; a durable thread supplies context but never owns domain state | The pending action keeps its id and its surface id (`pa-…`, `:pending-action:`); restore re-keys the same ids |
| 0074 | Stale or unknown surfaces fail closed | Button confirm or cancel must name the same surface in the event and its context (shortlet-app.ts), else `STALE_SURFACE`; the runtime re-keys the surface only when its id names the restored action |
| 0093 | Interaction projections are minimal and hold approved, redacted presentation facts | The persisted action holds identifiers, the authoritative references the confirmation card already shows, the summary and the expiry; `executed` actions are never stored |
| 0075 | No credential or restricted material in stored data | Field-by-field parser (`parsePersistedPendingAction`) keeps only the listed fields and fails closed on anything else |

Fix: `pendingAction` and `pendingActionSurfaceId` are optional projection fields (missing reads as null, as `activeContact` did). The shell mirrors the runtime's open action after every result (`#syncPendingAction`) and restores both on a cold restore (`restoreShortletState` gets `pendingActionSurfaceId`). No schema migration: the projection is JSON and older projections read as null.

Not restored: the on-screen confirmation card. `#restoreCurrentSurface` does not re-render a pending-action stage, so after a reload the guest sees no card; a typed cancel or confirm works, and a button press on a card the guest still holds is authorised under the restored id. Owner decision: re-render the card on restore (needs the pending-action surface builder in the shell).

Tests: `test/assistant-pending-action-restore.test.ts` (new, 3 tests, one per requirement: typed cancel after a cold restore, typed yes after a cold restore, and forged, unknown and superseded ids refused with STALE_SURFACE or ARTIFACT_MISMATCH). Each event runs on a new application and runtime over the same store, on the 27 Oct 2026 clock. The cancel test uses the staging-like guest; the yes and forged tests use a phone-holding guest (finding 9 below).

**B. Recordings with intended outcomes.**
- `confirmation-cancelled`: the typed cancel now returns "Action cancelled. Let me know how else I can help.", no pending surface, no request, no classifier call (6 model exchanges, was 8).
- The fourth journey is renamed `cancel-after-task-switch`. The stale-confirmation version could not be recorded honestly: after a task switch the open Booking Request confirmation is still live (finding 10 below), so a confirm press executes it instead of being refused. Its recording is removed.
- `intendedOutcomeViolations` (test/helpers/assistant-recordings.ts) states the intended outcomes: a cancel gives the cancel copy with no pending surface, no request and no fallback outcome; a stale button press is refused with its expected code and opens no request. The recorder refuses to write any recording that breaks them, and the journey test asserts the same list. Unit tests show the guard catches a pending surface, a fallback outcome and a wrong refusal code.

**C. Review items.**
- 3. Replay comparison now includes tool-call arguments and tool-result payloads, with the same UUID normalisation (order of first appearance per request). Test: `Replay comparison fails when only tool-call arguments or tool-result payloads change.`
- 4. Live recording (not run): needs an explicit `--out` outside `test/fixtures` (refused otherwise, test in the clients file); a call budget `LIVE_RECORDING_CALL_BUDGET` = 60 model calls per run, all journeys together (an engineering setting, enforced by a wrapper that stops the run); the recording is scanned for bearer tokens, authorization headers, key names, provider key prefixes, secret environment names, JWT-shaped strings and the configured key values before any write (a match refuses the write and names only the pattern). Scripted mode writes to the committed directory unless `--out` names another one.
- 5. The criterion-4 test imports `DEFAULT_LOCAL_GUEST_CONFIG.databasePath`.
- 6. Same-length, different-text history divergence test: `Replay comparison fails on a same-length history whose text differs.`
- 7. Shared helpers: `test/helpers/assistant-attempt-model.ts` (`withProviderAttemptHook`, used by the recorded journeys and by `test/assistant-interactions-protocol.test.ts`, replacing its inline adapter); `STAGING_GUEST_CONFIG` in `test/helpers/guest-date-fixtures.ts` (used by `datedFixture` and the journey environment).
- 8. The new files run in `npm test` phase 1 (`scripts/test-phases.mjs` puts every `test/*.test.ts` that does not drive a real Chrome in the concurrent phase), not in `npm run test:assistant`. `test:assistant` is not edited.
- 9. Separate defect, not fixed: `handleTurn` throws "A valid phone number is required before submitting a Booking Request" for a confirmed Booking Request when the guest has no phone (reached through the staging-like guest; `assistant-runtime.ts` ~1475 area). The restore test avoids it with a phone-holding guest. Not fixed here; no test depends on the fix.
- 10. RESOLVED (28 Oct 2026, see the owner decision below). Separate defect, owner decision needed, not fixed at the time: a task switch does not supersede the open Booking Request confirmation. After "Start a new task in shop", a typed "Yes" (warm or cold) executes the Booking Request: the host accepts it and an offer surface opens (verified with a phone-holding guest). A confirm press on the old card after the switch also reaches execution (the no-phone guest hit finding 9 instead of a refusal). ADR 0074 says stale or superseded material actions fail closed. Options for the owner: a task switch clears the open action; or a confirmation binds to the newest prompt only. The restore fix does not create this; it makes a cold guest reach the same path a warm guest already reaches.

**Commands and counts (28 Oct 2026, env -u LLM_API_KEY).**
- `npm run check`: exit 0 after the restore fix (commit 49464b1) and again after the review items (final run).
- `node --import tsx --test test/assistant-pending-action-restore.test.ts test/assistant-cold-journey.test.ts test/assistant-turn-stop-cold-restore.test.ts test/assistant-artifact-authority.test.ts test/assistant-booking-journey.test.ts test/assistant-recorded-journeys.test.ts test/assistant-recording-clients.test.ts test/assistant-interactions-protocol.test.ts`: 53 tests, 53 pass, 0 fail.
- `node --import tsx --test test/assistant-recorded-journeys.test.ts test/assistant-recording-clients.test.ts test/assistant-pending-action-restore.test.ts`: 16 tests, 16 pass, 0 fail.
- `npm run test:assistant`: 67 tests, 67 pass, 0 fail (the known evals failure is fixed at 37e49dd).
- Non-browser guest, assistant and restart files (70 files, `grep -l` on guest-projection, restart and assistant, excluding chromium, commerce, operator and sqlite): 826 tests, 823 pass, 3 fail. Two of the three fail identically at 37e49dd (checked in a scratch worktree): `04c AC3 evicted session` (test/guest-session-runtime-limit.test.ts) and `Turn timeout AC5` (test/guest-turn-timeout.test.ts, expects the literal `timeoutMs: PLANNER_REQUEST_TIMEOUT_MS`, which 37717e8 replaced with a clamp). The third, `ADR 0101: a handler composed with commerce locally creates the commerce tables`, stops with the commerce reference key error when run outside the test runner (`NODE_ENV=test` and `COMMERCE_REFERENCE_TEST_KEY=allow` are set by `npm test`); not re-run under the runner.
- Not run: full `npm test` and `npm run test:workers` (batch gate). Live recording not run.

**Housekeeping.** A scratch worktree of 37e49dd was created to check the baseline and is still registered at `C:\Users\Cyrus\AppData\Local\Temp\claude\C--AI2026-chat-marketplace\90c73b74-6226-43ed-a224-59273ae807e7\scratchpad\base37`. Its `node_modules` is a link into the main worktree's dependencies; remove the link before `git worktree remove`. The main worktree's `node_modules` was not touched (verified).

**Definition of Done (follow-up).** 1. Named test per requirement: met (3 restore tests, 1 comparison test per review item, 2 guard tests). 2. Failure paths: forged, superseded and unknown ids; a refused button press; a guard that catches a pending surface, a fallback outcome or a wrong code. 3. ADRs: table above and the table in the original Comments. 4. Injected dependencies used: `BudgetedLiveClient` calls its inner client and budget; `withProviderAttemptHook` calls the hook. 5. No invented policy except the call budget, documented as an engineering setting. 6. No credential in recordings: scanned by the recorder and checked by the clients test. 7. `npm run check` clean; full `npm test` open for the batch gate.

**Status.** Still `ready-for-agent`: the batch gate (full `npm test`, `npm run test:workers`) is open, the owner must decide findings 10 and the card re-render, and the live recording is not run.

### Reviewer follow-up (28 Oct 2026, HEAD acd461c)

1. **Restore guard.** `restoreShortletState` now re-keys the pending surface only when its id is exactly `thread-<threadId>:pending-action:<action id>` (was `endsWith`). Tests: `A persisted pending surface id that names a different action fails closed` and `... for the same action on another thread is not restored` (both confirm after a cold restore, `STALE_SURFACE`). Mutation checks: removing the check (surface always restored) fails both tests; the `endsWith` form fails the other-thread test; the restored file passes all six restore tests.
2. **Live `--out` guard.** `isInsideOrSame` (`..x` is inside; `..` and `..\` prefixes are outside) and `realPathOfNearestExisting` compare real paths, so a junction into `test/fixtures` is refused. Test: `Live recording refuses an --out inside test/fixtures, including a name such as ..x, a subdirectory and a junction into it.` Live mode was not run.
3. **Malformed pendingAction.** `parseGuestProjection` reads an invalid `pendingAction` as null and an invalid `pendingActionSurfaceId` as null; the thread still restores. Test: `A malformed persisted pendingAction is read as null: the thread still restores, without the pending action.`

Owner decision (28 Oct 2026, resolved below): a new search or task switch after a Booking Request proposal removes the proposal.

Commands and counts (env -u LLM_API_KEY):
- `npm run check`: exit 0.
- `node --import tsx --test test/assistant-pending-action-restore.test.ts test/assistant-cold-journey.test.ts test/assistant-turn-stop-cold-restore.test.ts test/assistant-recorded-journeys.test.ts test/assistant-recording-clients.test.ts test/assistant-discovery-view.test.ts test/assistant-persistent-continuity.test.ts test/assistant-scope-persistence.test.ts test/guest-account-linking.test.ts test/guest-account-sign-in.test.ts test/guest-offer-access.test.ts test/guest-real-dates.test.ts`: 154 tests, 154 pass, 0 fail.
- `npm run test:assistant`: 67 tests, 67 pass, 0 fail.

### Owner decision: a search change or task switch removes a proposal (28 Oct 2026, finding 10 resolved)

**Finding 10 is resolved.** The reviewer probe: propose Old Ikoyi, then "Actually Lekki, same dates", then a typed "Yes" confirmed the Ikoyi stay, warm and cold. A task switch did the same. Owner decision: a new search that changes the proposed stay, or a task switch, after a Booking Request proposal removes the proposal's authority (ADR 0074: a changed stay or authority removes action authority).

**Rule (implemented).**
- A successful `search_stays` removes the open proposal unless the result still names the same stay: the same `stayRef`, unit, check-in, checkout and party size. A repeated, unchanged search keeps it (decision d: kept, because the stay and its authority are unchanged; this is also today's behaviour for an unchanged search).
- A proposal without a stay reference (an offer or checkout action) has no stay to match, so any successful search removes it (fail closed).
- A task switch removes the proposal wherever it is requested: the cross-domain router prompt, the `start_task`/`switch_task` tool calls, and the `platform.task.start`/`switch` events.
- A removal keeps only a notice `{ id, reason }` (`replacedPendingAction`), with no authority. The notice is persisted in the guest projection (optional, a malformed notice reads as null) and restored with the thread, so a cold restore and a warm runtime agree.
- The next typed confirmation after a removal gets a fixed reply (`ASSISTANT_CONTROL_COPY.proposalReplaced`) and sends nothing; no model call is made. The notice clears on that typed turn, and on a new proposal.
- The old card's buttons are refused as `STALE_SURFACE`, because the surface is no longer the active one.
- Guards are unchanged: forged, unknown and superseded ids still fail closed.

**Root cause.** Nothing in the search or task-switch path touched `pendingAction`. Only the executors and cancellation cleared it, so a search changed the stay under an open proposal and a switch left it in the saved task.

**ADR table.**

| ADR | Constraint | Where it applies |
|---|---|---|
| 0074 | Only the current authoritative surface keeps action authority; a changed stay or authority removes it; stale surfaces fail closed | `proposalStillAuthorised` and `replacePendingProposal` in `assistant-runtime.ts`/`assistant-state.ts`; the button refusal |
| 0106 | Deterministic confirmations keep their path with no classifier call; the reply copy is server-owned | The fixed reply is returned before the classifier, from `control-copy.ts` |
| 0070 | Identities are not re-minted; a switch is a separate run; no opaque state is replayed | The notice keeps the old action id only; no id is minted |
| 0075 | Interaction data holds identifiers and approved facts only | The notice holds an id and a closed reason |

**Tests (new).** `test/assistant-proposal-replacement.test.ts`, 12 tests, each run warm and cold on the 27 Oct 2026 clock: (a) a changed search, then typed yes, sends nothing and says it was replaced; (b) the old card's button after a search change is `STALE_SURFACE`; (c) a task switch, then typed yes and the old button, sends nothing; (d) a repeated unchanged search keeps the proposal; (e) warm and cold outputs are equal; (f) a forged id is refused as `STALE_SURFACE`. The guest holds a phone number, so a confirmation that wrongly got through would send a request and fail the test.

**Recordings.** `cancel-after-task-switch` is removed (its cancel no longer applies: the proposal is gone). Five journeys are committed, all synthetic: `search-refinement-request-draft`, `missing-information-clarification`, `confirmation-cancelled` (unchanged), `confirm-after-task-switch` (typed yes replaced, old button `STALE_SURFACE`), and `confirm-after-search-change` (typed yes replaced). The recorder guard checks the replaced copy and the absence of any request or pending surface.

**Commands and counts (env -u LLM_API_KEY).**
- `npm run check`: exit 0.
- `node --import tsx --test test/assistant-proposal-replacement.test.ts`: 12 pass, 0 fail (red first: 8 failing before the runtime change, then green).
- `test/assistant-proposal-replacement.test.ts test/assistant-pending-action-restore.test.ts test/assistant-recorded-journeys.test.ts test/assistant-recording-clients.test.ts test/assistant-cold-journey.test.ts test/assistant-turn-stop-cold-restore.test.ts test/assistant-artifact-authority.test.ts test/assistant-booking-journey.test.ts test/shortlet-assistant-evals.test.ts test/assistant-discovery-view.test.ts test/assistant-persistent-continuity.test.ts test/assistant-scope-persistence.test.ts test/guest-account-linking.test.ts test/guest-account-sign-in.test.ts test/guest-offer-access.test.ts test/guest-real-dates.test.ts`: 235 tests, 235 pass, 0 fail.
- `npm run test:assistant`: 67 of 67 pass.
- Not run: full `npm test` and `npm run test:workers` (batch gate).

**Status.** Owner finding 10 is resolved. Issue 03 stays `ready-for-agent` until the batch gate runs.
