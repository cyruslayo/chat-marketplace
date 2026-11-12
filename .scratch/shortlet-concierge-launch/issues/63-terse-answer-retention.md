# Keep a terse answer the classifier accepts in the thread

Status: claimed
Type: AFK (the live run is owner-run)
Blocked by: none
Requested: 12 Nov 2026

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md). Batch: chat hardening, issues 56–62.

## Why

The owner's live run on 12 Nov 2026 (`570da79`, `openai/gpt-6-luna`, recorded in issue 61's Comments) classified all 13 terse cases `in_scope` with the right open-question code sent, and reported a false-refusal rate of 0.000. But the same report's Slot column, which reads the thread's task state with closed values, showed that the thread did not keep the answer for six rows:

- `party_size:numeral` (`"2"`)
- `nights:numeral` (`"3"`)
- `pick_result:first`, `pick_result:second`, `pick_result:held-out-last`
- `date_confirm:affirm` (`"yes"`)

`pick_result:second` also recorded no control outcome at all. The answer was kept for `party_size:solo`, `party_size:pair`, `party_size:couple`, `party_size:held-out-partner`, `nights:week`, `nights:held-out-fortnight` and `where:area`.

Issue 61's pass rule scores the classifier verdict and the code it was shown; it never requires the answered slot to land. So a green live run can coexist with a guest whose answer the assistant asked for and then dropped. Every case also starts on an empty thread with only `openQuestion` set (picks get a synthetic shortlist through `applyDiscoveryShortlist`), with no prior search, no proposed date and no real results surface. Some of the six rows may be set-up artefacts of that empty thread rather than product defects, and the report cannot tell the difference.

## What to build

1. **Diagnose each of the six cases in a realistic cold journey**, modelled on `test/assistant-cold-journey.test.ts`: assistant runtime enabled, a cold restore (a new `LocalGuestApp` over the same store) before every event, the 2026-10-27 Africa/Lagos clock, a staging-like guest and a fresh thread. Drive a real search that ends with the assistant asking the open question (party size, nights, which result, or a shown-back date), then send the terse reply, with a scripted model that returns what a correct model returns for it (`in_scope` with the slot). If the thread still does not hold the slot after the next cold restore, the gap is in our code. Label each case:
   - **(a) eval artefact**: kept in the realistic journey and lost only because of the eval's empty-thread set-up;
   - **(b) real gap**: lost even in the realistic journey, naming the exact drop point (planner tool call, `recordGuestFacts`, settle, persistence, re-key on restore).

   Explain why `pick_result:second` had no control outcome.

2. **Fix every (b) case test-first.** No deterministic in-scope fast path (ADR 0106): no keyword or number shortcut around the model or the classifier. Date authority stays fail closed (ADR 0092): a bare "yes" may confirm only a date the server itself showed back. Guards stay fail closed, so `STALE_SURFACE` and `ARTIFACT_MISMATCH` still apply to picks.

3. **Make the eval honest.**
   - The pass rule for a verdict case requires `in_scope` (or validly `mixed`), the expected open-question code on the classifier request, **and** the answered slot held after a cold restore.
   - Every case that was an (a) artefact starts from the state a real guest would be in: a server-shown date before "yes", and a real discovery surface before a pick — never a hand-set field or a synthetic shortlist.
   - The held-out cases (`party_size:held-out-partner`, `nights:held-out-fortnight`, `pick_result:held-out-last`) stay, and `TERSE_REQUEST_BUDGET` stays at 4 requests per case.
   - The classifier instruction still names no eval text (the test from `570da79` keeps passing), and the report still carries closed codes only (ADR 0075).

## ADRs

| ADR | Constraint | Where |
|---|---|---|
| 0106 (and its 8 Nov and 9 Nov amendments) | One closed `openQuestion` code; authority comes from guest text, a structured chip or a confirmed show-back; no deterministic in-scope fast path; partial contexts keep the guest's own facts; a cold restore re-keys ids. | Steps 1–3 |
| 0092 | A date is authoritative only from guest text or a confirmed show-back; a bare "yes" confirms only what the server showed back. | Step 2, `date_confirm` |
| 0093 | Minimal persisted projection: only the existing assistant-context fields are kept. | Step 3, persistence |
| 0075 | Diagnostics, reports and logs carry closed codes and counts only. | Step 3, eval |

## Acceptance criteria

- [x] A terse party-size numeral the classifier accepts is kept in the thread after a cold restore, in a realistic journey.
- [x] A terse nights numeral the classifier accepts is kept in the thread after a cold restore, in a realistic journey.
- [x] A terse pick the classifier accepts opens the named result and is kept in the thread after a cold restore, in a realistic journey.
- [x] A terse "yes" confirms only a date the server showed back, and that check-in is kept after a cold restore.
- [x] A stale or forged pick is refused: a pick that names no result in the current shortlist selects no unit and keeps the results surface usable.
- [x] A "yes" with no shown-back date commits no check-in and leaves the next step open.
- [x] The terse eval's pass rule requires the answered slot to be held after a cold restore, not only the classifier verdict and code.
- [x] Every terse eval case runs from a realistic cold journey (a real search, a real discovery surface, a server-shown date), never from an empty thread with a hand-set field.
- [x] The classifier instruction names none of the eval texts, the held-out cases remain, and `TERSE_REQUEST_BUDGET` stays at 4 per case.
- [ ] Owner: the live run is recorded in Comments with its slot column. Target: every case `PASS` on `openai/gpt-6-luna`.

## Verification

Per-issue scope (all with `env -u LLM_API_KEY`, `NODE_ENV=test`):

