# Tell the classifier and planner today's date

Status: resolved
Type: AFK
Blocked by: none
Requested: 1 Nov 2026

## Parent

[PRD](../PRD.md)

## Why

Neither model is told the date. The classifier instruction (`scope-classifier.ts:79`) and the planner instruction (`ASSISTANT_PLATFORM_PREAMBLE` + `SHORTLET_PROMPT_SECTION`) have no date, weekday, time zone or horizon, so the model cannot place "next Friday" or tell a check-in from a checkout reliably.

## What to build

- Each classifier and planner request carries one line of turn context, for example `Today is Sunday 1 November 2026 (Africa/Lagos). The last bookable check-in is 30 January 2027.` Built from the injected clock and `BOOKING_HORIZON_DAYS`; the pack supplies it (ADR 0099), the runtime stays domain-neutral.
- Put it in the per-turn context, not the cached system prefix, so prompt caching still works.
- It grants no date authority (ADR 0106).

## Acceptance criteria

- [ ] AC1: A classifier request built at 2026-10-27 contains that date, its weekday and Africa/Lagos.
- [ ] AC2: A planner request contains the same line and the last bookable check-in date.
- [ ] AC3 failure path: a planner date the guest did not write is still rejected as `tool_denial` even though the model now knows the date.
- [ ] AC4: The system instruction text is identical across two turns on different days (cache stability).

## ADR compliance

| ADR | Constraint | Affected |
|---|---|---|
| 0106 | Model-only dates never authorize | AC3 |
| 0099 | Runtime has no shortlet knowledge | Line built by the pack |
| 0075 | No guest text in logs | Line holds no guest data |

## Comments

ADR table (written before the tests):

| ADR | Constraint | Acceptance criterion or code path |
|---|---|---|
| 0106 (27 Oct amendment, date authority) | A model-only date never authorizes; a planner date needs a guest literal or confirmed chip. The turn context line grants nothing. | AC3. The line is per-turn request context only; guest-authored text (`userTextHistory`, built from `candidateHistory`) never includes it, so `priorUserText` and `containsGuestDate` are unchanged. |
| 0106 (cache, system instruction) | The system instruction stays the same across days (issue AC4). | `composeSystemInstruction` and `ModelScopeClassifier` system instruction get no date. The line goes to the planner's request history and to the classifier's per-turn JSON `context`. |
| 0106 (scope classifier) | The classifier is advisory; its request carries no tools, no history and no guest data beyond the message and a minimal task summary. | `ScopeContext.turnContext` is one added field in the per-turn JSON. It holds no guest data. |
| 0099 | The runtime has no shortlet wording or date logic. | `AssistantDomainPack.turnContext?(now)` is optional. The shortlet pack implements it; the runtime only calls the hook and places the string. |
| 0055, 0092 | The booking horizon is `BOOKING_HORIZON_DAYS` (90) from the Africa/Lagos calendar day. | The last bookable check-in is today plus `BOOKING_HORIZON_DAYS` in the pack (same rule as `date-literals.ts` `offset > BOOKING_HORIZON_DAYS`). |
| 0075 | No guest text or ids in logs or model input beyond what the request needs. | The line holds only the clock date, the horizon date and fixed words. |
| 0079 / 0093 | Persisted thread history is minimal projection; the context line is not persisted. | The line is prepended after `#boundedHistory` for the request only and never reaches `candidateHistory` or `#commitHistory`. |

### Implementation (uncommitted, awaiting owner decision)

Superseded by the Resolution section below: the first design (history prepend) was replaced after the owner decision.

What changed (working tree only):
- `apps/local-guest/src/assistant/assistant-platform.ts`: optional `AssistantDomainPack.turnContext?(now: Date): string | undefined` (ADR 0099).
- `apps/local-guest/src/assistant/shortlet-assistant-pack.ts`: `bookingTurnContext(now)` builds `Today is <Tuesday 27 October 2026> (Africa/Lagos). The last bookable check-in is <25 January 2027>.` from `dateKeyInLagos` and `BOOKING_HORIZON_DAYS` (90). Wired as `turnContext` on the shortlet pack only. Commerce is untouched.
- `apps/local-guest/src/assistant/scope-classifier.ts`: optional `ScopeContext.turnContext`. It is per-turn JSON only; the classifier system instruction is unchanged.
- `apps/local-guest/src/assistant/assistant-runtime.ts`: classifier context gets `turnContext`. `#withTurnContext` prepends one user-role step to the planner request history after `#boundedHistory`, in both `#generatePlan` calls (main round and round-limit summary). It is never added to `candidateHistory`, so guest-authored text and date authority are unchanged, and nothing is persisted.
- `test/assistant-turn-date-context.test.ts` (new): AC1 to AC4, one test each, cold restore before every event, clock 2026-10-27, staging-like guest.

