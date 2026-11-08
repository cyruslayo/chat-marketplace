# 19 · Understand stays given in months (and weeks)

Status: ready-for-agent
Type: task
Blocked by: none
Requested: 8 Nov 2026

## Why

Extended Stays are marketed as 1 to 6 months, but the concierge only reads a stay length typed as "<n> nights" (`NIGHTS_PATTERN` in `apps/local-guest/src/concierge.ts`, used by `extractStayRequestFacts`). On the assistant path the model fills `nights` itself with no check against the guest's words, so "2 months" can become 60 nights, 61 nights or a "how many nights?" question depending on the turn. That is why the landing chip had to say "60 nights".

## Owner decisions (8 Nov 2026)

1. **A month is 30 nights**: N months = 30 × N nights (ADR 0092 as amended 1 Nov 2026: "a month is one 30-night Billing Period"). Take 30 from the Extended Stay policy's `billingPeriodNights`, never a new literal.
2. **Show-back**: when the guest gave the length in months, show the nights first and their words in brackets, e.g. "Tue 5 Jan to Sat 6 Mar 2027 · 60 nights (2 months)". Weeks and nights show nights only.
3. **Landing chip** goes back to months: "Ikoyi, 2 months from 5 Jan, relocating" (nights 60), replacing "Ikoyi, 60 nights from 5 Jan, relocating".

## What to build

1. **One shared stay-length reader** in the shortlet domain (beside `domains/shortlet/src/stay-date-phrases.ts`, exported from the domain index; reuse its `NUMBER_WORDS` and `DAYS_PER_WEEK`). Closed list of phrases, digits and number words:
   - "N nights" (as today), "a/one night";
   - "a/one week", "N weeks" → 7 × N; "a fortnight" → 14;
   - "a/one month", "N months" (1 to 12 as words or digits) → `billingPeriodNights` × N.
   Ambiguous or vague lengths ("a few months", "2-3 months", "2 or 3 months", "a couple of months", "a month or two", "a month and a half") give **no** length, so the concierge asks, exactly as when no length is given. Two different lengths in one message also give no length. A check-out date still wins over any duration (existing rule). Lengths outside the stay rules (e.g. "7 months" = 210 nights, or 15–29 is now fine) go through the existing validation and refusals unchanged.
2. **Deterministic path and shell.** `extractStayRequestFacts` uses the reader (keep `NIGHTS_PATTERN` behaviour as a subset). It also returns the phrase's unit and count so the show-back can say "(2 months)".
3. **Assistant path: the guest's stated length is authoritative.** A length the guest typed (current or earlier guest text) is a guest-authored stay fact, like chip nights (ADR 0106 "Chip facts"): record it in the task state and the runtime facts the planner sees. A planner `search_stays` or `prepare_request_draft` whose `nights` differ from the guest-authored length is a rejected tool call (`tool_denial`, never `CONCIERGE_UNAVAILABLE`), and the reply shows back the guest's length. The runtime stays domain-neutral: the reading lives in the shortlet pack/shell, not in `assistant-runtime.ts`. No keyword fast path around the classifier or planner: the turn still goes through them.
4. **Show-back** in the concierge reply and the criteria strip, per decision 2. The criteria chip value stays the number of nights.
5. **Landing chip** per decision 3 (within the 45-character chip limit; nights 60).
6. **ADR 0106**: add a dated amendment line under "Chip facts": a stay length the guest typed (nights, weeks, months) is a guest-authored stay fact; a month is 30 nights (ADR 0092).

## Acceptance criteria

- AC1: The reader maps "for 2 months", "two months", "a month", "1 month", "3 weeks", "a fortnight", "a week" and "21 nights" to 60, 60, 30, 30, 21, 14, 7 and 21 nights; "a few months", "2-3 months", "2 or 3 months", "a couple of months", "a month and a half" and "2 months, 45 nights" give no length.
- AC2: On the deterministic path, "Ikoyi, 2 months from 5 Jan, 2 guests" searches 60 nights (5 Jan to 6 Mar 2027) and the reply shows "60 nights (2 months)".
- AC3: On the assistant path (enabled, cold restore before every event, clock 2026-10-27, staging-like guest), "Ikoyi for 2 months from 5 Jan, 2 of us" yields a 60-night search; a planner call with 61 nights is a `tool_denial` and no 61-night search runs.
- AC4: A vague length ("a few months") gets the nights question on both paths, never a guessed length.
- AC5: "7 months" is refused with the existing 180-night message on both paths.
- AC6: The landing chip "Ikoyi, 2 months from 5 Jan, relocating" sent through the landing handoff (demo off) yields a 60-night search with the "(2 months)" show-back.
- AC7: The criteria strip after a months request shows 60 nights and its edit chip keeps working (chip edits still override, ADR 0106).
- AC8: Existing nights-only behaviour is unchanged (the existing concierge, criteria-strip and landing tests pass).

## ADR compliance

| ADR | Constraint |
|---|---|
| 0092 (amended 1 Nov 2026) | A month is one 30-night Billing Period; 30–180-night Extended Stays |
| 0023 (amended) | 1–29-night Short Stays |
| 0106 | Guest-authored facts; `tool_denial`; cold restore; no keyword fast path; domain-neutral runtime |
| 0077 | One source for guest wording |

## Definition of Done

See `docs/agents/issue-tracker.md`. Record commands and pass counts in Comments. New guest wording: only "(N months)" / "(1 month)" in the show-back; list it in Comments.

## Comments
