import assert from "node:assert/strict";
import test from "node:test";
import { EXTENDED_STAY_POLICY, readStayLength } from "../domains/shortlet/src/index.js";

// Issue 19 (ADR 0092 as amended 1 Nov 2026: a month is one 30-night Billing Period; ADR 0106 2 Nov: guest-authored lengths).
// The reader is pure: the text is the only input, and the month length comes from EXTENDED_STAY_POLICY.billingPeriodNights.

function nightsOf(text: string): number | undefined {
  const reading = readStayLength(text);
  return reading.kind === "length" ? reading.nights : undefined;
}

test("AC1 the reader maps 'for 2 months', 'two months', 'a month', '1 month', '3 weeks', 'a fortnight', 'a week' and '21 nights' to 60, 60, 30, 30, 21, 14, 7 and 21 nights", () => {
  assert.equal(nightsOf("Ikoyi for 2 months from 5 Jan"), 60);
  assert.equal(nightsOf("Ikoyi for two months from 5 Jan"), 60);
  assert.equal(nightsOf("a month in Ikoyi"), 30);
  assert.equal(nightsOf("1 month in Ikoyi"), 30);
  assert.equal(nightsOf("3 weeks in Ikoyi"), 21);
  assert.equal(nightsOf("a fortnight in Ikoyi"), 14);
  assert.equal(nightsOf("a week in Ikoyi"), 7);
  assert.equal(nightsOf("21 nights in Ikoyi"), 21);
  assert.equal(EXTENDED_STAY_POLICY.billingPeriodNights, 30, "a month is the policy's Billing Period, read from the policy");
});

test("AC1 'a few months', '2-3 months', '2 or 3 months', 'a couple of months', 'a month and a half' and '2 months, 45 nights' give no length", () => {
  for (const text of ["a few months in Ikoyi", "2-3 months in Ikoyi", "2 or 3 months in Ikoyi", "a couple of months in Ikoyi", "a month and a half in Ikoyi", "2 months, 45 nights in Ikoyi"]) {
    assert.deepEqual(readStayLength(text), { kind: "vague" }, text);
  }
});

test("AC1 a length in months is a closed reading, not a guess, when the words are vague (fail closed)", () => {
  // Owner decision (issue 19): a vague length gives no length, so the concierge asks, exactly as with no length.
  assert.equal(nightsOf("a few months"), undefined);
  assert.equal(nightsOf("a month or two"), undefined);
  assert.equal(nightsOf("2 months, 45 nights"), undefined);
});

test("AC1 an 'in N weeks' check-in phrase is not a stay length", () => {
  assert.deepEqual(readStayLength("arriving in 3 weeks"), { kind: "none" });
});

test("Guard for AC8: a money rate such as '₦70,000 a night' or '₦300,000 a month' is not a stay length (the budget keeps its own words)", () => {
  // The guest's budget is read by the budget parser (stay-budget.ts); its "a night" or "a month" is a rate, never a length.
  assert.deepEqual(readStayLength("About ₦70,000 a night, for 3 nights in Ikoyi"), { kind: "length", unit: "night", count: 3, nights: 3 });
  assert.deepEqual(readStayLength("Up to ₦70k a night in Ikoyi"), { kind: "none" });
  assert.deepEqual(readStayLength("₦300,000 a month for Ikoyi"), { kind: "none" });
  assert.deepEqual(readStayLength("Ikoyi, a month from 5 Jan"), { kind: "length", unit: "month", count: 1, nights: 30 });
});
