# Assistant: resolve the guest's date phrase on the server and confirm it

Status: needs-triage
Type: AFK
Blocked by: 01, 02, 03
Requested: 1 Nov 2026

## Parent

[PRD](../PRD.md)

## Why

On the assistant path "next Friday", "this weekend" and "next week" end in a YYYY-MM-DD request. The deterministic path resolves and confirms them (`concierge.ts:272`, `shortlet-app.ts:4505`). Once issue 01 allows it, the assistant needs the same flow.

## What to build

- Classifier slots and `search_stays` gain `checkInPhrase` (the guest's words for arrival, copied exactly). `checkIn` stays for ISO and literal dates.
- The pack checks the phrase is a substring of the current or prior guest text, resolves it with the issue 02 resolver, and never uses a model-computed date for it.
- By resolution kind:
  - `day`: a show-back reply with the concrete dates, nights and party ("Arriving Fri 6 Nov 2026, leaving Mon 9 Nov 2026 (3 nights), 2 guests. Shall I search these dates?") and Yes / Change dates chips. Same wording helper as `shortlet-app.ts:4517`.
  - `ambiguous`: one chip per candidate date.
  - `range`: the date chip opened at `earliest`, or day chips for a week. Never a guessed day.
  - `unresolved`: the plain-word clarification (issue 14).
- Only the guest's Yes (or a chip choice) makes the date guest-authored and records it in the task state, through the same path as a confirmed chip (`recordGuestStay`).
- The pending resolution and its confirm surface id are persisted and re-keyed on cold restore, never re-minted. A forged, stale or superseded confirm returns `STALE_SURFACE`.
- Replace Eval 18 and the instruction test in `test/shortlet-assistant-evals.test.ts` (lines 95, 751), and the YYYY-MM-DD instruction at `shortlet-assistant-pack.ts:43`.

## Acceptance criteria

- [ ] AC1: "Flat in Ikoyi next Friday for 3 nights, 2 guests" gives a show-back with concrete dates and runs no search.
- [ ] AC2: Yes after the show-back searches those dates, and the criteria strip shows them.
- [ ] AC3 failure path: an unrelated reply after the show-back does not confirm and runs no search.
- [ ] AC4: An `ambiguous` phrase offers one chip per candidate; choosing one searches that date.
- [ ] AC5: "next week" or "next month" never searches before the guest picks a day.
- [ ] AC6 failure path: a phrase not present in guest text is a `tool_denial`.
- [ ] AC7 failure path: a forged, stale or superseded confirm id returns `STALE_SURFACE`; a cold restore keeps the pending show-back and its id.
- [ ] AC8: The journey runs with the assistant enabled, a cold restore before every event, clock 2026-10-27 and a guest with no phone or email (model: `test/assistant-cold-journey.test.ts`).

## ADR compliance

| ADR | Constraint | Affected |
|---|---|---|
| 0106 (as amended by 01) | Only confirmed resolutions authorize; cold restore keeps ids; no fast path | AC2, AC3, AC6, AC7 |
| 0074 | Fail-closed surface lifecycle | AC7 |
| 0080 | Same result as the deterministic path | AC1, AC2 |
| 0078 | Chips are 44px targets | AC4 |

## Comments
