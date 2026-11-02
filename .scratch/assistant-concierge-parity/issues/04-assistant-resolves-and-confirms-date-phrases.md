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

### Triage note (agent, 2 Nov 2026)

**1. Blockers.** 01 (ADR 0106 amended 2 Nov, commit 191a411), 02 (shared resolver, commit 58842ee) and 03 (today's date in the prompts, commit d8a6127) are all resolved. No open blocker. The `Blocked by: 01, 02, 03` line in this file is right; map.md listed only 02.

**2. What is delivered, and what is missing.**

Delivered:
- The resolver: `resolveStayDatePhrases` and `DEFAULT_STAY_DATE_POLICY` in `domains/shortlet/src/stay-date-phrases.ts` (`DEFAULT_STAY_DATE_POLICY` at :63 to :80; "next <weekday>" rule :452 to :466; weekend range :436 to :447).
- Probe on the staging clock (Tue 27 Oct 2026, Africa/Lagos), read-only: "next Friday" gives `ambiguous` [30 Oct, 6 Nov]; "next Monday" gives `day` 2 Nov (relative); "next week" gives `range` week, 2 to 8 Nov; "this weekend" gives `range` weekend, 30 Oct to 1 Nov; "in two weeks" gives `day` 10 Nov; "next Sallah" gives `unresolved` moving_holiday.
- The deterministic show-back already exists: `stayRequestDates` (`apps/local-guest/src/concierge.ts:241`) feeds the confirmation at `concierge.ts:619` ("Shall I search these dates? Reply "yes", or tell me different dates."). That copy is inline in `concierge.ts`, not in `guest-content.ts` (ADR 0077). Move it with this issue so both paths share it.
- The assistant path does not call the resolver at all. Only `date-literals.ts` (single literal days) and `date-tokens.ts` use it. A relative phrase in the planner's `checkIn` is therefore refused: `resolveCheckInDate` (`apps/local-guest/src/assistant/shortlet-assistant-pack.ts:428` to :481) finds no ISO or literal match and throws `AssistantDateProvenanceError`, which becomes a `tool_denial` with the plain-word clarification (issue 14). Eval 18 (`test/shortlet-assistant-evals.test.ts:752` to :758) asserts exactly that and must be replaced by AC1 to AC2.
- Reuse for the confirmed date: `recordGuestStay` (`apps/local-guest/src/assistant/assistant-runtime.ts:774`, called from `shortlet-app.ts:4075`) writes guest-authored check-in, nights, party and budget. After a confirmed check-in is held, a planner date equal to it passes `resolveCheckInDate` through `currentCriteriaDate` (pack :465).
- Cold-restore pattern: the open pending action's surface id is re-keyed on restore, never re-minted (`assistant-runtime.ts:756` to :760, `thread-${threadId}:pending-action:${id}`). Issue 09 persisted `pendingLocation` as a field of the existing context (`shortlet-app.ts:3087` to :3091, restored at :3266). That is the shape to copy for the show-back.

Missing (what this issue must build):
- Planner schema: `checkInPhrase` on `search_stays` (schema in `shortlet-assistant-pack.ts:66` to :88; `additionalProperties: false` at :88). The classifier's `checkIn` slot is ISO only (`scope-classifier.ts:64`, `invalid_date`), and the classifier has a closed seven-key slot object (`scope-classifier.ts:31` to :35, :57). Recommendation: the phrase goes in the planner's tool only, with no classifier change.
- A phrase provenance helper: `containsGuestDate` (`date-tokens.ts`) matches ISO tokens and literals only. A normalized "phrase in current or prior guest text" check is needed.
- A pending show-back in task state: `AssistantStayIntent` (`assistant-state.ts`) has no field for it yet. It also needs a surface id, the cold-restore re-key, and chip handlers (a stage handler in `shortlet-stage-handlers.ts`, placed via `assistant-stage-handler.ts`).
- Result mapping (see 3f).
- The Eval 18 replacement and the YYYY-MM-DD wording. The `YYYY-MM-DD` text at `shortlet-assistant-pack.ts:43` cited by this issue has moved: the prompt line is now :51 (plain words), and the remaining wording is the planner's `checkIn` schema description at :74. The test at `shortlet-assistant-evals.test.ts:99` checks only `ASSISTANT_SYSTEM_INSTRUCTION`, so the schema description is not covered by it.

**3. Owner questions and risks.**

a. **AC1 cannot be met as written on the staging clock.** 27 Oct 2026 is a Tuesday, so "next Friday" is `ambiguous` (30 Oct or 6 Nov). The 2 Nov amendment says the show-back "offers both candidate dates as chips and authorizes neither until the guest taps one". AC1 asks for "a show-back with concrete dates", which the ADR does not allow for this input. Owner: change AC1 to "two date chips, nothing searched".

b. **What a tap means.** AC4 says choosing a candidate searches that date. AC2 says "Yes" after a day show-back searches. The ADR says a tap on a chip is the confirmation. Owner: is a tap on a candidate both the confirmation and the search, or does it lead to a second show-back with Yes?

c. **Typed "yes".** `isExplicitConfirmation` (`apps/local-guest/src/assistant/pending-actions.ts:87`, closed set at :41) is the deterministic path for pending consequential actions (ADR 0106: authorized confirmations skip the classifier). A show-back is not an ADR 0072 action, and `PendingActionType` is closed to three types (`pending-actions.ts:10`). Owner: does a typed "yes" confirm a show-back through that closed set (no classifier call), or does it go to the classifier? Routing it through the closed set is a phrase list over guest text, which the RULES warn against, so chips may be the only confirmation on this path.

d. **Persistence and ADR 0093.** The 27 Oct amendment says no new persisted record beyond the existing context fields. The 2 Nov amendment says the confirmation persists across a cold restore. Owner: confirm that a pending show-back stored as one context field (as `pendingLocation` is) is within ADR 0093. Recommend storing only the resolved candidates, the grain and the nights and party (not the guest's words), since the phrase is not needed after the show-back.

e. **Replacing a held check-in.** If a guest with a held check-in confirms a different phrase, `resolveCheckInDate` throws (pack :466 to :468), so the new date must be authored first. Owner: is the newest confirmed date the one that holds (as the budget decision in issue 07)?

f. **Result mapping (the issue's chips).**
- `day` from a relative phrase: show-back with Yes and Change dates chips.
- `day` from a typed literal: unchanged. It is already guest-authored (ADR 0106 27 Oct), so it needs no show-back.
- `day` with `endDate` ("10-13 Nov"): `date-literals.ts` drops it as a stay pair. That belongs to issue 05, not here.
- `ambiguous`: one chip per candidate. On Friday and Saturday the candidates collapse to one day (see g.1).
- `range`: grain `month` and `week` give a date chip opened at `earliest` (ADR 0106 2 Nov). The issue's "day chips for a week" means seven 44px targets (ADR 0078). Owner to pick one. Grain `weekend` is a concrete window (Friday to Sunday); owner to say whether it gets a show-back with both dates or a date chip.
- `unresolved` (past, beyond_horizon, invalid, weekday_mismatch, moving_holiday, unknown): the plain-word clarification from issue 14. Owner: one sentence for all reasons, or reason-specific copy? Reason-specific copy would need new entries in `guest-content.ts` (ADR 0077).

g. **Owner items from the issue 02 Answer, not settled by ADR 0106 as written.**
1. "Next Friday" on Friday or Saturday gives one day. Friday 6 Nov gives 13 Nov only, and the same holds for Saturday. This follows from `readings.length === 1` (`stay-date-phrases.ts`, around :456), not from a stated policy. Owner to confirm.
2. The deterministic path keeps one date for "next <weekday>" (it uses the following-week reading), while the assistant path gives two chips (AC4). ADR 0080 wants one answer on both paths. Owner to choose: give the deterministic path the two-chip show-back too, or make the assistant path one day. Note also that the 02 Answer cites "no new UI" on the deterministic path to ADR 0106 (2 Nov). The amendment text I read does not say that.
3. `monthSpans` defaults (first week days 1 to 7; end of the month, last 7 days; mid-month, 10 to 20) are in `DEFAULT_STAY_DATE_POLICY` (`stay-date-phrases.ts:78`) and are not in ADR 0106. They shape the range chips that AC5 relies on. Owner sign-off required.

h. **No keyword shortcuts.** The resolver must read only the guest's text and must not add phrase lists to reply rendering (RULES). The existing regexes in `renderShortletReplyBody` are listed under issue 11.

i. **Staging clock.** The 27 Oct clock makes "next Friday" ambiguous, so every parity row built on it needs the chip step (issue 16 has the same clock issue).

**4. Recommended status, order and split.**
- Recommended status: `needs-info`. Move to `ready-for-agent` only after the owner answers a (AC1 wording), b (tap meaning), c (typed yes), d (ADR 0093 persistence) and g.2 and g.3. I have not changed the Status line.
- Order: 04 is the first of the four, because 05 (phrase part) and 13 (AC5) depend on it.
- Suggested split, if the owner approves it: 04a is the day show-back with Yes and Change chips, the planner's `checkInPhrase`, the cold restore and AC2, AC3, AC6, AC7 and AC8. 04b is `ambiguous` chips and `range` handling (AC4, AC5). Both touch `search_stays` and `resolveCheckInDate`, so one agent should do both, in order.
