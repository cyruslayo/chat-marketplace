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

### Review follow-up on supersession (28 Oct 2026, HEAD 0ea551f)

**1. Chip edit (HIGH, fixed).** Root cause: `#handleCriteriaEdit` changed the stay intent (`recordGuestStay`) and ran the discovery search, but nothing told the runtime. The proposal kept its old references, so a typed yes sent the old proposal (reproduced: propose, guests 2→1, typed yes → `:request:`). The runtime shortlist also stayed on the old results after a chip search, so a *new* proposal would have referred to stays the guest no longer saw. Fix: after each chip edit the shell calls `applyDiscoveryShortlist` with the shortlist of the new discovery results. The runtime replaces its shortlist and removes the proposal when `proposalStillAuthorised` fails (same rule as a planner search). The shell state is persisted by `#syncPendingAction`, so a cold restore agrees.
- Chip undo: same reconcile call. The undo's own facts are recorded through the new `#recordAssistantStayFacts`. Undo is not reachable in an assistant thread, see the pre-existing defect below, so no undo test exists.
- A chip edit that changes nothing keeps a valid proposal (test: `chip no-op`, warm and cold).

**2. Wrong clears (MEDIUM, fixed on the server; client.ts unchanged).** The removal now runs only after a switch succeeds and only when the active task changes.
- Task events (`platform.task.start`/`switch`): removal only when `applied.activeTaskId` differs from the committed active task. A same-task switch, a starter click while Stays is open, and an unknown task or domain (refused) keep the proposal.
- Model-invoked `start_task`/`switch_task`: the same check, and `result.error` (UNKNOWN_TASK, UNKNOWN_DOMAIN) never removes. The removal is applied to the previous task's state object, which is the state the workspace saves for that task.
- The server decides from the event's own task or domain, so client.ts is not changed.

**3. Notice lifetime (LOW, code matches the comment).** The notice is now consumed only by a typed confirmation or cancellation attempt. An unrelated turn leaves it, so the next yes still gets the replaced reply. A cancellation attempt returns the same replaced reply (the proposal is gone either way). Test: `notice lifetime` (warm and cold).

**4. Staging-like guest (LOW, fixed).** The replacement and restore tests use the staging-like guest (`openJourneyEnvironment`) wherever no phone-only confirm path is reached. A phone is kept only where a confirm needs one, with a comment there.

**Decisions and exceptions for the owner.**
- The router prompt ("Start a Shop search?") removes the proposal even though no switch has happened yet. Fail closed: the guest asked to switch after a proposal, and a yes must not confirm it. This is the one place the rule does not wait for an actual change of task. Confirm this is wanted.
- A chip edit or undo removes a proposal when the stay (unit, dates or party) no longer matches. It keeps the proposal when the stay is still in the results with the same dates and party, and that is the only case that keeps it.

**Pre-existing defects found, not fixed (owner decision).**
- Undo history in assistant threads is reset by every typed turn (`#syncAssistantPersistence` → `#assistantContextSearch` sets `searchHistory = [current]`) and by every page load (`getState` → `#rebuildAssistantDiscovery`). So a chip undo cannot step back in an assistant thread, cold or warm, and a proposal can never sit on an undoable history. The chip undo path shares the reconcile code, but no test exercises it. The owner should decide whether undo history must survive assistant turns.
- Finding 2 (in-flight resurrection) is not fixed here: see issue 06 Comments.

**Commands and counts (env -u LLM_API_KEY, 28 Oct 2026).**
- Red first: `node --import tsx --test test/assistant-proposal-supersession.test.ts` against the pre-fix runtime (the 0ea551f source): 4 pass, 8 fail of 12. The passing cases are behaviour that already held before the fix and must keep holding.
- Green: the same file: 12 pass, 0 fail (warm and cold for chip edit, button, no-op, same-task and starter, failed switch, real switch, notice lifetime).
- `npm run check`: exit 0.
- `node --import tsx --test test/assistant-proposal-replacement.test.ts test/assistant-pending-action-restore.test.ts test/assistant-recorded-journeys.test.ts test/assistant-recording-clients.test.ts test/assistant-cold-journey.test.ts test/assistant-turn-stop-cold-restore.test.ts test/assistant-artifact-authority.test.ts test/assistant-booking-journey.test.ts test/shortlet-assistant-evals.test.ts test/assistant-discovery-view.test.ts test/assistant-persistent-continuity.test.ts test/assistant-scope-persistence.test.ts test/guest-account-linking.test.ts test/guest-account-sign-in.test.ts test/guest-offer-access.test.ts test/guest-real-dates.test.ts test/guest-chip-continuity.test.ts test/assistant-proposal-supersession.test.ts`: 253 tests, 253 pass, 0 fail.
- `npm run test:assistant`: 67 of 67 pass.
- Recordings re-recorded offline into a scratch folder: all five content-identical to the committed files (line endings aside), so none changed.
- Not run: full `npm test`, `npm run test:workers`. client.ts not changed; no client.js regenerated.

