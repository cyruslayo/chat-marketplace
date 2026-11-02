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
