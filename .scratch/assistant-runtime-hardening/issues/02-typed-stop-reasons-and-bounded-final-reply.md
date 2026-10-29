# Give every assistant turn a typed stop reason and bound the final reply call

Status: ready-for-agent
Type: task
Blocked by: none
Requested: 25 Oct 2026
PRD: `../PRD.md`

## Why

`AssistantRuntime.handleTurn` (`apps/local-guest/src/assistant/assistant-runtime.ts`, around lines 393–600) already caps the tool loop at `MAX_ASSISTANT_TOOL_ROUNDS` (4, in `assistant-platform.ts`). What it does not do:

- **Say why a turn stopped.** A natural reply, hitting the round cap, and a provider failure all look the same in `AssistantTurnOutput` and in the diagnostics. Frameworks expose this as a stop or finish reason; it is what tells you a prompt or tool set is making the model loop.
- **Bound the extra call after the cap.** When the cap is reached, one more `generate` runs with `tools: []` and no `timeoutMs`, so it uses the adapter default rather than the 20-second limit the loop uses. A turn can therefore run longer than intended, and the call is not distinguished from a normal round.
- **Bound the whole turn.** Each call has a timeout, but nothing bounds the turn. ADR 0079 sets a provisional 120-second standard-run limit.
- **Name its limits.** `20_000` is a literal inside the loop (AGENTS.md anti-pattern 3).

## What to build

