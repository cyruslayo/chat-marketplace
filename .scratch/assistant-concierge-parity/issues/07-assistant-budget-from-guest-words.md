# Assistant: read the guest's budget with the deterministic parser

Status: needs-triage
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

## ADR compliance

| ADR | Constraint | Affected |
|---|---|---|
| 0015 | All-in pricing | AC1, AC2 |
| 0106 | Rejected calls are `tool_denial` | AC4 |
| 0080 | Parity | AC5 |

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
