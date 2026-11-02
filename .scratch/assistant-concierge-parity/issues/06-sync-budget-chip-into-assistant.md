# Bug: the budget chip never reaches the assistant

Status: resolved
Type: AFK
Blocked by: none
Requested: 1 Nov 2026

## Parent

[PRD](../PRD.md)

## Why

`#recordAssistantStayChip` (`shortlet-app.ts:4083`) records the where, when and guests chips in the assistant task state, but returns early for `budget` (`facts === null`). Criteria undo (`#handleCriteriaUndo`, :4154) does the same. So after a guest sets a budget on the strip, the next planner turn searches without it, and a cold rebuild from the assistant context (`#assistantContextSearch`, :3180) drops it. The rebuild also writes every budget back as `per: "stay"` (:3219), so a per-night chip budget changes meaning.

## What to build

- The budget chip and its undo record `maxBudgetKobo` (and its per-night or per-stay meaning) in the assistant stay intent through `recordGuestStay` or a sibling, like the other chips.
- The assistant context keeps whether the budget is per night or per stay, so a rebuild restores the same meaning.

## Acceptance criteria

- [ ] AC1: After a budget chip edit, the next assistant search uses that budget.
- [ ] AC2: Clearing the budget chip removes it from the assistant search.
- [ ] AC3: Undo after a budget edit restores the previous budget in the assistant state.
- [ ] AC4: A per-night chip budget survives a cold restore as per night.
- [ ] AC5 failure path: a budget edit while a turn is running is refused like the other chips (`threadBusy`).
- [ ] AC6: Runs with the assistant enabled and a cold restore before every event.

## ADR compliance

| ADR | Constraint | Affected |
|---|---|---|
| 0106 | Chip facts are structured guest input and must reach the task state | AC1 to AC4 |
| 0015 | All-in pricing | Budget compared against all-in totals |

## Comments

### ADR table (written for this implementation, 2 Nov 2026)

| ADR | Constraint | AC / code path |
|---|---|---|
| 0106 | Chip facts are structured guest input and reach the task state; the persisted context keeps them; every Worker request is a cold restore and guards stay fail closed | AC1 to AC4: `recordGuestStay` `budget` (runtime), `#recordAssistantStayChip` budget branch, `#assistantContextFromState`, `#restoreAssistantFromGuestThread`, `parseAssistantContext` (closed meaning) |
| 0106 | Chip budget is not a date, so it carries no date authority; a model-proposed budget stays allowed | AC1: `search_stays` budget resolution (`shortlet-assistant-pack.ts`) |
| 0015 | Budgets compare with the All-In Stay Total; a nightly budget is converted with the stay's nights | AC1, AC4: `stayBudgetKobo` (the deterministic helper, reused in the pack and `#assistantContextSearch`, not reinvented) |
| 0099 | Runtime stays domain-neutral; shortlet conversion lives in the pack and the shortlet app | `recordGuestStay` only checks the closed shape and stores it; the conversion is in the pack |
| 0075 | No guest text or ids in logs | No logging added |
| 0080 | Chip and conventional route give the same result for the same budget | AC1 compares the assistant search with `discoveryQuery.search` using the same total |

ADRs read in full: 0106 (amendments of 26 and 27 Oct 2026), 0015. Read for context: 0092, 0093, 0099, 0080.

### Findings from reading the code

- The chip never reached the assistant (`#recordAssistantStayChip` returned for `facts === null`), the undo did not record the budget, and `#assistantContextSearch` and `#restoreAssistantFromGuestThread` rebuilt every budget as `per: "stay"`. Persisted contexts had no meaning field.
- `search_stays` passed a model budget straight to `maxPriceKobo`, which is a stay total. A chip budget in the task state was ignored.
- The browse query throws without dates or party size when a price filter is set (`browse.ts`). A chip budget is therefore applied only once the stay is quotable.
- AC5 already held before the change: `handleEvent` and `handleEventAsync` refuse every event on a thread with a run in progress (`THREAD_BUSY`), before the chip is read. The new test pins it. The runtime's `threadBusy` check in `recordGuestStay` remains as a second guard.
- The recorded journey fixtures (`test/fixtures/assistant-recordings/*.json`) contain the planner's "Canonical task facts" text. Budget was therefore NOT added to `projectStateSummary`, so the recordings stay valid. The planner does not see the budget in its facts; the server applies it to `search_stays` anyway. Open question below.

### Changes

