import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { formatBookingDateTime, formatBookingDeadline, formatStayDates } from "../apps/web-agent/src/booking-presentation.js";
import { formatGuestDate } from "../apps/web-agent/src/guest-content.js";
import { formatWatDateTime } from "../apps/web/src/ui-kit.js";

// Issue 09 (ADR 0092, ADR 0078): guest dates use en-NG; contractual times use Africa/Lagos and are labelled WAT;
// date-only values stay in UTC so a calendar date never shifts.

test("AC1: Stay dates render with the en-NG locale", () => {
  assert.equal(formatStayDates("2026-12-31", "2027-01-02"), "31 Dec 2026–2 Jan 2027");
  // Failure path: a malformed date is shown as given, never guessed.
  assert.equal(formatStayDates("not-a-date", "2027-01-02"), "not-a-date to 2027-01-02");
  const source = readFileSync("apps/web-agent/src/booking-presentation.ts", "utf8");
  assert.match(source, /Intl\.DateTimeFormat\("en-NG", \{ timeZone: "UTC", day: "numeric", month: "short", year: "numeric" \}/);
  assert.doesNotMatch(source, /Intl\.DateTimeFormat\("en-GB"/);
});

test("AC2: Every guest-visible time-of-day value is in Africa/Lagos and labelled WAT", () => {
  const at = "2026-10-27T10:00:00.000Z";
  assert.equal(formatWatDateTime(at), "11:00 am WAT, 27 Oct 2026");
  assert.equal(formatBookingDateTime(at), "11:00 am WAT, 27 Oct 2026");
  assert.equal(formatBookingDeadline(at), "Pay by 11:00 am WAT, 27 Oct 2026");
  // Failure path: a time without WAT is recognisable as unlabelled.
  assert.equal(isWattLabelled("11:00 am"), false);
  assert.equal(isWattLabelled("11:00 am WAT, 27 Oct 2026"), true);

  // Source audit: every file in the four apps that formats a time of day names Africa/Lagos.
  const files = ["apps/web-agent/src", "apps/web/src", "apps/local-guest/src", "apps/local-owner/src"]
    .flatMap((root) => readdirSync(root, { recursive: true, encoding: "utf8" }).filter((name) => name.endsWith(".ts")).map((name) => join(root, name)));
  const timeFormatters = files.filter((path) => /\btimeStyle\b|\bhour:\s*"numeric"/.test(readFileSync(path, "utf8")));
  assert.ok(timeFormatters.length >= 4, `the audit finds the time formatters (saw ${timeFormatters.length})`);
  for (const path of timeFormatters) {
    assert.match(readFileSync(path, "utf8"), /Africa\/Lagos/, `${path} formats a time of day in Africa/Lagos`);
  }
});

test("AC3: A test pins the date and time format at a DST-free instant and at the UTC day boundary", () => {
  // Nigeria has no daylight-saving change: the same clock offset holds across both European transitions.
  assert.equal(formatWatDateTime("2026-03-29T00:30:00.000Z"), "1:30 am WAT, 29 Mar 2026");
  assert.equal(formatWatDateTime("2026-10-25T00:30:00.000Z"), "1:30 am WAT, 25 Oct 2026");
  // At the UTC day boundary the WAT clock and calendar move to the next day.
  assert.equal(formatWatDateTime("2026-12-31T23:30:00.000Z"), "12:30 am WAT, 1 Jan 2027");
  // Date-only values stay in UTC, so the calendar date never shifts.
  assert.equal(formatGuestDate("2026-12-31"), "31 Dec 2026");
  assert.equal(formatStayDates("2026-12-31", "2027-01-02"), "31 Dec 2026–2 Jan 2027");
});

function isWattLabelled(value: string): boolean {
  return /\bWAT\b/.test(value);
}