- `npm run check`
- `npx --no-install tsx --test test/assistant-terse-slot-retention.test.ts test/assistant-terse-followups.test.ts test/assistant-open-question.test.ts test/assistant-no-dead-ends.test.ts test/pilot-agent-smoke-report.test.ts test/pilot-agent-smoke-grading.test.ts test/pilot-agent-smoke-metrics.test.ts test/pilot-agent-smoke-budget.test.ts test/pilot-agent-smoke-reference.test.ts test/assistant-cold-journey.test.ts test/assistant-clarification-facts.test.ts test/assistant-clarification-chips.test.ts test/assistant-recorded-journeys.test.ts test/assistant-turn-stop-reasons.test.ts test/assistant-date-phrases.test.ts test/assistant-discovery-artifact-drift.test.ts`
- `npm run pilot:local:bootstrap`, then `npx --no-install tsx scripts/pilot-agent-smoke.ts --scripted`
- Record the exact commands and counts in Comments.

## Comments

- 12 Nov 2026, diagnosis on `fix/terse-slot-retention` (base `c477eb9`). Reproduced each case twice offline: once as a realistic cold journey (staging-like guest, 2026-10-27 clock, a new `LocalGuestApp` over the same store before every event) with a scripted model returning the correct `in_scope` verdict and planner action, and once in the eval's empty-thread shape. Closed task-state values only; no model or guest text is reported.
  - **All six rows are (a) eval artefacts.** In the realistic journey every one holds the slot after a cold restore: `party_size:numeral` → `partySize 2`; `nights:numeral` → `nights 3`; the three `pick_result` rows → `selectedStayRef stay-1` / `stay-2` / the last shown result; `date_confirm:affirm` → `checkIn 2026-10-28`. In the eval's empty thread the same scripted replies drop the fact in a different place per row: `party_size` and `nights` end in `tool_denial` with no stay to search (the planner has no area or dates, and a bare numeral reads as no guest count or stay length in `recordGuestAuthoredFacts`), `date_confirm` ends in `tool_denial` because there is no `pendingDate` to settle (the fail-closed behaviour ADR 0092 requires), and the three `pick_result` rows end in `CONCIERGE_UNAVAILABLE` because the synthetic shortlist's `unit-1…unit-3` do not exist in the unit repository, so `get_unit_details` throws.
  - **`pick_result:second` had no control outcome** because the eval reads `turnOutput.controlOutcome ?? null`, and the runtime's generic failure return (`CONCIERGE_UNAVAILABLE`, `stopReason: "error"`) omits the `controlOutcome` it computed and recorded (`model_handling_failure`). The turn in the eval's shape returns exactly `{"ok":false,"code":"CONCIERGE_UNAVAILABLE","stopReason":"error"}`, so the column reads `none`; a typed failure is indistinguishable from a measurement gap. The runtime now returns its computed closed outcome, and the eval reads it.
  - No (b) case among the six reported rows: with a correct model the slot is committed by the planner's own search or details call, by `settlePendingStayDate` for a shown-back date, and it survives the cold restore through the existing `assistantContext` projection (party size, nights, check-in, `selectedUnitId`).
  - **One real gap (b) found while making the eval honest, in the `where` row** (it was held in the owner's run only because the eval set the code on the same runtime that then read it): `LocalGuestApp#partialAssistantContext` wrote the facts of a context with no area but not `openQuestion`, so a `where` question asked before any area was known was lost on the next cold restore and the classifier request carried no code. The projection parser already accepted the field on that shape (`guest-projection.ts` `isPartialAssistantContext`), so the writer now keeps it. Test: `test/assistant-terse-slot-retention.test.ts`, "a terse where answer the classifier accepts is kept in the thread after a cold restore" (red before the fix).
  - Fix batch: (1) `#partialAssistantContext` keeps `openQuestion` (the one (b) drop point: persistence); (2) the runtime's generic failure return carries its closed `controlOutcome`; (3) `scoreTerseCase` requires the answered slot for a verdict case, not only scope and code, and `holdsAnsweredSlot` treats a demo date as no answer (ADR 0092); (4) `evaluateTerseFollowUps` drives a real cold journey per case through `LocalGuestApp` (a scripted set-up model answers only the set-up messages; the measured reply goes to the live model), and reads the slot from the thread after a cold restore, so the six (a) cases now start from a real search and, where the question needs it, a real discovery surface or a server-shown date.
  - New tests: `test/assistant-terse-slot-retention.test.ts` (the retention rows, the `where` row, the fail-closed pick and the "yes" with no show-back, and the closed outcome on a failed pick), and two eval-honesty tests plus restored fixtures in `test/pilot-agent-smoke-report.test.ts`.
  - The scripted reference now answers the terse texts with the same fixed actions, so `--scripted` exercises the suite offline (tool execution, not understanding). ADRs read and applied: 0106 (including the 8 Nov and 9 Nov amendments), 0092, 0093, 0075, 0077.
  - Commands (all with `env -u LLM_API_KEY`, `NODE_ENV=test`): `npm run check` clean (tsc ×4 plus the worker bundle guard). The 16-file list in Verification: 164 of 164 pass. `test/assistant-terse-slot-retention.test.ts` alone: 8 of 8. `test/pilot-agent-smoke-report.test.ts` alone: 22 of 22. `npm run pilot:local:bootstrap`: exit 0. `npx --no-install tsx scripts/pilot-agent-smoke.ts --scripted`: PASS, terse status run, budget 52 used 0 (set-up turns spend none), false-refusal rate 0.000 (0 of 13), failed cases 0, timeouts 0, valid for acceptance yes, all 13 rows PASS with Slot `held`.
