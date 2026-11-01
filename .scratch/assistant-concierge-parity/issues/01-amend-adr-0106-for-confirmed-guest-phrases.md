# Amend ADR 0106 so confirmed relative dates are guest-authored

Status: ready-for-human
Type: grilling
Blocked by: none
Requested: 1 Nov 2026

## Parent

[PRD](../PRD.md)

## Why

ADR 0106 (27 Oct amendment) says "Relative words ... stay unresolved" and "A pending relative phrase does not" authorize a date. That is why the assistant answers "next Friday" with "Please give me the check-in date as YYYY-MM-DD" (`shortlet-assistant-pack.ts:43`, `guest-content.ts:29`). The deterministic path already resolves relative phrases and confirms them first (`concierge.ts:272`, `test/guest-real-dates.test.ts` AC1). Issues 04, 05 and 13 cannot start until the ADR says what counts.

## Decisions for the owner

1. A relative date phrase that the guest typed, that server code resolved against the turn clock, and that the guest then confirmed on a show-back, is a guest-authored date (like a confirmed chip check-in). An unconfirmed resolution authorizes nothing. Recommended: yes.
2. Meaning of "next <weekday>". Today's rule (`concierge.ts:286`): that weekday in the following Monday-start week, so on Wed 4 Nov 2026 "next Friday" is 13 Nov. Options: keep it; or treat midweek "next Friday" as ambiguous and offer both dates as chips. Recommended: ambiguous on Wed to Sat, rule-based on Sun to Tue.
3. Week start for "next week" (Monday, as today).
4. Whether to support Nigerian English "next tomorrow" (the day after tomorrow). Recommended: yes.
5. Fixed holidays (Christmas, New Year's Eve) resolve; moving ones (Sallah, Eid, Easter) never resolve. Recommended: yes.
6. Week- or month-grain phrases ("next week", "next month") never become a single day without a guest choice. Recommended: yes.

## Acceptance criteria

- [ ] AC1: ADR 0106 has a dated amendment recording decisions 1 to 6.
- [ ] AC2: The amendment states that the rule values (week start, "next <weekday>" rule) are configuration passed to the resolver, not literals in code.
- [ ] AC3: `CONTEXT.md` (shortlet) defines any new term used, for example "date phrase" and "show-back".

## Comments
