import test from "node:test";
import assert from "node:assert/strict";
import {
  BOOKING_HORIZON_DAYS,
  DEFAULT_STAY_DATE_POLICY,
  resolveStayDatePhrases,
  type StayDatePolicy,
  type StayDateResolution,
} from "../domains/shortlet/src/index.js";

// Issue 02: one shared stay-date resolver. The reference week is Mon 2 Nov 2026 (Africa/Lagos) to Sun 8 Nov 2026.
// Each clock is 11:00 WAT, so the Lagos calendar date is the day in the name.
function clockOn(isoDay: string): Date {
  return new Date(`${isoDay}T10:00:00Z`);
}

const REFERENCE_WEEK = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"] as const;
const MONDAY = clockOn("2026-11-02");

function resolve(text: string, now: Date = MONDAY, policy: StayDatePolicy = DEFAULT_STAY_DATE_POLICY): readonly StayDateResolution[] {
  return resolveStayDatePhrases(text, now, policy);
}

/** The one resolution a phrase produces. A phrase that resolves to nothing or to several readings fails the caller's assertion. */
function only(text: string, now: Date = MONDAY, policy: StayDatePolicy = DEFAULT_STAY_DATE_POLICY): StayDateResolution {
  const found = resolve(text, now, policy);
  assert.equal(found.length, 1, `expected one resolution for "${text}", got ${JSON.stringify(found)}`);
  return found[0]!;
}

function dayOf(text: string, now?: Date, policy?: StayDatePolicy): string {
  const result = only(text, now, policy);
  assert.equal(result.kind, "day", `"${text}" should resolve to a day: ${JSON.stringify(result)}`);
  if (result.kind !== "day") throw new Error("unreachable");
  return result.date;
}

function unresolvedReason(text: string, now?: Date, policy?: StayDatePolicy): string {
  const result = only(text, now, policy);
  assert.equal(result.kind, "unresolved", `"${text}" should be unresolved: ${JSON.stringify(result)}`);
  if (result.kind !== "unresolved") throw new Error("unreachable");
  return result.reason;
}

