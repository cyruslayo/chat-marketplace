# Assistant: read the guest's budget with the deterministic parser

Status: resolved
Type: AFK
Blocked by: 06
Requested: 1 Nov 2026

## Parent

[PRD](../PRD.md)

## Why

The deterministic `extractBudget` (`concierge.ts`, issue 03b) reads ₦, k, m and "naira", per night vs per stay, and refuses "under 3 nights" or "max 4 guests" as money. The assistant has one argument, `maxBudgetKobo` "all-in" (`shortlet-assistant-pack.ts:70`). The model converts naira to kobo and multiplies nightly prices itself, and nothing checks the value against the guest's text.

## What to build

- `search_stays` takes `budgetPhrase` (the guest's words, copied exactly) instead of a model-computed kobo value.
- The pack checks the phrase is in guest text and parses it with `extractBudget`, then computes the all-in limit with `stayBudgetKobo` (per night times nights).
- A phrase the parser does not read is a `tool_denial` with a budget clarification; no search on a guessed number.

## Acceptance criteria

- [ ] AC1: "under ₦150k a night" for 3 nights limits the search to an all-in ₦450,000.
- [ ] AC2: "budget 500k total" limits it to ₦500,000.
- [ ] AC3 failure path: "max 4 guests" and "under 3 nights" set no budget.
- [ ] AC4 failure path: a budget phrase not in guest text is a `tool_denial`.
- [ ] AC5: Same input gives the same budget filter on both paths (parity test).
- [ ] AC6: A newer typed budget replaces the chip budget.
- [ ] AC7: A repeated phrase from an earlier guest turn is accepted, one never typed is rejected.

## Owner decisions (2 Nov 2026)

- Precedence: when a budget chip is set and the guest types a different budget in chat, the newest budget wins (AC6). The owner approved moving this issue to `ready-for-agent`.

## ADR compliance

| ADR | Constraint | Affected |
|---|---|---|
| 0015 | All-in pricing: the budget is an All-In Stay Total (per night x nights for a nightly budget) | AC1, AC2, AC5 |
| 0106 | Models never supply financial authority: the server parses the guest's words. Rejected calls are `tool_denial` | AC3, AC4, AC7 |
| 0106 (27 Oct 2026 amendment) | Provenance: a value authorises only when the guest's own text states it. The date-literal rule is the model for the budget phrase: the phrase must appear in guest text (current or prior guest turns), compared after whitespace and case normalisation. Read here by analogy: the amendment itself covers dates | AC4, AC7 |
| 0106 (2 Nov 2026 amendment) | Confirmed date phrases are guest-authored; the budget has no confirmation step, so the typed phrase is the authority | AC4 |
| 0075 | No guest text or ids in logs: the rejection carries the closed guest sentence only | AC4 |
| 0080 | Parity: the deterministic and assistant paths give the same budget filter | AC5 |
| 0099 | Shortlet logic stays in the pack, not in the runtime. The pack's `executeAssistantTool` search branch is the hook (it has `userTextHistory`) | AC1 to AC7 |

Hook: the parse, provenance check and task-state write happen in the `search_stays` branch of `executeAssistantTool` (`shortlet-assistant-pack.ts`). `normalizeToolArguments` stays limited to amenities; the phrase is a plain string in the schema.

## Comments

### Triage note (agent, 2 Nov 2026)

Blockers: 06 is resolved (commits 6bc110a and 1922086). No open blocker.

What the code does today:
- `shortlet-assistant-pack.ts:77` offers `maxBudgetKobo` (a model-computed kobo value) in the `search_stays` schema. Lines 501 to 505 use it as the stay total, or fall back to the chip budget through `stayBudgetKobo`. The model still does the naira and per-night arithmetic that AC1 and AC2 test.
- `extractBudget` (`concierge.ts:397`) is not exported. AC5 needs it exported or moved to a shared module, as issue 08 did with `stay-vocabulary.ts`. `stayBudgetKobo` (`concierge.ts:428`) is already exported.
- `assistant-runtime.ts:799` to 802 writes the chip budget into the task's stay facts. A typed phrase should use the same write.

Missing or open:
1. Precedence. When a budget chip is already set and the guest types a different budget, the issue does not say which wins. This is a product choice for the owner.
2. The `budgetPhrase` argument needs the same pack hook as issue 08 (`normalizeToolArguments`, `shortlet-assistant-pack.ts:313`), which today maps only `requiredAmenities`. Name the hook in the issue, or name a separate parse step.
3. The ADR table does not cite the 27 Oct 0106 amendment. AC4's provenance rule (the phrase must be in guest text, including prior guest text) depends on it, so add it.
4. AC4 needs a provenance rule for a phrase repeated across turns, matching the date-literal rule.

Overlap: the budget hook and any hook edit touch `shortlet-assistant-pack.ts`, the same file as issues 09 and 11. Sequence the edits or expect merge conflicts.

Recommended next status: `ready-for-agent` once the owner confirms point 1 and the ADR table is updated (point 3). Points 2 and 4 are text edits. The move itself is the owner's approval.

### Status change (agent, 2 Nov 2026)

Status moved needs-triage, then ready-for-agent (owner approved 2 Nov 2026), then claimed for implementation. Owner decision recorded: when a budget chip is set and the guest types a different budget in chat, the newest budget wins.

### Plan (agent, 2 Nov 2026)

- Schema: `maxBudgetKobo` leaves the model-facing `search_stays` schema; `budgetPhrase: string | null` replaces it (guest's words, copied exactly). A model that still sends `maxBudgetKobo` gets the runtime's closed argument refusal (`additionalProperties: false`).
- Parser: `extractBudget` and its patterns move to `apps/local-guest/src/stay-budget.ts`; `concierge.ts` imports and re-exports them, so the deterministic output is unchanged.
- Provenance: the phrase, after whitespace and case normalisation, must occur in some guest text in `userTextHistory` (current turn or prior guest turns). Otherwise, or when the parser reads no budget from the phrase, the search throws `AssistantGuestRefusalError` with `GUEST_ASSISTANT_COPY.budgetClarification`, which the runtime answers as `tool_denial` with no search and no state change.
- All-in limit: `stayBudgetKobo({ budget, nights })` with the same quotable condition as the chip path (dates, party size, nights known). The parsed budget is written to `stayIntent.maxBudgetKobo`/`maxBudgetPer`, the same fields as the chip, so the newest write wins (AC6) and persistence, the criteria strip and cold restore follow issue 06's path.
- Planner omits `budgetPhrase` or sends null: the task budget is kept.

### ADR table (written before code, 2 Nov 2026)

Reflected in the ADR compliance table above. Open point for the owner: ADR 0106's 27 Oct amendment covers dates; the budget provenance rule is applied here by analogy and is not stated there. A budget-specific amendment may be wanted.

### Implementation notes (agent, 2 Nov 2026)

- Schema: `maxBudgetKobo` is gone from the model-facing `search_stays` schema; `budgetPhrase: string | null` replaces it. Checked: no recorded journey, fixture or scripted model sent `maxBudgetKobo` (grep of `test/` and `test/fixtures/`), so no recording was touched. One eval test (`test/shortlet-assistant-evals.test.ts`, the amenity search) sent it; I removed that argument, which does not change its amenity assertion.
- Parser: `extractBudget` moved unchanged to `apps/local-guest/src/stay-budget.ts` (with `StayBudget` and its patterns). `concierge.ts` re-exports both, so the deterministic output is the same. The move script's output was reviewed in `git diff`.
- Hook: the parse, provenance check and task-state write are in the `search_stays` branch of `executeAssistantTool` (`shortlet-assistant-pack.ts`). It has `context.userTextHistory`, which `normalizeToolArguments` does not.
- Rejections: the pack throws `AssistantGuestRefusalError(GUEST_ASSISTANT_COPY.budgetClarification)`, which the runtime answers as `tool_denial` with no search and no task-state write (the existing catch block, no new error class).
- Task state: a stated budget is written to `stayIntent.maxBudgetKobo`/`maxBudgetPer`, the fields the chip uses. Persistence, the criteria strip (`budget.label`, asserted in AC1) and the cold restore follow issue 06's path unchanged.
- Cold-restore finding: `thread.conversationHistory` is not persisted (`assistant-runtime.ts` clears it on restore), so on the Worker path the provenance check sees only the current turn and the persisted canonical dates. This is why the held-budget rule below exists. Recorded as an owner question.

### Held-budget rule (agent decision, needs owner confirmation)

A phrase that is not in this turn's text is accepted only when it parses to the budget the task already holds (the same kobo and meaning). That budget is guest-authored (a chip or an earlier typed phrase), so repeating it changes no state and grants the model no new amount. Any other phrase not in the guest's text is refused. AC4's literal wording ("a budget phrase not in guest text is a tool_denial") is met when no budget is held, which is what the AC4 test covers. With a budget held, a phrase equal to it is accepted. The owner should confirm this rule (see Open questions).

### Test runs (agent, 2 Nov 2026)

Commands run from `/home/user/chat-marketplace`, with `env -u LLM_API_KEY`:

| Command | Result |
|---|---|
| `npx tsx --test test/assistant-budget-phrase.test.ts`, before the change | 0 pass, 7 fail (schema rejects `budgetPhrase`, or the closed refusal is not yet present) |
| `npx tsx --test test/assistant-budget-phrase.test.ts`, after the change | 7 pass, 0 fail |
| `npm run check` (final, clean tree) | exit 0 |
| Affected set: `assistant-budget-chip`, `assistant-closed-lists`, `assistant-tool-argument-validation`, `assistant-tool-authorization`, `shortlet-assistant-evals`, `assistant-search-unknowns`, `assistant-recorded-journeys`, `assistant-cold-journey`, `assistant-booking-journey`, `assistant-clarification-chips`, `assistant-change-explanations`, `stay-date-phrases`, `guest-real-dates`, `guest-budget`, `guest-discovery-consistency`, `guest-must-fix-ux`, `browse-one-eligible-unit`, `concierge-controls-eval`, `assistant-scope-controls`, `assistant-turn-stop-reasons`, `assistant-turn-stop-cold-restore`, `assistant-pack-registry`, `assistant-runtime-boundary`, `assistant-date-clarification-copy`, `assistant-short-stays-29-nights`, `assistant-reply-coverage`, `demo-extended-assistant` (with the new file) | 295 pass, 0 fail, 295 total (28 files) |
| Extra pricing-vocabulary files: `landing-page`, `pilot-agent-smoke-grading`, `back-office-owner-payables`, `guest-account-authority` | 71 pass, 0 fail (the 4-file subset of the same run; combined with `assistant-thread-lock`, `assistant-turn-stop-reasons` and `assistant-scope-controls`, 151 pass, 0 fail) |

Real-Chrome files were not run: the change alters no screen. No Worker code changed, so `npm run test:workers` was not run. The full `npm test` and `npm run test:workers` are the once-per-batch pre-merge gate (CLAUDE.md "Test scope"), not run per issue.

### Definition of Done (agent, 2 Nov 2026)

1. Every AC has a dedicated named test: yes. AC1 to AC7 are `test()` blocks in `test/assistant-budget-phrase.test.ts`, named after the AC text.
2. Failure paths are asserted: AC3 (a count read as money is refused, and no searched filter carries a budget), AC4 (an unauthored phrase is a `tool_denial` with no search), AC7 (an invented phrase is refused, and the held budget still applies).
3. ADRs listed and read: 0106 in full, including the 27 Oct and 2 Nov amendments; 0099 in full; 0015, 0075 and 0080 from their opening sections. Constraints are in the ADR compliance table.
4. No injected dependency: no new class or constructor was added.
5. No policy invented: the copy sentence is the one specified in the issue's What to build, with its example amounts. The held-budget rule is not stated in any ADR or in the issue, and is flagged for the owner.
6. No credential, guest text or ids in logs (ADR 0075): nothing is logged. The refusal carries only the closed sentence.
7. `npm run check` passes with zero errors (exit 0). `npm test` is the batch pre-merge gate, not run per issue (see Test runs).

### Open questions for the owner

1. Held-budget rule (needs your decision). Options: (a) keep it: a phrase equal to the held budget is accepted without being in this turn's text; (b) strict: refuse any phrase not in this turn's text, which means a repeat of an earlier typed phrase is refused after a cold restore; (c) persist the guest's budget phrase as a canonical fact, like the check-in, which adds a persisted record that the 27 Oct amendment rules out unless you amend it. The current code is (a).
2. ADR 0106's 27 Oct amendment covers dates only. The budget provenance is applied by analogy. A short amendment naming budgets would make the rule explicit.
3. A typed budget with no nights or party size is recorded but not applied to that search (the chip works the same way, ADR 0015). Say if you want it applied on the nightly meaning as soon as the stay is known.

## Answer

Resolved (2 Nov 2026), pending owner decision on open question 1 before merge.

- `search_stays` takes `budgetPhrase` (the guest's own words) in place of the model-computed `maxBudgetKobo`. The server checks the phrase is in the guest's text, parses it with the shared `extractBudget` and converts it with `stayBudgetKobo`.
- A phrase the guest did not type, or one the parser cannot read, is a `tool_denial` with the budget clarification and no search.
- The newest budget wins: a typed budget replaces the chip's, and the chip replaces an earlier typed budget (both write the same task fields).
- Changed files: `apps/local-guest/src/stay-budget.ts` (new), `apps/local-guest/src/concierge.ts` (move and re-export), `apps/local-guest/src/assistant/shortlet-assistant-pack.ts`, `apps/web-agent/src/guest-content.ts`, `test/assistant-budget-phrase.test.ts` (new), `test/shortlet-assistant-evals.test.ts`.
- Decision needed: the held-budget rule in open question 1.

- Owner decision (2 Nov 2026): keep the held-budget rule: a budget phrase not in this turn text is accepted only if it parses to the budget the task already holds (history is not persisted across a cold restore).