**Status.** Issue 03 stays `ready-for-agent`; the batch gate is still open.
- Finding 2 (reviewer, not fixed here): a confirm that lands during an in-flight typed turn can resurrect an executed proposal, because `handleTurn` commits a whole cloned task state. Belongs to issue 06 (one mutating run per thread, ADR 0070); noted there.

### Re-review follow-up (28 Oct 2026, HEAD 1cfa1bd)

**Commit c4d172c does NOT fix the in-flight resurrection.** A confirm that lands during an in-flight typed turn can restore an executed proposal, because `handleTurn` and `handleAssistantEvent` commit a whole cloned task state (issue 06 Comments, with the line references and the thrown "Overlaps with Payment Pending" symptom). That is deferred to issue 06 (one mutating run per thread, ADR 0070). This commit does not rewrite c4d172c's message.

**Test gaps closed (mutation-checked).**
- Model-invoked switches (`switch_task` to an unknown task, `start_task` to an unknown domain): a new test keeps a valid proposal through both refusals, and a later typed yes still confirms (phone-holding guest, finding 9). Mutation A removes the actual-change guard on the planner path, so every switch clears the proposal. Tests `model-invoked switches, warm` and `cold` fail (2 of 16 red), and the runtime is restored byte-identical.
- Event-path actual-change guard (mutation B: removal of `if (applied.activeTaskId !== thread.activeTaskId)`): not observable. The switch restores a clone taken before the removal, and `#syncActiveTask` rewrites the stored copy from the committed state, so the removal leaves the live state unchanged. The test for a same-task switch and the Stays starter stays in the suite and says so in its comment. Mutation B survives all 16 tests. The planner-path test is the one that discriminates the same mutant class.
- Chip undo, warm: propose, chip edit, undo, then a typed yes. Undo restores the searched party size and does not bring the removed proposal back; the typed yes gets the replaced reply and nothing is sent; the old card is `STALE_SURFACE`.
- Chip undo, cold: `NOTHING_TO_UNDO` is pinned as a test. It documents the pre-existing history reset and must change only when the owner decides the history must survive page loads and typed turns.
- Staging-like variants: chip edit (typed yes and button), chip no-op, real switch, and notice lifetime use the staging-like guest. A phone is kept only for the scenarios that confirm a still-valid proposal (the event-path test and the model-invoked test), each with a comment.

**Wording corrected.** The comment on the notice in `assistant-runtime.ts` now says only a typed confirmation or cancellation attempt consumes the notice. The header of `test/assistant-proposal-replacement.test.ts` says the guest is staging-like, and no scenario there reaches the phone-only confirm path.

**Commands and counts (env -u LLM_API_KEY).**
- `npm run check`: exit 0.
- `node --import tsx --test test/assistant-proposal-supersession.test.ts`: 16 pass, 0 fail (warm and cold).
- Mutation A (planner-path guard removed): `test/assistant-proposal-supersession.test.ts`: 2 fail (warm and cold `model-invoked switches`), 14 pass. Runtime restored, verified with `cmp`.
- Mutation B (event-path guard removed): 16 pass, 0 fail. Expected, see above. Runtime restored, verified with `cmp`.
- Affected set (`assistant-proposal-supersession`, `assistant-proposal-replacement`, `assistant-pending-action-restore`, `assistant-cold-journey`, `assistant-turn-stop-cold-restore`, `assistant-recorded-journeys`, `guest-chip-continuity`): 50 tests, 50 pass, 0 fail.
- `npm run test:assistant`: 67 of 67 pass.
- Not run: full `npm test`, `npm run test:workers`.

### Where-chip cold-restore fix (28 Oct 2026, HEAD cf4199f)

