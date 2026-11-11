import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// Issue 26 (ADR 0041, 0042, 0078; guideline §3, §5): Operator detail clarity. The legacy dashboard is reachable at "/"
// in non-production mode, so it is relabelled rather than retired.

const SERVER = readFileSync("apps/local-owner/src/local-owner-server.ts", "utf8");

test("AC1: Operator request detail shows human dates, not ISO strings", () => {
  const detail = /function operatorRequestHtml[\s\S]*?\n}/.exec(SERVER)?.[0];
  assert.ok(detail, "the request detail renders");
  assert.match(detail, /<dt>Dates<\/dt><dd><time datetime="\$\{escapeHtml\(facts\.checkIn\)\}">\$\{escapeHtml\(formatStayDates\(facts\.checkIn, facts\.checkOut\)\)\}/);
  // Failure path: no bare ISO date is the visible text.
  assert.doesNotMatch(detail, /\$\{escapeHtml\(facts\.checkIn\)\}<\/time> to <time/);
});

test("AC2: Every Operator status label is plain sentence case", () => {
  assert.match(SERVER, /if \(status === "delivery_failed"\) return \{ label: "Delivery failed"/);
  assert.match(SERVER, /payment_pending: \{ label: "Payment pending"/);
  // "Operator Hold" is a glossary term (domains/shortlet/CONTEXT.md), so it keeps its capitals.
  assert.match(SERVER, /held: \{ label: "Operator Hold"/);
  // Failure path: the old title-case forms are gone from the operator status maps.
  assert.doesNotMatch(SERVER, /label: "Delivery Failed"/);
  assert.doesNotMatch(SERVER, /label: "Payment Pending"/);
  assert.doesNotMatch(SERVER, /label: "Operator hold"/);
});

test("AC3: A second Confirm while the first is in flight is not sent, and the server still refuses a duplicate decision", () => {
  assert.match(SERVER, /form\[data-decision\]/);
  assert.match(SERVER, /button\.disabled = true/);
  assert.match(SERVER, /document\.querySelectorAll\("form\[data-decision\]"\)/);
  assert.match(SERVER, /addEventListener\("submit"/);
  // The server authority is unchanged: the decision still carries basedOnVersion and refusalNotice.
  assert.match(SERVER, /basedOnVersion/);
  assert.match(SERVER, /refusalNotice/);
});

test("AC4: The legacy dashboard is removed or shows no internal status names", () => {
  const legacy = /export function renderOwnerDashboardHtml[\s\S]*?\n}/.exec(SERVER)?.[0];
  assert.ok(legacy, "the legacy dashboard is still present and reachable at / in non-production");
  assert.match(legacy, /requestStatus\(latestRequest\.facts\.status, latestRequest\.facts\.delivered\)\.label/);
  assert.doesNotMatch(legacy, /"disclosed"/);
  assert.doesNotMatch(legacy, /Confirm Booking \(Lock Availability\)/);
});