- `apps/local-guest/src/assistant/assistant-state.ts`: `AssistantBudgetPer` (closed `stay` | `night`), `isAssistantBudgetPer`, `AssistantStayIntent.maxBudgetPer`.
- `apps/local-guest/src/assistant/assistant-runtime.ts`: `recordGuestStay` takes `budget` (an amount and its meaning, or `null` to clear). A zero, non-integer or unknown-meaning budget returns false before any change. `threadBusy` still refuses.
- `apps/local-guest/src/assistant/shortlet-assistant-pack.ts`: `search_stays` uses a model budget (a stay total, as today), else the task's chip budget converted with `stayBudgetKobo` and this search's nights. A chip budget is applied only with dates and party size.
- `apps/local-guest/src/guest-projection.ts`: `PersistedAssistantContext.maxBudgetPer`. The closed parse keeps a budget only with a known meaning; an unknown or missing meaning drops the budget and keeps the rest of the context.
- `apps/local-guest/src/shortlet-app.ts`: the budget chip and its clear are recorded (`#recordAssistantStayChip`); undo records the previous budget or none (`#handleCriteriaUndo`); `#assistantContextFromState`, `#assistantContextSearch` (via `persistedBudgetTotal`) and `#restoreAssistantFromGuestThread` keep the real meaning.
- `test/assistant-budget-chip.test.ts` (new): one test per AC, plus two fail-closed guards.
- `test/helpers/assistant-chip-session.ts`: `stay()` also returns `maxBudgetKobo` and `maxBudgetPer` (shared helper, no new fixture).

### Test runs

Red before the change (`env -u LLM_API_KEY npx tsx --test test/assistant-budget-chip.test.ts`): AC1, AC2, AC3, AC4, AC6 failed for the stated reasons (no budget reached the assistant; a cold restore lost the budget). AC5 passed before the change, as described above.

Green after the change:

- `env -u LLM_API_KEY npm run check`: exit 0, no type errors (also after the final edit).
- `env -u LLM_API_KEY npx tsx --test test/assistant-budget-chip.test.ts`: 8 pass / 0 fail / 8 total (AC1 to AC6, plus 2 fail-closed guards).
- Affected existing tests, one command: `env -u LLM_API_KEY npx tsx --test test/assistant-where-chip.test.ts test/assistant-cold-journey.test.ts test/assistant-persistent-continuity.test.ts test/guest-budget.test.ts test/guest-criteria-strip.test.ts test/guest-chip-continuity.test.ts test/assistant-pending-action-restore.test.ts test/assistant-proposal-supersession.test.ts test/shortlet-assistant-evals.test.ts test/assistant-date-literal-authority.test.ts test/assistant-short-stays-29-nights.test.ts test/assistant-booking-journey.test.ts test/assistant-budget-chip.test.ts`: 149 pass / 0 fail / 149 total across 13 files.
- Not run per issue: `npm test` and `npm run test:workers` (batch pre-merge rule, CLAUDE.md "Test scope").

### Definition of Done

1. [x] Every AC has a dedicated named test (`AC1: ...` to `AC6: ...`, one `test()` each).
2. [x] Failure paths: AC5 (THREAD_BUSY while a turn runs), AC2 (clear), and the fail-closed guards (unknown or missing budget meaning dropped on restore; zero or unknown-meaning budget refused by the runtime).
3. [x] ADRs listed and read (table above).
4. [x] No new injected dependency.
5. [x] No invented policy: the conversion is the existing `stayBudgetKobo`; no new constant.
6. [x] No credential or identity material in logs or audit (no logging added).
7. [x] `npm run check` clean. `npm test` is the batch pre-merge gate and was not run per issue.

### Open questions for the owner

- Legacy rows: a persisted budget saved before this change has no meaning field, so it is dropped on the next restore (fail closed). Before this change the only writer was the planner, which means a stay total. Tell me if you would rather treat those as "stay".
- The planner's "Canonical task facts" do not include the budget. The server applies it anyway. Adding it changes the recorded journey fixtures, so it needs an owner decision on whether to re-record them.

## Answer

The budget chip now reaches the assistant. Changes are listed under Comments: the chip and its clear are recorded in the task state with their meaning (stay or per night); undo restores the previous budget; the persisted context and the cold rebuild keep the meaning, so a per-night budget stays per night; `search_stays` uses the task budget when the planner omits one, converted with the stay's nights through the deterministic `stayBudgetKobo`. Tests: `test/assistant-budget-chip.test.ts` (8 tests) and 149 affected tests green; `npm run check` clean.

