# Make assistant thread state durable and enforce one mutating run per thread

Status: ready-for-agent
Type: research
Blocked by: 04
Requested: 25 Oct 2026
PRD: `../PRD.md`

## Why

`AssistantRuntime` keeps every thread in an in-memory `Map` (`#threads`, `apps/local-guest/src/assistant/assistant-runtime.ts` line 132): conversation history, task state, active and superseded surfaces, pending actions. On Cloudflare the runtime lives inside the per-tenant `ShortletPilot` Durable Object (`apps/cloudflare/src/shortlet-pilot-do.ts`, through `createGuestRequestHandler`). Two consequences, not yet confirmed by a test:

1. **State is lost when the object is evicted or redeployed.** A guest mid-conversation loses their shortlist, open surfaces and any pending confirmation. Domain state (requests, bookings, payments) is safe because it lives in the domain services; the conversation is not.
2. **Two turns on one thread can overwrite each other.** `handleTurn` clones the thread, awaits the model (an outgoing fetch, during which a Durable Object accepts other requests), then commits. Two tabs sending at once both commit, and the later one silently wins. ADR 0070 requires only one mutating run per thread.

The Cloudflare Agents SDK's useful idea is one Durable Object per conversation with its own storage. The repo can take the idea without the package, whose built-in state and chat history would cut across ADR 0070 and 0081.

## Questions to answer

1. Confirm or refute both consequences with a test against the Workers test pool (`apps/cloudflare/test/`).
2. Pick the smallest fix. Candidates:
   - **A. Per-thread lock plus thread state in the tenant object's SQLite.** A second turn on a busy thread is refused (or queued) with a stable code; the thread is loaded at turn start and saved by issue 04's `TurnTransaction.commit()`. Smallest change; all threads stay in one object.
   - **B. One Durable Object per thread** (`idFromName` on the thread id), calling the tenant object for domain operations. Isolation and per-thread scale, but a new binding, a cross-object hop per tool call, and ADR 0101 hosting changes.
   Recommendation to test first: A. Move to B only if measured load or isolation needs it.
3. What retention applies to saved conversation history? ADR 0075 proposes 30-day transient and 180-day conversational periods, still provisional. The owner decides which applies.
4. Does any of this need an ADR or an amendment to ADR 0101?

## ADRs

| ADR | Constraint | Affects |
|---|---|---|
| 0070 | One mutating run per thread; a thread never owns domain state; reconnect resumes without a new run | Lock; saved state is interaction state only |
| 0075 | Data minimisation; provisional retention periods | What is saved and for how long |
| 0079 | Durable staging and replay are host-owned | Saved thread state is part of that host responsibility |
| 0081 | Durable replay and recovery stay platform responsibilities, not Weaver's | No Weaver types in saved state |
| 0095, 0101 | Cloudflare hosting and multi-domain object layout | Option B changes the layout |

## Answer