ADR table: written above, before the tests.

### Commands and counts

- `env -u LLM_API_KEY npm run check`: exit 0 (run 3 times, last after the final edit).
- `test/assistant-turn-date-context.test.ts`: 4 pass, 0 fail (AC1 to AC4). Before implementation: 0 pass, 4 fail, each for the intended reason (line absent, AC3 at "the model was shown the line").
- `test/assistant-date-literal-authority.test.ts`: 8/8. `test/assistant-date-literals.test.ts`: 15/15. `test/assistant-scope-controls.test.ts`: 38/38. `test/assistant-scope-persistence.test.ts`: 2/2. `test/shortlet-assistant-evals.test.ts`: 52/52. `test/assistant-runtime-boundary.test.ts`: 5/5. `test/assistant-unregistered-domain.test.ts`: 8/8. `test/assistant-pack-registry.test.ts`: 3/3. `test/assistant-turn-record.test.ts`: 12/12. `test/assistant-cold-journey.test.ts`: 3/3. `test/scope-classifier-malformed-shapes.test.ts`: 25/25. `test/model-quota-guard.test.ts`: 8/8.
- `test/assistant-recorded-journeys.test.ts`: 3 pass, 2 fail (see Break 1).
- `test/assistant-recording-clients.test.ts`: 8 pass, 1 fail (see Break 3, known Linux case).
- `test/assistant-interactions-protocol.test.ts`: 13 pass, 2 fail (see Break 2).
- Wider sweep of the other non-browser `test/assistant*.test.ts` files: all pass (about 40 files), except the Interactions file above.

### Breaks that need the owner

1. Recorded journeys (`test/assistant-recorded-journeys.test.ts`, 2 tests, plus the replay in `test/helpers/assistant-recordings.ts`). Cause: `ReplayModelClient` compares each recorded request. The first recorded exchange is the classifier request. Its user JSON now carries `context.turnContext`, so the comparison fails at step 1 with equal history lengths (the "roles, text ... differ" branch). The planner exchanges would diverge too, because their history gains the leading user step. Fixing this means re-recording the five journeys (`scripts/record-assistant-journey.ts`, `ASSISTANT_RECORD_LIVE=1`, a live provider and the `--out` rule). That is not straightforward here, and I did not hand-edit recorded live evidence. Decision needed: approve a live re-record (and who runs it), or change the design so the line stays out of the classifier JSON.
2. Gemini Interactions (`test/assistant-interactions-protocol.test.ts`, tests 13 and 14, "AssistantRuntime keeps Gemini tool continuity ..." and "... paired when one call in a batch is rejected"). Cause: those tests assert exact step indices in the planner continuation (`continuation[0]` is the summary, `[1]` the guest input, `[2]` the thought). The leading user step shifts them (`continuation[0]` is now `user_input`). Any placement inside the step list shifts them too. The fix is either to change those index assertions (a test-expectation change, which I did not make without approval) or to carry the line outside the step list, for example as a separate request field in the adapters.
3. `test/assistant-recording-clients.test.ts`, "Live recording refuses an --out inside test/fixtures ... a junction into it": `ENOTDIR` on `rmdir` of a symlink. This is the known Linux junction failure from the brief. Not fixed, not mine.

### Definition of Done (issue-tracker.md), status

