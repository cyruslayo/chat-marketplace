# Bug: the budget chip never reaches the assistant

Status: ready-for-agent
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