**Root cause.** `#recordAssistantStayChip` recorded only the `when` and `guests` chips. A `where` (area) chip reached the discovery and the strip, but not the assistant's stay intent (`stayIntent.location` and `neighbourhood`) or `thread.assistantContext`. Both kept the previous area. On every cold request `#rebuildAssistantDiscovery` (called from `getState` and from the thread load) rebuilt the discovery from that stale context, so a reload showed the old area's stays, and a proposal made after a cold request named the old stay (`unit-lagos-ikoyi-001` instead of the Lekki stay). A warm application was not affected, because it never rebuilt.

**Approach.** The area is recorded through the same path as the other stay facts, and into the same persisted field. Nothing new is stored. `assistantContext` already has `city` and `neighbourhood`, and `#assistantContextFromState` keeps the neighbourhood only when it is a known one.
- `assistant-runtime.ts`: `recordGuestArea(threadId, { city, neighbourhood? })` sets `stayIntent.location` and `neighbourhood`; a general area clears the neighbourhood; a blank city is refused.
- `shortlet-app.ts`: `#recordAssistantStayChip` sends a `where` chip to `#recordAssistantArea`, which needs a city (fail closed otherwise). `#persistAssistantStayContext` keeps `thread.assistantContext` in step, shared by the `when`, `guests` and area paths. Undo records the previous area as well, so undo and the strip agree.
- The supersession rule is unchanged: the area goes through `applyDiscoveryShortlist` after the search, so an area change removes a proposal whose unit is no longer in the results, and a same-area edit keeps it.
- A forged or unknown area is refused by `applyCriteriaEdit` (`INVALID_CRITERIA`) before anything is recorded.

**ADR table.**

| ADR | Constraint | Where it applies |
|---|---|---|
| 0106 | Chip facts are guest-authored structured input; the assistant's task state and its persisted context keep them | The `where` chip is recorded beside `when` and `guests` |
| 0093 | Persisted assistant context keeps only the fields it already held (city, neighbourhood, dates, party size) | `assistantContext` already had `neighbourhood`; no new record |
| 0074 | A changed stay removes an open proposal; an unchanged one keeps it; stale surfaces fail closed | The reconcile after the search, unchanged |
| 0075 | No restricted data in stored interaction data | Area names are catalogue values |

No ADR change and no schema change: the fix persists existing state through an existing field, so the stop condition did not apply.

**Tests (new): `test/assistant-where-chip.test.ts`, 12 tests, warm and cold, staging-like guest, 27 Oct 2026 clock.** (a) a where chip shows the new area on reload; (b) a typed request to book names the new area's stay; (c) a guests chip after a where chip keeps the area on reload; (d) undo of a where chip restores the previous area (warm), and a cold undo reports `NOTHING_TO_UNDO` (cold, the pre-existing history reset); (e) a same-area chip keeps a valid proposal, a changed area removes it; (f) a forged area is rejected and the state is unchanged. Red first: 6 of 12 failed (warm (a) and (c), cold (a), (b), (c), (d)). Warm (b), (d), (e), (f) and cold (e), (f) already held.

**Shared helper.** `test/helpers/assistant-chip-session.ts` (new) holds the chip driver (cold reload before each step, warm without it, criteria key from the last result), `assertOk`, `proposalCard`, `requestSent`, and the staging-like and phone-holding guests. `test/assistant-proposal-supersession.test.ts` now uses it; its private helpers are removed and its 16 tests are unchanged.

**Mutation checks** (runtime and shell restored byte-identical after each, verified with `cmp`):
- Mutant E, the edit path does not record the area (`#recordAssistantStayChip` returns before `#recordAssistantArea`): 6 of 12 where-chip tests fail (warm (a), (c); cold (a), (b), (c), (d)).
- Mutant U, the undo path does not record the previous area: 1 test fails (warm (d)).

**Recordings.** Re-recorded offline into a scratch folder: all five committed recordings are content-identical (line endings aside). None of the journeys uses a where chip, so none changed.

**Commands and counts (env -u LLM_API_KEY).**
- Red first: `node --import tsx --test test/assistant-where-chip.test.ts` before the fix: 6 pass, 6 fail.
- Green: the same file: 12 pass, 0 fail.
- `npm run check`: exit 0.
- Affected set (`assistant-where-chip`, `assistant-proposal-supersession`, `assistant-proposal-replacement`, `assistant-pending-action-restore`, `assistant-cold-journey`, `assistant-turn-stop-cold-restore`, `assistant-artifact-authority`, `assistant-booking-journey`, `assistant-recorded-journeys`, `assistant-recording-clients`, `shortlet-assistant-evals`, `guest-chip-continuity`, `assistant-discovery-view`, `assistant-persistent-continuity`, `assistant-scope-persistence`, `guest-account-linking`, `guest-account-sign-in`, `guest-offer-access`, `guest-real-dates`): 269 tests, 269 pass, 0 fail.
- `npm run test:assistant`: 67 of 67 pass.
- Not run: full `npm test`, `npm run test:workers`. No client.ts change, no client.js regenerated.

