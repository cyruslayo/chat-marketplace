# One shared stay-date resolver with a typed result

Status: resolved
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

### ADR table (agent, before code; 2 Nov 2026)

Read: ADR 0106 in full (27 Oct and 2 Nov amendments). Read in full: ADR 0055 (7 lines). Skimmed for the date-relevant parts: ADR 0099, 0080 and 0092 (horizon sentence), and 0093 (guest accounts; no date rule). Shortlet `CONTEXT.md` terms read: Booking Horizon, Date phrase, Show-back. ADR 0023 taken from its amendment note in `concierge.ts` (14 nights was amended to 29 on 1 Nov 2026); not reopened here.

| ADR | Constraint | Acceptance criterion or code path |
|---|---|---|
| 0106 (2 Nov) | Week starts Monday; "next <weekday>" ambiguous Mon to Sat (both candidates), rule on Sun only; fixed holidays 25 and 31 Dec resolve; moving holidays never resolve; "next week", "next month", "end of the month" are ranges with grain, never a day; "next tomorrow" = day after tomorrow; rule values come from one policy object | AC2, AC3, AC4, AC5; `DEFAULT_STAY_DATE_POLICY` in `domains/shortlet/src/stay-date-phrases.ts` |
| 0106 (27 Oct) | Literal authority unchanged: strict literal rules (weekday must agree, horizon, explicit year, nearest on-or-after without year); relative words authorize nothing in the assistant path | AC7; `apps/local-guest/src/assistant/date-literals.ts` keeps its signature and returns only literal days |
| 0106 (2 Nov) | Deterministic path: no new UI, no fast path; the confirm flow stays as is | AC1 (`concierge.ts` mapping, see Deviations) |
| 0055 | Booking Horizon 90 days limits check-in only (a stay may end later); a day beyond it authorizes nothing | AC5 horizon, AC6 edge (day 90 resolves, day 91 unresolved); range latest is not clipped |
| 0023 | Stay length limit, unchanged here (`dateLimitRefusal` in concierge) | AC1 (`guest-real-dates` AC3 unchanged) |
| 0099 | Domain logic behind `domains/shortlet/src/index.ts`; no imports from apps into the domain | Module location; index export |
| 0075 | No guest text or ids in logs | Resolver has no logging |
| 0080 | Agent makes no state transition from a date; confirmation is guest input | Resolver is pure, returns resolutions only |

### Test record (agent, 2 Nov 2026)

Commands run from `/home/user/chat-marketplace`, each with `env -u LLM_API_KEY`. Full `npm test` and `npm run test:workers` are not run here: CLAUDE.md and AGENTS.md put them once per batch, before the merge to main.

| Command | Result |
|---|---|
| `npm run check` (tsc, tsc for the Cloudflare configs, `scripts/check-worker-bundle.mjs`) | exit 0, no errors |
| `npx tsx --test test/stay-date-phrases.test.ts` (new) | 8 of 8 pass (AC1 to AC7 plus one policy test) |
| `npx tsx --test test/guest-real-dates.test.ts` (unchanged) | 5 of 5 |
| `npx tsx --test test/assistant-date-literals.test.ts` (unchanged) | 15 of 15 |
| `npx tsx --test test/assistant-date-literal-authority.test.ts` (unchanged) | 8 of 8 |
| `npx tsx --test test/assistant-turn-date-context.test.ts` | 4 of 4 |
| `npx tsx --test test/assistant-date-clarification-copy.test.ts` | 3 of 3 |
| `npx tsx --test test/shortlet-assistant-evals.test.ts` | 52 of 52 |
| `npx tsx --test test/assistant-scope-controls.test.ts` | 38 of 38 |
| `npx tsx --test test/assistant-cold-journey.test.ts` | 3 of 3 |
| `npx tsx --test test/assistant-budget-chip.test.ts` | 9 of 9 |
| `npx tsx --test test/assistant-closed-lists.test.ts` | 8 of 8 |
| `npx tsx --test test/assistant-clarification-chips.test.ts` | 4 of 4 |
| `npx tsx --test test/assistant-change-explanations.test.ts` | 7 of 7 |
| `npx tsx --test test/guest-draft-revision.test.ts` (uses "next Friday") | 10 of 10 |
| `npx tsx --test test/guest-must-fix-ux.test.ts` (uses "this weekend") | 7 of 7 |
| `npx tsx --test test/conversational-discovery.test.ts` | 21 of 21 |
| `npx tsx --test test/guest-reflective-replies.test.ts` | 3 of 3 |
| `npx tsx --test test/guest-budget.test.ts` | 6 of 6 |

Not run: `test/guest-discovery-reasons-chromium.test.ts` (real browser; this issue changes no screen). No test enumerates the shortlet domain's exports (grep of `test/` for export enumeration found none).

A probe compared the HEAD `concierge.ts` with the new one over 50 phrases and 10 clocks (500 pairs), then was deleted. Every common phrase ("next Friday", "this weekend", day-month literals, "today", "tomorrow", "Friday") gives the same result. The differences are listed under Deviations.

### Definition of Done (checked, 2 Nov 2026)