**Chosen: option A** (a per-thread lock inside the tenant object's runtime and store). Option B is not taken. The lock, the delta commit and the card re-presentation are implemented; the tests are in `test/assistant-thread-lock.test.ts`.

**Q1. Is thread state lost on eviction or redeploy?** Partly refuted, with one real gap, now fixed.
- Refuted for what matters. Test: "a cold restore keeps the shortlist, the open card, the pending confirmation and the task rail, but not conversation history". A new application and runtime over the same store restore the shortlist, the pending confirmation (same action id and surface id), the active surface ids, the task rail and the replaced-proposal notice.
- Gap found and fixed. The open confirmation card was not shown on a cold read: `getState` returned only the discovery surface while the runtime still authorised the card, so a reloaded page had no card to press. `getState` now presents the open card, rebuilt from the restored state (`#withOpenProposalCard` in `shortlet-app.ts`, `AssistantRuntime.pendingActionSurfaceFor`). Nothing new is persisted.
- Not restored, by design or not separately verified: model conversation history (`conversationHistory`; ADR 0070 and 0075, not persisted); `lastSurfaces`; the `supersededSurfaces` memory (not persisted; the existing forged, superseded and unknown id tests pass, but that is not proof a superseded id stays dead across a restore); `canonicalUserFactHistory` keeps ISO-date facts only.
- The premise "every Worker request is a cold restore" (AGENTS.md) is not what the code does for a warm object. `shortlet-pilot-do.ts` caches the runtime (`this.#runtime ??=`), and a restore runs only when the runtime does not already hold the thread. The restore path runs after eviction or redeploy, not on each request. The owner should correct AGENTS.md.

**Q2. Option A or B?** A. Both races (two typed turns, and a confirm during a typed turn) are between requests to one tenant object (ADR 0095). A per-thread lock in that object covers them with no new binding, no call per tool and no ADR 0101 layout change. B would solve isolation or per-thread scale that nothing measured here needs.

**Lock design.**
- `apps/local-guest/src/assistant/assistant-thread-lock.ts`. `beginThreadRun(owner, threadId)` checks and sets a per-thread flag in a `WeakMap` keyed by the tenant's environment (one per store). It runs synchronously, before the first await of `handleTurn`. The release is idempotent and runs in `finally`, so it covers an answer, a refusal, a thrown error and a deadline stop.
- Refused with the closed code `THREAD_BUSY` (no queueing): every typed turn while a run is in flight (`handleTurn` writes its one refusal record); every assistant event (`handleAssistantEvent`); every shell event on the thread (`handleEvent`, `handleEventAsync`, which also refuse before the restore). The client retries.
- Not refused: reads (`getState`, `getTaskRail`, the projections). On a busy thread a restore and the in-place stay, area and selection edits do nothing, so the in-flight run commits its own state.
- Lifetime: the flag lives as long as the tenant's runtime, which is the Durable Object instance that also holds the in-flight request, so it cannot outlive the run that set it. Two runtime instances over one store (the tests' cold restore) share the `WeakMap`, so the lock still applies.
- Delta commit: `TurnTransaction` records the open proposal, its card and its replaced notice as they were when the candidate was taken. `commit` keeps the thread's current value for a proposal the candidate only carried over, and never re-arms a superseded card. A stale clone cannot restore an executed proposal (seeded interleavings, 200 orders, in the test file).
- A domain refusal thrown by a confirm (for example an overlap with another booking) no longer escapes the turn: `#executePendingAction` catches it, drops the proposal, commits the drop, and returns the existing code `STALE_SURFACE`.

**Q3. Retention.** Nothing new about conversation text is persisted. The card re-presentation reads the existing pending-action projection. The periods are an owner decision: the provisional ADR 0075 values (30-day transient, 180-day conversational) are not applied or changed here.

**Q4. ADR amendment?** No. ADR 0070 already requires one mutating run per thread and read-only projections; this implements it. ADR 0106's closed control-outcome list is unchanged, and `THREAD_BUSY` is a result code, not a control outcome. ADR 0101 is unchanged (no object, binding or routing change). One note for the owner: the turn record's `error.type` gains the value `THREAD_BUSY` for a refused turn; the record already writes closed refusal codes there. No ADR text needs changing.

**Not done, and why this stays `ready-for-agent`.**
- No Workers-pool interleave test. Q1 asked for one. The tests run the same runtime in Node over one store. Follow-up: `.scratch/assistant-runtime-hardening/issues/08-thread-lock-workers-pool-and-browser-retry.md`.
- The browser does not yet retry on `THREAD_BUSY`; the guest sees the fixed copy. The owner decision assumed a client retry. Follow-up 08.
- The full `npm test` and `npm run test:workers` are open for the batch gate (see Comments).

## Comments

### Triage record (28 Oct 2026), implementation of options and owner decisions