**Status.** Issue 03 stays `ready-for-agent`; the batch gate is still open.

### Final polish (28 Oct 2026, HEAD c4e134f)

**1. General-area where chip (fixed, warm and cold).** Warm, the results route kept the old neighbourhood (`neighbourhood=Old+Ikoyi`) while the strip said "Lagos (all areas)". Cold was correct. Root cause: the warm results surface is rebuilt from the runtime's stored discovery artifact, and a chip search never handed the new artifact to the runtime, so the rebuild used the typed search's artifact. Fix (about eight lines): `applyDiscoveryShortlist` takes the new artifact, and the reconcile after a chip search passes it. No shared contract changed. Test: `(g, warm)` and `(g, cold)` assert no `neighbourhood=` in any results route and no neighbourhood in the stay. Mutation check: removing the artifact pass-through fails `(g, warm)`.

**2. Equivalent guards (both removed, documented as equivalent).**
- Planner path (`applied.result.error === undefined &&` dropped): `applyTaskTool` never changes the active task on an error, so `applied.activeTaskId !== previousActiveTaskId` alone already rejects a refused switch. The actual-change guard is not dead: without it a refused `switch_task` returns the same state object and the removal clears the live proposal (mutant A, killed by the model-invoked tests).
- Event path (`if (applied.activeTaskId !== thread.activeTaskId)` dropped): a refused event returns before the removal. A same-task switch removes from the previous task's state object, and `#syncActiveTask` then overwrites that task's stored state from the committed state, so the removal has no effect. For a real switch the removal runs either way. Mutant B (this guard removed) left all 16 supersession tests green before this change, which is the empirical check; the reasoning above is why no test can observe it.
Comments in `assistant-runtime.ts` now state these roles, and neither claims a guard that is dead.

**3. Refreshed references.** Issue 06 Comments: the clone and commit lines are re-measured at this commit (clone at 735 and 1356; `handleTurn` commits at 780, 806, 829, 1209, 1257; `handleAssistantEvent` commits at 1393, 1460, 1491). The issue 03 note "about line 748" now refers to the notice comment by name. The recordings are described as content-identical (line endings aside).

**4. Test hygiene.** The supersession file's ADR 0074 header is restored (scope, staging-like versus phone-only rationale) and the double blank line removed. The four `LocalGuestEnvironment.openNode` literals in `test/assistant-pending-action-restore.test.ts` now use the shared `phoneGuest()` from `test/helpers/assistant-chip-session.ts`. The criteria-strip and budget chip events are not extracted, as asked.

**5. Catalogue membership (fixed, with tests).** `recordGuestArea` now records only areas in the strip's catalogue, through the existing `searchAreaFor` (SEARCH_AREAS in `concierge.ts`). Nothing new is invented. Test `(h, warm)`: an unknown city and an unknown neighbourhood are refused and change nothing; a catalogue area is recorded. Mutation check: removing the catalogue check fails `(h, warm)`.

**Commands and counts (env -u LLM_API_KEY).**
- `npm run check`: exit 0.
- Affected set (`assistant-where-chip`, `assistant-proposal-supersession`, `assistant-proposal-replacement`, `assistant-pending-action-restore`, `assistant-cold-journey`, `assistant-turn-stop-cold-restore`, `assistant-artifact-authority`, `assistant-booking-journey`, `assistant-recorded-journeys`, `assistant-recording-clients`, `shortlet-assistant-evals`, `guest-chip-continuity`, `assistant-discovery-view`, `assistant-persistent-continuity`, `assistant-scope-persistence`, `guest-account-linking`, `guest-account-sign-in`, `guest-offer-access`, `guest-real-dates`): 272 tests, 272 pass, 0 fail, 0 skipped.
- `npm run test:assistant`: 67 of 67 pass.
- Mutation checks (each restored with `cmp`): removing the artifact pass-through (`(g, warm)` fails); removing the catalogue check (`(h, warm)` fails).
- Not run: full `npm test`, `npm run test:workers`.

**Status.** Issue 03 stays `ready-for-agent`; the batch gate is still open.