- A `stopReason` on the turn result and on a final diagnostic event: `"reply"` (model answered without tools), `"round_limit"` (cap reached, summary call made), `"turn_deadline"` (whole-turn limit reached), `"error"` (failure path; the existing `failureClass` stays). Use only these four unless a test shows a case they do not cover.
- `AssistantRuntimeOptions` gains `modelCallTimeoutMs` and `turnDeadlineMs`. Defaults: 20 000 ms (today's value) and 120 000 ms (ADR 0079 standard-run limit, provisional). Cite ADR 0079 at the default.
- The post-cap summary call uses `modelCallTimeoutMs`, and no call starts after `turnDeadlineMs` has passed. A deadline reached before any successful application operation takes the existing rollback path (thread unchanged, `CONCIERGE_UNAVAILABLE`); after one, it takes the existing projected-operation fallback.
- No change to the round cap value, the prompts, or `ModelCallBudget` (it already counts the summary call through `BudgetedModelClient`).
- `scripts/pilot-agent-smoke.ts` works out a stop reason from the diagnostics itself (`providerStopReason`). Switch it to the new field if the mapping is one to one; otherwise leave it and note why in Comments.

## ADRs

| ADR | Constraint | Affects |
|---|---|---|
| 0079 | Provisional 120-second standard-run limit; timeouts never reverse committed commands | `turnDeadlineMs` default; deadline after a committed operation keeps it |
| 0080 | Deterministic fallback for critical workflows | Failure paths still hand over as today |
| 0075 | Diagnostics carry no prompt, reply or personal data | The stop-reason diagnostic is an enum and counts only |

## Acceptance criteria

1. A turn the model answers without tool calls reports stop reason `reply`.
2. A turn that reaches the round cap reports stop reason `round_limit` and makes exactly one summary call with no tools.
3. The summary call after the round cap is made with the configured model-call timeout.
4. A turn that passes the turn deadline before any application operation reports `turn_deadline`, starts no further model call and leaves the thread unchanged.
5. A turn that passes the turn deadline after an application operation keeps that operation's state and surfaces.
6. A provider failure reports stop reason `error` with its existing failure class.
7. The model-call timeout and turn deadline default to 20 000 ms and 120 000 ms and can be overridden through runtime options.

Use an injected clock or a scripted model that advances time; no real waits.

## Tests

`test/assistant-turn-stop-reasons.test.ts` (new). Affected: `npm run test:assistant`, `test/assistant-task-rail.test.ts`.

## Comments

### Implementation (28 Oct 2026, branch `integration/concierge-controls`)

**ADR discovery and table.** Read ADR 0106 in full (with the 26 and 27 Oct amendments), ADR 0079 and 0080 (the issue's named ADRs), ADR 0075, and the headers of 0092 and 0093 (concierge path, not touched here). Constraints and where they bite:

| ADR | Constraint | Code path |
|---|---|---|
| 0079 | Provisional 120 s standard-run limit; timeouts never reverse committed commands | `DEFAULT_ASSISTANT_TURN_DEADLINE_MS`; deadline after an operation takes the existing projected-operation fallback, which commits the operation's state and surfaces |
| 0080 | Deterministic fallback for critical workflows | Failure paths unchanged: rollback (`CONCIERGE_UNAVAILABLE`) or fallback, as today |
| 0075 | Diagnostics carry no prompt, reply or personal data | `turn_stop` event holds only the enum, round, and success flag; asserted by exact-shape tests |
| 0106 | Round cap, prompts, `ModelCallBudget` unchanged; closed outcome list unchanged | Round cap value untouched; summary call still counted by `BudgetedModelClient`; no new control outcome |

**Changes.**
- `apps/local-guest/src/assistant/assistant-runtime.ts`: `AssistantStopReason` (`reply`, `round_limit`, `turn_deadline`, `tool_denial`, `error`; see the review fixes below); `stopReason` on `AssistantTurnOutput` and on a new `turn_stop` diagnostic stage; options `modelCallTimeoutMs` (default `DEFAULT_ASSISTANT_MODEL_CALL_TIMEOUT_MS` = `PLANNER_REQUEST_TIMEOUT_MS`, 20 000) and `turnDeadlineMs` (default `DEFAULT_ASSISTANT_TURN_DEADLINE_MS` = `SERVER_TURN_MAX_MS`, 168 000, see the owner decision below), both validated as integers in 1 000 to 300 000 ms. Planner requests and the post-cap summary call take `modelCallTimeoutMs`; the summary call was previously untimed. `assertWithinTurnDeadline()` runs before every planner request and before the summary call, so no call starts after the deadline. The deadline runs on the environment clock from the start of the turn, scope stage included.
- `test/helpers/assistant-turn-model.ts` (new): `SteppedClock`, `RecordingTurnModel`, `threadSnapshot` (shared, not copied).
- `test/assistant-turn-stop-reasons.test.ts` (new): one `test()` per acceptance criterion, named as the criterion text.
- `test/shortlet-assistant-evals.test.ts`: one existing test, `Server-only diagnostics safely expose provider status and code while the guest response stays generic`, asserted `events.at(-1)` is the provider failure. Because `turn_stop` is now the final event (as the issue asks), it now asserts the final event is `turn_stop` with `stopReason: "error"`, and checks the provider failure as the last non-`turn_stop` event. Its other assertions are unchanged.

**Decisions taken (please confirm).**
1. Superseded by the review fixes: `tool_denial` is now a fifth stop reason (see below).
2. A turn that hits the turn deadline reports controlOutcome `guard_failure`, mirroring the guard's `deadline_exceeded`. Alternative: `model_handling_failure`.
3. A deadline after an application operation that produced no surfaces follows the existing rollback path (candidate thread state discarded, as for provider errors today). The fallback branch needs a surface, as it already did.
4. Early returns before the planner loop (scope redirect or unavailable, deterministic confirmation or cancellation, cross-domain route, mixed-scope rejection) carry no `stopReason`: no planner loop runs there.
5. `stopReason` is on the runtime turn result, not forwarded through `shortlet-app.ts` (`GuestTurnResult` maps only `controlOutcome`). Not required by the issue; no browser contract change.
6. `scripts/pilot-agent-smoke.ts` `providerStopReason` left unchanged: its values (`PROVIDER_RATE_LIMITED`, `PROVIDER_REQUEST_BUDGET_EXCEEDED`) are not a one-to-one map of the four turn reasons.
7. Test clock: the staging-like clock (27 Oct 2026) is used. The fixture's default demo check-in (2026-09-10) is past at that clock, so a search there is rejected as `tool_denial`. The tests set the fixture `demoCheckIn` to 2026-12-20 inside the booking horizon.
8. Cold restore: not tested. The change is in the per-turn loop and touches no restore or shell state, which is the trigger the orchestration brief set. CLAUDE.md asks for a cold restore before every event on concierge assistant changes; if the owner wants that for this change, it is a follow-up journey test.

**Commands and counts.**
- `env -u LLM_API_KEY npx tsx --test test/assistant-turn-stop-reasons.test.ts`: before implementation, red (missing exports). After: 7 tests, 7 pass, 0 fail.
- `env -u LLM_API_KEY npm run check`: exit 0 (root tsc, apps/cloudflare tsc, tsconfig.test, tsconfig.tooling, worker bundle guard).
- `env -u LLM_API_KEY npm run test:assistant`: 67 tests, 66 pass, 1 fail. The one failure is the known pre-existing `Unit detail surface projects inspection facts from the authoritative Unit` (fixture expects 1 Feb 2027; b68eecd). Not edited, not fixed.
- Affected: `env -u LLM_API_KEY npx tsx --test test/assistant-task-rail.test.ts test/assistant-turn-stop-reasons.test.ts test/assistant-control-metrics.test.ts test/assistant-control-outcome-count.test.ts test/assistant-tool-argument-validation.test.ts test/assistant-reply-plan-references.test.ts test/assistant-reply-coverage.test.ts test/assistant-tool-authorization.test.ts test/assistant-cold-journey.test.ts`: 54 tests, 54 pass, 0 fail.
- Not run here: full `npm test` and `npm run test:workers` (batch pre-merge gate, per Test scope).

**Definition of Done (docs/agents/issue-tracker.md).**
1. Named test per criterion: met (seven tests, names mirror the criteria).
2. Failure paths: criterion 4 asserts `ok: false`, `CONCIERGE_UNAVAILABLE`, zero planner requests and an unchanged thread; criterion 5 asserts no second planner request and committed surfaces; criterion 6 asserts `error` and `PROVIDER_TRANSPORT_FAILURE`; criterion 7 asserts that invalid limits throw; criterion 2 asserts the tool-free call is the only one.
3. ADRs listed and read: met (table above).
4. No unused injected dependency: met. Both new options are read in the constructor's validation and in the loop.
5. No invented policy: met for the values (20 000 from `turn-budget.ts`; the turn deadline is `SERVER_TURN_MAX_MS` from `turn-budget.ts`, owner decision below). Decision 2 is a mapping choice, flagged above.
6. No credentials in logs: met (`turn_stop` carries enum fields only).
7. `npm run check` passes: met. `npm test` passes with zero failures: NOT yet. It is the batch gate. The known `shortlet-assistant-evals` failure above is expected to remain.

Status left `ready-for-agent`: DoD item 7 is open until the batch gate runs.

### Review fixes and owner decision (28 Oct 2026)

**Owner decision: the turn deadline default.** `DEFAULT_ASSISTANT_TURN_DEADLINE_MS` is `SERVER_TURN_MAX_MS` (168 000 ms, `apps/local-guest/src/turn-budget.ts`), reused rather than a new literal. It replaces the 120 000 ms this issue's "What to build" names, and that value appears in the earlier notes above. Criterion 7 is kept as written, but its 120 000 ms is superseded by this decision: its test is now named for `SERVER_TURN_MAX_MS (168 000 ms)`. `turn-budget.ts` and ADR 0106 are unchanged. The default stays inside the new 1 000 to 300 000 ms bound. The 120 000 ms ADR 0079 provisional value is retained only in the ADR itself.

**Turn deadline versus request deadline.** `DEFAULT_ASSISTANT_TURN_DEADLINE_MS` bounds one whole planner turn (scope, every planner request, the summary call). `DEFAULT_MODEL_REQUEST_DEADLINE_MS` in `model-quota-guard.ts` (120 000 ms) bounds one provider request. The two are different limits and are not interchangeable.

**Review fixes.**
1. Cold-restore tests: `test/assistant-turn-stop-cold-restore.test.ts` (new, 2 tests). It runs the assistant runtime on the staging-like clock with a staging-like guest, through the OpenRouter-compatible scripted planner.
   - (a) A planner search that passes the deadline keeps its card through the projected-operation fallback. After a cold restore the card keeps its surface id and artifact id (re-keyed, not re-minted), and View opens the unit. After a newer search, the superseded surface returns `STALE_SURFACE` and the older artifact on the newer card returns `ARTIFACT_MISMATCH`, both after a cold restore.
   - (b) A round-limit turn is kept after a cold restore, and its card opens. Each round's search returns its own card; the turn returns all four and the last one is active.
2. `tool_denial` is a fifth stop reason. The date-provenance, date-validation and stay-details branch reports `tool_denial`, with `ok: true` and a dated clarification, and `succeeded: true` on `turn_stop`. Test: "A planner date the guest did not give reports stop reason `tool_denial`...". It asserts the exact turn_stop list and that the task state is unchanged.
3. Added tests:
   - Deadline after an operation with no surface takes the rollback path (`get_booking_status` runs before the deadline; the thread is unchanged; `CONCIERGE_UNAVAILABLE`). Decision recorded here: the projected-operation fallback needs a surface, so a read-only operation with none rolls back, as a provider failure does.
   - Deadline before the summary call: the last planner round runs past the deadline, no summary request starts, and the stop is `turn_deadline` at round 4.
   - `threadSnapshot` now includes `conversationHistory`, `discoveryArtifact` and `canonicalUserFactHistory`.
   - Every stop-reason test asserts the exact `turn_stop` list (stage, round, succeeded, stopReason).
4. Bounds: `modelCallTimeoutMs` and `turnDeadlineMs` must be integers in [1 000, 300 000]; the constructor throws otherwise. The tests cover 999, 300 001, 0, 1.5 and negatives.
5. Exactly one `turn_stop` per turn: `emitStop()` is the only emitter, guarded by a flag. The success path builds its output before emitting and returns after. A test asserts the exact list in every stop-reason test.
6. `turn_stop` round: the deadline check now runs before the round counter moves. A deadline before the first planner call reports round 0. A deadline before the summary call reports the last planner round (4). Documented on `AssistantStopReason`: `succeeded` is true for `reply`, `round_limit` and `tool_denial`, and false for `turn_deadline` and `error`; a `rejected_plan_fallback` takes its stop reason from how the loop ended; `turn_stop` covers planner turns only (pre-loop exits emit none).

**Counts and commands (final code).**
- `env -u LLM_API_KEY npm run check`: exit 0.
- `env -u LLM_API_KEY npx tsx --test test/assistant-turn-stop-reasons.test.ts`: 10 tests, 10 pass, 0 fail.
- `env -u LLM_API_KEY npx tsx --test test/assistant-turn-stop-cold-restore.test.ts`: 2 tests, 2 pass, 0 fail.
- `env -u LLM_API_KEY npm run test:assistant`: 67 tests, 66 pass, 1 fail. The one failure is the known pre-existing `Unit detail surface projects inspection facts from the authoritative Unit` (not edited).
- Affected: `env -u LLM_API_KEY npx tsx --test test/assistant-turn-stop-reasons.test.ts test/assistant-turn-stop-cold-restore.test.ts test/assistant-cold-journey.test.ts test/assistant-control-metrics.test.ts test/assistant-control-outcome-count.test.ts test/assistant-tool-argument-validation.test.ts test/assistant-reply-plan-references.test.ts test/assistant-reply-coverage.test.ts test/assistant-tool-authorization.test.ts test/assistant-task-rail.test.ts test/assistant-artifact-authority.test.ts`: 68 tests, 68 pass, 0 fail.
- Not run: full `npm test` and `npm run test:workers` (batch gate). Still open for the batch gate, so the status stays `ready-for-agent`.

**Observations (no change made).** The shell does not forward `stopReason` to the browser (decision 5 above). A turn with several search rounds returns every round's discovery card; only the last is active, as the cold-restore test shows.

### Follow-up A: budget clamp, tool_denial fallback, staging cold start (28 Oct 2026)

1. **Timeout clamp.** Each planner call and the post-cap summary call takes `min(modelCallTimeoutMs, time left in the turn budget)`. This makes `turnDeadlineMs` a real cap, so the turn-budget.ts comment ("the longest a server turn can run") holds for the runtime. When less than the minimum viable timeout is left (`MIN_ASSISTANT_RUNTIME_LIMIT_MS`, the lower runtime bound, 1 000 ms, a constant already in the file rather than a new value), no call starts and the stop is `turn_deadline`. The scope call keeps its own 5 s / 8 s budget, as before. Options stay validated (1 000 to 300 000 ms). Test: "A planner call that starts near the turn deadline receives a timeout clamped to the time left, and no call ends after the budget." It asserts the timeouts the model client sees (10 000, 8 000, 6 000, 4 000, 2 000 ms) and that every call's start plus timeout is within the budget. Test: "A planner call with less than the minimum viable timeout left is not started and reports `turn_deadline`."
2. **tool_denial after a successful operation.** When a rejected date follows a successful operation that left a surface, the catch's fallback branch runs first. The turn returns the operation's surfaces with `controlOutcome: rejected_plan_fallback`, `stopReason: tool_denial`, and `turn_stop` `succeeded: true`. The doc comment on `AssistantStopReason` now says so; the code already did this. Test: "A rejected date after a successful operation returns the operation's surfaces with stop reason `tool_denial` and controlOutcome `rejected_plan_fallback`." The second proposal uses 27 Dec 2026, since the fixture's demo check-in (20 Dec 2026) is an authorised date once a search has run.
3. **Staging cold start.** `openTurnRuntime` in `test/assistant-turn-stop-reasons.test.ts` now opens a staging-like guest (no seeded phone or email) on the 27 Oct 2026 clock. It builds the runtime and a `LocalGuestApp` over the same environment (the store), so every turn runs on a restored application. No stop-reason test needs the seeded default guest: the turn-stop contract does not depend on contact details. The cold-restore file keeps its `datedFixture`/`restartedDatedApp` helpers, unchanged.

**Commands and counts (Commit A, final code, env -u LLM_API_KEY).**
- `npm run check`: exit 0.
- `test/assistant-turn-stop-reasons.test.ts`: 13 pass, 0 fail.
- `test/assistant-turn-stop-cold-restore.test.ts`: 2 pass, 0 fail.
- `npm run test:assistant`: 67 tests, 66 pass, 1 fail. The one failure is the known `Unit detail surface projects inspection facts...` (fixed in Commit B).
- `test/assistant-cold-journey.test.ts`: 3 pass, 0 fail.
- `test/assistant-control-metrics.test.ts`: 6 pass, 0 fail.
- `test/assistant-recorded-journeys.test.ts`: 3 pass, 0 fail.
- `test/assistant-recording-clients.test.ts`: 4 pass, 0 fail.
- Affected (the above plus control-outcome-count, tool-argument-validation, reply-plan-references, reply-coverage, tool-authorization, task-rail, artifact-authority): 78 pass, 0 fail.
