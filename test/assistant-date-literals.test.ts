import assert from "node:assert/strict";
import test from "node:test";
import { guestDateLiterals } from "../apps/local-guest/src/assistant/date-literals.js";
import { containsExactDateToken, containsGuestDate, currentTurnDateRoles } from "../apps/local-guest/src/assistant/date-tokens.js";
import { FIXTURE_NOW } from "./helpers/guest-date-fixtures.js";

/** The ISO dates a guest literal resolves to at `now`, in text order. */
function resolved(text: string, now: Date = FIXTURE_NOW): string[] {
  return guestDateLiterals(text, now).map((literal) => literal.date);
}

test("Date literal AC1: each accepted explicit day-month-year form resolves to its ISO date", () => {
  const cases: readonly (readonly [string, string])[] = [
    ["20 November 2026", "2026-11-20"],
    ["20 Nov 2026", "2026-11-20"],
    ["20 NOV 2026", "2026-11-20"],
    ["20th November 2026", "2026-11-20"],
    ["20th of November, 2026", "2026-11-20"],
    ["November 20, 2026", "2026-11-20"],
    ["Nov 20 2026", "2026-11-20"],
    ["Sept 3 2026", "2026-09-03"],
    ["3 Sep 2026", "2026-09-03"],
    ["1st Oct 2026", "2026-10-01"],
  ];
  for (const [text, date] of cases) assert.deepEqual(resolved(text), [date], text);
});

test("Date literal AC2: a year-omitted day and month resolve to the nearest on-or-after occurrence in Africa/Lagos", () => {
  assert.deepEqual(resolved("20 Nov"), ["2026-11-20"]);
  assert.deepEqual(resolved("Fri 20 Nov"), ["2026-11-20"], "a weekday that matches the resolved date is accepted");
  assert.deepEqual(resolved("20th November"), ["2026-11-20"]);
  // Africa/Lagos is UTC+1: 23:30 UTC on 2026-09-02 is already 2026-09-03 in Lagos, so today is 3 September.
  assert.deepEqual(resolved("3 Sept", new Date("2026-09-02T23:30:00Z")), ["2026-09-03"], "today in Lagos counts as on or after today");
});

test("Date literal AC3: year rollover resolves to the next calendar year inside the horizon", () => {
  const lateDecember = new Date("2026-12-20T10:00:00Z");
  assert.deepEqual(resolved("20 Jan", lateDecember), ["2027-01-20"]);
  assert.deepEqual(resolved("31 Dec", lateDecember), ["2026-12-31"]);
});

test("Date literal AC4: a nearest occurrence beyond the 90-day booking horizon stays unresolved", () => {
  assert.deepEqual(resolved("20 Feb"), [], "2027-02-20 is 170 days after the fixture clock");
  assert.deepEqual(resolved("20 Feb 2027"), [], "an explicit date beyond the horizon carries no authority");
});

test("Date literal AC5: leap day resolves only in a leap year that is inside the horizon", () => {
  assert.deepEqual(resolved("29 February", new Date("2028-01-15T10:00:00Z")), ["2028-02-29"]);
  assert.deepEqual(resolved("29 Feb 2028", new Date("2028-01-15T10:00:00Z")), ["2028-02-29"]);
  assert.deepEqual(resolved("29 Feb 2027"), [], "2027 is not a leap year");
  assert.deepEqual(resolved("29 February"), [], "the next leap day is outside the horizon from the fixture clock");
});

test("Date literal AC6: relative words stay unresolved", () => {
  for (const text of ["tomorrow", "today", "Friday", "next Friday", "next week", "this weekend", "in two weeks"]) {
    assert.deepEqual(resolved(text), [], text);
  }
});

test("Date literal AC7: numeric and ambiguous forms stay unresolved", () => {
  for (const text of ["03/04/2026", "3-4-2026", "3.4.2026", "20/11", "11/20"]) {
    assert.deepEqual(resolved(text), [], text);
  }
});

test("Date literal AC8: invalid calendar dates and past dates stay unresolved", () => {
  for (const text of ["31 Feb 2027", "31 November 2026", "30 February 2027", "2 Sept 2026"]) {
    assert.deepEqual(resolved(text), [], text);
  }
  assert.deepEqual(resolved("20 August 2026"), [], "a past explicit date is not an authority");
});

test("Date literal AC9: a weekday that contradicts the resolved date stays unresolved", () => {
  assert.deepEqual(resolved("Mon 20 Nov 2026"), [], "20 November 2026 is a Friday");
  assert.deepEqual(resolved("Mon 20 Nov"), []);
  assert.deepEqual(resolved("Fri 20 Nov 2026"), ["2026-11-20"]);
});

test("Date literal AC10: a longer digit run around a date blocks the match", () => {
  assert.deepEqual(resolved("20 November 20260"), [], "a five-digit year is not a year");
  assert.deepEqual(resolved("120 November 2026"), [], "a three-digit day is not a day");
});