/** Calendar offset in days between two ISO dates (UTC arithmetic on calendar dates). */
function plusDays(isoDay: string, days: number): string {
  return new Date(Date.parse(`${isoDay}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

test("AC1: Every phrase both current parsers resolve resolves to the same date (regression table)", () => {
  // Phrases the deterministic parser (concierge.ts relativeDates / calendarDate) or the assistant literal parser
  // (date-literals.ts) resolves today, with the date each one gives on the reference clock (Mon 2 Nov 2026).
  assert.equal(dayOf("today"), "2026-11-02");
  assert.equal(dayOf("I need it tonight"), "2026-11-02");
  assert.equal(dayOf("tomorrow"), "2026-11-03");
  assert.equal(dayOf("this Friday"), "2026-11-06");
  assert.equal(dayOf("on Friday"), "2026-11-06");
  assert.equal(dayOf("Friday"), "2026-11-06");
  assert.equal(dayOf("10 Nov"), "2026-11-10");
  assert.equal(dayOf("10th of November"), "2026-11-10");
  assert.equal(dayOf("November 10"), "2026-11-10");
  assert.equal(dayOf("Nov 10, 2026"), "2026-11-10");
  assert.equal(dayOf("20 Nov 2026"), "2026-11-20");
  assert.equal(dayOf("Fri 6 Nov"), "2026-11-06", "a literal whose weekday agrees resolves (date-literals.ts)");
  assert.equal(dayOf("31 Jan 2027"), "2027-01-31", "day 90 is the last bookable check-in");
  assert.equal(dayOf("31 December"), "2026-12-31");

  // A range of literal days keeps its check-out: the deterministic parser reads "10-13 Nov" as a stay.
  const range = only("10-13 Nov");
  assert.equal(range.kind === "day" && range.date, "2026-11-10");
  assert.equal(range.kind === "day" && range.endDate, "2026-11-13");

  // "next Friday" on Monday is ambiguous (AC4); the deterministic rule date stays one of the two candidates.
  const nextFriday = only("next Friday");
  assert.equal(nextFriday.kind, "ambiguous");
  assert.ok(nextFriday.kind === "ambiguous" && nextFriday.candidates.includes("2026-11-13"));

  // "this weekend" and "next weekend": Friday to Sunday, as the deterministic parser reads them.
  const weekend = only("this weekend");
  assert.equal(weekend.kind, "range");
  assert.ok(weekend.kind === "range" && weekend.grain === "weekend" && weekend.earliest === "2026-11-06" && weekend.latest === "2026-11-08");
  const nextWeekend = only("next weekend");
  assert.ok(nextWeekend.kind === "range" && nextWeekend.earliest === "2026-11-13" && nextWeekend.latest === "2026-11-15");

  // Spans cover the guest's words, so the callers can bind a date to its clause.
  const text = "Ikoyi from 10 Nov";
  const literal = only("Ikoyi from 10 Nov");
  assert.equal(text.slice(literal.span.start, literal.span.end), "10 Nov");
});

test("AC2: \"next week\", \"next month\", \"end of the month\" and \"first week of December\" resolve to a range with the right grain, never a day", () => {
  const nextWeek = only("next week");
  assert.equal(nextWeek.kind, "range", "next week is a range, never a day");
  assert.ok(nextWeek.kind === "range" && nextWeek.grain === "week" && nextWeek.earliest === "2026-11-09" && nextWeek.latest === "2026-11-15");

  const nextMonth = only("next month");
  assert.equal(nextMonth.kind, "range");
  assert.ok(nextMonth.kind === "range" && nextMonth.grain === "month" && nextMonth.earliest === "2026-12-01" && nextMonth.latest === "2026-12-31");

  const endOfMonth = only("end of the month");
  assert.equal(endOfMonth.kind, "range");
  assert.ok(endOfMonth.kind === "range" && endOfMonth.grain === "week" && endOfMonth.earliest === "2026-11-24" && endOfMonth.latest === "2026-11-30");

  const firstWeek = only("first week of December");
  assert.equal(firstWeek.kind, "range");
  assert.ok(firstWeek.kind === "range" && firstWeek.grain === "week" && firstWeek.earliest === "2026-12-01" && firstWeek.latest === "2026-12-07");

  // The same rule covers the mid-month window; the span covers the phrase the guest typed.
  const mid = only("mid-December for 2 guests");
  assert.ok(mid.kind === "range" && mid.grain === "month" && mid.earliest === "2026-12-10" && mid.latest === "2026-12-20");
  assert.equal("mid-December for 2 guests".slice(mid.span.start, mid.span.end), "mid-December");
});

test("AC3: \"in two weeks\", \"in 10 days\" and \"next tomorrow\" resolve to a day", () => {
  assert.equal(dayOf("in two weeks"), "2026-11-16");
  assert.equal(dayOf("in 10 days"), "2026-11-12");
  // Nigerian English "next tomorrow" is the day after tomorrow (ADR 0106, 2 Nov 2026).
  assert.equal(dayOf("next tomorrow"), "2026-11-04");
  const relative = only("in two weeks");
  assert.ok(relative.kind === "day" && relative.source === "relative", "relative phrases carry source relative");
});

test("AC4: \"next Friday\" follows the issue 01 rule, including ambiguous where decided", () => {
  // Monday to Saturday: both candidates, the coming Friday and the Friday of the following Monday-start week.
  for (const day of ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]) {
    const result = only("next Friday", clockOn(day));
    assert.equal(result.kind, "ambiguous", `next Friday on ${day} is ambiguous`);
    assert.deepEqual(result.kind === "ambiguous" ? [...result.candidates] : [], ["2026-11-06", "2026-11-13"], `both candidates on ${day}`);
  }

  // Sunday only: the rule applies, that weekday in the following Monday-start week (Fri 13 Nov).
  assert.equal(dayOf("next Friday", clockOn("2026-11-08")), "2026-11-13");

  // Friday and Saturday: the coming Friday and the rule Friday are the same date, so there is one reading.
  assert.equal(dayOf("next Friday", clockOn("2026-11-06")), "2026-11-13");
  assert.equal(dayOf("next Friday", clockOn("2026-11-07")), "2026-11-13");

  // The ambiguity holds across the year end: from Thu 31 Dec, the candidates are Fri 1 Jan and Fri 8 Jan.
  const yearEnd = only("next Friday", clockOn("2026-12-31"));
  assert.deepEqual(yearEnd.kind === "ambiguous" ? [...yearEnd.candidates] : [], ["2027-01-01", "2027-01-08"]);
});

test("AC5: Past dates, dates beyond the 90-day horizon, 31 February, contradicting weekdays and moving holidays are unresolved", () => {
  // Past: an explicit year before today never moves forward (a year-omitted day always does).
  assert.equal(unresolvedReason("1 Nov 2026"), "past");

  // Beyond the horizon: day 91 is 1 Feb 2027 on the reference clock. The reading is kept so a caller can refuse it.
  const beyond = only("1 Feb 2027");
  assert.ok(beyond.kind === "unresolved" && beyond.reason === "beyond_horizon" && beyond.date === "2027-02-01");
  assert.equal(unresolvedReason("in 91 days"), "beyond_horizon");

  // 31 February is not a calendar day in any year.
  assert.equal(unresolvedReason("31 February"), "invalid");

  // "Fri 21 Nov" is a Saturday in 2026, so the weekday contradicts the date.
  assert.equal(unresolvedReason("Fri 21 Nov"), "weekday_mismatch");

  // Moving holidays never resolve to a date the server picked (ADR 0106, 2 Nov 2026).
  assert.equal(unresolvedReason("Sallah"), "moving_holiday");
  assert.equal(unresolvedReason("Eid"), "moving_holiday");
  assert.equal(unresolvedReason("Easter"), "moving_holiday");
});

test("AC6: Every phrase against seven reference weekdays, a month end, 31 December and the horizon edge", () => {
  for (const day of REFERENCE_WEEK) {
    const now = clockOn(day);
    assert.equal(dayOf("today", now), day);
    assert.equal(dayOf("tomorrow", now), plusDays(day, 1));
    assert.equal(dayOf("next tomorrow", now), plusDays(day, 2));
    assert.equal(dayOf("in two weeks", now), plusDays(day, 14));
    assert.equal(dayOf("in 10 days", now), plusDays(day, 10));
    assert.equal(dayOf("Christmas", now), "2026-12-25");
    assert.equal(dayOf("New Year's Eve", now), "2026-12-31");
    assert.equal(unresolvedReason("Easter", now), "moving_holiday");

    const week = only("next week", now);
    assert.ok(week.kind === "range" && week.earliest === "2026-11-09" && week.latest === "2026-11-15", `next week on ${day}`);
    const weekend = only("this weekend", now);
    const coming = day === "2026-11-07" || day === "2026-11-08" ? ["2026-11-13", "2026-11-15"] : ["2026-11-06", "2026-11-08"];
    assert.ok(weekend.kind === "range" && weekend.earliest === coming[0] && weekend.latest === coming[1], `this weekend on ${day}`);
    const nextWeekend = only("next weekend", now);
    const after = day === "2026-11-07" || day === "2026-11-08" ? ["2026-11-20", "2026-11-22"] : ["2026-11-13", "2026-11-15"];
    assert.ok(nextWeekend.kind === "range" && nextWeekend.earliest === after[0] && nextWeekend.latest === after[1], `next weekend on ${day}`);

    const nextFriday = only("next Friday", now);
    if (day === "2026-11-06" || day === "2026-11-07" || day === "2026-11-08") {
      assert.ok(nextFriday.kind === "day" && nextFriday.date === "2026-11-13", `next Friday on ${day}`);
    } else {
      assert.ok(nextFriday.kind === "ambiguous" && nextFriday.candidates.length === 2, `next Friday on ${day}`);
    }
  }

  // A month end: from 30 Nov the span "end of the month" is cut to today, and "next month" is December.
  const monthEnd = clockOn("2026-11-30");
  const endOfMonth = only("end of the month", monthEnd);
  assert.ok(endOfMonth.kind === "range" && endOfMonth.earliest === "2026-11-30" && endOfMonth.latest === "2026-11-30", "the span starts on today, never in the past");
  assert.equal(dayOf("tomorrow", monthEnd), "2026-12-01");
  const december = only("next month", monthEnd);
  assert.ok(december.kind === "range" && december.earliest === "2026-12-01" && december.latest === "2026-12-31");

  // 31 December: the year rolls over for relative phrases, and a fixed holiday that has passed is next year's (beyond the horizon).
  const yearEnd = clockOn("2026-12-31");
  assert.equal(dayOf("tomorrow", yearEnd), "2027-01-01");
  assert.equal(dayOf("New Year's Eve", yearEnd), "2026-12-31");
  assert.equal(unresolvedReason("Christmas", yearEnd), "beyond_horizon");
  const nextWeek = only("next week", yearEnd);
  assert.ok(nextWeek.kind === "range" && nextWeek.earliest === "2027-01-04" && nextWeek.latest === "2027-01-10");

  // The horizon edge: day 90 (31 Jan 2027) resolves, day 91 (1 Feb 2027) is unresolved (ADR 0055).
  assert.equal(BOOKING_HORIZON_DAYS, 90);
  assert.equal(dayOf("in 90 days"), "2027-01-31");
  assert.equal(dayOf("31 Jan 2027"), "2027-01-31");
  assert.equal(unresolvedReason("in 91 days"), "beyond_horizon");
  assert.equal(unresolvedReason("1 Feb 2027"), "beyond_horizon");
});

test("AC7: The assistant literal parser keeps its signature and authority (test/assistant-date-literals.test.ts and test/assistant-date-literal-authority.test.ts run unchanged)", () => {
  // The two named files are the gate for this criterion. This test pins the one fact the assistant path relies on:
  // a relative phrase is never a literal, so it still authorizes no check-in (ADR 0106, 27 Oct 2026).
  const relative = resolve("next Friday tomorrow");
  assert.ok(relative.every((result) => result.kind !== "day" || result.source === "relative"));
});

test("Policy: a Sunday week start, a different holiday list, a shorter horizon and no ambiguity change the results (no literal rules in the code)", () => {
  // Week start: with weeks starting on Sunday, next week on Mon 2 Nov is Sun 8 Nov to Sat 14 Nov.
  const sundayStart: StayDatePolicy = { ...DEFAULT_STAY_DATE_POLICY, weekStart: 0 };
  const sundayWeek = only("next week", MONDAY, sundayStart);
  assert.ok(sundayWeek.kind === "range" && sundayWeek.earliest === "2026-11-08" && sundayWeek.latest === "2026-11-14");

  // Holidays: an empty fixed list recognises no Christmas; a custom list resolves its own phrase, and the policy names it.
  const noHolidays: StayDatePolicy = { ...DEFAULT_STAY_DATE_POLICY, fixedHolidays: [] };
  assert.equal(resolve("Christmas", MONDAY, noHolidays).length, 0);
  const custom: StayDatePolicy = {
    ...DEFAULT_STAY_DATE_POLICY,
    fixedHolidays: [{ name: "Independence Day", month: 10, day: 1, phrases: ["independence day"] }],
  };
  assert.equal(unresolvedReason("Independence Day", MONDAY, custom), "beyond_horizon");
  assert.equal(resolve("Christmas", MONDAY, custom).length, 0);

  // Horizon: a 30-day horizon moves the edge to day 30 (1 Dec); day 31 (3 Dec) is beyond it.
  const shorter: StayDatePolicy = { ...DEFAULT_STAY_DATE_POLICY, bookingHorizonDays: 30 };
  assert.equal(dayOf("1 Dec", MONDAY, shorter), "2026-12-01");
  assert.equal(unresolvedReason("3 Dec", MONDAY, shorter), "beyond_horizon");

  // Ambiguity: with no weekday set ambiguous, "next Friday" on a Thursday is the rule date alone.
  const ruleOnly: StayDatePolicy = { ...DEFAULT_STAY_DATE_POLICY, nextWeekdayAmbiguousOn: [] };
  assert.equal(dayOf("next Friday", clockOn("2026-11-05"), ruleOnly), "2026-11-13");
});
