# 03 · Landing chip validator follows the Short Stay limit

Status: ready-for-agent
Type: task
Blocked by: 01
Requested: 1 Nov 2026

## What to build

`apps/local-guest/src/landing-copy.ts` keeps its own `LAUNCH_MAX_STAY_NIGHTS = 14` and `validateExampleChips` refuses chips over it, citing ADR-0023. Make the landing take the limit from the domain instead of a copy of it.

- Remove `LAUNCH_MAX_STAY_NIGHTS` and use `MAX_STAY_NIGHTS` from `domains/shortlet/src` (or re-export it under the old name if other modules import it; search first).
- Update the validator message to "a Short Stay is 1 to 29 nights (ADR 0023)".
- Do **not** change any chip text or other landing copy here. Copy changes, including monthly chips of 30+ nights, wait for the landing copy decision (landing issue 13 item 4, to be reopened).

## Acceptance criteria

- AC1: `validateExampleChips` accepts a chip of 29 nights and refuses one of 30 nights and one of 0 nights, naming the 1–29 range.
- AC2: The landing module has no stay-length constant of its own; the limit comes from `MAX_STAY_NIGHTS`.
- AC3: The approved chips and the landing copy tests (`test/landing-page.test.ts`) pass unchanged.

## ADR compliance

| ADR | Constraint | Where it bites |
|---|---|---|
| 0023 (amended) | Short Stay 1–29 nights | AC1, AC2 |
| 0077 | One source for guest wording and rules | AC2 |

## Definition of Done

See `docs/agents/issue-tracker.md`. Record the exact test commands and pass counts in Comments.

## Comments