test("Date literal AC11: May as a month-first date and month-first counts stay unresolved", () => {
  assert.deepEqual(resolved("May 20 2027"), [], "month-first May is skipped because it reads as a word");
  assert.deepEqual(resolved("November 2 guests"), [], "a guest count after a month name is not a day");
  assert.deepEqual(resolved("20 May 2027"), [], "2027-05-20 is beyond the fixture horizon");
  assert.deepEqual(resolved("20 May 2026"), [], "a past May date is not an authority");
});

test("Date literal AC12: in a clause with two literals, each keeps its own resolved date in text order", () => {
  assert.deepEqual(resolved("check in 20 November 2026, check out 23 November 2026, 2 guests"), ["2026-11-20", "2026-11-23"]);
  const range = "20 Nov 2026 to 23 Nov 2026";
  assert.deepEqual(guestDateLiterals(range, FIXTURE_NOW).map((literal) => literal.start), [0, range.indexOf("23")]);
});

test("Date authority AC13: a literal in the guest's text authorizes its ISO date and no other", () => {
  const text = "Lekki Phase 1, check in 20 November 2026, check out 23 November 2026, 2 guests";
  assert.equal(containsGuestDate(text, "2026-11-20", FIXTURE_NOW), true);
  assert.equal(containsGuestDate(text, "2026-11-23", FIXTURE_NOW), true);
  assert.equal(containsGuestDate(text, "2026-11-21", FIXTURE_NOW), false, "a model-only date never matches a literal");
  assert.equal(containsGuestDate(text, "2026-11-20", new Date("2027-01-20T10:00:00Z")), false, "a past literal carries no authority at a later clock");
});

test("Date role AC14: natural-language check-in and checkout keep their roles", () => {
  assert.deepEqual(
    currentTurnDateRoles("Lekki Phase 1, check in 20 November 2026, check out 23 November 2026, 2 guests", { checkIn: "2026-11-20", checkOut: "2026-11-23" }, FIXTURE_NOW),
    { checkIn: "2026-11-20", checkOut: "2026-11-23" },
  );
  assert.deepEqual(
    currentTurnDateRoles("check out 23 November 2026 and check in 20 November 2026", { checkIn: "2026-11-20", checkOut: "2026-11-23" }, FIXTURE_NOW),
    { checkIn: "2026-11-20", checkOut: "2026-11-23" },
    "a literal after a checkout literal starts a new clause",
  );
  assert.deepEqual(
    currentTurnDateRoles("change checkout to 23 November 2026; keep the current check-in", { checkIn: "2026-11-23", checkOut: null }, FIXTURE_NOW),
    {},
    "a checkout-governed literal never authorizes a check-in",
  );
});

test("Date literal AC15: ISO-only inputs behave exactly as before (differential)", () => {
  const isoTexts = [
    "Check in 2026-11-01 and check out 2026-11-06",
    "Change checkout to 2026-11-06; keep the current check-in.",
    "Find stays from 2026-11-011 for 2 nights",
    "Find stays from 2026-11-01 for 2 nights",
    "Lekki, check in 2026-11-20, check out 2026-11-23, 2 guests",
    "check out 2026-11-23 and check in 2026-11-20",
    "use 2026-11-20 for both the check-in and checkout",
    "2026-11-20",
    "x2026-11-20y",
    "check-out 2026-11-23. check-in 2026-11-20!",
    "checkin 2026-11-20 checkout 2026-11-23",
    "reference 2026-11-06 only",
  ];
  const dates = ["2026-11-20", "2026-11-23", "2026-11-01", "2026-11-06", "2026-11-011"];
  const pairs: readonly (readonly [string, string | null])[] = [["2026-11-20", "2026-11-23"], ["2026-11-20", null], ["2026-11-06", "2026-11-06"], ["2026-11-01", "2026-11-06"], ["2026-11-23", "2026-11-20"]];
  for (const text of isoTexts) {
    assert.deepEqual(guestDateLiterals(text, FIXTURE_NOW), [], `ISO text has no literal: ${text}`);
    for (const date of dates) {
      assert.equal(containsGuestDate(text, date, FIXTURE_NOW), containsExactDateToken(text, date), `${text} / ${date}`);
    }
    for (const [checkIn, checkOut] of pairs) {
      const slots = { checkIn, checkOut };
      assert.deepEqual(currentTurnDateRoles(text, slots, FIXTURE_NOW), currentTurnDateRoles(text, slots), `${text} / ${checkIn} / ${checkOut}`);
    }
  }
  assert.deepEqual(currentTurnDateRoles("Check in 2026-11-01 and check out 2026-11-06", { checkIn: "2026-11-01", checkOut: "2026-11-06" }, FIXTURE_NOW), { checkIn: "2026-11-01", checkOut: "2026-11-06" });
  assert.deepEqual(currentTurnDateRoles("Change checkout to 2026-11-06; keep the current check-in.", { checkIn: "2026-11-06", checkOut: null }, FIXTURE_NOW), {});
  assert.equal(containsGuestDate("Find stays from 2026-11-011 for 2 nights", "2026-11-01", FIXTURE_NOW), false);
});
