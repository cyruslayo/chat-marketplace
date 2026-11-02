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

### Recommendation (agent, not a decision), 2 Nov 2026

Grounding: `concierge.ts` `relativeDates` (about lines 272 to 300) resolves today, tomorrow, weekdays and weekends against the Lagos clock and returns `given: false`. The deterministic flow searches only after the guest says yes (`test/guest-real-dates.test.ts` AC1). ADR 0106 (27 Oct amendment) authorizes a date only from guest text as an ISO token or English day-month literal, or from a confirmed structured check-in, and says "A pending relative phrase does not".

1. **Yes.** A relative phrase the guest typed, resolved by server code and then confirmed on a show-back, becomes a guest-authored date, as a confirmed chip check-in already does. Before the guest's yes nothing authorizes: the resolved date is server output, not guest text, so it stays unauthorized under the "no model-only dates" rule.

2. **Ambiguous Wed to Sat, rule-based Sun to Tue, as proposed, with two corrections to RESEARCH.md section 4.1.** The `nextMonday` line in `concierge.ts` gives the Friday of the following Monday-start week. On Wed 4 Nov that is Fri 13 Nov, which skips Fri 6 Nov, one of the two readings a guest may mean. Offering both as chips leaves the choice with the guest, which fail-closed authority requires. Correction: the rule gives Fri 6 Nov only on Sunday. On Monday and Tuesday it gives Fri 13 Nov (Tue 3 Nov gives Mon 9 Nov, then Fri 13 Nov). Those are the days when the rule passes over a Friday two to four days away, so I would extend the ambiguity to Monday and Tuesday and keep the rule for Sunday only. Saturday needs its own answer, because the coming Friday has already passed.

3. **Monday.** The code already uses a Monday week start (`(weekdayOf(today) + 6) % 7`), and RESEARCH.md uses it too. Keep it, and move it into the configured policy (see AC2) so it is not a literal.

4. **Yes, to "next tomorrow".** `relativeDates` does not handle it today, so the guest gets no reading. The usual Nigerian English meaning is the day after tomorrow (3 Nov on a 1 Nov clock). If a guest meant plain "tomorrow", the show-back shows the date before any search runs, so the confirmation catches the mistake.

5. **Yes: fixed holidays resolve, moving ones never.** Fixed dates such as 25 and 31 December fit the existing day-month calculation (`calendarDate`) inside the 90-day horizon. Sallah and Eid depend on the moon and Easter on the church calendar, and the official dates are often set late, so any date the server picked would be an invented date (ADR 0106). The fixed holiday list is configuration, not code (see AC2).

6. **Yes.** "Next week", "next month" and "end of the month" are spans. The resolver should return a range with its grain, and the server must not pick a day the guest did not choose. After a range the guest gets day chips, or the date chip opened at the start of the range (RESEARCH.md 4.3).

**Proposed AC2 wording:** "The amendment states that the rule values are configuration passed to the date resolver as one policy object, with the default values listed in this ADR: the week start for 'next week' and other spans, the 'next <weekday>' rule, the fixed holiday list and the booking horizon (ADR 0055). The resolver and the shortlet pack contain no literal values for them. The literals now in `concierge.ts` `relativeDates` move into that policy object in issue 02."

**Proposed AC3 terms** for `domains/shortlet/CONTEXT.md`, next to **Booking Horizon**:

- **Date phrase**: The guest's own words for a day or a span of days, such as "20 Nov", "tomorrow", "next Friday" or "next week". Server code resolves it against the Lagos clock. It authorizes a check-in only after the guest confirms its show-back.
  _Avoid_: date expression, relative date, date string
- **Show-back**: The concrete reading of a date phrase or chip check-in, shown to the guest before any search runs, for example "Arriving Fri 6 Nov 2026, leaving Mon 9 Nov 2026. Shall I search these dates?". Only the guest's yes makes the dates guest-authored.
  _Avoid_: confirmation (already used for offer confirmation tokens, ADR 0086), preview, echo

Issues 02, 04, 05 and 13 stay blocked until the owner decides 1 to 6. Issue 01 stays `ready-for-human`; this comment changes no status.
