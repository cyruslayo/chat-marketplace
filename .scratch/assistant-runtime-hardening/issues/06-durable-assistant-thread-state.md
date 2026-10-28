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
- The premise "every Worker request is a cold restore" (AGENTS.md) is not what the code does. A request reuses its session runtime while that runtime is resident (`guest-server.ts`, `runtimeForSession`; the Durable Object caches its handler in `shortlet-pilot-do.ts`, `??=`). A restore runs only when the runtime does not already hold the thread. Eviction, restart or redeploy rebuilds the runtime from the store, and only then does the restore path run. The owner should correct AGENTS.md (not edited by this issue).

**Q2. Option A or B?** A. Both races (two typed turns, and a confirm during a typed turn) are between requests to one tenant object (ADR 0095). A per-thread lock in that object covers them with no new binding, no call per tool and no ADR 0101 layout change. B would solve isolation or per-thread scale that nothing measured here needs.

**Lock design.**
- `apps/local-guest/src/assistant/assistant-thread-lock.ts`. `beginThreadRun(store, threadId)` checks and sets a per-thread flag in a `WeakMap` keyed by the store handle (`environment.database`). Every session runtime over the tenant receives that same handle, so one registry covers them all. It runs synchronously, before the first await of a run. The release is idempotent and runs in `finally`, so it covers an answer, a refusal, a thrown error, a deadline stop and a stuck provider call (bounded by an outer timeout, `MODEL_CALL_OUTER_GRACE_MS`).
- Refused with the closed code `THREAD_BUSY` (no queueing): every typed turn while a run is in flight (`handleTurn` writes its one refusal record); every assistant event (`handleAssistantEvent`); every shell event on the thread (`handleEvent`, `handleEventAsync`, which also refuse before the restore). The client retries.
- Not refused: reads (`getState`, `getTaskRail`, the projections). On a busy thread a restore and the in-place stay, area and selection edits do nothing, so the in-flight run commits its own state.
- Lifetime: the flag is set and cleared in the registry of one store handle. A session runtime with a run in flight is never evicted, idle or least recently used (`hasRunInFlight`), so the run commits into the runtime that started it. Eviction, restart or redeploy rebuilds runtimes from the store, and no flag outlives the run that set it. Two runtime instances over one store (the tests' cold restore and the session runtimes) share the `WeakMap`, so the lock still applies.
- Delta commit: `TurnTransaction` records the open proposal, its card and its replaced notice as they were when the candidate was taken. `commit` keeps the thread's current value for a proposal the candidate only carried over, and never re-arms a superseded card. A stale clone cannot restore an executed proposal (seeded interleavings, 200 orders, in the test file).
- A confirmation that throws `AssistantStaleProposalError` (the typed domain refusal a pack raises, for example a Unit taken meanwhile) is reported as `STALE_SURFACE`, and the proposal is dropped. Any other throw drops the proposal, commits the drop and is rethrown; the turn and event boundaries then return `CONCIERGE_UNAVAILABLE`. A non-domain failure is never reported as a stale proposal.

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

### Review follow-up (28 Oct 2026): fixes to the failed review

**Step 0, leftover guard.** The killed agent had left a disabled guard: `handleTurn`'s `finally` no longer called `release()`, so every turn would have held the thread lock for ever. It was restored before any other change. A search for leftover markers, `.only`, `.skip` and `if (false)` found nothing else in the changed files.

**1. Lock keyed on the store handle; session runtime never evicted while a run is in flight.** The lock is keyed on `environment.database` (`assistant-thread-lock.ts`). `runtimeForSession` in `guest-server.ts` skips any runtime whose `hasRunInFlight()` is true, both for the idle sweep and for the least-recently-used cap (the cap is exceeded for that request rather than closing a run). Tests: `test/assistant-session-thread-lock.test.ts`, "with an idle timeout, an idle sweep that runs mid-turn does not evict the session whose turn is in flight" and "with sessionRuntimeLimit 1, a second session that takes the slot mid-turn leaves the held turn's thread refused, not bypassed". Both are session-scoped.

**2. Symmetric delta commit.** `TurnTransaction` compares each base (pending proposal id, card surface id, replaced notice id) against a null sentinel (`NONE`). An absent field and a null field are the same "none". One rule applies to all three fields: take the thread's value unless this run changed the field and the thread still holds the run's base. Test: "an absent proposal field and a null one are the same empty base, so a run that opened nothing keeps another run's proposal". The existing seeded interleaving tests (200 and 300 orders) still pass.

**3. Outer timeout.** `#generatePlan` races each model call against its own budget plus `MODEL_CALL_OUTER_GRACE_MS` (500 ms). A call that ignores its abort ends the turn as `turn_deadline`, the lock is released in `finally`, and exactly one turn record is written. Test: "a planner call that never resolves and ignores abort ends the turn, releases the lock, and writes one record".

**4. Shell post-await recheck, and the Paystack decision.**
- The recheck in `handleEventAsync` (after its await for hydrate and remote load) is now tested on its own. The event starts after the typed turn has taken the lock, so its synchronous check passes and only the recheck can refuse it. Test: "a shell event that starts before a run and resumes during it is refused after its await". A second test covers a new event refused at its own check.
- Paystack decision: the `shortlet.card-payment.initialize-checkout` path keeps the thread lock across the provider await (it writes the shell thread, so a typed turn or another event must not interleave with it). It takes the lock with `beginShellRun` and releases it in `finally`. Coverage: the `beginShellRun` test ("a shell run held across an external await refuses a typed turn, and releases when it finishes").
- Coverage gap, not closed here: no test drives the Paystack path itself. Mutation M12 (the release removed from its `finally`) passes all 28 tests. A follow-up test should hold the provider call and assert the release on success and on a provider failure.

**5. Narrow catch.** A pack's confirmation now throws `AssistantStaleProposalError` (generic, in `assistant-stage-handler.ts`) for its typed domain refusal. The runtime cannot import the Shortlet domain (the boundary test forbids it, ADR 0099), so the shortlet handler maps `UnitUnavailableError` to that generic error. In `#executePendingAction`, only `AssistantStaleProposalError` becomes `STALE_SURFACE`. Any other throw drops the proposal, commits the drop and is rethrown. The typed Yes path and the event path catch the rethrow and return `CONCIERGE_UNAVAILABLE`. Tests: "a Yes whose confirmation the domain refuses returns a closed code, drops the proposal and never throws", "a non-domain throw after a side effect is not reported as STALE_SURFACE, and the proposal is dropped", and "a non-domain confirm throw on the event path returns the closed unavailable code, drops the proposal and is not reported as stale".

**6. Answer and issue 08.** The Answer's premise, lock-keying, lifetime and refusal bullets, and issue 08's "Today's behaviour" and owner notes, now describe session runtimes over one store handle. A request reuses its runtime while it is resident; eviction, restart or redeploy rebuilds it from the store. AGENTS.md was not edited.

**7. Nits.** `reset()` refuses while a run is in flight (test "reset refuses while a run is in flight"). The doc comment for `#assistantSurfaces` sits directly above that method. `PENDING_ACTION_STAGE` replaces the literal `"pending_action"` in `setPendingAction` and in the test file.

**Commands and counts (final code, after all edits; no code changed after these runs).**
- `env -u LLM_API_KEY npm run check`: exit 0 (root `tsc`, `apps/cloudflare` tsc, its test and tooling configs, and the Worker bundle guard).
- `env -u LLM_API_KEY NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow node --import tsx --test test/assistant-thread-lock.test.ts test/assistant-session-thread-lock.test.ts`: 28 tests, 28 pass, 0 fail (the Node test run of the two lock files; the session file has 2 tests and the lock file 26).
- `npm run test:assistant` (its script body, run directly with the same env): `test/assistant-interactions-protocol.test.ts` and `test/shortlet-assistant-evals.test.ts`: 67 tests, 67 pass, 0 fail, exit 0.
- Regression, same env: all 39 `test/assistant-*.test.ts` files plus `test/shortlet-assistant-evals.test.ts`, `test/integrate-booking-request-application.test.ts` and `test/local-apartment-owner-surface.test.ts`: 394 tests, 394 pass, 0 fail.
- `tsc --noEmit` on the root project (the same check run before the regression set): exit 0.

**Mutation checks (each guard disabled once; the file restored byte for byte and checked by SHA-256 against the pre-mutation values).** The lock-file pair (28 tests) was run for each.

| # | Mutation | Result |
|---|---|---|
| M1 | `release()` removed from `handleTurn`'s `finally` | 27 of 28 fail |
| M2 | idle sweep evicts a runtime with a run in flight | 1 fails (the idle session test) |
| M3 | LRU cap evicts a runtime with a run in flight | 1 fails (the `sessionRuntimeLimit 1` session test) |
| M4 | no outer bound on the planner call | 1 fails (the stuck planner test) |
| M5 | no recheck after the shell event's await | 1 fails (the post-await test) |
| M6 | whole-clone commit (no delta) | 5 fail (the stale-clone, absent-field and clear tests) |
| M7 | catch-all in `#executePendingAction` reports every throw as stale | 2 fail (the non-domain tests) |
| M8 | domain refusal rethrown instead of typed | 1 fails (the domain-refusal test) |
| M9 | `reset()` guard removed | 1 fails |
| M10 | event path skips the runtime's busy guard | 1 fails (the direct runtime-call test) |
| M11 | turn path accepts a busy thread | 7 fail |
| M12 | Paystack path does not release the shell run | 0 fail (coverage gap, see item 4) |

**Definition of Done (`docs/agents/issue-tracker.md`), checked.**
1. A named test per criterion: met (the criteria above and the new tests).
2. Failure paths: refusals, thrown errors, deadline stop, stuck provider call, domain refusal, non-domain throw, eviction under a run.
3. ADRs: unchanged table above. ADR 0070 (one run per thread, the lock and its release), 0074 (surfaces fail closed, restore keeps the id), 0079 (the turn record is written once, after the release), 0099 (the runtime imports no domain: the boundary test passes), 0101 (no object or binding change), 0106 (no new control outcome; `CONCIERGE_UNAVAILABLE` and `STALE_SURFACE` already existed).
4. Injected dependencies: the lock uses the store handle; `TurnTransaction` uses its base snapshot in `commit`.
5. No invented policy: the outer grace (500 ms) is a configurable engineering setting in `assistant-runtime.ts`, next to the existing runtime limits. No new closed code; `AssistantStaleProposalError` is a class, not a code.
6. No credentials in logs: unchanged; the refusal and error records carry closed codes only.
7. Batch gate: open. The full `npm test` and `npm run test:workers` run once per batch before any merge to main (not run here, per the instruction).

**Status.** `ready-for-agent`. Not `resolved`: the batch gate is open and the Paystack release test (item 4) is a follow-up.

### Gap M12 closed (28 Oct 2026): the Paystack checkout holds the thread's run across the provider call

**Tests first.** Two tests appended to `test/assistant-thread-lock.test.ts` drive the `shortlet.card-payment.initialize-checkout` path with the provider call held open. The checkout world and steps are in `test/helpers/assistant-thread-lock-fixtures.ts` (a `DirectPaystackClient` whose fetcher the test holds, `reachCheckout`, `coldCheckoutApp`). Assistant enabled, a cold restore before every event, staging-like clock (`LIVE_LIKE_CLOCK`, 27 Oct 2026), staging guest with no seeded phone or email.
- (a) "the Paystack checkout holds the thread's run across the provider call: ...": while the call is open, a typed turn and a second checkout event are refused `THREAD_BUSY`. After success the lock is free, and the same event reaches the handler (`STALE_SURFACE`, not `THREAD_BUSY`).
- (b) "the Paystack checkout releases the thread's run when the provider call fails, ...": a typed turn is refused while the failing call is open. The failure returns a closed refusal (`ACTION_NOT_AUTHORIZED`), not a throw. The lock is released, and the following event reaches the handler.

**Mutation M12.** `release()` removed from the `finally` in `handleEventAsync` (`apps/local-guest/src/shortlet-app.ts`): both new tests fail (`true !== false` on the released-lock assertion). The file was restored from a saved copy; SHA-256 `3df2bf446d0e2665d9c40b147f9eeec7b1984a13bd2c6960f9d796b68291807b` matches the pre-mutation value, and `git diff` for that file is empty. No production code changed.

**Commands and counts (final code).**
- `env -u LLM_API_KEY npm run check`: exit 0 (root `tsc`, `apps/cloudflare` `tsc`, its test and tooling configs, worker bundle guard).
- `env -u LLM_API_KEY NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow node --import tsx --test test/assistant-thread-lock.test.ts`: 28 tests, 28 pass, 0 fail.
- `env -u LLM_API_KEY NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow node --import tsx --test test/assistant-session-thread-lock.test.ts`: 2 tests, 2 pass, 0 fail.
- Mutation run, `--test-name-pattern="Paystack checkout"` on the lock file, with M12 applied: 2 of 2 fail.

**Finding 1 (not fixed; for the owner to decide).** With a Paystack client configured, the `initialize-checkout` event for a guest with no email on file returns `ACTION_NOT_AUTHORIZED` ("The payment action was rejected.") and does not show the email prompt. The synchronous `#handleCardCheckout` asks for the email first; the async Paystack branch in `handleEventAsync` does not. The tests save the email through `guestContactApp.submitEmail` before the event, as the pilot composition test saves it over HTTP before the continuation.

**Finding 2 (not fixed; to verify).** After a provider failure the checkout command leaves a checkout session. A cold restore then shows "Payment handoff ready" with a continue route, and the original ready surface is superseded, so the same checkout event returns `STALE_SURFACE`. Whether that continue route can recover a checkout whose provider call failed is not verified here.

**Status.** Unchanged, `ready-for-agent`. The Paystack release gap (item 4) now has tests. The batch gate is still open (full `npm test` and `npm run test:workers` before any merge to main).

### Review finding (28 Oct 2026): the Paystack provider await had no bound (M13 closed)

Blocking review finding: `#handlePaystackCardCheckout` awaited the Paystack `initializePaystackCheckout` call while holding the thread's run (`beginShellRun`, released in `finally`). `DirectPaystackClient` sets no timeout, so a call that never resolves held the run for ever, and every typed turn or event returned `THREAD_BUSY`.

**Tests first.** One test appended to `test/assistant-thread-lock.test.ts`: "a Paystack checkout whose provider call never resolves is refused with the closed copy after the bound, and releases the run". The provider fetcher never resolves and ignores its abort (`ProviderGate.neverResolve`, in `test/helpers/assistant-thread-lock-fixtures.ts`). The bound is injected through a short option (`paystackCheckoutTimeoutMs`, 20 ms), so no real waiting happens. The test carries a 15 s node timeout as a regression guard. Before the fix it did not pass: node reported it cancelled, with the event loop empty, because the event never returned.

**Fix (`apps/local-guest/src/shortlet-app.ts`, CRLF kept).**
- `PAYSTACK_CHECKOUT_PROVIDER_TIMEOUT_MS = 20_000`, a named engineering setting (owner to confirm). It matches the other provider request defaults (`DEFAULT_OPENAI_COMPATIBLE_TIMEOUT_MS`, `PLANNER_REQUEST_TIMEOUT_MS`). No existing constant covers Paystack.
- `LocalGuestApp` takes `paystackCheckoutTimeoutMs` (positive integer, validated).
- `#boundProviderCall` races the provider call against the bound; its timer is cleared in `finally`, the same pattern as `#generatePlan`.
- On expiry the existing `catch` returns the existing closed refusal: `ACTION_NOT_AUTHORIZED` with the existing copy "The secure card checkout could not be started." No new outcome code (ADR 0106). The run is released in the caller's `finally`.
- `packages/platform-core` (the Paystack client) is not touched.
- Fixture change: `wireDatedApp` (`test/helpers/guest-date-fixtures.ts`) takes an optional `appOptions` argument, and `coldCheckoutApp` passes it through.

**Mutation M13.** `return await Promise.race([call, bound]);` replaced by `return await call;` (the bound removed). The new test fails (1 of 1, bounded by the 15 s guard). The file was restored from a saved copy, and `cmp` reports it identical. SHA-256 of the fixed file `5fb482d3fd07773d52a7b0a14a305e2aa28edcda7c45917e3765892750e49cb5` (before the mutation and after the restore). The file before the fix was `3df2bf446d0e2665d9c40b147f9eeec7b1984a13bd2c6960f9d796b68291807b`.

**Commands and counts (final code).**
- `env -u LLM_API_KEY npm run check`: exit 0 (root `tsc`, `apps/cloudflare` `tsc`, its test and tooling configs, the Worker bundle guard).
- `env -u LLM_API_KEY NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow node --import tsx --test test/assistant-thread-lock.test.ts test/assistant-session-thread-lock.test.ts`: 31 tests, 31 pass, 0 fail, 0 cancelled (lock file 29, session file 2).
- Single test before the fix: 0 pass, 1 cancelled. After the fix: 1 pass. Mutation run: 1 fail.

**Follow-up.** The two pre-existing checkout defects found while writing these tests are recorded in `.scratch/assistant-runtime-hardening/issues/09-paystack-checkout-email-and-provider-failure.md` (needs-triage): the missing-email `ACTION_NOT_AUTHORIZED` instead of the email prompt, and the checkout session left without a `checkoutUrl` after a provider failure (recovery unverified).

**Status.** Unchanged, `ready-for-agent`. The batch gate is still open (`npm run test:workers` and the full `npm test` once before any merge to main).