1. Every AC has a dedicated named test: met (AC1 to AC4, names mirror the criteria).
2. Failure paths: met for AC3 (tool_denial, dated clarification, no search). AC4 compares the classifier and planner system instructions across days.
3. ADRs listed and read: met (ADR table above; 0106, 0099, 0055, 0092, 0075, 0079, 0093).
4. No unused injected dependency: met (`#withTurnContext` and the classifier context field are both called).
5. No invented constant: met (horizon is `BOOKING_HORIZON_DAYS`; the line format follows the issue's example).
6. No credential or identity material in logs: met (the line holds only dates and fixed words).
7. `npm run check` zero errors: met. `npm test` zero failures: NOT met. The batch gate has not run, and Breaks 1 and 2 are open. Item 7 cannot pass until the owner decides.

### Not done

- Status is not set to `resolved`. map.md is not updated. There is no commit and no `## Answer`.
- The stray empty scratch file I created was removed.

### Resolution (owner decision applied)

Owner decision: carry the line outside the history. Breaks 1 and 2 are closed by that change. No recording or Gemini expectation was edited.

Design now in code:
- `AssistantModelRequest.turnContext?: string` (`assistant-model.ts`). Set only by the runtime (`#turnContext(pack)`) for both planner calls (round and round-limit summary) and by the classifier path (`ScopeContext.turnContext` to `ModelScopeClassifier.assess`, which forwards it on the request).
- The history prepend (`#withTurnContext`) and the classifier JSON `turnContext` are removed. The history and the classifier envelope are as before, so recorded requests compare equal.
- OpenAI-compatible: `mapHistoryToMessages` adds one `user` message directly after the `system` message. The system message is unchanged.
- Gemini: the line is appended as a trailing `user_input` step after the history steps. Leading it would move the pinned indices in tests 13 and 14 (`continuation[0..4]`, `input[0..4]`). Tests 13 and 14 are unchanged.
- Recorder: `neutralRequest` projects only tools, structured-output name and history, so `turnContext` is never written to a recording. `ReplayModelClient` ignores it (`comparable()` is history and tools only). Scripted model: reads only history, so it tolerates the field. Quota guard, budget and fallback wrappers forward the request object, so the field reaches the provider.
- Tests: AC1 reads the classifier body's extra message and checks that the JSON envelope has no `turnContext`. AC2 checks the line is the message right after the system message. AC4 compares the system message byte-for-byte across two days and checks each day's line.

### Final commands and counts (run after the change, before commit)

- `env -u LLM_API_KEY npm run check`: exit 0 (after the last source edit and again before commit).
- `test/assistant-turn-date-context.test.ts`: 4/4.
- `test/assistant-recorded-journeys.test.ts`: 5/5.
- `test/assistant-interactions-protocol.test.ts`: 15/15 (tests 13 and 14 pass unchanged).
- `test/assistant-recording-clients.test.ts`: 8 pass, 1 fail. The fail is the known Linux junction case (`ENOTDIR` on `rmdir` of a symlink, "Live recording refuses an --out ... a junction into it"). Not fixed.
- Other affected files, all passing: date-literal-authority 8/8, date-literals 15/15, scope-controls 38/38, scope-persistence 2/2, shortlet-assistant-evals 52/52, runtime-boundary 5/5, unregistered-domain 8/8, pack-registry 3/3, turn-record 12/12, cold-journey 3/3, scope-classifier-malformed-shapes 25/25, model-quota-guard 8/8.
- Wider non-browser assistant sweep (about 40 files): all passing. Provider-client and adjacent files: openai-compatible-client 12/12, concierge-configuration 6/6, demo-openrouter 7/7, guest-chip-continuity 6/6.
- Not run: the full `npm test` and `npm run test:workers`. Those are the once-per-batch pre-merge gate (see Test scope).

### Definition of Done, final

1. Each AC has a dedicated named test: met.
2. Failure paths: met (AC3 tool_denial with dated clarification and no search).
3. ADRs read and cited: met (table above, plus 0099 for the hook and 0106 for the request-only line).
4. No unused injected dependency: met (`turnContext` is read by both providers and the classifier).
5. No invented constant: met.
6. No credential or identity material in logs or recordings: met (the line is dates and fixed words, and the recorder drops the field).
7. `npm run check` zero errors: met. `npm test` zero failures: not run here, per the per-issue rule. The known Linux junction case in `assistant-recording-clients` would fail it. Item 7 is therefore satisfied only at the affected-tests scope; the batch gate must confirm it.

## Answer

The current date and the last bookable check-in are now given to the classifier and the planner on every turn. The shortlet pack builds the line from the injected clock and `BOOKING_HORIZON_DAYS`. The line travels as a `turnContext` field on the request, and each provider renders it after the cached system prefix, so the system instruction stays byte-identical across days. It grants no date authority: a planner date the guest did not write is still a `tool_denial`.

Changed: `assistant-model.ts` (field), `assistant-platform.ts` (pack hook), `shortlet-assistant-pack.ts` (line builder and hook), `scope-classifier.ts` (context field, forwarded on the request), `assistant-runtime.ts` (both planner calls and the classifier context), `openai-compatible-client.ts` (message after system), `gemini-interactions-client.ts` (trailing `user_input` step), `test/assistant-turn-date-context.test.ts` (new, AC1 to AC4).
