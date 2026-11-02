# One shared stay-date resolver with a typed result

Status: ready-for-agent
Type: AFK
Blocked by: 01
Requested: 1 Nov 2026

## Parent

[PRD](../PRD.md)

## Why

Two date parsers exist and neither covers common phrases. `concierge.ts` (`calendarDate`, `relativeDates` at :272) handles day-month literals, today, tomorrow, weekdays, "next <weekday>" and weekends. `assistant/date-literals.ts` handles day-month literals with stricter rules (weekday check, horizon, explicit year). Neither handles "next week", "next month", "in two weeks", "end of the month", "mid-December" or "next tomorrow".

## What to build

- One module in the shortlet domain (behind `domains/shortlet/src/index.ts`, ADR 0099) that takes text, the turn clock and a policy object, and returns resolutions with their spans:
  `day` (date, source literal or relative), `range` (earliest, latest, grain weekend, week or month), `ambiguous` (candidate dates), `unresolved` (past, beyond_horizon, unknown).
- Coverage: everything both current parsers handle, plus the phrases above and the decisions in issue 01.
- Both callers use it: `concierge.ts` (replacing `relativeDates` and the literal parsing) and `assistant/date-literals.ts` (whose public function keeps its signature and returns only `day` results with source literal, so ADR 0106 authority does not change until issue 04).
- Rule values come from the policy object (AGENTS.md anti-pattern 3).

## Acceptance criteria

- [ ] AC1: Every phrase both current parsers resolve resolves to the same date (regression table test).
- [ ] AC2: "next week", "next month", "end of the month", "first week of December" resolve to a `range` with the right grain, never a `day`.
- [ ] AC3: "in two weeks", "in 10 days", "next tomorrow" resolve to a `day`.
- [ ] AC4: "next Friday" follows the issue 01 rule, including `ambiguous` where decided.
- [ ] AC5 failure path: past dates, dates beyond the 90-day horizon (ADR 0055), invalid days (31 February), contradicting weekdays and moving holidays resolve to `unresolved`.
- [ ] AC6: A matrix test runs every phrase against seven reference weekdays, a month end, 31 December and the horizon edge.
- [ ] AC7: `test/assistant-date-literals.test.ts` and `test/guest-real-dates.test.ts` still pass unchanged.

## ADR compliance

| ADR | Constraint | Affected |
|---|---|---|
| 0106 | Literal authority unchanged until issue 04 | AC7 |
| 0055 | 90-day horizon | AC5 |
| 0099 | Domain logic behind the domain index | Module location |

## Comments