1. Every AC has a dedicated test named after it: AC1 to AC7 are one `test()` each in `test/stay-date-phrases.test.ts`. The policy test is an extra, not an AC.
2. Failure paths: AC5 asserts each refusal reason (past, beyond_horizon, invalid, weekday_mismatch, moving_holiday). AC4 asserts both candidates. AC6 asserts day 91 is refused. The policy test asserts changed results.
3. ADRs: listed and read in the ADR table above. The 2 Nov amendment is the governing text.
4. No unused injected dependency: the resolver takes one policy object and reads every field in it (`weekStart`, `nextWeekdayAmbiguousOn`, the weekend days, `nextTomorrowDays`, both holiday lists, `monthSpans`, `bookingHorizonDays`). There are no classes.
5. No invented policy: the rule values come from `DEFAULT_STAY_DATE_POLICY`. The `monthSpans` defaults (first week 1 to 7, end of the month the last 7 days, mid-month 10 to 20) are NOT in ADR 0106. They are chosen here to make the phrases work. The owner must confirm them (see Open questions). The weekend days (Friday to Sunday) are the existing `concierge.ts` behaviour, not an ADR.
6. No credential or guest identity in logs: the resolver has no logging and takes no guest identifier.
7. `npm run check` passes with zero errors (above). `npm test` passes with zero failures is NOT claimed here: it runs once in the batch pre-merge gate, as CLAUDE.md requires.

### Deviations and open questions (for the owner)

1. **Saturday and Friday, "next Friday" is one day, not two.** The owner text says ambiguous Monday to Saturday. On Friday and Saturday the coming Friday and the following-week Friday are the same date (Sat 7 Nov gives 13 Nov twice), so the candidates collapse to one day. Monday to Thursday gives two candidates. Sunday gives 13 Nov. Owner to confirm.
2. **Deterministic path keeps one date for "next <weekday>".** `guest-draft-revision.test.ts` already pins the rule date through the deterministic confirm flow, and that path has no two-chip UI. So `concierge.ts` uses the last candidate (the following-week reading) and does not ask. The assistant path gets the two chips in issue 04. This keeps the deterministic behaviour but does not give the deterministic path the ADR's two-chip rule. Owner to decide.
3. **Deterministic path changes, all for the typed-date rules:**
   - "Fri 21 Nov" (a weekday that contradicts the date): no date now. Before, 21 Nov was used.
   - "20 Nov 2025" and "Nov 10, 2026" once that date has passed: no date now. Before, the year was silently moved to the next occurrence.
   - "10 Nov 2027": the explicit year is kept, so the 90-day refusal applies. Before, 2026 was used silently.
   - "Friday or tomorrow": the first relative phrase in text order wins. Before, "tomorrow" always beat a weekday.
   - "next tomorrow": the day after tomorrow (AC3, ADR 2 Nov).
   - "in two weeks", "in 10 days", "Christmas", "New Year's Eve" now work on the deterministic path (new phrases, allowed by the issue).
4. **Extra fields on the result type.** `unresolved` carries optional `date`, `endDate` and `source`, so a caller can name the refused reading (the 90-day refusal needs it). `day` carries optional `endDate` for "10-13 Nov". A literal stay still shows its single days as separate results, because the assistant wrapper must keep returning the same days as before.
5. **Ranges are not clipped to the horizon.** ADR 0055 limits check-in only, so a range's `latest` may pass day 90. Only its `earliest` is checked.
6. **Grains.** "next week" and "end of the month" are `week`. "next month" and "mid-<month>" are `month`. "this weekend" is `weekend`.
7. **Reserved reason.** `unknown` is in the type. No current phrase produces it.
8. **AC1 reading.** I read "both current parsers" as "any phrase either parser resolves today". For "next Friday" on Monday to Thursday, the test checks that the legacy date is one of the two candidates.
9. **Policy defaults not sourced.** The `monthSpans` values are not in ADR 0106 (see DoD item 5). Owner to confirm or replace them.
10. **Assistant path unchanged.** `date-literals.ts` keeps its signature and returns only typed single days, so ADR 0106 authority is unchanged (issue 04 changes it).

## Answer

The shared stay-date resolver is in the shortlet domain: `domains/shortlet/src/stay-date-phrases.ts`, exported from `domains/shortlet/src/index.ts`. `resolveStayDatePhrases(text, now, policy)` returns typed resolutions (`day`, `range`, `ambiguous`, `unresolved`), each with its text span. Every rule value comes from `DEFAULT_STAY_DATE_POLICY`, which is built from `BOOKING_HORIZON_DAYS`.

Callers: `apps/local-guest/src/assistant/date-literals.ts` keeps its public signature and now returns only typed single days (the assistant's ADR 0106 authority is unchanged). `apps/local-guest/src/concierge.ts` replaces `calendarDate`, `explicitDates` and `relativeDates` with `stayRequestDates`, which maps the resolver's output onto the same deterministic confirm flow. The existing `guest-real-dates` tests pass unchanged. Deviations, open questions and the policy sourcing gap are in the list above.

Tests: `test/stay-date-phrases.test.ts` (new; AC1 to AC7 plus a policy test).

- Owner decision (2 Nov 2026): accepted the defaults not in the ADR: first week of a month = days 1 to 7, end of month = last 7 days, mid-month = days 10 to 20; "next Friday" on Friday/Saturday gives one date, and the deterministic path keeps one date for "next <weekday>".