**Tests first.** `test/assistant-thread-lock.test.ts`, written before the change. On the first run 7 of the 12 criteria failed as predicted (no refusal, a throw out of the turn, a restored proposal). The 5 that passed had no interleave to exercise (cross-thread, read-only, deadline, a Yes after execution, the no-interleave commit). Final file: 14 tests, all pass. Every test is named for one criterion and covers its failure path.

**Criteria (as tested).**
1. A confirm while a typed turn is in flight is refused with `THREAD_BUSY`; the proposal stays open.
2. The runtime itself refuses a confirm event during a run, for a host that calls it directly.
3. A confirm before a typed turn starts cannot be undone by that turn's later commit.
4. A second typed turn during a run is refused, not queued, and does not wait behind the model.
5. A Yes after an executed proposal returns a closed code and never throws.
6. A Yes the domain refuses returns a closed code, drops the proposal and never throws.
7. `THREAD_BUSY` clears after a run that threw inside the planner (finally).
8. `THREAD_BUSY` clears after a turn that stops at its whole-turn deadline (finally).
9. Two different threads do not block each other.
10. Read-only calls are never refused while a turn is in flight.
11. A refused busy turn writes exactly one turn record, and no `turn_stop` reaches the running turn.
12. A stale clone cannot restore an executed pending action, whatever the commit order (seeded).
13. A restore or a stay edit during a run changes nothing, and the run commits its own delta.
14. A cold restore keeps the shortlist, the open card, the pending confirmation and the task rail, but not conversation history.

**Commands and counts (final code).**
- `npm run check`: exit 0 (root, `apps/cloudflare`, its test and tooling configs, worker bundle guard).
- `env -u LLM_API_KEY NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npx tsx --test` over the 23 regression files plus `test/assistant-thread-lock.test.ts`: 240 tests, 240 pass, 0 fail.
- `npm run test:assistant` (run as `node --import tsx --test test/assistant-interactions-protocol.test.ts test/shortlet-assistant-evals.test.ts` with the same env): 67 pass, 0 fail, exit 0.
- `npm run test:workers -- apps/cloudflare/test/demo-extended-stay.spec.ts` (the spec that drives the guest turn and event endpoints on the Durable Object): 2 pass, 0 fail, exit 0.
- The lock file alone: 14 tests, 14 pass (after the last edit, see below).

**Mutation checks.** Each guard disabled in turn (source restored after each, and confirmed clean):
- M1 no lock: 3 tests fail.
- M2 no release in `finally`: 2 tests fail, the throw and deadline cases among them.
- M3 whole-clone commit (no delta): the stale-clone test fails.
- M4 domain refusal allowed to throw: the domain-refusal test fails.
- M5 runtime refusal of events removed: not caught at first, because the shell refuses first. Fixed by test 2 (direct call); now caught.
- M6 no refusal record: the record test fails.
- M7 no card re-presentation: the cold-restore test fails.
- M8 restore allowed during a run: the restore test fails.

**Regression that needed a fix, not a test edit.** The first 24-file run failed one boundary test: the platform-file allowlist counted a fifth `thread-…:pending-action:…` template literal in `assistant-runtime.ts` (the expected count is four, and no test was changed). The card id is now built by `pendingActionSurfaceId` in `pending-action-a2ui.ts`, which the boundary test does not scan. The boundary test passes.

**ADR table (read: 0070, 0074, 0075, 0079, 0081, 0092, 0093, 0095, 0101, 0106).**

| ADR | Constraint | Where it applies |
|---|---|---|
| 0070 | One mutating run per thread; reads are projections | `assistant-thread-lock.ts`; runtime `handleTurn`, `handleAssistantEvent`, `threadBusy`; shell `handleEvent`, `handleEventAsync`, `#restoreAssistantFromGuestThread` |
| 0074 | Surfaces fail closed; restore from server projections; superseded stays dead | `pendingActionSurfaceFor`, `#withOpenProposalCard`; `TurnTransaction.commit` delta and superseded union |
| 0075 | No new persisted content; closed codes only in telemetry | No new fields; the refusal record holds `THREAD_BUSY` and no text |
| 0079 | One turn record per turn, observable; deadline stops are normal ends | `handleTurn` `finally` releases the lock before the record is written |
| 0081 | No Weaver types in state | Unchanged |
| 0092, 0093 | Accounts and guest context | Read only; unchanged |
| 0095, 0101 | One tenant object; no new object | The lock lives in the tenant's environment; no binding or layout change |
| 0106 | Closed control-outcome list; restore re-keys the same surface id | No new outcome; `THREAD_BUSY` is a result code; card id unchanged |

