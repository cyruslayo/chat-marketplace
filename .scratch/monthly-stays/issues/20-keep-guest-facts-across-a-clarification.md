# 20 · Keep the guest's own facts across a clarification turn

Status: ready-for-agent
Type: task
Blocked by: 19
Requested: 8 Nov 2026

## Why

Found while finishing issue 19 (see its Comments and `test/assistant-partial-facts-across-turns.test.ts`, whose two restore cases are `test.todo`). On the assistant path, when the concierge has to ask for a missing fact, the turn is a clarification and, under ADR 0106, "commits no task state" (`apps/local-guest/src/assistant/assistant-runtime.ts` ~87). The assistant context is persisted only once it has a city (`apps/local-guest/src/shortlet-app.ts` ~3118–3119, synced ~3494), and a cold restore clears the conversation history (`assistant-runtime.ts` ~779). A warm process survives on that history; a cold restore (every staging request) does not:

| Turn 1 → turn 2 | Warm | Cold restore |
|---|---|---|
| "Ikoyi from 5 Jan for 3 nights" → "2 of us" | searches | asks for the dates again |
| "Ikoyi, 2 months from 5 Jan" → "2 of us" | searches 60 nights | asks for the dates again |

The landing chip flow ("Ikoyi, 2 months from 5 Jan, relocating", then the party size) hits this on staging.

## Owner decision (8 Nov 2026)

Narrow amendment to ADR 0106: a clarification turn still runs **no search, no tool effect, and keeps nothing the model proposed**, but it **saves the facts the guest's own words gave** into the existing persisted assistant context, so the next turn can use them after a cold restore. Ship together with issue 19.

## What to build

1. **Guest-authored facts only.** From the current guest text (and structured guest input), using the existing readers and authority rules: city/area (`resolveLocationMention` / the closed area list), check-in (the existing date-authority rules: ISO token, English day-month literal, or confirmed relative phrase; ADR 0106 "Structured dates"), stated length (issue 19's `statedStay`) and nights, party size, bedrooms. Nothing the planner or classifier proposed is saved on a clarification turn. A check-in that the date rules would refuse is not saved.
2. **Persist a partial context.** The existing assistant context projection may be saved with only some of these fields (no city required). No new fields beyond issue 19's `statedStay`; no new table (ADR 0093 minimal projection). A cold restore seeds the task state from it exactly as for a full context.
3. **Next turn.** The facts restored from a clarification turn are guest-authored, so the planner's search must use them (a planner search that contradicts a saved guest fact is a `tool_denial`, as for chip facts and the stated length). A new guest fact replaces the saved one; a chip edit replaces it too.
4. **Show-back.** The criteria strip after a clarification turn shows the saved facts (it already must come back on assistant responses, AGENTS.md).
5. **ADR 0106.** Add a dated line "Amendment (8 Nov 2026, issue 20)" stating the narrowed rule above. Change nothing else.
6. Turn the two `test.todo` cases in `test/assistant-partial-facts-across-turns.test.ts` into passing tests.

## Acceptance criteria

- AC1: Cold restore before every event: "Ikoyi from 5 Jan for 3 nights" then "2 of us" searches Ikoyi, 5–8 Jan, 2 guests.
- AC2: Cold restore before every event: "Ikoyi, 2 months from 5 Jan" then "2 of us" searches 60 nights, and the strip shows "60 nights (2 months)".
- AC3: A clarification turn saves nothing the planner proposed: a scripted planner that invents a check-in the guest never typed leaves no check-in in the saved context.
- AC4: A check-in the date rules refuse (e.g. "next month" without confirmation) is not saved.
- AC5: A new guest fact or a chip edit in turn 2 replaces the saved fact.
- AC6: The landing chip flow over the HTTP routes (landing handoff, demo off, cold restore between requests): "Ikoyi, 2 months from 5 Jan, relocating" then "2 guests" searches 60 nights.
- AC7: The persisted assistant context gains no field beyond issue 19's `statedStay` (assert its keys).
- AC8: The existing assistant tests (cold journey, criteria strip, date literals, scope controls, pending-action restore, persistent continuity, warm session) pass unchanged.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0106 | Date authority; guest-authored facts; `tool_denial`; cold restore; no keyword fast path; domain-neutral runtime; amended narrowly here |
| 0093 | Minimal persisted projection |
| 0092, 0023 | Stay lengths |

## Definition of Done

See `docs/agents/issue-tracker.md`. Record commands and pass counts in Comments.

## Comments