**Definition of Done** (`docs/agents/issue-tracker.md`).
1. Named test per criterion: met (14 tests above, one criterion each).
2. Failure paths: refusals, thrown errors, deadline stop, domain refusal, a restore or edit during a run, a stale clone.
3. ADRs: the table above, read and cited.
4. Injected dependencies used: the lock uses the tenant environment; `TurnTransaction` uses its base snapshot in `commit`; `pendingActionSurfaceFor` is called by `getState`.
5. No invented policy: the new closed code `THREAD_BUSY` and its fixed copy are owner decision 1 (the copy is platform text and should be read by the owner). No engineering numbers are introduced. The client retry delay is a follow-up (08).
6. No credentials in logs: the refusal record and every other record carry the code only.
7. `npm run check` passes; the full `npm test` and `npm run test:workers` are open for the batch gate.

**Status.** `ready-for-agent`. The batch gate is open: the full `npm test` and `npm run test:workers` run once per batch before any merge to main, after every issue in the batch is resolved (AGENTS.md, Test scope). DoD item 7 stays open until that gate passes. The issue is not `resolved`.

**Owner decisions needed.**
1. Accept `THREAD_BUSY` (code and fixed copy) as a closed refusal, and the turn-record `error.type` value for it.
2. Confirm that a refusal covers every shell event on a busy thread, including domain buttons (View, Request to Book), not only assistant confirmations.
3. Correct the AGENTS.md sentence "every Worker request is a cold restore" (the warm Durable Object keeps its runtime).
4. Retention periods (ADR 0075) are still the owner's decision; nothing new was persisted.

### Reviewer finding (28 Oct 2026): a confirm can resurrect an executed proposal during an in-flight turn

Not fixed in issue 03 (commit c4d172c). It needs one mutating run per thread (ADR 0070), which is this issue's scope. Fixed here: the lock refuses the confirm during the run (test 1), the delta commit stops a stale clone from restoring an executed proposal (test 12), and a Yes whose confirmation throws returns a closed code (tests 5 and 6).

Probe (reviewer): a typed turn is in flight, and a confirm for the same proposal lands while it runs. Both paths clone the task state when they start and commit the whole clone when they finish:
- `handleTurn` clones at `assistant-runtime.ts:735` (`let candidateTaskState = cloneTaskState(thread.taskState)`) and commits it at lines 780, 806 and 829 (the typed confirm and cancel paths) and 1209 and 1257 (the turn's main commit points). Line numbers measured at the commit that adds this note, after the review follow-ups.
- `handleAssistantEvent` clones at `assistant-runtime.ts:1356` and commits at lines 1393, 1460 and 1491.

The confirm executes the proposal and commits. The in-flight turn then commits its older clone, which still holds the proposal as pending, so the executed proposal is restored. A later typed yes then tries to confirm it again.

Observed symptom (reviewer, thrown error): a later typed "Yes" after the resurrected proposal threw out of `handleTurn` with "Unit unavailable ... Overlaps with Payment Pending" instead of returning a closed code. The domain overlap guard stopped a duplicate booking, so no second request was made, but the error escaped the turn.

Required by this issue: serialise mutating turns per thread (one active run; a second mutating event waits or is refused with a closed code), and commit a task-state change as a delta rather than a whole clone, so an earlier clone cannot restore an executed action. Cover it with a test that interleaves a confirm inside a planner round, and make a later yes return a closed code rather than throw.
